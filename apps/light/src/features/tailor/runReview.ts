/**
 * Running one review — the hiring-manager pass over a draft.
 *
 * Same shape and same gate as `runTailor.ts`. What leaves the machine on this
 * path is the draft, the advert AND the original CV — the reviewer needs the
 * original to spot an unsupported claim — so the consent question is exactly
 * the one the other two paths ask.
 */
import { reviewDraft, type ChatTransport, type ReviewKind } from '@cviper/ai-providers';
import { err, ok, type DraftReview, type Result } from '@cviper/core-types';

import { createTauriTransport } from '../../ai/transport';

import { isCloudKind, readStoredConsent, type ConsentProviderKind } from '../analysis/consent';
import { type ProviderOption } from '../analysis/providers';

import { KEYWORD_CANNOT_WRITE, OPTION_UNAVAILABLE, consentRefusal, providerFor } from './adapter';

export interface ReviewRequest {
  readonly option: ProviderOption;
  readonly draftText: string;
  readonly jobText: string;
  readonly cvText: string;
  readonly kind: ReviewKind;
}

export interface ReviewRunSuccess {
  readonly review: DraftReview;
  readonly provider: string;
  readonly model: string;
  readonly retried: boolean;
}

export interface ReviewRunFailure {
  readonly message: string;
}

export async function runReview(
  request: ReviewRequest,
  createTransport: () => ChatTransport = createTauriTransport,
  hasConsent: (kind: ConsentProviderKind) => Promise<boolean> = readStoredConsent,
): Promise<Result<ReviewRunSuccess, ReviewRunFailure>> {
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

  const reviewed = await reviewDraft({
    provider,
    model,
    draftText: request.draftText,
    jobText: request.jobText,
    cvText: request.cvText,
    kind: request.kind,
  });

  if (!reviewed.ok) return err({ message: reviewed.error.message });

  return ok({
    review: reviewed.value.review,
    provider: request.option.kind,
    model,
    retried: reviewed.value.meta.retryCount > 0,
  });
}
