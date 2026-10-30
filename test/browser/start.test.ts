// The screenshot bin over a description whose server is a start function, at the bin's seam, a
// command line: the start called once the arguments are checked, the pages opened against the
// origin it resolves to, and its stop called exactly once as the run ends, whether it captures
// everything, fails mid-run, or is ended by SIGINT or SIGTERM; a start that rejects fails the run;
// the help and the usage errors start nothing. The fixture logs each start, stop, and request.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

const root = join(import.meta.dirname, "../..");
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const bin = join(root, manifest.bin["spike-html-apps-screenshots"]);
const description = join(import.meta.dirname, "fixtures/start/description.ts");

const scratches: string[] = [];
after(() => {
  for (const scratch of scratches) rmSync(scratch, { recursive: true, force: true });
});

/** A new temporary directory, removed after the run. */
function scratchDir(): string {
  const scratch = mkdtempSync(join(tmpdir(), "start-test."));
  scratches.push(scratch);
  return scratch;
}

/** A run of the bin: its exit, its output, the fixture's log lines, and the files it kept. */
interface Run {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  log: string[];
  files: string[];
}

/**
 * Runs the bin over the fixture description, its files kept in a directory of the run's own, with
 * the arguments, START_MODE, and BROWSER_EXECUTABLE unset when unlaunched. With signal, the bin is
 * sent it once the fixture logs "open".
 */
function run(
  args: string[],
  {
    mode = "",
    signal,
    unlaunched = false,
  }: { mode?: string; signal?: NodeJS.Signals; unlaunched?: boolean } = {},
): Promise<Run> {
  const scratch = scratchDir();
  const log = join(scratch, "log");
  const dir = join(scratch, "out");
  const env: Record<string, string | undefined> = {
    ...process.env,
    NVIM: undefined,
    START_LOG: log,
    START_MODE: mode,
  };
  if (unlaunched) delete env.BROWSER_EXECUTABLE;
  delete env.NVIM;
  const child = spawn(bin, [description, "--output", "directory", "--dir", dir, ...args], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const lines = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []);
  let poll: NodeJS.Timeout | undefined;
  if (signal) {
    poll = setInterval(() => {
      if (lines().includes("open")) {
        clearInterval(poll);
        child.kill(signal);
      }
    }, 20);
  }
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
  child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      clearInterval(poll);
      const files = existsSync(dir) ? readdirSync(dir).sort() : [];
      resolve({ code, signal, stdout, stderr, log: lines(), files });
    });
  });
}

/** The fixture's start and stop lines, in order. */
const lifecycle = (log: string[]) => log.filter((line) => line === "start" || line === "stop");

describe("a start function", () => {
  test("is called once; the pages open against its origin; its stop is called once, last", async () => {
    const result = await run([]);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(result.files, [
      "1-one--dark.png",
      "1-one--light.png",
      "2-two--dark.png",
      "2-two--light.png",
    ]);
    assert.equal(result.log[0], "start");
    assert.equal(result.log.at(-1), "stop");
    assert.deepEqual(lifecycle(result.log), ["start", "stop"]);
    // Each capture's page, under the origin's base path, in light then dark.
    const pages = result.log.filter((line) => line.startsWith("GET /app/"));
    assert.deepEqual(pages, [
      "GET /app/one.html",
      "GET /app/one.html",
      "GET /app/two.html",
      "GET /app/two.html",
    ]);
  });

  test("that rejects fails the run, naming its error, and has nothing to stop", async () => {
    const result = await run([], { mode: "reject" });
    assert.equal(result.code, 1);
    assert.match(
      result.stderr,
      /the description's server didn't start: the fixture server refuses to start/,
    );
    assert.deepEqual(result.log, ["start"]);
    assert.deepEqual(result.files, []);
  });

  test("is stopped once when the run fails mid-run", async () => {
    const result = await run([], { mode: "fail" });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /the one page's open step fails/);
    assert.deepEqual(lifecycle(result.log), ["start", "stop"]);
    assert.equal(result.log.at(-1), "stop");
  });

  for (const [signal, code] of [
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ] as const) {
    test(`is stopped once on ${signal}, which exits ${code}`, async () => {
      const result = await run([], { mode: "hang", signal });
      assert.equal(result.code, code, result.stderr);
      assert.deepEqual(lifecycle(result.log), ["start", "stop"]);
      assert.equal(result.log.at(-1), "stop");
    });
  }

  test("isn't called by --help or a usage error, which start nothing", async () => {
    for (const args of [["--help"], ["-h", "--bogus"], ["--bogus"], ["--page", "nope"]]) {
      const result = await run(args, { unlaunched: true });
      assert.equal(
        result.code,
        args.some((arg) => /^-(h|-help)$/.test(arg)) ? 0 : 2,
        args.join(" "),
      );
      assert.deepEqual(result.log, [], args.join(" "));
    }
  });
});
