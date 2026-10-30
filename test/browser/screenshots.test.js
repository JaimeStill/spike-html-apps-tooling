// The screenshot bin at its seam, a command line: the package's bin, spawned as a child process as
// a consumer's task runs it, over the fixture description and its pages, which the package's own
// server serves. Each case reads the exit code, stdout and stderr, the files written, and each
// PNG's header for its size, and the reports the fixture pages post as the bin drives them.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";

const root = join(import.meta.dirname, "../..");
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const bin = join(root, manifest.bin["spike-html-apps-screenshots"]);
const description = join(import.meta.dirname, "fixtures/screenshots/description.js");

/** @type {string[]} */
const scratches = [];
after(() => {
  for (const scratch of scratches) rmSync(scratch, { recursive: true, force: true });
});

/** A new temporary directory, removed after the run. */
function scratchDir() {
  const scratch = mkdtempSync(join(tmpdir(), "screenshots-test."));
  scratches.push(scratch);
  return scratch;
}

/**
 * @typedef {{ kind: string, page: string, id: string, focusVisible: boolean,
 *   attributes: Record<string, string>, dark: boolean, updated: boolean }} Report
 */

/**
 * Runs the bin over the fixture description and the arguments, resolving to its exit code, its
 * output, and the reports its pages posted.
 * @param {string[]} args
 * @param {{ env?: Record<string, string | undefined>, describe?: boolean }} [options]
 * @returns {Promise<{ code: number | null, stdout: string, stderr: string, reports: Report[] }>}
 */
function run(args, { env = {}, describe = true } = {}) {
  const log = join(scratchDir(), "log.jsonl");
  /** @type {Record<string, string | undefined>} */
  const childEnv = { ...process.env, SCREENSHOTS_LOG: log, ...env };
  for (const [name, value] of Object.entries(childEnv)) {
    if (value === undefined) delete childEnv[name];
  }
  const child = spawn(bin, describe ? [description, ...args] : args, {
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
  child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => {
      const lines = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [];
      resolve({ code, stdout, stderr, reports: lines.filter(Boolean).map((l) => JSON.parse(l)) });
    });
  });
}

/**
 * The PNG's size from its header, asserting the PNG signature and that IHDR comes first.
 * @param {string} path
 */
