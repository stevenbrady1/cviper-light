/**
 * schema-order.ts — emit the evidence before the conclusion.
 *
 * ============================================================================
 * NOW A REGRESSION GUARD, NOT A REPAIR. READ THIS BEFORE DELETING IT.
 * ============================================================================
 * `CV_ANALYSIS_JSON_SCHEMA` in @cviper/core-types NOW DECLARES ITS PROPERTIES
 * IN THIS ORDER ITSELF, so `reasoningFirstSchema()` is a no-op on the schema it
 * is applied to today. That looks like dead code and is not: it is the only
 * thing that makes a reorder in core-types LOUD instead of silent.
 *
 * Deleting this module would not break a single provider call. It would remove
 * the guard, and the next person who tidies the property order in core-types
 * back into "score first, then the details" — which reads perfectly naturally —
 * would ship an inflated score with a green test suite. That is exactly how the
 * bug arrived the first time.
 *
 * The tests hold both halves: this must stay a no-op on the canonical schema,
 * AND it must still repair a schema that puts the score first. A guard that
 * cannot fail is not a guard.
 *
 * ============================================================================
 * WHY THE ORDER MATTERS AT ALL. MEASURED, NOT GUESSED.
 * ============================================================================
 * The original `CV_ANALYSIS_JSON_SCHEMA` listed `match_score` FIRST. Every
 * provider we use
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
 * It is still applied on the wire, in this package, exactly as the Anthropic
 * adapter strips `minimum`/`maximum` on the way out — so a hand-built schema, or
 * a core-types regression, is corrected before it reaches a model either way.
 *
 * `ANALYSIS_FIELD_ORDER` below and the property order in core-types are the
 * SAME ORDER STATED TWICE, in two packages that cannot import each other in
 * that direction. `schema-order.test.ts` asserts they agree field for field, so
 * changing one alone fails the suite.
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
