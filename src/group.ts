// A process group's liveness and its ending, which browser.ts and process.ts share: each starts
// its command as the leader of a group of its own, which every process the command starts joins,
// so ending the group ends them all.
// Moved from browser.ts, kill given its signal.

import { existsSync, readFileSync, readdirSync } from "node:fs";

/**
 * Whether any process of the group is alive. Linux's /proc tells a live process from a zombie,
 * which is dead but counts toward the group until its parent reaps it, as the group's leader is
 * until the event loop runs again; elsewhere signal 0 tests the group, zombies included, so a wait
 * on it there waits out its deadline.
 */
export function alive(group: number): boolean {
  if (existsSync("/proc/self/stat")) {
    for (const entry of readdirSync("/proc")) {
      if (!/^\d+$/.test(entry)) continue;
      let stat: string;
      try {
        stat = readFileSync(`/proc/${entry}/stat`, "utf8");
      } catch {
        continue; // The process ended while the directory was read.
      }
      // After the command's closing parenthesis: the state, the parent's pid, the group.
      const [state, , pgrp] = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      if (Number(pgrp) === group && state !== "Z" && state !== "X") return true;
    }
    return false;
  }
  try {
    process.kill(-group, 0);
    return true;
  } catch {
    return false;
  }
}

/** Sends the group the signal, SIGKILL by default, when any of it is left. */
export function kill(group: number, signal: NodeJS.Signals = "SIGKILL"): void {
  try {
    process.kill(-group, signal);
  } catch {
    // ESRCH: the group is gone already.
  }
}

/**
 * Resolves once no process of the group is alive, or once the timeout, in ms, passes, to whether
 * the group is gone.
 */
export async function ended(group: number, timeout: number): Promise<boolean> {
  const deadline = performance.now() + timeout;
  while (alive(group)) {
    if (performance.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return true;
}
