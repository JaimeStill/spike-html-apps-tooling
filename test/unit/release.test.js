// The release's integrity: a pnpm pack of the repository, extracted, against the sources, the
// manifest's install fields, and its license, by release.js's releaseProblems, as it stands and in
// scratch copies with one fault each.
// Adapted from spike-html-apps-foundation (9c15b8d): test/unit/release.test.js, with no build and
// no budget.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { always, listFiles, releaseProblems } from "./release.js";

const root = join(import.meta.dirname, "../..");
const src = join(root, "src");
/** @type {string[]} */
const scratches = [];

/** A new temporary directory, removed after the run. */
function scratchDir() {
  const scratch = mkdtempSync(join(tmpdir(), "release-"));
  scratches.push(scratch);
  return scratch;
}

// The pack under test: pnpm pack's tarball, extracted, its package/ directory.
/** @type {string} */
let pack;
before(() => {
  const scratch = scratchDir();
  execFileSync("pnpm", ["pack", "--pack-destination", scratch], { cwd: root, stdio: "ignore" });
  const [tarball] = listFiles(scratch);
  execFileSync("tar", ["-xzf", join(scratch, tarball), "-C", scratch]);
  pack = join(scratch, "package");
});
after(() => {
  for (const scratch of scratches) rmSync(scratch, { recursive: true, force: true });
});

/**
 * A scratch copy of the pack, `change` applied to it and its manifest, and its problems.
 * @param {(dir: string, manifest: Record<string, unknown>) => void} change
 */
function faulted(change) {
  const copy = join(scratchDir(), "package");
  cpSync(pack, copy, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(copy, "package.json"), "utf8"));
  change(copy, manifest);
  writeFileSync(join(copy, "package.json"), JSON.stringify(manifest));
  return releaseProblems(copy, src);
}

/** @param {string} path */
const remove = (path) => (/** @type {string} */ dir) => rmSync(join(dir, path));

describe("release pack", () => {
  test("the pack is package.json, README.md, LICENSE, and the sources", () => {
    const sources = listFiles(src).map((path) => `src/${path}`);
    assert.deepEqual(listFiles(pack), [...sources, ...always].sort());
  });

  test("the pack is the release its manifest declares", () => {
    assert.deepEqual(releaseProblems(pack, src), []);
  });

  /** @type {Record<string, [(dir: string, manifest: Record<string, unknown>) => void, string]>} */
  const faults = {
    "a manifest with scripts": [
      (_, manifest) => (manifest.scripts = { prepare: "tsc" }),
      "package.json has a scripts field",
    ],
    "a runtime dependency": [
      (_, manifest) => (manifest.dependencies = { ws: "8.0.0" }),
      "package.json has a dependencies field",
    ],
    "a peer dependency": [
      (_, manifest) => (manifest.peerDependencies = { ws: "8.0.0" }),
      "package.json has a peerDependencies field",
    ],
    "a stray file in the pack": [
      (dir) => writeFileSync(join(dir, "notes.md"), ""),
      "notes.md is packed but isn't a source, LICENSE, README.md, package.json",
    ],
    "a built file in the pack": [
      (dir) => {
        mkdirSync(join(dir, "dist"));
        writeFileSync(join(dir, "dist/index.js"), "");
      },
      "dist/index.js is packed but isn't a source, LICENSE, README.md, package.json",
    ],
    "a pack without its README": [remove("README.md"), "the pack has no README.md"],
    "a pack without its LICENSE": [remove("LICENSE"), "LICENSE is missing"],
    "a LICENSE that isn't Apache 2.0": [
      (dir) => writeFileSync(join(dir, "LICENSE"), "All rights reserved.\n"),
      "LICENSE isn't the Apache License 2.0",
    ],
    "a package that declares another license": [
      (_, manifest) => (manifest.license = "MIT"),
      "package.json declares license MIT, not Apache-2.0",
    ],
  };
  for (const [fault, [change, problem]] of Object.entries(faults)) {
    test(`fails on ${fault}`, () => {
      const problems = faulted(change);
      assert.ok(problems.includes(problem), `expected: ${problem}\ngot: ${problems.join("\n")}`);
    });
  }

  test("fails on a source the pack leaves out", () => {
    const sources = join(scratchDir(), "src");
    mkdirSync(sources);
    writeFileSync(join(sources, "left-out.js"), "");
    assert.ok(releaseProblems(pack, sources).includes("src/left-out.js isn't packed"));
  });
});
