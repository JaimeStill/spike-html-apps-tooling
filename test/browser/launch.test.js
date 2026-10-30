// The browser tier's footing until the driver lands: the browser BROWSER_EXECUTABLE names, the
// pinned chrome-headless-shell that mise run test:browser passes, launches headless and renders a
// page.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("BROWSER_EXECUTABLE launches headless and renders a page", () => {
  const executable = process.env.BROWSER_EXECUTABLE;
  assert.ok(executable, "BROWSER_EXECUTABLE names no browser: run mise run test:browser");
  const profile = mkdtempSync(join(tmpdir(), "launch."));
  try {
    const dom = execFileSync(
      executable,
      [
        "--headless",
        // Ubuntu's AppArmor refuses the user namespaces a downloaded Chrome's sandbox needs; the
        // page is an inline one that loads nothing.
        "--no-sandbox",
        `--user-data-dir=${profile}`,
        "--no-first-run",
        "--disable-background-networking",
        "--disable-component-update",
        "--dump-dom",
        "data:text/html,<p id=ready>ready</p>",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 30_000 },
    );
    assert.match(dom, /<p id="ready">ready<\/p>/);
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
});
