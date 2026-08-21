import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { extractText } from './extract';
import { resetPdfJs } from './pdfjs';
import {
  EMPTY_FILE,
  makeLegacyDocFile,
  makeMinimalDocx,
  makeMinimalPdf,
  makePlainTextFile,
  makeScannedPdf,
} from './test/fixtures';
import {
  PDFJS_WARMUP_TIMEOUT_MS,
  usePdfJsLegacyBuild,
  warmPdfJsLegacyBuild,
} from './test/pdfjs-node';

// The legacy pdf.js build is ~1.2 MB and the loader imports it LAZILY, so
// without this the first test that touches a PDF is billed for the whole module
// load — under 200ms locally, over the 15s testTimeout on a cold CI runner.
// Loading it here attributes that cost to a hook with a timeout sized for it.
beforeAll(warmPdfJsLegacyBuild, PDFJS_WARMUP_TIMEOUT_MS);

beforeEach(() => {
  resetPdfJs();
  usePdfJsLegacyBuild();
});

describe('extractText — dispatch', () => {
  it('routes a .pdf to the PDF parser', async () => {
    const result = await extractText('cv.pdf', makeMinimalPdf('Senior Credit Risk Analyst'));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.text).toBe('Senior Credit Risk Analyst');
    expect(result.value.pageCount).toBe(1);
  });

  it('routes a .docx to the Word parser', async () => {
    const result = await extractText('cv.docx', makeMinimalDocx(['Senior Credit Risk Analyst']));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.text).toBe('Senior Credit Risk Analyst');
    expect(result.value.pageCount).toBeNull();
  });

  it('ignores the case of the extension', async () => {
    const result = await extractText('CV.PDF', makeMinimalPdf('Jane Smith is a risk analyst'));
    expect(result.ok).toBe(true);
  });

  it('uses only the last extension of a multi-dotted name', async () => {
    const result = await extractText(
      'jane.smith.cv.v2.final.docx',
      makeMinimalDocx(['Senior Credit Risk Analyst']),
    );
    expect(result.ok).toBe(true);
  });

  it('ignores directories in the path', async () => {
    for (const name of [
      'C:\\Users\\jane\\Documents\\cv.pdf',
      '/home/jane/Documents/cv.pdf',
      'Documents/my.cvs/cv.pdf',
    ]) {
      const result = await extractText(name, makeMinimalPdf('Jane Smith is a risk analyst'));
      expect(result.ok, name).toBe(true);
    }
  });

  it('passes warnings through from the underlying parser', async () => {
    const result = await extractText('scan.pdf', makeScannedPdf(1));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NO_TEXT_LAYER');
    expect(result.error.message).toMatch(/scan/i);
  });
});

describe('extractText — unsupported and mismatched files', () => {
  it('rejects a legacy .doc by name, with re-save advice', async () => {
    const result = await extractText('cv.doc', makeLegacyDocFile());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('LEGACY_DOC_FORMAT');
    expect(result.error.message).toMatch(/\.docx/);
  });

  it('rejects an unsupported extension and names what it does accept', async () => {
    for (const name of ['cv.txt', 'cv.rtf', 'cv.pages', 'cv.odt']) {
      const result = await extractText(name, makePlainTextFile());

      expect(result.ok, name).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('UNSUPPORTED_FORMAT');
      expect(result.error.message).toMatch(/PDF/);
      expect(result.error.message).toMatch(/\.docx/);
    }
  });

  it('rejects a file with no extension at all', async () => {
    const result = await extractText('cv', makeMinimalPdf('Senior Credit Risk Analyst'));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('UNSUPPORTED_FORMAT');
    if (result.error.code !== 'UNSUPPORTED_FORMAT') return;
    expect(result.error.extension).toBeNull();
  });

  it('rejects a .docx whose contents are really a PDF', async () => {
    const result = await extractText('cv.docx', makeMinimalPdf('Senior Credit Risk Analyst'));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('FORMAT_MISMATCH');
    if (result.error.code !== 'FORMAT_MISMATCH') return;
    expect(result.error.expected).toBe('docx');
    expect(result.error.actual).toBe('pdf');
    expect(result.error.message).toMatch(/pdf/i);
  });

  it('rejects a .pdf whose contents are really a Word document', async () => {
    const result = await extractText('cv.pdf', makeMinimalDocx(['Senior Credit Risk Analyst']));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('FORMAT_MISMATCH');
    if (result.error.code !== 'FORMAT_MISMATCH') return;
    expect(result.error.expected).toBe('pdf');
    expect(result.error.actual).toBe('docx');
  });

  it('prefers the legacy-.doc advice over a bare mismatch when the bytes are a .doc', async () => {
    // A user who renamed cv.doc to cv.docx hoping it would work. "Wrong format"
    // is true but useless; "re-save it as .docx from Word" is what they need.
    const result = await extractText('cv.docx', makeLegacyDocFile());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('LEGACY_DOC_FORMAT');
  });

  it('rejects an empty file before it looks at the name', async () => {
    for (const name of ['cv.pdf', 'cv.docx', 'cv.txt', 'cv']) {
      const result = await extractText(name, EMPTY_FILE);

      expect(result.ok, name).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('EMPTY_FILE');
    }
  });

  it('rejects an empty filename', async () => {
    const result = await extractText('', makeMinimalPdf('Senior Credit Risk Analyst'));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('UNSUPPORTED_FORMAT');
  });

  it('does not treat a dotfile as an extension', async () => {
    // ".pdf" as a whole filename is a hidden file called "pdf", not a PDF.
    const result = await extractText('.pdf', makeMinimalPdf('Senior Credit Risk Analyst'));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('UNSUPPORTED_FORMAT');
  });

  it('does not accept a trailing dot as a pdf', async () => {
    const result = await extractText('cv.pdf.', makeMinimalPdf('Senior Credit Risk Analyst'));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('UNSUPPORTED_FORMAT');
  });
});
