# spike-html-apps-tooling

The browser-test and screenshot tooling the spike-html-apps repositories share, a `code` project
managed with the marathon workflow. Its goal lives in the coordinator's roadmap,
`standards-lab/context/roadmap.toml`, under `experiment.html.spike-html-apps`, whose record is in
spike-html-apps.

- [`context/README.md`](context/README.md): the working context.
- [`STANDARDS.md`](STANDARDS.md): the judgement calls the standards-reviewer applies.
- **Layout:** `src/` holds the TypeScript sources, `browser.ts`, `server.ts`, and
  `screenshots.ts`, and the bin, `src/bin/screenshots.ts`; `mise run build` emits them, with
  their `.d.ts`, into `dist/`, which is gitignored and ships only in a tag's tree. `test/unit/`
  holds the server's tests and the pack's check, and `test/browser/` the driver's, the server's in
  a browser, and the bin's, over the fixtures in `test/browser/fixtures/screenshots/`.
- **Check:** `mise run check`, after `mise run install`: ESLint, Prettier, shellcheck, actionlint,
  tsc over the sources and over the JavaScript tests (`checkJs`, against `dist/`), the build, the
  unit tier, and the browser tier on `dist/` in the pinned chrome-headless-shell. It reads no
  network.
- **Currency:** `mise run currency`: every mise tool, package.json pin, and action pin behind its
  latest; silent when all are current.
