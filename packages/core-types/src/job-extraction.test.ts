import { describe, expect, it } from 'vitest';

import {
  EMPTY_JOB_EXTRACTION,
  JOB_EXTRACTION_JSON_SCHEMA,
  JobExtractionSchema,
  type JobExtraction,
  type JsonSchemaNode,
} from './job-extraction';

/** The nine fields of the flat extraction schema, alphabetically. */
const EXPECTED_FIELDS = [
  'company',
  'description',
  'location',
  'posted_date',
  'salary_currency',
  'salary_max',
  'salary_min',
  'title',
  'url',
] as const;

/**
 * The CANONICAL property order — what the advert SAYS before what we WORK OUT.
 *
 * Same constrained-decoding reasoning as `CV_ANALYSIS_JSON_SCHEMA`: every
 * provider enforces the schema with a grammar that walks the properties in
 * declaration order, so whatever is listed first is emitted first, before the
 * model has written anything it could reason from.
 *
 * Four fields copied off the page, then the prose, then four derived:
 *
 *   1-4  title, company, location, url — lifted verbatim from the advert
 *   5    description — the model writes the role out, INCLUDING any salary
 *        wording it is about to refuse to turn into a number
 *   6    posted_date — a date, worked out from "posted last Tuesday"
 *   7-9  salary_currency, salary_min, salary_max — the derived numbers, last,
 *        so the wording in `description` is already on the page when the model
 *        decides whether a number is even available
 *
 * Putting `salary_min` first would make a 3B model emit a figure as its opening
 * token, and the whole point of this feature is that it says null instead.
 */
const CANONICAL_FIELD_ORDER = [
  'title',
  'company',
  'location',
  'url',
  'description',
  'posted_date',
  'salary_currency',
  'salary_min',
  'salary_max',
] as const;

const sorted = (values: readonly string[]): string[] => [...values].sort();

function makeExtraction(): JobExtraction {
  return {
    title: 'Credit Risk Analyst',
    company: 'Lloyds Banking Group',
    location: 'City of London (hybrid, 3 days on site)',
    url: 'https://example.invalid/jobs/1',
    description: 'Second-line credit risk for the wholesale book.',
    posted_date: '2026-08-18',
    salary_currency: 'GBP',
    salary_min: 45000,
    salary_max: 55000,
  };
}

function collectObjectNodes(
  node: JsonSchemaNode,
  path: string,
  out: Array<{ path: string; node: JsonSchemaNode }>,
): void {
  if (node.type === 'object') out.push({ path, node });
  for (const [key, child] of Object.entries(node.properties ?? {})) {
    collectObjectNodes(child, `${path}.${key}`, out);
  }
  if (node.items) collectObjectNodes(node.items, `${path}[]`, out);
}

describe('job extraction schema — the two representations must not drift', () => {
  it('agrees on the top-level required-key set', () => {
    const zodKeys = sorted(Object.keys(JobExtractionSchema.shape));
    const jsonRequired = sorted(JOB_EXTRACTION_JSON_SCHEMA.required);
    const jsonProperties = sorted(Object.keys(JOB_EXTRACTION_JSON_SCHEMA.properties));

    expect(zodKeys).toEqual(sorted(EXPECTED_FIELDS));
    expect(jsonRequired).toEqual(zodKeys);
    // Every declared property is required. Nullable, not optional: the key is
    // always there, and "the advert did not say" is spelled `null`.
    expect(jsonProperties).toEqual(jsonRequired);
  });

  it('has exactly nine fields — the locked shape, not the source app’s seventeen', () => {
    expect(Object.keys(JobExtractionSchema.shape)).toHaveLength(9);
    expect(JOB_EXTRACTION_JSON_SCHEMA.required).toHaveLength(9);
  });

  it('has no field the source app’s wider schema would have added', () => {
    // The port deliberately drops `agency`, `recruiter_name`, `recruiter_email`,
    // `ir35_status`, `contract_type`, `estimated_salary` and the rest. A future
    // edit that quietly reinstates one has to change this list first.
    const keys = Object.keys(JobExtractionSchema.shape);
    for (const absent of [
      'agency',
      'recruiter_name',
      'recruiter_email',
      'ir35_status',
      'contract_type',
      'contract_duration',
      'estimated_salary',
      'salary',
      'salary_period',
    ]) {
      expect(keys).not.toContain(absent);
    }
  });

  it('keeps the JSON Schema flat, closed and free of $defs', () => {
    const schema: JsonSchemaNode = JOB_EXTRACTION_JSON_SCHEMA;
    const objectNodes: Array<{ path: string; node: JsonSchemaNode }> = [];
    collectObjectNodes(schema, '$', objectNodes);

    // Exactly ONE object exists: the root. A 3B model loses the thread inside a
    // nested object, which is why the source app's `estimated_salary` sub-object
    // did not come across.
    expect(objectNodes.map((entry) => entry.path)).toEqual(['$']);

    for (const entry of objectNodes) {
      // Anthropic's structured outputs REJECT a schema whose objects do not
      // close themselves.
      expect(entry.node.additionalProperties, `additionalProperties at ${entry.path}`).toBe(false);
    }

    const serialised = JSON.stringify(JOB_EXTRACTION_JSON_SCHEMA);
    expect(serialised).not.toContain('$defs');
    expect(serialised).not.toContain('$ref');
  });

  it('lets every single field be null — never guess is the whole feature', () => {
    for (const [name, node] of Object.entries(JOB_EXTRACTION_JSON_SCHEMA.properties)) {
      // Read through `unknown` so the assertion works whether a field declares a
      // bare type or a union — narrowing a readonly tuple with `Array.isArray`
      // does not, and the point here is the runtime value, not the type.
      const raw: unknown = node.type;
      const declared: readonly unknown[] = Array.isArray(raw) ? raw : [raw];
      expect(declared, `${name} must permit null`).toContain('null');
    }
  });

  it('gives every field a short description for the model to read', () => {
    for (const [name, node] of Object.entries(JOB_EXTRACTION_JSON_SCHEMA.properties)) {
      expect(node.description, `${name} needs a description`).toBeTruthy();
    }
  });
});

