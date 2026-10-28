/**
 * How much of a CV each kind of AI is sent (L-302).
 *
 * ============================================================================
 * WHY TWO BUDGETS
 * ============================================================================
 * `MAX_CV_CHARS` (6,000) was chosen for a small LOCAL model: with the advert
 * and the instructions it fills about half of the 8,192-token window the
 * Ollama adapter asks for, leaving room for the answer. Every AI path used it,
 * so an AI company's model — which reads well over a hundred thousand tokens —
 * was sent the same first 6,000 characters, and nobody was told. On the tailor
 * path that is worse than a weaker score: the tailored CV is a full rewrite of
 * what the model saw, so roles and education past the cut were not in it.
 *
 * The owner chose (28 Oct 2026): send more only when the CV would be cut, and
 * tell the user when it still is.
 *
 *   - Local (Ollama), and an address the user typed — which may be a small
 *     model on their own machine with a context nobody knows — keep 6,000.
 *   - An AI company gets 16,000: a long, four-page CV. A CV under 6,000 is
 *     sent exactly as before, to every provider.
 *   - The tailor ANSWER budget rises to 8,192 tokens for an AI company, so a
 *     longer CV can come back whole. With the reasoning headroom that is held
 *     to `MAX_WIRE_OUTPUT_TOKENS` (16,384), the ceiling every default model
 *     already accepts.
 */
import { sanitizeForPrompt } from '@cviper/cv-parsing';

import { type ProviderId } from '../types';

import { MAX_CV_CHARS } from './build-prompt';

/** A local model's CV budget: its context window is the limit. */
export const LOCAL_MAX_CV_CHARS = MAX_CV_CHARS;

/** An AI company's CV budget. */
export const CLOUD_MAX_CV_CHARS = 16_000;

/** The tailor answer budget, in tokens, local and cloud. */
const LOCAL_TAILOR_ANSWER_TOKENS = 4096;
const CLOUD_TAILOR_ANSWER_TOKENS = 8192;

/** A model on this machine, or one whose size cannot be known. */
export function isLocalProvider(provider: ProviderId): boolean {
  return provider === 'ollama' || provider === 'custom';
}

/** How many characters of CV this provider is sent. */
export function cvCharBudget(provider: ProviderId): number {
  return isLocalProvider(provider) ? LOCAL_MAX_CV_CHARS : CLOUD_MAX_CV_CHARS;
}

/** How many tokens the tailored CV may take in this provider's answer. */
export function tailorAnswerTokens(provider: ProviderId): number {
  return isLocalProvider(provider) ? LOCAL_TAILOR_ANSWER_TOKENS : CLOUD_TAILOR_ANSWER_TOKENS;
}

/** A CV longer than its budget: how long it is, and how much is sent. */
export interface CvCut {
  readonly total: number;
  readonly kept: number;
}

/**
 * Whether this CV is longer than this provider is sent, measured on the text
 * that would be sent (cleaned first, exactly as the prompt builders clean it).
 * `null` when the whole CV goes.
 */
export function cvCutFor(cvText: string, provider: ProviderId): CvCut | null {
  const total = sanitizeForPrompt(cvText).length;
  const kept = cvCharBudget(provider);
  return total > kept ? { total, kept } : null;
}
