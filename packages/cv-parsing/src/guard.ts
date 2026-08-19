/**
 * The checks every entry point runs before a single byte reaches a parser.
 *
 * Cheap, total, and ordered deliberately: size before contents, contents before
 * parsing. A hostile or broken file gets a sentence explaining itself instead of
 * an exception from somewhere three libraries deep.
 */
import { MAX_FILE_BYTES } from './constants';
import { sniffFileKind, type FileKind } from './detect';
import {
  emptyFileError,
  fileTooLargeError,
  formatMismatchError,
  legacyDocError,
  type ParseError,
} from './errors';

/**
 * Vet raw bytes that are claimed to be `expected`.
 *
 * Returns the problem, or `null` if there is none. A private helper, so it uses
 * `null` rather than a `Result` — the public entry points are what owe callers
 * a `Result`, and wrapping a nullable check in one would only add ceremony.
 *
 * ORDER IS THE POINT:
 *   1. Empty first — "that file is empty" beats "that file is not a PDF" when
 *      both are true, because it tells the user something they can act on.
 *   2. Size second — before anything looks at, allocates for, or copies the
 *      contents.
 *   3. Contents last, and a legacy `.doc` gets its own answer rather than the
 *      generic mismatch, because the fix for it is one menu item away.
 */
export function guardBytes(bytes: Uint8Array, expected: FileKind): ParseError | null {
  if (bytes.byteLength === 0) return emptyFileError();
  if (bytes.byteLength > MAX_FILE_BYTES) {
    return fileTooLargeError(bytes.byteLength, MAX_FILE_BYTES);
  }

  const actual = sniffFileKind(bytes);
  if (actual === expected) return null;
  if (actual === 'doc') return legacyDocError();
  return formatMismatchError(expected, actual);
}

/**
 * Hand a parser its own copy of the bytes.
 *
 * pdf.js TRANSFERS the buffer it is given to its worker, which detaches the
 * caller's view of it. The caller is then holding a zero-length array through
 * no fault of its own — and because the fake worker used in Node does not
 * transfer anything, this only ever breaks in the packaged app. Copying costs
 * one allocation and removes the whole class of bug.
 *
 * The copy is backed by a plain `ArrayBuffer`, which is also what mammoth wants
 * and what a `Uint8Array` view into a larger pooled buffer would not give it.
 */
export function copyBytes(bytes: Uint8Array): { view: Uint8Array; buffer: ArrayBuffer } {
  const buffer = new ArrayBuffer(bytes.byteLength);
  const view = new Uint8Array(buffer);
  view.set(bytes);
  return { view, buffer };
}
