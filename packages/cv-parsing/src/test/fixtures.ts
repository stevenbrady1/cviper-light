/**
 * Deterministic, generated-in-code test fixtures.
 *
 * ============================================================================
 * NO BINARY FIXTURE FILE IS EVER COMMITTED TO THIS REPO.
 * ============================================================================
 * A checked-in `sample.pdf` is a black box: nobody can tell from a diff what it
 * contains, nobody can tell why a test broke when the library changed, and the
 * one person who knew how it was produced leaves. Everything here is emitted
 * from source you can read, uncompressed, with computable byte offsets.
 *
 * These builders are TEST INFRASTRUCTURE, not library code, and they are the
 * one place in this package allowed to `throw`: a fixture that quietly emitted
 * a malformed file would turn every test using it into a lie. They are not
 * exported from `src/index.ts` and nothing shipped imports them.
 */
import { zipSync, type Zippable } from 'fflate';

// ── PDF ──────────────────────────────────────────────────────────────────────

/** US Letter, in PDF points. Any size works; this is what Word emits. */
const MEDIA_BOX = '[0 0 612 792]';

/**
 * A page that draws a grey rectangle and NOTHING ELSE — no text operators.
 *
 * This is our stand-in for a scanned CV. A real scan carries a JPEG of the
 * page; embedding one would add kilobytes of binary to this file and change
 * nothing that matters, because what the test needs is the property a scan
 * has: `numPages > 0` and `getTextContent()` returning no items.
 */
const IMAGE_ONLY_CONTENT = '0.5 g 0 0 612 792 re f\n';

/**
 * Escape a string for a PDF literal string `( ... )`.
 *
 * Throws on anything outside Latin-1. The whole builder works in single-byte
 * characters so that a JavaScript string index IS a byte offset, which is what
 * makes the xref table computable — see `assemblePdf`.
 */
function escapePdfText(text: string): string {
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code > 0xff) {
      throw new Error(
        `makeMinimalPdf: ${JSON.stringify(char)} is outside Latin-1. This builder ` +
          'emits WinAnsi text only; a fixture needing CJK or emoji needs an ' +
          'embedded font, which is a different fixture.',
      );
    }
  }
  return text.replace(/([\\()])/g, '\\$1');
}

/** A content stream that draws `text`, one `Tj` per line, 14pt leading. */
function textContentStream(text: string): string {
  const drawn = text
    .split('\n')
    .map((line, index) =>
      index === 0 ? `(${escapePdfText(line)}) Tj` : `0 -14 Td (${escapePdfText(line)}) Tj`,
    )
    .join(' ');
  return `BT /F1 12 Tf 72 720 Td ${drawn} ET\n`;
}

/** Latin-1 encode: one character in, one byte out. */
function toLatin1Bytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) {
    bytes[i] = text.charCodeAt(i) & 0xff;
  }
  return bytes;
}

/**
 * Wrap numbered object bodies in a complete PDF file with a REAL xref table.
 *
 * The offsets are the actual byte positions of each `N 0 obj`, computed as the
 * file is built. Every xref entry is exactly 20 bytes (10-digit offset, space,
 * 5-digit generation, space, keyword, space, newline) as the spec requires —
 * get that wrong by one byte and a strict reader rejects the file.
 */
