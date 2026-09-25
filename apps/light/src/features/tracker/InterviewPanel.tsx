import { useCallback, useEffect, useMemo, useState } from 'react';

import { type ChatTransport, type InterviewPromptInput } from '@cviper/ai-providers';
import {
  renderInterviewPack,
  type Document,
  type DocumentKind,
  type InterviewPack,
} from '@cviper/core-types';

import { SECONDARY_BUTTON } from '../../app/buttons';
import { todayIsoDate } from '../../lib/dates';

import { ConsentGate } from '../analysis/ConsentGate';
import {
  createTauriConsentPort,
  isCloudKind,
  type ConsentPort,
  type ConsentProviderKind,
} from '../analysis/consent';
import { optionByKey, type Availability, type ProviderOption } from '../analysis/providers';

import { extractionOptions, extractionProgressNote } from './extraction';
import { type TrackerEntry } from './model';
import { type TrackerPort } from './port';
import { runInterview } from './runInterview';

/**
 * Interview preparation, in the detail pane (L-163).
 *
 * ============================================================================
 * BUILT FROM WHAT IS ALREADY ARCHIVED. NOTHING IS FETCHED, NOTHING IS GUESSED.
 * ============================================================================
 * The materials are the documents kept against this application — the advert
 * as posted, the CV that was sent, the cover letter — and the profile's worked
 * examples. Two fallbacks, both the user's own data: the job's description
 * stands in for a missing advert, and the newest parsed CV on the machine
 * stands in for a CV that was never archived here. There is no web research
 * and no "company insight"; see `interview.ts` in core-types for what the
 * source feature had and why it was dropped.
 *
 * ============================================================================
 * NOTHING RUNS ON MOUNT EXCEPT TWO LOCAL READS.
 * ============================================================================
 * Opening a card reads the archived documents (to show the last saved pack)
 * and nothing else. No transport is built and no model is loaded until
 * "Prepare for this interview" is pressed — `InterviewPanel.test.tsx` counts
 * transports built and `tracker.zeroKeys.test.tsx` counts provider commands,
 * and both stay at zero through the whole board loop.
 *
 * ============================================================================
 * THE PANEL ASKS FOR CONSENT ITSELF (L-171)
 * ============================================================================
 * `runInterview` refuses a cloud run until the per-provider consent exists,
 * and this path carries the CV and the profile's worked examples as well as
 * the advert. Until L-171 the only place that consent could be GIVEN was the
 * Analysis screen — the dead end L-141 closed for paste-a-job. So this panel
 * raises the SAME `ConsentGate`, recorded in the SAME store, read at PRESS
 * time, and prepares the pack that was pending the moment the user says yes.
 * `runInterview` keeps its own gate underneath regardless.
 *
 * ============================================================================
 * THE PACK IS NOT SAVED UNTIL THE USER SAYS SO.
 * ============================================================================
 * A generated pack is on screen first, then "Save this pack" archives it as an
 * `interview_pack` document. A model's output written straight to the archive
 * would be a document the user never read sitting in their own evidence.
 */

/** How often the elapsed counter ticks while a model is thinking. */
const TICK_MS = 1000;

/** What to say when there is no AI on this machine at all. */
export const NO_AI_NOTE = 'Needs a local model or your own key.';

export interface InterviewPanelProps {
  readonly entry: TrackerEntry;
  readonly port: TrackerPort;
  /**
   * What this machine can offer. `undefined` while the board is still finding
   * out — the button is disabled without a reason for that moment, because
   * "needs a key" flashed at somebody who has one is a small lie.
   */
  readonly availability?: Availability | undefined;
  /** Injected by tests so a fake provider can answer without a socket. */
  readonly createTransport?: (() => ChatTransport) | undefined;
  /**
   * Injected by tests. Defaults to the real `tauri-plugin-store`-backed port —
   * the one store every consent screen in the app shares (L-171).
   */
  readonly consentPort?: ConsentPort | undefined;
  readonly now: Date;
}

/** The newest document of one kind, or `null`. `documents` is oldest first. */
function latestOfKind(documents: readonly Document[], kind: DocumentKind): Document | null {
  const matching = documents.filter((document) => document.kind === kind);
  return matching[matching.length - 1] ?? null;
}

