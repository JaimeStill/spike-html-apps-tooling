/** How the command is started, and when it is ready. */
export interface StartOptions {
    /** The URL that answers 2xx over HTTP once the command's app is ready. */
    ready: string;
    /** The command's working directory; the caller's by default. */
    cwd?: string;
    /** Variables set over the caller's environment; one set to undefined is removed. */
    env?: Record<string, string | undefined>;
    /** How long, in ms, the command has to be ready, 30 s by default; past it, the group ends. */
    timeout?: number;
    /** How long, in ms, stop waits after SIGTERM before it sends SIGKILL, 5 s by default. */
    drain?: number;
}
/** A command start() started, once it is ready, until it is stopped. */
export interface Started {
    /** The command's pid, which is its process group's id. */
    pid: number;
    /** What the command has written to stdout and stderr, interleaved, its last 64 KiB. */
    output(): string;
    /**
     * Ends the whole group: SIGTERM, then SIGKILL once the drain passes, resolving once no process
     * of it is left, to the command's exit code, 128 plus the signal's number when a signal ended
     * it. A second call resolves as the first.
     */
    stop(): Promise<number>;
}
/**
 * Starts the command with its args in a process group of its own, resolving once the options'
 * ready URL answers 2xx over HTTP, to the Started handle. It rejects, its message carrying the
 * command's output, when the command exits first, or when the timeout passes, which ends the
 * group; and when the command cannot start. A group the caller never stops is sent SIGKILL as
 * the caller exits, or as a signal it doesn't listen for ends it.
 */
export declare function start(command: string, args: string[], { ready, cwd, env, timeout, drain }: StartOptions): Promise<Started>;
/** Resolves to a loopback port that no one listens on, as the system gives a listen on port 0. */
export declare function freePort(): Promise<number>;
