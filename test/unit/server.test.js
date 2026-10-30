// The server at the package's seam, imported by the package's own name as a consumer imports it:
// the root's files and their headers, its refused traversals, the /deps/ packages and their pnpm
// store siblings, the shell, a handler that claims or passes on, and stop(), each over raw http
// against a scratch tree, so a request's path reaches the server as it is written.

import assert from "node:assert/strict";
import { request as send } from "node:http";
import { after, before, describe, test } from "node:test";
import { serve } from "@jaimestill/spike-html-apps-tooling/server.js";
import { tree } from "../support/tree.js";

/** @import { Server } from "@jaimestill/spike-html-apps-tooling/server.js" */

/**
 * The response to a request for the path, written as it is, with no client normalizing it.
 * @param {string} origin
 * @param {string} path
 * @param {{ method?: string, body?: string }} [options]
 * @returns {Promise<{ status: number, type?: string, cache?: string, body: string }>}
 */
function get(origin, path, { method = "GET", body } = {}) {
  const { hostname, port } = new URL(origin);
  return new Promise((resolve, reject) => {
    const outgoing = send({ hostname, port, path, method, agent: false }, (response) => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => (text += chunk));
      response.on("end", () =>
        resolve({
          status: /** @type {number} */ (response.statusCode),
          type: response.headers["content-type"],
          cache: response.headers["cache-control"],
          body: text,
        }),
      );
      response.on("error", reject);
    });
    outgoing.on("error", reject);
    outgoing.end(body);
  });
}

const fixture = tree();
after(fixture.remove);

describe("the root", () => {
  /** @type {Server} */
  let server;
  before(async () => {
    server = await serve({ root: fixture.root });
  });
  after(() => server.stop());

  test("sends .html, .js, and .css as on disk, with their types and no-store", async () => {
    for (const [path, type, text] of [
      ["/index.html", "text/html", "<title>index</title>"],
      ["/app.js", "text/javascript", "window.app = alpha;"],
      ["/style.css", "text/css", "margin: 7px"],
      ["/pages/deep.html", "text/html", "<title>deep</title>"],
    ]) {
      const response = await get(server.origin, path);
      assert.equal(response.status, 200, path);
      assert.equal(response.type, type, path);
      assert.equal(response.cache, "no-store", path);
      assert.ok(response.body.includes(text), `${path}: ${response.body}`);
    }
  });

  test("a query or fragment leaves the file it names", async () => {
    for (const path of ["/style.css?v=2", "/style.css#top", "/style.css?v=2#top"]) {
      const response = await get(server.origin, path);
      assert.equal(response.status, 200, path);
      assert.equal(response.type, "text/css", path);
    }
  });

  test("any other extension, a missing file, a directory, and an extensionless path are a 404", async () => {
    for (const path of ["/data.json", "/missing.html", "/pages", "/", "/pages/deep"]) {
      const response = await get(server.origin, path);
      assert.equal(response.status, 404, path);
      assert.equal(response.body, "", path);
    }
  });

  test("no request reaches a file outside the root, however its path climbs", async () => {
    // The file beside the root is a real .html file, so only the refusal keeps it from being sent.
    for (const path of [
      "/../outside.html",
      "/%2e%2e/outside.html",
      "/%2E%2E%2Foutside.html",
      "/..%2foutside.html",
      "/pages/..%2f..%2foutside.html",
      "/pages/%2e%2e/%2e%2e/outside.html",
      "//..%2foutside.html",
      `/${fixture.outside}`,
      `/${encodeURIComponent(fixture.outside)}`,
    ]) {
      const response = await get(server.origin, path);
      assert.equal(response.status, 404, path);
      assert.ok(!response.body.includes("outside"), path);
    }
  });

  test("a malformed escape is a 404, and the server goes on answering", async () => {
    assert.equal((await get(server.origin, "/%E0%A4%A.html")).status, 404);
    assert.equal((await get(server.origin, "/index.html")).status, 200);
  });

  test("/deps/ serves nothing when no deps are named", async () => {
    assert.equal((await get(server.origin, "/deps/alpha/index.js")).status, 404);
  });
});