function assemblePdf(objectBodies: readonly string[], trailerExtra = ''): Uint8Array {
  let file = '%PDF-1.4\n';
  const offsets: number[] = [];

  objectBodies.forEach((body, index) => {
    offsets.push(file.length);
    file += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefOffset = file.length;
  const size = objectBodies.length + 1;
  file += `xref\n0 ${size}\n`;
  file += '0000000000 65535 f \n';
  for (const offset of offsets) {
    file += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  file += `trailer\n<< /Size ${size} /Root 1 0 R ${trailerExtra}>>\n`;
  file += `startxref\n${xrefOffset}\n%%EOF\n`;

  return toLatin1Bytes(file);
}

/**
 * Build a PDF from one entry per page.
 *
 * `null` means "this page has no text layer" — the scanned-CV case. Object
 * numbering is fixed and dense: 1 catalog, 2 page tree, then one object per
 * page, then the font, then one content stream per page.
 */
export function makePdfFromPages(pageTexts: readonly (string | null)[]): Uint8Array {
  if (pageTexts.length === 0) {
    throw new Error('makePdfFromPages: a PDF needs at least one page.');
  }

  const firstPageObject = 3;
  const fontObject = firstPageObject + pageTexts.length;
  const firstContentObject = fontObject + 1;

  const kids = pageTexts.map((_, index) => `${firstPageObject + index} 0 R`).join(' ');
  const bodies: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${kids}] /Count ${pageTexts.length} >>`,
  ];

  pageTexts.forEach((_, index) => {
    bodies.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox ${MEDIA_BOX} ` +
        `/Resources << /Font << /F1 ${fontObject} 0 R >> >> ` +
        `/Contents ${firstContentObject + index} 0 R >>`,
    );
  });

  bodies.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  for (const text of pageTexts) {
    const stream = text === null ? IMAGE_ONLY_CONTENT : textContentStream(text);
    bodies.push(`<< /Length ${stream.length} >>\nstream\n${stream}endstream`);
  }

  return assemblePdf(bodies);
}

/** A single-page, uncompressed PDF containing exactly `text`. ~600 bytes. */
export function makeMinimalPdf(text: string): Uint8Array {
  return makePdfFromPages([text]);
}

/**
 * A PDF with real pages and no text layer whatsoever — a scanned CV.
 *
 * The single most common way CV upload fails in production, and the reason
 * `ExtractedDocument.warnings` exists.
 */
export function makeScannedPdf(pageCount = 2): Uint8Array {
  return makePdfFromPages(Array.from({ length: pageCount }, () => null));
}

/**
 * A password-protected PDF.
 *
 * The `/O` and `/U` password-check strings are deliberate junk: pdf.js reaches
 * for the standard security handler as soon as it sees `/Encrypt`, fails the
 * empty-password check against them and raises `PasswordException` before it
 * ever tries to decrypt a stream. That is the same code path a user hits with a
 * real bank-issued locked PDF, and it costs us no crypto to reproduce.
 */
export function makeEncryptedPdf(): Uint8Array {
  const content = textContentStream('Confidential');
  const bodies = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox ${MEDIA_BOX} ` +
      '/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}endstream`,
    `<< /Filter /Standard /V 1 /R 2 /O <${'ab'.repeat(32)}> /U <${'cd'.repeat(32)}> /P -1 >>`,
  ];
  const id = '11'.repeat(16);
  return assemblePdf(bodies, `/Encrypt 6 0 R /ID [<${id}> <${id}>] `);
}

/**
 * A PDF whose tail — including the xref table and `%%EOF` — has been cut off.
 *
 * What a user actually produces when a download or a network share drops
 * halfway. The `%PDF` magic still passes, so this proves the parser (not the
 * sniffer) is what reports the problem.
 */
export function makeTruncatedPdf(): Uint8Array {
  const whole = makeMinimalPdf('Senior Credit Risk Analyst');
  return whole.slice(0, Math.floor(whole.length * 0.55));
}

// ── DOCX ─────────────────────────────────────────────────────────────────────

/**
 * The zip timestamp written into every fixture entry.
 *
 * ==========================================================================
 * DELIBERATE DEVIATION: the plan said `mtime: 0`. fflate REJECTS that.
 * ==========================================================================
 * A zip stores DOS timestamps, which cannot represent anything before 1980.
 * fflate 0.8.3 computes `new Date(mtime).getFullYear() - 1980` and throws
 * `code 10, "date not in range 1980-2099"` when that goes negative — so
 * `mtime: 0` (1 Jan 1970) throws on EVERY machine, in every timezone. Verified
 * against the installed copy, not assumed.
 *
 * A fixed instant safely inside the DOS range gives what `mtime: 0` was
 * reaching for: no `Date.now()` leaks into the bytes, so two calls produce
 * identical output and no test depends on when it ran. 2 Jan 1980 UTC stays
 * inside 1980 in every timezone on earth (offsets run -12 to +14), so no
 * machine trips the range check.
 *
 * fflate encodes the DOS date with LOCAL-time getters, so the four timestamp
 * bytes still differ between timezones. Full cross-machine byte identity is
 * therefore not reachable through fflate at all — and does not matter here,
 * because no golden bytes are committed and nothing compares a fixture against
 * a file built on another machine.
 */
