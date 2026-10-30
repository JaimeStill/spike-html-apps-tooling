// A release's shape: a pack of the sources as written, which a tag's tree installs with no build
// step, its manifest carrying no scripts and no runtime dependency, and the Apache 2.0 LICENSE it
// declares. test/unit/release.test.js runs it on a pnpm pack.
// Adapted from spike-html-apps-foundation (9c15b8d): test/unit/release.js, the pack held to the
// sources, not a build, and its manifest to no scripts and no dependencies.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";

/**
 * Every file below `dir`, relative to it with / separators, sorted.
 * @param {string} dir
 * @returns {string[]}
 */
export function listFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((path) => statSync(join(dir, path)).isFile())
    .map((path) => path.split(sep).join("/"))
    .sort();
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
 * @param {string} root
 * @param {string} src
 * @returns {string[]}
 */
export function releaseProblems(root, src) {
  const problems = [];
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

  // The pack is the sources as written and the files every pack carries, and nothing else.
  const packed = listFiles(root);
  if (!packed.includes("README.md")) problems.push("the pack has no README.md");
  const sources = listFiles(src).map((path) => `src/${path}`);
  for (const path of sources) {
    if (!packed.includes(path)) problems.push(`${path} isn't packed`);
  }
  for (const path of packed) {
    if (!sources.includes(path) && !always.includes(path)) {
      problems.push(`${path} is packed but isn't a source, ${always.join(", ")}`);
    }
  }
  return problems;
}
