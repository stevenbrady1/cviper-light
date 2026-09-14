import { describe, expect, it } from 'vitest';

import { type JsonSchemaNode } from './analysis';
import {
  COVER_LETTER_JSON_SCHEMA,
  CoverLetterSchema,
  DRAFT_REVIEW_JSON_SCHEMA,
  DraftReviewIssueSchema,
  DraftReviewSchema,
  TAILORED_CV_JSON_SCHEMA,
  TailoredCvRoleSchema,
  TailoredCvSchema,
  renderCoverLetter,
  renderTailoredCv,
  wordCount,
  type CoverLetter,
  type TailoredCv,
} from './tailoring';

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

function makeTailoredCv(): TailoredCv {
  return {
    summary: 'Credit risk analyst with eight years in London banking.',
    key_skills: ['SQL', 'Python', 'IFRS 9'],
    experience: [
      {
        title: 'Senior Credit Risk Analyst',
        company: 'Lloyds Banking Group',
        location: 'London',
        dates: 'Jan 2020 – Present',
        bullets: ['Built IFRS 9 impairment models in Python.', 'Reported to the CRO.'],
      },
      {
        title: 'Analyst',
        company: 'Barclays',
        location: '',
        dates: '2016 – 2019',
        bullets: ['Ran stress tests.'],
      },
    ],
    education: ['BSc Mathematics, University of Leeds, 2016'],
    certifications: [],
  };
}

function makeLetter(): CoverLetter {
  return {
    greeting: 'Dear Hiring Manager,',
    paragraphs: ['First paragraph.', 'Second paragraph.'],
    sign_off: 'Yours sincerely,\nSteve',
  };
}

/**
 * The two representations must agree at every level — the same guard
 * `analysis.test.ts` keeps for the flat schema, applied one level deeper here
 * because this schema nests one level deeper.
 */
describe('the Zod and JSON Schema representations agree on required keys', () => {
  it('tailored CV: top level', () => {
    const zodKeys = sorted(Object.keys(TailoredCvSchema.shape));
    expect(sorted(TAILORED_CV_JSON_SCHEMA.required)).toEqual(zodKeys);
    expect(sorted(Object.keys(TAILORED_CV_JSON_SCHEMA.properties))).toEqual(zodKeys);
  });

  it('tailored CV: one role', () => {
    const zodKeys = sorted(Object.keys(TailoredCvRoleSchema.shape));
    const items: JsonSchemaNode | undefined = TAILORED_CV_JSON_SCHEMA.properties.experience.items;
    expect(sorted(items?.required ?? [])).toEqual(zodKeys);
    expect(sorted(Object.keys(items?.properties ?? {}))).toEqual(zodKeys);
  });

  it('cover letter', () => {
    const zodKeys = sorted(Object.keys(CoverLetterSchema.shape));
    expect(sorted(COVER_LETTER_JSON_SCHEMA.required)).toEqual(zodKeys);
    expect(sorted(Object.keys(COVER_LETTER_JSON_SCHEMA.properties))).toEqual(zodKeys);
  });

  it('draft review: top level and one issue', () => {
    const zodKeys = sorted(Object.keys(DraftReviewSchema.shape));
    expect(sorted(DRAFT_REVIEW_JSON_SCHEMA.required)).toEqual(zodKeys);
    expect(sorted(Object.keys(DRAFT_REVIEW_JSON_SCHEMA.properties))).toEqual(zodKeys);

    const issueKeys = sorted(Object.keys(DraftReviewIssueSchema.shape));
    const items: JsonSchemaNode | undefined = DRAFT_REVIEW_JSON_SCHEMA.properties.issues.items;
    expect(sorted(items?.required ?? [])).toEqual(issueKeys);
    expect(sorted(Object.keys(items?.properties ?? {}))).toEqual(issueKeys);
  });

  it('every object is closed, at every level', () => {
    const roles = TAILORED_CV_JSON_SCHEMA.properties.experience.items;
    const issues = DRAFT_REVIEW_JSON_SCHEMA.properties.issues.items;
    for (const node of [
      TAILORED_CV_JSON_SCHEMA,
      roles,
      COVER_LETTER_JSON_SCHEMA,
      DRAFT_REVIEW_JSON_SCHEMA,
      issues,
    ]) {
      expect(node.additionalProperties).toBe(false);
    }
  });

  it('nests exactly one level: a role holds strings and a list of strings, nothing deeper', () => {
    const role = TAILORED_CV_JSON_SCHEMA.properties.experience.items;
    for (const property of Object.values(role.properties)) {
      const node: JsonSchemaNode = property;
      expect(node.type === 'string' || node.items?.type === 'string').toBe(true);
    }
  });
});

