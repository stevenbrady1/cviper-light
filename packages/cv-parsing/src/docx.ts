/**
 * Word (.docx) text extraction.
 *
 * mammoth runs entirely client-side with no polyfills: its `browser` field in
 * package.json maps the two Node-only modules away, and Vite picks that up. A
 * CV never leaves the machine.
 */
import { err, ok, type Result } from '@cviper/core-types';
import mammoth from 'mammoth';

import type { ExtractedDocument } from './document';
import {
  corruptDocxError,
  describeUnknown,
  emptyDocumentError,
  notAWordDocumentError,
  type ParseError,
} from './errors';
import { copyBytes, guardBytes } from './guard';
import { normalizeWhitespace } from './text';

/**
 * mammoth's own words when the zip opened but had no Word document in it.
 *
 * A message match, and exactly as fragile as that sounds — so it is used ONLY
 * to pick between two wordings, never to decide whether the file failed. A miss
 * costs the user a less specific sentence and nothing else.
 */
const NOT_A_WORD_DOCUMENT = /main document part|document\.xml/i;

function mapMammothError(cause: unknown): ParseError {
  const detail = describeUnknown(cause);
  return NOT_A_WORD_DOCUMENT.test(detail)
    ? notAWordDocumentError(detail)
    : corruptDocxError(detail);
}

/**
 * The input object, in the shape BOTH of mammoth's builds understand.
 *
 * ==========================================================================
 * MAMMOTH'S TWO BUILDS READ DIFFERENT KEYS. THIS IS NOT BELT AND BRACES.
 * ==========================================================================
 * mammoth's `browser` field swaps `lib/unzip.js` for `browser/unzip.js`, and
 * the two disagree about how a document arrives:
 *
 *   browser/unzip.js:  if (options.arrayBuffer) ... else reject
 *   lib/unzip.js:      if (options.path) ... else if (options.buffer) ... else reject
 *
 * The app is a browser and gets `arrayBuffer`. A Node test run gets neither
 * unless `buffer` is set, and mammoth answers "Could not find file in options"
 * — which classifies as a corrupt file, so passing only `arrayBuffer` would
 * have produced a package whose .docx tests all "correctly rejected" valid
 * documents while the app worked fine. Setting both keys means the app and the
 * tests make the SAME call, and both dispatchers land on the same
 * `zipfile.openArrayBuffer` immediately afterwards.
 *
 * Built as a typed variable rather than an inline literal on purpose: mammoth's
 * `Input` is a union, and an object literal carrying keys from two members of
 * it trips TypeScript's excess-property check at the call site.
 */
interface DualEnvironmentInput {
  /** Read by `browser/unzip.js` — the build the packaged app uses. */
  readonly arrayBuffer: ArrayBuffer;
  /** Read by `lib/unzip.js` — the build a Node test run uses. */
  readonly buffer: Uint8Array;
}

function dualEnvironmentInput(buffer: ArrayBuffer, view: Uint8Array): DualEnvironmentInput {
  return { arrayBuffer: buffer, buffer: view };
}

/**
 * Extract the text from a .docx.
 *
 * `pageCount` is always `null`: a .docx has no pages until something lays it
 * out, and inventing a number would be a quiet lie the UI cannot detect.
 */
export async function extractDocxText(
  bytes: Uint8Array,
): Promise<Result<ExtractedDocument, ParseError>> {
  const rejected = guardBytes(bytes, 'docx');
  if (rejected !== null) return err(rejected);

  const copy = copyBytes(bytes);

  let raw;
  try {
    raw = await mammoth.extractRawText(dualEnvironmentInput(copy.buffer, copy.view));
  } catch (cause) {
    return err(mapMammothError(cause));
  }

  const text = normalizeWhitespace(raw.value);
  if (text === '') return err(emptyDocumentError());

  // mammoth reports non-fatal problems rather than throwing — an unreadable
  // embedded object, say. It still returned text, so this is a warning on a
  // successful extraction, not a failure. Swallowing them would leave the user
  // with a CV that is quietly missing a section.
  const warnings = raw.messages
    .filter((message) => message.type === 'error')
    .map((message) => `Part of that document could not be read: ${message.message}`);

  return ok({ text, pageCount: null, warnings });
}
