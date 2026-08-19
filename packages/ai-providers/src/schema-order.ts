/**
 * schema-order.ts — emit the evidence before the conclusion.
 *
 * ============================================================================
 * THIS IS THE SINGLE HIGHEST-IMPACT LINE OF CODE IN THE PACKAGE.
 * MEASURED, NOT GUESSED.
 * ============================================================================
 * `CV_ANALYSIS_JSON_SCHEMA` lists `match_score` FIRST. Every provider we use
 * enforces its schema with constrained decoding — Ollama compiles `format` into
 * a llama.cpp grammar, OpenAI's `strict: true` and Anthropic's
 * `output_config.format` do the equivalent — and a grammar walks the schema's
 * property order. So the model is forced to emit its final score as the very
 * first token of its answer, BEFORE it has written a single word of the skill
 * audit, the experience comparison or the ATS screen that are supposed to
 * produce that score.
 *
 * It cannot reason before it has answered, so it does not reason. Measured
 * against llama3.2:latest (3.2B, Q4_K_M) on one realistic CV and advert:
 *
 *   schema order                          match_score   runs
 *   ────────────────────────────────────  ───────────   ────
 *   match_score FIRST (the locked order)      0          5/5
 *   no schema, model picks its own order     71          2/2
 *   match_score LAST (this module)           71          3/3
 *
 * Zero. Every time. For a candidate the same model described in the same reply
 * as having "a strong background in Python and AWS, with relevant experience in
 * payments and fintech". The output was 100% schema-valid on the first attempt
 * every time — nothing failed, nothing retried, and the number was worthless.
 * That is the "valid but inert" failure in its purest form.
 *
 * 71 is not a coincidence. `FIT_SCORE_ANCHORS` carries a worked example scoring
 * a very similar profile at 71. Left free to reason first, the model lands on
 * the calibrated answer; forced to answer first, it emits the smallest integer
 * the grammar allows.
 *
 * ============================================================================
 * WHAT THIS IS NOT
 * ============================================================================
 * It is NOT a change to the locked schema. Same nine fields, same types, same
 * required set, same closed objects — asserted field by field in the tests. The
 * ONLY difference is the sequence, which is invisible to Zod (key order means
 * nothing to an object) and invisible to the `CvAnalysis` type.
 *
 * It is applied on the wire, in this package, exactly as the Anthropic adapter
 * strips `minimum`/`maximum` on the way out. `CV_ANALYSIS_JSON_SCHEMA` in
 * @cviper/core-types is untouched and still the single source of truth.
 *
 * The cleaner long-term home for this is the property order of
 * `CV_ANALYSIS_JSON_SCHEMA` itself, so every future consumer inherits it. That
 * is a change to another phase's locked artefact and is a decision for a human,
 * not something to slip in from here.
 */

/**
 * Evidence first, conclusion last.
 *
 * Reading order, and why:
 *   1-2  the skill audit (Steps 1-4 of the prompt)
 *   3-4  the keyword screen (Step 5 factor 1)
 *   5    the rest of the ATS screen (Step 5 factors 2-7)
 *   6    the concrete edits, which depend on everything above
 *   7    the prose summary — the model's own reasoning, written out
 *   8    match_score — the conclusion, now that there is something to conclude
 *   9    verdict — a function of the score, so it cannot precede it. Discarded
 *        and recomputed by `deriveVerdict` regardless; it stays in the schema
 *        because removing a field is a schema change and this is not one.
 */
export const ANALYSIS_FIELD_ORDER = [
  'matched_skills',
  'missing_skills',
  'matched_keywords',
  'keyword_gaps',
  'ats_notes',
  'suggestions',
  'summary',
  'match_score',
  'verdict',
] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Return the same schema with its top-level properties resequenced.
 *
 * Only the TOP level is touched. `suggestions[].items` is left exactly as it
 * is: its four fields are all evidence, none of them is a conclusion drawn from
 * the others, and reordering them would buy nothing.
 *
 * A field the order list has never heard of is appended rather than dropped —
 * losing a field would be a silent schema change, which is the one thing this
 * module must not do.
 */
export function reasoningFirstSchema(schema: unknown): unknown {
  if (!isPlainObject(schema)) return schema;

  const properties = schema['properties'];
  if (!isPlainObject(properties)) return schema;

  const known = ANALYSIS_FIELD_ORDER.filter((key) => key in properties);
  const unknownKeys = Object.keys(properties).filter(
    (key) => !(ANALYSIS_FIELD_ORDER as readonly string[]).includes(key),
  );
  const ordered = [...known, ...unknownKeys];

  const orderedProperties: Record<string, unknown> = {};
  for (const key of ordered) orderedProperties[key] = properties[key];

  const required = Array.isArray(schema['required'])
    ? ordered.filter((key) => (schema['required'] as unknown[]).includes(key))
    : schema['required'];

  return {
    ...schema,
    properties: orderedProperties,
    ...(required === undefined ? {} : { required }),
  };
}