describe('the Zod schemas validate what a model actually sent', () => {
  it('accepts a complete tailored CV and keeps unknown fields', () => {
    const parsed = TailoredCvSchema.safeParse({ ...makeTailoredCv(), extra: 'kept' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect((parsed.data as { extra?: string }).extra).toBe('kept');
  });

  it('negative: rejects a role that is missing its company', () => {
    const cv = makeTailoredCv();
    const { company: _dropped, ...roleWithoutCompany } = cv.experience[0]!;
    const parsed = TailoredCvSchema.safeParse({ ...cv, experience: [roleWithoutCompany] });
    expect(parsed.success).toBe(false);
  });

  it('negative: rejects bullets given as one string instead of a list', () => {
    const cv = makeTailoredCv();
    const parsed = TailoredCvSchema.safeParse({
      ...cv,
      experience: [{ ...cv.experience[0], bullets: 'one bullet' }],
    });
    expect(parsed.success).toBe(false);
  });

  it('negative: a review verdict outside the two words is refused', () => {
    expect(DraftReviewSchema.safeParse({ verdict: 'maybe', issues: [] }).success).toBe(false);
    expect(DraftReviewSchema.safeParse({ verdict: 'ready', issues: [] }).success).toBe(true);
  });

  it('boundary: an empty letter body is still a letter', () => {
    expect(
      CoverLetterSchema.safeParse({ greeting: '', paragraphs: [], sign_off: '' }).success,
    ).toBe(true);
  });
});

describe('renderTailoredCv', () => {
  it('follows the mandatory section order, with the name first when given', () => {
    const text = renderTailoredCv(makeTailoredCv(), 'Steve Brady');
    const order = [
      'Steve Brady',
      'PROFESSIONAL SUMMARY',
      'KEY SKILLS',
      'PROFESSIONAL EXPERIENCE',
      'EDUCATION',
    ].map((heading) => text.indexOf(heading));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(text.startsWith('Steve Brady\n\nPROFESSIONAL SUMMARY\n')).toBe(true);
  });

  it('renders each role as title, then company | location | dates, then dashed bullets', () => {
    const text = renderTailoredCv(makeTailoredCv(), null);
    expect(text).toContain(
      'Senior Credit Risk Analyst\nLloyds Banking Group | London | Jan 2020 – Present\n' +
        '- Built IFRS 9 impairment models in Python.\n- Reported to the CRO.',
    );
  });

  it('boundary: leaves out an empty location rather than printing a bare bar', () => {
    const text = renderTailoredCv(makeTailoredCv(), null);
    expect(text).toContain('Analyst\nBarclays | 2016 – 2019\n- Ran stress tests.');
    expect(text).not.toContain('| |');
  });

  it('omits CERTIFICATIONS when there are none, and includes it when there are', () => {
    expect(renderTailoredCv(makeTailoredCv(), null)).not.toContain('CERTIFICATIONS');
    const withCerts = { ...makeTailoredCv(), certifications: ['FRM, GARP, 2021'] };
    expect(renderTailoredCv(withCerts, null)).toContain('CERTIFICATIONS\nFRM, GARP, 2021');
  });

  it('boundary: no name and a blank name both mean no name line', () => {
    expect(renderTailoredCv(makeTailoredCv(), null).startsWith('PROFESSIONAL SUMMARY')).toBe(true);
    expect(renderTailoredCv(makeTailoredCv(), '   ').startsWith('PROFESSIONAL SUMMARY')).toBe(true);
  });

  it('ends with exactly one newline', () => {
    const text = renderTailoredCv(makeTailoredCv(), null);
    expect(text.endsWith('\n')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);
  });
});

describe('renderCoverLetter', () => {
  it('separates greeting, paragraphs and sign-off with blank lines', () => {
    expect(renderCoverLetter(makeLetter())).toBe(
      'Dear Hiring Manager,\n\nFirst paragraph.\n\nSecond paragraph.\n\nYours sincerely,\nSteve\n',
    );
  });

  it('boundary: an empty paragraph is dropped rather than left as a double gap', () => {
    const letter = { ...makeLetter(), paragraphs: ['Only.', '   '] };
    expect(renderCoverLetter(letter)).toBe(
      'Dear Hiring Manager,\n\nOnly.\n\nYours sincerely,\nSteve\n',
    );
  });
});

describe('wordCount', () => {
  it('counts runs of non-whitespace', () => {
    expect(wordCount('Dear Hiring Manager,\n\nI led  a team.')).toBe(7);
  });

  it('boundary: empty and whitespace-only text is zero words', () => {
    expect(wordCount('')).toBe(0);
    expect(wordCount(' \n\t ')).toBe(0);
  });
});
