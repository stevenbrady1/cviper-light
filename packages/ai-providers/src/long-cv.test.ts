/**
 * L-302 — a long CV reaches an AI company whole, and a local model as before.
 *
 * The CV here puts its EDUCATION past character 9,000, where a real CV puts it.
 * Before L-302 every provider was sent the first 6,000 characters, so a tailored
 * CV from an AI company came back with no education at all.
 */
import { ok, type Result } from '@cviper/core-types';
import { describe, expect, it } from 'vitest';

import { analyzeCv } from './analyze';
import { writeCoverLetter } from './cover-letter';
import { reviewDraft } from './review';
import { tailorCv } from './tailor';
import type { AiProvider, ChatJsonRequest, ModelInfo, ProviderError, ProviderId } from './types';

/** Past every local cut, inside the cloud one. */
const LATE_SENTINEL = 'BSc Mathematics, University of Quillwort, 2012';

const ROLE =
  'Senior analyst at Acme Ltd, 2016 to now. Built the pricing model, ran the weekly ' +
  'risk report and trained three juniors in SQL and Python. ';
const LONG_CV = `${ROLE.repeat(Math.ceil(9_000 / ROLE.length))}\nEducation: ${LATE_SENTINEL}.`;
const JOB = 'Senior Python Engineer, payments. Python, AWS, PostgreSQL, 5+ years.';

const GOOD_CV = {
  summary: 'Analyst.',
  key_skills: ['Python'],
  experience: [{ title: 'Analyst', company: 'Acme Ltd', location: '', dates: '2016', bullets: [] }],
  education: [],
  certifications: [],
};
const GOOD_LETTER = { greeting: 'Dear Hiring Manager,', paragraphs: ['One.'], sign_off: 'Yours,' };
const GOOD_REVIEW = { issues: [], verdict: 'ready' };

function fakeProvider(
  id: ProviderId,
  reply: string,
): AiProvider & { readonly requests: ChatJsonRequest[] } {
  const requests: ChatJsonRequest[] = [];
  return {
    id,
    requests,
    chatJson(request): Promise<Result<string, ProviderError>> {
      requests.push(request);
      return Promise.resolve(ok(reply));
    },
    listModels(): Promise<Result<ModelInfo[], ProviderError>> {
      return Promise.resolve(ok([]));
    },
  };
}

describe('a long CV and an AI company (L-302)', () => {
  it('the CV check sends the end of the CV', async () => {
    const provider = fakeProvider('anthropic', '{}');
    await analyzeCv({ provider, model: 'm', cvText: LONG_CV, jobText: JOB });
    expect(provider.requests[0]?.user).toContain(LATE_SENTINEL);
  });

  it('tailoring sends the end of the CV, with room for it to come back', async () => {
    const provider = fakeProvider('openai', JSON.stringify(GOOD_CV));
    await tailorCv({ provider, model: 'm', cvText: LONG_CV, jobText: JOB, profileNotes: null });
    expect(provider.requests[0]?.user).toContain(LATE_SENTINEL);
    expect(provider.requests[0]?.maxOutputTokens).toBe(8192);
  });

  it('the cover letter and the review send the end of the CV', async () => {
    const letter = fakeProvider('google', JSON.stringify(GOOD_LETTER));
    await writeCoverLetter({
      provider: letter,
      model: 'm',
      cvText: LONG_CV,
      jobText: JOB,
      tailoredCvText: null,
      profileNotes: null,
    });
    expect(letter.requests[0]?.user).toContain(LATE_SENTINEL);

    const review = fakeProvider('mistral', JSON.stringify(GOOD_REVIEW));
    await reviewDraft({
      provider: review,
      model: 'm',
      draftText: LONG_CV,
      jobText: JOB,
      cvText: LONG_CV,
      kind: 'cv',
    });
    expect(review.requests[0]?.user).toContain(LATE_SENTINEL);
  });
});

describe('a long CV and a local model (L-302): unchanged', () => {
  // NEGATIVE — the local budget is the context window; it does not move.
  it.each(['ollama', 'custom'] as const)('%s is still sent the first 6,000 only', async (id) => {
    const analysis = fakeProvider(id, '{}');
    await analyzeCv({ provider: analysis, model: 'm', cvText: LONG_CV, jobText: JOB });
    expect(analysis.requests[0]?.user).not.toContain(LATE_SENTINEL);

    const tailor = fakeProvider(id, JSON.stringify(GOOD_CV));
    await tailorCv({
      provider: tailor,
      model: 'm',
      cvText: LONG_CV,
      jobText: JOB,
      profileNotes: null,
    });
    expect(tailor.requests[0]?.user).not.toContain(LATE_SENTINEL);
    expect(tailor.requests[0]?.maxOutputTokens).toBe(4096);
  });

  // BOUNDARY — a caller that sets its own answer budget keeps it.
  it('boundary: an explicit tailor budget is kept for an AI company too', async () => {
    const provider = fakeProvider('anthropic', JSON.stringify(GOOD_CV));
    await tailorCv({
      provider,
      model: 'm',
      cvText: LONG_CV,
      jobText: JOB,
      profileNotes: null,
      maxOutputTokens: 2000,
    });
    expect(provider.requests[0]?.maxOutputTokens).toBe(2000);
  });
});
