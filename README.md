# spike-html-apps-tooling

The browser-test and screenshot tooling the
[spike-html-apps](https://github.com/JaimeStill/spike-html-apps) repositories share: a driver for
Chrome over the DevTools Protocol, a page wait, a static server, and a screenshot command. It is
plain Node ES modules with type declarations and no runtime dependency, and is released by git
tag.

## Install

Each release is a tag, `v<version>`, whose tree is the package as `pnpm pack` builds it:
`package.json`, this README, the LICENSE, and `src/`. The sources ship as written, so the tag
installs with no build step, and its manifest has no scripts. Install it by the tag, as a
devDependency:

```
pnpm add -D github:JaimeStill/spike-html-apps-tooling#v0.1.0
npm install -D --allow-git=root github:JaimeStill/spike-html-apps-tooling#v0.1.0
```

npm 12 refuses git dependencies unless `--allow-git` allows them; `root` allows the ones the
project itself declares. Each GitHub release also carries the tarball.

## Use

The package is `@jaimestill/spike-html-apps-tooling`. Its modules are imported by their `.js`
subpaths, each typed by the `.d.ts` beside it in `src/`.

`./browser.js` drives the browser over the DevTools Protocol on a pipe:

```ts
launch(): Promise<Browser>
until(page: Page, expression: string, timeout?: number): Promise<any>
SETTLED: string
```

- `launch()` starts the browser that `BROWSER_EXECUTABLE` names, headless, with no sandbox, in
  en-US and UTC, and rejects when the variable is unset. The browser resolves only `127.0.0.1`
  and `localhost`. Its temporary profile is removed on `close()`, or when the process exits
  without closing it.
- `Browser` has `open(url)`, which resolves to a `Page` once the page's load event fires, and
  `close()`. A `Page` is 1280×720 with its scrollbars shown, and has `goto(url)`,
  `cdp(method, params?)`, `on(method, listener)`, `evaluate(expression)`, and `close()`.
- `until` polls the expression inside the page and resolves to its value once it is truthy. It
  rejects, naming the expression and the timeout, when the timeout passes; the timeout is 10 s
  by default.
- `SETTLED` is an expression for `evaluate` that resolves once the page's fonts are ready and two
  frames have painted.

`./server.js` serves a directory over http on the loopback address:

```ts
serve(options: ServeOptions): Promise<Server>
```

- `root` is the directory served. Its `.html`, `.js`, and `.css` files are sent as they are on
  disk, with `cache-control: no-store`; any other path is a 404, and no request reaches a file
  outside the root.
- `deps` names packages to serve under `/deps/<name>/`, each found in the nearest `node_modules`
  that holds it, as node resolves an import. A package pnpm installed brings its store siblings,
  its own dependencies, under `/deps/` too.
- `shell` is the page, under the root, sent for any path with no extension.
- `handler(request, response)` is offered every request first. It claims the request by
  returning true, or a promise of true, and then owns the response.
- The `Server` it resolves to has `origin`, `http://127.0.0.1:<port>` on a free port, and
  `stop()`.

`./screenshots.js` holds the screenshot command, `main(argv: string[]): Promise<number>`, which
the bin runs, and the `Description` type a consumer's description module exports.

## Screenshots

The bin `spike-html-apps-screenshots` captures a consumer's pages in the browser
`BROWSER_EXECUTABLE` names:

```
spike-html-apps-screenshots <description> [--all | --<facet> <name>...] [--page <name>]...
  [--scheme light|dark] [--output terminal|directory|browser] [--dir <path>] [--keep]
```

`<description>` is the path of a module whose default export is a `Description`, whose shape
[`src/screenshots.d.ts`](src/screenshots.d.ts) gives. It lists the pages, each with a name, a
caption, a path, and its states, and each state captures either the full page or one viewport.
It also gives the profile's facets, each with its flag, the root attribute it sets, and its
default; the profiles `--all` captures; how to read the profiles a page registers; and the
server's options, whose root is the module's directory by default. A consumer under `checkJs`
types the export:

```js
/** @type {import("@jaimestill/spike-html-apps-tooling/screenshots.js").Description} */
export default { pages: [{ name: "tools", caption: "Tools", path: "demo/tools.html" }] };
```

With no flags, the bin captures every page in light and dark at each facet's default. A facet's
flag sets that facet's profile, `--all` captures every profile the description lists, `--page`
limits the run to the pages named, and `--scheme` limits it to one scheme. A usage error, an
unknown page, or a profile a page hasn't registered exits 2 before any capture.

Each capture opens the page in a new tab and sets the scheme and the profile's attributes on the
root. It waits until every custom element is defined and has updated, runs the state's `open`
step, and, when the page has an element marked `data-focus-start`, focuses it and presses Tab as
many times as the attribute's value, once by default. It then waits for `SETTLED`. A full-page
state is cut into tiles of at most 1200 px, each cut moved up to the top of a `main > section`,
or of a `figure.state` inside one, when one is near. The files are named
`<number>-<name>--<profile>-<scheme>.png`, where `<number>` is the state's place among all the
description's states and `<profile>` is the facets' names joined by dashes; a tile adds
`--<k>of<m>` before `.png`.

`--output` chooses how the captures are shown:

- `terminal`, the default, prints each caption and path and shows each image with kitty's
  `kitten icat`. When stdout is not a terminal, `/dev/tty` does not open, or icat detects no
  support, it prints one stderr line giving the reason and naming `--output browser`. Inside a
  Neovim `:terminal`, the reason it gives is that the terminal reports no pixel size and does not
  pass graphics through. The run removes its files as it ends unless `--keep` is given.
- `directory` writes the files, prints each caption and path, and keeps the files.
- `browser` also writes `index.html`, a gallery of every capture under its caption, and opens it
  with `xdg-open`. When the open fails, it prints the gallery's path and exits 1.

The files go to a new directory under `$TMPDIR`, or `/tmp`, unless `--dir <path>` names one. The
terminal output removes only the files it wrote, and the directory only if the run created it.

## Development

Tasks run through [mise](https://mise.jdx.dev):

```
mise run install   # the pinned tools and node_modules; reads the network
mise run check     # lint, types, and the unit and browser tiers; reads no network
mise run currency  # report every tool, package, and action pin behind its latest
```

The check lints with ESLint, Prettier, shellcheck, and actionlint, and type-checks the JavaScript
with tsc. The unit tier tests the server and packs the repository to check the pack's shape. The
browser tier runs the driver, the server, and the bin in the pinned chrome-headless-shell.

A push to main whose `package.json` version has no tag yet releases that version. The release
workflow runs the check, commits and tags the pack's tree, and creates a GitHub release from the
version's `CHANGELOG.md` section with the tarball attached.

## Provenance

The scaffold, meaning its tasks, scripts, workflows, and lint, format, and type configuration, is
copied from spike-html-apps-foundation at 9c15b8d. The modules are adapted from the browser-test
and screenshot support of the spike-html-apps repositories. Each copied file that takes
comments names its source in a provenance line; the JSON files, which take none, carry no line.

## License

[Apache License 2.0](LICENSE).
