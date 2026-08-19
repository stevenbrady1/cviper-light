/**
 * US -> UK spelling folding.
 *
 * Ported verbatim from `backend/ai/keywords.py` (CV-706): the `_US_TO_UK`
 * table at line 30 and `_fold_spelling` at line 53.
 *
 * ============================================================================
 * A CURATED TABLE, NOT A SUFFIX RULE.
 * ============================================================================
 * The obvious implementation is "rewrite -ize to -ise and -or to -our". It is
 * wrong, and the comment in the source says why: it turns `hour` into `houur`,
 * `your` into `youur` and `prize` into `prise`. Every pair below is here
 * because a human decided it was safe. `program` is DELIBERATELY absent — the
 * US software term is not the UK word `programme`, and folding it would make
 * an advert asking for programming match a CV about a training programme.
 *
 * Matching is exact whole-token, so without this a US-spelled advert
 * ("optimization") never sees a UK-spelled CV ("optimisation") and the
 * candidate is marked down for spelling their own language correctly.
 *
 * The input is expected to be ALREADY LOWERCASED, exactly as in the source.
 */

/**
 * Insertion order is load-bearing: it becomes the alternation order in the
 * regex below, and a regex alternation is leftmost-first. Kept in the source
 * file's order so the two implementations backtrack identically.
 */
export const US_TO_UK: Readonly<Record<string, string>> = {
  optimization: 'optimisation',
  optimize: 'optimise',
  optimized: 'optimised',
  optimizing: 'optimising',
  optimizer: 'optimiser',
  optimizations: 'optimisations',
  organization: 'organisation',
  organizations: 'organisations',
  organize: 'organise',
  organized: 'organised',
  organizing: 'organising',
  organizational: 'organisational',
  specialize: 'specialise',
  specialized: 'specialised',
  specializing: 'specialising',
  analyze: 'analyse',
  analyzed: 'analysed',
  analyzing: 'analysing',
  analyzes: 'analyses',
  prioritize: 'prioritise',
  prioritized: 'prioritised',
  prioritization: 'prioritisation',
  standardize: 'standardise',
  standardized: 'standardised',
  maximize: 'maximise',
  minimize: 'minimise',
  utilize: 'utilise',
  utilization: 'utilisation',
  realize: 'realise',
  recognize: 'recognise',
  summarize: 'summarise',
  center: 'centre',
  centered: 'centred',
  centers: 'centres',
  color: 'colour',
  behavior: 'behaviour',
  labor: 'labour',
  favor: 'favour',
  catalog: 'catalogue',
  license: 'licence',
  licensed: 'licenced',
  defense: 'defence',
  offense: 'offence',
  modeling: 'modelling',
  modeled: 'modelled',
  labeling: 'labelling',
  labeled: 'labelled',
  traveling: 'travelling',
  counseling: 'counselling',
  enrollment: 'enrolment',
  fulfillment: 'fulfilment',
  fulfill: 'fulfil',
  installment: 'instalment',
  practicing: 'practising',
};

/**
 * Escape a literal for safe inclusion in a regular expression source.
 *
 * Deliberately hand-rolled rather than `RegExp.escape`: that is ES2025 and not
 * available on every runtime this package has to work on.
 *
 * ============================================================================
 * THE HYPHEN IS ESCAPED AS `\x2d`, NOT AS `\-`. THAT IS NOT A STYLE CHOICE.
 * ============================================================================
 * `\-` is an "identity escape" that only survives because of Annex B web
 * compatibility, and Annex B is SWITCHED OFF inside a `u`-flag regex. The
 * matcher in `term.ts` needs `u` for `\p{L}`, so a term with a hyphen in it —
 * `t-sql`, `front-end`, `problem-solving`, all of them in the lexicon — makes
 * `new RegExp` throw `Invalid escape` at runtime, on a term that came out of
 * our own data files. `\x2d` is a plain hex escape, valid both inside and
 * outside a character class, with or without `u`.
 */
export function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&').replace(/-/g, '\\x2d');
}

const US_TO_UK_RE = new RegExp(
  '\\b(' + Object.keys(US_TO_UK).map(escapeRegExp).join('|') + ')\\b',
  'g',
);

/**
 * Fold the curated US spellings in `text` (expected already lowercased) to
 * their UK form. Whole words only. Anything not in the table comes through
 * byte-for-byte.
 */
export function foldSpelling(text: string): string {
  if (!text) return text;
  return text.replace(US_TO_UK_RE, (match) => US_TO_UK[match] ?? match);
}
