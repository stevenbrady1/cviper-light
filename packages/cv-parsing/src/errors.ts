/**
 * The error channel for @cviper/cv-parsing.
 *
 * NOTHING IN THIS PACKAGE THROWS ACROSS A BOUNDARY. Every entry point returns
 * `Result<ExtractedDocument, ParseError>`, so a caller that forgets a failure
 * path is a compile error rather than an unhandled rejection in front of a user
 * who was only trying to upload their CV.
 *
 * ============================================================================
 * THE MESSAGES ARE THE PRODUCT.
 * ============================================================================
 * This is a free, local, offline app. There is no support inbox and no error
 * dashboard — if the message on screen does not tell the user what to do next,
 * nothing else will. So every message here says three things: what happened,
 * why, and what to do about it. "Failed to parse PDF" says none of them.
 *
 * Branch on `code`, never on `message`. The wording is expected to improve.
 */
import type { FileKind } from './detect';

export type ParseErrorCode =
  /** Zero bytes. */
  | 'EMPTY_FILE'
  /** Bigger than `MAX_FILE_BYTES`; rejected before any parsing. */
  | 'FILE_TOO_LARGE'
  /** The extension is not one we read at all (.txt, .rtf, .pages, none). */
  | 'UNSUPPORTED_FORMAT'
  /** A Word 97-2003 `.doc`. Not a zip, not readable, but trivially fixable. */
  | 'LEGACY_DOC_FORMAT'
  /** The magic bytes disagree with the extension, or with the parser asked for. */
  | 'FORMAT_MISMATCH'
  /** The right format, damaged or incomplete. */
  | 'CORRUPT_FILE'
  /** An encrypted PDF we have no password for. */
  | 'PASSWORD_PROTECTED'
  /** A PDF with pages and no text on ANY of them — a scan. */
  | 'NO_TEXT_LAYER'
  /** Parsed perfectly and contained no text. An empty document, not a scan. */
  | 'EMPTY_DOCUMENT'
  /** A `.json` file that is JSON but not a JSON Resume, or one with fields of the wrong shape. */
  | 'INVALID_JSON_RESUME'
  /** Something we did not anticipate. Carries the underlying message in `detail`. */
  | 'EXTRACTION_FAILED';

interface ParseErrorBase<C extends ParseErrorCode> {
  readonly code: C;
  /** Legible enough to put in front of a user with no further translation. */
  readonly message: string;
  /**
   * The underlying library's own words, for logs. `null` when there was no
   * underlying error. Never shown to the user — it is where "Invalid PDF
   * structure." lives, which means nothing to anyone outside this file.
   */
  readonly detail: string | null;
}

export type ParseError =
  | ParseErrorBase<'EMPTY_FILE'>
  | (ParseErrorBase<'FILE_TOO_LARGE'> & {
      readonly bytes: number;
      readonly limitBytes: number;
    })
  | (ParseErrorBase<'UNSUPPORTED_FORMAT'> & {
      /** Lower-case, no dot. `null` when the filename had no usable extension. */
      readonly extension: string | null;
    })
  | ParseErrorBase<'LEGACY_DOC_FORMAT'>
  | (ParseErrorBase<'FORMAT_MISMATCH'> & {
      readonly expected: FileKind;
      /** What the bytes actually are, or `null` if nothing recognisable. */
      readonly actual: FileKind | null;
    })
  | ParseErrorBase<'CORRUPT_FILE'>
  | ParseErrorBase<'PASSWORD_PROTECTED'>
  | (ParseErrorBase<'NO_TEXT_LAYER'> & { readonly pageCount: number })
  | ParseErrorBase<'EMPTY_DOCUMENT'>
  | (ParseErrorBase<'INVALID_JSON_RESUME'> & {
      /** One line per problem, by path. Empty when the file is simply not a résumé. */
      readonly issues: readonly string[];
    })
  | ParseErrorBase<'EXTRACTION_FAILED'>;

// ── Wording helpers ──────────────────────────────────────────────────────────

/** "1 page" / "3 pages". */
function pages(count: number): string {
  return count === 1 ? '1 page' : `${count} pages`;
}

/** How to describe a file kind to a person. */
function describeKind(kind: FileKind | null): string {
  switch (kind) {
    case 'pdf':
      return 'a PDF';
    case 'docx':
      return 'a Word document (.docx)';
    case 'doc':
      return 'an old Word document (.doc)';
    case 'json':
      return 'a JSON Resume file (.json)';
    case null:
      return 'not a format CViper can read';
  }
}

/** Megabytes, one decimal place, for sizes we are complaining about. */
function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Whole megabytes, for the limit itself. */
function wholeMegabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

// ── Constructors ─────────────────────────────────────────────────────────────

export function emptyFileError(): ParseError {
  return {
    code: 'EMPTY_FILE',
    message:
      'That file is empty — there is nothing in it to read. It may not have ' +
      'finished saving or downloading. Check the file, then try again.',
    detail: null,
  };
}

export function fileTooLargeError(bytes: number, limitBytes: number): ParseError {
  return {
    code: 'FILE_TOO_LARGE',
    message:
      `That file is ${megabytes(bytes)}, and the limit is ${wholeMegabytes(limitBytes)}. ` +
      'A CV is normally well under 1 MB, so a file this big is usually a scan ' +
      'or has large images in it. Try exporting it from Word as a PDF.',
    detail: null,
    bytes,
    limitBytes,
  };
}

