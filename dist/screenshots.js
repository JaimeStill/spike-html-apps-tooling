// The screenshot command's engine, which bin/screenshots.ts runs: the consumer's description
// module, the first argument, typed as Description, gives the pages, states, facets, and server,
// and the flags choose the profiles, pages, schemes, and output. Each capture is a fresh page,
// rendered and focused by real Tab presses; a full page is cut into tiles.
// Adapted from spike-html-apps-components (8ba2be0), spike-html-apps-foundation (6e9669f), and
// spike-html-apps-noctis (7d7351a): scripts/screenshots.js and scripts/screenshots.sh, in
// TypeScript.
var __rewriteRelativeImportExtension = (this && this.__rewriteRelativeImportExtension) || function (path, preserveJsx) {
    if (typeof path === "string" && /^\.\.?\//.test(path)) {
        return path.replace(/\.(tsx)$|((?:\.d)?)((?:\.[^./]+?)?)\.([cm]?)ts$/i, function (m, tsx, d, ext, cm) {
            return tsx ? preserveJsx ? ".jsx" : ".js" : d && (!ext || !cm) ? m : (d + ext + "." + cm.toLowerCase() + "js");
        });
    }
    return path;
};
import { spawn, spawnSync } from "node:child_process";
import { accessSync, closeSync, constants, mkdirSync, mkdtempSync, openSync, rmdirSync, rmSync, writeFileSync, } from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { SETTLED, launch } from "./browser.js";
import { serve } from "./server.js";
/** The bin's name, which its messages and usage start with. */
const NAME = "spike-html-apps-screenshots";
/** The schemes, each emulated as prefers-color-scheme and set as the root's data-scheme. */
const SCHEMES = ["light", "dark"];
/** The ways the captures are shown, the first the default. */
const OUTPUTS = ["terminal", "directory", "browser"];
/** icat's flags for each image the terminal output shows, before the image's path: the data sent
 * in the escape codes, so it reaches a terminal at the far end of a pty, left-aligned, and scaled
 * to fit the screen's width and height. */
const ICAT = ["--transfer-mode=stream", "--align=left", "--fit=both"];
/** How long, in seconds, icat's support detection waits for the terminal to answer; the process
 * is killed a little after, so a terminal that never answers can't hang the run. */
const DETECTION = 3;
/** The fallback's reason inside a Neovim :terminal, whatever check failed: its pty reports no
 * pixel size and libvterm drops the graphics escape codes, so icat's detection fails there. */
