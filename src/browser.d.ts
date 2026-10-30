// The types of browser.js, for a consumer's type check: tsc reads no JSDoc from a package's .js,
// so the package's exports resolve to these. browser.js takes Browser and Page from here, so the
// two can't drift apart.

// The protocol's results and a page's values are JSON whose shape only the caller knows, so they
// are any, as JSON.parse's are, for the caller to destructure or annotate.
/* eslint-disable @typescript-eslint/no-explicit-any */

/** A browser launch started, until it is closed. */
export interface Browser {
  /** Opens the URL in a new page, resolving to the page once its load event fires. */
  open(url: string): Promise<Page>;
  /** Ends the browser, by Browser.close or after 5 s by a signal, and removes its profile. */
  close(): Promise<void>;
}

/** A page of a browser: 1280×720, en-US, UTC, its scrollbars shown. */
export interface Page {
  /** Loads the URL, resolving once its load event fires. */
  goto(url: string): Promise<void>;
  /** Sends the page one protocol command, resolving to its result. */
  cdp(method: string, params?: Record<string, unknown>): Promise<any>;
  /** Calls the listener with each of the page's events of the method, replacing any before it. */
  on(method: string, listener: (params: any) => void): void;
  /** The expression's value, awaited when it is a promise, as JSON. */
  evaluate(expression: string): Promise<any>;
  /** Closes the page. */
  close(): Promise<void>;
}

/**
 * Launches the browser BROWSER_EXECUTABLE names, resolving once the protocol answers; rejects
 * when BROWSER_EXECUTABLE is unset.
 */
export function launch(): Promise<Browser>;

/**
 * Resolves once the expression is truthy in the page, to its value, polling inside the page;
 * rejects naming the expression and the timeout, 10 s by default, once it passes.
 */
export function until(page: Page, expression: string, timeout?: number): Promise<any>;

/** An expression that resolves once the page's fonts are ready and two frames have painted. */
export const SETTLED: string;
