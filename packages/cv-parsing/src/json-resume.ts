/**
 * A JSON Resume file as an `ExtractedDocument`.
 *
 * The format is read and flattened by `@cviper/resume-schema`; this file only
 * turns its answer into the same shape a PDF or a .docx produces, so the rest
 * of the app never learns that a CV arrived as JSON.
 */
import { err, ok, type Result } from '@cviper/core-types';
import { flattenJsonResume, parseJsonResumeBytes } from '@cviper/resume-schema';

import type { ExtractedDocument } from './document';
import {
  emptyDocumentError,
  invalidJsonError,
  invalidJsonResumeError,
  type ParseError,
} from './errors';
import { normalizeWhitespace } from './text';

export function extractJsonResumeText(bytes: Uint8Array): Result<ExtractedDocument, ParseError> {
  const parsed = parseJsonResumeBytes(bytes);
  if (!parsed.ok) {
    switch (parsed.error.code) {
      case 'INVALID_JSON':
        return err(invalidJsonError(parsed.error.detail));
      case 'NOT_A_JSON_RESUME':
        return err(invalidJsonResumeError(parsed.error.message, []));
      case 'INVALID_JSON_RESUME':
        return err(invalidJsonResumeError(parsed.error.message, parsed.error.issues));
      case 'EMPTY_RESUME':
        return err(emptyDocumentError());
    }
  }

  const text = normalizeWhitespace(flattenJsonResume(parsed.value));
  // `parseJsonResumeBytes` already refuses a résumé that flattens to nothing,
  // so this only fires if normalisation removed the last of it — a résumé made
  // entirely of zero-width characters. Not a scan, not corrupt: empty.
  if (text.length === 0) return err(emptyDocumentError());

  // A JSON Resume has no pages and no unreadable regions: what is in the file
  // is in the text, all of it. No warnings, by construction.
  return ok({ text, pageCount: null, warnings: [] });
}
