/**
 * A wrong-shaped answer twice gives the user a sentence, never the schema's own
 * words (L-350).
 *
 * ============================================================================
 * WHY THIS EXISTS
 * ============================================================================
 * Every AI feature asks the model for JSON, checks it against a schema, and on
 * a mismatch spends its one repair turn telling the model what was wrong:
 * "match_score: Invalid input: expected number, received undefined". That text
 * is written for the MODEL. For months five of the seven features also handed
 * it to the PERSON when the repair turn failed too, and the red banner read
 * like a stack trace. One string was serving two readers. Job extraction and
 * the follow-up draft already swapped in a sentence; analysis, tailoring, the
 * review, the cover letter and interview prep did not.
 *
 * ============================================================================
 * A FORBID-LIST, NOT AN ALLOW-LIST
 * ============================================================================
 * This never pins the sentence a feature shows — rewording it is free. It pins
 * what must be ABSENT from it: the validator's vocabulary ("Invalid input",
 * "expected X, received Y"), the "(root)" placeholder, a "field.path: " prefix,
 * the "…and N more" tail, and a line break (the builder joins issues with one).
 *
 * The negative case runs the other way on purpose: a provider's own error (a
 * rejected key) was written for a person, and must still reach them unchanged.
 */
import { err, ok, type Result } from '@cviper/core-types';
import { describe, expect, it } from 'vitest';

import { analyzeCv } from './analyze';
import { writeCoverLetter } from './cover-letter';
import { extractJob } from './extract-job';
import { draftFollowUp } from './follow-up';
import { prepareInterview } from './interview';
import { reviewDraft } from './review';
import { tailorCv } from './tailor';
import type { AiProvider, ChatJsonRequest, ModelInfo, ProviderError } from './types';

/** Text that is the schema validator talking, not a person. */
export const VALIDATOR_WORDS: readonly RegExp[] = [
  /Invalid input/,
  /Invalid (option|string|type|key|element|union)/,
  /Too (small|big)/,
  /Unrecognized key/,
  /expected \w+, received/,
  /\(root\)/,
  /^[\w.]+: /m,
  /\n/,
  /and \d+ more/,
];

const CV = 'Jane Doe. 8 years Python at Acme Ltd, 2016 – Present. Cut costs by 30%.';
const JOB = 'Senior Python Engineer, payments. Python, AWS, PostgreSQL, 5+ years.';

interface FakeProvider extends AiProvider {
  readonly requests: ChatJsonRequest[];
}

/** A provider that answers from a queue and refuses to be called past it. */
function fakeProvider(replies: Array<Result<string, ProviderError>>): FakeProvider {
  const requests: ChatJsonRequest[] = [];
  const queue = [...replies];
  return {
    id: 'ollama',
    requests,
    chatJson(request) {
      requests.push(request);
      const next = queue.shift();
      if (next === undefined) throw new Error('provider called more times than the test allows');
      return Promise.resolve(next);
    },
    listModels(): Promise<Result<ModelInfo[], ProviderError>> {
      return Promise.resolve(ok([]));
    },
  };
}

/** Run one feature and return the words the user would read, or null on success. */
type Feature = (provider: AiProvider) => Promise<string | null>;

const FEATURES: ReadonlyArray<readonly [string, Feature]> = [
  [
    'analysis',
    async (provider) => {
      const r = await analyzeCv({ provider, model: 'm', cvText: CV, jobText: JOB });
      return r.ok ? null : r.error.message;
    },
  ],
  [
    'tailor',
    async (provider) => {
      const r = await tailorCv({
        provider,
        model: 'm',
        cvText: CV,
        jobText: JOB,
        profileNotes: null,
      });
      return r.ok ? null : r.error.message;
    },
  ],
  [
    'review',
    async (provider) => {
      const r = await reviewDraft({
        provider,
        model: 'm',
        draftText: 'PROFESSIONAL SUMMARY\nEight years of Python.',
        jobText: JOB,
        cvText: CV,
        kind: 'cv',
      });
      return r.ok ? null : r.error.message;
    },
  ],
  [
    'cover letter',
    async (provider) => {
      const r = await writeCoverLetter({
        provider,
        model: 'm',
        cvText: CV,
        jobText: JOB,
        tailoredCvText: null,
        profileNotes: null,
      });
      return r.ok ? null : r.error.message;
    },
  ],
  [
    'interview',
    async (provider) => {
      const r = await prepareInterview({
        provider,
        model: 'm',
        jobTitle: 'Senior Python Engineer',
        company: 'Acme Ltd',
        advert: JOB,
        cvText: CV,
        coverLetter: null,
        profile: { headline: 'Python engineer', starExamples: [], careerGoals: [] },
      });
      return r.ok ? null : r.error.message;
    },
  ],
  [
    'follow-up',
    async (provider) => {
      const r = await draftFollowUp({
        provider,
        model: 'm',
        kind: 'follow_up',
        jobTitle: 'Senior Python Engineer',
        company: 'Acme Ltd',
        daysQuiet: 12,
        materials: { advert: JOB, cv: CV, coverLetter: null },
        writingStyle: null,
      });
      return r.ok ? null : r.error.message;
    },
  ],
  [
    'job extraction',
    async (provider) => {
      const r = await extractJob({ provider, model: 'm', text: JOB });
      return r.available ? null : r.reason;
    },
  ],
];

