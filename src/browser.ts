// The browser driver: the browser BROWSER_EXECUTABLE names, over the DevTools Protocol on a pipe,
// with no package between, its pages, and the waits a test makes on a page.
// Adapted from spike-html-apps-components (2fded6d): test/browser/support/browser-pipe.js, in
// TypeScript, with until from spike-html-apps (a6ff18d): test/browser/support/app.js, rejecting on
// a thrown expression, and SETTLED from spike-html-apps-components (2fded6d): scripts/screenshots.js.

// The protocol's results and a page's values are JSON whose shape only the caller knows, so they
// are any, as JSON.parse's are, for the caller to destructure or annotate.
/* eslint-disable @typescript-eslint/no-explicit-any */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable, Writable } from "node:stream";

/** A browser launch started, until it is closed. */
export interface Browser {
  /** Opens the URL in a new page, resolving to the page once its load event fires. */
  open(url: string): Promise<Page>;
  /** Ends the browser, by Browser.close or after 5 s by a signal, and removes its profile. */
  close(): Promise<void>;
}

/** A page of a browser: 1280×720, en-US, UTC, its scrollbars shown. */
export interface Page {
  /** Loads the URL, resolving once its load event fires. */
  goto(url: string): Promise<void>;
  /** Sends the page one protocol command, resolving to its result. */
  cdp(method: string, params?: Record<string, unknown>): Promise<any>;
  /** Calls the listener with each of the page's events of the method, replacing any before it. */
  on(method: string, listener: (params: any) => void): void;
  /** The expression's value, awaited when it is a promise, as JSON. */
  evaluate(expression: string): Promise<any>;
  /** Closes the page. */
  close(): Promise<void>;
}

/** What every browser runs with, so a reading is the same on any machine. */
const settings = { lang: "en-US", tz: "UTC", width: 1280, height: 720 };

/**
 * Launches the browser BROWSER_EXECUTABLE names, resolving once the protocol answers; rejects
 * when BROWSER_EXECUTABLE is unset.
 */
