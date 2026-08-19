/** What a successful extraction produces. */

/**
 * Text pulled out of a CV, plus everything the UI needs to be honest about it.
 */
export interface ExtractedDocument {
  /** The extracted text, already whitespace-normalised. Never empty on success. */
  readonly text: string;

  /**
   * Pages in the source document, or `null` when the format has no such thing.
   *
   * A .docx has no page count until something lays it out, and guessing one
   * would be a quiet lie. `null` means "not applicable", which is a different
   * fact from `0`, and the UI must be able to tell them apart.
   */
  readonly pageCount: number | null;

  /**
   * Things the user needs to know about text we DID manage to extract.
   *
   * ========================================================================
   * THIS FIELD IS LOAD-BEARING. IT IS NOT DECORATION.
   * ========================================================================
   * The commonest real failure in CV upload is a scan: a PDF with perfectly
   * good pages and no text in any of them. Extracting an empty string, running
   * an analysis on it and reporting "no skills found" is the worst possible
   * outcome, because it looks like an answer. A whole-document scan is an
   * error (`NO_TEXT_LAYER`); a document where only SOME pages are images still
   * has usable text, so it succeeds — and says so here.
   *
   * Any UI that renders `text` must render these too.
   */
  readonly warnings: readonly string[];
}
