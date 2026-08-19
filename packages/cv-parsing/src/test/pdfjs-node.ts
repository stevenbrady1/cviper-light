/**
 * Wiring pdf.js into a Node test run.
 *
 * ============================================================================
 * WHY THE TESTS LOAD A DIFFERENT BUILD FROM THE APP
 * ============================================================================
 * pdfjs-dist ships two builds of the same library. `pdfjs-dist` (the modern
 * one) targets current browsers and CANNOT be imported in Node 24:
 *
 *   1. `build/pdf.mjs` evaluates `new DOMMatrix()` at module top level, and
 *      Node has no DOMMatrix.
 *   2. Past that, parsing dies on `hashOriginal.toHex is not a function` —
 *      `Uint8Array.prototype.toHex` is a very recent addition that Node 24
 *      does not have.
 *
 * Both were reproduced against the installed copy, not assumed. pdf.js itself
 * prints "Please use the `legacy` build in Node.js environments" the moment you
 * import the modern one under Node, which is exactly what this does.
 *
 * The legacy build is the SAME pdf.js — same parser, same `getTextContent`,
 * same exceptions — compiled to an older target with those two features
 * polyfilled. So everything this package owns (the options we pass, the page
 * loop, the text joining, the scan detection, the error mapping) is exercised
 * against the real library. What is NOT covered here is the modern build's own
 * module init and the browser worker handshake; that is covered by the app at
 * runtime and by `apps/light` building successfully. Said plainly in the
 * report rather than papered over.
 */
import { setPdfJsLoader, type PdfJsLike } from '../pdfjs';

/**
 * Point the parser at the Node-compatible pdf.js build for this test file.
 *
 * Vitest gives each test file its own module registry, so this has to be called
 * in every file that parses a PDF — module state does not leak between them.
 */
export function usePdfJsLegacyBuild(): void {
  setPdfJsLoader(async (): Promise<PdfJsLike> => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    return pdfjs;
  });
}
