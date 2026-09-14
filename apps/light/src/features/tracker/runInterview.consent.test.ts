/**
 * The consent gate inside `runInterview` (Apple 5.1.2(i)): the CV, the cover
 * letter, the profile's worked examples and the advert must never reach OpenAI
 * or Anthropic without the user's explicit, per-provider, revocable agreement
 * — and Ollama must never be asked at all.
 *
 * ============================================================================
 * THE LOAD-BEARING ASSERTION IS THE TRANSPORT COUNT, NOT THE MESSAGE
 * ============================================================================
 * Same reasoning as `runExtraction.consent.test.ts`: "a friendly message
 * appeared" proves almost nothing — a build that showed the message AND still
 * called the model would pass it. Every test here counts how many times a chat
 * transport was BUILT, and the claim is that the count stays at zero. `the
 * counter would notice a call` drives a consented run through the same rig so
 * a zero cannot be a broken counter.
 *
 * ============================================================================
 * THE UNREADABLE-STORE TEST USES THE REAL DEFAULT CHECK, NOT AN INJECTED FAKE
 * ============================================================================
 * `hasConsent` is injected everywhere else so the gate can be forced both
 * ways. That cannot prove the DEFAULT fails closed, because the default is the
 * thing being replaced. So the boundary case mocks `@tauri-apps/plugin-store`
 * the way `consent.test.ts` does and calls `runInterview` with no third
 * argument at all — the arrangement a user's machine actually runs.
 */
import { describe, expect, it, vi } from 'vitest';

import { ok, type Result } from '@cviper/core-types';
import {
  type ChatTransport,
  type InterviewPromptInput,
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

const { runInterview } = await import('./runInterview');

const INPUT: InterviewPromptInput = {
  jobTitle: 'Credit Risk Analyst',
  company: 'Lloyds Banking Group',
  advert: 'Second-line credit risk. SQL, Python, IFRS 9 models.',
  cvText: 'Jane Doe. 6 years credit risk at a challenger bank.',
  coverLetter: null,
  profile: { headline: 'Credit risk analyst', starExamples: [], careerGoals: [] },
};

const REPLY = {
  likely_questions: [{ question: 'Why credit risk?', suggested_answer: 'Six years of it…' }],
  talking_points: ['Six years at a challenger bank'],
  questions_to_ask: ['How are IFRS 9 models owned?'],
  gaps_to_bridge: [],
};

function option(overrides: Partial<ProviderOption> = {}): ProviderOption {
  return {
    key: 'openai:gpt-5-mini',
    kind: 'openai',
    label: 'OpenAI · gpt-5-mini',
    note: 'The advert is sent to OpenAI.',
    model: 'gpt-5-mini',
    local: false,
    needsKey: true,
    ...overrides,
  };
}

const OLLAMA_OPTION = option({
  key: 'ollama:llama3.2',
  kind: 'ollama',
  label: 'Ollama · llama3.2',
  note: '',
  model: 'llama3.2:latest',
  local: true,
  needsKey: false,
});

const KEYWORD_OPTION = option({
  key: 'keyword',
  kind: 'keyword',
  label: 'Basic match — no key needed',
  note: '',
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

/**
 * A transport factory that counts how many times it was asked to exist.
 *
 * Counted at the FACTORY, not at `chat()`: the promise is that the model is
 * never even prepared for.
 */
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
          throw new Error('runInterview must never list models');
        },
      };
    },
  };
}

function alwaysConsents(): Promise<boolean> {
  return Promise.resolve(true);
}

function neverConsents(): Promise<boolean> {
  return Promise.resolve(false);
}

