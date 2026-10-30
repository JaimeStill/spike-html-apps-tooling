// The lint the check runs: the recommended rules and typescript-eslint's, on node, and the sources'
// imports held to node's own modules and the package's files, since the package has no runtime
// dependency.
// Adapted from spike-html-apps-foundation (9c15b8d): eslint.config.js, with node's globals and
// no layer table.

import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

const code = ["**/*.js", "**/*.ts"];

export default defineConfig([
  // The build, gitignored, which ESLint doesn't read.
  { ignores: ["dist/"] },
  { files: code, extends: [js.configs.recommended, tseslint.configs.recommended] },
  { files: code, languageOptions: { globals: globals.node } },
  {
    files: ["src/**"],
    rules: {
      // A specifier that is neither a node: builtin nor a relative path names a package, which
      // the package would then need at runtime.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^(?!node:|\\.{1,2}/)",
              message:
                "The package has no runtime dependency: import node's modules by node: or the " +
                "package's own files by a relative path.",
            },
          ],
        },
      ],
    },
  },
]);
