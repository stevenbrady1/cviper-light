/**
 * The interview pack: the Zod schema and the JSON Schema must not drift, the
 * JSON Schema must stay one level deep, and the plain-text rendering must be
 * something a person can read back from a saved document.
 */
import { describe, expect, it } from 'vitest';

import {
  INTERVIEW_PACK_JSON_SCHEMA,
  InterviewPackSchema,
  LikelyQuestionSchema,
  renderInterviewPack,
  type InterviewPack,
} from './interview';
import { type JsonSchemaNode } from './analysis';

const sorted = (keys: readonly string[]): string[] => [...keys].sort();

const EXPECTED_FIELDS = [
  'likely_questions',
  'talking_points',
  'questions_to_ask',
  'gaps_to_bridge',
];

function validPack(overrides: Partial<InterviewPack> = {}): InterviewPack {
  return {
    likely_questions: [
      {
        question: 'Tell me about a time you led a migration.',
        suggested_answer: 'At the bank I led the move to Postgres (situation)…',
      },
    ],
    talking_points: ['Led a team of four', 'AWS certified'],
    questions_to_ask: ['How is the payments platform split between teams?'],
    gaps_to_bridge: ['Kafka'],
    ...overrides,
  };
}

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

describe('interview pack schema — the two representations must not drift', () => {
  it('agrees on the top-level required-key set', () => {
    const zodKeys = sorted(Object.keys(InterviewPackSchema.shape));
    const jsonRequired = sorted(INTERVIEW_PACK_JSON_SCHEMA.required);
    const jsonProperties = sorted(Object.keys(INTERVIEW_PACK_JSON_SCHEMA.properties));

    expect(zodKeys).toEqual(sorted(EXPECTED_FIELDS));
    expect(jsonRequired).toEqual(zodKeys);
    // Every declared property is required — there are no optional fields.
    expect(jsonProperties).toEqual(jsonRequired);
  });

  it('agrees on the likely-question required-key set', () => {
    const zodKeys = sorted(Object.keys(LikelyQuestionSchema.shape));
    const schema: JsonSchemaNode = INTERVIEW_PACK_JSON_SCHEMA;
    const items = schema.properties?.['likely_questions']?.items;

    expect(items).toBeDefined();
    expect(zodKeys).toEqual(['question', 'suggested_answer']);
    expect(sorted(items?.required ?? [])).toEqual(zodKeys);
    expect(sorted(Object.keys(items?.properties ?? {}))).toEqual(zodKeys);
  });

  it('keeps the JSON Schema one level deep, closed and free of $defs', () => {
    const schema: JsonSchemaNode = INTERVIEW_PACK_JSON_SCHEMA;
    const objectNodes: Array<{ path: string; node: JsonSchemaNode }> = [];
    collectObjectNodes(schema, '$', objectNodes);

    // The root and the likely-question item. Nothing deeper.
    expect(objectNodes.map((entry) => entry.path)).toEqual(['$', '$.likely_questions[]']);
    for (const { node } of objectNodes) {
      expect(node.additionalProperties).toBe(false);
    }
    expect(JSON.stringify(schema)).not.toContain('$defs');
    expect(JSON.stringify(schema)).not.toContain('$ref');
  });

  it('orders `required` identically to the properties — that is the list a grammar walks', () => {
    expect([...INTERVIEW_PACK_JSON_SCHEMA.required]).toEqual(
      Object.keys(INTERVIEW_PACK_JSON_SCHEMA.properties),
    );
  });
});

describe('InterviewPackSchema — validating what a model sent', () => {
  it('accepts a complete pack', () => {
    expect(InterviewPackSchema.safeParse(validPack()).success).toBe(true);
  });

  it('boundary: accepts a pack whose lists are all empty', () => {
    const empty = validPack({
      likely_questions: [],
      talking_points: [],
      questions_to_ask: [],
      gaps_to_bridge: [],
    });
    expect(InterviewPackSchema.safeParse(empty).success).toBe(true);
  });

  it('negative: rejects a missing required field', () => {
    const { gaps_to_bridge: _dropped, ...partial } = validPack();
    expect(InterviewPackSchema.safeParse(partial).success).toBe(false);
  });

  it('negative: rejects a likely question with no suggested answer', () => {
    const broken = validPack({
      likely_questions: [{ question: 'Why us?' } as InterviewPack['likely_questions'][number]],
    });
    expect(InterviewPackSchema.safeParse(broken).success).toBe(false);
  });

  it('negative: rejects a string where a list is required', () => {
    const broken = { ...validPack(), talking_points: 'Led a team of four' };
    expect(InterviewPackSchema.safeParse(broken).success).toBe(false);
  });

  it('preserves unknown fields so a richer provider result is not eaten', () => {
    const parsed = InterviewPackSchema.safeParse({ ...validPack(), company_research: 'A bank.' });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect((parsed.data as Record<string, unknown>)['company_research']).toBe('A bank.');
    }
  });
});

describe('renderInterviewPack — the saved plain text', () => {
  it('writes the four sections, in order, with every item present', () => {
    const text = renderInterviewPack(validPack());

    const at = (needle: string) => {
      const index = text.indexOf(needle);
      expect(index, `"${needle}" is missing from the rendered pack`).toBeGreaterThanOrEqual(0);
      return index;
    };

    expect(at('LIKELY QUESTIONS')).toBeLessThan(at('TALKING POINTS'));
    expect(at('TALKING POINTS')).toBeLessThan(at('QUESTIONS TO ASK'));
    expect(at('QUESTIONS TO ASK')).toBeLessThan(at('GAPS TO BRIDGE'));

    expect(text).toContain('1. Tell me about a time you led a migration.');
    expect(text).toContain('At the bank I led the move to Postgres');
    expect(text).toContain('- Led a team of four');
    expect(text).toContain('- AWS certified');
    expect(text).toContain('- How is the payments platform split between teams?');
    expect(text).toContain('- Kafka');
  });

  it('boundary: an empty section says so rather than vanishing', () => {
    const text = renderInterviewPack(validPack({ gaps_to_bridge: [] }));

    expect(text).toContain('GAPS TO BRIDGE');
    expect(text).toMatch(/GAPS TO BRIDGE\n\s*None\./);
  });

  it('numbers the questions from one and keeps each answer under its question', () => {
    const text = renderInterviewPack(
      validPack({
        likely_questions: [
          { question: 'First?', suggested_answer: 'Answer one.' },
          { question: 'Second?', suggested_answer: 'Answer two.' },
        ],
      }),
    );

    expect(text.indexOf('1. First?')).toBeLessThan(text.indexOf('Answer one.'));
    expect(text.indexOf('Answer one.')).toBeLessThan(text.indexOf('2. Second?'));
    expect(text.indexOf('2. Second?')).toBeLessThan(text.indexOf('Answer two.'));
  });

  it('ends with a single newline so the saved document appends cleanly', () => {
    const text = renderInterviewPack(validPack());
    expect(text.endsWith('\n')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);
  });
});
