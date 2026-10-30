# spike-html-apps-tooling

The browser-test and screenshot tooling the spike-html-apps repositories share, a `code` project
managed with the marathon workflow. Its goal lives in the coordinator's roadmap,
`standards-lab/context/roadmap.toml`, under `experiment.html.spike-html-apps`, whose record is in
spike-html-apps.

- [`context/README.md`](context/README.md): the working context.
- [`STANDARDS.md`](STANDARDS.md): the judgement calls the standards-reviewer applies.
- **Check:** `mise run check`, after `mise run install`: ESLint, Prettier, shellcheck, actionlint,
  tsc over the plain JavaScript (`checkJs`, no emit), the unit tier, which packs the repository and
  checks the pack's shape, and the browser tier in the pinned chrome-headless-shell. It reads no
  network.
- **Currency:** `mise run currency`: every mise tool, package.json pin, and action pin behind its
  latest; silent when all are current.
