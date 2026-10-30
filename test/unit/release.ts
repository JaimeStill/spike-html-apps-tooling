// A release's shape: a pack of the build checked against the sources, which a tag's tree installs
// with no build step, its manifest carrying no scripts and no runtime dependency, its bin
// executable, and the Apache 2.0 LICENSE it declares. test/unit/release.test.ts runs it on a pnpm
// pack.
// Adapted from spike-html-apps-foundation (9c15b8d): test/unit/release.js, in TypeScript, with no
// export resolution, which the tests' imports by the package's name exercise, its manifest held to
// no scripts and no dependencies, and its bin to executable.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";

/** Every file below `dir`, relative to it with / separators, sorted. */
export function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((path) => statSync(join(dir, path)).isFile())
    .map((path) => path.split(sep).join("/"))
    .sort();
}

/** The dist/ paths a source in src/ ships as: a .ts module's emitted .js and .d.ts. */
export function builtFrom(source: string): string[] {
  if (!source.endsWith(".ts") || source.endsWith(".d.ts")) return [];
  const base = source.slice(0, -".ts".length);
  return [`dist/${base}.js`, `dist/${base}.d.ts`];
}

/** The files every pack carries whatever package.json's files lists. */
export const always = ["LICENSE", "README.md", "package.json"];

/** The license every release declares, and the text its LICENSE opens with. */
const license = "Apache-2.0";
const licenseHeading = /^\s*Apache License\s+Version 2\.0, January 2004\s/;

/** The manifest fields that make an install run or fetch something. */
const installFields = [
  "scripts",
  "dependencies",
  "optionalDependencies",
  "peerDependencies",
  "bundleDependencies",
  "bundledDependencies",
];

/**
 * What keeps root, a pack's package/, from being the release its package.json declares for the
 * sources in `src`, one line each.
 */
export function releaseProblems(root: string, src: string): string[] {
  const problems: string[] = [];
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

  if (manifest.license !== license) {
    problems.push(`package.json declares license ${manifest.license}, not ${license}`);
  }
  const licensePath = join(root, "LICENSE");
  if (!existsSync(licensePath)) problems.push("LICENSE is missing");
  else if (!licenseHeading.test(readFileSync(licensePath, "utf8"))) {
    problems.push("LICENSE isn't the Apache License 2.0");
  }

  // An install from the tag runs nothing and fetches nothing: no lifecycle script, such as
  // prepare, builds it, and no runtime dependency comes with it.
  for (const field of installFields) {
    if (field in manifest) problems.push(`package.json has a ${field} field`);
  }

  // The pack is the build and the files every pack carries, and nothing else.
  const packed = listFiles(root);
  if (!packed.includes("README.md")) problems.push("the pack has no README.md");
  for (const path of packed) {
    if (!path.startsWith("dist/") && !always.includes(path)) {
      problems.push(`${path} is packed but isn't the build, ${always.join(", ")}`);
    }
  }

  // The build against the sources: each source's emit is there, and nothing else is.
  const built = packed.filter((path) => path.startsWith("dist/"));
  const expected = new Set<string>();
  for (const source of listFiles(src)) {
    const outputs = builtFrom(source);
    if (outputs.length === 0) problems.push(`src/${source} isn't a .ts source`);
    for (const output of outputs) {
      expected.add(output);
      if (!built.includes(output)) problems.push(`src/${source} has no built ${output}`);
    }
  }
  for (const path of built) {
    if (!expected.has(path)) problems.push(`${path} is built from no source`);
  }

  // Each bin is a built file with its shebang, executable, so the tag's tree runs it as it is.
  const bins: Record<string, string> = manifest.bin ?? {};
  for (const [name, target] of Object.entries(bins)) {
    const path = join(root, target);
    if (!existsSync(path)) problems.push(`bin ${name} is ${target}, which isn't packed`);
    else {
      if (!readFileSync(path, "utf8").startsWith("#!/usr/bin/env node\n")) {
        problems.push(`bin ${name} has no node shebang`);
      }
      if ((statSync(path).mode & 0o111) === 0) problems.push(`bin ${name} isn't executable`);
    }
  }
  return problems;
}
