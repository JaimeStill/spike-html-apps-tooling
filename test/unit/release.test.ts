// The release's integrity: a pnpm pack of the build, extracted, against the sources, the
// manifest's install fields and bin, and its license, by release.ts's releaseProblems, as it stands
// and in scratch copies with one fault each. It packs the dist/ that mise run build writes.
// Adapted from spike-html-apps-foundation (9c15b8d): test/unit/release.test.js, in TypeScript,
// with no brotli budget, since nothing the package ships loads in a page.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { always, listFiles, releaseProblems } from "./release.ts";

const root = join(import.meta.dirname, "../..");
const src = join(root, "src");
const scratches: string[] = [];

/** A new temporary directory, removed after the run. */
function scratchDir(): string {
  const scratch = mkdtempSync(join(tmpdir(), "release-"));
  scratches.push(scratch);
  return scratch;
}

// The pack under test: pnpm pack's tarball, extracted, its package/ directory.
let pack: string;
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

/** A change to a scratch copy of the pack, its directory and its parsed manifest. */
type Change = (dir: string, manifest: Record<string, unknown>) => void;

/** A scratch copy of the pack, `change` applied to it and its manifest, and its problems. */
function faulted(change: Change): string[] {
  const copy = join(scratchDir(), "package");
  cpSync(pack, copy, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(copy, "package.json"), "utf8"));
  change(copy, manifest);
  writeFileSync(join(copy, "package.json"), JSON.stringify(manifest));
  return releaseProblems(copy, src);
}

/** The change that removes the file at `path`. */
const remove =
  (path: string): Change =>
  (dir) =>
    rmSync(join(dir, path));

describe("release pack", () => {
  test("the pack is package.json, README.md, LICENSE, and the build", () => {
    const built = listFiles(join(root, "dist")).map((path) => `dist/${path}`);
    assert.ok(built.length > 0, "mise run build wrote no dist/");
    assert.deepEqual(listFiles(pack), [...built, ...always].sort());
  });

  test("the pack is the release its manifest declares", () => {
    assert.deepEqual(releaseProblems(pack, src), []);
  });

  const faults: Record<string, [Change, string]> = {
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
      "notes.md is packed but isn't the build, LICENSE, README.md, package.json",
    ],
    "a source in the pack": [
      (dir) => {
        mkdirSync(join(dir, "src"));
        writeFileSync(join(dir, "src/server.ts"), "");
      },
      "src/server.ts is packed but isn't the build, LICENSE, README.md, package.json",
    ],
    "a stray built file": [
      (dir) => writeFileSync(join(dir, "dist/old.js"), ""),
      "dist/old.js is built from no source",
    ],
    "a .ts module with no emitted .js": [
      remove("dist/server.js"),
      "src/server.ts has no built dist/server.js",
    ],
    "a .ts module with no emitted .d.ts": [
      remove("dist/screenshots.d.ts"),
      "src/screenshots.ts has no built dist/screenshots.d.ts",
    ],
    "a bin that isn't executable": [
      (dir) => chmodSync(join(dir, "dist/bin/screenshots.js"), 0o644),
      "bin spike-html-apps-screenshots isn't executable",
    ],
    "a bin without its shebang": [
      (dir) => writeFileSync(join(dir, "dist/bin/screenshots.js"), "", { mode: 0o755 }),
      "bin spike-html-apps-screenshots has no node shebang",
    ],
    "a bin at a file the pack lacks": [
      (_, manifest) => (manifest.bin = { "spike-html-apps-screenshots": "./dist/bin/gone.js" }),
      "bin spike-html-apps-screenshots is ./dist/bin/gone.js, which isn't packed",
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

  test("fails on a source the build leaves out", () => {
    const sources = join(scratchDir(), "src");
    mkdirSync(sources);
    writeFileSync(join(sources, "left-out.ts"), "");
    assert.ok(
      releaseProblems(pack, sources).includes("src/left-out.ts has no built dist/left-out.js"),
    );
  });
});
