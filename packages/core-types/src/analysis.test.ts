import { describe, expect, it } from 'vitest';

import {
  CV_ANALYSIS_JSON_SCHEMA,
  CvAnalysisSchema,
  CvAnalysisSuggestionSchema,
  deriveVerdict,
  type CvAnalysis,
  type JsonSchemaNode,
  type Verdict,
} from './analysis';

/** The nine fields of the flat analysis schema. */
const EXPECTED_ANALYSIS_FIELDS = [
  'ats_notes',
  'keyword_gaps',
  'match_score',
  'matched_keywords',
  'matched_skills',
  'missing_skills',
  'suggestions',
  'summary',
  'verdict',
] as const;

/** The four flat fields of a suggestion. */
const EXPECTED_SUGGESTION_FIELDS = ['issue', 'priority', 'recommendation', 'section'] as const;

/**
 * The CANONICAL property order — evidence first, conclusion last.
 *
 * Not an alphabetical or aesthetic choice. Every provider we send this schema
 * to enforces it with constrained decoding, and a grammar walks the properties
 * in the order they are declared. Listing `match_score` first forces the model
 * to emit its conclusion as the very first token of its answer, before it has
 * written a word of the skill audit that is supposed to produce that score. It
 * cannot reason before it has answered, so it does not reason: measured against
 * llama3.2 (3.2B, Q4_K_M) the same candidate scored 92 with the score first and
 * 85 with it last, against a prompt whose own calibration example puts that
 * candidate at 84.
 *
 * This is a KEY ORDER, not a schema change. Same nine fields, same types, same
 * `required` set. JSON object key order is meaningless to `JSON.parse` and to
 * Zod, and this schema is not the export format, so it does NOT bump
 * `BACKUP_SCHEMA_VERSION` — nothing that reads a file cares.
 */