describe("deps", () => {
  /** @type {Server} */
  let server;
  before(async () => {
    server = await serve({ root: fixture.root, deps: ["alpha", "flat"] });
  });
  after(() => server.stop());

  test("serves each named package under /deps/<name>/ from its installed directory", async () => {
    for (const [path, text] of [
      ["/deps/alpha/index.js", "export const alpha"],
      ["/deps/flat/index.js", 'flat = "flat"'],
    ]) {
      const response = await get(server.origin, path);
      assert.equal(response.status, 200, path);
      assert.equal(response.type, "text/javascript", path);
      assert.equal(response.cache, "no-store", path);
      assert.ok(response.body.includes(text), path);
    }
  });

  test("serves a pnpm package's store siblings, scoped or not, by their names", async () => {
    for (const [path, text] of [
      ["/deps/beta/index.js", 'beta = "beta"'],
      ["/deps/@scope/gamma/index.js", 'gamma = "gamma"'],
    ]) {
      const response = await get(server.origin, path);
      assert.equal(response.status, 200, path);
      assert.ok(response.body.includes(text), path);
    }
  });

  test("serves no package it was not given: not one beside a flat package, nor one unnamed", async () => {
    // other sits beside flat in a flat node_modules, and delta in the store beside alpha's own
    // store directory, so either would be served if siblings were taken from anywhere but a
    // pnpm package's store directory.
    for (const path of ["/deps/other/index.js", "/deps/delta/index.js", "/deps/.pnpm/x.js"]) {
      assert.equal((await get(server.origin, path)).status, 404, path);
    }
  });

  test("no request leaves its package, however its path climbs", async () => {
    // secret.js is a real .js file in alpha's store directory, one step above the package.
    for (const path of [
      "/deps/alpha/../secret.js",
      "/deps/alpha/%2e%2e/secret.js",
      "/deps/alpha/..%2fsecret.js",
      "/deps/alpha/%2E%2E%2Fsecret.js",
      "/deps/beta/..%2fsecret.js",
      "/deps/@scope/gamma/..%2f..%2fsecret.js",
      "/deps/alpha/..%2f..%2f..%2f..%2f..%2foutside.html",
    ]) {
      const response = await get(server.origin, path);
      assert.equal(response.status, 404, path);
      assert.ok(!response.body.includes("secret"), path);
    }
  });

  test("a dep installed in no node_modules rejects, naming it", async () => {
    await assert.rejects(
      serve({ root: fixture.root, deps: ["missing-package"] }),
      /deps: missing-package is installed in no node_modules/,
    );
  });

  test("a dep is found in the node_modules of a directory above the root", async () => {
    const nested = await serve({ root: `${fixture.root}/pages`, deps: ["alpha"] });
    try {
      assert.equal((await get(nested.origin, "/deps/beta/index.js")).status, 200);
      assert.equal((await get(nested.origin, "/deep.html")).status, 200);
    } finally {
      await nested.stop();
    }
  });
});

describe("shell", () => {
  /** @type {Server} */
  let server;
  before(async () => {
    server = await serve({ root: fixture.root, shell: "/shell.html" });
  });
  after(() => server.stop());

  test("sends the shell page for any extensionless path, under any method", async () => {
    for (const [path, method] of [
      ["/", "GET"],
      ["/app/documents/42", "GET"],
      ["/pages", "GET"],
      ["/app?tab=1", "POST"],
    ]) {
      const response = await get(server.origin, path, { method });
      assert.equal(response.status, 200, path);
      assert.equal(response.type, "text/html", path);
      assert.equal(response.cache, "no-store", path);
      assert.equal(response.body, "<title>shell</title>", path);
    }
  });

  test("a real file's path still serves the file, and a missing one is still a 404", async () => {
    assert.equal((await get(server.origin, "/pages/deep.html")).body, "<title>deep</title>");
    assert.equal((await get(server.origin, "/app.js")).type, "text/javascript");
    assert.equal((await get(server.origin, "/missing.html")).status, 404);
  });
});

