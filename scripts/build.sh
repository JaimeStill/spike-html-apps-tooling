#!/usr/bin/env bash
# The build: src/ into a fresh dist/. tsc emits each module's .js and .d.ts. It keeps the bin's
# shebang but writes no file executable; pnpm pack sets a bin's mode in the tarball, but the browser
# tier runs dist/'s bin as it is, so the build sets it.
# Adapted from spike-html-apps-foundation (9c15b8d): scripts/build.sh, with no copied files and the
# bin's mode.
set -euo pipefail
cd "$(dirname "$0")/.."

rm -rf dist
tsc -p .
chmod +x dist/bin/screenshots.js
