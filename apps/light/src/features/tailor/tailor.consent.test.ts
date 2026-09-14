/**
 * The consent gate inside the three tailor run modules (Apple 5.1.2(i)): the
 * CV and the advert must never reach a cloud provider without the user's
 * explicit, per-provider, revocable agreement — and a local model must never
 * be asked at all.
 *
 * Mirrors `tracker/runExtraction.consent.test.ts`. The load-bearing assertion
 * is the TRANSPORT COUNT: every refusal here proves the factory was never
 * called, not merely that a sentence appeared, and one consented run per
 * module proves the counter would notice a call.
 */
import { describe, expect, it, vi } from 'vitest';

import { ok, type Result } from '@cviper/core-types';
import {
  type ChatTransport,
  type ProviderError,
  type ProviderHttpResponse,
} from '@cviper/ai-providers';

import { type ConsentProviderKind } from '../analysis/consent';
import { type ProviderOption } from '../analysis/providers';

const plugin = vi.hoisted(() => ({
  /** A consent file that cannot be opened — a lock, a corrupt file, a bad disk. */
  load: vi.fn(() => Promise.reject(new Error('The file could not be read or written.'))),
}));

vi.mock('@tauri-apps/plugin-store', () => ({ load: plugin.load }));

const { runTailor } = await import('./runTailor');
const { runCoverLetter } = await import('./runCoverLetter');
const { runReview } = await import('./runReview');

const CV = 'Jane Doe. 8 years Python at Acme Ltd, 2016 – Present. Cut costs by 30%.';
const JOB = 'Senior Python Engineer, payments. Python, AWS, PostgreSQL, 5+ years.';

const TAILORED = {
  summary: 'Eight years of Python at Acme Ltd.',
  key_skills: ['Python'],
  experience: [
    { title: 'Engineer', company: 'Acme Ltd', location: '', dates: '2016 – Present', bullets: [] },
  ],
  education: [],
  certifications: [],
};
const LETTER = {
  greeting: 'Dear Hiring Manager,',
  paragraphs: ['Eight years.'],
  sign_off: 'Yours,',
};
const REVIEW = { issues: [], verdict: 'ready' };

function option(overrides: Partial<ProviderOption> = {}): ProviderOption {
  return {
    key: 'openai',
    kind: 'openai',
    label: 'OpenAI · gpt-4o',
    note: '',
    model: 'gpt-4o',
    local: false,
    needsKey: true,
    ...overrides,
  };
}

const OLLAMA = option({
  key: 'ollama:llama3.2',
  kind: 'ollama',
  label: 'Ollama · llama3.2',
  model: 'llama3.2',
  local: true,
  needsKey: false,
});

const KEYWORD = option({
  key: 'keyword',
  kind: 'keyword',
  label: 'Basic match',
  model: null,
  local: true,
  needsKey: false,
});

function openaiBody(content: string): string {
  return JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] });
}

function ollamaBody(content: string): string {
  return JSON.stringify({ message: { content }, done_reason: 'stop' });
}

/** A transport factory that counts how many times it was asked to exist. */
function countingFactory(body: string): {
  readonly built: () => number;
  readonly factory: () => ChatTransport;
} {
  const state = { built: 0 };
  return {
    built: () => state.built,
    factory: () => {
      state.built += 1;
      return {
        chat(): Promise<Result<ProviderHttpResponse, ProviderError>> {
          return Promise.resolve(ok({ status: 200, body }));
        },
        listModels(): Promise<Result<ProviderHttpResponse, ProviderError>> {
          throw new Error('the tailor run modules must never list models');
        },
      };
    },
  };
}

const alwaysConsents = () => Promise.resolve(true);
const neverConsents = () => Promise.resolve(false);

/** The three modules, driven the same way, so every assertion runs three times. */
const MODULES = [
  {
    name: 'runTailor',
    run: (
      opt: ProviderOption,
      factory: () => ChatTransport,
      hasConsent?: (kind: ConsentProviderKind) => Promise<boolean>,
    ) =>
      runTailor({ option: opt, cvText: CV, jobText: JOB, profileNotes: null }, factory, hasConsent),
    reply: JSON.stringify(TAILORED),
  },
  {
    name: 'runCoverLetter',
    run: (
      opt: ProviderOption,
      factory: () => ChatTransport,
      hasConsent?: (kind: ConsentProviderKind) => Promise<boolean>,
    ) =>
      runCoverLetter(
        { option: opt, cvText: CV, jobText: JOB, tailoredCvText: null, profileNotes: null },
        factory,
        hasConsent,
      ),
    reply: JSON.stringify(LETTER),
  },
  {
    name: 'runReview',
    run: (
      opt: ProviderOption,
      factory: () => ChatTransport,
      hasConsent?: (kind: ConsentProviderKind) => Promise<boolean>,
    ) =>
      runReview(
        {
          option: opt,
          draftText: 'PROFESSIONAL SUMMARY\nEight years.',
          jobText: JOB,
          cvText: CV,
          kind: 'cv',
        },
        factory,
        hasConsent,
      ),
    reply: JSON.stringify(REVIEW),
  },
] as const;

describe.each(MODULES)('$name — the consent gate', ({ run, reply }) => {
  it('negative: refuses a cloud run with no consent, and never builds a transport', async () => {
    const transport = countingFactory(openaiBody(reply));

    const outcome = await run(option(), transport.factory, neverConsents);

    expect(transport.built()).toBe(0);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.message).toContain('OpenAI');
    expect(outcome.error.message.toLowerCase()).toContain('permission');
  });

  it('the counter would notice a call: a consented cloud run builds exactly one transport', async () => {
    const transport = countingFactory(openaiBody(reply));

    const outcome = await run(option(), transport.factory, alwaysConsents);

    expect(outcome.ok).toBe(true);
    expect(transport.built()).toBe(1);
  });

  it('boundary: consenting to Anthropic does not authorise OpenAI', async () => {
    const transport = countingFactory(openaiBody(reply));
    const onlyAnthropic = (kind: ConsentProviderKind) => Promise.resolve(kind === 'anthropic');

    const outcome = await run(option(), transport.factory, onlyAnthropic);

    expect(transport.built()).toBe(0);
    expect(outcome.ok).toBe(false);
  });

  it('the Ollama exemption: a local run never calls hasConsent at all', async () => {
    const transport = countingFactory(ollamaBody(reply));
    const hasConsent = vi.fn(neverConsents);

    const outcome = await run(OLLAMA, transport.factory, hasConsent);

    expect(hasConsent).not.toHaveBeenCalled();
    expect(outcome.ok).toBe(true);
    expect(transport.built()).toBe(1);
  });

  it('negative: the basic match is refused with a sentence, before consent or a transport', async () => {
    const transport = countingFactory(openaiBody(reply));
    const hasConsent = vi.fn(alwaysConsents);

    const outcome = await run(KEYWORD, transport.factory, hasConsent);

    expect(hasConsent).not.toHaveBeenCalled();
    expect(transport.built()).toBe(0);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.message).toContain('cannot write');
    for (const brand of ['OpenAI', 'Anthropic', 'Ollama']) {
      expect(outcome.error.message).not.toContain(brand);
    }
  });

  it('boundary: an unreadable consent store fails CLOSED through the real default check', async () => {
    const transport = countingFactory(openaiBody(reply));

    // No third argument: the app's own default, reading the real store through
    // a plugin that cannot open the file.
    const outcome = await run(option(), transport.factory);

    expect(plugin.load).toHaveBeenCalled();
    expect(transport.built()).toBe(0);
    expect(outcome.ok).toBe(false);
  });
});
