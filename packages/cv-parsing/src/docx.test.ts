import { describe, expect, it } from 'vitest';

import { MAX_FILE_BYTES } from './constants';
import { extractDocxText } from './docx';
import {
  EMPTY_FILE,
  makeLegacyDocFile,
  makeMinimalDocx,
  makeMinimalPdf,
  makePlainTextFile,
  makeTruncatedDocx,
  makeZipWithoutWordDocument,
} from './test/fixtures';

describe('extractDocxText — happy path', () => {
  it('reads the paragraphs out of a .docx', async () => {
    const result = await extractDocxText(
      makeMinimalDocx([
        'Senior Credit Risk Analyst',
        'Barclays, London — 2021 to present',
        'Owned IFRS 9 staging logic and COREP reporting.',
      ]),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.text).toContain('Senior Credit Risk Analyst');
    expect(result.value.text).toContain('Barclays, London');
    expect(result.value.text).toContain('IFRS 9 staging logic');
    expect(result.value.warnings).toEqual([]);
  });

  it('reports no page count, because a .docx has no pages until it is laid out', () => {
    // Guarded as its own expectation because returning 0 or 1 here would be a
    // quiet lie: the UI must be able to tell "no pages known" from "one page".
    return extractDocxText(makeMinimalDocx(['Anything'])).then((result) => {
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.pageCount).toBeNull();
    });
  });

  it('keeps paragraph breaks between paragraphs', async () => {
    const result = await extractDocxText(makeMinimalDocx(['First para', 'Second para']));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.text).toBe('First para\n\nSecond para');
  });

  it('preserves currency, accents and CJK characters', async () => {
    const result = await extractDocxText(
      makeMinimalDocx(['Salary £85,000 — Basé à Paris; 日本語 conversational']),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.text).toContain('£85,000');
    expect(result.value.text).toContain('Basé à Paris');
    expect(result.value.text).toContain('日本語');
  });

  it('survives XML metacharacters in the document text', async () => {
    const result = await extractDocxText(
      makeMinimalDocx(['R&D lead <all teams> for "risk" & compliance']),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.text).toContain('R&D lead <all teams>');
  });

  it('does not detach or mutate the callers buffer', async () => {
    const bytes = makeMinimalDocx(['Senior Credit Risk Analyst']);
    const before = Uint8Array.from(bytes);

    await extractDocxText(bytes);

    expect(bytes.byteLength).toBe(before.byteLength);
    expect(Array.from(bytes)).toEqual(Array.from(before));
  });
});

describe('extractDocxText — negative cases', () => {
  it('rejects an empty file', async () => {
    const result = await extractDocxText(EMPTY_FILE);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('EMPTY_FILE');
  });

  it('rejects a legacy .doc with advice to re-save as .docx', async () => {
    const result = await extractDocxText(makeLegacyDocFile());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('LEGACY_DOC_FORMAT');
    expect(result.error.message).toMatch(/\.docx/);
    expect(result.error.message).toMatch(/save|re-save/i);
  });

  it('rejects a PDF handed to the Word parser', async () => {
    const result = await extractDocxText(makeMinimalPdf('Senior Credit Risk Analyst'));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('FORMAT_MISMATCH');
    expect(result.error.message).toMatch(/pdf/i);
  });

  it('rejects plain text', async () => {
    const result = await extractDocxText(makePlainTextFile());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('FORMAT_MISMATCH');
  });

  it('rejects a zip that is not a Word document', async () => {
    // Right magic bytes, wrong contents — a renamed .zip, or a .docx that lost
    // its main part. The sniffer cannot catch this; the parser must.
    const result = await extractDocxText(makeZipWithoutWordDocument());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CORRUPT_FILE');
    expect(result.error.message).toMatch(/word document/i);
  });

  it('rejects a truncated .docx', async () => {
    const result = await extractDocxText(makeTruncatedDocx());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CORRUPT_FILE');
  });

  it('reports a .docx that contains no text at all', async () => {
    const result = await extractDocxText(makeMinimalDocx([]));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('EMPTY_DOCUMENT');
    expect(result.error.message).toMatch(/no text/i);
  });

  it('treats whitespace-only content as no text', async () => {
    const result = await extractDocxText(makeMinimalDocx(['   ', '\t']));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('EMPTY_DOCUMENT');
  });
});

describe('extractDocxText — size boundary', () => {
  it('rejects a file one byte over the limit before parsing it', async () => {
    const oversized = new Uint8Array(MAX_FILE_BYTES + 1);
    oversized.set([0x50, 0x4b, 0x03, 0x04], 0);

    const result = await extractDocxText(oversized);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('FILE_TOO_LARGE');
  });

  it('lets a file of exactly the limit past the size guard', async () => {
    const atLimit = new Uint8Array(MAX_FILE_BYTES);
    atLimit.set([0x50, 0x4b, 0x03, 0x04], 0);

    const result = await extractDocxText(atLimit);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).not.toBe('FILE_TOO_LARGE');
  });
});
