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

export { sniffFileKind, fileExtension, kindFromExtension, type FileKind } from './detect';

export type { ExtractedDocument } from './document';

export type { ParseError, ParseErrorCode } from './errors';

export { extractPdfText } from './pdf';
export { extractDocxText } from './docx';
export { extractText } from './extract';

export { normalizeWhitespace, truncateForPrompt, TRUNCATION_MARKER } from './text';

export { sanitizeForPrompt, injectionPatterns, type InjectionPattern } from './sanitize';

export {
  configurePdfJs,
  getPdfJsAssetUrls,
  setPdfJsLoader,
  resetPdfJs,
  type PdfJsAssetUrls,
  type PdfJsLike,
  type PdfJsLoader,
  type PdfJsOptions,
} from './pdfjs';
