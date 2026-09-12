/**
 * The consent gate inside `runAnalysis` (Apple 5.1.2(i), effective 13 Nov
 * 2025): a CV must never reach OpenAI or Anthropic without the user's
 * explicit, per-provider, revocable agreement — and Ollama must never be
 * asked at all.
 *
 * ============================================================================
 * THE LOAD-BEARING TEST HERE IS `never builds a transport without consent`.
 * ============================================================================
 * Same reasoning as the keyword-path test in `runAnalysis.test.ts`: `hasConsent`
 * and `createTransport` are both injected so the strongest thing this file can
 * assert is not "consent was checked" but "the code could not have reached the
 * network without it" — the transport factory is never even called.
 *
 * ============================================================================
 * THE GUARD AT THE BOTTOM IS PROVED, NOT ASSUMED
 * ============================================================================
 * `the consent gate cannot be bypassed` reads the shipped source of
 * `runAnalysis.ts` and asserts the consent check appears BEFORE the transport
 * can be built. It is deliberately broken and restored as part of delivering
 * this file — see the PR description for the RED output.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { ok, type Result } from '@cviper/core-types';
import {
  type ChatTransport,
  type ProviderError,
  type ProviderHttpResponse,
} from '@cviper/ai-providers';

import { runAnalysis } from './runAnalysis';
import { providerOptions, type ProviderOption } from './providers';
import { type ConsentProviderKind } from './consent';

const HERE = dirname(fileURLToPath(import.meta.url));

const CV =
  'Credit risk analyst, eight years in London banking. SQL, Python, Basel III, ' +
  'stress testing, IFRS 9 impairment models, stakeholder reporting.';

const ADVERT =
  'Credit Risk Analyst. You will build SQL models, run stress tests and report ' +
  'on IFRS 9 impairment to the CRO. Python experience essential.';

const AVAILABLE = providerOptions({
  ollamaRunning: true,
  ollamaModels: [{ id: 'llama3.2:3b', label: 'llama3.2:3b' }],
  anthropicKey: true,
  openaiKey: true,
});

function optionOf(kind: 'keyword' | 'ollama' | 'anthropic' | 'openai'): ProviderOption {
  const option = AVAILABLE.find((candidate) => candidate.kind === kind);
  if (option === undefined) throw new Error(`no ${kind} option in the fixture`);
  return option;
}

/** A `CvAnalysis` a provider might actually return, as a JSON string. */
function modelReply(): string {
  return JSON.stringify({
    matched_skills: ['sql', 'python'],
    missing_skills: ['sas'],
    matched_keywords: ['risk'],
    keyword_gaps: ['impairment'],
    ats_notes: ['Use a single column layout.'],
    suggestions: [
      { section: 'Skills', issue: 'No SAS.', recommendation: 'Add it.', priority: 'high' },
    ],
    summary: 'A close fit on the modelling side.',
    match_score: 78,
    verdict: 'weak',
  });
}

function openaiEnvelope(content: string): ProviderHttpResponse {
  return {
    status: 200,
    body: JSON.stringify({ choices: [{ message: { content } }] }),
  };
}

/** An Ollama `/api/chat` envelope wrapping one assistant message. */
function ollamaEnvelope(content: string): ProviderHttpResponse {
  return { status: 200, body: JSON.stringify({ message: { role: 'assistant', content } }) };
}

