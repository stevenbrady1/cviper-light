/**
 * PDF text extraction.
 *
 * Pure in the sense that matters: it takes bytes and returns a value. No file
 * system, no Tauri, no network. Reading the file off disk belongs to the app.
 */
import { err, ok, type Result } from '@cviper/core-types';

import type { ExtractedDocument } from './document';
import {
  corruptPdfError,
  describeUnknown,
  extractionFailedError,
  noTextLayerError,
  pageUnreadableWarning,
  partialScanWarning,
  passwordProtectedError,
  type ParseError,
} from './errors';
import { copyBytes, guardBytes } from './guard';
import {
  getPdfJs,
  pdfDocumentInit,
  type PdfDocumentLike,
  type PdfLoadingTaskLike,
  type PdfTextItemLike,
} from './pdfjs';
import { normalizeWhitespace } from './text';

/**
 * Turn one page's text items into a string.
 *
 * pdf.js emits a run per drawing operation, not per line, and marks the last
 * run on a visual line with `hasEOL`. Runs are concatenated with nothing
 * between them — inserting a space would break every word that a PDF happens to
 * have split for kerning, which is most of them in a CV set in a proportional
 * font. Items without a `str` are `TextMarkedContent` markers and carry no text.
 */
function pageText(items: readonly unknown[]): string {
  let text = '';
  for (const item of items) {
    const run = item as PdfTextItemLike;
    if (typeof run.str !== 'string') continue;
    text += run.str;
    if (run.hasEOL === true) text += '\n';
  }
  return text;
}

/** Map something pdf.js threw onto an answer a person can act on. */
function mapPdfJsError(cause: unknown): ParseError {
  const detail = describeUnknown(cause);
  const name = cause instanceof Error ? cause.name : '';

  // pdf.js exceptions are identified by `name`, not by class — the classes are
  // not exported, and `instanceof` across the worker boundary would not hold
  // anyway. Verified against pdfjs-dist 6.2.108: a PDF with an /Encrypt dict
  // raises `PasswordException`, and a truncated or garbage file raises
  // `InvalidPDFException`.
  if (name === 'PasswordException') return passwordProtectedError(detail);
  if (name === 'InvalidPDFException' || name === 'MissingPDFException') {
    return corruptPdfError(detail);
  }
  return extractionFailedError(detail);
}

/**
 * Release the pdf.js document.
 *
 * A failure here is not reported. By the time this runs the text has already
 * been extracted, and there is no action a caller — let alone a user — could
 * take in response to "cleanup failed". Turning a successful extraction into an
 * error because the teardown complained would be strictly worse than leaking
 * the handle, and the process is a desktop app that will collect it anyway.
 * This is a considered fallback, not a swallowed exception.
 */
async function release(task: PdfLoadingTaskLike): Promise<void> {
  try {
    await task.destroy();
  } catch {
    // Deliberately ignored — see above.
  }
}

interface PageHarvest {
  readonly text: string;
  readonly warnings: string[];
  readonly emptyPages: number;
}

/** Walk every page, keeping what can be read and noting what cannot. */
async function harvestPages(document: PdfDocumentLike): Promise<PageHarvest> {
  const parts: string[] = [];
  const warnings: string[] = [];
  let emptyPages = 0;

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    try {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = pageText(content.items).trim();
      if (text === '') {
        emptyPages += 1;
      } else {
        parts.push(text);
      }
    } catch {
      // One unreadable page does not make the other nine worthless. The user is
      // told exactly which page is missing rather than being handed a CV with a
      // silent hole in it.
      warnings.push(pageUnreadableWarning(pageNumber, document.numPages));
    }
  }

  return { text: parts.join('\n\n'), warnings, emptyPages };
}

/**
 * Extract the text from a PDF.
 *
 * A PDF with pages and no text on any of them is an ERROR, not an empty
 * success: the caller would otherwise analyse an empty string and report "no
 * skills found", which looks like a verdict on the candidate rather than a
 * failure to read the file. A PDF where only some pages are images succeeds,
 * with a warning naming how much is missing.
 */
export async function extractPdfText(
  bytes: Uint8Array,
): Promise<Result<ExtractedDocument, ParseError>> {
  const rejected = guardBytes(bytes, 'pdf');
  if (rejected !== null) return err(rejected);

  let task: PdfLoadingTaskLike;
  try {
    const pdfjs = await getPdfJs();
    task = pdfjs.getDocument(pdfDocumentInit(copyBytes(bytes).view));
  } catch (cause) {
    // Loading the library itself failed — a broken install or a bad bundle.
    // Nothing to release, because nothing was created.
    return err(extractionFailedError(describeUnknown(cause)));
  }

  try {
    const document = await task.promise;

    if (document.numPages < 1) {
      return err(corruptPdfError('The document reported no pages.'));
    }

    const harvest = await harvestPages(document);
    const text = normalizeWhitespace(harvest.text);

    if (text === '') return err(noTextLayerError(document.numPages));

    const warnings = [...harvest.warnings];
    if (harvest.emptyPages > 0) {
      // Deliberately a count of blank PAGES rather than a characters-per-page
      // threshold. A page with no text at all is unambiguous evidence of a
      // scanned image; "fewer than N characters" is a guess that fires on
      // legitimately short CVs and stays silent on a bad OCR job.
      warnings.push(partialScanWarning(harvest.emptyPages, document.numPages));
    }

    return ok({ text, pageCount: document.numPages, warnings });
  } catch (cause) {
    return err(mapPdfJsError(cause));
  } finally {
    await release(task);
  }
}
