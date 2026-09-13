/**
 * The app's real extraction path, reachable from a WebKit page.
 *
 * ============================================================================
 * THIS FILE ADDS NO BEHAVIOUR. IT ONLY MAKES THE APP'S OWN CODE CALLABLE.
 * ============================================================================
 * Every line that matters is imported:
 *
 *   - `configurePdfJsAssets()` is the app's OWN wiring module — the same call
 *     `src/main.tsx` makes at startup, with the same worker `?url`, the same
 *     `/pdfjs/cmaps/` and the same `/pdfjs/standard_fonts/`. It is imported
 *     rather than copied precisely so the check cannot drift from the app: if
 *     somebody changes where pdf.js looks for its worker, this changes with it.
 *   - `extractPdfText` is the shipped parser, including the page loop, the text
 *     joining and the scan verdict. The spec asserts on the `Result` it returns,
 *     not on raw pdf.js output, so "a scan produces NO_TEXT_LAYER rather than
 *     silently empty text" is a claim about the app rather than about pdf.js.
 *
 * `setPdfJsLoader` is deliberately NEVER called here. That is the seam
 * `packages/cv-parsing/src/pdfjs.ts` exists for and the reason the Node tests
 * run the LEGACY build; leaving it alone is what makes this page load
 * `import('pdfjs-dist')` — the modern build, the one users run.
 *
 * Nothing here reaches Tauri. `extractPdfText` is pure over bytes, and the bytes
 * arrive over a same-origin `fetch` rather than from a file dialog, because a
 * WebDriver-free browser page cannot open one. That substitution is honest about
 * what it skips: the Rust file read and the IPC hop, neither of which pdf.js or
 * the Content-Security-Policy can see.
 */
import type { Result } from '@cviper/core-types';
import {
  extractPdfText,
  getPdfJsAssetUrls,
  type ExtractedDocument,
  type ParseError,
  type PdfJsAssetUrls,
} from '@cviper/cv-parsing';

import { configurePdfJsAssets } from '../../src/parsing/pdfjs-assets';

// Exactly as `main.tsx` does it, before anything can parse a CV.
configurePdfJsAssets();

/** What the spec calls through `window.__cviperWebKitHarness`. */
export interface WebKitHarness {
  /** Whatever `configurePdfJsAssets()` actually installed. */
  assets(): PdfJsAssetUrls;
  /** The shipped extractor, over bytes fetched from a same-origin URL. */
  extract(url: string): Promise<Result<ExtractedDocument, ParseError>>;
  /** The HTTP status of a same-origin GET. Proves the data files are served. */
  probe(url: string): Promise<number>;
}

const harness: WebKitHarness = {
  assets: () => getPdfJsAssetUrls(),

  extract: async (url) => {
    const response = await fetch(url);
    if (!response.ok) {
      // Thrown rather than returned as a `ParseError`: a fixture the test
      // server did not serve is a broken CHECK, and dressing it up as a parse
      // failure would make a broken check look like a finding about pdf.js.
      throw new Error(`the harness could not fetch ${url}: HTTP ${String(response.status)}`);
    }
    return extractPdfText(new Uint8Array(await response.arrayBuffer()));
  },

  probe: async (url) => (await fetch(url)).status,
};

// Assigned LAST. The spec waits for this property to appear, so it must not
// exist until `configurePdfJsAssets()` has run and the methods are callable.
(globalThis as unknown as { __cviperWebKitHarness: WebKitHarness }).__cviperWebKitHarness = harness;