function fakeTransport(chat: (body: string) => Result<ProviderHttpResponse, ProviderError>): ChatTransport {
  return {
    chat: (_provider, body) => Promise.resolve(chat(body)),
    listModels: () => Promise.resolve(ok({ status: 200, body: '{"data":[]}' })),
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

describe('runAnalysis — the consent gate', () => {
  it('happy: proceeds to the provider once consent for THAT provider is granted', async () => {
    const createTransport = vi.fn(() => fakeTransport(() => ok(openaiEnvelope(modelReply()))));

    const run = await runAnalysis(
      { option: optionOf('openai'), cvText: CV, jobText: ADVERT },
      createTransport,
      alwaysConsents,
    );

    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.value.provider).toBe('openai');
    expect(createTransport).toHaveBeenCalledTimes(1);
  });

  it('negative: refuses an OpenAI run with no consent, and never builds a transport', async () => {
    const createTransport = vi.fn();

    const run = await runAnalysis(
      { option: optionOf('openai'), cvText: CV, jobText: ADVERT },
      createTransport,
      neverConsents,
    );

    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.error.message).toContain('OpenAI');
    expect(run.error.message.toLowerCase()).toContain('permission');
    // The strongest assertion: not "no request was seen" but "the code never
    // even got as far as being able to make one".
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('negative: refuses an Anthropic run with no consent, and never builds a transport', async () => {
    const createTransport = vi.fn();

    const run = await runAnalysis(
      { option: optionOf('anthropic'), cvText: CV, jobText: ADVERT },
      createTransport,
      neverConsents,
    );

    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.error.message).toContain('Anthropic');
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('boundary: consenting to Anthropic does not authorise OpenAI', async () => {
    const createTransport = vi.fn();
    // A `hasConsent` that only ever says yes to Anthropic — exactly what the
    // real store returns once the user has granted one provider and not the
    // other.
    const onlyAnthropic = (kind: ConsentProviderKind) => Promise.resolve(kind === 'anthropic');

    const run = await runAnalysis(
      { option: optionOf('openai'), cvText: CV, jobText: ADVERT },
      createTransport,
      onlyAnthropic,
    );

    expect(run.ok).toBe(false);
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('boundary: consenting to OpenAI does not authorise Anthropic', async () => {
    const createTransport = vi.fn();
    const onlyOpenai = (kind: ConsentProviderKind) => Promise.resolve(kind === 'openai');

    const run = await runAnalysis(
      { option: optionOf('anthropic'), cvText: CV, jobText: ADVERT },
      createTransport,
      onlyOpenai,
    );

    expect(run.ok).toBe(false);
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('the Ollama exemption: a local run never calls hasConsent at all', async () => {
    const hasConsent = vi.fn(neverConsents);
    const createTransport = vi.fn(() => fakeTransport(() => ok(ollamaEnvelope(modelReply()))));

    const run = await runAnalysis(
      { option: optionOf('ollama'), cvText: CV, jobText: ADVERT },
      createTransport,
      hasConsent,
    );

    // Runs successfully EVEN THOUGH `hasConsent` always refuses — because it
    // is never consulted for a local kind. 127.0.0.1 is outside 5.1.2(i).
    expect(run.ok).toBe(true);
    expect(hasConsent).not.toHaveBeenCalled();
    expect(createTransport).toHaveBeenCalledTimes(1);
  });

  it('the keyword path never calls hasConsent either', async () => {
    const hasConsent = vi.fn(neverConsents);

    const run = await runAnalysis(
      { option: optionOf('keyword'), cvText: CV, jobText: ADVERT },
      vi.fn(),
      hasConsent,
    );

    expect(run.ok).toBe(true);
    expect(hasConsent).not.toHaveBeenCalled();
  });
});

describe('the consent gate cannot be bypassed', () => {
  /** Drop `//` and `/* *\/` comments so a rule about code cannot be tripped by prose. */
  function withoutComments(source: string): string {
    return source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map((line) => {
        const index = line.indexOf('//');
        return index === -1 ? line : line.slice(0, index);
      })
      .join('\n');
  }

  it('guard: the consent check is reached before the transport can ever be built', () => {
    // Reads the SHIPPED file, not a copy — a future refactor that reorders
    // this fails here, not in a code review nobody remembers to do.
    const source = withoutComments(
      readFileSync(join(HERE, 'runAnalysis.ts'), 'utf8'),
    );

    const consentCheckIndex = source.indexOf('hasConsent(');
    const transportBuildIndex = source.indexOf('createTransport()');

    // Anti-inert: prove the haystack is the real file and the guard can
    // actually fail, rather than passing on two absent substrings.
    expect(consentCheckIndex).toBeGreaterThan(-1);
    expect(transportBuildIndex).toBeGreaterThan(-1);

    expect(consentCheckIndex).toBeLessThan(transportBuildIndex);
  });
});
