#!/usr/bin/env node
// The screenshot bin, spike-html-apps-screenshots: runs the command screenshots.ts carries over
// its arguments, the description module's path then the flags, and exits with its code.
import { main } from "../screenshots.js";
process.exitCode = await main(process.argv.slice(2));
