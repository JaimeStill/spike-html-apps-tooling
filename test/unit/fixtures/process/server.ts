// The fixture server the process helper's tests start, directly or as mise.toml's dev task, which
// mise runs as its child, so the server is the helper's grandchild. It starts a child of its own,
// a process the helper never sees, and writes both pids, as JSON, to the file PIDS names. Its
// /ready answers 503 until READY_AFTER ms have passed, then 200, logging each answer to stdout.
// FIXTURE_MODE changes it: "exit" writes to stderr and exits 3 before it listens; "never" answers
// /ready 503 forever; "stubborn" has it and its child ignore SIGTERM, so only SIGKILL ends them.

import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createServer } from "node:http";

const mode = process.env.FIXTURE_MODE ?? "";
if (mode === "exit") {
  console.error("the fixture server dies before it listens");
  process.exit(3);
}
const stubborn = mode === "stubborn";
if (stubborn) process.on("SIGTERM", () => console.log("SIGTERM ignored"));
const hold = `${stubborn ? 'process.on("SIGTERM", () => {});' : ""} setInterval(() => {}, 1000);`;
const child = spawn(process.execPath, ["-e", hold], { stdio: "ignore" });
writeFileSync(
  process.env.PIDS as string,
  JSON.stringify({ server: process.pid, child: child.pid }),
);

const since = performance.now();
const after = Number(process.env.READY_AFTER ?? 0);
createServer((request, response) => {
  const status =
    request.url === "/ready" && mode !== "never" && performance.now() - since >= after ? 200 : 503;
  console.log(`${request.url} ${status}`);
  response.writeHead(status).end();
}).listen(Number(process.env.PORT), "127.0.0.1");
