import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import {
  checkFabrication,
  checkLetterClaims,
  type ChatTransport,
  type FabricationFlag,
  promptKeywordGaps,
} from '@cviper/ai-providers';
import {
  renderCoverLetter,
  renderTailoredCv,
  wordCount,
  type Application,
  type Cv,
  type Job,
  type Profile,
} from '@cviper/core-types';

import { PRIMARY_BUTTON, QUIET_BUTTON, SECONDARY_BUTTON } from '../../app/buttons';
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
import { gapsForTailor, type TailorHandoff } from '../flow/handoff';
import { JobStepBar } from '../flow/JobStepBar';
import {
  NO_SAVED_PROGRESS,
  createDbJobProgressPort,
  type JobProgressPort,
  type SavedProgress,
} from '../flow/progress';
import { type StepId } from '../flow/steps';

import { lineDiff } from './diff';
import { MetricPromptBoxes } from './MetricPromptBoxes';
import {
  EMPTY_METRIC_STATE,
  approvedMetrics,
  metricPromptsForGaps,
  metricsChanged,
  stillApproved,
} from './metricPrompts';
import { createJobSessions, sessionIn, type JobSessions, type TailorJobState } from './jobSessions';
import { AtsStep } from './AtsStep';
import { compareAts } from './atsComparison';
import { buildCoverLetterDocx, buildCvDocx } from './docx';
import { buildCoverLetterPdf, buildCvPdf } from './pdf';
import {
  LETTER_WORD_LIMIT,
  NO_AI_REASON,
  documentTitle,
  editedAdvertTitle,
  exportFileName,
  newDocument,
  newSavedApplication,
  profileNotes,
  savedMessage,
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

/** What the gate is waiting to run, once the user has answered. */
type PendingAction = 'tailor' | 'review' | 'letter';

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
  /**
   * Switch to Settings (L-175). The shell owns which view is showing, so the
   * "needs a model — set one up in Settings" state hands the request back to
   * it, the same arrangement as Search and Paste-a-job. Left undefined, no
   * button is drawn: a button that goes nowhere is worse than none.
   */
  readonly onOpenSettings?: (() => void) | undefined;
  /**
   * A job, CV and option handed over from Analysis or the tracker (L-190).
   *
   * Applied ONCE, when the CVs, the saved jobs and this machine's options
   * have all been read — each field is checked against them, so a CV deleted
   * since, a job not on the board, or an option this screen cannot use falls
   * back to the ordinary default rather than to a select pointing at nothing.
   * Owned by the shell, which clears it when `onHandoffHandled` is called.
   */
  readonly handoff?: TailorHandoff | null | undefined;
  readonly onHandoffHandled?: (() => void) | undefined;
  /**
   * The per-job work (L-199), owned by the shell so it outlives this view.
   * Left undefined in a test that does not care, and this screen keeps its
   * own for as long as it is mounted.
   */
  readonly jobSessions?: JobSessions | undefined;
  /**
   * Where the step bar's ✓ for Analyse and Export come from (L-200). Left
   * undefined, the database — unless the tailor port was injected, in which
   * case a test that faked the data layer gets no real reads behind it.
   */
  readonly progressPort?: JobProgressPort | undefined;
  /** The step to open on — ATS Score or Export when the user came from the bar elsewhere. */
  readonly entryStep?: TailorStep | undefined;
  /** Find and Analyse are other screens: the shell moves there, with this job. */
  readonly onJobStep?: ((step: StepId, job: Job) => void) | undefined;
  /** "◀ Tracker" on the step bar. */
  readonly onTracker?: (() => void) | undefined;
}

/** The three steps that are this screen's own (L-200). */
export type TailorStep = 'tailor' | 'ats' | 'export';

/** Where each of this screen's steps is on the page, to scroll to. */
const STEP_ANCHOR: Readonly<Record<TailorStep, string>> = {
  tailor: 'tailor-step-tailor',
  ats: 'tailor-step-ats',
  export: 'tailor-step-export',
};