const CANONICAL_FIELD_ORDER = [
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

function makeCvAnalysis(): CvAnalysis {
  return {
    match_score: 82,
    verdict: 'strong',
    summary: 'Strong overlap on credit risk and Python; light on regulatory reporting.',
    matched_skills: ['Python', 'Credit Risk', 'SQL'],
    missing_skills: ['IFRS 9', 'Murex'],
    keyword_gaps: ['stress testing', 'IRB'],
    matched_keywords: ['counterparty', 'VaR'],
    suggestions: [
      {
        section: 'Summary',
        issue: 'No mention of regulatory reporting.',
        recommendation: 'Add a line naming COREP/FINREP experience.',
        priority: 'high',
      },
    ],
    ats_notes: ['Two-column layout may not parse cleanly.'],
  };
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

/** Collect every `type: 'object'` node in the schema, with its path. */
function collectObjectNodes(
  node: JsonSchemaNode,
  path: string,
  out: Array<{ path: string; node: JsonSchemaNode }>,
): void {
  if (node.type === 'object') out.push({ path, node });
  if (node.properties) {
    for (const [key, child] of Object.entries(node.properties)) {
      collectObjectNodes(child, `${path}.${key}`, out);
    }
  }
  if (node.items) collectObjectNodes(node.items, `${path}[]`, out);
}

describe('CV analysis schema — the two representations must not drift', () => {
  it('agrees on the top-level required-key set', () => {
    const zodKeys = sorted(Object.keys(CvAnalysisSchema.shape));
    const jsonRequired = sorted(CV_ANALYSIS_JSON_SCHEMA.required);
    const jsonProperties = sorted(Object.keys(CV_ANALYSIS_JSON_SCHEMA.properties));

    expect(zodKeys).toEqual(sorted(EXPECTED_ANALYSIS_FIELDS));
    expect(jsonRequired).toEqual(zodKeys);
    // Every declared property is required — there are no optional fields.
    expect(jsonProperties).toEqual(jsonRequired);
  });

  it('agrees on the suggestion required-key set', () => {
    const zodKeys = sorted(Object.keys(CvAnalysisSuggestionSchema.shape));
    const schema: JsonSchemaNode = CV_ANALYSIS_JSON_SCHEMA;
    const items = schema.properties?.['suggestions']?.items;

    expect(items).toBeDefined();
    expect(zodKeys).toEqual(sorted(EXPECTED_SUGGESTION_FIELDS));
    expect(sorted(items?.required ?? [])).toEqual(zodKeys);
    expect(sorted(Object.keys(items?.properties ?? {}))).toEqual(zodKeys);
  });

  it('keeps the JSON Schema flat, closed and free of $defs', () => {
    const schema: JsonSchemaNode = CV_ANALYSIS_JSON_SCHEMA;
    const objectNodes: Array<{ path: string; node: JsonSchemaNode }> = [];
    collectObjectNodes(schema, '$', objectNodes);

    // Exactly two objects exist: the root and a suggestion. Nothing deeper.
    expect(objectNodes.map((entry) => entry.path)).toEqual(['$', '$.suggestions[]']);

    // Anthropic's structured outputs REJECT a schema whose objects do not
    // close themselves, so this must hold on every object without exception.
    for (const entry of objectNodes) {
      expect(entry.node.additionalProperties, `additionalProperties at ${entry.path}`).toBe(false);
    }

    const serialised = JSON.stringify(CV_ANALYSIS_JSON_SCHEMA);
    expect(serialised).not.toContain('$defs');
    expect(serialised).not.toContain('$ref');
  });
});

describe('CV analysis schema — the evidence is declared before the conclusion', () => {
  it('declares its properties in the canonical order', () => {
    expect(Object.keys(CV_ANALYSIS_JSON_SCHEMA.properties)).toEqual([...CANONICAL_FIELD_ORDER]);
  });

  it('orders `required` identically — that is the list a grammar walks', () => {
    expect([...CV_ANALYSIS_JSON_SCHEMA.required]).toEqual([...CANONICAL_FIELD_ORDER]);
  });

  it('regression: match_score is never first', () => {
    // Being first is what produced the inflated score. If it goes back, every
    // candidate is graded before the model has looked at their CV.
    expect(Object.keys(CV_ANALYSIS_JSON_SCHEMA.properties)[0]).not.toBe('match_score');
    expect(CV_ANALYSIS_JSON_SCHEMA.required[0]).not.toBe('match_score');
  });

  it('puts every piece of evidence before match_score', () => {
    const keys: string[] = Object.keys(CV_ANALYSIS_JSON_SCHEMA.properties);
    const score = keys.indexOf('match_score');

    for (const evidence of CANONICAL_FIELD_ORDER.slice(0, -2)) {
      expect(keys.indexOf(evidence)).toBeLessThan(score);
    }
  });

  it('puts verdict last, since it is a function of the score', () => {
    const keys: string[] = Object.keys(CV_ANALYSIS_JSON_SCHEMA.properties);
    expect(keys.indexOf('verdict')).toBeGreaterThan(keys.indexOf('match_score'));
  });

  it('changes nothing but the order — same fields, same required set', () => {
    expect([...CANONICAL_FIELD_ORDER].sort()).toEqual(sorted(EXPECTED_ANALYSIS_FIELDS));
    expect(sorted(CV_ANALYSIS_JSON_SCHEMA.required)).toEqual(sorted(EXPECTED_ANALYSIS_FIELDS));
  });
});

describe('deriveVerdict — computed here, never trusted from the model', () => {
  const cases: Array<[number, Verdict]> = [
    [0, 'weak'],
    [59, 'weak'],
    [60, 'possible'],
    [74, 'possible'],
    [75, 'strong'],
    [100, 'strong'],
  ];

  it.each(cases)('maps %i to %s', (score, expected) => {
    expect(deriveVerdict(score)).toBe(expected);
  });

  it('treats an unreadable score as weak rather than guessing', () => {
    expect(deriveVerdict(Number.NaN)).toBe('weak');
  });

  it('ignores whatever verdict the model claimed', () => {
    // The exact self-contradiction this function exists to stop: score 72,
    // model says "strong".
    const fromModel: CvAnalysis = { ...makeCvAnalysis(), match_score: 72, verdict: 'strong' };
    expect(deriveVerdict(fromModel.match_score)).toBe('possible');
  });
});

describe('CvAnalysisSchema validation', () => {
  it('accepts a complete analysis', () => {
    const result = CvAnalysisSchema.safeParse(makeCvAnalysis());
    expect(result.success).toBe(true);
  });

  it('accepts the score boundaries 0 and 100', () => {
    expect(CvAnalysisSchema.safeParse({ ...makeCvAnalysis(), match_score: 0 }).success).toBe(true);
    expect(CvAnalysisSchema.safeParse({ ...makeCvAnalysis(), match_score: 100 }).success).toBe(
      true,
    );
  });

  it('rejects scores outside 0-100', () => {
    expect(CvAnalysisSchema.safeParse({ ...makeCvAnalysis(), match_score: -1 }).success).toBe(
      false,
    );
    expect(CvAnalysisSchema.safeParse({ ...makeCvAnalysis(), match_score: 101 }).success).toBe(
      false,
    );
  });

  it('rejects a non-integer score', () => {
    expect(CvAnalysisSchema.safeParse({ ...makeCvAnalysis(), match_score: 82.5 }).success).toBe(
      false,
    );
  });

  it('rejects a verdict outside the three allowed values', () => {
    const bad = { ...makeCvAnalysis(), verdict: 'excellent' };
    expect(CvAnalysisSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a suggestion priority outside the three allowed values', () => {
    const analysis = makeCvAnalysis();
    const bad = {
      ...analysis,
      suggestions: [{ ...analysis.suggestions[0], priority: 'urgent' }],
    };
    expect(CvAnalysisSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a missing required field', () => {
    const withoutSummary: Record<string, unknown> = { ...makeCvAnalysis() };
    delete withoutSummary['summary'];
    expect(CvAnalysisSchema.safeParse(withoutSummary).success).toBe(false);
  });

  it('rejects a string where an array of strings is required', () => {
    const bad = { ...makeCvAnalysis(), matched_skills: 'Python' };
    expect(CvAnalysisSchema.safeParse(bad).success).toBe(false);
  });

  it('preserves unknown fields so a richer provider result is not eaten', () => {
    const result = CvAnalysisSchema.safeParse({ ...makeCvAnalysis(), confidence: 0.9 });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ confidence: 0.9 });
  });
});
