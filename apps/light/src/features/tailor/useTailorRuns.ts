import { useCallback, useState } from 'react';

import { checkFabrication, checkLetterClaims, type ChatTransport } from '@cviper/ai-providers';
import { renderCoverLetter, renderTailoredCv, wordCount } from '@cviper/core-types';

import {
  isCloudKind,
  type ConsentPort,
  type ConsentProviderKind,
  type ConsentState,
} from '../analysis/consent';
import { type ProviderOption } from '../analysis/providers';

import { type JobSessions, type TailorResult } from './jobSessions';
import { stillApproved, type ApprovedMetric } from './metricPrompts';
import { runCoverLetter } from './runCoverLetter';
import { runReview } from './runReview';
import { runTailor } from './runTailor';
import { type PendingAction } from './tailorSteps';

function consentKindFor(kind: ProviderOption['kind']): ConsentProviderKind | null {
  return isCloudKind(kind) ? kind : null;
}

export interface TailorRunsInput {
  readonly sessions: JobSessions;
  readonly consentStore: ConsentPort;
  readonly consent: ConsentState;
  readonly setConsent: (next: ConsentState) => void;
  readonly createTransport: (() => ChatTransport) | undefined;
  readonly selectedOption: ProviderOption | null;
  readonly cvText: string;
  readonly jobText: string;
  readonly notes: string | null;
  /** The gaps the prompt carries, or `null` for none (L-202). */
  readonly keywordGaps: readonly string[] | null;
  readonly userMetrics: readonly ApprovedMetric[];
  readonly result: TailorResult | null;
  readonly setError: (message: string | null) => void;
  readonly setSaveMessage: (message: string | null) => void;
}

/**
 * The three AI runs — tailor, review, letter — and the one consent gate in
 * front of them (see "ONE CONSENT GATE, THREE DOORS" in `Tailor.tsx`).
 *
 * Each run files its answer under the job it was FOR, read from `sessions` at
 * the start, whatever is on screen by the time it arrives (L-199).
 */
export function useTailorRuns({
  sessions,
  consentStore,
  consent,
  setConsent,
  createTransport,
  selectedOption,
  cvText,
  jobText,
  notes,
  keywordGaps,
  userMetrics,
  result,
  setError,
  setSaveMessage,
}: TailorRunsInput) {
  const [pendingConsent, setPendingConsent] = useState<{
    readonly option: ProviderOption;
    readonly kind: ConsentProviderKind;
    readonly action: PendingAction;
  } | null>(null);

  /** The fresh consent check every run module gets — the store, not a snapshot. */
  const hasConsent = useCallback(
    (kind: ConsentProviderKind) => consentStore.read().then((read) => read.ok && read.value[kind]),
    [consentStore],
  );

  const performTailor = useCallback(
    async (option: ProviderOption) => {
      // The job this run is FOR. Its answer is filed there, whatever is on
      // screen by the time it arrives (L-199).
      const jobId = sessions.get().activeJobId;
      setError(null);
      setSaveMessage(null);
      sessions.patch(jobId, { phase: 'tailoring', error: null });

      const run = await runTailor(
        { option, cvText, jobText, profileNotes: notes, keywordGaps, userMetrics },
        createTransport,
        hasConsent,
      );

      if (!run.ok) {
        sessions.patch(jobId, { phase: 'idle', result: null, error: run.error.message });
        return;
      }

      const text = renderTailoredCv(run.value.cv, null);
      const tailored = {
        cv: run.value.cv,
        text,
        // Deterministic, on the original text, before anything is shown.
        // The figures the user typed and approved are theirs (L-205); the
        // employer, year and certification checks still use the CV alone.
        report: checkFabrication(
          cvText,
          run.value.cv,
          userMetrics.map((metric) => metric.text),
        ),
        provider: run.value.provider,
        model: run.value.model,
        retried: run.value.retried,
        userMetrics,
      };
      sessions.patch(jobId, { phase: 'idle', result: tailored, review: null, letter: null });
    },
    [
      createTransport,
      cvText,
      hasConsent,
      jobText,
      keywordGaps,
      notes,
      sessions,
      setError,
      setSaveMessage,
      userMetrics,
    ],
  );

  const performReview = useCallback(
    async (option: ProviderOption) => {
      if (result === null) return;
      const jobId = sessions.get().activeJobId;
      setError(null);
      sessions.patch(jobId, { phase: 'reviewing', error: null });

      const run = await runReview(
        {
          option,
          draftText: result.text,
          jobText,
          cvText,
          kind: 'cv',
          userMetrics: stillApproved(result.userMetrics, userMetrics),
        },
        createTransport,
        hasConsent,
      );

      if (!run.ok) {
        sessions.patch(jobId, { phase: 'idle', error: run.error.message });
        return;
      }
      sessions.patch(jobId, { phase: 'idle', review: run.value.review });
    },
    [createTransport, cvText, hasConsent, jobText, result, sessions, setError, userMetrics],
  );

  const performLetter = useCallback(
    async (option: ProviderOption) => {
      const jobId = sessions.get().activeJobId;
      setError(null);
      sessions.patch(jobId, { phase: 'writing', error: null });

      const run = await runCoverLetter(
        {
          option,
          cvText,
          jobText,
          tailoredCvText: result?.text ?? null,
          profileNotes: notes,
          userMetrics: stillApproved(result?.userMetrics ?? [], userMetrics),
        },
        createTransport,
        hasConsent,
      );

      if (!run.ok) {
        sessions.patch(jobId, { phase: 'idle', error: run.error.message });
        return;
      }

      const text = renderCoverLetter(run.value.letter);
      const written = {
        letter: run.value.letter,
        text,
        words: wordCount(text),
        claims: checkLetterClaims(
          cvText,
          run.value.letter,
          stillApproved(result?.userMetrics ?? [], userMetrics).map((metric) => metric.text),
        ),
      };
      sessions.patch(jobId, { phase: 'idle', letter: written });
    },
    [createTransport, cvText, hasConsent, jobText, notes, result, sessions, setError, userMetrics],
  );

  const perform = useCallback(
    async (action: PendingAction, option: ProviderOption) => {
      if (action === 'tailor') await performTailor(option);
      else if (action === 'review') await performReview(option);
      else await performLetter(option);
    },
    [performLetter, performReview, performTailor],
  );

  /** Ask first, if the option is a cloud one the user has not agreed to. */
  const gated = useCallback(
    async (action: PendingAction) => {
      if (selectedOption === null) return;
      const kind = consentKindFor(selectedOption.kind);
      if (kind !== null && !consent[kind]) {
        setPendingConsent({ option: selectedOption, kind, action });
        return;
      }
      await perform(action, selectedOption);
    },
    [consent, perform, selectedOption],
  );

  const onConsentAccept = useCallback(async () => {
    const pending = pendingConsent;
    setPendingConsent(null);
    if (pending === null) return;

    const granted = await consentStore.grant(pending.kind);
    if (!granted.ok) {
      setError(granted.error.message);
      return;
    }
    setConsent(granted.value);
    await perform(pending.action, pending.option);
  }, [consentStore, pendingConsent, perform, setConsent, setError]);

  const onConsentDecline = useCallback(() => setPendingConsent(null), []);

  const onWithdrawConsent = useCallback(
    async (kind: ConsentProviderKind) => {
      const revoked = await consentStore.revoke(kind);
      if (revoked.ok) setConsent(revoked.value);
      else setError(revoked.error.message);
    },
    [consentStore, setConsent, setError],
  );

  return { gated, pendingConsent, onConsentAccept, onConsentDecline, onWithdrawConsent };
}
