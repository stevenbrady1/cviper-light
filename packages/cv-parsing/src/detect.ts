/**
 * What a file actually is, decided from its bytes rather than its name.
 *
 * A filename is a claim made by whoever named the file. The magic bytes are
 * evidence. Every entry point checks the evidence BEFORE handing anything to a
 * parser, because "reject politely" is cheap and "crash inside a PDF parser on
 * a renamed zip" is not.
 */

/**
 * The formats this package knows about. `doc` is recognised only to refuse it;
 * `json` is a JSON Resume file (see `@cviper/resume-schema`).
 */
export type FileKind = 'pdf' | 'docx' | 'doc' | 'json';

/** `%PDF`. */
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46] as const;

/** `PK\x03\x04` — a zip local file header. A .docx is a zip. */
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04] as const;

/** The OLE2 compound file header. A Word 97-2003 .doc is one of these. */
const OLE2_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] as const;

/**
 * How far into the file we will look for the `%PDF` header.
 *
 * The spec puts it at byte 0, and readers are famously forgiving about junk in
 * front of it — some real-world exporters emit a byte-order mark or a stray
 * newline. Rejecting those files would be technically correct and useless to
 * the person holding one, so the header is looked for in the first kilobyte.
 * Nothing is lost by being lenient here: pdf.js still has to agree.
 */
const PDF_HEADER_SEARCH_BYTES = 1024;

/** The UTF-8 byte-order mark. Windows tools put one in front of JSON. */
const UTF8_BOM = [0xef, 0xbb, 0xbf] as const;

/** `{` and `[` — the only two bytes a JSON document can begin with. */
const JSON_OPENERS = [0x7b, 0x5b] as const;

/** JSON whitespace: space, tab, newline, carriage return. */
const JSON_WHITESPACE = [0x20, 0x09, 0x0a, 0x0d] as const;

function startsWith(bytes: Uint8Array, magic: readonly number[]): boolean {
  if (bytes.length < magic.length) return false;
  return magic.every((byte, index) => bytes[index] === byte);
}

function containsAt(bytes: Uint8Array, magic: readonly number[], offset: number): boolean {
  return magic.every((byte, index) => bytes[offset + index] === byte);
}

function findsWithin(bytes: Uint8Array, magic: readonly number[], limit: number): boolean {
  const last = Math.min(bytes.length, limit) - magic.length;
  for (let offset = 0; offset <= last; offset += 1) {
    if (containsAt(bytes, magic, offset)) return true;
  }
  return false;
}

/**
 * Does the text begin, after an optional byte-order mark and whitespace, the
 * way a JSON document must — with `{` or `[`?
 *
 * JSON has no magic number, so this is the most evidence there is. It is
 * enough for the job: a PDF, a zip and an OLE2 file all begin with something
 * else, and what it lets through — a JSON array, say — is answered by the
 * résumé parser with "not a JSON Resume", which is the right message.
 */
function looksLikeJson(bytes: Uint8Array): boolean {
  let offset = startsWith(bytes, UTF8_BOM) ? UTF8_BOM.length : 0;
  while (offset < bytes.length && JSON_WHITESPACE.some((byte) => bytes[offset] === byte)) {
    offset += 1;
  }
  return offset < bytes.length && JSON_OPENERS.some((byte) => bytes[offset] === byte);
}

/**
 * Work out what a file is from its leading bytes.
 *
 * Returns `null` when the bytes match nothing we handle — which covers plain
 * text, images, and a file that was truncated before its own header.
 */
export function sniffFileKind(bytes: Uint8Array): FileKind | null {
  // Order matters: OLE2 and zip headers are checked at offset 0 and are
  // unambiguous, so they are settled first. JSON is settled before the lenient
  // PDF search, which looks a kilobyte deep and would otherwise claim a
  // résumé whose summary mentions "%PDF".
  if (startsWith(bytes, OLE2_MAGIC)) return 'doc';
  if (startsWith(bytes, ZIP_MAGIC)) return 'docx';
  if (looksLikeJson(bytes)) return 'json';
  if (findsWithin(bytes, PDF_MAGIC, PDF_HEADER_SEARCH_BYTES)) return 'pdf';
  return null;
}

/**
 * The extension of a filename, lower-cased and without the dot.
 *
 * Returns `null` when there is nothing usable. Handles the cases users
 * genuinely produce:
 *   - a full Windows or POSIX path, with directories that contain dots
 *   - `jane.smith.cv.v2.final.docx` — only the LAST extension counts
 *   - `.pdf` — a hidden file named "pdf", not a PDF
 *   - `cv.pdf.` — a trailing dot is not an extension
 */
export function fileExtension(filename: string): string | null {
  const separator = Math.max(filename.lastIndexOf('/'), filename.lastIndexOf('\\'));
  const basename = filename.slice(separator + 1);

  const dot = basename.lastIndexOf('.');
  // `dot <= 0` covers both "no dot at all" and a leading-dot hidden file.
  if (dot <= 0 || dot === basename.length - 1) return null;

  return basename.slice(dot + 1).toLowerCase();
}

/** Map an extension to a kind. `null` for anything we do not read. */
export function kindFromExtension(extension: string | null): FileKind | null {
  switch (extension) {
    case 'pdf':
      return 'pdf';
    case 'docx':
      return 'docx';
    case 'doc':
      return 'doc';
    case 'json':
      return 'json';
    default:
      return null;
  }
}
