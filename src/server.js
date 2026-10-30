// The static server a browser test loads its pages from: a root directory over plain http on the
// loopback address, every file sent as it is on disk; under /deps/ the installed packages a page's
// import map names; a shell page for each path with no extension, as an app's server sends its
// shell for each of the app's deep links; and a handler offered every request first, for the
// routes a consumer's own cases need. server.d.ts beside it carries the types a consumer reads.
// Adapted from spike-html-apps-components (2fded6d) and spike-html-apps-sdk (ca3089e):
// test/browser/support/server.js, its deps named by the consumer and its routes a handler's.

/** @import { Server, ServeOptions } from "./server.js" */

import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { basename, dirname, extname, join, normalize, resolve } from "node:path";

/** @type {Record<string, string>} The content type of each extension served; any other is a 404. */
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

/**
 * The package's installed directory, found as node finds an import: in the node_modules of `from`
 * or of the nearest directory above it that holds the package.
 * @param {string} name
 * @param {string} from
 * @returns {string}
 */
function installed(name, from) {
  for (let dir = resolve(from); ; dir = dirname(dir)) {
    const candidate = join(dir, "node_modules", name);
    if (existsSync(candidate)) return candidate;
    if (dirname(dir) === dir) throw new Error(`deps: ${name} is installed in no node_modules`);
  }
}

/**
 * The packages beside the package in its pnpm store directory, by name: its own dependencies,
 * which pnpm links there rather than into the root's node_modules. A package outside a store has
 * none, so a flat node_modules, or a package linked from elsewhere on disk, lends it no others.
 * @param {string} name
 * @param {string} dir
 * @returns {[string, string][]}
 */
function siblings(name, dir) {
  // pnpm installs a package at .pnpm/<id>/node_modules/<name>, its dependencies linked beside it.
  let modules = realpathSync(dir);
  for (let depth = name.split("/").length; depth > 0; depth--) modules = dirname(modules);
  if (basename(modules) !== "node_modules" || basename(dirname(dirname(modules))) !== ".pnpm") {
    return [];
  }
  /** @type {[string, string][]} */
  const found = [];
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
 * @param {string[]} names
 * @param {string} root
 * @returns {Map<string, string>}
 */
function packages(names, root) {
  const named = names.map((name) => /** @type {const} */ ([name, installed(name, root)]));
  const found = new Map(named);
  for (const [name, dir] of named) {
    for (const [sibling, path] of siblings(name, dir)) {
      if (!found.has(sibling)) found.set(sibling, path);
    }
  }
  return found;
}

/**
 * Serves the options' root on a free loopback port, resolving to its origin and a stop().
 * @param {ServeOptions} options
 * @returns {Promise<Server>}
 */
export async function serve({ root, deps = [], shell, handler }) {
  const served = packages(deps, root);

  /**
   * The file a request's path names: under /deps/ one of the packages', otherwise the root's,
   * and the shell's for a path with no extension; undefined when it names none.
   * @param {string} pathname The request's path, still percent-encoded.
   * @returns {string | undefined}
   */
  const file = (pathname) => {
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

  /**
   * Answers the request: the handler's when it claims it, otherwise the file its path names.
   * @param {import("node:http").IncomingMessage} request
   * @param {import("node:http").ServerResponse} response
   */
  const respond = async (request, response) => {
    if (handler && (await handler(request, response)) === true) return;
    const path = file(/** @type {string} */ (request.url).split(/[?#]/)[0]);
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
  const { port } = /** @type {import("node:net").AddressInfo} */ (server.address());
  return {
    origin: `http://127.0.0.1:${port}`,
    stop: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        // A connection held open, by keep-alive or a request never answered, would hold close().
        server.closeAllConnections();
      }),
  };
}
