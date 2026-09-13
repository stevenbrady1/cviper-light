/**
 * The consent gate inside `runExtraction` (Apple 5.1.2(i), effective 13 Nov
 * 2025): a pasted advert must never reach OpenAI or Anthropic without the
 * user's explicit, per-provider, revocable agreement — and Ollama must never be
 * asked at all.
 *
 * ============================================================================
 * WHY THIS FILE EXISTS SEPARATELY FROM `runAnalysis.consent.test.ts` (L-115)
 * ============================================================================
 * The analysis path was gated and proved; this one was not. `runExtraction`
 * built the SAME transport from the same factory with no consent check in the
 * file at all, so whatever was in the advert box — "the whole advert or
 * recruiter email", including a recruiter's name and address — could reach
 * OpenAI with nothing recorded and nothing disclosed.
 *
 * ============================================================================
 * THE LOAD-BEARING ASSERTION IS THE TRANSPORT COUNT, NOT THE MESSAGE
 * ============================================================================
 * Same reasoning as `urlOnlyPasteGuard.test.tsx`: "a friendly message appeared"
 * is easy to satisfy and proves almost nothing — a build that showed the
 * message AND still called the model would pass it. Every test here counts how
 * many times a chat transport was BUILT, and the claim is that the count stays
 * at zero. `the counter would notice a call` drives a consented run through the
 * same rig so a zero cannot be a broken counter.
 *
 * ============================================================================
 * THE UNREADABLE-STORE TEST USES THE REAL DEFAULT CHECK, NOT AN INJECTED FAKE
 * ============================================================================
 * `hasConsent` is injected everywhere else here so the gate can be forced both
 * ways. That cannot prove the DEFAULT fails closed, because the default is the
 * thing being replaced. So the boundary case mocks `@tauri-apps/plugin-store`
 * the way `consent.test.ts` does and calls `runExtraction` with no third
 * argument at all — the arrangement a user's machine actually runs.
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

const { runExtraction } = await import('./runExtraction');

const ADVERT = `Credit Risk Analyst
Lloyds Banking Group - City of London
£45,000 - £55,000 per annum. Apply to Dana Whitfield, dana.whitfield@example.com.`;

const REPLY = {
  title: 'Credit Risk Analyst',
  company: 'Lloyds Banking Group',
  location: 'City of London',
  url: null,
  description: 'Second-line credit risk.',
  posted_date: null,
  salary_currency: 'GBP',
  salary_min: 45000,
  salary_max: 55000,
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
 * never even prepared for, and a transport that got built and then went unused
 * would still mean the gate ran too late.
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
          throw new Error('runExtraction must never list models');
        },
      };
    },
  };
}

/** Always says yes — used where consent is not the thing under test. */
function alwaysConsents(): Promise<boolean> {
  return Promise.resolve(true);
}

/** Always says no — used to prove the negative path. */
function neverConsents(): Promise<boolean> {
  return Promise.resolve(false);
}

describe('runExtraction — the consent gate', () => {
  it('negative: refuses an OpenAI extraction with no consent, and never builds a transport', async () => {
    const transport = countingFactory(openaiBody(JSON.stringify(REPLY)));

    const outcome = await runExtraction(
      { option: option(), text: ADVERT },
      transport.factory,
      neverConsents,
    );

    // The strongest assertion: not "no request was seen" but "the code never
    // even got as far as being able to make one".
    expect(transport.built()).toBe(0);

    // The same fail-open shape every other refusal in this file uses: an
    // outcome the review form renders, never a throw.
    expect(outcome.available).toBe(false);
    expect(outcome.extraction.title).toBeNull();

    // `reason` is `string | null` on the outcome; a refusal that left it null
    // would be a blank explanation, so read it through a variable that would
    // fail these assertions rather than skip them.
    const reason = outcome.reason ?? '';
    expect(reason).toContain('OpenAI');
    expect(reason.toLowerCase()).toContain('permission');
    // Names the screen that can actually grant it today — the tracker has no
    // consent affordance of its own.
    expect(reason).toContain('Analysis');
  });

  it('the counter would notice a call: a consented OpenAI extraction runs exactly as before', async () => {
    const transport = countingFactory(openaiBody(JSON.stringify(REPLY)));

    const outcome = await runExtraction(
      { option: option(), text: ADVERT },
      transport.factory,
      alwaysConsents,
    );

    expect(outcome.available).toBe(true);
    expect(outcome.extraction.title).toBe('Credit Risk Analyst');
    expect(outcome.extraction.company).toBe('Lloyds Banking Group');
    expect(transport.built()).toBe(1);
  });

  it('boundary: consenting to Anthropic does not authorise OpenAI', async () => {
    const transport = countingFactory(openaiBody(JSON.stringify(REPLY)));
    const onlyAnthropic = (kind: ConsentProviderKind) => Promise.resolve(kind === 'anthropic');

    const outcome = await runExtraction(
      { option: option(), text: ADVERT },
      transport.factory,
      onlyAnthropic,
    );

    expect(transport.built()).toBe(0);
    expect(outcome.available).toBe(false);
  });

  it('the Ollama exemption: a local extraction never calls hasConsent at all', async () => {
    const transport = countingFactory(ollamaBody(JSON.stringify(REPLY)));
    const hasConsent = vi.fn(neverConsents);

    const outcome = await runExtraction(
      { option: OLLAMA_OPTION, text: ADVERT },
      transport.factory,
      hasConsent,
    );

    // Runs EVEN THOUGH `hasConsent` always refuses — because it is never
    // consulted for a local kind. 127.0.0.1 is outside 5.1.2(i).
    expect(hasConsent).not.toHaveBeenCalled();
    expect(outcome.available).toBe(true);
    expect(transport.built()).toBe(1);
  });

  it('boundary: an unreadable consent store fails CLOSED through the real default check', async () => {
    const transport = countingFactory(openaiBody(JSON.stringify(REPLY)));

    // No third argument: this is the app's own default, reading the real store
    // through a plugin that cannot open the file.
    const outcome = await runExtraction({ option: option(), text: ADVERT }, transport.factory);

    expect(plugin.load).toHaveBeenCalled();
    expect(transport.built()).toBe(0);
    expect(outcome.available).toBe(false);
    expect(outcome.reason).toContain('OpenAI');
  });
});
