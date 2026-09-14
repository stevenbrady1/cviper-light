/**
 * Running one cover letter — the tailor view's door to a model for the letter
 * (L-161).
 *
 * Same shape and same gate as `runTailor.ts`: the factory is injected, the
 * consent check comes BEFORE `createTransport()`, the keyword option is
 * refused with a sentence, and `ollama` never reaches the gate at all. See
 * that file's header; the reasoning is not repeated here so it cannot drift.
 */
import { writeCoverLetter, type ChatTransport } from '@cviper/ai-providers';
import { err, ok, type CoverLetter, type Result } from '@cviper/core-types';

import { createTauriTransport } from '../../ai/transport';

import { isCloudKind, readStoredConsent, type ConsentProviderKind } from '../analysis/consent';
import { type ProviderOption } from '../analysis/providers';

import { KEYWORD_CANNOT_WRITE, OPTION_UNAVAILABLE, consentRefusal, providerFor } from './adapter';

export interface CoverLetterRequest {
  readonly option: ProviderOption;
  readonly cvText: string;
  readonly jobText: string;
  /** The tailored CV as rendered text, when one was written first. */
  readonly tailoredCvText: string | null;
  readonly profileNotes: string | null;
}

export interface CoverLetterRunSuccess {
  readonly letter: CoverLetter;
  readonly provider: string;
  readonly model: string;
  readonly retried: boolean;
}

export interface CoverLetterRunFailure {
  readonly message: string;
}

export async function runCoverLetter(
  request: CoverLetterRequest,
  createTransport: () => ChatTransport = createTauriTransport,
  hasConsent: (kind: ConsentProviderKind) => Promise<boolean> = readStoredConsent,
): Promise<Result<CoverLetterRunSuccess, CoverLetterRunFailure>> {
  const model = request.option.model;

  if (request.option.kind === 'keyword' || model === null) {
    return err({ message: KEYWORD_CANNOT_WRITE });
  }

  // ── The consent gate (Apple 5.1.2(i)) — before the factory is touched ────
  if (isCloudKind(request.option.kind)) {
    const consented = await hasConsent(request.option.kind);
    if (!consented) return err({ message: consentRefusal(request.option.kind) });
  }

  const provider = providerFor(request.option, createTransport());
  if (provider === null) return err({ message: OPTION_UNAVAILABLE });

  const written = await writeCoverLetter({
    provider,
    model,
    cvText: request.cvText,
    jobText: request.jobText,
    tailoredCvText: request.tailoredCvText,
    profileNotes: request.profileNotes,
  });

  if (!written.ok) return err({ message: written.error.message });

  return ok({
    letter: written.value.letter,
    provider: request.option.kind,
    model,
    retried: written.value.meta.retryCount > 0,
  });
}
