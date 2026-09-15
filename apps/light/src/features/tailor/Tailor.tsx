import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  checkFabrication,
  checkLetterClaims,
  type ChatTransport,
  type FabricationFlag,
  type FabricationReport,
} from '@cviper/ai-providers';
import {
  renderCoverLetter,
  renderTailoredCv,
  wordCount,
  type Application,
  type CoverLetter,
  type Cv,
  type DraftReview,
  type Job,
  type Profile,
  type TailoredCv,
} from '@cviper/core-types';

import { PRIMARY_BUTTON, SECONDARY_BUTTON } from '../../app/buttons';
import { ViewHeader } from '../../app/ViewHeader';
import { viewById } from '../../app/views';
import { createTauriFilePort, type FilePort } from '../../platform/files';

import { readAvailability } from '../analysis/availability';
import { ConsentGate, ConsentStatus } from '../analysis/ConsentGate';
import {
  createTauriConsentPort,
  isCloudKind,
  NO_CONSENT,
  type ConsentPort,
  type ConsentProviderKind,
  type ConsentState,
} from '../analysis/consent';
import { jobAdvertText, providerLabel } from '../analysis/model';
import {
  ollamaHint,
  optionByKey,
  providerOptions,
  type ProviderOption,
} from '../analysis/providers';

import { lineDiff } from './diff';
import { buildCoverLetterDocx, buildCvDocx } from './docx';
import {
  LETTER_WORD_LIMIT,
  documentTitle,
  exportFileName,
  newDocument,
  profileNotes,
  runDisabledReason,
  tailorOptions,
} from './model';
import { createDbTailorPort, type TailorPort } from './port';
import { runCoverLetter } from './runCoverLetter';
import { runReview } from './runReview';
import { runTailor } from './runTailor';

/**
 * The tailor view (L-160, L-161): pick a CV, pick or paste the advert, choose
 * a model, and get the CV rewritten for that one advert — then have it
 * reviewed, draft the letter, and save both.
 *
 * ============================================================================
 * THE FABRICATION REPORT IS THE FIRST THING IN THE RESULT, AND IT IS NEVER RED
 * ============================================================================
 * `checkFabrication` runs on every result, deterministically, before the user
 * reads a word of the CV, and its report is rendered ABOVE the CV. Teal when
 * clean; gold — something to act on — when not, with every invented employer,
 * year, certification and metric named. Never red: a flag is not a failure of
 * the app, it is the app doing its job, and red is reserved for things that
 * broke.
 *
 * ============================================================================
 * NO KEYWORD FALLBACK. THE BUTTON SAYS WHY.
 * ============================================================================
 * Every other screen works with nothing configured. This one cannot — there
 * is no word-list way to write a paragraph — so on a machine with no local
 * model and no key the run button is disabled, and the reason next to it says
 * what is needed and where to set it up. `tailor.zeroKeys.test.tsx` proves
 * that no transport is built on such a machine.
 *
 * ============================================================================
 * ONE CONSENT GATE, THREE DOORS
 * ============================================================================
 * The tailoring, the review and the letter each send the CV to the chosen
 * option. A cloud option asks once — the same `ConsentGate` the analysis
 * screen uses, recorded in the same store — and whichever action was pending
 * runs when the user says yes. Each run module holds its own gate too, so a
 * refusal cannot depend on this screen remembering to ask.
 */

/** How often the elapsed counter ticks while a model is thinking. */
const TICK_MS = 1000;

/** Which of the three model calls is in flight, if any. */
type Phase = 'idle' | 'tailoring' | 'reviewing' | 'writing';

/** What the gate is waiting to run, once the user has answered. */
type PendingAction = 'tailor' | 'review' | 'letter';

interface TailorResult {
  readonly cv: TailoredCv;
  /** `renderTailoredCv` of `cv`, computed once. */
  readonly text: string;
  readonly report: FabricationReport;
  readonly provider: string;
  readonly model: string;
  readonly retried: boolean;
}

interface LetterResult {
  readonly letter: CoverLetter;
  readonly text: string;
  readonly words: number;
  readonly claims: readonly FabricationFlag[];
}

