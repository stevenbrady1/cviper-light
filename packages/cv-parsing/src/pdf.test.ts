import { beforeEach, describe, expect, it } from 'vitest';

import { MAX_FILE_BYTES } from './constants';
import { extractPdfText } from './pdf';
import { resetPdfJs, setPdfJsLoader, type PdfJsLike } from './pdfjs';
import {
  EMPTY_FILE,
  makeEncryptedPdf,
  makeLegacyDocFile,
  makeMinimalDocx,
  makeMinimalPdf,
  makeOversizedPdf,
  makePdfFromPages,
  makePlainTextFile,
  makeScannedPdf,
  makeTruncatedPdf,
} from './test/fixtures';
import { usePdfJsLegacyBuild } from './test/pdfjs-node';

beforeEach(() => {
  resetPdfJs();
  usePdfJsLegacyBuild();
});

describe('extractPdfText — happy path', () => {
  it('reads the text out of a single-page PDF', async () => {
    const result = await extractPdfText(makeMinimalPdf('Senior Credit Risk Analyst'));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.text).toBe('Senior Credit Risk Analyst');
    expect(result.value.pageCount).toBe(1);
    expect(result.value.warnings).toEqual([]);
  });

  it('reads every page and reports the page count', async () => {
    const pages = [
      'Page one: Barclays, London. IFRS 9 staging logic and COREP reporting duties.',
      'Page two: HSBC, London. Counterparty credit risk, VaR and stress testing.',
      'Page three: Education, certifications and references available on request.',
    ];
    const result = await extractPdfText(makePdfFromPages(pages));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.pageCount).toBe(3);
    expect(result.value.text).toContain('Barclays');
    expect(result.value.text).toContain('HSBC');
    expect(result.value.text).toContain('references available on request');
    expect(result.value.warnings).toEqual([]);
  });

  it('normalises the extracted text', async () => {
    const result = await extractPdfText(
      makeMinimalPdf('Credit    Risk\nAnalyst at a very well known London bank indeed'),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.text).toContain('Credit Risk');
    expect(result.value.text).not.toMatch(/ {2}/);
  });

  it('does not detach or mutate the buffer the caller handed us', async () => {
    // pdf.js transfers the ArrayBuffer it is handed to its worker, which
    // detaches the caller's view. A caller that kept the bytes to retry with a
    // different parser, or to hash them, gets an empty array instead — and the
    // failure only shows up in the packaged app, where a real worker exists.
    const bytes = makeMinimalPdf('Senior Credit Risk Analyst');
    const before = Uint8Array.from(bytes);

    await extractPdfText(bytes);

    expect(bytes.byteLength).toBe(before.byteLength);
    expect(Array.from(bytes)).toEqual(Array.from(before));
  });
});

describe('extractPdfText — the scanned CV', () => {
  it('refuses a PDF with pages but no text layer, and says it looks like a scan', async () => {
    const result = await extractPdfText(makeScannedPdf(2));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NO_TEXT_LAYER');
    expect(result.error.message).toMatch(/scan/i);
    expect(result.error.message).toMatch(/2 pages/);
    if (result.error.code !== 'NO_TEXT_LAYER') return;
    expect(result.error.pageCount).toBe(2);
  });

  it('warns — but still returns the text — when a PDF is mostly images', async () => {
    // The nastier case: one page carries a scrap of real text (a header, a page
    // number) and the rest is scanned images. There IS text, so refusing would
    // be wrong, but analysing it as if it were a whole CV would be worse.
    const result = await extractPdfText(makePdfFromPages(['Jane Smith', null, null, null]));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.text).toBe('Jane Smith');
    expect(result.value.pageCount).toBe(4);
    expect(result.value.warnings).toHaveLength(1);
    expect(result.value.warnings[0]).toMatch(/scan|image/i);
  });

  it('does not warn when there is a normal amount of text per page', async () => {
    const body = 'Senior Credit Risk Analyst at Barclays London, IFRS 9 and COREP. '.repeat(3);
    const result = await extractPdfText(makePdfFromPages([body, body]));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.warnings).toEqual([]);
  });
});

