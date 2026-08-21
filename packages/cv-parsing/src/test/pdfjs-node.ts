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
import { pdfDocumentInit, setPdfJsLoader, type PdfJsLike } from '../pdfjs';
import { makeMinimalPdf } from './fixtures';

/**
 * How long the one-off load of the legacy build is allowed to take.
 *
 * Deliberately separate from, and far larger than, the 15s `testTimeout` in
 * vitest.config.ts. The two measure different things: `testTimeout` bounds a
 * unit of behaviour, which here is milliseconds of work, and wants to stay
 * small so a genuinely hung test says so quickly. This bounds a one-time
 * ~1.2 MB module evaluation on whatever runner we were given. Locally that is
 * under 200ms; on a cold, shared, virus-scanned Windows CI runner it has taken
 * more than 15s, which is what `warmPdfJsLegacyBuild` exists to stop charging
 * to an arbitrary test.
 */
export const PDFJS_WARMUP_TIMEOUT_MS = 60_000;

/**
 * The actual import.
 *
 * Named rather than inline so `warmPdfJsLegacyBuild` and `usePdfJsLegacyBuild`
 * name the SAME specifier — two copies of the string would be two module
 * registry entries the day one of them is edited, and the warm-up would then
 * silently warm the wrong thing.
 */
const loadLegacyBuild = async (): Promise<PdfJsLike> => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjs;
};

/**
 * Load the legacy build NOW, so that no test pays for it.
 *
 * ============================================================================
 * CALL THIS FROM A `beforeAll`, WITH `PDFJS_WARMUP_TIMEOUT_MS` AS ITS TIMEOUT.
 * ============================================================================
 * `usePdfJsLegacyBuild` only REGISTERS a loader; the import it describes does
 * not happen until `extractPdfText` first calls it, which is inside a test. So
 * without this, one arbitrary test per file — whichever happens to touch a PDF
 * first — is billed for the whole module load and can time out while every
 * later test in the same file passes in single-digit milliseconds. That exact
 * signature failed CI on windows-latest.
 *
 * After this has run, the module is resident in the runner's registry, so the
 * loader `usePdfJsLegacyBuild` installs resolves from cache.
 *
 * IT MUTATES NO PARSER STATE. It never calls `setPdfJsLoader` or
 * `configurePdfJs`, so it cannot pre-fill the cached module promise that
 * `resetPdfJs()` exists to clear, and it cannot leave a loader installed that a
 * test did not ask for. `beforeEach` is untouched: every test still resets and
 * installs its own loader, and the tests that swap in a deliberately broken
 * pdf.js still get theirs — which is the guard proving no warm module leaks past
 * the seam. The only thing now shared across a file is the module registry
 * entry, which tests two onwards already shared before this existed.
 */
export async function warmPdfJsLegacyBuild(): Promise<void> {
  const pdfjs = await loadLegacyBuild();

  // The import is only about two thirds of it. Measured on this machine, the
  // first test in a file cost 190ms; importing the module here left 64ms still
  // in that test, because pdf.js does its own lazy set-up — the fake worker, the
  // font and image decoders — on the first document, not at module scope. So the
  // first document is opened here too, and the first page read, which is the
  // whole of what `pdf.ts` asks of the library.
  //
  // Deliberately NOT routed through `extractPdfText`: this hook warms pdf.js, it
  // does not test our parser. Asserting our own extraction here would mean a
  // broken text layer reported itself as "a hook failed" instead of as the
  // happy-path test failing with expected-versus-actual.
  const task = pdfjs.getDocument(pdfDocumentInit(makeMinimalPdf('warm up')));
  try {
    const document = await task.promise;
    const page = await document.getPage(1);
    await page.getTextContent();
  } finally {
    await task.destroy();
  }
}

/**
 * Point the parser at the Node-compatible pdf.js build for this test file.
 *
 * Vitest gives each test file its own module registry, so this has to be called
 * in every file that parses a PDF — module state does not leak between them.
 * For the same reason, each such file needs its own `warmPdfJsLegacyBuild`.
 */
export function usePdfJsLegacyBuild(): void {
  setPdfJsLoader(loadLegacyBuild);
}