/** A section heading, in the app's eyebrow style — as `AnalysisResult` draws it. */
function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="font-mono text-[11px] font-medium tracking-[0.14em] text-ink-faint uppercase">
      {children}
    </h4>
  );
}

/** A bulleted list, or a sentence saying the list is empty on purpose. */
function Points({ items, emptyText }: { items: readonly string[]; emptyText: string }) {
  if (items.length === 0) return <p className="mt-1.5 text-ink-faint">{emptyText}</p>;
  return (
    <ul className="mt-1.5 list-disc space-y-1 pl-5 text-ink">
      {items.map((item, index) => (
        <li key={`${index}-${item}`}>{item}</li>
      ))}
    </ul>
  );
}

export function InterviewPanel({
  entry,
  port,
  availability,
  createTransport,
  consentPort,
  now,
}: InterviewPanelProps) {
  const { application, job } = entry;
  const consentStore = useMemo(() => consentPort ?? createTauriConsentPort(), [consentPort]);

  const options = useMemo(
    () => (availability === undefined ? [] : extractionOptions(availability)),
    [availability],
  );
  const [optionKey, setOptionKey] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [pack, setPack] = useState<InterviewPack | null>(null);
  const [retried, setRetried] = useState(false);
  /** What the last attempt or save had to say, or `null`. One slot for both. */
  const [note, setNote] = useState<string | null>(null);
  const [saved, setSaved] = useState<Document | null>(null);
  const [saving, setSaving] = useState(false);
  /** The cloud run waiting on the user's answer in the dialog, or `null`. */
  const [pendingConsent, setPendingConsent] = useState<{
    readonly option: ProviderOption;
    readonly kind: ConsentProviderKind;
  } | null>(null);

  // Keep the chosen option inside the list. Local before cloud is the order
  // `providerOptions` already returns.
  useEffect(() => {
    setOptionKey((current) =>
      current !== null && optionByKey(options, current) !== null
        ? current
        : (options[0]?.key ?? null),
    );
  }, [options]);

  // The last saved pack, read once per card. A failure here is not worth a
  // banner — the panel still works — but it is not swallowed either: the
  // sentence goes in the same slot every other message uses.
  useEffect(() => {
    let cancelled = false;
    void port.documentsFor(application.id).then((documents) => {
      if (cancelled) return;
      if (documents.ok) setSaved(latestOfKind(documents.value, 'interview_pack'));
      else setNote(`Your saved packs could not be read: ${documents.error.message}`);
    });
    return () => {
      cancelled = true;
    };
  }, [application.id, port]);

  useEffect(() => {
    if (!running) return;
    setElapsed(0);
    const timer = window.setInterval(() => setElapsed((seconds) => seconds + 1), TICK_MS);
    return () => window.clearInterval(timer);
  }, [running]);

  const selected = optionKey === null ? null : optionByKey(options, optionKey);

  /**
   * The check `runInterview` makes underneath, reading the SAME port this
   * panel asks through. Fails closed, as everywhere.
   */
  const hasConsent = useCallback(
    (kind: ConsentProviderKind) => consentStore.read().then((read) => read.ok && read.value[kind]),
    [consentStore],
  );

  /** The run itself, once nothing stands in its way. */
  const perform = useCallback(
    async (option: ProviderOption) => {
      setRunning(true);
      setNote(null);

      // Every read is local SQLite through the port. Any one failing stops
      // the run with its own sentence: a pack rehearsed against half the
      // material, silently, is worse than no pack.
      const documents = await port.documentsFor(application.id);
      if (!documents.ok) {
        setRunning(false);
        setNote(`The archived documents could not be read: ${documents.error.message}`);
        return;
      }

      let cvText = latestOfKind(documents.value, 'cv')?.text ?? null;
      if (cvText === null) {
        const latest = await port.latestCvText();
        if (!latest.ok) {
          setRunning(false);
          setNote(`Your CV could not be read: ${latest.error.message}`);
          return;
        }
        cvText = latest.value;
      }

      const profile = await port.profile();
      if (!profile.ok) {
        setRunning(false);
        setNote(`Your profile could not be read: ${profile.error.message}`);
        return;
      }

      const input: InterviewPromptInput = {
        jobTitle: job.title,
        company: job.company,
        advert: latestOfKind(documents.value, 'advert')?.text ?? job.description,
        cvText,
        coverLetter: latestOfKind(documents.value, 'cover_letter')?.text ?? null,
        profile: {
          headline: profile.value?.headline ?? null,
          starExamples: profile.value?.star_examples ?? [],
          careerGoals: profile.value?.career_goals ?? [],
        },
      };

      const outcome = await runInterview({ option, input }, createTransport, hasConsent);
      setRunning(false);

      if (outcome.available) {
        setPack(outcome.pack);
        setRetried(outcome.meta.retryCount === 1);
      } else {
        setNote(outcome.reason);
      }
    },
    [application.id, createTransport, hasConsent, job.company, job.description, job.title, port],
  );

  const onPrepare = useCallback(
    async (option: ProviderOption) => {
      // The consent gate (Apple 5.1.2(i)), asked HERE (L-171). Read fresh
      // from the store on every press, never from a snapshot.
      if (isCloudKind(option.kind) && !(await hasConsent(option.kind))) {
        setPendingConsent({ option, kind: option.kind });
        return;
      }
      await perform(option);
    },
    [hasConsent, perform],
  );

  /**
   * The user said yes in the dialog: record it, then run what was waiting.
   * Recorded FIRST, so `runInterview`'s own gate agrees with the answer.
   */
  const onConsentAccept = useCallback(async () => {
    const pending = pendingConsent;
    setPendingConsent(null);
    if (pending === null) return;

    const granted = await consentStore.grant(pending.kind);
    if (!granted.ok) {
      // Said on screen and nothing sent: a consent that was not recorded is
      // a consent the app does not have.
      setNote(granted.error.message);
      return;
    }
    await perform(pending.option);
  }, [consentStore, pendingConsent, perform]);

  /** "Not now": nothing recorded, nothing run, the button live again. */
  const onConsentDecline = useCallback(() => setPendingConsent(null), []);

  const onSave = useCallback(async () => {
    if (pack === null) return;
    setSaving(true);
    setNote(null);

    const document: Document = {
      id: crypto.randomUUID(),
      application_id: application.id,
      kind: 'interview_pack',
      title: `Interview pack — ${todayIsoDate(now)}`,
      text: renderInterviewPack(pack),
      created_at: new Date().toISOString(),
    };

    const written = await port.saveDocument(document);
    setSaving(false);

    if (written.ok) {
      setSaved(document);
      setNote('Saved with this application.');
    } else {
      setNote(`The pack could not be saved: ${written.error.message} Try again.`);
    }
  }, [application.id, now, pack, port]);

  const nothingConfigured = availability !== undefined && options.length === 0;
  const busy = running || saving;

  return (
    <div data-testid="detail-interview" className="space-y-3 border-t border-line pt-3">
      <Eyebrow>Interview</Eyebrow>

      {/*
        The picker only appears when there is a choice to make, exactly as the
        paste form decides it: one installed model is not a decision.
      */}
      {options.length > 1 ? (
        <div>
          <label
            htmlFor="detail-interview-provider"
            className="block text-xs font-medium text-ink-muted"
          >
            Prepare with
          </label>
          <select
            id="detail-interview-provider"
            data-testid="detail-interview-provider"
            value={optionKey ?? ''}
            disabled={busy}
            onChange={(event) => {
              // Read the value NOW — React nulls `currentTarget` the moment
              // this handler returns.
              const key = event.currentTarget.value;
              setOptionKey(key);
            }}
            className="mt-1 w-full rounded-control border border-line bg-card px-2.5 py-1.5 text-ink"
          >
            {options.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      ) : selected === null ? null : (
        <p data-testid="detail-interview-provider-note" className="text-xs text-ink-faint">
          Prepared with {selected.label}.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {/*
          DISABLED rather than hidden when there is nothing to run it with — a
          control that comes and goes cannot be learnt — and the reason sits
          beside it, on screen, not in a tooltip.
        */}
        <button
          type="button"
          data-testid="detail-interview-prepare"
          disabled={busy || selected === null}
          onClick={() => {
            if (selected !== null) void onPrepare(selected);
          }}
          className={SECONDARY_BUTTON}
        >
          {running ? 'Preparing…' : 'Prepare for this interview'}
        </button>
        {nothingConfigured ? (
          <span data-testid="detail-interview-no-ai" className="text-xs text-ink-faint">
            {NO_AI_NOTE}
          </span>
        ) : null}
      </div>

      {running && selected !== null ? (
        <p
          data-testid="detail-interview-progress"
          role="status"
          className="rounded-control bg-sunken px-3 py-2 text-ink-muted"
        >
          {extractionProgressNote(selected)}{' '}
          <span className="font-mono tabular-nums">{elapsed}s</span>
        </p>
      ) : null}

      {note === null ? null : (
        <p
          data-testid="detail-interview-note"
          role="status"
          className="rounded-control bg-sunken px-3 py-2 text-ink-muted"
        >
          {note}
        </p>
      )}

      {pack === null ? null : (
        <div data-testid="detail-interview-pack" className="space-y-4">
          {retried ? (
            <p className="text-xs text-ink-faint">
              The model's first answer was unusable; this is its corrected second one.
            </p>
          ) : null}

          <section>
            <Eyebrow>Likely questions</Eyebrow>
            {pack.likely_questions.length === 0 ? (
              <p className="mt-1.5 text-ink-faint">The model suggested no questions.</p>
            ) : (
              <ol className="mt-1.5 space-y-3">
                {pack.likely_questions.map((item, index) => (
                  <li key={`${index}-${item.question}`}>
                    <p className="font-medium text-ink">{item.question}</p>
                    <p className="mt-0.5 text-ink-muted">{item.suggested_answer}</p>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section>
            <Eyebrow>Talking points</Eyebrow>
            <Points items={pack.talking_points} emptyText="None suggested." />
          </section>

          <section>
            <Eyebrow>Questions to ask</Eyebrow>
            <Points items={pack.questions_to_ask} emptyText="None suggested." />
          </section>

          <section>
            <Eyebrow>Gaps to bridge</Eyebrow>
            {pack.gaps_to_bridge.length === 0 ? (
              <p className="mt-1.5 text-ink-faint">
                Nothing the advert asks for is missing from your material.
              </p>
            ) : (
              <ul data-testid="detail-interview-gaps" className="mt-1.5 flex flex-wrap gap-1.5">
                {pack.gaps_to_bridge.map((gap, index) => (
                  <li
                    key={`${index}-${gap}`}
                    className="rounded-pill bg-gold/10 px-2 py-0.5 text-xs text-gold"
                  >
                    {gap}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div>
            <button
              type="button"
              data-testid="detail-interview-save"
              disabled={busy}
              onClick={() => void onSave()}
              className={SECONDARY_BUTTON}
            >
              {saving ? 'Saving…' : 'Save this pack'}
            </button>
            <span className="ml-2 text-xs text-ink-faint">Kept with this application.</span>
          </div>
        </div>
      )}

      {/*
        Collapsed by default — it is the pack from last time, there for the
        night before the interview, not something to read past on every open.
        A native <details>, so it needs no state and works with the keyboard.
      */}
      {saved === null ? null : (
        <details
          data-testid="detail-interview-saved"
          className="rounded-control bg-sunken px-3 py-2"
        >
          <summary className="cursor-pointer text-xs font-medium text-ink-muted">
            Last saved pack · {saved.title}
          </summary>
          <pre className="mt-2 font-sans text-sm whitespace-pre-wrap text-ink">{saved.text}</pre>
        </details>
      )}

      {/*
        The same dialog, from the same file, as every other consent screen
        (L-171). One consent, one store, one wording — see `ConsentGate.tsx`.
      */}
      {pendingConsent === null ? null : (
        <ConsentGate
          kind={pendingConsent.kind}
          onAccept={() => void onConsentAccept()}
          onDecline={onConsentDecline}
        />
      )}
    </div>
  );
}
