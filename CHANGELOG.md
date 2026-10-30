# Changelog

All notable changes to `@jaimestill/spike-html-apps-tooling` are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the package adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] - 2026-10-30

### Added

- The bin's `--help`, or `-h`: it prints the usage, each flag's meaning, the schemes, the outputs,
  and the exit codes, and exits 0 before any server or browser starts, with no
  `BROWSER_EXECUTABLE`. It wins over every other flag, which it ignores. After a description,
  `spike-html-apps-screenshots <description> --help` also lists its pages, each with its caption,
  and its facets, each with its flag, root attribute, default, and names: the default and each
  name the description's `all` profiles give the facet's flag. A run still checks a name against
  each page's registered names. A usage error's usage line names `-h | --help`, and no facet may
  take the flag `help`.
- The README shows a description as a `.ts` module, which Node runs by stripping its types: it
  uses erasable syntax only, lives outside `node_modules`, and is type-checked by the consumer's
  own `noEmit` project.

## [0.1.0] - 2026-10-30

### Added

- The tooling package, with no runtime dependency, its sources TypeScript, which tsc builds into
  `dist/`, each module's `.js` with its `.d.ts`.
- `./browser.js`: `launch()` starts the browser `BROWSER_EXECUTABLE` names over the DevTools
  Protocol on a pipe, with no sandbox, en-US, and UTC, and rejects when the variable is unset. It
  resolves only `127.0.0.1` and `localhost`, so no background request leaves the machine. Its
  temporary profile is removed on `close()`, and the browser is killed and the profile removed if
  the process exits without closing it. Each page is 1280×720 with its scrollbars shown and
  offers `goto`, `cdp`, `on`, `evaluate`, and `close`. `until(page, expression, timeout)` polls
  inside the page and resolves to the expression's value once it is truthy, or rejects naming the
  expression and the timeout, 10 s by default. `SETTLED` is an expression that resolves once the
  page's fonts are ready and two frames have painted.
- `./server.js`: `serve(options)` serves a `root` directory's `.html`, `.js`, and `.css` files on
  a free loopback port with `cache-control: no-store`, answers any other path 404, and serves no
  file outside the root. `deps` serves each named package, and its pnpm store siblings, under
  `/deps/<name>/`. `shell` names the page sent for any extensionless path. `handler` is offered
  every request first and claims it or passes it on. It resolves to the server's `origin` and a
  `stop()`.
- The bin `spike-html-apps-screenshots <description> [flags]`: it captures the pages a
  description module exports by default, typed as `Description` in `./screenshots.js`, in each
  profile the flags choose, in light and dark unless `--scheme` names one. The flags are a `--<flag> <name>` for each of the
  description's facets, `--all`, `--page`, `--scheme`, `--output`, `--dir`, and `--keep`. Each
  capture reaches its focus state with real Tab presses from the page's `[data-focus-start]`
  mark. A full-page capture is cut into tiles of at most 1200 px, each cut moved up to a
  section's or a state's top when one is near. A usage error, an unknown page, or a profile a
  page hasn't registered exits 2.
- The bin's outputs. `--output terminal`, the default, prints each caption and path and shows
  each image with kitty's `kitten icat` when stdout is a terminal, `/dev/tty` opens, and icat
  detects support. Otherwise it prints one stderr line naming the reason and `--output browser`.
  Inside a Neovim `:terminal` the reason is that the terminal reports no pixel size and does not
  pass graphics through. It removes its files as the run ends unless `--keep` is given.
  `--output directory` writes the files and keeps them. `--output browser` also writes an
  `index.html` gallery beside them and opens it with `xdg-open`; a failed open prints the
  gallery's path and exits 1.
- The release by tag: `v<version>`, whose tree is the pack, the build included, with the tarball
  on its GitHub release.

[Unreleased]: https://github.com/JaimeStill/spike-html-apps-tooling/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/JaimeStill/spike-html-apps-tooling/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/JaimeStill/spike-html-apps-tooling/releases/tag/v0.1.0
