// The server and the driver together, each imported by the package's own name: a page the server
// sends, loaded through launch, whose stylesheet applies and whose module script runs, importing a
// /deps/ package and its pnpm store siblings, which a browser does only for the right MIME types.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { launch, until } from "@jaimestill/spike-html-apps-tooling/browser.js";
import { serve } from "@jaimestill/spike-html-apps-tooling/server.js";
import { tree } from "../support/tree.js";

/** @import { Browser } from "@jaimestill/spike-html-apps-tooling/browser.js" */
/** @import { Server } from "@jaimestill/spike-html-apps-tooling/server.js" */

const fixture = tree();
/** @type {Server} */
let server;
/** @type {Browser} */
let browser;
before(async () => {
  server = await serve({ root: fixture.root, deps: ["alpha"] });
  browser = await launch();
});
after(async () => {
  await browser.close();
  await server.stop();
  fixture.remove();
});

test("a page's stylesheet applies and its module scripts run, a dep and its siblings imported", async () => {
  const page = await browser.open(`${server.origin}/index.html`);
  try {
    assert.equal(await until(page, "window.app", 5000), "alpha beta gamma");
    assert.equal(await page.evaluate("getComputedStyle(document.body).marginTop"), "7px");
    // The browser saw the server's types, not ones it sniffed.
    const types = await page.evaluate(
      `Object.fromEntries(performance.getEntriesByType("resource").map((entry) => [new URL(entry.name).pathname, entry.contentType]))`,
    );
    assert.deepEqual(types, {
      "/style.css": "text/css",
      "/app.js": "text/javascript",
      "/deps/alpha/index.js": "text/javascript",
      "/deps/beta/index.js": "text/javascript",
      "/deps/@scope/gamma/index.js": "text/javascript",
    });
  } finally {
    await page.close();
  }
});
