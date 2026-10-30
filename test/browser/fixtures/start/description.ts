// The fixture description whose server is a start function: it starts its own http server, which
// serves two pages under /app/, and resolves to an origin with that base path, so a page the bin
// opens resolves against the start's origin and no other. The start, the stop, and each request
// the server answers append a line to the file START_LOG names. START_MODE changes it: "reject"
// has the start reject; "fail" has the first page's open step throw; "hang" has it log "open" and
// never resolve, so a test can signal the run mid-capture.

import { appendFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { Description } from "@jaimestill/spike-html-apps-tooling/screenshots.js";

const log = (line: string) => appendFileSync(process.env.START_LOG as string, `${line}\n`);
const mode = process.env.START_MODE ?? "";

/** A page of the fixture's own, by its name. */
const html = (name: string) => `<!doctype html><title>${name}</title><p>the ${name} page</p>`;

const description: Description = {
  pages: [
    {
      name: "one",
      caption: "page one",
      path: "one.html",
      states: [
        {
          full: false,
          viewport: { width: 320, height: 200 },
          open: async () => {
            if (mode === "fail") throw new Error("the one page's open step fails");
            if (mode === "hang") {
              log("open");
              await new Promise(() => {});
            }
          },
        },
      ],
    },
    { name: "two", caption: "page two", path: "two.html", states: [{ full: false }] },
  ],
  server: async () => {
    log("start");
    if (mode === "reject") throw new Error("the fixture server refuses to start");
    const server = createServer((request, response) => {
      log(`${request.method} ${request.url}`);
      const page = /^\/app\/(one|two)\.html$/.exec(request.url ?? "")?.[1];
      if (!page) response.writeHead(404).end();
      else response.writeHead(200, { "content-type": "text/html" }).end(html(page));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    return {
      origin: `http://127.0.0.1:${port}/app`,
      stop: async () => {
        log("stop");
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      },
    };
  },
};

export default description;