export interface TailorProps {
  /** Injected by tests. Defaults to the real SQLite-backed port. */
  readonly port?: TailorPort | undefined;
  /** Injected by tests. Defaults to the OS dialog plus the Rust file commands. */
  readonly filePort?: FilePort | undefined;
  /**
   * Injected by tests so a fake provider can answer without a socket. Left
   * undefined in the app, and passed down undefined: each run module
   * defaults to the real Tauri transport itself, AFTER its consent check.
   * This screen never imports the factory, so it is not a call site
   * `lib/ai-call-sites-consent.contract.test.ts` has to order.
   */
  readonly createTransport?: (() => ChatTransport) | undefined;
  /** Injected by tests. Defaults to the real `tauri-plugin-store`-backed port. */
  readonly consentPort?: ConsentPort | undefined;
  /** Injected by tests so stored timestamps are deterministic. */
  readonly now?: Date | undefined;
}

function consentKindFor(kind: ProviderOption['kind']): ConsentProviderKind | null {
  return isCloudKind(kind) ? kind : null;
}

const FLAG_LABELS: Readonly<Record<FabricationFlag['kind'], string>> = {
  employer: 'Employer not in your CV',
  date: 'Year not in your CV',
  certification: 'Certification not in your CV',
  metric: 'Figure not in your CV',
};