describe("handler", () => {
  test("a claiming handler answers, and the root does not", async () => {
    const server = await serve({
      root: fixture.root,
      handler: (request, response) => {
        response.writeHead(200, { "content-type": "text/plain" }).end(`claimed ${request.url}`);
        return true;
      },
    });
    try {
      const response = await get(server.origin, "/index.html");
      assert.equal(response.body, "claimed /index.html");
      assert.equal(response.type, "text/plain");
    } finally {
      await server.stop();
    }
  });

  test("a passing handler sees every request, and the root answers it", async () => {
    /** @type {string[]} */
    const requests = [];
    const server = await serve({
      root: fixture.root,
      shell: "/shell.html",
      handler: (request) => {
        requests.push(`${request.method} ${request.url}`);
        return false;
      },
    });
    try {
      assert.equal((await get(server.origin, "/index.html")).type, "text/html");
      assert.equal((await get(server.origin, "/a/link")).body, "<title>shell</title>");
      assert.equal((await get(server.origin, "/missing.js")).status, 404);
      assert.deepEqual(requests, ["GET /index.html", "GET /a/link", "GET /missing.js"]);
    } finally {
      await server.stop();
    }
  });

  test("a handler claims by a promise of true, after reading the body whole", async () => {
    const server = await serve({
      root: fixture.root,
      handler: async (request, response) => {
        if (!request.url?.startsWith("/upload/")) return false;
        let size = 0;
        for await (const chunk of request) size += chunk.length;
        response.writeHead(200, { "content-type": "text/plain" }).end(`received ${size}`);
        return true;
      },
    });
    try {
      const upload = await get(server.origin, "/upload/text", {
        method: "POST",
        body: "x".repeat(100_000),
      });
      assert.equal(upload.body, "received 100000");
      assert.equal((await get(server.origin, "/index.html")).type, "text/html");
    } finally {
      await server.stop();
    }
  });

  test("a handler that claims and destroys the socket, or never answers, gets no answer sent", async () => {
    const server = await serve({
      root: fixture.root,
      handler: (request) => {
        if (request.url === "/drop.html") request.socket.destroy();
        else if (request.url === "/hang.html") request.resume();
        else return false;
        return true;
      },
    });
    try {
      await assert.rejects(get(server.origin, "/drop.html"), /socket hang up|ECONNRESET/);
      const hung = get(server.origin, "/hang.html");
      const outcome = await Promise.race([
        hung.then(() => "answered"),
        new Promise((resolve) => setTimeout(() => resolve("waiting"), 200)),
      ]);
      assert.equal(outcome, "waiting");
      // stop() closes the connection the hung request holds, which nothing else would.
      await server.stop();
      await assert.rejects(hung, /socket hang up|ECONNRESET/);
    } finally {
      await server.stop().catch(() => {});
    }
  });

  test("a handler that throws or rejects has the response destroyed, and the server goes on", async () => {
    const server = await serve({
      root: fixture.root,
      handler: async (request) => {
        if (request.url === "/throw.html") throw new Error("handler failed");
        return false;
      },
    });
    try {
      await assert.rejects(get(server.origin, "/throw.html"), /socket hang up|ECONNRESET/);
      assert.equal((await get(server.origin, "/index.html")).status, 200);
    } finally {
      await server.stop();
    }
  });
});

describe("stop", () => {
  test("closes the port", async () => {
    const server = await serve({ root: fixture.root });
    assert.equal((await get(server.origin, "/index.html")).status, 200);
    await server.stop();
    await assert.rejects(get(server.origin, "/index.html"), { code: "ECONNREFUSED" });
  });

  test("each server listens on its own free loopback port", async () => {
    const [one, two] = [await serve({ root: fixture.root }), await serve({ root: fixture.root })];
    try {
      assert.match(one.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
      assert.notEqual(one.origin, two.origin);
    } finally {
      await Promise.all([one.stop(), two.stop()]);
    }
  });
});