describe('job extraction schema — property order is load-bearing', () => {
  it('declares what the advert says before what we work out', () => {
    expect(Object.keys(JOB_EXTRACTION_JSON_SCHEMA.properties)).toEqual([...CANONICAL_FIELD_ORDER]);
  });

  it('orders `required` identically — that is the list a grammar walks', () => {
    expect([...JOB_EXTRACTION_JSON_SCHEMA.required]).toEqual([...CANONICAL_FIELD_ORDER]);
  });

  it('never puts a salary field first', () => {
    const first = Object.keys(JOB_EXTRACTION_JSON_SCHEMA.properties)[0];
    expect(first).not.toContain('salary');
    expect(first).toBe('title');
  });

  it('writes the description before it derives any salary number', () => {
    const order = Object.keys(JOB_EXTRACTION_JSON_SCHEMA.properties);
    const description = order.indexOf('description');
    for (const derived of ['salary_currency', 'salary_min', 'salary_max']) {
      expect(description, `description must precede ${derived}`).toBeLessThan(
        order.indexOf(derived),
      );
    }
  });
});

describe('JobExtractionSchema — validation', () => {
  it('accepts a fully populated extraction', () => {
    const parsed = JobExtractionSchema.safeParse(makeExtraction());
    expect(parsed.success).toBe(true);
  });

  it('accepts an all-null extraction — the honest answer to a junk paste', () => {
    const parsed = JobExtractionSchema.safeParse(EMPTY_JOB_EXTRACTION);
    expect(parsed.success).toBe(true);
  });

  it('EMPTY_JOB_EXTRACTION really is empty, field for field', () => {
    expect(Object.keys(EMPTY_JOB_EXTRACTION).sort()).toEqual(sorted(EXPECTED_FIELDS));
    for (const value of Object.values(EMPTY_JOB_EXTRACTION)) {
      expect(value).toBeNull();
    }
  });

  it('rejects a missing key — absent is not the same as null', () => {
    const { salary_min: _dropped, ...rest } = makeExtraction();
    expect(JobExtractionSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects a string where a number belongs', () => {
    expect(
      JobExtractionSchema.safeParse({ ...makeExtraction(), salary_min: '45000' }).success,
    ).toBe(false);
  });

  it('rejects a non-integer salary', () => {
    expect(
      JobExtractionSchema.safeParse({ ...makeExtraction(), salary_max: 55000.5 }).success,
    ).toBe(false);
  });

  it('boundary: a zero salary is a number and is accepted', () => {
    const parsed = JobExtractionSchema.safeParse({
      ...makeExtraction(),
      salary_min: 0,
      salary_max: 0,
    });
    expect(parsed.success).toBe(true);
  });

  it('boundary: an empty string is accepted here — collapsing it to null is the clamp’s job', () => {
    // Documented on purpose. The schema's job is types; `extraction-clamp.ts`
    // is what turns "" into null so the review form renders one state.
    expect(JobExtractionSchema.safeParse({ ...makeExtraction(), title: '' }).success).toBe(true);
  });

  it('keeps an unrecognised field rather than eating it', () => {
    // Same reasoning as `CvAnalysisSchema`: loose on the way in, closed on the
    // way out. A richer result from a bigger cloud model must survive.
    const parsed = JobExtractionSchema.safeParse({ ...makeExtraction(), ir35_status: 'Outside' });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data['ir35_status']).toBe('Outside');
  });
});
