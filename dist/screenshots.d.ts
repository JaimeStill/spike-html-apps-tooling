import { type Page } from "./browser.ts";
import { type ServeOptions } from "./server.ts";
/** A viewport's size, in CSS px. */
export interface Viewport {
    width: number;
    height: number;
}
/**
 * A step the bin runs on a capture's page, resolving once the page is ready for the next: a
 * prepare step before the root's attributes are set, an open step after the page has rendered.
 */
export type Step = (page: Page) => Promise<void>;
/**
 * A facet of the profile: its flag, `--<flag> <name>`, the root attribute its name is set on, and
 * the name it takes when no flag names one.
 */
export interface Facet {
    /** The flag's name, without its dashes: lowercase letters and dashes, as `palette`. */
    flag: string;
    /** The root attribute set to the facet's name, as `data-palette`. */
    attribute: string;
    /** The facet's name when no flag names one. */
    default: string;
}
/** One capture of a page: its viewport, and whether it takes the whole page or the viewport. */
export interface DescribedState {
    /** The files' name, after their number; the page's name by default. */
    name?: string;
    /** The captions' text, before the profile and scheme; the page's caption by default. */
    caption?: string;
    /** The viewport the page lays out in; 1280×800 by default. */
    viewport?: Viewport;
    /**
     * True: the page's whole height, the viewport grown to it, cut into tiles of at most 1200 px.
     * False: the viewport alone, at its own size.
     */
    full: boolean;
    /** Brings the page to the state, once it has rendered and before focus is reached. */
    open?: Step;
}
/** A page the bin captures, chosen by `--page <name>`. */
export interface DescribedPage {
    /** The page's name: `--page`'s, and its files' unless a state names them. */
    name: string;
    /** The captions' text, before the profile and scheme, unless a state gives its own. */
    caption: string;
    /** The page's path under the server's origin, as `demo/tools.html`. */
    path: string;
    /** The page's captures, in order; one full-page capture by default. */
    states?: DescribedState[];
}
/** A consumer's captures, the default export of the module the bin's first argument names. */
export interface Description {
    /** The pages, in the order they're captured and numbered. */
    pages: DescribedPage[];
    /** The profile's facets, in the order the files' names and captions give them. */
    facets?: Facet[];
    /** `--all`'s profiles, each the facets' names it sets over the defaults, by flag. */
    all?: Record<string, string>[];
    /**
     * Each facet's registered names on a loaded page, by flag, which a name `--<flag>` gives is
     * checked against before any capture; with none, the names given are not checked.
     */
    profiles?: (page: Page) => Promise<Record<string, readonly string[]>>;
    /** Runs on every page once it loads, before the root's attributes are set. */
    prepare?: Step;
    /**
     * The server the pages are served from: serve's options, the root resolved against the
     * description module's directory, which it is by default.
     */
    server?: Partial<ServeOptions>;
}
/**
 * Runs the screenshot command over its arguments, the description module's path then the flags,
 * resolving to the exit code: 0, 1 when the browser output can't open its gallery, or 2 on a
 * usage error, an unknown page, or a profile a page hasn't registered. Any other failure rejects.
 * --help, or -h, anywhere among them wins, resolving to 0 before the server or the browser starts.
 */
export declare function main(argv: string[]): Promise<number>;
