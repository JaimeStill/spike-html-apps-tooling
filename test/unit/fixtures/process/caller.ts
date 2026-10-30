// A caller that starts the fixture server through the process helper, prints the group's pid and
// the server's pids, as JSON, once it is ready, and never stops it: with CALLER_END=exit it then
// exits, and otherwise it waits, with no listener of its own, for the signal that ends it.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { freePort, start } from "@jaimestill/spike-html-apps-tooling/process.js";

const port = await freePort();
const pids = process.env.PIDS as string;
const started = await start(process.execPath, [join(import.meta.dirname, "server.ts")], {
  ready: `http://127.0.0.1:${port}/ready`,
  env: { PORT: String(port) },
});
console.log(JSON.stringify({ group: started.pid, ...JSON.parse(readFileSync(pids, "utf8")) }));
if (process.env.CALLER_END === "exit") process.exit(0);
setInterval(() => {}, 1000);