function isTailorStep(step: StepId): step is TailorStep {
  return step === 'tailor' || step === 'ats' || step === 'export';
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

export function Tailor({
  port,
  filePort,
  createTransport,
  consentPort,
  now,
  onOpenSettings,
  handoff,
  onHandoffHandled,
  jobSessions,
  progressPort,
  entryStep,
  onJobStep,
  onTracker,
}: TailorProps = {}) {
  const tailorPort = useMemo(() => port ?? createDbTailorPort(), [port]);
  const files = useMemo(() => filePort ?? createTauriFilePort(), [filePort]);
  const consentStore = useMemo(() => consentPort ?? createTauriConsentPort(), [consentPort]);
  const sessions = useMemo(() => jobSessions ?? createJobSessions(), [jobSessions]);
  const progress = useMemo<JobProgressPort>(
    () =>
      progressPort ??
      (port === undefined ? createDbJobProgressPort() : { load: async () => NO_SAVED_PROGRESS }),
    [port, progressPort],
  );
  const sessionsState = useSyncExternalStore(sessions.watch, sessions.get);

  const [cvs, setCvs] = useState<readonly Cv[]>([]);
  const [cvsLoaded, setCvsLoaded] = useState(false);
  const [jobs, setJobs] = useState<readonly Job[]>([]);
  /** False until the saved-jobs read has come back, either way. A handoff waits for it. */
  const [jobsLoaded, setJobsLoaded] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [applications, setApplications] = useState<readonly Application[]>([]);
  const [selectedApplicationId, setSelectedApplicationId] = useState<string | null>(null);
  /** The job whose applications `applications` holds — saving waits for them. */
  const [applicationsFor, setApplicationsFor] = useState<string | null>(null);

  const [options, setOptions] = useState<readonly ProviderOption[]>([]);
  const [availabilityRead, setAvailabilityRead] = useState(false);
  const [localModelHint, setLocalModelHint] = useState<string | null>(null);

  const [elapsed, setElapsed] = useState(0);
  /** Screen-level problems: a failed read or save. A failed RUN belongs to its job. */
  const [error, setError] = useState<string | null>(null);

  // ── This job's work (L-199) ──────────────────────────────────────────────
  //
  // Everything that belongs to a JOB lives in `sessions`, keyed by job id, so
  // it outlives this view and a second job cannot overwrite the first. What is
  // left in `useState` above and below is about the screen, not the job.

  /** The tracked job the advert came from, or `null` for a paste. */
  const selectedJobId = sessionsState.activeJobId;
  const work: TailorJobState = sessionIn(sessionsState, selectedJobId);
  /** Change the job on screen. Read at call time, so a stale closure cannot misfile it. */
  const patchActive = useCallback(
    (patch: Partial<TailorJobState>) => sessions.patch(sessions.get().activeJobId, patch),
    [sessions],
  );
  /** The job's CV, if it still exists — otherwise the newest one. */
  const selectedCvId =
    work.cvId !== null && cvs.some((cv) => cv.id === work.cvId) ? work.cvId : (cvs[0]?.id ?? null);
  const jobText = work.advert;
  /**
   * The Analysis result's keyword gaps, as handed over (L-202). Kept even when
   * the user moves to another CV or edits the advert: `gapsForTailor` decides
   * at each render whether they still apply, so going back brings them back.
   */
  const handedGaps = work.handedGaps;
  /** What the user typed against each gap, and whether they approved it (L-205). */
  const metricState = work.metricState;
  /** The job's option, if this machine still offers it — otherwise the default. */
  const optionKey =
    work.optionKey !== null && optionByKey(options, work.optionKey) !== null
      ? work.optionKey
      : (options[0]?.key ?? '');
  const phase = work.phase;
  const result = work.result;
  const review = work.review;
  const letter = work.letter;
  /** A failed read or save on this screen, else why this job's last run failed. */
  const shownError = error ?? work.error;
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /**
   * Whether the chosen CV's text is shown (L-192). Starts open, and is NOT
   * reset when the CV changes: a user who folded it away did so on purpose.
   */
  const [cvPreviewOpen, setCvPreviewOpen] = useState(true);

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
    });

    void tailorPort.loadJobs().then((loaded) => {
      if (cancelled) return;
      // Set on both branches: a failed read is a finished read, and a handoff
      // waiting on it still has an advert worth putting in the box.
      setJobsLoaded(true);
      // Not surfaced: the tracked-job shortcut is a convenience.
      if (!loaded.ok) return;
      setJobs(loaded.value);
      // The job this screen was showing has been deleted since: show a paste.
      const active = sessions.get().activeJobId;
      if (active !== null && !loaded.value.some((candidate) => candidate.id === active)) {
        sessions.open(null, () => ({}));
      }
    });

    void tailorPort.profile().then((loaded) => {
      // Not surfaced either: no profile means no notes, which is fine.
      if (!cancelled && loaded.ok) setProfile(loaded.value);
    });

    return () => {
      cancelled = true;
    };
  }, [sessions, tailorPort]);

  useEffect(() => {
    let cancelled = false;

    void readAvailability().then((availability) => {
      if (cancelled) return;
      const offered = tailorOptions(providerOptions(availability));
      setOptions(offered);
      setLocalModelHint(ollamaHint(availability));
      setAvailabilityRead(true);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setApplications([]);
    setSelectedApplicationId(null);
    setApplicationsFor(null);
    if (selectedJobId === null) return;

    let cancelled = false;
    void tailorPort.loadApplicationsFor(selectedJobId).then((loaded) => {
      if (cancelled) return;
      // A failed read is a finished read: the save button must not wait for
      // ever. It then starts an application, which is the worst case — a
      // second empty one — rather than a CV the user cannot keep.
      setApplicationsFor(selectedJobId);
      if (!loaded.ok) return;
      setApplications(loaded.value);
      setSelectedApplicationId(loaded.value[0]?.id ?? null);
    });

    return () => {
      cancelled = true;
    };
  }, [tailorPort, selectedJobId]);

  /**
   * Apply a handoff (L-190) once everything it is checked against has loaded.
   *
   * WAITS for the options too, and applies after them, so the availability
   * read — which sets the default option — cannot land later and overwrite
   * the one handed over. The ref makes it once-only even if the shell never
   * clears it: re-applying on the next render would undo the user's edits.
   */
  const appliedHandoff = useRef<TailorHandoff | null>(null);
  /**
   * The handoff just applied, until the render that shows it has committed.
   *
   * The shell is told "handled" from the NEXT effect, not from inside the one
   * that sets the CV, job and option: those updates are only queued there, so
   * a caller acting on "handled" — a test reading the pickers, or the shell
   * re-rendering — could otherwise see the screen before it matches.
   */
  const [handedOff, setHandedOff] = useState<TailorHandoff | null>(null);
  useEffect(() => {
    if (handedOff === null) return;
    setHandedOff(null);
    onHandoffHandled?.();
  }, [handedOff, onHandoffHandled]);
  useEffect(() => {
    if (handoff === undefined || handoff === null || appliedHandoff.current === handoff) return;
    if (!cvsLoaded || !jobsLoaded || !availabilityRead) return;
    appliedHandoff.current = handoff;

    // A job that is not on the board leaves the advert as a paste.
    const jobId =
      handoff.jobId !== null && jobs.some((candidate) => candidate.id === handoff.jobId)
        ? handoff.jobId
        : null;
    sessions.open(jobId, () => ({ advert: handoff.jobText }));
    sessions.patch(jobId, (current) => {
      const cvId =
        handoff.cvId !== null && cvs.some((candidate) => candidate.id === handoff.cvId)
          ? handoff.cvId
          : current.cvId;
      // Only an option THIS screen offers. The basic match is never one — it
      // cannot write a paragraph — so a check run with it lands on the default.
      const option =
        handoff.optionKey !== null && optionByKey(options, handoff.optionKey) !== null
          ? handoff.optionKey
          : current.optionKey;
      // A hand-off is the user pressing "Tailor my CV" — a fresh start for
      // this job (L-205): the draft, the review, the letter and the boxes go.
      // Leaving this screen and coming back, or picking the job again below,
      // is NOT a hand-off, and keeps them (L-199).
      return {
        advert: handoff.jobText,
        cvId,
        optionKey: option,
        handedGaps: handoff.keywordGaps ?? null,
        metricState: EMPTY_METRIC_STATE,
        result: null,
        review: null,
        letter: null,
        error: null,
      };
    });
    setSaveMessage(null);
    setHandedOff(handoff);
  }, [availabilityRead, cvs, cvsLoaded, handoff, jobs, jobsLoaded, options, sessions]);

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

  /**
   * The ATS Score step's numbers (L-198): the draft against the advert on
   * screen, beside the original CV against the same advert. Recomputed only
   * when one of the three changes — the scorers are synchronous, but a
   * keystroke in the advert box should not re-score twice per render.
   */
  const atsComparison = useMemo(
    () =>
      result === null ? null : compareAts({ originalCv: cvText, tailoredCv: result.text, jobText }),
    [cvText, jobText, result],
  );
  const notes = profileNotes(profile);
  /**
   * The handed-over gaps, only while this is the CV and advert they were found
   * for — cleaned and capped exactly as the prompt will carry them, so the
   * note's count is the number the model sees. `null` when none are left.
   */
  const keywordGaps = useMemo(() => {
    const sent = promptKeywordGaps(gapsForTailor(handedGaps, selectedCvId, jobText));
    return sent.length === 0 ? null : sent;
  }, [handedGaps, jobText, selectedCvId]);
  /** One question per gap on screen; the same words the prompt carries. */
  const metricPrompts = useMemo(() => metricPromptsForGaps(keywordGaps), [keywordGaps]);
  /** Approved only, and only for gaps still on screen. Typed text never gets here. */
  const userMetrics = useMemo(
    () => approvedMetrics(metricState, metricPrompts),
    [metricPrompts, metricState],
  );
  const jobTitle = selectedJob?.title ?? '';
  /**
   * The advert in the box is not the tracked job's own text (L-199). The job
   * link is KEPT — owner decision, 2026-10-01 — and the screen says so.
   */
  const advertEdited = selectedJob !== null && jobText !== jobAdvertText(selectedJob);

  // ── The step bar (L-200) ─────────────────────────────────────────────────

  /** Which of this screen's steps the user is on. */
  const [step, setStep] = useState<TailorStep>(entryStep ?? 'tailor');
  /** The saved half of the job's progress: analysed, exported. */
  const [saved, setSaved] = useState<SavedProgress>(NO_SAVED_PROGRESS);
  useEffect(() => {
    setSaved(NO_SAVED_PROGRESS);
    if (selectedJobId === null) return;
    let cancelled = false;
    void progress.load(selectedJobId).then((loaded) => {
      if (!cancelled) setSaved(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [progress, selectedJobId]);
  // Scroll the step into view once it is on the page. ATS Score and Export
  // only exist once there is a draft; before that the screen stays put.
  useEffect(() => {
    const anchor = document.getElementById(STEP_ANCHOR[step]);
    if (anchor !== null && typeof anchor.scrollIntoView === 'function') {
      anchor.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [step]);
  const onBarStep = useCallback(
    (target: StepId) => {
      if (isTailorStep(target)) setStep(target);
      else if (selectedJob !== null) onJobStep?.(target, selectedJob);
    },
    [onJobStep, selectedJob],
  );

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
    [createTransport, cvText, hasConsent, jobText, keywordGaps, notes, sessions, userMetrics],
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
    [createTransport, cvText, hasConsent, jobText, result, sessions, userMetrics],
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
    [createTransport, cvText, hasConsent, jobText, notes, result, sessions, userMetrics],
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
    if (result === null) return;
    // A paste has no job, so no application to save into. A tracked job with
    // none gets one, below: the user should never be sent to the tracker first.
    if (selectedApplicationId === null && selectedJob === null) return;
    setError(null);
    setSaveMessage(null);
    setSaving(true);

    const stamp = (now ?? new Date()).toISOString();

    let applicationId = selectedApplicationId;
    if (applicationId === null && selectedJob !== null) {
      const application = newSavedApplication({
        id: crypto.randomUUID(),
        jobId: selectedJob.id,
        now: stamp,
      });
      const created = await tailorPort.createApplication(application);
      if (!created.ok) {
        setSaving(false);
        setError(`The tailored CV could not be saved: ${created.error.message}`);
        return;
      }
      setApplications([application]);
      setSelectedApplicationId(application.id);
      applicationId = application.id;
    }
    if (applicationId === null) return;

    const saved = await tailorPort.saveDocument(
      newDocument({
        id: crypto.randomUUID(),
        applicationId,
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

    // The CV was written for THIS text, so the record keeps it (L-199, owner
    // decision 2026-10-01): an edited advert is saved beside the CV, marked.
    let advertSaved = false;
    if (advertEdited) {
      const savedAdvert = await tailorPort.saveDocument(
        newDocument({
          id: crypto.randomUUID(),
          applicationId,
          kind: 'advert',
          title: editedAdvertTitle(jobTitle),
          text: jobText,
          now: stamp,
        }),
      );
      if (!savedAdvert.ok) {
        setSaving(false);
        setError(`The CV was saved, but the edited advert was not: ${savedAdvert.error.message}`);
        return;
      }
      advertSaved = true;
    }

    let letterSaved = false;
    if (letter !== null) {
      const savedLetter = await tailorPort.saveDocument(
        newDocument({
          id: crypto.randomUUID(),
          applicationId,
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
      letterSaved = true;
    }

    setSaving(false);
    setSaveMessage(savedMessage({ advert: advertSaved, letter: letterSaved }));
    setSaved((current) => ({ ...current, exported: true }));
  }, [
    advertEdited,
    jobText,
    jobTitle,
    letter,
    now,
    result,
    selectedApplicationId,
    selectedJob,
    tailorPort,
  ]);

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

  // The Word (L-165) and PDF (L-201) exports: the same structured result the
  // text render reads, built into a file on this machine and handed to the
  // same dialog-in-Rust save. Success and cancel are worded exactly as the
  // text path's, so the buttons side by side behave as one feature.
  const onSaveDocument = useCallback(
    async (kind: 'cv' | 'cover_letter', format: 'docx' | 'pdf') => {
      // `null` for the name: the app never asks the model for one, and this
      // screen has nothing else to offer (see `renderTailoredCv`).
      const build = async (): Promise<{ bytes: Uint8Array; missing: readonly string[] }> => {
        if (kind === 'cv' && result !== null) {
          return format === 'pdf'
            ? buildCvPdf(result.cv, null)
            : { bytes: await buildCvDocx(result.cv, null), missing: [] };
        }
        if (kind === 'cover_letter' && letter !== null) {
          return format === 'pdf'
            ? buildCoverLetterPdf(letter.letter)
            : { bytes: await buildCoverLetterDocx(letter.letter), missing: [] };
        }
        throw new Error('nothing to export');
      };
      if ((kind === 'cv' ? result : letter) === null) return;
      setError(null);
      setSaveMessage(null);
      setSaving(true);

      let built: { bytes: Uint8Array; missing: readonly string[] };
      try {
        built = await build();
      } catch {
        // The builder runs over our own validated result, so this is our bug;
        // it still ends in a sentence on screen rather than a stuck spinner.
        setSaving(false);
        setError('That document could not be built. Try running the tailoring again.');
        return;
      }

      const saved = await files.saveBytes(
        built.bytes,
        exportFileName(kind, jobTitle, format),
        format,
      );
      setSaving(false);

      if (!saved.ok) {
        setError(`That could not be saved: ${saved.error.message}`);
        return;
      }
      if (saved.value === null) return;
      setSaveMessage(
        built.missing.length === 0
          ? `Saved to ${saved.value}.`
          : `Saved to ${saved.value}. The PDF's built-in font cannot show ` +
              `${built.missing.join(' ')}, so they appear as ? or a plain letter. ` +
              'Save as Word to keep them exactly.',
      );
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

      {selectedJob === null ? null : (
        <JobStepBar
          title={selectedJob.title}
          company={selectedJob.company}
          location={selectedJob.location}
          current={step}
          progress={{
            analysed: saved.analysed,
            tailored: result !== null,
            exported: saved.exported,
          }}
          onStep={onBarStep}
          onTracker={onTracker}
        />
      )}

      {shownError === null ? null : (
        <p
          role="alert"
          data-testid="tailor-error"
          className="border-b border-danger/30 bg-danger/5 px-4 py-2 text-danger md:px-6"
        >
          {shownError}
        </p>
      )}

      <div className="min-h-0 min-w-0 flex-1 space-y-5 overflow-y-auto px-4 py-4 md:px-6 md:py-5">
        <span id={STEP_ANCHOR.tailor} aria-hidden="true" />
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
              // A draft written from another CV is not this CV's draft.
              patchActive({
                cvId: id === '' ? null : id,
                result: null,
                review: null,
                letter: null,
                error: null,
              });
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

          {/*
           * The chosen CV, as the rewrite will read it (L-192): the stored
           * `extracted_text` — the same `cvText` every run is sent — not the
           * file, so anything the parser dropped is visible BEFORE the run.
           * Read-only on purpose; editing belongs on Analysis, where the CV
           * is uploaded. No CV at all draws nothing: the picker says so.
           */}
          {selectedCv === null ? null : (
            <div className="mt-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p id="tailor-cv-preview-heading" className="text-xs font-medium text-ink-muted">
                  Your CV as the rewrite reads it
                </p>
                <button
                  type="button"
                  data-testid="tailor-cv-preview-toggle"
                  aria-expanded={cvPreviewOpen}
                  aria-controls="tailor-cv-preview"
                  onClick={() => setCvPreviewOpen((open) => !open)}
                  className={QUIET_BUTTON}
                >
                  {cvPreviewOpen ? 'Hide CV' : 'Show CV'}
                </button>
              </div>
              <section
                id="tailor-cv-preview"
                data-testid="tailor-cv-preview"
                aria-labelledby="tailor-cv-preview-heading"
                hidden={!cvPreviewOpen}
                className="mt-1"
              >
                {cvText.trim() === '' ? (
                  <p data-testid="tailor-cv-preview-empty" className="text-xs text-ink-faint">
                    No text could be read from this CV, so there is nothing for the rewrite to work
                    from.
                  </p>
                ) : (
                  <>
                    {/* Focusable, so a keyboard alone can scroll a long CV. */}
                    <pre
                      data-testid="tailor-cv-preview-text"
                      tabIndex={0}
                      className="max-h-72 overflow-y-auto rounded-card border border-line bg-card px-4 py-3 font-sans text-ink whitespace-pre-wrap"
                    >
                      {cvText}
                    </pre>
                    <p data-testid="tailor-cv-preview-meta" className="mt-1 text-xs text-ink-faint">
                      {selectedCv.name} ·{' '}
                      <span className="font-mono tabular-nums">{wordCount(cvText)}</span> words
                    </p>
                  </>
                )}
              </section>
            </div>
          )}
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
              // Edited by hand. The job link is KEPT (L-199, owner decision
              // 2026-10-01): it is still that job, and the marker below says
              // the text is the user's version of its advert.
              patchActive({ advert: event.currentTarget.value });
            }}
            className="mt-1 w-full rounded-control border border-line bg-card px-2.5 py-1.5 text-ink"
          />

          {!advertEdited || selectedJob === null ? null : (
            <div
              data-testid="tailor-advert-edited"
              className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-muted"
            >
              <span>Advert edited — the tailoring uses your version.</span>
              <button
                type="button"
                data-testid="tailor-advert-restore"
                onClick={() => patchActive({ advert: jobAdvertText(selectedJob) })}
                className={QUIET_BUTTON}
              >
                Restore the original
              </button>
            </div>
          )}

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
                  const picked = jobs.find(
                    (candidate) => candidate.id === event.currentTarget.value,
                  );
                  if (picked === undefined) return;
                  // A job seen before comes back as it was left (L-199); a new
                  // one starts from its advert, with the CV and model the user
                  // already chose — those are choices, not this job's work.
                  // Another job starts on its own Tailor step. Set HERE, on
                  // the user's pick, not on any change of job: a hand-off
                  // from another screen's step bar sets the job too, and
                  // must keep the step it asked for (L-200).
                  if (picked.id !== selectedJobId) setStep('tailor');
                  sessions.open(picked.id, () => ({
                    advert: jobAdvertText(picked),
                    cvId: selectedCvId,
                    optionKey: work.optionKey,
                  }));
                  setError(null);
                  setSaveMessage(null);
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

          {keywordGaps === null ? null : (
            <p data-testid="tailor-keyword-gaps-note" className="mt-1 text-xs text-ink-faint">
              From your analysis: {keywordGaps.length} {keywordGaps.length === 1 ? 'word' : 'words'}{' '}
              in the advert that your CV does not use yet. The draft uses them only where your CV
              already shows the experience.
            </p>
          )}
          <MetricPromptBoxes
            prompts={metricPrompts}
            state={metricState}
            onChange={(next) => patchActive({ metricState: next })}
            disabled={running}
          />
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
            onChange={(event) => patchActive({ optionKey: event.currentTarget.value })}
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
              className="mt-2 rounded-control bg-gold/10 px-3 py-2 text-xs text-gold-ink"
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

          {disabledReason === NO_AI_REASON && onOpenSettings !== undefined ? (
            <button
              type="button"
              data-testid="tailor-open-settings"
              onClick={onOpenSettings}
              className={SECONDARY_BUTTON}
            >
              Open Settings
            </button>
          ) : null}
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
            className="rounded-control bg-teal/10 px-3 py-2 break-all text-teal-ink"
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
                  ? 'rounded-control bg-teal/10 px-3 py-2 text-teal-ink'
                  : 'rounded-control bg-gold/10 px-3 py-2 text-gold-ink'
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

            {/*
              The ATS Score step (L-198): this draft re-scored against the same
              advert, before → after, so the last thing read before saving is
              whether tailoring helped. Pure and offline — see `atsComparison.ts`.
            */}
            <span id={STEP_ANCHOR.ats} aria-hidden="true" />
            {atsComparison === null ? null : (
              <AtsStep
                comparison={atsComparison}
                fabrication={{ clean: result.report.clean, flagged: result.report.flagged.length }}
              />
            )}

            {metricsChanged(result.userMetrics, userMetrics) ? (
              <p data-testid="tailor-metrics-changed-note" className="text-xs text-ink-muted">
                Your added results changed since this draft. Re-run tailoring to use them.
              </p>
            ) : null}

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
                onClick={() => void onSaveDocument('cv', 'docx')}
                className={SECONDARY_BUTTON}
              >
                Save CV as Word…
              </button>
              <button
                type="button"
                data-testid="tailor-save-pdf-cv"
                disabled={running || saving}
                onClick={() => void onSaveDocument('cv', 'pdf')}
                className={SECONDARY_BUTTON}
              >
                Save CV as PDF…
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
                    className="rounded-control bg-gold/10 px-3 py-2 text-gold-ink"
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
                    className="rounded-control bg-gold/10 px-3 py-2 text-gold-ink"
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
                  onClick={() => void onSaveDocument('cover_letter', 'docx')}
                  className={SECONDARY_BUTTON}
                >
                  Save letter as Word…
                </button>
                <button
                  type="button"
                  data-testid="tailor-save-pdf-letter"
                  disabled={running || saving}
                  onClick={() => void onSaveDocument('cover_letter', 'pdf')}
                  className={SECONDARY_BUTTON}
                >
                  Save letter as PDF…
                </button>
              </div>
            )}

            {/* ── Save to an application ─────────────────────────────── */}
            <span id={STEP_ANCHOR.export} aria-hidden="true" />
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
                disabled={
                  running ||
                  saving ||
                  selectedJobId === null ||
                  // Wait for the job's applications, so a quick press cannot
                  // start a second one beside the one it already has.
                  applicationsFor !== selectedJobId
                }
                onClick={() => void onSaveToApplication()}
                className={SECONDARY_BUTTON}
              >
                {saving ? 'Saving…' : 'Save to an application'}
              </button>
              {selectedJobId !== null ? null : (
                <p data-testid="tailor-save-application-reason" className="text-xs text-ink-muted">
                  Choose a tracked job above to save into one of its applications.
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