describe('extractPdfText — negative cases', () => {
  it('reports a password-protected PDF as such', async () => {
    const result = await extractPdfText(makeEncryptedPdf());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('PASSWORD_PROTECTED');
    expect(result.error.message).toMatch(/password/i);
  });

  it('reports a truncated PDF as corrupt', async () => {
    const result = await extractPdfText(makeTruncatedPdf());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CORRUPT_FILE');
    expect(result.error.message).toMatch(/damaged|corrupt/i);
  });

  it('rejects an empty file before it reaches the parser', async () => {
    const result = await extractPdfText(EMPTY_FILE);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('EMPTY_FILE');
  });

  it('rejects a .docx handed to the PDF parser', async () => {
    const result = await extractPdfText(makeMinimalDocx(['Senior Credit Risk Analyst']));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('FORMAT_MISMATCH');
    expect(result.error.message).toMatch(/word/i);
  });

  it('rejects a legacy .doc with re-save advice rather than a parse error', async () => {
    const result = await extractPdfText(makeLegacyDocFile());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('LEGACY_DOC_FORMAT');
    expect(result.error.message).toMatch(/\.docx/);
  });

  it('rejects plain text that is not a PDF at all', async () => {
    const result = await extractPdfText(makePlainTextFile());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('FORMAT_MISMATCH');
  });
});

describe('extractPdfText — size boundary', () => {
  it('rejects a file one byte over the limit', async () => {
    const result = await extractPdfText(makeOversizedPdf(MAX_FILE_BYTES + 1));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('FILE_TOO_LARGE');
    if (result.error.code !== 'FILE_TOO_LARGE') return;
    expect(result.error.bytes).toBe(MAX_FILE_BYTES + 1);
    expect(result.error.limitBytes).toBe(MAX_FILE_BYTES);
    expect(result.error.message).toMatch(/10 MB/);
  });

  it('lets a file of exactly the limit through the size guard', async () => {
    // Proves the comparison is `>` and not `>=`. The file is nothing but a real
    // PDF followed by padding, so the parser is entitled to reject it — what
    // must NOT happen is the size guard rejecting it.
    const result = await extractPdfText(makeOversizedPdf(MAX_FILE_BYTES));

    // Asserts in BOTH branches on purpose. A bare `if (!result.ok)` would make
    // this test silently assert nothing at all on the day the parser starts
    // accepting the padding, which is precisely when it stops being a guard.
    if (result.ok) {
      expect(result.value.text).toContain('Senior Credit Risk Analyst');
    } else {
      expect(result.error.code).not.toBe('FILE_TOO_LARGE');
    }
  });
});

// ── Failure paths that cannot be reached with a real, well-formed file ───────
//
// The loader seam that lets Node use the legacy build also lets a test stand in
// a pdf.js that misbehaves in a specific way. Without this, the partial-failure
// branches below would be code nobody has ever run.

function fakePdfJs(pages: readonly (string | Error)[]): PdfJsLike {
  return {
    GlobalWorkerOptions: { workerSrc: '' },
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: pages.length,
        getPage: (pageNumber: number) => {
          const page = pages[pageNumber - 1];
          if (page instanceof Error) return Promise.reject(page);
          return Promise.resolve({
            getTextContent: () => Promise.resolve({ items: [{ str: page ?? '', hasEOL: false }] }),
          });
        },
      }),
      destroy: () => Promise.resolve(),
    }),
  };
}

describe('extractPdfText — partial and degenerate documents', () => {
  const REAL_PDF = makeMinimalPdf('placeholder');

  it('keeps the pages it could read and warns about the one it could not', async () => {
    setPdfJsLoader(() =>
      Promise.resolve(
        fakePdfJs([
          'Senior Credit Risk Analyst at Barclays in London, IFRS 9 and COREP work.',
          new Error('page 2 exploded'),
          'Referees available on request. Full history of prior roles is attached.',
        ]),
      ),
    );

    const result = await extractPdfText(REAL_PDF);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.text).toContain('Senior Credit Risk Analyst');
    expect(result.value.text).toContain('Referees available on request');
    expect(result.value.warnings).toHaveLength(1);
    expect(result.value.warnings[0]).toMatch(/page 2/i);
  });

  it('reports a document that claims zero pages as corrupt', async () => {
    setPdfJsLoader(() => Promise.resolve(fakePdfJs([])));

    const result = await extractPdfText(REAL_PDF);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CORRUPT_FILE');
  });

  it('reports an unrecognised failure without pretending to know the cause', async () => {
    setPdfJsLoader(() => Promise.reject(new Error('module resolution went wrong')));

    const result = await extractPdfText(REAL_PDF);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('EXTRACTION_FAILED');
    expect(result.error.detail).toContain('module resolution went wrong');
  });
});
