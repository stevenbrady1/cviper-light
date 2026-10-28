/**
 * @cviper/cv-parsing — turning an uploaded CV into text, locally.
 *
 * Everything here is a pure function over bytes. Nothing in this package
 * touches the file system, Tauri or the network: the app reads the file and
 * hands the bytes over. Nothing throws across the boundary either — every entry
 * point returns `Result<ExtractedDocument, ParseError>` from
 * `@cviper/core-types`.
 *
 * The app must call `configurePdfJs` once at startup. Without it pdf.js works
 * under `vite dev` and fails in the packaged app — see `pdfjs.ts`.
 */
export const CV_PARSING_PACKAGE = '@cviper/cv-parsing' as const;

export { MAX_FILE_BYTES } from './constants';

export { fileExtension, kindFromExtension, sniffFileKind, type FileKind } from './detect';

export type { ExtractedDocument } from './document';

export type { ParseError, ParseErrorCode } from './errors';

export { extractPdfText } from './pdf';
export { extractDocxText } from './docx';
export { extractJsonResumeText } from './json-resume';
export { extractText } from './extract';

export { TRUNCATION_MARKER, normalizeWhitespace, truncateForPrompt } from './text';

export {
  MAX_SANITIZE_INPUT_CHARS,
  injectionPatterns,
  sanitizeForPrompt,
  sanitizeWithStats,
  type InjectionPattern,
  type SanitizeStats,
} from './sanitize';
export {
  foldedText,
  removeMatches,
  removeRanges,
  type FoldedRange,
  type Unit,
} from './folded-text';

export {
  configurePdfJs,
  getPdfJsAssetUrls,
  resetPdfJs,
  setPdfJsLoader,
  type PdfJsAssetUrls,
  type PdfJsLike,
  type PdfJsLoader,
  type PdfJsOptions,
} from './pdfjs';