/**
 * Valid JSON, wrong shape, for every feature at once: each field any of the
 * seven schemas asks for is present with a type none of them accepts, so the
 * reply clears `extractJson` and fails the schema on several fields.
 */
const WRONG_SHAPE = JSON.stringify({
  match_score: { nested: true },
  verdict: { nested: true },
  summary: { nested: true },
  matched_skills: { nested: true },
  missing_skills: { nested: true },
  keyword_gaps: { nested: true },
  matched_keywords: { nested: true },
  suggestions: { nested: true },
  ats_notes: { nested: true },
  key_skills: { nested: true },
  experience: { nested: true },
  education: { nested: true },
  certifications: { nested: true },
  greeting: { nested: true },
  paragraphs: { nested: true },
  sign_off: { nested: true },
  issues: { nested: true },
  likely_questions: { nested: true },
  questions_to_ask: { nested: true },
  subject: { nested: true },
  body: { nested: true },
  title: { nested: true },
  company: { nested: true },
  location: { nested: true },
  salary_min: { nested: true },
  salary_max: { nested: true },
  description: { nested: true },
});

function expectASentence(text: string | null): void {
  expect(typeof text).toBe('string');
  const words = text ?? '';
  expect(words.trim().length).toBeGreaterThan(0);
  for (const pattern of VALIDATOR_WORDS) expect(words, String(pattern)).not.toMatch(pattern);
}

describe('a wrong-shaped answer twice gives the user a sentence, never the schema’s own words (L-350)', () => {
  it.each(FEATURES)('%s', async (_name, run) => {
    const provider = fakeProvider([ok(WRONG_SHAPE), ok(WRONG_SHAPE)]);
    const words = await run(provider);
    // Two calls exactly: the attempt and the one repair turn. The fake throws
    // on a third, so a success here would mean the reply was not wrong at all.
    expect(provider.requests).toHaveLength(2);
    expectASentence(words);
  });

  it.each(FEATURES)(
    'negative: %s still passes a provider’s own error through unchanged',
    async (_name, run) => {
      const rejected: ProviderError = {
        provider: 'ollama',
        kind: 'auth',
        message: 'The key was rejected. Check it in Settings and try again.',
      };
      const provider = fakeProvider([err(rejected)]);
      expect(await run(provider)).toBe(rejected.message);
    },
  );

  it('boundary: nine schema issues at once — the "…and N more" tail never reaches the user', async () => {
    // Three empty suggestions, each missing its three required strings: nine
    // issues, one more than the repair hint lists, so the hint grows a
    // "…and 1 more." line. That line is for the model.
    const nine = JSON.stringify({
      match_score: 50,
      summary: 'A fair match.',
      matched_skills: [],
      missing_skills: [],
      keyword_gaps: [],
      matched_keywords: [],
      ats_notes: [],
      suggestions: [{}, {}, {}],
    });
    const provider = fakeProvider([ok(nine), ok(nine)]);
    const result = await analyzeCv({ provider, model: 'm', cvText: CV, jobText: JOB });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('schema-invalid');
      expectASentence(result.error.message);
    }
    // The model WAS told — the repair turn quotes the tail. Proves the input
    // really crossed the cap, so the assertion above is not vacuous.
    expect(provider.requests[1]?.user).toContain('…and 1 more.');
  });
});