const NVIM = "inside a Neovim :terminal (no pixel size, graphics not passed through)";
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
/** The run's files, in the directory --dir names, or in a fresh one when dir is undefined. */
function files(dir) {
    let target;
    /** The topmost directory the run made, which remove() takes away once it is empty. */
    let made;
    const written = [];
    return {
        write(name, data) {
            if (target === undefined) {
                if (dir === undefined)
                    target = made = mkdtempSync(join(tmpdir(), "screenshots."));
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
            for (const path of written)
                rmSync(path, { force: true });
            if (target === undefined || made === undefined)
                return;
            // Each directory from the target up to the one the run made, each only once it is empty, so
            // a file another hand put there keeps its directory.
            for (let at = target;; at = dirname(at)) {
                try {
                    rmdirSync(at);
                }
                catch {
                    return;
                }
                if (at === made)
                    return;
            }
        },
    };
}
/** Prints the shot's caption, then its path. */
const print = ({ path, caption }) => console.log(`${caption}\n  ${path}`);
/** Whether an executable of the name is on PATH. */
function onPath(name) {
    return (process.env.PATH ?? "").split(delimiter).some((dir) => {
        try {
            accessSync(join(dir || ".", name), constants.X_OK);
            return true;
        }
        catch {
            return false;
        }
    });
}
/**
 * Why the terminal can't show the images, the first check that fails, or undefined when icat can.
 * Detection runs icat with the run's stdin and stdout, in its process group, so it reaches the
 * terminal and isn't stopped for touching /dev/tty; its stderr, where it names the transfer mode,
 * is dropped, and only its exit status counts.
 */
function unshowable(icat) {
    if (!process.stdout.isTTY)
        return "stdout is not a terminal";
    try {
        closeSync(openSync("/dev/tty", "r+"));
    }
    catch {
        return "/dev/tty does not open";
    }
    if (!icat)
        return "kitten not found";
    const [command, ...args] = icat;
    const { status } = spawnSync(command, [...args, "--detect-support", `--detection-timeout=${DETECTION}`], { stdio: ["inherit", "inherit", "ignore"], timeout: (DETECTION + 2) * 1000 });
    if (status !== 0)
        return "kitten icat detection failed";
}
/**
 * Runs the command with the run's stdio, in its process group, resolving to its exit status, or
 * to undefined when it doesn't start.
 */
function exec(command, args, stdio) {
    return new Promise((resolve) => {
        const child = spawn(command, args, { stdio });
        child.once("error", () => resolve(undefined));
        child.once("close", (code) => resolve(code));
    });
}
/** Each character HTML reserves, by its entity. */
const ENTITIES = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
};
/** Escapes the text for HTML. */
const escape = (text) => text.replace(/[&<>"']/g, (char) => ENTITIES[char]);
/**
 * The browser output's gallery: every shot in capture order under its caption, each image by its
 * file's name beside the page, and nothing else loaded: the styles are inline.
 */
function gallery(shots) {
    const figures = shots.map(({ path, caption }) => `<figure><figcaption>${escape(caption)}</figcaption>` +
        `<img src="${escape(encodeURIComponent(basename(path)))}" alt="${escape(caption)}"></figure>`);
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${NAME}</title>
<style>
:root { color-scheme: light dark; font: 14px/1.4 system-ui, sans-serif; }
body { margin: 2rem; }
figure { margin: 0 0 2.5rem; }
figcaption { margin-bottom: 0.5rem; }
img { display: block; max-width: 100%; height: auto; outline: 1px solid GrayText; }
</style>
</head>
<body>
${figures.join("\n")}
</body>
</html>
`;
}
/**
 * The outputs, by --output's name, each given the run's files, so one that cleans up takes away
 * only what the run wrote, and --keep. --keep is the terminal output's: the others keep their
 * files whatever it says.
 */
const outputs = {
    // Prints each caption and its path, and shows each image with kitty's icat when the terminal
    // can, else says why on stderr and names --output browser; it never opens a browser itself.
    // Its files are removed as the run ends, however it ends, SIGINT included, unless --keep, which
    // prints the directory kept.
    terminal: (files, { keep }) => {
        const icat = onPath("kitten")
            ? ["kitten", "icat"]
            : onPath("kitty")
                ? ["kitty", "+kitten", "icat"]
                : undefined;
        /** Whether the terminal can show the images, decided at the first shot, so a run that ends
         * before any, as a usage error does, says nothing of it. */
        let showable;
        const decide = () => {
            const reason = unshowable(icat);
            if (reason !== undefined) {
                console.error(`${NAME}: no images shown: ${process.env.NVIM ? NVIM : reason}; ` +
                    "--output browser shows them in a browser");
            }
            return reason === undefined;
        };
        /** The directory the files are in, once one is written. */
        let dir;
        const remove = () => {
            if (!keep)
                files.remove();
        };
        const interrupt = () => {
            remove();
            process.exit(130);
        };
        if (!keep)
            process.once("SIGINT", interrupt);
        return {
            async show(shot) {
                dir = dirname(shot.path);
                showable ??= decide();
                print(shot);
                if (icat && showable) {
                    const [command, ...args] = icat;
                    await exec(command, [...args, ...ICAT, shot.path], "inherit");
                }
            },
            end() {
                if (keep && dir !== undefined)
                    console.log(`kept in ${dir}`);
            },
            close() {
                process.off("SIGINT", interrupt);
                remove();
            },
        };
    },
    // Writes the files and keeps them, printing each caption and its path.
    directory: () => ({ show: print, end: () => { } }),
    // Writes the files and keeps them, printing each caption and its path, then the gallery beside
    // them, index.html, which it opens with xdg-open as a file:// URL; when that fails it prints the
    // gallery's path on stderr and the run exits 1.
    browser: (files) => {
        const shots = [];
        return {
            show(shot) {
                shots.push(shot);
                print(shot);
            },
            async end() {
                const page = files.write("index.html", Buffer.from(gallery(shots)));
                console.log(`the gallery\n  ${page}`);
                const status = await exec("xdg-open", [pathToFileURL(page).href], "ignore");
                if (status === 0)
                    return;
                console.error(`${NAME}: xdg-open could not open the gallery; open ${page}`);
                return 1;
            },
        };
    },
};
/** The usage line, naming the description's facet flags. */
function usage(facets) {
    const flags = facets.map(({ flag }) => `[--${flag} <name>]`).join(" ");
    const profiles = flags ? `[--all | ${flags}]` : "[--all]";
    return (`usage: ${NAME} <description> ${profiles} [--page <name>]... [--scheme light|dark] ` +
        `[--output ${OUTPUTS.join("|")}] [--dir <path>] [--keep]`);
}
/**
 * The description the module at the path exports by default, its server's root resolved against
 * the module's directory; throws naming what it lacks.
 */
async function load(path) {
    const file = resolve(path);
    const description = (await import(__rewriteRelativeImportExtension(pathToFileURL(file).href))).default;
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
/** Sends Tab, as a keyboard presses it, so the browser moves focus and marks it focus-visible. */
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
 * within its last STATE_SLACK px, else TILE px down; the last ends at the page's foot. The height
 * is the page's.
 */
function tiles(height, { sections, states }) {
    const result = [];
    for (let top = 0; top < height;) {
        let end = Math.min(top + TILE, height);
        if (end < height) {
            const within = (slack) => (offset) => offset > end - slack && offset <= end;
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
/** Sets each attribute on the page's root. */
function setRoot(page, attributes) {
    return page.evaluate(`(() => {
    const root = document.documentElement;
    for (const [name, value] of Object.entries(${JSON.stringify(attributes)})) {
      root.setAttribute(name, value);
    }
  })()`);
}
/** Sets the page's viewport. */
function setViewport(page, { width, height }) {
    return page.cdp("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
    });
}
/**
 * Runs the screenshot command over its arguments, the description module's path then the flags,
 * resolving to the exit code: 0, 1 when the browser output can't open its gallery, or 2 on a
 * usage error, an unknown page, or a profile a page hasn't registered. Any other failure rejects.
 */
export async function main(argv) {
    const [path, ...args] = argv;
    if (path === undefined || path.startsWith("-")) {
        console.error(usage([]));
        return 2;
    }
    const description = await load(path);
    const { facets } = description;
    const flags = {
        all: { type: "boolean" },
        page: { type: "string", multiple: true },
        scheme: { type: "string", multiple: true },
        output: { type: "string", default: OUTPUTS[0] },
        dir: { type: "string" },
        keep: { type: "boolean" },
    };
    const facetFlags = Object.fromEntries(facets.map(({ flag }) => [flag, { type: "string" }]));
    // Object.assign's type is the intersection, so the bin's own flags keep their value types
    // beside the facets' index.
    const options = Object.assign({}, facetFlags, flags);
    let values;
    try {
        ({ values } = parseArgs({ args, options, strict: true, allowPositionals: false }));
    }
    catch (error) {
        console.error(`${NAME}: ${error.message}\n${usage(facets)}`);
        return 2;
    }
    const { scheme: schemes, output } = values;
    /** Each facet flag given, by flag, to the name it gives. */
    const named = new Map();
    for (const { flag } of facets) {
        const name = values[flag];
        if (typeof name === "string")
            named.set(flag, name);
    }
    const misuse = (values.all && named.size > 0 && "--all takes no facet flag") ||
        (schemes &&
            (schemes.length > 1 || !SCHEMES.includes(schemes[0])) &&
            "--scheme takes light or dark, once") ||
        (!OUTPUTS.includes(output) && `--output takes ${OUTPUTS.join(", ")}`);
    if (misuse) {
        console.error(`${NAME}: ${misuse}\n${usage(facets)}`);
        return 2;
    }
    // The run's pages: those --page names, in the description's order, or every page. An unknown
    // name lists the pages, before the server or the browser starts.
    const chosen = values.page;
    const names = description.pages.map(({ name }) => name);
    const unknownPage = chosen?.find((name) => !names.includes(name));
    if (unknownPage !== undefined) {
        console.error(`${NAME}: unknown page ${unknownPage}; the pages: ${names.join(", ")}`);
        return 2;
    }
    /** The default profile: each facet's default, by flag. */
    const defaults = Object.fromEntries(facets.map((facet) => [facet.flag, facet.default]));
    const profiles = values.all
        ? description.all.map((over) => ({ ...defaults, ...over }))
        : [{ ...defaults, ...Object.fromEntries(named) }];
    // Each state numbered by its place among every page's states, so a file's name is the same
    // whichever pages a run chooses.
    const captures = [];
    let number = 0;
    for (const page of description.pages) {
        for (const state of page.states ?? [{ full: true }]) {
            number++;
            if (!chosen || chosen.includes(page.name))
                captures.push({ page, state, number });
        }
    }
    const pages = description.pages.filter(({ name }) => !chosen || chosen.includes(name));
    const written = files(values.dir);
    const shown = outputs[output](written, { keep: values.keep === true });
    let server;
    let browser;
    try {
        server = await serve(description.server);
        const { origin } = server;
        browser = await launch();
        const url = (page) => new URL(page.path, `${origin}/`).href;
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
                            console.error(`${NAME}: unknown ${flag} ${name}; the ${flag}s ${page.path} registers: ${registered.join(", ")}`);
                            return 2;
                        }
                    }
                }
                finally {
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
                        for (let press = 0; press < presses; press++)
                            await pressTab(tab);
                        await tab.evaluate(SETTLED);
                        /** The full page's tiles. */
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
                            const [suffix, count] = clips.length > 1
                                ? [`--${index + 1}of${clips.length}`, ` (${index + 1} of ${clips.length})`]
                                : ["", ""];
                            const path = written.write(`${name}--${[...label, scheme].join("-")}${suffix}.png`, Buffer.from(data, "base64"));
                            await shown.show({
                                path,
                                caption: `${caption}: ${[...label, scheme].join(", ")}${count}`,
                            });
                        }
                    }
                    finally {
                        await tab.close();
                    }
                }
            }
        }
        return (await shown.end()) ?? 0;
    }
    finally {
        await browser?.close();
        await server?.stop();
        shown.close?.();
    }
}
