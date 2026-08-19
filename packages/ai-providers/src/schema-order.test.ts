/**
 * The reorder is a CORRECTNESS fix, not a preference. See `schema-order.ts` for
 * the measurements. These tests exist to stop the order drifting back, and to
 * prove the reorder changes NOTHING except order.
 */
import { CV_ANALYSIS_JSON_SCHEMA } from '@cviper/core-types';
import { describe, expect, it } from 'vitest';

import { ANALYSIS_FIELD_ORDER, reasoningFirstSchema } from './schema-order';

const reordered = reasoningFirstSchema(CV_ANALYSIS_JSON_SCHEMA) as {
  type: string;
  additionalProperties: boolean;
  required: string[];
  properties: Record<string, unknown>;
};

describe('reasoningFirstSchema — the conclusion comes last', () => {
  it('emits match_score after every piece of evidence', () => {
    const keys = Object.keys(reordered.properties);
    const score = keys.indexOf('match_score');

    for (const evidence of [
      'matched_skills',
      'missing_skills',
      'matched_keywords',
      'keyword_gaps',
      'ats_notes',
      'suggestions',
      'summary',
    ]) {
      expect(keys.indexOf(evidence)).toBeLessThan(score);
    }
  });

  it('puts verdict after match_score, since it is a function of it', () => {
    const keys = Object.keys(reordered.properties);
    expect(keys.indexOf('verdict')).toBeGreaterThan(keys.indexOf('match_score'));
  });

  it('orders `required` the same way — that is the list a grammar walks', () => {
    expect(reordered.required).toEqual(Object.keys(reordered.properties));
  });

  it('regression: match_score is NOT first', () => {
    // Being first is what produced `match_score: 0` on every single run of
    // llama3.2. If this ever goes back, the app silently scores everyone zero.
    expect(Object.keys(reordered.properties)[0]).not.toBe('match_score');
    expect(reordered.required[0]).not.toBe('match_score');
  });
});

describe('reasoningFirstSchema — nothing but the order changes', () => {
  it('keeps exactly the same field names', () => {
    expect([...reordered.required].sort()).toEqual([...CV_ANALYSIS_JSON_SCHEMA.required].sort());
    expect(Object.keys(reordered.properties).sort()).toEqual(
      Object.keys(CV_ANALYSIS_JSON_SCHEMA.properties).sort(),
    );
  });

  it('keeps every field definition byte-identical', () => {
    const original = CV_ANALYSIS_JSON_SCHEMA.properties as Record<string, unknown>;
    for (const [key, value] of Object.entries(reordered.properties)) {
      expect(value).toEqual(original[key]);
    }
  });

  it('keeps the object closed', () => {
    expect(reordered.type).toBe('object');
    expect(reordered.additionalProperties).toBe(false);
  });

  it('leaves the shared schema object unmutated', () => {
    expect(Object.keys(CV_ANALYSIS_JSON_SCHEMA.properties)[0]).toBe('match_score');
  });
});

describe('reasoningFirstSchema — drift safety', () => {
  it('carries through a field the order list has never heard of', () => {
    // If core-types gains a tenth field, it must still reach the provider —
    // silently dropping it would be a schema change by omission.
    const extended = {
      type: 'object',
      additionalProperties: false,
      required: ['match_score', 'confidence'],
      properties: {
        match_score: { type: 'integer' },
        confidence: { type: 'string' },
      },
    };
    const out = reasoningFirstSchema(extended) as { required: string[] };
    expect([...out.required].sort()).toEqual(['confidence', 'match_score']);
  });

  it('skips an ordered field that this schema does not have', () => {
    const partial = {
      type: 'object',
      required: ['summary', 'match_score'],
      properties: { summary: { type: 'string' }, match_score: { type: 'integer' } },
    };
    const out = reasoningFirstSchema(partial) as { required: string[] };
    expect(out.required).toEqual(['summary', 'match_score']);
  });

  it('negative: a non-object schema is returned untouched rather than mangled', () => {
    for (const junk of [null, undefined, 42, 'text', [1, 2]]) {
      expect(reasoningFirstSchema(junk)).toEqual(junk);
    }
  });

  it('boundary: a schema with no properties is returned untouched', () => {
    const bare = { type: 'object' };
    expect(reasoningFirstSchema(bare)).toEqual(bare);
  });

  it('the order list covers every field in the locked schema', () => {
    // A field added to core-types without a place in the order list would land
    // at the end — AFTER match_score — and lose the whole benefit. This fails
    // the moment the two drift.
    for (const key of Object.keys(CV_ANALYSIS_JSON_SCHEMA.properties)) {
      expect(ANALYSIS_FIELD_ORDER).toContain(key);
    }
  });
});