describe('runInterview — the consent gate', () => {
  it('negative: refuses an OpenAI preparation with no consent, and never builds a transport', async () => {
    const transport = countingFactory(openaiBody(JSON.stringify(REPLY)));

    const outcome = await runInterview(
      { option: option(), input: INPUT },
      transport.factory,
      neverConsents,
    );

    expect(transport.built()).toBe(0);
    expect(outcome.available).toBe(false);
    if (!outcome.available) {
      expect(outcome.reason).toContain('OpenAI');
      expect(outcome.reason.toLowerCase()).toContain('permission');
      // Says what is being sent — this path carries the CV, not just the advert.
      expect(outcome.reason.toLowerCase()).toContain('your cv');
      // And the route that can grant it today, precondition included.
      expect(outcome.reason).toContain('Analysis');
      expect(outcome.reason.toLowerCase()).toContain('choose a cv');
    }
  });

  it('the counter would notice a call: a consented OpenAI preparation runs', async () => {
    const transport = countingFactory(openaiBody(JSON.stringify(REPLY)));

    const outcome = await runInterview(
      { option: option(), input: INPUT },
      transport.factory,
      alwaysConsents,
    );

    expect(outcome.available).toBe(true);
    if (outcome.available) {
      expect(outcome.pack.likely_questions[0]?.question).toBe('Why credit risk?');
      expect(outcome.meta.retryCount).toBe(0);
    }
    expect(transport.built()).toBe(1);
  });

  it('boundary: consenting to Anthropic does not authorise OpenAI', async () => {
    const transport = countingFactory(openaiBody(JSON.stringify(REPLY)));
    const onlyAnthropic = (kind: ConsentProviderKind) => Promise.resolve(kind === 'anthropic');

    const outcome = await runInterview(
      { option: option(), input: INPUT },
      transport.factory,
      onlyAnthropic,
    );

    expect(transport.built()).toBe(0);
    expect(outcome.available).toBe(false);
  });

  it('the Ollama exemption: a local preparation never calls hasConsent at all', async () => {
    const transport = countingFactory(ollamaBody(JSON.stringify(REPLY)));
    const hasConsent = vi.fn(neverConsents);

    const outcome = await runInterview(
      { option: OLLAMA_OPTION, input: INPUT },
      transport.factory,
      hasConsent,
    );

    expect(hasConsent).not.toHaveBeenCalled();
    expect(outcome.available).toBe(true);
    expect(transport.built()).toBe(1);
  });

  it('negative: the keyword option is refused before consent or a transport is considered', async () => {
    const transport = countingFactory(openaiBody(JSON.stringify(REPLY)));
    const hasConsent = vi.fn(alwaysConsents);

    const outcome = await runInterview(
      { option: KEYWORD_OPTION, input: INPUT },
      transport.factory,
      hasConsent,
    );

    expect(hasConsent).not.toHaveBeenCalled();
    expect(transport.built()).toBe(0);
    expect(outcome.available).toBe(false);
    if (!outcome.available) expect(outcome.reason).toContain('not available in this build');
  });

  it('boundary: an unreadable consent store fails CLOSED through the real default check', async () => {
    const transport = countingFactory(openaiBody(JSON.stringify(REPLY)));

    // No third argument: this is the app's own default, reading the real store
    // through a plugin that cannot open the file.
    const outcome = await runInterview({ option: option(), input: INPUT }, transport.factory);

    expect(plugin.load).toHaveBeenCalled();
    expect(transport.built()).toBe(0);
    expect(outcome.available).toBe(false);
    if (!outcome.available) expect(outcome.reason).toContain('OpenAI');
  });

  it('negative: a provider failure is a sentence, never a throw', async () => {
    const failing = (): ChatTransport => ({
      chat: () =>
        Promise.resolve(
          ok({ status: 500, body: JSON.stringify({ error: { message: 'upstream down' } }) }),
        ),
      listModels: () => {
        throw new Error('runInterview must never list models');
      },
    });

    const outcome = await runInterview({ option: option(), input: INPUT }, failing, alwaysConsents);

    expect(outcome.available).toBe(false);
    if (!outcome.available) expect(outcome.reason.length).toBeGreaterThan(0);
  });
});
