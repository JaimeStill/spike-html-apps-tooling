// The screenshot bin at its seam, a command line: the package's bin, spawned as a child process as
// a consumer's task runs it, over the fixture description and its pages, which the package's own
// server serves. Each case reads the exit code, stdout and stderr, the files written, and each
// PNG's header for its size, and the reports the fixture pages post as the bin drives them. The
// commands the outputs run, kitten, kitty, and xdg-open, are the fixture stub, linked into a PATH
// of the case's own; the cases where stdout is a terminal run the bin under a pty, by util-linux's
// script, so the terminal output's checks, and icat's calls, are the real ones.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, describe, test } from "node:test";

const root = join(import.meta.dirname, "../..");
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const bin = join(root, manifest.bin["spike-html-apps-screenshots"]);
const description = join(import.meta.dirname, "fixtures/screenshots/description.js");
const stub = join(import.meta.dirname, "fixtures/screenshots/stub.js");

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
 * output, and the reports its pages posted. Its stdout is a pipe, not a terminal, and it runs
 * outside any Neovim terminal the tests run in. With interrupt, the bin is sent SIGINT as soon as
 * it prints.
 * @param {string[]} args
 * @param {{ env?: Record<string, string | undefined>, describe?: boolean, interrupt?: boolean }} [options]
 * @returns {Promise<{ code: number | null, signal: NodeJS.Signals | null, stdout: string,
 *   stderr: string, reports: Report[] }>}
 */
function run(args, { env = {}, describe = true, interrupt = false } = {}) {
  const log = join(scratchDir(), "log.jsonl");
  /** @type {Record<string, string | undefined>} */
  const childEnv = { ...process.env, NVIM: undefined, SCREENSHOTS_LOG: log, ...env };
  for (const [name, value] of Object.entries(childEnv)) {
    if (value === undefined) delete childEnv[name];
  }
  const child = spawn(bin, describe ? [description, ...args] : args, {
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => {
    stdout += chunk;
    if (interrupt) child.kill("SIGINT");
  });
  child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      const lines = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [];
      const reports = lines.filter(Boolean).map((l) => JSON.parse(l));
      resolve({ code, signal, stdout, stderr, reports });
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

/** The directory output's flag, which the cases that read the files a run keeps take. */
const DIRECTORY = ["--output", "directory"];

const DEFAULT = "dawn-wide-plain";
const DEFAULT_CAPTION = "dawn, wide, plain";

describe("every page, by default, to a directory", () => {
  /** @type {string} */
  let dir;
  /** @type {Awaited<ReturnType<typeof run>>} */
  let result;
  before(async () => {
    // Two levels the bin makes.
    dir = join(scratchDir(), "made", "here");
    result = await run([...DIRECTORY, "--dir", dir]);
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
          "data-palette": "dawn",
          "data-space": "wide",
          "data-type": "plain",
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
      ...DIRECTORY,
      "--type",
      "fancy",
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
        ["2-focus--dawn-wide-fancy-dark.png", "the focus page: dawn, wide, fancy, dark"],
      ]),
    );
    assert.deepEqual(readdirSync(dir), ["2-focus--dawn-wide-fancy-dark.png"]);
    const [focus] = result.reports.filter(({ kind }) => kind === "focus");
    assert.deepEqual(focus.attributes, {
      "data-palette": "dawn",
      "data-space": "wide",
      "data-type": "fancy",
      "data-scheme": "dark",
    });
    assert.equal(focus.dark, true);
  });

  test("the facet flags combine", async () => {
    const dir = scratchDir();
    const args = ["--palette", "dusk", "--space", "tight", "--type", "fancy"];
    const result = await run([
      ...DIRECTORY,
      ...args,
      "--page",
      "focus",
      "--scheme",
      "light",
      "--dir",
      dir,
    ]);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(readdirSync(dir), ["2-focus--dusk-tight-fancy-light.png"]);
    assert.match(result.stdout, /^the focus page: dusk, tight, fancy, light\n/);
    const [focus] = result.reports.filter(({ kind }) => kind === "focus");
    assert.deepEqual(focus.attributes, {
      "data-palette": "dusk",
      "data-space": "tight",
      "data-type": "fancy",
      "data-scheme": "light",
    });
    assert.equal(focus.dark, false);
  });

  test("--all captures the description's matrix, each over the defaults", async () => {
    const dir = scratchDir();
    const result = await run([
      ...DIRECTORY,
      "--all",
      "--page",
      "focus",
      "--scheme",
      "light",
      "--dir",
      dir,
    ]);
    assert.equal(result.code, 0, result.stderr);
    const profiles = ["dawn-wide-plain", "dusk-wide-plain", "dawn-tight-plain", "dawn-wide-fancy"];
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
      ...DIRECTORY,
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
    const result = await run([...DIRECTORY, "--page", "focus", "--scheme", "light"], {
      env: { TMPDIR: temp },
    });
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
      ...DIRECTORY,
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
    assert.deepEqual(readdirSync(dir), ["2-focus--extra-wide-plain-light.png"]);
  });
});

