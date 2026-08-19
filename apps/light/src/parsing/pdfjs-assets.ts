/**
 * Where pdf.js finds its runtime assets in the packaged app.
 *
 * ============================================================================
 * THE BUG THIS FILE EXISTS TO PREVENT
 * ============================================================================
 * pdf.js resolves its worker, character maps and font metrics at RUNTIME, not
 * at build time. If they are not configured it falls back to fetching them
 * relative to `document.baseURI` — which resolves to something that happens to
 * exist under `vite dev`, and to nothing at all once the app is packaged and
 * served from `tauri://`. So CV upload works on every developer machine, passes
 * review, and is broken in the shipped build. It is the single most common
 * pdf.js deployment bug, and no unit test in this repo can catch it, because a
 * unit test has no packaged app to run in.
 *
 * The defence is that this module is the only place those URLs are decided,
 * they all come from things the bundler has actually resolved, and
 * `main.tsx` calls `configurePdfJsAssets()` before anything can parse a CV.
 */
import { configurePdfJs } from '@cviper/cv-parsing';
// `?url` and NOT `?worker`.
//
// pdf.js constructs its own worker — `new Worker(workerSrc, { type: 'module' })`
// — so all it wants is an address. `?worker` would make Vite bundle the worker
// itself, and Vite's default worker format is `iife`, which handles the
// dynamic `import()` inside the pdf.js worker badly.
//
// `?url` also keeps the Content-Security-Policy simple: pdf.js only wraps
// `workerSrc` in a `blob:` URL when it is CROSS-origin, and Vite emits this as
// a same-origin `/assets/pdf.worker-<hash>.mjs`. No blob, no CSP exception.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

/**
 * Where the copied pdf.js data directories live, relative to the app root.
 *
 * These are NOT imported — they are hundreds of small files that pdf.js fetches
 * by name at runtime, so they are copied into `public/pdfjs/` by the
 * `cviper-copy-pdfjs-assets` plugin in `vite.config.ts` and served as static
 * files. Keep this path and the plugin's target in step.
 */
const PDFJS_PUBLIC_BASE = '/pdfjs';

/** Character maps. Without them an encoded or CJK CV extracts as mojibake. */
export const CMAP_URL = `${PDFJS_PUBLIC_BASE}/cmaps/`;

/**
 * Metrics for the standard 14 PDF fonts.
 *
 * pdf.js warns "Ensure that the `standardFontDataUrl` API parameter is
 * provided" during TEXT extraction, not just rendering — most CVs exported
 * from Word lean on these fonts.
 */
export const STANDARD_FONT_DATA_URL = `${PDFJS_PUBLIC_BASE}/standard_fonts/`;

/**
 * Point the parser at all of it. Call once, at startup, before any extraction.
 *
 * `wasmUrl` and `iccUrl` are deliberately NOT set. pdf.js uses those for image
 * decoding and colour management while RENDERING a page, and this app only ever
 * asks for text — so shipping them would add about 1.6 MB to the installer to
 * support a code path nothing calls. `@cviper/cv-parsing` accepts both already,
 * so whenever a page preview lands, add the copy here and set them.
 */
export function configurePdfJsAssets(): void {
  configurePdfJs({
    workerSrc: pdfWorkerUrl,
    cMapUrl: CMAP_URL,
    standardFontDataUrl: STANDARD_FONT_DATA_URL,
  });
}
