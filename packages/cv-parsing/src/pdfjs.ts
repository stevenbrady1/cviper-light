/**
 * The one place that knows pdf.js exists.
 *
 * ============================================================================
 * WHY THERE IS A SEAM HERE AT ALL
 * ============================================================================
 * pdfjs-dist ships two builds of the same library, and they are not
 * interchangeable across environments:
 *
 *   - `pdfjs-dist` (modern) is what the packaged app runs. It needs a browser:
 *     `build/pdf.mjs` evaluates `new DOMMatrix()` at module top level, and
 *     parsing then needs `Uint8Array.prototype.toHex`. Node 24 has neither.
 *   - `pdfjs-dist/legacy/build/pdf.mjs` is the SAME library compiled for older
 *     runtimes, with both polyfilled. pdf.js itself prints "Please use the
 *     `legacy` build in Node.js environments" if you get this wrong.
 *
 * So the module is loaded through a replaceable function. The app gets the
 * default (modern, in a browser, with a real worker); Node tests swap in the
 * legacy build; and a test that needs a pdf.js which fails in some specific way
 * can supply one, which is the only way the partial-failure branches in
 * `pdf.ts` are ever executed.
 *
 * Everything else — the options we pass, the page loop, the text joining, the
 * scan detection, the error mapping — is identical whichever build is loaded.
 *
 * ============================================================================
 * THE ASSET URLS ARE NOT OPTIONAL IN A PACKAGED APP
 * ============================================================================
 * pdf.js resolves its worker, character maps and font data at RUNTIME. Left
 * unset they are fetched relative to `document.baseURI`, which happens to work
 * under `vite dev` and fails once the app is packaged — the single most common
 * pdf.js deployment bug, and one that no test in this package can catch,
 * because there is no packaged app in a unit test. `apps/light` therefore calls
 * `configurePdfJs` at startup with URLs that Vite has resolved and emitted.
 *
 * This module deliberately does NOT import `pdfjs-dist` at the top level, so
 * the app's asset-wiring module can be loaded, and tested, in Node without
 * dragging a browser-only library in with it.
 */

/** A text run from `getTextContent()`. `TextMarkedContent` items have no `str`. */
export interface PdfTextItemLike {
  readonly str?: string;
  readonly hasEOL?: boolean;
}

export interface PdfTextContentLike {
  readonly items: readonly unknown[];
}

export interface PdfPageLike {
  getTextContent(): Promise<PdfTextContentLike>;
}

export interface PdfDocumentLike {
  readonly numPages: number;
  getPage(pageNumber: number): Promise<PdfPageLike>;
}

export interface PdfLoadingTaskLike {
  readonly promise: Promise<PdfDocumentLike>;
  destroy(): Promise<void>;
}

/** The subset of `DocumentInitParameters` this package sets. */
export interface PdfDocumentInit {
  data: Uint8Array;
  isEvalSupported: boolean;
  cMapUrl?: string;
  cMapPacked?: boolean;
  standardFontDataUrl?: string;
  wasmUrl?: string;
  iccUrl?: string;
}

/** The slice of the pdf.js module surface this package uses. */
export interface PdfJsLike {
  readonly GlobalWorkerOptions: { workerSrc: string };
  getDocument(src: PdfDocumentInit): PdfLoadingTaskLike;
}

export type PdfJsLoader = () => Promise<PdfJsLike>;

/** Runtime URLs for the assets pdf.js fetches. `null` means "not configured". */
export interface PdfJsAssetUrls {
  readonly workerSrc: string | null;
  readonly cMapUrl: string | null;
  readonly standardFontDataUrl: string | null;
  readonly wasmUrl: string | null;
  readonly iccUrl: string | null;
}

/** What `configurePdfJs` accepts. Omit anything you are not shipping. */
export interface PdfJsOptions {
  /** The pdf.js worker script. Must be SAME-ORIGIN — see the note below. */
  readonly workerSrc?: string;
  /** Directory of character maps, with a trailing slash. Needed for CJK CVs. */
  readonly cMapUrl?: string;
  /** Directory of the standard 14 font metrics, with a trailing slash. */
  readonly standardFontDataUrl?: string;
  /** Directory of the image-decoder WASM modules, with a trailing slash. */
  readonly wasmUrl?: string;
  /** Directory of ICC colour profiles, with a trailing slash. */
  readonly iccUrl?: string;
}

