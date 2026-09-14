/**
 * Running one tailoring — the tailor view's door to a model for the CV.
 *
 * Shaped like `features/tracker/runExtraction.ts`, for the same two reasons:
 * the transport factory is INJECTED so a test can prove a path never built
 * one, and every message that reaches the user comes from the layer that knew
 * what went wrong.
 *
 * ============================================================================
 * A CLOUD RUN WITHOUT CONSENT NEVER BUILDS A TRANSPORT (Apple 5.1.2(i))
 * ============================================================================
 * What leaves the machine here is the whole CV and the whole advert. The gate
 * is the SAME `isCloudKind` / `hasConsent` pair the analysis and the tracker
 * use, from the same file, checked BEFORE `createTransport()` is ever called.
 * `tailor.consent.test.ts` counts transports built; the number is zero.
 *
 * `ollama` is structurally exempt: `ConsentProviderKind` excludes it, so there
 * is no branch here for a local model to fall into.
 */
import { tailorCv, type ChatTransport } from '@cviper/ai-providers';
import { err, ok, type Result, type TailoredCv } from '@cviper/core-types';

import { createTauriTransport } from '../../ai/transport';

import { isCloudKind, readStoredConsent, type ConsentProviderKind } from '../analysis/consent';
import { type ProviderOption } from '../analysis/providers';

import { KEYWORD_CANNOT_WRITE, OPTION_UNAVAILABLE, consentRefusal, providerFor } from './adapter';

export interface TailorRequest {
  readonly option: ProviderOption;
  readonly cvText: string;
  readonly jobText: string;
  readonly profileNotes: string | null;
}

export interface TailorRunSuccess {
  readonly cv: TailoredCv;
  /** `ollama`, `anthropic`, `openai` — what actually ran. */
  readonly provider: string;
  readonly model: string;
  /** True when the model's first answer was unusable and the repair turn saved it. */
  readonly retried: boolean;
}

export interface TailorRunFailure {
  /** Legible enough to put in front of a user with no further translation. */
  readonly message: string;
}

export async function runTailor(
  request: TailorRequest,
  createTransport: () => ChatTransport = createTauriTransport,
  hasConsent: (kind: ConsentProviderKind) => Promise<boolean> = readStoredConsent,
): Promise<Result<TailorRunSuccess, TailorRunFailure>> {
  const model = request.option.model;

  // Refused BEFORE the factory is touched, so "this path cannot reach the
  // network" is provable rather than intended.
  if (request.option.kind === 'keyword' || model === null) {
    return err({ message: KEYWORD_CANNOT_WRITE });
  }

  // ── The consent gate (Apple 5.1.2(i)) ────────────────────────────────────
  if (isCloudKind(request.option.kind)) {
    const consented = await hasConsent(request.option.kind);
    if (!consented) return err({ message: consentRefusal(request.option.kind) });
  }

  const provider = providerFor(request.option, createTransport());
  if (provider === null) return err({ message: OPTION_UNAVAILABLE });

  const tailored = await tailorCv({
    provider,
    model,
    cvText: request.cvText,
    jobText: request.jobText,
    profileNotes: request.profileNotes,
  });

  if (!tailored.ok) {
    // Passed through verbatim: every message that reaches here was written
    // for a user by the layer that knew what went wrong.
    return err({ message: tailored.error.message });
  }

  return ok({
    cv: tailored.value.cv,
    provider: request.option.kind,
    model,
    retried: tailored.value.meta.retryCount > 0,
  });
}
