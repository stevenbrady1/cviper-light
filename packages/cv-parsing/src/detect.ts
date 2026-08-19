/**
 * What a file actually is, decided from its bytes rather than its name.
 *
 * A filename is a claim made by whoever named the file. The magic bytes are
 * evidence. Every entry point checks the evidence BEFORE handing anything to a
 * parser, because "reject politely" is cheap and "crash inside a PDF parser on
 * a renamed zip" is not.
 */

/** The formats this package knows about. `doc` is recognised only to refuse it. */
export type FileKind = 'pdf' | 'docx' | 'doc';

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
 * Work out what a file is from its leading bytes.
 *
 * Returns `null` when the bytes match nothing we handle — which covers plain
 * text, images, and a file that was truncated before its own header.
 */
export function sniffFileKind(bytes: Uint8Array): FileKind | null {
  // Order matters: OLE2 and zip headers are checked at offset 0 and are
  // unambiguous, so they are settled before the lenient PDF search runs.
  if (startsWith(bytes, OLE2_MAGIC)) return 'doc';
  if (startsWith(bytes, ZIP_MAGIC)) return 'docx';
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
    default:
      return null;
  }
}
