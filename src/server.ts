// The static server a browser test loads its pages from: a root directory over plain http on the
// loopback address, each file as it is on disk; under /deps/ the installed packages an import map
// names; the shell page for any extensionless path, an app's deep links; and a handler offered
// every request first, for a consumer's own routes.
// Adapted from spike-html-apps-components (2fded6d) and spike-html-apps-sdk (ca3089e):
// test/browser/support/server.js, in TypeScript, its deps named by the consumer and its routes a
// handler's.

import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { basename, dirname, extname, join, normalize, resolve } from "node:path";

/**
 * Offered every request before the server's own routes. It returns true, or a promise of true,
 * when it claims the request, and then owns the response: it answers, destroys the socket, or
 * never answers, and the server does nothing more with the request. Anything else passes the
 * request on, so a handler that passes it on must leave the request's body and the response
 * untouched. A handler that throws, or whose promise rejects, has the response destroyed.
 */
export type Handler = (
  request: IncomingMessage,
  response: ServerResponse,
) => boolean | Promise<boolean>;

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

/** The content type of each extension served; any other is a 404. */
const types: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
};

/**
 * The package's installed directory, found as node finds an import: in the node_modules of `from`
 * or of the nearest directory above it that holds the package.
 */
function installed(name: string, from: string): string {
  for (let dir = resolve(from); ; dir = dirname(dir)) {
    const candidate = join(dir, "node_modules", name);
    if (existsSync(candidate)) return candidate;
    if (dirname(dir) === dir)
      throw new Error(
        `deps: ${name} is installed in no node_modules; a named package brings its own dependencies, its pnpm store siblings, so name only the package`,
      );
  }
}

/**
 * The packages beside the package in its pnpm store directory, by name: its own dependencies,
 * which pnpm links there rather than into the root's node_modules. A package outside a store has
 * none, so a flat node_modules, or a package linked from elsewhere on disk, lends it no others.
 */
function siblings(name: string, dir: string): [string, string][] {
  // pnpm installs a package at .pnpm/<id>/node_modules/<name>, its dependencies linked beside it.
  let modules = realpathSync(dir);
  for (let depth = name.split("/").length; depth > 0; depth--) modules = dirname(modules);
  if (basename(modules) !== "node_modules" || basename(dirname(dirname(modules))) !== ".pnpm") {
    return [];
  }
  const found: [string, string][] = [];
  for (const entry of readdirSync(modules)) {
    if (entry.startsWith(".")) continue;
    if (!entry.startsWith("@")) found.push([entry, join(modules, entry)]);
    else {
      for (const scoped of readdirSync(join(modules, entry))) {
        found.push([`${entry}/${scoped}`, join(modules, entry, scoped)]);
      }
    }
  }
  // A package is a directory, or a link to one; a stray file in the store directory is none.
  return found.filter(([, path]) => statSync(path, { throwIfNoEntry: false })?.isDirectory());
}

/**
 * The directory of each package served under /deps/, by name: each named package's, then its
 * store siblings', a named package's own directory taking precedence.
 */
function packages(names: string[], root: string): Map<string, string> {
  const named = names.map((name) => [name, installed(name, root)] as const);
  const found = new Map(named);
  for (const [name, dir] of named) {
    for (const [sibling, path] of siblings(name, dir)) {
      if (!found.has(sibling)) found.set(sibling, path);
    }
  }
  return found;
}

/**
 * Serves the options' root on a free loopback port, resolving to its origin and a stop(); rejects
 * naming a dep it finds in no node_modules.
 */
export async function serve({ root, deps = [], shell, handler }: ServeOptions): Promise<Server> {
  const served = packages(deps, root);

  /**
   * The file a request's path names: under /deps/ one of the packages', otherwise the root's,
   * and the shell's for a path with no extension; undefined when it names none. The pathname is
   * the request's path, still percent-encoded.
   */
  const file = (pathname: string): string | undefined => {
    // normalize() of an absolute path never climbs above its root, so no request leaves the root,
    // and none under /deps/ leaves its package. An encoded ..'s %2e%2e and %2f are decoded first,
    // so it climbs no further than a plain one.
    let path;
    try {
      path = normalize(decodeURIComponent(pathname));
    } catch {
      return undefined;
    }
    if (shell !== undefined && extname(path) === "") return join(root, normalize(shell));
    if (!path.startsWith("/deps/")) return join(root, path);
    const segments = path.slice("/deps/".length).split("/");
    const length = segments[0].startsWith("@") ? 2 : 1;
    const dir = served.get(segments.slice(0, length).join("/"));
    return dir && join(dir, ...segments.slice(length));
  };

  /** Answers the request: the handler's when it claims it, otherwise the file its path names. */
  const respond = async (request: IncomingMessage, response: ServerResponse) => {
    if (handler && (await handler(request, response)) === true) return;
    const path = file((request.url as string).split(/[?#]/)[0]);
    const type = path && types[extname(path)];
    const body = type && (await readFile(path).catch(() => undefined));
    if (!body) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": type, "cache-control": "no-store" }).end(body);
  };

  const server = createServer((request, response) => {
    // A handler that throws or rejects, or a body the client stops sending, fails the response.
    respond(request, response).catch(() => response.destroy());
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(undefined));
  });
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        // A connection held open, by keep-alive or a request never answered, would hold close().
        server.closeAllConnections();
      }),
  };
}
