# spike-html-apps-tooling

The browser-test and screenshot tooling the
[spike-html-apps](https://github.com/JaimeStill/spike-html-apps) repositories share. It is plain
Node ES modules, typed by their JSDoc, with no runtime dependency, and is released by git tag.

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

## Development

Tasks run through [mise](https://mise.jdx.dev):

```
mise run install   # the pinned tools and node_modules; reads the network
mise run check     # lint, types, and the unit and browser tiers; reads no network
mise run currency  # report every tool, package, and action pin behind its latest
```

The check lints with ESLint, Prettier, shellcheck, and actionlint, type-checks the JavaScript with
tsc, runs the unit tier, which packs the repository and checks the pack's shape, and runs the
browser tier in the pinned chrome-headless-shell.

A push to main whose `package.json` version has no tag yet releases it: the check, then the pack
committed and tagged, and a GitHub release from `CHANGELOG.md` with the tarball attached.

## Provenance

The scaffold, its tasks, scripts, workflows, and lint, format, and type configuration, is copied
from spike-html-apps-foundation at 9c15b8d. Each copied file that takes comments names its source
in a provenance line; the JSON files, which take none, carry no line.

## License

[Apache License 2.0](LICENSE).