export function unsupportedFormatError(extension: string | null): ParseError {
  const what =
    extension === null
      ? 'That file has no extension, so there is no way to tell what it is.'
      : `That is a .${extension} file.`;
  return {
    code: 'UNSUPPORTED_FORMAT',
    message:
      `CViper reads PDF and Word (.docx) CVs, and JSON Resume (.json) files. ${what} ` +
      'Open it and save a copy as a PDF or a .docx, then try again.',
    detail: null,
    extension,
  };
}

export function legacyDocError(): ParseError {
  return {
    code: 'LEGACY_DOC_FORMAT',
    message:
      'That is an old Word 97-2003 file (.doc), which CViper cannot read. ' +
      'Open it in Word and use "Save As" to save it as a .docx, then try again.',
    detail: null,
  };
}

export function formatMismatchError(expected: FileKind, actual: FileKind | null): ParseError {
  return {
    code: 'FORMAT_MISMATCH',
    message:
      `That file is named like ${describeKind(expected)}, but its contents are ` +
      `${describeKind(actual)}. Renaming a file does not change what is inside ` +
      'it — open it and save a proper copy in the format you need.',
    detail: null,
    expected,
    actual,
  };
}

export function corruptPdfError(detail: string | null): ParseError {
  return {
    code: 'CORRUPT_FILE',
    message:
      'That PDF looks damaged or incomplete, so its text could not be read. ' +
      'This usually means the download or export did not finish. Try saving ' +
      'or exporting it again.',
    detail,
  };
}

export function notAWordDocumentError(detail: string | null): ParseError {
  return {
    code: 'CORRUPT_FILE',
    message:
      'That file is a zip archive, but there is no Word document inside it. ' +
      'A .docx really is a zip, so renaming a .zip to .docx gets this far and ' +
      'no further. Save the CV from Word as a .docx and try again.',
    detail,
  };
}

export function corruptDocxError(detail: string | null): ParseError {
  return {
    code: 'CORRUPT_FILE',
    message:
      'That Word document looks damaged or incomplete, so its text could not ' +
      'be read. Open it in Word, save a fresh copy, and try again.',
    detail,
  };
}

export function passwordProtectedError(detail: string | null): ParseError {
  return {
    code: 'PASSWORD_PROTECTED',
    message:
      'That PDF is protected with a password, so its text cannot be read. ' +
      'Open it, enter the password, and save an unprotected copy — then ' +
      'upload that.',
    detail,
  };
}

export function noTextLayerError(pageCount: number): ParseError {
  return {
    code: 'NO_TEXT_LAYER',
    message:
      `That PDF has ${pages(pageCount)} but no readable text at all, which means ` +
      'it is almost certainly a scan or a photo of a CV rather than a text ' +
      'document. There is no text in the file for CViper to read. Upload the ' +
      'original you exported from Word, or save the CV as a .docx.',
    detail: null,
    pageCount,
  };
}

export function emptyDocumentError(): ParseError {
  return {
    code: 'EMPTY_DOCUMENT',
    message:
      'That document opened correctly but has no text in it at all. Check you ' +
      'picked the right file, and that the CV was saved before you closed it.',
    detail: null,
  };
}

/**
 * A `.json` file that is not JSON: a syntax error, or bytes that are not
 * UTF-8. Reported as corrupt, like a damaged PDF, because that is what it is.
 */
export function invalidJsonError(detail: string | null): ParseError {
  return {
    code: 'CORRUPT_FILE',
    message:
      'That .json file is not valid JSON, so it cannot be a JSON Resume. It may ' +
      'have been cut short while saving, or it may not be a JSON file at all. ' +
      'Export it again from the tool that made it, then try again.',
    detail,
  };
}

/**
 * A `.json` file that is JSON but not a résumé, or a résumé with fields of
 * the wrong shape. `message` is `@cviper/resume-schema`'s own — it names the
 * fields, and that is the useful part.
 */
export function invalidJsonResumeError(message: string, issues: readonly string[]): ParseError {
  return {
    code: 'INVALID_JSON_RESUME',
    message,
    detail: null,
    issues,
  };
}

export function extractionFailedError(detail: string): ParseError {
  return {
    code: 'EXTRACTION_FAILED',
    message:
      'Something went wrong while reading that file, and CViper could not ' +
      'work out what. Try a different copy of the CV, or save it as a .docx.',
    detail,
  };
}

// ── Warnings (not errors — these ride along with a successful extraction) ────

/** Some pages carried no text: part of the CV is an image. */
export function partialScanWarning(emptyPages: number, pageCount: number): string {
  return (
    `${emptyPages} of the ${pages(pageCount)} have no readable text — those ` +
    'pages look like scanned images, so whatever is on them is missing from ' +
    'the text below.'
  );
}

/** One page blew up while the rest read fine. */
export function pageUnreadableWarning(pageNumber: number, pageCount: number): string {
  return (
    `Page ${pageNumber} of ${pageCount} could not be read and has been ` +
    'skipped. Anything on that page is missing from the text below.'
  );
}

/** The text of an unknown thrown value, without assuming it is an `Error`. */
export function describeUnknown(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === 'string') return cause;
  try {
    return JSON.stringify(cause) ?? String(cause);
  } catch {
    return String(cause);
  }
}
