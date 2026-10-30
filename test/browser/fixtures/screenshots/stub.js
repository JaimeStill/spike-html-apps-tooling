#!/usr/bin/env node
// A stub for a command the screenshot bin runs, linked into a test's PATH under the command's
// name, kitten, kitty, or xdg-open: it appends a line to the file STUB_LOG names, its name, its
// arguments, and whether its stdout is a terminal and /dev/tty opens, so a test sees what reached
// the terminal, then exits with the status STUB_EXIT gives it, a JSON object keyed by its name, or
// by "detect" for icat's support detection; 0 when it gives none.

import { appendFileSync, closeSync, openSync } from "node:fs";
import { basename } from "node:path";

const name = basename(process.argv[1]);
const args = process.argv.slice(2);
let tty = true;
try {
  closeSync(openSync("/dev/tty", "r+"));
} catch {
  tty = false;
}
const line = { name, args, terminal: process.stdout.isTTY === true, tty };
appendFileSync(/** @type {string} */ (process.env.STUB_LOG), `${JSON.stringify(line)}\n`);
/** @type {Record<string, number>} */
const statuses = JSON.parse(process.env.STUB_EXIT ?? "{}");
process.exitCode = statuses[args.includes("--detect-support") ? "detect" : name] ?? 0;