const NO_ASSETS: PdfJsAssetUrls = {
  workerSrc: null,
  cMapUrl: null,
  standardFontDataUrl: null,
  wasmUrl: null,
  iccUrl: null,
};

/**
 * The production loader.
 *
 * This is also the one place TypeScript checks our narrow `PdfJsLike` against
 * the real pdf.js types: if pdf.js changes shape under us, the return here
 * stops compiling instead of failing at runtime in front of a user.
 */
const defaultLoader: PdfJsLoader = async (): Promise<PdfJsLike> => {
  const pdfjs = await import('pdfjs-dist');
  return pdfjs;
};

let loader: PdfJsLoader = defaultLoader;
let modulePromise: Promise<PdfJsLike> | null = null;
let assets: PdfJsAssetUrls = NO_ASSETS;

/**
 * Tell the parser where pdf.js should fetch its runtime assets from.
 *
 * Call once at app startup, before the first extraction. Calling it again
 * replaces the previous configuration wholesale — there is no merging, so a
 * partial second call would silently drop URLs from the first.
 */
export function configurePdfJs(options: PdfJsOptions): void {
  assets = {
    workerSrc: options.workerSrc ?? null,
    cMapUrl: options.cMapUrl ?? null,
    standardFontDataUrl: options.standardFontDataUrl ?? null,
    wasmUrl: options.wasmUrl ?? null,
    iccUrl: options.iccUrl ?? null,
  };
}

/** What is currently configured. Exists so the app can assert its own wiring. */
export function getPdfJsAssetUrls(): PdfJsAssetUrls {
  return assets;
}

/** Replace the pdf.js module loader. For tests and for Node. */
export function setPdfJsLoader(next: PdfJsLoader): void {
  loader = next;
  modulePromise = null;
}

/** Back to a clean slate: production loader, no asset URLs, nothing cached. */
export function resetPdfJs(): void {
  loader = defaultLoader;
  modulePromise = null;
  assets = NO_ASSETS;
}

/**
 * Load pdf.js once and hand it back, with `workerSrc` applied.
 *
 * `workerSrc` is applied on every call rather than only on first load, so it
 * does not matter whether the app configures before or after something else
 * triggered the import.
 *
 * SAME-ORIGIN MATTERS: pdf.js wraps a cross-origin `workerSrc` in a `blob:`
 * URL, which a strict Content-Security-Policy then blocks. A URL Vite emitted
 * (`/assets/pdf.worker-<hash>.mjs`) is same-origin, so no blob is created and
 * no CSP relaxation is needed. Do not "helpfully" point this at a CDN.
 */
export async function getPdfJs(): Promise<PdfJsLike> {
  modulePromise ??= loader();
  const pdfjs = await modulePromise;
  if (assets.workerSrc !== null && pdfjs.GlobalWorkerOptions.workerSrc !== assets.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = assets.workerSrc;
  }
  return pdfjs;
}

/**
 * Build the `getDocument` parameters for a document we want text out of.
 *
 * `isEvalSupported: false` turns off pdf.js's use of `eval`-like font
 * compilation. It costs rendering speed we do not need — we never draw a page —
 * and removes the reason to loosen the app's CSP.
 *
 * Asset URLs are only set when configured: `exactOptionalPropertyTypes` means
 * an explicit `undefined` is not the same as an absent key, and pdf.js checks
 * for absence.
 */
export function pdfDocumentInit(data: Uint8Array): PdfDocumentInit {
  const init: PdfDocumentInit = { data, isEvalSupported: false };

  if (assets.cMapUrl !== null) {
    init.cMapUrl = assets.cMapUrl;
    // The shipped cmaps are the packed (binary) ones. Saying otherwise makes
    // pdf.js read them as text and quietly get no character mappings at all.
    init.cMapPacked = true;
  }
  if (assets.standardFontDataUrl !== null) init.standardFontDataUrl = assets.standardFontDataUrl;
  if (assets.wasmUrl !== null) init.wasmUrl = assets.wasmUrl;
  if (assets.iccUrl !== null) init.iccUrl = assets.iccUrl;

  return init;
}
