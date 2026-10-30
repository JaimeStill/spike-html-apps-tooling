// The process helper at the package's seam, imported by the package's own name as a consumer
// imports it: the fixture server started through a task runner, mise, whose server is a
// grandchild, ready only once its URL answers 2xx, and stopped with every process it started gone;
// one that ignores SIGTERM, ended by SIGKILL after the drain; a command that exits first, one that
// is never ready, and one that never starts, each rejected with what it wrote; a caller that exits
// or is ended by a signal without stopping it; and freePort, a port a listen takes.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { freePort, start } from "@jaimestill/spike-html-apps-tooling/process.js";
import { members, parent, running } from "../support/processes.ts";

const fixture = join(import.meta.dirname, "fixtures/process");
const server = join(fixture, "server.ts");

const scratches: string[] = [];
after(() => {
  for (const scratch of scratches) rmSync(scratch, { recursive: true, force: true });
});

/** A path in a new temporary directory, removed after the run, for the fixture's pids. */
function pidsFile(): string {
  const scratch = mkdtempSync(join(tmpdir(), "process-test."));
  scratches.push(scratch);
  return join(scratch, "pids.json");
}

/** The fixture server's pids, as it wrote them. */
const pidsIn = (path: string): { server: number; child: number } =>
  JSON.parse(readFileSync(path, "utf8"));

/** The fixture server's environment and ready URL on a free port, with its mode and pids file. */
async function fixtureOptions(mode = "", extra: Record<string, string> = {}) {
  const port = await freePort();
  const pids = pidsFile();
  return {
    pids,
    ready: `http://127.0.0.1:${port}/ready`,
    env: { PORT: String(port), PIDS: pids, FIXTURE_MODE: mode, ...extra },
  };
}

/** The status the URL answers. */
async function status(url: string): Promise<number> {
  const response = await fetch(url, { headers: { connection: "close" } }).catch(() => undefined);
  await response?.body?.cancel();
  return response?.status ?? 0;
}

describe("a task runner whose server is a grandchild", () => {
  test("is ready once its URL answers 2xx, and stop leaves no process it started", async () => {
    const { pids, ready, env } = await fixtureOptions("", { READY_AFTER: "400" });
    const started = await start("mise", ["run", "dev"], {
      ready,
      cwd: fixture,
      // A test's fixture config is trusted for the run only.
      env: { ...env, MISE_TRUSTED_CONFIG_PATHS: fixture },
    });
    const { server: served, child } = pidsIn(pids);
    try {
      assert.equal(await status(ready), 200);
      // Its answers before it was ready were asked and passed over.
      assert.match(started.output(), /^\/ready 503$/m);
      assert.match(started.output(), /^\/ready 200$/m);
      // mise ran the server, which is no child of the caller's nor the command itself.
      assert.notEqual(served, started.pid);
      assert.notEqual(parent(served), process.pid);
      assert.ok(members(started.pid).includes(served));
      assert.ok(members(started.pid).includes(child));
    } finally {
      const code = await started.stop();
      assert.equal(typeof code, "number");
    }
    for (const pid of [started.pid, served, child]) assert.equal(running(pid), false, `${pid}`);
    assert.deepEqual(members(started.pid), []);
    assert.equal(await status(ready), 0);
    // A second stop resolves as the first did.
    assert.equal(await started.stop(), await started.stop());
  });

  test("a group that ignores SIGTERM is sent SIGKILL once the drain passes", async () => {
    const { pids, ready, env } = await fixtureOptions("stubborn");
    const started = await start("mise", ["run", "dev"], {
      ready,
      cwd: fixture,
      env: { ...env, MISE_TRUSTED_CONFIG_PATHS: fixture },
      drain: 300,
    });
    const { server: served, child } = pidsIn(pids);
    const before = performance.now();
    await started.stop();
    assert.ok(performance.now() - before >= 300, "stop didn't wait out the drain");
    assert.match(started.output(), /SIGTERM ignored/);
    for (const pid of [started.pid, served, child]) assert.equal(running(pid), false, `${pid}`);
    assert.deepEqual(members(started.pid), []);
  });
});

describe("rejects", () => {
  test("when the command exits before it is ready, with its output", async () => {
    const { ready, env } = await fixtureOptions("exit");
    await assert.rejects(
      start(process.execPath, [server], { ready, env }),
      /server\.ts exited with code 3 before http:\/\/127\.0\.0\.1:\d+\/ready answered; its output:\nthe fixture server dies before it listens$/,
    );
  });

  test("at its timeout, with its output, the group ended", async () => {
    const { pids, ready, env } = await fixtureOptions("never");
    const before = performance.now();
    await assert.rejects(
      start(process.execPath, [server], { ready, env, timeout: 600 }),
      /server\.ts wasn't ready at http:\/\/127\.0\.0\.1:\d+\/ready within 600 ms; its output:\n(.*\n)*\/ready 503/,
    );
    assert.ok(performance.now() - before >= 600);
    const { server: served, child } = pidsIn(pids);
    for (const pid of [served, child]) assert.equal(running(pid), false, `${pid}`);
    assert.deepEqual(members(served), []);
  });

  test("when the command doesn't start", async () => {
    await assert.rejects(
      start("no-such-command-anywhere", [], { ready: "http://127.0.0.1:1/" }),
      /^Error: no-such-command-anywhere didn't start: spawn no-such-command-anywhere ENOENT$/,
    );
  });
});

/**
 * Runs the fixture caller with CALLER_END, resolving to its exit, the group's and the server's
 * pids it printed, and once it exited. With signal, the caller is sent it once it prints.
 */
function caller(end: string, signal?: NodeJS.Signals) {
  const pids = pidsFile();
  const child = spawn(process.execPath, [join(fixture, "caller.ts")], {
    env: { ...process.env, PIDS: pids, CALLER_END: end },
    stdio: ["ignore", "pipe", "inherit"],
  });
  let stdout = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => {
    stdout += chunk;
    if (signal && stdout.endsWith("\n")) child.kill(signal);
  });
  return new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
    pids: { group: number; server: number; child: number };
  }>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal, pids: JSON.parse(stdout) }));
  });
}

/** Resolves once none of the pids is running, or rejects naming those left after 2 s. */
async function gone(pids: number[]): Promise<void> {
  const deadline = performance.now() + 2000;
  while (pids.some(running)) {
    if (performance.now() > deadline) {
      throw new Error(`still running: ${pids.filter(running).join(", ")}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("a caller that never stops it", () => {
  test("ends the group as it exits", async () => {
    const result = await caller("exit");
    assert.equal(result.code, 0);
    const { group, server: served, child } = result.pids;
    await gone([group, served, child]);
    assert.deepEqual(members(group), []);
  });

  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    test(`ends the group as ${signal}, which it doesn't listen for, ends it`, async () => {
      const result = await caller("wait", signal);
      // The signal still ends the caller, as it would with no group to end.
      assert.equal(result.signal, signal);
      const { group, server: served, child } = result.pids;
      await gone([group, served, child]);
      assert.deepEqual(members(group), []);
    });
  }
});

test("freePort resolves to a loopback port a listen takes", async () => {
  const port = await freePort();
  assert.ok(Number.isInteger(port) && port > 0 && port < 65536, `${port}`);
  const listener = createServer();
  await new Promise<void>((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(port, "127.0.0.1", resolve);
  });
  await new Promise((resolve) => listener.close(resolve));
});
