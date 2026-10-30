// The browser driver: the browser BROWSER_EXECUTABLE names, over the DevTools Protocol on a pipe,
// with no package between, its pages, and the waits a test makes on a page. browser.d.ts beside it
// carries the types a consumer reads.
// Adapted from spike-html-apps-components (2fded6d): test/browser/support/browser-pipe.js, typed,
// with until from spike-html-apps (a6ff18d): test/browser/support/app.js, rejecting on a thrown
// expression, and SETTLED from spike-html-apps-components (2fded6d): scripts/screenshots.js.

/** @import { Browser, Page } from "./browser.js" */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** What every browser runs with, so a reading is the same on any machine. */
const settings = { lang: "en-US", tz: "UTC", width: 1280, height: 720 };

/**
 * Launches the browser BROWSER_EXECUTABLE names, resolving once the protocol answers.
 * @returns {Promise<Browser>}
 */
export async function launch() {
  const executable = process.env.BROWSER_EXECUTABLE;
  if (!executable)
    throw new Error("BROWSER_EXECUTABLE names no browser: run mise run test:browser");
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
      // Every name but the loopback address fails, so no background request leaves the machine.
      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
      "about:blank",
    ],
    {
      stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"],
      env: { ...process.env, TZ: settings.tz, TMPDIR: profile },
    },
  );
  // Chromium reads commands on its fd 3 and writes replies and events on its fd 4, each message one
  // JSON object ended by a NUL.
  const errors = /** @type {import("node:stream").Readable} */ (child.stdio[2]);
  const commands = /** @type {import("node:stream").Writable} */ (child.stdio[3]);
  const replies = /** @type {import("node:stream").Readable} */ (child.stdio[4]);
  let log = "";
  errors.setEncoding("utf8");
  errors.on("data", (chunk) => (log = (log + chunk).slice(-2000)));

  let next = 0;
  /** @type {Map<number, { resolve: (result: any) => void, reject: (error: Error) => void }>} */
  const waiting = new Map();
  /** @type {Map<string, (params: any) => void>} */
  const listeners = new Map();
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
  replies.on("data", (chunk) => {
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

  /**
   * Sends one command, resolving to its result.
   * @param {string} method
   * @param {Record<string, unknown>} [params]
   * @param {string} [sessionId]
   * @returns {Promise<any>}
   */
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++next;
      waiting.set(id, { resolve, reject });
      if (gone) return fail();
      commands.write(`${JSON.stringify({ id, method, params, sessionId })}\0`);
    });

  /**
   * Calls the listener with each event of the method in the session, replacing any before it.
   * @param {string} sessionId
   * @param {string} method
   * @param {(params: any) => void} listener
   */
  const on = (sessionId, method, listener) => {
    listeners.set(`${sessionId}:${method}`, listener);
  };

  // A run that ends without closing the browser still ends it.
  const orphan = () => child.kill();
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

  /**
   * Opens the URL in a new page, resolving to the page once its load event fires.
   * @param {string} url
   * @returns {Promise<Page>}
   */
  async function open(url) {
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    // flatten: the page's commands carry its session id on the one pipe.
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    /** @type {Page["cdp"]} */
    const cdp = (method, params) => send(method, params, sessionId);
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

    /** @type {Page["goto"]} */
    const goto = async (url) => {
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
 * 25 ms; rejects naming the expression and the timeout once the timeout passes, or with the error
 * the expression throws.
 * @param {Page} page
 * @param {string} expression
 * @param {number} [timeout]
 * @returns {Promise<any>}
 */
export function until(page, expression, timeout = 10_000) {
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
export const SETTLED = `document.fonts.ready.then(() => new Promise((resolve) =>
  requestAnimationFrame(() => requestAnimationFrame(resolve))))`;
