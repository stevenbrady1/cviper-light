/**
 * L-302 — how much of a CV each kind of AI is sent, and when it is cut.
 *
 * The 6,000-character budget was set by a small LOCAL model's context window.
 * An AI company's model reads far more, so it gets 16,000; a CV under the
 * budget is sent exactly as before.
 */
import { describe, expect, it } from 'vitest';

import { type ProviderId } from '../types';

import {
  CLOUD_MAX_CV_CHARS,
  LOCAL_MAX_CV_CHARS,
  cvCharBudget,
  cvCutFor,
  isLocalProvider,
  tailorAnswerTokens,
} from './budget';
import { DEFAULT_MAX_TAILOR_TOKENS } from '../tailor';

import { MAX_CV_CHARS } from './build-prompt';

const CLOUD: readonly ProviderId[] = [
  'anthropic',
  'openai',
  'google',
  'mistral',
  'grok',
  'openrouter',
];

describe('the CV budget per provider (L-302)', () => {
  it('a local model keeps the 6,000 its context window allows', () => {
    expect(LOCAL_MAX_CV_CHARS).toBe(MAX_CV_CHARS);
    expect(cvCharBudget('ollama')).toBe(6000);
  });

  it.each(CLOUD)('%s reads up to 16,000', (id) => {
    expect(CLOUD_MAX_CV_CHARS).toBe(16_000);
    expect(cvCharBudget(id)).toBe(16_000);
  });

  // NEGATIVE — an address the user typed can be a small model on their own
  // machine (LM Studio, llama.cpp). Its context is unknown, so it is treated
  // as local: a cut it did not need is safer than a prompt it cannot hold.
  it('negative: a custom address is treated as local', () => {
    expect(isLocalProvider('custom')).toBe(true);
    expect(cvCharBudget('custom')).toBe(6000);
  });

  it('the local tailor budget is the one tailor.ts documents', () => {
    expect(tailorAnswerTokens('ollama')).toBe(DEFAULT_MAX_TAILOR_TOKENS);
  });

  it('the tailor answer budget doubles for an AI company only', () => {
    expect(tailorAnswerTokens('ollama')).toBe(4096);
    expect(tailorAnswerTokens('custom')).toBe(4096);
    for (const id of CLOUD) expect(tailorAnswerTokens(id)).toBe(8192);
  });
});

describe('cvCutFor — is this CV longer than this AI is sent?', () => {
  // BOUNDARY — exactly the budget is not cut; one more character is.
  it('boundary: exactly 6,000 characters is not cut for a local model, 6,001 is', () => {
    expect(cvCutFor('a'.repeat(6000), 'ollama')).toBeNull();
    expect(cvCutFor('a'.repeat(6001), 'ollama')).toEqual({ total: 6001, kept: 6000 });
  });

  it('the same 6,001 characters are not cut for an AI company', () => {
    expect(cvCutFor('a'.repeat(6001), 'anthropic')).toBeNull();
    expect(cvCutFor('a'.repeat(16_001), 'anthropic')).toEqual({ total: 16_001, kept: 16_000 });
  });

  // It measures what would be SENT: invisible characters are removed before
  // the cut, so they cannot make a CV look longer than it is.
  it('measures the cleaned text, not the raw length', () => {
    const padded = `${'a'.repeat(6000)}${'​'.repeat(50)}`;
    expect(cvCutFor(padded, 'ollama')).toBeNull();
  });

  // BOUNDARY
  it.each(['', '   '])('an empty CV (%j) is never "cut"', (text) => {
    expect(cvCutFor(text, 'ollama')).toBeNull();
  });
});