export function Tailor({ port, filePort, createTransport, consentPort, now }: TailorProps = {}) {
  const tailorPort = useMemo(() => port ?? createDbTailorPort(), [port]);
  const files = useMemo(() => filePort ?? createTauriFilePort(), [filePort]);
  const consentStore = useMemo(() => consentPort ?? createTauriConsentPort(), [consentPort]);

  const [cvs, setCvs] = useState<readonly Cv[]>([]);
  const [cvsLoaded, setCvsLoaded] = useState(false);
  const [jobs, setJobs] = useState<readonly Job[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [selectedCvId, setSelectedCvId] = useState<string | null>(null);
  const [jobText, setJobText] = useState('');
  /** The tracked job the advert came from, or `null` for a paste. */
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [applications, setApplications] = useState<readonly Application[]>([]);
  const [selectedApplicationId, setSelectedApplicationId] = useState<string | null>(null);

  const [options, setOptions] = useState<readonly ProviderOption[]>([]);
  const [optionKey, setOptionKey] = useState<string>('');
  const [availabilityRead, setAvailabilityRead] = useState(false);
  const [localModelHint, setLocalModelHint] = useState<string | null>(null);

  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<TailorResult | null>(null);
  const [review, setReview] = useState<DraftReview | null>(null);
  const [letter, setLetter] = useState<LetterResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [consent, setConsent] = useState<ConsentState>(NO_CONSENT);
  const [pendingConsent, setPendingConsent] = useState<{
    readonly option: ProviderOption;
    readonly kind: ConsentProviderKind;
    readonly action: PendingAction;
  } | null>(null);

  // ── Loading ──────────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    void consentStore
      .read()
      .then((read) => {
        // A failed read leaves `consent` at `NO_CONSENT` — fail closed.
        if (!cancelled && read.ok) setConsent(read.value);
      })
      .catch(() => {
        // `consentStore.read()` never throws; a mount effect must still not
        // let anything escape uncaught.
      });

    return () => {
      cancelled = true;
    };
  }, [consentStore]);

  useEffect(() => {
    let cancelled = false;

    void tailorPort.loadCvs().then((loaded) => {
      if (cancelled) return;
      setCvsLoaded(true);
      if (!loaded.ok) {
        setError(`${loaded.error.message} Your data is still on this machine.`);
        return;
      }
      setCvs(loaded.value);
      setSelectedCvId((current) => current ?? loaded.value[0]?.id ?? null);
    });

    void tailorPort.loadJobs().then((loaded) => {
      // Not surfaced: the tracked-job shortcut is a convenience.
      if (!cancelled && loaded.ok) setJobs(loaded.value);
    });

    void tailorPort.profile().then((loaded) => {
      // Not surfaced either: no profile means no notes, which is fine.
      if (!cancelled && loaded.ok) setProfile(loaded.value);
    });

    return () => {
      cancelled = true;
    };
  }, [tailorPort]);

  useEffect(() => {
    let cancelled = false;

    void readAvailability().then((availability) => {
      if (cancelled) return;
      const offered = tailorOptions(providerOptions(availability));
      setOptions(offered);
      setOptionKey(offered[0]?.key ?? '');
      setLocalModelHint(ollamaHint(availability));
      setAvailabilityRead(true);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (selectedJobId === null) {
      setApplications([]);
      setSelectedApplicationId(null);
      return;
    }

    let cancelled = false;
    void tailorPort.loadApplicationsFor(selectedJobId).then((loaded) => {
      if (cancelled || !loaded.ok) return;
      setApplications(loaded.value);
      setSelectedApplicationId(loaded.value[0]?.id ?? null);
    });

    return () => {
      cancelled = true;
    };
  }, [tailorPort, selectedJobId]);

  const selectedOption = optionByKey(options, optionKey);
  const running = phase !== 'idle';

  useEffect(() => {
    if (!running) return;

    setElapsed(0);
    const timer = window.setInterval(() => setElapsed((seconds) => seconds + 1), TICK_MS);
    return () => window.clearInterval(timer);
  }, [running]);

  // ── Actions ──────────────────────────────────────────────────────────────

  const selectedCv = cvs.find((cv) => cv.id === selectedCvId) ?? null;
  const selectedJob = jobs.find((job) => job.id === selectedJobId) ?? null;
  const cvText = selectedCv?.extracted_text ?? '';
  const notes = profileNotes(profile);
  const jobTitle = selectedJob?.title ?? '';

  /** The fresh consent check every run module gets — the store, not a snapshot. */
  const hasConsent = useCallback(
    (kind: ConsentProviderKind) => consentStore.read().then((read) => read.ok && read.value[kind]),
    [consentStore],
  );

  const performTailor = useCallback(
    async (option: ProviderOption) => {
      setError(null);
      setSaveMessage(null);
      setPhase('tailoring');

      const run = await runTailor(
        { option, cvText, jobText, profileNotes: notes },
        createTransport,
        hasConsent,
      );

      setPhase('idle');

      if (!run.ok) {
        setResult(null);
        setError(run.error.message);
        return;
      }

      const text = renderTailoredCv(run.value.cv, null);
      setResult({
        cv: run.value.cv,
        text,
        // Deterministic, on the original text, before anything is shown.
        report: checkFabrication(cvText, run.value.cv),
        provider: run.value.provider,
        model: run.value.model,
        retried: run.value.retried,
      });
      setReview(null);
      setLetter(null);
    },
    [createTransport, cvText, hasConsent, jobText, notes],
  );

  const performReview = useCallback(
    async (option: ProviderOption) => {
      if (result === null) return;
      setError(null);
      setPhase('reviewing');

      const run = await runReview(
        { option, draftText: result.text, jobText, cvText, kind: 'cv' },
        createTransport,
        hasConsent,
      );

      setPhase('idle');

      if (!run.ok) {
        setError(run.error.message);
        return;
      }
      setReview(run.value.review);
    },
    [createTransport, cvText, hasConsent, jobText, result],
  );

  const performLetter = useCallback(
    async (option: ProviderOption) => {
      setError(null);
      setPhase('writing');

      const run = await runCoverLetter(
        {
          option,
          cvText,
          jobText,
          tailoredCvText: result?.text ?? null,
          profileNotes: notes,
        },
        createTransport,
        hasConsent,
      );

      setPhase('idle');

      if (!run.ok) {
        setError(run.error.message);
        return;
      }

      const text = renderCoverLetter(run.value.letter);
      setLetter({
        letter: run.value.letter,
        text,
        words: wordCount(text),
        claims: checkLetterClaims(cvText, run.value.letter),
      });
    },
    [createTransport, cvText, hasConsent, jobText, notes, result],
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
  }, [consentStore, pendingConsent, perform]);

  const onConsentDecline = useCallback(() => setPendingConsent(null), []);

  const onWithdrawConsent = useCallback(
    async (kind: ConsentProviderKind) => {
      const revoked = await consentStore.revoke(kind);
      if (revoked.ok) setConsent(revoked.value);
      else setError(revoked.error.message);
    },
    [consentStore],
  );

  const onSaveToApplication = useCallback(async () => {
    if (result === null || selectedApplicationId === null) return;
    setError(null);
    setSaveMessage(null);
    setSaving(true);

    const stamp = (now ?? new Date()).toISOString();
    const saved = await tailorPort.saveDocument(
      newDocument({
        id: crypto.randomUUID(),
        applicationId: selectedApplicationId,
        kind: 'cv',
        title: documentTitle('cv', jobTitle),
        text: result.text,
        now: stamp,
      }),
    );
    if (!saved.ok) {
      setSaving(false);
      setError(`The tailored CV could not be saved: ${saved.error.message}`);
      return;
    }

    let count = 1;
    if (letter !== null) {
      const savedLetter = await tailorPort.saveDocument(
        newDocument({
          id: crypto.randomUUID(),
          applicationId: selectedApplicationId,
          kind: 'cover_letter',
          title: documentTitle('cover_letter', jobTitle),
          text: letter.text,
          now: stamp,
        }),
      );
      if (!savedLetter.ok) {
        setSaving(false);
        setError(`The CV was saved, but the letter was not: ${savedLetter.error.message}`);
        return;
      }
      count = 2;
    }

    setSaving(false);
    setSaveMessage(
      count === 1
        ? 'Saved the tailored CV to the application.'
        : 'Saved the tailored CV and the cover letter to the application.',
    );
  }, [jobTitle, letter, now, result, selectedApplicationId, tailorPort]);

  const onSaveText = useCallback(
    async (kind: 'cv' | 'cover_letter') => {
      const text = kind === 'cv' ? result?.text : letter?.text;
      if (text === undefined) return;
      setError(null);
      setSaveMessage(null);
      setSaving(true);

      const saved = await files.saveText(text, exportFileName(kind, jobTitle), 'txt');
      setSaving(false);

      if (!saved.ok) {
        setError(`That could not be saved: ${saved.error.message}`);
        return;
      }
      // Cancelled. Nothing was written, and nothing is said about it.
      if (saved.value === null) return;
      setSaveMessage(`Saved to ${saved.value}.`);
    },
    [files, jobTitle, letter, result],
  );

  // The Word export (L-165): the same structured result the text render
  // reads, built into a `.docx` on this machine and handed to the same
  // dialog-in-Rust save. Success and cancel are worded exactly as the text
  // path's, so the two buttons side by side behave as one feature.
  const onSaveDocx = useCallback(
    async (kind: 'cv' | 'cover_letter') => {
      // `null` for the name: the app never asks the model for one, and this
      // screen has nothing else to offer (see `renderTailoredCv`).
      const build =
        kind === 'cv'
          ? result === null
            ? null
            : () => buildCvDocx(result.cv, null)
          : letter === null
            ? null
            : () => buildCoverLetterDocx(letter.letter);
      if (build === null) return;
      setError(null);
      setSaveMessage(null);
      setSaving(true);

      let bytes: Uint8Array;
      try {
        bytes = await build();
      } catch {
        // The builder runs over our own validated result, so this is our bug;
        // it still ends in a sentence on screen rather than a stuck spinner.
        setSaving(false);
        setError('That document could not be built. Try running the tailoring again.');
        return;
      }

      const saved = await files.saveBytes(bytes, exportFileName(kind, jobTitle, 'docx'), 'docx');
      setSaving(false);

      if (!saved.ok) {
        setError(`That could not be saved: ${saved.error.message}`);
        return;
      }
      if (saved.value === null) return;
      setSaveMessage(`Saved to ${saved.value}.`);
    },
    [files, jobTitle, letter, result],
  );

  // ── Rendering ────────────────────────────────────────────────────────────

  const aiAvailable = options.length > 0;
  const disabledReason = runDisabledReason({
    cv: selectedCv,
    jobText,
    option: selectedOption,
    // Until the read lands, nothing is known — and "needs a model" a second
    // before the model appears is a wrong answer, not a cautious one.
    aiAvailable: aiAvailable || !availabilityRead,
    running,
  });
  const view = viewById('tailor');

  const progressText =
    selectedOption === null
      ? ''
      : selectedOption.local
        ? `Asking ${selectedOption.model} on this machine. The first run after starting ` +
          'your PC loads the model into memory, which takes 5 to 30 seconds. Nothing is ' +
          'being sent anywhere.'
        : `Sending your CV and the advert to ${providerLabel(selectedOption.kind)}. ` +
          'This usually takes a few seconds.';

  const grantedConsents = (['anthropic', 'openai'] as const).filter((kind) => consent[kind]);

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="view-tailor">
      <ViewHeader title={view.label} summary={view.summary} />

      {error === null ? null : (
        <p
          role="alert"
          data-testid="tailor-error"
          className="border-b border-danger/30 bg-danger/5 px-4 py-2 text-danger md:px-6"
        >
          {error}
        </p>
      )}

      <div className="min-h-0 min-w-0 flex-1 space-y-5 overflow-y-auto px-4 py-4 md:px-6 md:py-5">
        {/* ── 1. The CV ───────────────────────────────────────────────── */}
        <div>
          <label htmlFor="tailor-cv-pick" className="block text-xs font-medium text-ink-muted">
            Your CV
          </label>
          <select
            id="tailor-cv-pick"
            data-testid="tailor-cv-pick"
            value={selectedCvId ?? ''}
            disabled={cvs.length === 0 || !cvsLoaded}
            onChange={(event) => {
              const id = event.currentTarget.value;
              setSelectedCvId(id === '' ? null : id);
              setResult(null);
              setReview(null);
              setLetter(null);
              setSaveMessage(null);
            }}
            className="mt-1 w-full rounded-control border border-line bg-card px-2.5 py-1.5 text-ink"
          >
            {cvs.length > 0 ? null : (
              <option value="">{cvsLoaded ? 'No CV uploaded yet' : 'Reading your CVs…'}</option>
            )}
            {cvs.map((cv) => (
              <option key={cv.id} value={cv.id}>
                {cv.name}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-ink-faint">
            The CVs you have uploaded on the Analysis screen. The rewrite uses only what is written
            in the one you choose.
          </p>
        </div>

        {/* ── 2. The advert ───────────────────────────────────────────── */}
        <div>
          <label htmlFor="tailor-job-text" className="block text-xs font-medium text-ink-muted">
            The job advert
          </label>
          <textarea
            id="tailor-job-text"
            data-testid="tailor-job-text"
            rows={7}
            value={jobText}
            placeholder="Paste the whole advert, including the requirements list."
            onChange={(event) => {
              setJobText(event.currentTarget.value);
              // Edited by hand: it is no longer that tracked job's advert, so
              // there is no application to save into.
              setSelectedJobId(null);
            }}
            className="mt-1 w-full rounded-control border border-line bg-card px-2.5 py-1.5 text-ink"
          />

          {jobs.length === 0 ? null : (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <label htmlFor="tailor-job-pick" className="text-xs text-ink-faint">
                Or use one you are already tracking
              </label>
              <select
                id="tailor-job-pick"
                data-testid="tailor-job-pick"
                value={selectedJobId ?? ''}
                onChange={(event) => {
                  const job = jobs.find((candidate) => candidate.id === event.currentTarget.value);
                  if (job === undefined) return;
                  setJobText(jobAdvertText(job));
                  setSelectedJobId(job.id);
                }}
                className="min-w-0 flex-1 rounded-control border border-line bg-card px-2.5 py-1 text-ink"
              >
                <option value="">Choose a tracked job…</option>
                {jobs.map((job) => (
                  <option key={job.id} value={job.id}>
                    {job.title} — {job.company}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* ── 3. How to run it ────────────────────────────────────────── */}
        <div>
          <label htmlFor="tailor-provider" className="block text-xs font-medium text-ink-muted">
            How to write it
          </label>
          <select
            id="tailor-provider"
            data-testid="tailor-provider"
            value={optionKey}
            disabled={!aiAvailable}
            onChange={(event) => setOptionKey(event.currentTarget.value)}
            className="mt-1 w-full rounded-control border border-line bg-card px-2.5 py-1.5 text-ink"
          >
            {aiAvailable ? null : (
              <option value="">
                {availabilityRead ? 'No local model or key set up' : 'Checking what is set up…'}
              </option>
            )}
            {options.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
          <p data-testid="tailor-provider-note" className="mt-1 text-xs text-ink-faint">
            {selectedOption?.note ??
              'Writing needs a model. A local one keeps your CV on this PC; your own key sends it to the provider you chose.'}
          </p>

          {localModelHint === null ? null : (
            <p
              data-testid="tailor-ollama-hint"
              className="mt-2 rounded-control bg-gold/10 px-3 py-2 text-xs text-gold"
            >
              {localModelHint}
            </p>
          )}

          <ConsentStatus
            granted={grantedConsents}
            onWithdraw={(kind) => void onWithdrawConsent(kind)}
          />
        </div>

        {/* ── 4. Run ──────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            data-testid="tailor-run"
            data-primary="true"
            disabled={disabledReason !== null}
            onClick={() => void gated('tailor')}
            className={PRIMARY_BUTTON}
          >
            {phase === 'tailoring' ? 'Tailoring…' : 'Tailor CV'}
          </button>

          {disabledReason === null ? null : (
            <p data-testid="tailor-run-reason" className="text-ink-muted">
              {disabledReason}
            </p>
          )}
        </div>

        {running && selectedOption !== null ? (
          <p
            data-testid="tailor-progress"
            role="status"
            className="rounded-control bg-sunken px-3 py-2 text-ink-muted"
          >
            {phase === 'reviewing'
              ? 'Reading the draft as a hiring manager would. '
              : phase === 'writing'
                ? 'Drafting the letter. '
                : ''}
            {progressText} <span className="font-mono tabular-nums">{elapsed}s</span>
          </p>
        ) : null}

        {saveMessage === null ? null : (
          <p
            role="status"
            data-testid="tailor-save-message"
            className="rounded-control bg-teal/10 px-3 py-2 break-all text-teal"
          >
            {saveMessage}
          </p>
        )}

        {/* ── 5. The result ───────────────────────────────────────────── */}
        {result === null ? (
          <div
            data-testid="tailor-empty"
            className="rounded-card border border-line border-dashed bg-card px-6 py-8 text-center"
          >
            <p className="font-medium text-ink">Nothing tailored yet.</p>
            <p className="mt-1 text-ink-muted">
              Pick a CV and an advert, then press the button. Every employer, date, figure and
              certification in the result is checked against your original CV before you see it.
            </p>
          </div>
        ) : (
          <div data-testid="tailor-result" className="space-y-4">
            {/* The fabrication report — FIRST, and never red. */}
            <div
              data-testid="tailor-fabrication"
              data-clean={result.report.clean ? 'true' : 'false'}
              className={
                result.report.clean
                  ? 'rounded-control bg-teal/10 px-3 py-2 text-teal'
                  : 'rounded-control bg-gold/10 px-3 py-2 text-gold'
              }
            >
              {result.report.clean ? (
                <p>
                  Checked: every employer, year, certification and figure in this draft is in your
                  original CV.
                </p>
              ) : (
                <>
                  <p className="font-medium">
                    Check these before you use it — the model wrote things your CV does not say:
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {result.report.flagged.map((flag) => (
                      <li key={`${flag.kind}:${flag.text}`}>
                        <span className="text-xs uppercase">{FLAG_LABELS[flag.kind]}</span>
                        {': '}
                        <span className="font-medium">{flag.text}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>

            <p data-testid="tailor-provenance" className="text-xs text-ink-faint">
              Written by {providerLabel(result.provider)} · {result.model}
              {result.retried ? ' · recovered on retry' : ''}
            </p>

            <pre
              data-testid="tailor-cv"
              className="rounded-card border border-line bg-card px-4 py-3 font-sans text-ink whitespace-pre-wrap"
            >
              {result.text}
            </pre>

            <details className="rounded-card border border-line bg-card px-4 py-3">
              <summary className="cursor-pointer font-medium text-ink">
                What changed against your original
              </summary>
              <ol data-testid="tailor-diff" className="mt-2 space-y-0.5 font-mono text-xs">
                {lineDiff(cvText, result.text).map((line, index) => (
                  <li
                    key={`${index}:${line.kind}`}
                    data-diff={line.kind}
                    className={
                      line.kind === 'added'
                        ? 'bg-teal/10 text-ink'
                        : line.kind === 'removed'
                          ? 'bg-danger/10 text-ink-muted line-through'
                          : 'text-ink-muted'
                    }
                  >
                    {line.text}
                  </li>
                ))}
              </ol>
            </details>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-testid="tailor-review-run"
                disabled={running || saving}
                onClick={() => void gated('review')}
                className={SECONDARY_BUTTON}
              >
                {phase === 'reviewing' ? 'Reviewing…' : 'Review the draft'}
              </button>
              <button
                type="button"
                data-testid="tailor-letter-run"
                disabled={running || saving}
                onClick={() => void gated('letter')}
                className={SECONDARY_BUTTON}
              >
                {phase === 'writing' ? 'Writing…' : 'Write the cover letter'}
              </button>
              <button
                type="button"
                data-testid="tailor-save-text"
                disabled={running || saving}
                onClick={() => void onSaveText('cv')}
                className={SECONDARY_BUTTON}
              >
                Save CV as text…
              </button>
              <button
                type="button"
                data-testid="tailor-save-docx-cv"
                disabled={running || saving}
                onClick={() => void onSaveDocx('cv')}
                className={SECONDARY_BUTTON}
              >
                Save CV as Word…
              </button>
            </div>

            {review === null ? null : (
              <div
                data-testid="tailor-review"
                data-verdict={review.verdict}
                className="rounded-card border border-line bg-card px-4 py-3"
              >
                <p className="font-medium text-ink">
                  {review.verdict === 'ready'
                    ? 'A hiring manager would call this ready.'
                    : 'A hiring manager would send this back.'}
                </p>
                {review.issues.length === 0 ? (
                  <p className="mt-1 text-ink-muted">Nothing serious to fix.</p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {review.issues.map((issue, index) => (
                      <li key={`${index}:${issue.section}`} data-testid="tailor-review-issue">
                        <span className="font-medium text-ink">{issue.section}</span>
                        <span className="block text-ink-muted">{issue.problem}</span>
                        <span className="block text-ink">{issue.suggestion}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {letter === null ? null : (
              <div className="space-y-2">
                {letter.claims.length === 0 ? null : (
                  <div
                    data-testid="tailor-letter-claims"
                    className="rounded-control bg-gold/10 px-3 py-2 text-gold"
                  >
                    <p className="font-medium">
                      Check these figures — they are not in your original CV:
                    </p>
                    <ul className="mt-1">
                      {letter.claims.map((flag) => (
                        <li key={flag.text} className="font-medium">
                          {flag.text}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <pre
                  data-testid="tailor-letter"
                  className="rounded-card border border-line bg-card px-4 py-3 font-sans text-ink whitespace-pre-wrap"
                >
                  {letter.text}
                </pre>
                <p data-testid="tailor-letter-words" className="text-xs text-ink-faint">
                  <span className="font-mono tabular-nums">{letter.words}</span> words
                </p>
                {letter.words > LETTER_WORD_LIMIT ? (
                  <p
                    data-testid="tailor-letter-long"
                    className="rounded-control bg-gold/10 px-3 py-2 text-gold"
                  >
                    Over {LETTER_WORD_LIMIT} words. A letter this long is a second page most readers
                    skip — cut a paragraph.
                  </p>
                ) : null}
                <button
                  type="button"
                  data-testid="tailor-save-letter-text"
                  disabled={running || saving}
                  onClick={() => void onSaveText('cover_letter')}
                  className={SECONDARY_BUTTON}
                >
                  Save letter as text…
                </button>
                <button
                  type="button"
                  data-testid="tailor-save-docx-letter"
                  disabled={running || saving}
                  onClick={() => void onSaveDocx('cover_letter')}
                  className={SECONDARY_BUTTON}
                >
                  Save letter as Word…
                </button>
              </div>
            )}

            {/* ── Save to an application ─────────────────────────────── */}
            <div className="flex flex-wrap items-center gap-2">
              {applications.length === 0 ? null : (
                <select
                  data-testid="tailor-application"
                  aria-label="Application to save into"
                  value={selectedApplicationId ?? ''}
                  onChange={(event) => setSelectedApplicationId(event.currentTarget.value || null)}
                  className="min-w-0 rounded-control border border-line bg-card px-2.5 py-1 text-ink"
                >
                  {applications.map((application) => (
                    <option key={application.id} value={application.id}>
                      {application.status}
                      {application.applied_date === null
                        ? ''
                        : ` · applied ${application.applied_date}`}
                    </option>
                  ))}
                </select>
              )}
              <button
                type="button"
                data-testid="tailor-save-application"
                disabled={running || saving || selectedApplicationId === null}
                onClick={() => void onSaveToApplication()}
                className={SECONDARY_BUTTON}
              >
                {saving ? 'Saving…' : 'Save to an application'}
              </button>
              {selectedApplicationId !== null ? null : (
                <p data-testid="tailor-save-application-reason" className="text-xs text-ink-muted">
                  {selectedJobId === null
                    ? 'Choose a tracked job above to save into one of its applications.'
                    : 'That job has no application yet. Add one on the Tracker first.'}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {pendingConsent === null ? null : (
        <ConsentGate
          kind={pendingConsent.kind}
          onAccept={() => void onConsentAccept()}
          onDecline={onConsentDecline}
        />
      )}
    </section>
  );
}
