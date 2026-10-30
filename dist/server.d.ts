import { type IncomingMessage, type ServerResponse } from "node:http";
/**
 * Offered every request before the server's own routes. It returns true, or a promise of true,
 * when it claims the request, and then owns the response: it answers, destroys the socket, or
 * never answers, and the server does nothing more with the request. Anything else passes the
 * request on, so a handler that passes it on must leave the request's body and the response
 * untouched. A handler that throws, or whose promise rejects, has the response destroyed.
 */
export type Handler = (request: IncomingMessage, response: ServerResponse) => boolean | Promise<boolean>;
/** What serve serves. */
export interface ServeOptions {
    /** The directory whose .html, .js, and .css files are served, each at its path under it. */
    root: string;
    /**
     * The packages served under /deps/<name>/, each by its name, found as node finds an import: in
     * the node_modules of the root or of the nearest directory above it that holds the package.
     * A package pnpm installed from its store brings its store siblings, its own dependencies,
     * under /deps/ by their names too.
     */
    deps?: string[];
    /** The path under the root of the page sent for any request whose path has no extension. */
    shell?: string;
    /** Offered every request first, to claim or pass on. */
    handler?: Handler;
}
/** A server serve started, until it is stopped. */
export interface Server {
    /** The server's origin, http://127.0.0.1:<port>. */
    origin: string;
    /** Closes the port and every connection still open, resolving once the server is closed. */
    stop(): Promise<void>;
}
/**
 * Serves the options' root on a free loopback port, resolving to its origin and a stop(); rejects
 * naming a dep it finds in no node_modules.
 */
export declare function serve({ root, deps, shell, handler }: ServeOptions): Promise<Server>;
