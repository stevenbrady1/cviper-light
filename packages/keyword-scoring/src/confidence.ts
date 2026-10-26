/**
 * L-291 — how much a basic-match score rests on, in three words.
 *
 * Counted on the requirements the score itself used (`match.required`), so the
 * label and the L-287 cap can never disagree: "low" is exactly the range in
 * which the score is capped below "strong". `keywordConfidence` lives in
 * `score.ts`, beside that cap, and uses the types here.
 *
 * The high threshold is a judgement [Guessing], not a measurement: six
 * recognised requirements is about what a well-written UK advert yields on the
 * L-281 eval set. Move it with a test, not by feel.
 */
export type ConfidenceLevel = 'low' | 'medium' | 'high';

/** From this many recognised requirements, the score rests on a fair sample. */
export const HIGH_CONFIDENCE_REQUIREMENTS = 6;

export interface KeywordConfidence {
  readonly level: ConfidenceLevel;
  /** How many requirements the score was measured against. */
  readonly requirements: number;
}
