// The screenshot command's engine, which bin/screenshots.js runs: a consumer's description module,
// loaded by the path the first argument names, gives the pages, their states, the profile's
// facets, and the server; the flags after it choose the profiles, pages, and schemes, and how the
// captures are shown. Each capture is a fresh page, at its state's viewport, the scheme emulated
// and the profile's and scheme's attributes on the root, every custom element rendered, and the
// focus state reached by real Tab presses; a full-page state is cut into tiles at most TILE tall,
// each one PNG. screenshots.d.ts beside it carries the types a consumer reads.
// Adapted from spike-html-apps-components (8ba2be0), spike-html-apps-foundation (6e9669f), and
// spike-html-apps-noctis (7d7351a): scripts/screenshots.js and scripts/screenshots.sh.

/** @import { Description, DescribedPage, DescribedState, Facet, Viewport } from "./screenshots.js" */
/** @import { Browser, Page } from "./browser.js" */

import { mkdirSync, mkdtempSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { SETTLED, launch } from "./browser.js";
import { serve } from "./server.js";

/** The bin's name, which its messages and usage start with. */
const NAME = "spike-html-apps-screenshots";

/** The schemes, each emulated as prefers-color-scheme and set as the root's data-scheme. */
const SCHEMES = ["light", "dark"];

/** The ways the captures are shown; only directory is implemented yet. */
const OUTPUTS = ["terminal", "directory", "browser"];

/** The flags the bin takes for itself, which no facet may take. */
const RESERVED = ["all", "page", "scheme", "output", "dir", "keep"];

/** A state's viewport when it names none: a full-page capture is taken at this width. */
const VIEWPORT = { width: 1280, height: 800 };

/** A tile's greatest height, in CSS px. */
const TILE = 1200;

/** How far up from a tile's foot a cut may move to a section's top: the tile's last quarter. */
const SECTION_SLACK = TILE / 4;

/** How far up a cut may move to a state's top, when no section's top is near: the tile's last
 * half, since a state can be taller than a quarter tile, and a narrower window would leave some
 * tiles no state boundary to cut at. */
const STATE_SLACK = TILE / 2;

/**
 * A capture the engine wrote: its file and its caption.
 * @typedef {{ path: string, caption: string }} Shot
 */

/**
 * The files a run writes, into the directory --dir names or a fresh one under TMPDIR, made at the
 * first write, so a run that captures nothing leaves nothing behind. It tracks what it wrote and
 * whether it made the directory, so remove() takes away only what the run added.
 * @typedef {{ write(name: string, data: Buffer): string, remove(): void }} Files
 */

/**
 * How the captures are shown: each as it is written, then once the run ends.
 * @typedef {{ show(shot: Shot): void | Promise<void>, end(): void | Promise<void> }} Output
 */

/**
 * The run's files.
 * @param {string | undefined} dir The directory --dir names, or undefined for a fresh one.
 * @returns {Files}
 */
function files(dir) {
  /** @type {string | undefined} */
  let target;
  /** The topmost directory the run made, which remove() takes away once it is empty. */
  /** @type {string | undefined} */
  let made;
  /** @type {string[]} */
  const written = [];
  return {
    write(name, data) {
      if (target === undefined) {
        if (dir === undefined) target = made = mkdtempSync(join(tmpdir(), "screenshots."));
        else {
          target = resolve(dir);
          made = mkdirSync(target, { recursive: true });
        }
      }
      const path = join(target, name);
      writeFileSync(path, data);
      written.push(path);
      return path;
    },
    remove() {
      for (const path of written) rmSync(path, { force: true });
      if (target === undefined || made === undefined) return;
      // Each directory from the target up to the one the run made, each only once it is empty, so
      // a file another hand put there keeps its directory.
      for (let at = target; ; at = dirname(at)) {
        try {
          rmdirSync(at);
        } catch {
          return;
        }
        if (at === made) return;
      }
    },
  };
}

/**
 * The outputs implemented, by --output's name, each given the run's files, so one that cleans up
 * takes away only what the run wrote. --keep is the terminal output's: the directory output keeps
 * its files whatever it says.
 * @type {Record<string, (files: Files) => Output>}
 */
const outputs = {
  // Writes the files and keeps them, printing each caption and its path.
  directory: () => ({
    show: ({ path, caption }) => console.log(`${caption}\n  ${path}`),
    end: () => {},
  }),
};

/**
 * The usage line, naming the description's facet flags.
 * @param {Facet[]} facets
 */
function usage(facets) {
  const flags = facets.map(({ flag }) => `[--${flag} <name>]`).join(" ");
  const profiles = flags ? `[--all | ${flags}]` : "[--all]";
  return (
    `usage: ${NAME} <description> ${profiles} [--page <name>]... [--scheme light|dark] ` +
    `[--output ${OUTPUTS.join("|")}] [--dir <path>] [--keep]`
  );
}

/**
 * The description the module at the path exports by default, its server's root resolved against
 * the module's directory; throws naming what it lacks.
 * @param {string} path
 * @returns {Promise<Required<Pick<Description, "facets" | "all">> & Description>}
 */
async function load(path) {
  const file = resolve(path);
  /** @type {Description} */
  const description = (await import(pathToFileURL(file).href)).default;
  if (!Array.isArray(description?.pages) || description.pages.length === 0) {
    throw new Error(`${path} exports no description with pages`);
  }
  const facets = description.facets ?? [];
  for (const { flag } of facets) {
    if (!/^[a-z][a-z-]*$/.test(flag) || RESERVED.includes(flag)) {
      throw new Error(`${path}: a facet can't take the flag --${flag}`);
    }
  }
  const server = description.server ?? {};
  return {
    ...description,
    facets,
    all: description.all ?? [{}],
    server: { ...server, root: resolve(dirname(file), server.root ?? ".") },
  };
}

/** Sends Tab, as a keyboard presses it, so the browser moves focus and marks it focus-visible.
 * @param {Page} page */
async function pressTab(page) {
  const event = { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 };
  await page.cdp("Input.dispatchKeyEvent", { type: "keyDown", ...event });
  await page.cdp("Input.dispatchKeyEvent", { type: "keyUp", ...event });
}

/** Resolves once every custom element on the page is defined and has finished updating: its
 * updateComplete, which a Lit element has, resolved. */
const RENDERED = `(async () => {
  const tags = [...new Set([...document.querySelectorAll("*")]
    .map((el) => el.localName).filter((name) => name.includes("-")))];
  await Promise.all(tags.map((tag) => customElements.whenDefined(tag)));
  await Promise.all([...document.querySelectorAll(tags.join(",") || "x-none")]
    .map((el) => el.updateComplete));
})()`;

/** Focuses the page's focus-start mark, which takes focus only by script, and returns how many
 * Tab presses reach the focus state from it, its data-focus-start or 1: none with no mark. */
const FOCUS_START = `(() => {
  const mark = document.querySelector("[data-focus-start]");
  if (!mark) return 0;
  mark.focus();
  return Number(mark.dataset.focusStart) || 1;
})()`;

/** The page's preferred cuts, as offsets from its top: each top-level section's top, then each
 * state's figure's top, so a tile seldom splits a state mid-way. */
const BOUNDARIES = `(() => {
  const top = (el) => Math.floor(el.getBoundingClientRect().top + window.scrollY);
  return {
    sections: [...document.querySelectorAll("main > section")].map(top),
    states: [...document.querySelectorAll("main > section figure.state")].map(top),
  };
})()`;

/**
 * The page's tiles, top to bottom, each `[top, height]`, meeting edge to edge. Each tile ends at
 * the lowest section boundary within its last SECTION_SLACK px, else the lowest state boundary
 * within its last STATE_SLACK px, else TILE px down; the last ends at the page's foot.
 * @param {number} height The page's height.
 * @param {{ sections: number[], states: number[] }} boundaries
 * @returns {[number, number][]}
 */
function tiles(height, { sections, states }) {
  /** @type {[number, number][]} */
  const result = [];
  for (let top = 0; top < height;) {
    let end = Math.min(top + TILE, height);
    if (end < height) {
      /** @param {number} slack */
      const within = (slack) => (/** @type {number} */ offset) =>
        offset > end - slack && offset <= end;
      end =
        Math.max(...sections.filter(within(SECTION_SLACK)), 0) ||
        Math.max(...states.filter(within(STATE_SLACK)), 0) ||
        end;
    }
    result.push([top, end - top]);
    top = end;
  }
  return result;
}

/**
 * Sets each attribute on the page's root.
 * @param {Page} page
 * @param {Record<string, string>} attributes
 */
function setRoot(page, attributes) {
  return page.evaluate(`(() => {
    const root = document.documentElement;
    for (const [name, value] of Object.entries(${JSON.stringify(attributes)})) {
      root.setAttribute(name, value);
    }
  })()`);
}

/**
 * Sets the page's viewport.
 * @param {Page} page
 * @param {Viewport} viewport
 */
function setViewport(page, { width, height }) {
  return page.cdp("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
}

/**
 * Runs the screenshot command over its arguments, resolving to the exit code.
 * @param {string[]} argv
 * @returns {Promise<number>}
 */
export async function main(argv) {
  const [path, ...args] = argv;
  if (path === undefined || path.startsWith("-")) {
    console.error(usage([]));
    return 2;
  }
  const description = await load(path);
  const { facets } = description;

  /** @type {import("node:util").ParseArgsOptionsConfig} */
  const options = {
    all: { type: "boolean" },
    page: { type: "string", multiple: true },
    scheme: { type: "string", multiple: true },
    output: { type: "string", default: "directory" },
    dir: { type: "string" },
    keep: { type: "boolean" },
  };
  for (const { flag } of facets) options[flag] = { type: "string" };
  let values;
  try {
    ({ values } = parseArgs({ args, options, strict: true, allowPositionals: false }));
  } catch (error) {
    console.error(`${NAME}: ${/** @type {Error} */ (error).message}\n${usage(facets)}`);
    return 2;
  }
  const schemes = /** @type {string[] | undefined} */ (values.scheme);
  const output = /** @type {string} */ (values.output);
  /** @type {Map<string, string>} Each facet flag given, by flag, to the name it gives. */
  const named = new Map();
  for (const { flag } of facets) {
    if (values[flag] !== undefined) named.set(flag, /** @type {string} */ (values[flag]));
  }
  const misuse =
    (values.all && named.size > 0 && "--all takes no facet flag") ||
    (schemes &&
      (schemes.length > 1 || !SCHEMES.includes(schemes[0])) &&
      "--scheme takes light or dark, once") ||
    (!OUTPUTS.includes(output) && `--output takes ${OUTPUTS.join(", ")}`);
  if (misuse) {
    console.error(`${NAME}: ${misuse}\n${usage(facets)}`);
    return 2;
  }
  const show = outputs[output];
  if (!show) {
    console.error(`${NAME}: --output ${output} is not yet implemented; use --output directory`);
    return 1;
  }

  // The run's pages: those --page names, in the description's order, or every page. An unknown
  // name lists the pages, before the server or the browser starts.
  const chosen = /** @type {string[] | undefined} */ (values.page);
  const names = description.pages.map(({ name }) => name);
  const unknownPage = chosen?.find((name) => !names.includes(name));
  if (unknownPage !== undefined) {
    console.error(`${NAME}: unknown page ${unknownPage}; the pages: ${names.join(", ")}`);
    return 2;
  }

  /** @type {Record<string, string>} The default profile: each facet's default, by flag. */
  const defaults = Object.fromEntries(facets.map((facet) => [facet.flag, facet.default]));
  const profiles = values.all
    ? description.all.map((over) => ({ ...defaults, ...over }))
    : [{ ...defaults, ...Object.fromEntries(named) }];

  // Each state numbered by its place among every page's states, so a file's name is the same
  // whichever pages a run chooses.
  /** @type {{ page: DescribedPage, state: DescribedState, number: number }[]} */
  const captures = [];
  let number = 0;
  for (const page of description.pages) {
    for (const state of page.states ?? [{ full: true }]) {
      number++;
      if (!chosen || chosen.includes(page.name)) captures.push({ page, state, number });
    }
  }
  const pages = description.pages.filter(({ name }) => !chosen || chosen.includes(name));

  const written = files(/** @type {string | undefined} */ (values.dir));
  const shown = show(written);
  const server = await serve(
    /** @type {import("./server.js").ServeOptions} */ (description.server),
  );
  /** @type {Browser | undefined} */
  let browser;
  try {
    browser = await launch();
    /** @param {DescribedPage} page */
    const url = (page) => new URL(page.path, `${server.origin}/`).href;

    // Each named profile checked against every run page's registry, read once the page loads,
    // so the profiles its modules register count, and before any capture.
    if (named.size > 0 && description.profiles) {
      for (const page of pages) {
        const tab = await browser.open(url(page));
        try {
          await description.prepare?.(tab);
          await tab.evaluate(RENDERED);
          const registry = await description.profiles(tab);
          for (const [flag, name] of named) {
            const registered = registry[flag] ?? [];
            if (!registered.includes(name)) {
              console.error(
                `${NAME}: unknown ${flag} ${name}; the ${flag}s ${page.path} registers: ${registered.join(", ")}`,
              );
              return 2;
            }
          }
        } finally {
          await tab.close();
        }
      }
    }

    for (const { page, state, number } of captures) {
      const name = `${number}-${state.name ?? page.name}`;
      const caption = state.caption ?? page.caption;
      const viewport = state.viewport ?? VIEWPORT;
      for (const profile of profiles) {
        const label = facets.map(({ flag }) => profile[flag]);
        for (const scheme of schemes ?? SCHEMES) {
          const tab = await browser.open(url(page));
          try {
            await setViewport(tab, viewport);
            await tab.cdp("Emulation.setEmulatedMedia", {
              features: [{ name: "prefers-color-scheme", value: scheme }],
            });
            await description.prepare?.(tab);
            await setRoot(tab, {
              ...Object.fromEntries(facets.map((f) => [f.attribute, profile[f.flag]])),
              "data-scheme": scheme,
            });
            await tab.evaluate(RENDERED);
            await state.open?.(tab);
            // A headless page never has the window's focus, which :focus-visible otherwise needs.
            await tab.cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
            const presses = await tab.evaluate(FOCUS_START);
            for (let press = 0; press < presses; press++) await pressTab(tab);
            await tab.evaluate(SETTLED);

            /** @type {[number, number][] | undefined} The full page's tiles. */
            let cuts;
            if (state.full) {
              const { cssContentSize } = await tab.cdp("Page.getLayoutMetrics");
              const height = Math.ceil(cssContentSize.height);
              cuts = tiles(height, await tab.evaluate(BOUNDARIES));
              // The viewport as tall as the page, so every tile lies inside it: Chromium paints
              // a scrolling region's scrollbars only inside the viewport, and a capture beyond it
              // would drop them below the first screen. The width stays, so the layout doesn't.
              await setViewport(tab, { ...viewport, height: Math.max(viewport.height, height) });
              await tab.evaluate(SETTLED);
            }
            const clips = cuts ?? [undefined];
            for (const [index, cut] of clips.entries()) {
              const { data } = await tab.cdp("Page.captureScreenshot", {
                format: "png",
                ...(cut && {
                  clip: { x: 0, y: cut[0], width: viewport.width, height: cut[1], scale: 1 },
                }),
              });
              const [suffix, count] =
                clips.length > 1
                  ? [`--${index + 1}of${clips.length}`, ` (${index + 1} of ${clips.length})`]
                  : ["", ""];
              const path = written.write(
                `${name}--${[...label, scheme].join("-")}${suffix}.png`,
                Buffer.from(data, "base64"),
              );
              await shown.show({
                path,
                caption: `${caption}: ${[...label, scheme].join(", ")}${count}`,
              });
            }
          } finally {
            await tab.close();
          }
        }
      }
    }
    await shown.end();
    return 0;
  } finally {
    await browser?.close();
    await server.stop();
  }
}
