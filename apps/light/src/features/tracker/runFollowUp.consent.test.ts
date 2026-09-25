/**
 * The consent gate inside `runFollowUp` (Apple 5.1.2(i)): a CV, a cover letter
 * and an advert must never reach OpenAI or Anthropic without the user's
 * explicit, per-provider, revocable agreement — and Ollama must never be asked
 * at all.
 *
 * Mirrors `runExtraction.consent.test.ts`, for the same reasons that file
 * gives: the load-bearing assertion is the TRANSPORT COUNT, not the message —
 * a build that showed the message AND still called the model would pass a
 * message-only test — and the unreadable-store case uses the real default
 * check rather than an injected fake, because the default is the thing being
 * replaced everywhere else.
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

import { type FollowUpRequest } from './runFollowUp';

const plugin = vi.hoisted(() => ({
  /** A consent file that cannot be opened — a lock, a corrupt file, a bad disk. */
  load: vi.fn(() => Promise.reject(new Error('The file could not be read or written.'))),
}));

vi.mock('@tauri-apps/plugin-store', () => ({ load: plugin.load }));

const { runFollowUp } = await import('./runFollowUp');

const DRAFT = {
  subject: 'Following up on my application',
  body: 'Hello Dana,\n\nChecking in.\n\nKind regards,\nJane Doe',
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

function request(selected: ProviderOption): FollowUpRequest {
  return {
    option: selected,
    kind: 'follow_up',
    jobTitle: 'Credit Risk Analyst',
    company: 'Lloyds Banking Group',
    daysQuiet: 12,
    materials: {
      advert: 'Credit Risk Analyst. Apply to Dana Whitfield, dana.whitfield@example.com.',
      cv: 'Jane Doe. 8 years credit risk.',
      coverLetter: null,
    },
    writingStyle: null,
  };
}

function openaiBody(content: string): string {
  return JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] });
}

function ollamaBody(content: string): string {
  return JSON.stringify({ message: { content }, done_reason: 'stop' });
}

/** Counted at the FACTORY, not at `chat()` — see `runExtraction.consent.test.ts`. */
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
          throw new Error('runFollowUp must never list models');
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

describe('runFollowUp — the consent gate', () => {
  it('negative: refuses an OpenAI draft with no consent, and never builds a transport', async () => {
    const transport = countingFactory(openaiBody(JSON.stringify(DRAFT)));

    const outcome = await runFollowUp(request(option()), transport.factory, neverConsents);

    expect(transport.built()).toBe(0);
    expect(outcome.available).toBe(false);

    const reason = outcome.available ? '' : outcome.reason;
    expect(reason).toContain('OpenAI');
    expect(reason.toLowerCase()).toContain('permission');
    // Names the route that actually works: the panel asks itself (L-171).
    // Never a detour to another screen — a sentence pointing there is the
    // dead end L-171 closed, so this test now refuses it.
    expect(reason.toLowerCase()).toContain('press the draft button again');
    expect(reason).not.toContain('Analysis');
  });

  it('the counter would notice a call: a consented OpenAI draft runs and returns the draft', async () => {
    const transport = countingFactory(openaiBody(JSON.stringify(DRAFT)));

    const outcome = await runFollowUp(request(option()), transport.factory, alwaysConsents);

    expect(outcome.available).toBe(true);
    if (outcome.available) expect(outcome.draft).toEqual(DRAFT);
    expect(transport.built()).toBe(1);
  });

  it('boundary: consenting to Anthropic does not authorise OpenAI', async () => {
    const transport = countingFactory(openaiBody(JSON.stringify(DRAFT)));
    const onlyAnthropic = (kind: ConsentProviderKind) => Promise.resolve(kind === 'anthropic');

    const outcome = await runFollowUp(request(option()), transport.factory, onlyAnthropic);

    expect(transport.built()).toBe(0);
    expect(outcome.available).toBe(false);
  });

  it('the Ollama exemption: a local draft never calls hasConsent at all', async () => {
    const transport = countingFactory(ollamaBody(JSON.stringify(DRAFT)));
    const hasConsent = vi.fn(neverConsents);

    const outcome = await runFollowUp(request(OLLAMA_OPTION), transport.factory, hasConsent);

    expect(hasConsent).not.toHaveBeenCalled();
    expect(outcome.available).toBe(true);
    expect(transport.built()).toBe(1);
  });

  it('negative: the keyword option is refused with a sentence before any transport exists', async () => {
    const transport = countingFactory(ollamaBody(JSON.stringify(DRAFT)));
    const hasConsent = vi.fn(alwaysConsents);

    const outcome = await runFollowUp(request(KEYWORD_OPTION), transport.factory, hasConsent);

    expect(transport.built()).toBe(0);
    expect(hasConsent).not.toHaveBeenCalled();
    expect(outcome.available).toBe(false);
    if (!outcome.available) expect(outcome.reason).toContain('not available in this build');
  });

  it('negative: a provider failure comes back as a sentence, never a throw', async () => {
    const factory = (): ChatTransport => ({
      chat: () => Promise.resolve(ok({ status: 500, body: JSON.stringify({ error: 'boom' }) })),
      listModels: () => {
        throw new Error('unused');
      },
    });

    const outcome = await runFollowUp(request(OLLAMA_OPTION), factory, alwaysConsents);

    expect(outcome.available).toBe(false);
    if (!outcome.available) expect(outcome.reason.length).toBeGreaterThan(0);
  });

  it('boundary: an unreadable consent store fails CLOSED through the real default check', async () => {
    const transport = countingFactory(openaiBody(JSON.stringify(DRAFT)));

    // No third argument: the app's own default, reading the real store
    // through a plugin that cannot open the file.
    const outcome = await runFollowUp(request(option()), transport.factory);

    expect(plugin.load).toHaveBeenCalled();
    expect(transport.built()).toBe(0);
    expect(outcome.available).toBe(false);
    if (!outcome.available) expect(outcome.reason).toContain('OpenAI');
  });
});
