/**
 * The entry point the app actually calls: filename in, text out.
 */
import { err, type Result } from '@cviper/core-types';

import { fileExtension, kindFromExtension, sniffFileKind } from './detect';
import type { ExtractedDocument } from './document';
import { extractDocxText } from './docx';
import {
  emptyFileError,
  fileTooLargeError,
  formatMismatchError,
  legacyDocError,
  unsupportedFormatError,
  type ParseError,
} from './errors';
import { extractPdfText } from './pdf';
import { MAX_FILE_BYTES } from './constants';

/**
 * Extract the text from a CV file.
 *
 * The filename decides which parser to use; the BYTES decide whether that was a
 * reasonable thing for the filename to claim. Both are checked before anything
 * is parsed, and a mismatch is reported as a mismatch rather than being
 * silently "helpfully" re-routed — a file whose name and contents disagree is
 * something the user needs to know about, not something to paper over.
 *
 * Order of checks, and why:
 *   1. Empty and oversized first, so the answer does not depend on the name.
 *      "That file is empty" is useful; "unsupported format" for a 0-byte file
 *      sends the user off to fix the wrong thing.
 *   2. Extension next — an unreadable format is settled without touching bytes.
 *   3. Contents last, with a legacy `.doc` always answered as a legacy `.doc`
 *      however it was named, because that advice is the most actionable thing
 *      we can say.
 */
export async function extractText(
  filename: string,
  bytes: Uint8Array,
): Promise<Result<ExtractedDocument, ParseError>> {
  if (bytes.byteLength === 0) return err(emptyFileError());
  if (bytes.byteLength > MAX_FILE_BYTES) {
    return err(fileTooLargeError(bytes.byteLength, MAX_FILE_BYTES));
  }

  const extension = fileExtension(filename);
  const claimed = kindFromExtension(extension);
  if (claimed === null) return err(unsupportedFormatError(extension));
  if (claimed === 'doc') return err(legacyDocError());

  const actual = sniffFileKind(bytes);
  if (actual === 'doc') return err(legacyDocError());
  if (actual !== claimed) return err(formatMismatchError(claimed, actual));

  return claimed === 'pdf' ? extractPdfText(bytes) : extractDocxText(bytes);
}
