// A scratch tree for the server's tests: a root of pages, scripts, and styles, a file beside the
// root that no request may reach, and a node_modules laid out as pnpm lays one out, its packages
// real symlinks into a .pnpm store directory.

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** Writes each file under `dir`, by its path, making its directories. */
function write(dir: string, files: Record<string, string>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
}

/** Links `path` under `dir` to `target`, relative as pnpm writes its links. */
function link(dir: string, path: string, target: string): void {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  symlinkSync(target, join(dir, path), "dir");
}

/**
 * Builds the tree in a new temporary directory, resolving to its root, the absolute path of the
 * file beside the root, and a remove().
 */
export function tree(): { root: string; outside: string; remove: () => void } {
  const scratch = mkdtempSync(join(tmpdir(), "server-tree."));
  const root = join(scratch, "root");
  write(scratch, { "outside.html": "<title>outside</title>" });
  write(root, {
    "index.html":
      '<!doctype html><title>index</title><link rel="stylesheet" href="/style.css">' +
      '<script type="importmap">{ "imports": { "alpha": "/deps/alpha/index.js" } }</script>' +
      '<script type="module" src="/app.js"></script>',
    "app.js": 'import { alpha } from "alpha";\nwindow.app = alpha;\n',
    "style.css": "body { margin: 7px; }\n",
    "data.json": '{ "served": true }\n',
    "shell.html": "<title>shell</title>",
    "pages/deep.html": "<title>deep</title>",
  });
  // The store: alpha, linked from node_modules, with beta and @scope/gamma, its dependencies,
  // linked beside it, and a file in its store directory, outside every package.
  const modules = join(root, "node_modules");
  const store = join(modules, ".pnpm");
  write(store, {
    "alpha@1.0.0/node_modules/alpha/index.js":
      'import { beta } from "/deps/beta/index.js";\n' +
      'import { gamma } from "/deps/@scope/gamma/index.js";\n' +
      "export const alpha = `alpha ${beta} ${gamma}`;\n",
    "alpha@1.0.0/node_modules/secret.js": "export const secret = true;\n",
    "beta@2.0.0/node_modules/beta/index.js": 'export const beta = "beta";\n',
    "@scope+gamma@3.0.0/node_modules/@scope/gamma/index.js": 'export const gamma = "gamma";\n',
    "delta@4.0.0/node_modules/delta/index.js": 'export const delta = "delta";\n',
  });
  link(store, "alpha@1.0.0/node_modules/beta", "../../beta@2.0.0/node_modules/beta");
  link(
    store,
    "alpha@1.0.0/node_modules/@scope/gamma",
    "../../../@scope+gamma@3.0.0/node_modules/@scope/gamma",
  );
  link(modules, "alpha", ".pnpm/alpha@1.0.0/node_modules/alpha");
  link(modules, "delta", ".pnpm/delta@4.0.0/node_modules/delta");
  // A package installed flat, as npm installs one, which brings no siblings.
  write(modules, {
    "flat/index.js": 'export const flat = "flat";\n',
    "other/index.js": 'export const other = "other";\n',
  });
  return {
    root,
    outside: join(scratch, "outside.html"),
    remove: () => rmSync(scratch, { recursive: true, force: true }),
  };
}