describe("exit 2", () => {
  // No browser: each of these exits before the browser launches, which would fail without one.
  const unlaunched = { env: { BROWSER_EXECUTABLE: undefined } };
  const usage =
    "usage: spike-html-apps-screenshots <description> [--all | [--palette <name>] [--space <name>] [--type <name>]] [--page <name>]... [--scheme light|dark] [--output terminal|directory|browser] [--dir <path>] [--keep] [-h | --help]\n";

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
    assert.match(
      bare.stderr,
      /^usage: spike-html-apps-screenshots <description> \[--all\] .* \[-h \| --help\]\n$/,
    );
  });

  test("--all with a facet flag", async () => {
    const result = await run(["--all", "--space", "tight"], unlaunched);
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
      "spike-html-apps-screenshots: unknown palette extra; the palettes narrow.html registers: dawn, dusk\n",
    );
    assert.equal(result.stdout, "");
    assert.equal(existsSync(dir), false);
    // It is checked in the browser: with none, the launch fails first.
    const unlaunchedResult = await run(args, unlaunched);
    assert.equal(unlaunchedResult.code, 1);
    assert.match(unlaunchedResult.stderr, /BROWSER_EXECUTABLE names no browser/);
  });
});

describe("--help", () => {
  // No browser and an empty TMPDIR: the help prints before the browser launches, which would fail
  // without one, and before any file is written.
  /** @param {string} temp */
  const unlaunched = (temp) => ({ env: { BROWSER_EXECUTABLE: undefined, TMPDIR: temp } });
  const usage =
    "usage: spike-html-apps-screenshots <description> [--all | [--palette <name>] [--space <name>] [--type <name>]] [--page <name>]... [--scheme light|dark] [--output terminal|directory|browser] [--dir <path>] [--keep] [-h | --help]\n";
  /** The help's sections, by heading, each its lines below the heading. @param {string} stdout */
  const sections = (stdout) =>
    Object.fromEntries(
      stdout
        .replace(/\n$/, "")
        .split("\n\n")
        .map((part) => part.split("\n"))
        .filter(([heading]) => heading.endsWith(":"))
        .map(([heading, ...lines]) => [heading, lines]),
    );
  /** The flag rows, the same with or without a description. */
  const FLAGS = [
    "--<facet>",
    "--all",
    "--page",
    "--scheme",
    "--output",
    "--dir",
    "--keep",
    "-h, --help",
  ];
  /** The sections after the description's, the same with or without one. @param {Record<string, string[]>} found */
  const assertCommon = (found) => {
    assert.deepEqual(
      found["flags:"].map((line) => FLAGS.find((flag) => line.startsWith(`  ${flag}`))),
      FLAGS,
    );
    assert.deepEqual(
      found["schemes:"].map((line) => line.trim().split(" ")[0]),
      ["light", "dark"],
    );
    assert.deepEqual(
      found["outputs:"].map((line) => line.trim().split(" ")[0]),
      ["terminal", "directory", "browser"],
    );
    assert.match(found["outputs:"][0], /^ {2}terminal {3}the default: /);
    assert.deepEqual(
      found["exit codes:"].map((line) => line.trim().split(" ")[0]),
      ["0", "1", "2"],
    );
  };

  test("over the description: the usage, the flags, its pages and facets, before launch", async () => {
    const temp = scratchDir();
    const result = await run(["--help"], unlaunched(temp));
    assert.equal(result.stderr, "");
    assert.equal(result.code, 0);
    assert.ok(result.stdout.startsWith(usage), result.stdout);
    const found = sections(result.stdout);
    assert.deepEqual(found["pages:"], [
      "  long    the long page",
      "  focus   the focus page",
      "  narrow  the narrow page",
    ]);
    // Each facet's default, then the names the fixture's all gives its flag: dawn twice, dusk;
    // tight; fancy.
    assert.deepEqual(found["facets:"], [
      "  --palette <name>  sets data-palette; default dawn; names: dawn, dusk",
      "  --space <name>    sets data-space; default wide; names: wide, tight",
      "  --type <name>     sets data-type; default plain; names: plain, fancy",
      "  A facet's names are its default and those the description's --all profiles give.",
      "  A run still checks each name it is given against each page's registered names.",
    ]);
    assertCommon(found);
    assert.deepEqual(readdirSync(temp), []);
  });

  test("wins over the other flags, -h as well, a bad one included", async () => {
    const temp = scratchDir();
    const dir = join(temp, "out");
    const help = await run(["--help"], unlaunched(temp));
    for (const args of [
      ["--page", "focus", "--dir", dir, "--help"],
      ["--bogus", "--page", "nope", "--dir", dir, "-h"],
      ["--all", "--palette", "dusk", "--help"],
    ]) {
      const result = await run(args, unlaunched(temp));
      assert.equal(result.code, 0, args.join(" "));
      assert.equal(result.stderr, "", args.join(" "));
      assert.equal(result.stdout, help.stdout, args.join(" "));
    }
    assert.deepEqual(readdirSync(temp), []);
  });

  test("with no description: the general usage and flags, no pages or facets", async () => {
    const temp = scratchDir();
    for (const args of [["--help"], ["-h", "--page", "focus"]]) {
      const result = await run(args, { ...unlaunched(temp), describe: false });
      assert.equal(result.code, 0, args.join(" "));
      assert.equal(result.stderr, "");
      assert.match(
        result.stdout,
        /^usage: spike-html-apps-screenshots <description> \[--all\] \[--page <name>\]/,
      );
      const found = sections(result.stdout);
      assert.equal(found["pages:"], undefined);
      assert.equal(found["facets:"], undefined);
      assert.match(
        result.stdout,
        /\nspike-html-apps-screenshots <description> --help also lists the description's pages and facets\.\n/,
      );
      assertCommon(found);
    }
    assert.deepEqual(readdirSync(temp), []);
  });

  test("a facet can't take the flag --help, with --help or without", async () => {
    const scratch = scratchDir();
    /** A description module whose one facet takes the flag, its path. @param {string} flag */
    const module = (flag) => {
      const path = join(scratch, `${flag}.js`);
      writeFileSync(
        path,
        `export default { pages: [{ name: "a", caption: "the a page", path: "a.html" }], ` +
          `facets: [{ flag: ${JSON.stringify(flag)}, attribute: "data-x", default: "x" }] };\n`,
      );
      return path;
    };
    const refused = module("help");
    for (const args of [[refused], [refused, "--help"]]) {
      const result = await run(args, { ...unlaunched(scratchDir()), describe: false });
      assert.equal(result.code, 1, args.join(" "));
      assert.match(result.stderr, /help\.js: a facet can't take the flag --help/);
      assert.equal(result.stdout, "");
    }
    // The same module with another flag is taken.
    const taken = await run([module("helper"), "--help"], {
      ...unlaunched(scratchDir()),
      describe: false,
    });
    assert.equal(taken.code, 0, taken.stderr);
    assert.match(taken.stdout, /\n {2}--helper <name> {2}sets data-x; default x; names: x\n/);
  });
  test("a .ts description, its types erasable, loads", async () => {
    const path = join(scratchDir(), "description.ts");
    writeFileSync(
      path,
      `import type { Description } from "@jaimestill/spike-html-apps-tooling/screenshots.js";\n` +
        `const description: Description = {\n` +
        `  pages: [{ name: "typed", caption: "the typed page", path: "typed.html" }],\n` +
        `};\n` +
        `export default description;\n`,
    );
    const result = await run([path, "--help"], {
      ...unlaunched(scratchDir()),
      describe: false,
    });
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(sections(result.stdout)["pages:"], ["  typed  the typed page"]);
  });
});

/**
 * @typedef {{ name: string, args: string[], terminal: boolean, tty: boolean }} Call
 */

/**
 * A PATH holding the fixture stub under each name, and node's directory, so the bin runs, and
 * nothing else: no real kitten, kitty, or xdg-open. The env gives it, and the stubs' log, which
 * calls() reads.
 * @param {string[]} names
 * @param {Record<string, number>} [statuses] The stubs' exit statuses, as STUB_EXIT takes them.
 */
function stubbed(names, statuses = {}) {
  const dir = scratchDir();
  for (const name of names) symlinkSync(stub, join(dir, name));
  const log = join(dir, "calls.jsonl");
  return {
    env: {
      PATH: [dir, dirname(process.execPath)].join(delimiter),
      STUB_LOG: log,
      STUB_EXIT: JSON.stringify(statuses),
    },
    /** @returns {Call[]} Each stub's call, in order. */
    calls: () =>
      existsSync(log)
        ? readFileSync(log, "utf8")
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line))
        : [],
  };
}

