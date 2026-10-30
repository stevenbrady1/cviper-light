import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { type ChatTransport, promptKeywordGaps } from '@cviper/ai-providers';
import { type Application, type Cv, type Job, type Profile } from '@cviper/core-types';

import { scrollWithin } from '../../app/scrollWithin';
import { ViewHeader } from '../../app/ViewHeader';
import { viewById } from '../../app/views';
import { createTauriBrowserPort, type BrowserPort } from '../../platform/browser';
import { createTauriFilePort, type FilePort } from '../../platform/files';

import { readAvailability } from '../analysis/availability';
import { ConsentGate } from '../analysis/ConsentGate';
import { cvCutNote } from '../analysis/cvCutNote';
import {
  createTauriConsentPort,
  NO_CONSENT,
  type ConsentPort,
  type ConsentState,
} from '../analysis/consent';
import { jobAdvertText, providerInSentence } from '../analysis/model';
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

import {
  EMPTY_METRIC_STATE,
  approvedMetrics,
  metricPromptsForGaps,
  metricsChanged,
} from './metricPrompts';
import { createJobSessions, sessionIn, type JobSessions, type TailorJobState } from './jobSessions';
import { compareAts } from './atsComparison';
import { profileNotes, runDisabledReason, tailorOptions } from './model';
import { createDbTailorPort, type TailorPort } from './port';
import { TailorAdvert } from './TailorAdvert';
import { TailorCvPicker } from './TailorCvPicker';
import { TailorEngine } from './TailorEngine';
import { TailorResultView } from './TailorResultView';
import { TailorRunBar } from './TailorRunBar';
import { STEP_ANCHOR, isTailorStep, type TailorStep } from './tailorSteps';
import { useTailorRuns } from './useTailorRuns';
import { useTailorSaving } from './useTailorSaving';

export type { TailorStep } from './tailorSteps';

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
 *
 * ============================================================================
 * WHERE THE PIECES LIVE (L-305)
 * ============================================================================
 * This file owns the state and the loading. Each panel on the page is its own
 * component (`TailorCvPicker`, `TailorAdvert`, `TailorEngine`, `TailorRunBar`,
 * `TailorResultView` and the parts it lays out), the AI runs and the consent
 * gate are `useTailorRuns`, and every save is `useTailorSaving`. Two features
 * on this screen then usually edit two different files, which is the point:
 * `component-size.contract.test.ts` keeps any screen file under 800 lines.
 */

/** How often the elapsed counter ticks while a model is thinking. */
const TICK_MS = 1000;

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
   * Opens Ollama's download page beside the Ollama hint (L-240). Injected by
   * tests; defaults to the real one, which hands the address to the browser.
   */
  readonly browser?: BrowserPort | undefined;
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