export async function launch(): Promise<Browser> {
  const executable = process.env.BROWSER_EXECUTABLE;
  if (!executable) {
    throw new Error(
      "BROWSER_EXECUTABLE names no browser; set it to a Chrome or chrome-headless-shell executable",
    );
  }
  const profile = mkdtempSync(join(tmpdir(), "browser-pipe."));
  const child = spawn(
    executable,
    [
      "--headless",
      // Ubuntu's AppArmor refuses the user namespaces a downloaded Chrome's sandbox needs; the
      // browser loads only the repository's pages, from the loopback address.
      "--no-sandbox",
      "--remote-debugging-pipe",
      `--user-data-dir=${profile}`,
      `--lang=${settings.lang}`,
      "--no-first-run",
      "--disable-background-networking",
      "--disable-component-update",
      // Every name but the loopback address and localhost fails, so no background request leaves
      // the machine.
      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost",
      "about:blank",
    ],
    {
      stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"],
      env: { ...process.env, TZ: settings.tz, TMPDIR: profile },
    },
  );
  // Chromium reads commands on its fd 3 and writes replies and events on its fd 4, each message one
  // JSON object ended by a NUL.
  const errors = child.stdio[2] as Readable;
  const commands = child.stdio[3] as Writable;
  const replies = child.stdio[4] as Readable;
  let log = "";
  errors.setEncoding("utf8");
  errors.on("data", (chunk: string) => (log = (log + chunk).slice(-2000)));

  let next = 0;
  const waiting = new Map<
    number,
    { resolve: (result: any) => void; reject: (error: Error) => void }
  >();
  const listeners = new Map<string, (params: any) => void>();
  const exited = new Promise((resolve) => child.once("exit", resolve));
  let gone = false;
  const fail = () => {
    gone = true;
    const last = log.trim().split("\n").at(-1);
    for (const { reject } of waiting.values()) reject(new Error(`Chromium exited: ${last}`));
    waiting.clear();
  };
  exited.then(fail);
  commands.on("error", fail);
  replies.on("error", fail);

  let buffer = "";
  replies.setEncoding("utf8");
  replies.on("data", (chunk: string) => {
    buffer += chunk;
    for (let end = buffer.indexOf("\0"); end >= 0; end = buffer.indexOf("\0")) {
      const message = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      if (message.id === undefined) {
        listeners.get(`${message.sessionId}:${message.method}`)?.(message.params);
        continue;
      }
      const pending = waiting.get(message.id);
      waiting.delete(message.id);
      if (message.error) pending?.reject(new Error(`${message.error.message} (CDP)`));
      else pending?.resolve(message.result);
    }
  });

  /** Sends one command, resolving to its result. */
  const send = (method: string, params: Record<string, unknown> = {}, sessionId?: string) =>
    new Promise<any>((resolve, reject) => {
      const id = ++next;
      waiting.set(id, { resolve, reject });
      if (gone) return fail();
      commands.write(`${JSON.stringify({ id, method, params, sessionId })}\0`);
    });

  /** Calls the listener with each event of the method in the session, replacing any before it. */
  const on = (sessionId: string, method: string, listener: (params: any) => void) => {
    listeners.set(`${sessionId}:${method}`, listener);
  };

  // A run that ends without closing the browser still ends it and removes its profile, synchronously,
  // as an exit listener must. SIGKILL, since a browser shutting down on SIGTERM writes its profile
  // again after the removal.
  const orphan = () => {
    child.kill("SIGKILL");
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      // The process is exiting: a profile it cannot remove is left, not thrown.
    }
  };
  process.once("exit", orphan);

  /** Ends the browser, by Browser.close or after 5 s by a signal, and removes its profile. */
  const close = async () => {
    process.off("exit", orphan);
    if (!gone) {
      send("Browser.close").catch(() => {});
      const timer = setTimeout(() => child.kill(), 5000);
      await exited;
      clearTimeout(timer);
    }
    rmSync(profile, { recursive: true, force: true });
  };

  try {
    await send("Browser.getVersion");
  } catch (error) {
    await close();
    throw error;
  }

  /** Opens the URL in a new page, resolving to the page once its load event fires. */
  async function open(url: string): Promise<Page> {
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    // flatten: the page's commands carry its session id on the one pipe.
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    const cdp: Page["cdp"] = (method, params) => send(method, params, sessionId);
    await cdp("Page.enable");
    // A page Target.createTarget opens headless has no size until one is emulated.
    const { width, height } = settings;
    await cdp("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value: "light" }],
    });
    // Headless hides scrollbars; a page shows them as a user's browser does, so a scrolling
    // region's measures and captures match what a user sees.
    await cdp("Emulation.setScrollbarsHidden", { hidden: false });

    const goto: Page["goto"] = async (url) => {
      const loaded = new Promise((resolve) => on(sessionId, "Page.loadEventFired", resolve));
      const { errorText } = await cdp("Page.navigate", { url });
      if (errorText) throw new Error(`${url}: ${errorText}`);
      await loaded;
    };
    await goto(url);

    return {
      goto,
      cdp,
      on: (method, listener) => on(sessionId, method, listener),
      async evaluate(expression) {
        const { result, exceptionDetails } = await cdp("Runtime.evaluate", {
          expression,
          awaitPromise: true,
          returnByValue: true,
        });
        if (exceptionDetails) {
          throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
        }
        return result.value;
      },
      close: async () => {
        await send("Target.closeTarget", { targetId });
      },
    };
  }

  return { open, close };
}

/**
 * Resolves once the expression is truthy in the page, to its value, polling inside the page every
 * 25 ms; rejects naming the expression and the timeout, 10 s by default, once it passes, or with
 * the error the expression throws.
 */
export function until(page: Page, expression: string, timeout = 10_000): Promise<any> {
  return page.evaluate(`new Promise((resolve, reject) => {
    const deadline = performance.now() + ${timeout};
    const poll = () => {
      try {
        const value = (${expression});
        if (value) resolve(value);
        else if (performance.now() > deadline) reject(new Error(${JSON.stringify(`not within ${timeout} ms: ${expression}`)}));
        else setTimeout(poll, 25);
      } catch (error) {
        reject(error);
      }
    };
    poll();
  })`);
}

/** An expression that resolves once the page's fonts are ready and two frames have painted. */
export const SETTLED: string = `document.fonts.ready.then(() => new Promise((resolve) =>
  requestAnimationFrame(() => requestAnimationFrame(resolve))))`;