/** The command's path on the test's own PATH, before a case's PATH replaces it. @param {string} name */
function which(name) {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (existsSync(join(dir, name))) return join(dir, name);
  }
  throw new Error(`${name} is not on PATH`);
}

/** Quotes the word for the shell. @param {string} word */
const quote = (word) => `'${word.replaceAll("'", `'\\''`)}'`;

/**
 * Runs the bin over the fixture description and the arguments under a pty, by script, so its
 * stdout is a terminal and /dev/tty opens; with setsid, in a new session, where /dev/tty doesn't.
 * Its stderr goes to a file of its own, so it reads apart from stdout.
 * @param {string[]} args
 * @param {{ env: Record<string, string>, setsid?: boolean }} options
 */
function runInPty(args, { env, setsid = false }) {
  const stderrFile = join(scratchDir(), "stderr");
  const command = [
    ...Object.entries(env).map(([name, value]) => `${name}=${quote(value)}`),
    "exec",
    ...(setsid ? [quote(which("setsid")), "-w"] : []),
    ...[bin, description, ...args].map(quote),
    `2>${quote(stderrFile)}`,
  ].join(" ");
  const childEnv = { ...process.env };
  delete childEnv.NVIM;
  const child = spawn("script", ["-qec", command, "/dev/null"], {
    env: childEnv,
    stdio: ["ignore", "pipe", "inherit"],
  });
  let stdout = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
  return /** @type {Promise<{ code: number | null, stdout: string, stderr: string }>} */ (
    new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) =>
        resolve({
          code,
          stdout: stdout.replaceAll("\r\n", "\n"),
          stderr: readFileSync(stderrFile, "utf8"),
        }),
      );
    })
  );
}

/** The focus and narrow pages' files and captions, each scheme, in the order captured. */
const TWO_PAGES = /** @type {[string, string][]} */ ([
  [`2-focus--${DEFAULT}-light.png`, `the focus page: ${DEFAULT_CAPTION}, light`],
  [`2-focus--${DEFAULT}-dark.png`, `the focus page: ${DEFAULT_CAPTION}, dark`],
  [`3-narrow-open--${DEFAULT}-light.png`, `the narrow page, opened: ${DEFAULT_CAPTION}, light`],
  [`3-narrow-open--${DEFAULT}-dark.png`, `the narrow page, opened: ${DEFAULT_CAPTION}, dark`],
]);
const TWO_PAGE_ARGS = ["--page", "focus", "--page", "narrow"];

/** The terminal output's stderr line when it shows no images, for the reason. */
const fallback = (/** @type {string} */ reason) =>
  `spike-html-apps-screenshots: no images shown: ${reason}; --output browser shows them in a browser\n`;

/** The icat call for each image, as the stub records it, after its command's own words. */
const ICAT = ["--transfer-mode=stream", "--align=left", "--fit=both"];

describe("--output terminal", () => {
  test("is the default; with stdout not a terminal, it prints, says why, calls no icat, and removes its files", async () => {
    const dir = join(scratchDir(), "made");
    const stubs = stubbed(["kitten", "kitty", "xdg-open"]);
    const result = await run([...TWO_PAGE_ARGS, "--dir", dir], { env: stubs.env });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, printed(dir, TWO_PAGES));
    assert.equal(result.stderr, fallback("stdout is not a terminal"));
    assert.deepEqual(stubs.calls(), []);
    assert.equal(existsSync(dir), false);
  });

  test("--keep keeps the files and prints their directory", async () => {
    const dir = join(scratchDir(), "made");
    const stubs = stubbed(["kitten"]);
    const result = await run(["--output", "terminal", ...TWO_PAGE_ARGS, "--dir", dir, "--keep"], {
      env: stubs.env,
    });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, `${printed(dir, TWO_PAGES)}kept in ${dir}\n`);
    assert.deepEqual(readdirSync(dir).sort(), TWO_PAGES.map(([name]) => name).sort());
  });

  test("inside a Neovim terminal, the reason names it", async () => {
    const stubs = stubbed(["kitten"]);
    const env = { ...stubs.env, NVIM: "/run/user/1000/nvim.1.0" };
    const result = await run(["--page", "focus", "--scheme", "light"], { env });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(
      result.stderr,
      fallback("inside a Neovim :terminal (no pixel size, graphics not passed through)"),
    );
    assert.deepEqual(stubs.calls(), []);
  });

  test("in a terminal icat supports, each image is shown by kitten icat, in order, after its caption", async () => {
    const dir = join(scratchDir(), "made");
    const stubs = stubbed(["kitten", "kitty"]);
    const result = await runInPty([...TWO_PAGE_ARGS, "--dir", dir], { env: stubs.env });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, printed(dir, TWO_PAGES));
    assert.deepEqual(stubs.calls(), [
      {
        name: "kitten",
        args: ["icat", "--detect-support", "--detection-timeout=3"],
        terminal: true,
        tty: true,
      },
      ...TWO_PAGES.map(([name]) => ({
        name: "kitten",
        args: ["icat", ...ICAT, join(dir, name)],
        terminal: true,
        tty: true,
      })),
    ]);
    assert.equal(existsSync(dir), false);
  });

  test("with no kitten, kitty +kitten icat shows them", async () => {
    const dir = join(scratchDir(), "made");
    const stubs = stubbed(["kitty"]);
    const result = await runInPty(["--page", "focus", "--dir", dir], { env: stubs.env });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(
      stubs.calls().map(({ name, args }) => [name, ...args]),
      [
        ["kitty", "+kitten", "icat", "--detect-support", "--detection-timeout=3"],
        ...TWO_PAGES.slice(0, 2).map(([name]) => [
          "kitty",
          "+kitten",
          "icat",
          ...ICAT,
          join(dir, name),
        ]),
      ],
    );
  });

  test("when icat's detection fails, it falls back", async () => {
    const dir = join(scratchDir(), "made");
    const stubs = stubbed(["kitten"], { detect: 1 });
    const result = await runInPty(["--page", "focus", "--dir", dir], { env: stubs.env });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stderr, fallback("kitten icat detection failed"));
    assert.equal(result.stdout, printed(dir, TWO_PAGES.slice(0, 2)));
    assert.deepEqual(
      stubs.calls().map(({ args }) => args),
      [["icat", "--detect-support", "--detection-timeout=3"]],
    );
    assert.equal(existsSync(dir), false);
  });

  test("with neither kitten nor kitty, it falls back", async () => {
    const stubs = stubbed(["xdg-open"]);
    const result = await runInPty(["--page", "focus", "--scheme", "light"], { env: stubs.env });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stderr, fallback("kitten not found"));
    assert.deepEqual(stubs.calls(), []);
  });

  test("with no controlling terminal, it falls back", async () => {
    const stubs = stubbed(["kitten"]);
    const result = await runInPty(["--page", "focus", "--scheme", "light"], {
      env: stubs.env,
      setsid: true,
    });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stderr, fallback("/dev/tty does not open"));
    assert.deepEqual(stubs.calls(), []);
  });

  test("--dir: it removes only what the run made, levels and files", async () => {
    const stubs = stubbed(["kitten"]);
    const there = scratchDir();
    writeFileSync(join(there, "other.txt"), "not the run's");
    const empty = join(scratchDir(), "empty");
    mkdirSync(empty);
    for (const dir of [join(there, "a", "b"), there, empty]) {
      const result = await run(["--page", "focus", "--dir", dir], { env: stubs.env });
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, new RegExp(`\n  ${dir}/2-focus--`));
    }
    assert.deepEqual(readdirSync(there), ["other.txt"]);
    assert.deepEqual(readdirSync(empty), []);
  });

  test("an error exit removes the files written before it", async () => {
    const dir = join(scratchDir(), "made");
    const stubs = stubbed(["kitten"]);
    const result = await run([...TWO_PAGE_ARGS, "--scheme", "light", "--dir", dir], {
      env: { ...stubs.env, SCREENSHOTS_FAIL: "open" },
    });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /the open step fails/);
    assert.equal(result.stdout, printed(dir, TWO_PAGES.slice(0, 1)));
    assert.equal(existsSync(dir), false);
  });

  test("SIGINT removes the files written before it", async () => {
    const dir = join(scratchDir(), "made");
    const stubs = stubbed(["kitten"]);
    const result = await run(["--page", "long", "--dir", dir], {
      env: stubs.env,
      interrupt: true,
    });
    assert.equal(result.code, 130);
    assert.match(result.stdout, /^the long page: /);
    assert.equal(existsSync(dir), false);
  });
});

describe("--output browser", () => {
  /** Each URL the gallery's attributes load, in the order they come. */
  const loads = (/** @type {string} */ html) =>
    [...html.matchAll(/\b(src|href|srcset|poster|data)=["']?([^"' >]*)/g)].map(([, , url]) => url);

  test("writes index.html beside the files, every tile in order under its caption, and opens it", async () => {
    const dir = join(scratchDir(), "made");
    const stubs = stubbed(["xdg-open", "kitten"]);
    const result = await run(["--output", "browser", ...TWO_PAGE_ARGS, "--dir", dir], {
      env: stubs.env,
    });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stderr, "");
    const page = join(dir, "index.html");
    assert.equal(result.stdout, `${printed(dir, TWO_PAGES)}the gallery\n  ${page}\n`);
    assert.deepEqual(
      stubs.calls().map(({ name, args }) => [name, ...args]),
      [["xdg-open", pathToFileURL(page).href]],
    );
    assert.deepEqual(
      readdirSync(dir).sort(),
      ["index.html", ...TWO_PAGES.map(([name]) => name)].sort(),
    );
    const html = readFileSync(page, "utf8");
    assert.deepEqual(
      loads(html),
      TWO_PAGES.map(([name]) => name),
    );
    assert.deepEqual(
      [...html.matchAll(/<figcaption>([^<]*)<\/figcaption>/g)].map(([, caption]) => caption),
      TWO_PAGES.map(([, caption]) => caption),
    );
    assert.doesNotMatch(html, /<script|<link|@import|url\(/);
  });

  test("a failed open prints the gallery's path and exits 1, the files kept", async () => {
    for (const stubs of [stubbed(["xdg-open"], { "xdg-open": 4 }), stubbed([])]) {
      const dir = join(scratchDir(), "made");
      const result = await run(["--output", "browser", "--page", "focus", "--dir", dir], {
        env: stubs.env,
      });
      assert.equal(result.code, 1);
      const page = join(dir, "index.html");
      assert.equal(
        result.stderr,
        `spike-html-apps-screenshots: xdg-open could not open the gallery; open ${page}\n`,
      );
      assert.equal(readdirSync(dir).length, 3);
    }
  });
});
