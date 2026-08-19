import { describe, expect, it } from 'vitest';

import {
  EMPTY_FILE,
  makeEncryptedPdf,
  makeLegacyDocFile,
  makeMinimalDocx,
  makeMinimalPdf,
  makeOversizedPdf,
  makePdfFromPages,
  makeScannedPdf,
  makeTruncatedDocx,
  makeTruncatedPdf,
  makeZipWithoutWordDocument,
} from './fixtures';

/**
 * The fixtures are load-bearing: every extraction test in this package is only
 * as trustworthy as the bytes it is handed. A builder that quietly emitted a
 * malformed PDF would turn "the parser rejects this" into a test that passes
 * for entirely the wrong reason.
 */

/**
 * The zip end-of-central-directory signature, PK.
 *
 * Built from char codes rather than written as a string literal: two of these
 * bytes are unprintable control characters, and a control character pasted into
 * source is invisible in review and easily mangled by a stray reformat.
 */
const END_OF_CENTRAL_DIRECTORY = String.fromCharCode(0x50, 0x4b, 0x05, 0x06);

function ascii(bytes: Uint8Array, start = 0, length = bytes.length): string {
  return String.fromCharCode(...bytes.slice(start, start + length));
}

describe('makeMinimalPdf', () => {
  it('emits a small, uncompressed, well-formed PDF', () => {
    const pdf = makeMinimalPdf('Senior Credit Risk Analyst');
    const text = ascii(pdf);

    expect(ascii(pdf, 0, 5)).toBe('%PDF-');
    expect(text).toContain('/Type /Catalog');
    expect(text).toContain('BT /F1 12 Tf');
    expect(text).toContain('(Senior Credit Risk Analyst) Tj');
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(pdf.length).toBeLessThan(1024);
  });

  it('writes xref offsets that really do point at their objects', () => {
    // The whole reason the fixture is uncompressed: the offsets are computable,
    // so this test can check them rather than trusting them.
    const pdf = makeMinimalPdf('Jane Smith');
    const text = ascii(pdf);
    const xrefStart = text.indexOf('xref\n');
    const entries = text
      .slice(xrefStart)
      .split('\n')
      .filter((line) => / \d{5} [nf] $/.test(line));

    expect(entries.length).toBeGreaterThan(1);
    entries.slice(1).forEach((entry, index) => {
      const offset = Number(entry.slice(0, 10));
      expect(ascii(pdf, offset, 8), `object ${index + 1}`).toContain(`${index + 1} 0 obj`);
    });
  });

  it('escapes PDF string metacharacters instead of emitting a broken stream', () => {
    const text = ascii(makeMinimalPdf('C(++) \\ backslash'));
    expect(text).toContain('(C\\(++\\) \\\\ backslash) Tj');
  });

  it('refuses to build a fixture it cannot faithfully encode', () => {
    expect(() => makeMinimalPdf('日本語')).toThrow(/Latin-1/);
  });

  it('is byte-for-byte reproducible', () => {
    expect(Array.from(makeMinimalPdf('Jane Smith'))).toEqual(
      Array.from(makeMinimalPdf('Jane Smith')),
    );
  });
});

describe('makePdfFromPages', () => {
  it('declares the page count it was asked for', () => {
    const text = ascii(makePdfFromPages(['a', 'b', 'c']));
    expect(text).toContain('/Count 3');
    expect(text).toContain('/Kids [3 0 R 4 0 R 5 0 R]');
  });

  it('refuses to build a PDF with no pages', () => {
    expect(() => makePdfFromPages([])).toThrow(/at least one page/);
  });
});

describe('makeScannedPdf', () => {
  it('has pages and draws a rectangle, with no text operator anywhere', () => {
    const pdf = makeScannedPdf(3);
    const text = ascii(pdf);

    expect(text).toContain('/Count 3');
    expect(text).toContain('re f');
    expect(text).not.toContain('Tj');
    expect(text).not.toContain('BT ');
  });
});

describe('makeEncryptedPdf and makeTruncatedPdf', () => {
  it('marks the encrypted fixture with a standard security handler', () => {
    const text = ascii(makeEncryptedPdf());
    expect(text).toContain('/Encrypt 6 0 R');
    expect(text).toContain('/Filter /Standard');
  });

  it('keeps the PDF magic but loses the trailer on the truncated fixture', () => {
    const pdf = makeTruncatedPdf();
    const text = ascii(pdf);

    expect(ascii(pdf, 0, 4)).toBe('%PDF');
    expect(text).not.toContain('%%EOF');
    expect(text).not.toContain('startxref');
  });
});

describe('makeMinimalDocx', () => {
  it('emits a zip carrying the three parts a .docx must have', () => {
    const docx = makeMinimalDocx(['Senior Credit Risk Analyst']);
    const text = ascii(docx);

    expect(Array.from(docx.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(text).toContain('[Content_Types].xml');
    expect(text).toContain('_rels/.rels');
    expect(text).toContain('word/document.xml');
  });

  it('stores parts uncompressed, so the XML is readable in a hex dump', () => {
    const docx = makeMinimalDocx(['Senior Credit Risk Analyst']);
    expect(ascii(docx)).toContain('<w:t xml:space="preserve">');
  });

  it('escapes XML metacharacters in paragraph text', () => {
    const text = ascii(makeMinimalDocx(['R&D <all> teams']));
    expect(text).toContain('R&amp;D &lt;all&gt; teams');
  });

  it('is byte-for-byte reproducible — no clock leaks into the archive', () => {
    // The whole point of pinning the zip timestamp. If `Date.now()` ever gets
    // back in, these two arrays differ and this test says so immediately.
    expect(Array.from(makeMinimalDocx(['Jane Smith']))).toEqual(
      Array.from(makeMinimalDocx(['Jane Smith'])),
    );
  });

  it('keeps the zip magic but loses the central directory when truncated', () => {
    const truncated = makeTruncatedDocx();
    expect(Array.from(truncated.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    // The end-of-central-directory record is what a zip reader looks for
    // FIRST. Losing it is what makes the archive unreadable; the local file
    // header at the front is still perfectly intact.
    expect(ascii(truncated)).not.toContain(END_OF_CENTRAL_DIRECTORY);
  });

  it('builds a zip with no word/document.xml for the renamed-archive case', () => {
    const text = ascii(makeZipWithoutWordDocument());
    expect(text).toContain('readme.txt');
    expect(text).not.toContain('word/document.xml');
  });
});

describe('wrong-format fixtures', () => {
  it('gives the legacy .doc fixture real OLE2 compound-file magic', () => {
    expect(Array.from(makeLegacyDocFile().slice(0, 8))).toEqual([
      0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
    ]);
  });

  it('has a genuinely empty empty-file fixture', () => {
    expect(EMPTY_FILE.length).toBe(0);
  });

  it('pads the oversized fixture to exactly the size asked for', () => {
    expect(makeOversizedPdf(4096).length).toBe(4096);
    expect(ascii(makeOversizedPdf(4096), 0, 4)).toBe('%PDF');
  });

  it('refuses to build an oversized fixture smaller than a real PDF', () => {
    expect(() => makeOversizedPdf(10)).toThrow(/must exceed/);
  });
});
