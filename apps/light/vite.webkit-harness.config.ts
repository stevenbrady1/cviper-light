/**
 * The build behind `pnpm webkit` — `e2e/webkit/index.html`, production-built.
 *
 * ============================================================================
 * WHY A SECOND BUILD AND NOT THE APP'S OWN `dist`
 * ============================================================================
 * The app's bundle mounts React, which reaches for the Tauri IPC bridge on the
 * first render; in a plain browser that is a broken page rather than a broken
 * pdf.js, and it would hide the answer the check exists to get. Worse, the only
 * way to call `extractPdfText` from inside that bundle would be a seam exported
 * to `window` — and that bundle is the one the installer carries, so the seam
 * would ship to users. `no-automation-server-in-shipped-builds.contract.test.ts`
 * exists because this repository has already made that mistake once.
 *
 * So the harness is its own page, built by the same Vite from the same sources.
 * What it does NOT prove, said plainly here rather than discovered later: this
 * is not the byte-identical bundle in the installer. The shipped bundle is
 * driven by `.github/workflows/smoke.yml`, on WebView2.
 *
 * ============================================================================
 * WHAT IS SHARED WITH THE APP, DELIBERATELY
 * ============================================================================
 *   - `copyPdfJsAssets` is IMPORTED from `vite.config.ts`, not re-declared, so
 *     the cmaps and standard fonts land in the same `public/pdfjs/` the app
 *     serves them from. A second copier would be a second thing to keep in step.
 *   - `publicDir` is the app's own `public/`, so `/pdfjs/cmaps/…` and
 *     `/pdfjs/standard_fonts/…` resolve at the same URLs the app uses.
 *   - The page's module imports `src/parsing/pdfjs-assets.ts` directly, so the
 *     worker URL is whatever the app configures.
 *
 * React and Tailwind are absent on purpose: no JSX and no stylesheet exists in
 * this entry, and a plugin that compiles nothing is a plugin that can break the
 * build for no reason.
 */
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

import { copyPdfJsAssets } from './vite.config.ts';

/** Absolute, because Vite resolves `root`-relative paths against `root`. */
const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  root: here('./e2e/webkit'),
  publicDir: here('./public'),
  plugins: [copyPdfJsAssets()],
  build: {
    outDir: here('./e2e/webkit/dist'),
    emptyOutDir: true,
    // Not minified. When this check goes red the next question is always "what
    // did pdf.js actually do", and a readable stack in the WebKit console is
    // worth more here than bytes nobody downloads.
    minify: false,
  },
  // A stray `.env` in the tree must not reach a page that exists to be read in
  // a CI log.
  envPrefix: ['CVIPER_HARNESS_NOTHING_'],
});