const ZIP_FIXED_MTIME = Date.UTC(1980, 0, 2);

/** Escape text for an XML text node. */
function escapeXmlText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

const CONTENT_TYPES_XML =
  XML_DECLARATION +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ' +
  'ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ' +
  'ContentType="application/vnd.openxmlformats-officedocument.' +
  'wordprocessingml.document.main+xml"/>' +
  '</Types>';

const RELS_XML =
  XML_DECLARATION +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" ' +
  'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" ' +
  'Target="word/document.xml"/>' +
  '</Relationships>';

function documentXml(paragraphs: readonly string[]): string {
  const body = paragraphs
    .map((text) => `<w:p><w:r><w:t xml:space="preserve">${escapeXmlText(text)}</w:t></w:r></w:p>`)
    .join('');
  return (
    XML_DECLARATION +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    `<w:body>${body}</w:body></w:document>`
  );
}

const encoder = new TextEncoder();

/** Zip `entries` with no compression and a fixed timestamp on every entry. */
function zipDeterministically(entries: Record<string, string>): Uint8Array {
  const zippable: Zippable = {};
  for (const [name, text] of Object.entries(entries)) {
    // `level: 0` is STORE, not deflate: each part stays readable in a hex dump,
    // for the same reason the PDF above is uncompressed.
    zippable[name] = [encoder.encode(text), { level: 0, mtime: ZIP_FIXED_MTIME }];
  }
  return zipSync(zippable, { level: 0, mtime: ZIP_FIXED_MTIME });
}

/** A minimal but genuinely valid .docx: three parts, one `<w:p>` per paragraph. */
export function makeMinimalDocx(paragraphs: readonly string[]): Uint8Array {
  return zipDeterministically({
    '[Content_Types].xml': CONTENT_TYPES_XML,
    '_rels/.rels': RELS_XML,
    'word/document.xml': documentXml(paragraphs),
  });
}

/**
 * A real zip that is not a Word document — right magic bytes, wrong contents.
 *
 * A user who renames `holiday-photos.zip` to `cv.docx` lands here, and so does
 * anyone whose .docx lost its main part.
 */
export function makeZipWithoutWordDocument(): Uint8Array {
  return zipDeterministically({ 'readme.txt': 'not a word document' });
}

/** A .docx cut off mid-archive: `PK\x03\x04` present, central directory gone. */
export function makeTruncatedDocx(): Uint8Array {
  const whole = makeMinimalDocx(['Senior Credit Risk Analyst']);
  return whole.slice(0, Math.floor(whole.length * 0.5));
}

// ── Wrong-format and boundary inputs ─────────────────────────────────────────

/**
 * A legacy Word 97-2003 `.doc`: an OLE2 compound file, NOT a zip.
 *
 * Worth its own fixture because the advice differs — there is nothing to fix
 * about the file, the user simply has to re-save it as .docx.
 */
export function makeLegacyDocFile(): Uint8Array {
  const oleMagic = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  const bytes = new Uint8Array(512);
  bytes.set(oleMagic, 0);
  return bytes;
}

/** Plain text pretending to be something it is not. */
export function makePlainTextFile(text = 'Just some notes about my career.'): Uint8Array {
  return encoder.encode(text);
}

/** Zero bytes. A user who picked a file that failed to save. */
export const EMPTY_FILE = new Uint8Array(0);

/** A valid PDF padded past a byte budget, to exercise the size guard. */
export function makeOversizedPdf(totalBytes: number): Uint8Array {
  const real = makeMinimalPdf('Senior Credit Risk Analyst');
  if (totalBytes <= real.length) {
    throw new Error('makeOversizedPdf: totalBytes must exceed the minimal PDF.');
  }
  const padded = new Uint8Array(totalBytes);
  padded.set(real, 0);
  return padded;
}