export function Tailor({
  port,
  filePort,
  createTransport,
  consentPort,
  now,
  onOpenSettings,
  browser,
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
  const browserPort = useMemo(() => browser ?? createTauriBrowserPort(), [browser]);
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
  /**
   * A CV uploaded on this screen (L-240): stored by `CvUpload` in the same
   * table every screen reads, so here it only has to join the list and be
   * chosen — exactly what picking it from the list would do.
   */
  const onCvUploaded = useCallback(
    (cv: Cv) => {
      setCvs((current) => [cv, ...current.filter((existing) => existing.id !== cv.id)]);
      patchActive({ cvId: cv.id, result: null, review: null, letter: null, error: null });
      setSaveMessage(null);
    },
    [patchActive],
  );
  /**
   * Whether the user has opened the chosen CV's text (L-192). Starts folded,
   * so the advert is above the fold (L-340), and is NOT reset when the CV
   * changes: a user who opened or folded it did so on purpose.
   */
  const [cvPreviewOpen, setCvPreviewOpen] = useState(false);

  const [consent, setConsent] = useState<ConsentState>(NO_CONSENT);

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
  /** The screen's own scroll area: the only thing a step link may scroll (L-216). */
  const scrollArea = useRef<HTMLDivElement | null>(null);
  // Scroll the step into view once it is on the page. ATS Score and Export
  // only exist once there is a draft; before that the screen stays put.
  // Within Tailor's own area only — never `scrollIntoView`, which scrolls the
  // shell and the page too (see `scrollWithin`).
  useEffect(() => {
    const anchor = document.getElementById(STEP_ANCHOR[step]);
    if (anchor !== null && scrollArea.current !== null) scrollWithin(scrollArea.current, anchor);
  }, [step]);
  const onBarStep = useCallback(
    (target: StepId) => {
      if (isTailorStep(target)) setStep(target);
      else if (selectedJob !== null) onJobStep?.(target, selectedJob);
    },
    [onJobStep, selectedJob],
  );

  const { gated, pendingConsent, onConsentAccept, onConsentDecline, onWithdrawConsent } =
    useTailorRuns({
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
    });

  const { saving, onSaveToApplication, onSaveCv, onSaveText, onSaveDocument } = useTailorSaving({
    tailorPort,
    files,
    now,
    result,
    letter,
    jobText,
    jobTitle,
    advertEdited,
    selectedJob,
    selectedApplicationId,
    setApplications,
    setSelectedApplicationId,
    setCvs,
    setSaved,
    setError,
    setSaveMessage,
  });

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
        : `Sending your CV and the advert to ${providerInSentence(selectedOption.kind)}. ` +
          'This usually takes a few seconds.';

  /**
   * Said by the picker when the chosen AI will not read the whole CV (L-302).
   * It matters most here: the tailored CV is rewritten from what was sent, so
   * anything past the cut is not in it.
   */
  const cvCut = cvCutNote(cvText, selectedOption?.kind ?? null);

  /** The whole progress sentence, shown with a counter and spoken (L-299). */
  const progressSentence =
    (phase === 'reviewing'
      ? 'Reading the draft as a hiring manager would. '
      : phase === 'writing'
        ? 'Drafting the letter. '
        : '') + progressText;

  const grantedConsents = (['anthropic', 'openai'] as const).filter((kind) => consent[kind]);

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="view-tailor">
      <ViewHeader view={view.id} title={view.label} summary={view.summary} />

      {selectedJob === null ? null : (
        <JobStepBar
          title={selectedJob.title}
          company={selectedJob.company}
          location={selectedJob.location}
          current={step}
          choice={{ cv: selectedCv?.name ?? null, engine: selectedOption?.label ?? null }}
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

      <div
        ref={scrollArea}
        data-testid="tailor-scroll"
        className="min-h-0 min-w-0 flex-1 space-y-5 overflow-y-auto px-4 py-4 md:px-6 md:py-5"
      >
        <span id={STEP_ANCHOR.tailor} aria-hidden="true" />
        <TailorCvPicker
          cvs={cvs}
          cvsLoaded={cvsLoaded}
          selectedCvId={selectedCvId}
          selectedCv={selectedCv}
          onPick={(id) => {
            // A draft written from another CV is not this CV's draft.
            patchActive({ cvId: id, result: null, review: null, letter: null, error: null });
            setSaveMessage(null);
          }}
          files={files}
          saveCv={(cv) => tailorPort.saveCv(cv)}
          now={now}
          onUploaded={onCvUploaded}
          previewOpen={cvPreviewOpen}
          onTogglePreview={() => setCvPreviewOpen((open) => !open)}
          running={running}
          onSaveCv={onSaveCv}
        />

        <TailorAdvert
          jobText={jobText}
          onAdvertChange={(advert) => patchActive({ advert })}
          advertEdited={advertEdited}
          selectedJob={selectedJob}
          onRestoreAdvert={(job) => patchActive({ advert: jobAdvertText(job) })}
          jobs={jobs}
          selectedJobId={selectedJobId}
          onPickJob={(picked) => {
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
          keywordGaps={keywordGaps}
          metricPrompts={metricPrompts}
          metricState={metricState}
          onMetricStateChange={(next) => patchActive({ metricState: next })}
          running={running}
        />

        <TailorEngine
          options={options}
          optionKey={optionKey}
          selectedOption={selectedOption}
          onOptionChange={(key) => patchActive({ optionKey: key })}
          aiAvailable={aiAvailable}
          availabilityRead={availabilityRead}
          cvCut={cvCut}
          localModelHint={localModelHint}
          browser={browserPort}
          grantedConsents={grantedConsents}
          onWithdrawConsent={(kind) => void onWithdrawConsent(kind)}
        />

        <TailorRunBar
          phase={phase}
          disabledReason={disabledReason}
          onRun={() => void gated('tailor')}
          onOpenSettings={onOpenSettings}
          progressSentence={running && selectedOption !== null ? progressSentence : null}
          elapsed={elapsed}
          choosingFile={saving === 'file'}
          saveMessage={saveMessage}
        />

        <TailorResultView
          result={result}
          cvText={cvText}
          atsComparison={atsComparison}
          metricsChanged={result !== null && metricsChanged(result.userMetrics, userMetrics)}
          review={review}
          letter={letter}
          phase={phase}
          busy={running || saving !== null}
          onRun={(action) => void gated(action)}
          onSaveText={(kind) => void onSaveText(kind)}
          onSaveDocument={(kind, format) => void onSaveDocument(kind, format)}
          saveApplication={{
            applications,
            selectedApplicationId,
            onSelectApplication: setSelectedApplicationId,
            selectedJobId,
            applicationsFor,
            saving: saving === 'application',
            onSave: () => void onSaveToApplication(),
          }}
        />
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
