# Standards

The judgement calls the check can't enforce, one line each, for the standards-reviewer. What
`mise run check` enforces is never restated here. They follow spike-html-apps-foundation's Package
and Code calls, as they apply to a package of node modules.

The architecture pages that apply, in the architecture repository:

- `principles/minimal-footprint.md`
- `principles/rolling-currency.md`
- `principles/independent-releases.md`
- `principles/validation-first.md`

## Package

- The package is `@jaimestill/spike-html-apps-tooling`, the browser-test and screenshot tooling the
  spike-html-apps repositories take as a devDependency; its code and tests name no consumer.
- `dist/` lives only in a release tag's tree, the pack, never on a branch.
- Releases are `v<version>` annotated tags cut by `release.yml` from `package.json`'s version,
  each with its `CHANGELOG.md` section, and never changed or re-cut.

## Code

- Code meets the bar of spike-html-conventions' `layers/` code at a88828a: a 2–4 line header, a
  one-line doc comment per export, and comments only for a non-obvious why.
- A copied file names its source repository and commit in a provenance line, which reads
  `From|Adapted from <repo> (<commit>): <path>`. It names the immediate source alone; that source
  keeps the earlier lines.
- Sources use `.ts` relative specifiers, which tsc rewrites.
- The tests test `dist/`: a test imports the package by its own name, or runs its bin, as a
  consumer does.
- A mise task runs one script or one command, and `check` is a depends list.