function png(path) {
  const bytes = readFileSync(path);
  assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(bytes.toString("latin1", 12, 16), "IHDR", path);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/**
 * The stdout the directory output prints for the files, each `caption\n  path`.
 * @param {string} dir
 * @param {[string, string][]} shots Each file's name and caption.
 */
const printed = (dir, shots) =>
  shots.map(([name, caption]) => `${caption}\n  ${join(dir, name)}\n`).join("");

const DEFAULT = "flexoki-regular-mono";
const DEFAULT_CAPTION = "flexoki, regular, mono";

describe("no flags", () => {
  /** @type {string} */
  let dir;
  /** @type {Awaited<ReturnType<typeof run>>} */
  let result;
  before(async () => {
    // Two levels the bin makes.
    dir = join(scratchDir(), "made", "here");
    result = await run(["--dir", dir]);
  });

  /** Each capture's file and caption, in the order captured. */
  const shots = /** @type {[string, string][]} */ (
    ["light", "dark"].flatMap((scheme) =>
      [1, 2, 3, 4].map((k) => [
        `1-long--${DEFAULT}-${scheme}--${k}of4.png`,
        `the long page: ${DEFAULT_CAPTION}, ${scheme} (${k} of 4)`,
      ]),
    )
  ).concat(
    ["light", "dark"].map((scheme) => [
      `2-focus--${DEFAULT}-${scheme}.png`,
      `the focus page: ${DEFAULT_CAPTION}, ${scheme}`,
    ]),
    ["light", "dark"].map((scheme) => [
      `3-narrow-open--${DEFAULT}-${scheme}.png`,
      `the narrow page, opened: ${DEFAULT_CAPTION}, ${scheme}`,
    ]),
  );

  test("captures every page, both schemes, at the default profile, printing each", () => {
    assert.equal(result.stderr, "");
    assert.equal(result.code, 0);
    assert.equal(result.stdout, printed(dir, shots));
    assert.deepEqual(readdirSync(dir).sort(), shots.map(([name]) => name).sort());
  });

  test("a full page is 1280 wide, its tiles cut at a section's top, then a state's", () => {
    for (const scheme of ["light", "dark"]) {
      const heights = [1, 2, 3, 4].map((k) => {
        const size = png(join(dir, `1-long--${DEFAULT}-${scheme}--${k}of4.png`));
        assert.equal(size.width, 1280);
        return size.height;
      });
      // 1000: the section at 1000, within the last quarter, over the lower state at 1100; 800:
      // the state at 1800, within the last half; 1200: no boundary within reach; 400: the rest.
      assert.deepEqual(heights, [1000, 800, 1200, 400]);
    }
    // A page shorter than the viewport is one tile, the viewport's height.
    assert.deepEqual(png(join(dir, `2-focus--${DEFAULT}-light.png`)), { width: 1280, height: 800 });
  });

  test("a viewport state is captured at its own size", () => {
    for (const scheme of ["light", "dark"]) {
      assert.deepEqual(png(join(dir, `3-narrow-open--${DEFAULT}-${scheme}.png`)), {
        width: 390,
        height: 300,
      });
    }
  });

  test("focus is reached by real Tab presses from the focus-start mark", () => {
    const focus = result.reports.filter(({ kind }) => kind === "focus");
    // One capture per scheme: the mark, then two presses to b2, each focus-visible.
    assert.deepEqual(
      focus.map(({ page, id, focusVisible }) => [page, id, id === "start" || focusVisible]),
      ["light", "dark"].flatMap(() => [
        ["/focus.html", "start", true],
        ["/focus.html", "b1", true],
        ["/focus.html", "b2", true],
      ]),
    );
    // Only after every custom element has finished updating.
    assert.ok(focus.every(({ updated }) => updated));
  });

  test("prepare runs before the root's attributes are set, open after", () => {
    const prepared = result.reports.filter(({ kind }) => kind === "prepare");
    assert.equal(prepared.length, 6);
    assert.ok(prepared.every(({ attributes }) => !("data-scheme" in attributes)));
    const opened = result.reports.filter(({ kind }) => kind === "open");
    assert.deepEqual(
      opened.map(({ page, attributes, dark }) => [page, attributes, dark]),
      ["light", "dark"].map((scheme) => [
        "/narrow.html",
        {
          "data-palette": "flexoki",
          "data-space": "regular",
          "data-type": "mono",
          "data-scheme": scheme,
        },
        scheme === "dark",
      ]),
    );
  });
});

describe("the flags", () => {
  test("a facet flag sets that facet over the defaults", async () => {
    const dir = scratchDir();
    const result = await run([
      "--type",
      "sans",
      "--page",
      "focus",
      "--scheme",
      "dark",
      "--dir",
      dir,
    ]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(
      result.stdout,
      printed(dir, [
        ["2-focus--flexoki-regular-sans-dark.png", "the focus page: flexoki, regular, sans, dark"],
      ]),
    );
    assert.deepEqual(readdirSync(dir), ["2-focus--flexoki-regular-sans-dark.png"]);
    const [focus] = result.reports.filter(({ kind }) => kind === "focus");
    assert.deepEqual(focus.attributes, {
      "data-palette": "flexoki",
      "data-space": "regular",
      "data-type": "sans",
      "data-scheme": "dark",
    });
    assert.equal(focus.dark, true);
  });

  test("the facet flags combine", async () => {
    const dir = scratchDir();
    const args = ["--palette", "noctis", "--space", "compact", "--type", "sans"];
    const result = await run([...args, "--page", "focus", "--scheme", "light", "--dir", dir]);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(readdirSync(dir), ["2-focus--noctis-compact-sans-light.png"]);
    assert.match(result.stdout, /^the focus page: noctis, compact, sans, light\n/);
    const [focus] = result.reports.filter(({ kind }) => kind === "focus");
    assert.deepEqual(focus.attributes, {
      "data-palette": "noctis",
      "data-space": "compact",
      "data-type": "sans",
      "data-scheme": "light",
    });
    assert.equal(focus.dark, false);
  });

  test("--all captures the description's matrix, each over the defaults", async () => {
    const dir = scratchDir();
    const result = await run(["--all", "--page", "focus", "--scheme", "light", "--dir", dir]);
    assert.equal(result.code, 0, result.stderr);
    const profiles = [
      "flexoki-regular-mono",
      "noctis-regular-mono",
      "flexoki-compact-mono",
      "flexoki-regular-sans",
    ];
    assert.equal(
      result.stdout,
      printed(
        dir,
        profiles.map((profile) => [
          `2-focus--${profile}-light.png`,
          `the focus page: ${profile.split("-").join(", ")}, light`,
        ]),
      ),
    );
  });

  test("--page, repeated, captures the pages named in the description's order, one scheme", async () => {
    const dir = scratchDir();
    const result = await run([
      "--page",
      "narrow",
      "--page",
      "focus",
      "--scheme",
      "dark",
      "--dir",
      dir,
    ]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(
      result.stdout,
      printed(dir, [
        [`2-focus--${DEFAULT}-dark.png`, `the focus page: ${DEFAULT_CAPTION}, dark`],
        [`3-narrow-open--${DEFAULT}-dark.png`, `the narrow page, opened: ${DEFAULT_CAPTION}, dark`],
      ]),
    );
    assert.deepEqual(readdirSync(dir).sort(), [
      `2-focus--${DEFAULT}-dark.png`,
      `3-narrow-open--${DEFAULT}-dark.png`,
    ]);
  });

  test("with no --dir, the files go to a fresh screenshots.XXXXXX under TMPDIR, kept", async () => {
    const temp = scratchDir();
    const result = await run(["--page", "focus", "--scheme", "light"], { env: { TMPDIR: temp } });
    assert.equal(result.code, 0, result.stderr);
    const made = readdirSync(temp);
    assert.equal(made.length, 1);
    assert.match(made[0], /^screenshots\.[A-Za-z0-9]{6}$/);
    const dir = join(temp, made[0]);
    assert.deepEqual(readdirSync(dir), [`2-focus--${DEFAULT}-light.png`]);
    assert.equal(
      result.stdout,
      printed(dir, [
        [`2-focus--${DEFAULT}-light.png`, `the focus page: ${DEFAULT_CAPTION}, light`],
      ]),
    );
  });

  test("a profile registered once the page has rendered is accepted", async () => {
    const dir = scratchDir();
    const result = await run([
      "--palette",
      "extra",
      "--page",
      "focus",
      "--scheme",
      "light",
      "--dir",
      dir,
    ]);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(readdirSync(dir), ["2-focus--extra-regular-mono-light.png"]);
  });
});

describe("exit 2", () => {
  // No browser: each of these exits before the browser launches, which would fail without one.
  const unlaunched = { env: { BROWSER_EXECUTABLE: undefined } };
  const usage =
    "usage: spike-html-apps-screenshots <description> [--all | [--palette <name>] [--space <name>] [--type <name>]] [--page <name>]... [--scheme light|dark] [--output terminal|directory|browser] [--dir <path>] [--keep]\n";

  test("a usage error prints the usage", async () => {
    for (const args of [
      ["--bogus"],
      ["--palette"],
      ["extra-positional"],
      ["--scheme", "blue"],
      ["--scheme", "light", "--scheme", "dark"],
      ["--output", "printer"],
    ]) {
      const result = await run(args, unlaunched);
      assert.equal(result.code, 2, args.join(" "));
      assert.ok(result.stderr.endsWith(usage), `${args.join(" ")}: ${result.stderr}`);
      assert.equal(result.stdout, "");
    }
    const bare = await run([], { ...unlaunched, describe: false });
    assert.equal(bare.code, 2);
    assert.match(bare.stderr, /^usage: spike-html-apps-screenshots <description> \[--all\]/);
  });

  test("--all with a facet flag", async () => {
    const result = await run(["--all", "--space", "compact"], unlaunched);
    assert.equal(result.code, 2);
    assert.equal(result.stderr, `spike-html-apps-screenshots: --all takes no facet flag\n${usage}`);
  });

  test("an unknown page lists the pages, before launch", async () => {
    const dir = join(scratchDir(), "out");
    const result = await run(["--page", "focus", "--page", "nope", "--dir", dir], unlaunched);
    assert.equal(result.code, 2);
    assert.equal(
      result.stderr,
      "spike-html-apps-screenshots: unknown page nope; the pages: long, focus, narrow\n",
    );
    assert.equal(existsSync(dir), false);
  });

  test("an unregistered profile names the facet's registered names, after load, before any capture", async () => {
    const dir = join(scratchDir(), "out");
    // focus.html registers extra once it renders; narrow.html, read after it, never does.
    const args = ["--palette", "extra", "--page", "focus", "--page", "narrow", "--dir", dir];
    const result = await run(args);
    assert.equal(result.code, 2);
    assert.equal(
      result.stderr,
      "spike-html-apps-screenshots: unknown palette extra; the palettes narrow.html registers: flexoki, noctis\n",
    );
    assert.equal(result.stdout, "");
    assert.equal(existsSync(dir), false);
    // It is checked in the browser: with none, the launch fails first.
    const unlaunchedResult = await run(args, unlaunched);
    assert.equal(unlaunchedResult.code, 1);
    assert.match(unlaunchedResult.stderr, /BROWSER_EXECUTABLE names no browser/);
  });
});

test("--output terminal and browser are not yet implemented", async () => {
  for (const output of ["terminal", "browser"]) {
    const result = await run(["--output", output], { env: { BROWSER_EXECUTABLE: undefined } });
    assert.equal(result.code, 1);
    assert.equal(
      result.stderr,
      `spike-html-apps-screenshots: --output ${output} is not yet implemented; use --output directory\n`,
    );
  }
});
