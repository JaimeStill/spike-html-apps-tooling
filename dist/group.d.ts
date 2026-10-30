/**
 * Whether any process of the group is alive. Linux's /proc tells a live process from a zombie,
 * which is dead but counts toward the group until its parent reaps it, as the group's leader is
 * until the event loop runs again; elsewhere signal 0 tests the group, zombies included, so a wait
 * on it there waits out its deadline.
 */
export declare function alive(group: number): boolean;
/** Sends the group the signal, SIGKILL by default, when any of it is left. */
export declare function kill(group: number, signal?: NodeJS.Signals): void;
/**
 * Resolves once no process of the group is alive, or once the timeout, in ms, passes, to whether
 * the group is gone.
 */
export declare function ended(group: number, timeout: number): Promise<boolean>;
