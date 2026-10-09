import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { extractText } from '@cviper/cv-parsing';
import {
  type Analysis as AnalysisRow,
  type Cv,
  type Job,
  type Profile,
  type Result,
} from '@cviper/core-types';
import { runGates } from '@cviper/keyword-scoring';

import { PRIMARY_BUTTON, SECONDARY_BUTTON } from '../../app/buttons';
import { DetailPane } from '../../app/DetailPane';
import { ViewHeader } from '../../app/ViewHeader';
import { viewById } from '../../app/views';
import { createTauriTransport } from '../../ai/transport';
import {
  createTauriFilePort,
  type FileError,
  type FilePort,
  type PickedCv,
} from '../../platform/files';

import { createDbProfilePort, type ProfilePort } from '../profile/port';
import { APP_NAME } from '../settings/backup';

import { AnalysisResult } from './AnalysisResult';
import { readAvailability } from './availability';
import { ConsentGate, ConsentStatus } from './ConsentGate';
import { GateNotice } from './GateNotice';
import {
  createTauriConsentPort,
  isCloudKind,
  NO_CONSENT,
  type ConsentPort,
  type ConsentProviderKind,
  type ConsentState,
} from './consent';
import {
  exportJsonResume,
  jobAdvertText,
  jsonResumeFileName,
  newAnalysisRecord,
  newCvRecord,
  originalJsonResume,
  providerLabel,
  runDisabledReason,
} from './model';
import { createDbAnalysisPort, type AnalysisPort } from './port';
import {
  defaultOptionKey,
  ollamaHint,
  optionByKey,
  providerOptions,
  type ProviderOption,
} from './providers';
import { runAnalysis } from './runAnalysis';
import { createAnalysisSession, type AnalysisSession } from './session';
import { gapsFromAnalysis, type TailorHandoff } from '../flow/handoff';
import { JobStepBar } from '../flow/JobStepBar';
import {
  NO_SAVED_PROGRESS,
  createDbJobProgressPort,
  type JobProgressPort,
  type SavedProgress,
} from '../flow/progress';
import { type StepId } from '../flow/steps';
import { type ChatTransport } from '@cviper/ai-providers';

/**
 * The analysis view: pick a CV, paste an advert, choose how to run it, run it.
 *
 * ============================================================================
 * IT WORKS WITH NOTHING CONFIGURED
 * ============================================================================
 * No API key, no Ollama, no network — the keyword scorer is always in the
 * picker and always selectable, and `analysis.zeroKeys.test.tsx` drives the
 * whole loop with every credential absent and asserts no provider transport is
 * touched. That is a promise the product makes out loud, and this is where it
 * is either true or a lie.
 *
 * ============================================================================
 * EVERY DEAD END EXPLAINS ITSELF
 * ============================================================================
 * There is no support inbox for a free offline app: the UI is the entire
 * support channel. So the run button is ALWAYS on screen and always carries the
 * reason it cannot be pressed (`runDisabledReason`), a parse failure is shown
 * in the parser's own words rather than as "upload failed", and a scan that
 * partly read is reported as a warning rather than quietly analysed as if the
 * missing pages were blank.
 *
 * ============================================================================
 * WAITING IS EXPLAINED WHILE IT HAPPENS
 * ============================================================================
 * A local model that is not already resident spends 5-30 seconds loading
 * several gigabytes into memory before it emits a single token. Thirty seconds
 * of a still screen is indistinguishable from a crash, so the wait says what is
 * happening, says why it is slow, and counts.
 */

/** How often the elapsed counter ticks while a model is thinking. */
const TICK_MS = 1000;

export interface AnalysisProps {
  /**
   * Injected by tests. Defaults to the real SQLite-backed port — a component
   * that reached into `src/db` directly could only be tested by pretending to
   * be SQLite.
   */
  readonly port?: AnalysisPort | undefined;
  /** Injected by tests. Defaults to the OS dialog plus the Rust file commands. */
  readonly filePort?: FilePort | undefined;
  /**
   * Injected by tests so a fake provider can answer without a socket. Left
   * undefined in the app, where `runAnalysis` builds the real Tauri transport —
   * and never builds one at all on the keyword path.
   */
  readonly createTransport?: (() => ChatTransport) | undefined;
  /** Injected by tests so stored timestamps are deterministic. */
  readonly now?: Date | undefined;
  /**
   * A CV the OS asked the app to open (the iPhone share sheet, L-83), or the
   * refusal Rust gave it. Handled exactly like a pick: read, stored, selected
   * — or its message shown where an upload problem is shown. The shell hands
   * it down and `onIncomingCvHandled` tells the shell it has been consumed,
   * so the same file is not ingested twice on a re-render.
   */
  readonly incomingCv?: Result<PickedCv, FileError> | null | undefined;
  readonly onIncomingCvHandled?: (() => void) | undefined;
  /**
   * Injected by tests. Defaults to the real `tauri-plugin-store`-backed port
   * (Apple 5.1.2(i)) — see `consent.ts`.
   */
  readonly consentPort?: ConsentPort | undefined;
  /**
   * Injected by tests. Defaults to the real SQLite-backed port. The gates
   * (L-156) read the PROFILE — languages and work rights — never the CV, and
   * this is the only reason the analysis view knows the profile exists.
   */
  readonly profilePort?: ProfilePort | undefined;
  /**
   * The last analysis — inputs, result, whether one is running — owned by the
   * shell so it survives this view being unmounted by a view switch (L-187).
   * See `session.ts`. Left undefined, the view keeps a private one that lasts
   * exactly as long as it is mounted, which is what a test of the view alone
   * wants.
   */
  readonly session?: AnalysisSession | undefined;
  /**
   * "Tailor my CV for this job" (L-190): the job, the advert, the CV and the
   * option, handed to the shell, which owns which view is showing. Left
   * undefined, no button is drawn — a button that goes nowhere is worse than
   * none.
   */
  readonly onTailor?: ((handoff: TailorHandoff) => void) | undefined;
  /**
   * Where the step bar's ✓ for Analyse and Export come from (L-200). Left
   * undefined, the database — unless the analysis port was injected, in which
   * case a test that faked the data layer gets no real reads behind it.
   */
  readonly progressPort?: JobProgressPort | undefined;
  /** Whether this job has a tailored draft — the Tailor sessions, read by the shell. */
  readonly tailoredJob?: ((jobId: string) => boolean) | undefined;
  /**
   * Every step but this one is elsewhere: the shell moves the user there.
   * `handoff` is what "Tailor my CV for this job" would hand over, for the
   * steps that go to Tailor.
   */
  readonly onJobStep?: ((step: StepId, job: Job, handoff: TailorHandoff) => void) | undefined;
  /** "◀ Tracker" on the step bar. */
  readonly onTracker?: (() => void) | undefined;
  /**
   * The CV and engine already chosen for a job (L-200, "pick once"), here or
   * on Tailor, or `null` when it has none. Read when the job arrives.
   */
  readonly jobChoice?:
    | ((
        jobId: string,
      ) => { readonly cvId: string | null; readonly optionKey: string | null } | null)
    | undefined;
  /** A CV or engine picked here, for a tracked job: recorded for that job. */
  readonly onJobChoice?:
    | ((
        job: Job,
        choice: { readonly cvId?: string | null; readonly optionKey?: string | null },
      ) => void)
    | undefined;
}

/**
 * Which cloud kind this option is, or `null` for a local one.
 *
 * Delegates to `isCloudKind` rather than repeating the predicate: a second copy
 * of "which providers need consent" is a second place to forget a new provider,
 * and this screen decides whether the dialog opens at all.
 */
function consentKindFor(kind: ProviderOption['kind']): ConsentProviderKind | null {
  return isCloudKind(kind) ? kind : null;
}

export function Analysis({
  port,
  filePort,
  createTransport,
  now,
  incomingCv,
  onIncomingCvHandled,
  consentPort,
  profilePort,
  session: sessionProp,
  onTailor,
  progressPort,
  tailoredJob,
  onJobStep,
  onTracker,
  jobChoice,
  onJobChoice,
}: AnalysisProps = {}) {
  // Created once. A new port object every render would restart the load effect
  // on every keystroke in the advert box.
  const analysisPort = useMemo(() => port ?? createDbAnalysisPort(), [port]);
  const progress = useMemo<JobProgressPort>(
    () =>
      progressPort ??
      (port === undefined ? createDbJobProgressPort() : { load: async () => NO_SAVED_PROGRESS }),
    [port, progressPort],
  );
  const files = useMemo(() => filePort ?? createTauriFilePort(), [filePort]);
  const consentStore = useMemo(() => consentPort ?? createTauriConsentPort(), [consentPort]);
  const profiles = useMemo(() => profilePort ?? createDbProfilePort(), [profilePort]);
  const session = useMemo(() => sessionProp ?? createAnalysisSession(), [sessionProp]);
  const {
    selectedCvId,
    jobText,
    jobId,
    jobNote,
    optionKey: pickedOptionKey,
    result,
    checkedAdvert,
    runError,
    warnings,
    running,
  } = useSyncExternalStore(session.watch, session.get);

  const [cvs, setCvs] = useState<readonly Cv[]>([]);
  /**
   * False until the first read of the CV list comes back.
   *
   * Without it the picker says "No CV uploaded yet" — and disables itself —
   * during the read, which is not an empty state but a wrong answer with a
   * dead control attached.
   */
  const [cvsLoaded, setCvsLoaded] = useState(false);
  const [jobs, setJobs] = useState<readonly Job[]>([]);
  /** "Saved to …" after a JSON Resume export (L-20b). */
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [options, setOptions] = useState(() =>
    providerOptions({
      ollamaRunning: false,
      ollamaModels: [],
      anthropicKey: false,
      openaiKey: false,
    }),
  );
  /**
   * The one sentence worth saying about Ollama, or `null`.
   *
   * Held as the computed string rather than as the whole `Availability`, so
   * there is exactly one place — `ollamaHint` — that decides when it is said.
   */
  const [localModelHint, setLocalModelHint] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  /** The saved profile, or `null` — never saved, or could not be read. */
  const [profile, setProfile] = useState<Profile | null>(null);
  const [history, setHistory] = useState<readonly AnalysisRow[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadProblem, setUploadProblem] = useState<string | null>(null);
  /** Per-provider agreement to send a CV to a named cloud AI (Apple 5.1.2(i)). */
  const [consent, setConsent] = useState<ConsentState>(NO_CONSENT);
  /**
   * The cloud option waiting on the consent dialog, or `null` when nothing is.
   * Carries the resolved `ConsentProviderKind` alongside the option so the
   * dialog and the accept handler never have to re-derive it.
   */
  const [pendingConsent, setPendingConsent] = useState<{
    readonly option: ProviderOption;
    readonly kind: ConsentProviderKind;
  } | null>(null);

  // ── Loading ──────────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    void consentStore
      .read()
      .then((result) => {
        // A failed read leaves `consent` at `NO_CONSENT` — the safe default.
        // Not surfaced as an error: an unreadable consent file is not
        // something the user did wrong, and every cloud option is simply
        // asked for again, which is the fail-CLOSED behaviour this whole
        // feature depends on.
        if (!cancelled && result.ok) setConsent(result.value);
      })
      .catch(() => {
        // Defence in depth: `consentStore.read()` never throws, but a mount
        // effect must not let anything escape uncaught either.
      });

    return () => {
      cancelled = true;
    };
  }, [consentStore]);

  useEffect(() => {
    let cancelled = false;

    void profiles.load().then((loaded) => {
      // A failed read is SILENT here, and deliberately so: the gates then run
      // with no languages and no work rights, which `runGates` treats as
      // silence — every requirement becomes "check this", never a hard stop.
      // A red banner over a screen that scores perfectly well would be the
      // wrong lesson, and the profile view reports its own read failures.
      if (!cancelled && loaded.ok) setProfile(loaded.value);
    });

    return () => {
      cancelled = true;
    };
  }, [profiles]);

  useEffect(() => {
    let cancelled = false;

    void analysisPort.loadCvs().then((loaded) => {
      if (cancelled) return;
      // Set on both branches: a failed read is still a finished read, and the
      // error banner below is the honest thing to show, not a permanent
      // "Reading…".
      setCvsLoaded(true);
      if (!loaded.ok) {
        // Never swallowed. A screen that shows no CVs when the database will
        // not open is indistinguishable from a screen with no CVs on it.
        setError(`${loaded.error.message} Your data is still on this machine.`);
        return;
      }
      setCvs(loaded.value);
      // Only when nothing is selected: coming back to this view (L-187) keeps
      // the CV the user was working on.
      session.update((current) => ({
        selectedCvId: current.selectedCvId ?? loaded.value[0]?.id ?? null,
      }));
    });

    void analysisPort.loadJobs().then((loaded) => {
      // A failure here is NOT surfaced: the tracked-job shortcut is a
      // convenience, and losing it must not put a red banner over a screen that
      // otherwise works perfectly with a pasted advert.
      if (!cancelled && loaded.ok) setJobs(loaded.value);
    });

    return () => {
      cancelled = true;
    };
  }, [analysisPort, session]);

  useEffect(() => {
    let cancelled = false;

    void readAvailability().then((availability) => {
      if (cancelled) return;
      setOptions(providerOptions(availability));
      setLocalModelHint(ollamaHint(availability));
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (selectedCvId === null) {
      setHistory([]);
      return;
    }

    let cancelled = false;
    void analysisPort.loadHistory(selectedCvId).then((loaded) => {
      if (!cancelled && loaded.ok) setHistory(loaded.value);
    });

    return () => {
      cancelled = true;
    };
  }, [analysisPort, selectedCvId]);

  /**
   * What the picker shows: the user's pick while this machine still offers it,
   * otherwise the default. Derived rather than stored, so the options being
   * re-read on every visit can never overwrite a choice the user made — and a
   * remembered model that has since been removed is not offered back to them.
   */
  const optionKey =
    pickedOptionKey !== null && optionByKey(options, pickedOptionKey) !== null
      ? pickedOptionKey
      : defaultOptionKey(options);
  const selectedOption = optionByKey(options, optionKey);

  // The elapsed counter. Only for the paths that actually take time — the
  // keyword scan finishes in a microtask, and a timer that starts and stops in
  // the same tick is a flicker, not feedback.
  useEffect(() => {
    if (!running || selectedOption === null || selectedOption.kind === 'keyword') return;

    setElapsed(0);
    const timer = window.setInterval(() => setElapsed((seconds) => seconds + 1), TICK_MS);
    return () => window.clearInterval(timer);
  }, [running, selectedOption]);

  // ── Actions ──────────────────────────────────────────────────────────────

  const selectedCv = cvs.find((cv) => cv.id === selectedCvId) ?? null;

  /**
   * A file's bytes, wherever they came from — the dialog or the share sheet —
   * become a CV row, or a message.
   */
  const ingest = useCallback(
    async (picked: PickedCv) => {
      const extracted = await extractText(picked.name, picked.bytes);
      if (!extracted.ok) {
        // VERBATIM. Every message in `@cviper/cv-parsing` says what happened,
        // why, and what to do — "that PDF has 2 pages but no readable text at
        // all, which means it is almost certainly a scan". Replacing that with
        // "could not read file" throws away the only useful thing on the
        // screen.
        setUploadProblem(extracted.error.message);
        session.update({ warnings: [] });
        return;
      }

      const cv = newCvRecord({
        id: crypto.randomUUID(),
        name: picked.name,
        text: extracted.value.text,
        now: (now ?? new Date()).toISOString(),
        // Kept verbatim when the file WAS a JSON Resume, so "Save as JSON
        // Resume" can return exactly it (L-20b). `null` for everything else.
        jsonResume: originalJsonResume(picked.name, picked.bytes),
      });

      const saved = await analysisPort.saveCv(cv);
      if (!saved.ok) {
        setError(`That CV could not be saved: ${saved.error.message} Try again.`);
        return;
      }

      setCvs((current) => [cv, ...current]);
      // A run still in flight was for the previous CV: its answer is dropped.
      session.supersede();
      session.update({
        selectedCvId: cv.id,
        result: null,
        runError: null,
        // Warnings ride along with a SUCCESSFUL extraction — some pages were
        // images and their contents are missing from the text. The user has to
        // be told, because the analysis below is about to be run on a partial CV.
        warnings: extracted.value.warnings,
      });
      setExportMessage(null);
    },
    [analysisPort, now, session],
  );

  /**
   * Save the selected CV back out as the JSON Resume it arrived as (L-20b).
   *
   * Only reachable when `selectedCv.json_resume` is a string — the button is
   * disabled otherwise — but `exportJsonResume` re-checks, because a disabled
   * button is a UI fact and this is a data one.
   */
  const onSaveJsonResume = useCallback(async () => {
    if (selectedCv === null) return;
    setError(null);
    setExportMessage(null);

    const text = exportJsonResume({
      cv: selectedCv,
      app: APP_NAME,
      exportedAt: (now ?? new Date()).toISOString(),
    });
    if (!text.ok) {
      setError(text.error.message);
      return;
    }

    setExporting(true);
    const saved = await files.saveCvJson(text.value, jsonResumeFileName(selectedCv.name));
    setExporting(false);

    if (!saved.ok) {
      setError(`That CV could not be saved as a JSON Resume: ${saved.error.message}`);
      return;
    }
    // Cancelled. Nothing was written, and nothing is said about it.
    if (saved.value === null) return;

    setExportMessage(
      `Saved to ${saved.value}. The file is the one that came in, with a note of when it left.`,
    );
  }, [files, now, selectedCv]);

  const onUpload = useCallback(async () => {
    setError(null);
    setUploadProblem(null);

    const picked = await files.pickCv();
    if (!picked.ok) {
      setUploadProblem(picked.error.message);
      return;
    }
    // Cancelled. Nothing happened, and nothing is said about it.
    if (picked.value === null) return;

    await ingest(picked.value);
  }, [files, ingest]);

  // A file the OS opened for us (L-83). Same path as a pick from here on.
  useEffect(() => {
    if (incomingCv === undefined || incomingCv === null) return;

    let cancelled = false;
    setError(null);
    setUploadProblem(null);

    void (async () => {
      if (!incomingCv.ok) {
        setUploadProblem(incomingCv.error.message);
        session.update({ warnings: [] });
      } else {
        await ingest(incomingCv.value);
      }
      if (!cancelled) onIncomingCvHandled?.();
    })();

    return () => {
      cancelled = true;
    };
  }, [incomingCv, ingest, onIncomingCvHandled, session]);

  /**
   * Run one option that has ALREADY cleared the consent question — either it
   * never needed one (keyword, Ollama), or the gate was just answered yes.
   */
  const performRun = useCallback(
    async (option: ProviderOption, cv: Cv) => {
      setError(null);
      // The ticket, and every write below going to `session` rather than to
      // this component: the user may leave the view while this is awaited, and
      // the answer must still be there when they come back (L-187).
      const ticket = session.beginRun();
      // Read at the START, like the advert: the check belongs to the job the
      // advert on screen belonged to when it was pressed, not to whatever the
      // box holds by the time a slow model answers.
      const checkedJobId = session.get().jobId;
      setElapsed(0);

      const run = await runAnalysis(
        {
          option,
          cvText: cv.extracted_text ?? '',
          jobText,
        },
        // Passed, never called here on the keyword path — see `runAnalysis.ts`.
        createTransport ?? createTauriTransport,
        // Reads the SAME store this screen shows and revokes through, fresh,
        // rather than a snapshot of the `consent` state — so a run started
        // the instant after a grant is never judged against a stale value.
        (kind) => consentStore.read().then((result) => result.ok && result.value[kind]),
      );

      // Superseded — another CV was picked, or everything was deleted — while
      // this was in flight. Dropped whole, history included: it answers a
      // question nobody is asking any more, and after "Delete everything" a
      // saved row would put data back into a database the user just emptied.
      if (!session.isCurrent(ticket)) return;

      if (!run.ok) {
        session.update({ running: false, result: null, runError: run.error.message });
        return;
      }

      session.update({ running: false, result: run.value, checkedAdvert: jobText });

      const record = newAnalysisRecord({
        id: crypto.randomUUID(),
        cvId: cv.id,
        // The job the advert came from — handed over from Search or the
        // tracker, or picked from the saved jobs (L-190) — so the check sits on
        // the same record as the tailored CV and the letter. A paste is `null`,
        // never a guess: matching free text to a tracked job would attach the
        // result to the wrong advert.
        jobId: checkedJobId,
        provider: run.value.provider,
        model: run.value.model,
        analysis: run.value.analysis,
        now: (now ?? new Date()).toISOString(),
      });

      const saved = await analysisPort.saveAnalysis(record);
      if (!saved.ok) {
        // The result stays on screen. It is real, the user is reading it, and
        // throwing it away because a write failed would be a second failure.
        setError(`The result could not be saved to your history: ${saved.error.message}`);
        return;
      }

      setHistory((current) => [record, ...current]);
    },
    [analysisPort, consentStore, createTransport, jobText, now, session],
  );

  const onRun = useCallback(async () => {
    if (selectedCv === null || selectedOption === null) return;

    const kind = consentKindFor(selectedOption.kind);
    if (kind !== null && !consent[kind]) {
      // Blocked on the gate (Apple 5.1.2(i)): nothing is sent, and nothing has
      // started running, until the user answers.
      setPendingConsent({ option: selectedOption, kind });
      return;
    }

    await performRun(selectedOption, selectedCv);
  }, [consent, performRun, selectedCv, selectedOption]);

  /** "Send to X" in the dialog: persist the grant, then run the option it named. */
  const onConsentAccept = useCallback(async () => {
    const pending = pendingConsent;
    setPendingConsent(null);
    if (pending === null || selectedCv === null) return;

    const granted = await consentStore.grant(pending.kind);
    if (!granted.ok) {
      setError(granted.error.message);
      return;
    }
    setConsent(granted.value);
    await performRun(pending.option, selectedCv);
  }, [consentStore, pendingConsent, performRun, selectedCv]);

  /** "Not now": closes the dialog. Nothing is sent, and nothing else changes. */
  const onConsentDecline = useCallback(() => {
    setPendingConsent(null);
  }, []);

  /** The reachable half of "revocable" — see `ConsentGate.tsx`. */
  const onWithdrawConsent = useCallback(
    async (kind: ConsentProviderKind) => {
      const revoked = await consentStore.revoke(kind);
      if (revoked.ok) setConsent(revoked.value);
      else setError(revoked.error.message);
    },
    [consentStore],
  );

  const grantedConsents = (['anthropic', 'openai'] as const).filter((kind) => consent[kind]);

  // ── Rendering ────────────────────────────────────────────────────────────

  const disabledReason = runDisabledReason({
    cv: selectedCv,
    jobText,
    option: selectedOption,
    running,
  });

  const aiAvailable = options.some((option) => option.kind !== 'keyword');
  const view = viewById('analysis');

  // Recomputed, not stored: a profile that finishes loading after the run
  // should still be judged, and the gates never touch `result`.
  const gates = useMemo(
    () =>
      checkedAdvert === null
        ? null
        : runGates({
            advertText: checkedAdvert,
            languages: profile?.languages ?? [],
            workRights: profile?.work_rights ?? null,
          }),
    [checkedAdvert, profile],
  );

  // This visit's own problem first; otherwise why the last run failed, which
  // may have happened while the user was on another view.
  const shownError = error ?? runError;

  // ── The step bar (L-200) ─────────────────────────────────────────────────

  /** The tracked job the advert belongs to, if it is on the board. */
  const stepJob =
    jobId === null ? null : (jobs.find((candidate) => candidate.id === jobId) ?? null);
  const [saved, setSaved] = useState<SavedProgress>(NO_SAVED_PROGRESS);
  useEffect(() => {
    setSaved(NO_SAVED_PROGRESS);
    if (jobId === null) return;
    let cancelled = false;
    void progress.load(jobId).then((loaded) => {
      if (!cancelled) setSaved(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [jobId, progress]);

  /**
   * A job arriving brings back its own CV and engine (L-200, "pick once"),
   * once, after the CVs are read so a deleted CV is never selected. A job
   * with no choice yet keeps whatever is picked now.
   */
  const choiceAppliedFor = useRef<string | null>(null);
  useEffect(() => {
    if (jobId === null) {
      choiceAppliedFor.current = null;
      return;
    }
    if (!cvsLoaded || choiceAppliedFor.current === jobId) return;
    choiceAppliedFor.current = jobId;
    const choice = jobChoice?.(jobId) ?? null;
    if (choice === null) return;
    const current = session.get();
    const cvId =
      choice.cvId !== null && cvs.some((cv) => cv.id === choice.cvId) ? choice.cvId : null;
    if (cvId !== null && cvId !== current.selectedCvId) {
      // Another CV: a result on screen was for the one being left.
      session.supersede();
      session.update({ selectedCvId: cvId, result: null, runError: null, warnings: [] });
    }
    if (choice.optionKey !== null && choice.optionKey !== current.optionKey) {
      session.update({ optionKey: choice.optionKey });
    }
  }, [cvs, cvsLoaded, jobChoice, jobId, session]);

  /** What "Tailor my CV for this job" hands over — the same, whichever button. */
  const tailorHandoff = useCallback(
    (): TailorHandoff => ({
      jobId,
      jobText,
      cvId: selectedCvId,
      optionKey,
      // The gaps this result found, for the advert it CHECKED (L-202). Never
      // `missing_skills`: see `gapsFromAnalysis`.
      keywordGaps:
        result === null ? null : gapsFromAnalysis(result.analysis, selectedCvId, checkedAdvert),
    }),
    [checkedAdvert, jobId, jobText, optionKey, result, selectedCvId],
  );

  const onBarStep = useCallback(
    (step: StepId) => {
      if (step === 'analyse' || stepJob === null) return;
      onJobStep?.(step, stepJob, tailorHandoff());
    },
    [onJobStep, stepJob, tailorHandoff],
  );

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="view-analysis">
      {/*
        No `action` here. The view's one primary button belongs beside the
        composer it acts on, next to the sentence explaining why it is disabled
        — a Run button in the corner, four inches from the advert box and from
        its own reason, is a button nobody connects to anything.
      */}
      <ViewHeader title={view.label} summary={view.summary} />

      {stepJob === null ? null : (
        <JobStepBar
          title={stepJob.title}
          company={stepJob.company}
          location={stepJob.location}
          current="analyse"
          choice={{ cv: selectedCv?.name ?? null, engine: selectedOption?.label ?? null }}
          progress={{
            // A result on screen is this job's: loading another job clears it.
            analysed: saved.analysed || result !== null,
            tailored: tailoredJob?.(stepJob.id) ?? false,
            exported: saved.exported,
          }}
          onStep={onBarStep}
          onTracker={onTracker}
        />
      )}

      {shownError === null ? null : (
        <p
          role="alert"
          data-testid="analysis-error"
          className="border-b border-danger/30 bg-danger/5 px-4 py-2 text-danger md:px-6"
        >
          {shownError}
        </p>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 min-w-0 flex-1 space-y-5 overflow-y-auto px-4 py-4 md:px-6 md:py-5">
          {/* ── 1. The CV ─────────────────────────────────────────────── */}
          <div>
            <label htmlFor="analysis-cv" className="block text-xs font-medium text-ink-muted">
              Your CV
            </label>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <select
                id="analysis-cv"
                data-testid="analysis-cv"
                value={selectedCvId ?? ''}
                disabled={cvs.length === 0 || !cvsLoaded}
                onChange={(event) => {
                  const id = event.currentTarget.value;
                  // A run still in flight was for the CV being left: dropped.
                  session.supersede();
                  session.update({
                    selectedCvId: id === '' ? null : id,
                    result: null,
                    runError: null,
                    warnings: [],
                  });
                  setUploadProblem(null);
                  setExportMessage(null);
                  // Picked once, for the job (L-200).
                  if (stepJob !== null) onJobChoice?.(stepJob, { cvId: id === '' ? null : id });
                }}
                className="min-w-0 flex-1 rounded-control border border-field-line bg-card px-2.5 py-1.5 text-ink"
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

              <button
                type="button"
                data-testid="analysis-upload"
                onClick={() => void onUpload()}
                className={SECONDARY_BUTTON}
              >
                Upload a CV
              </button>

              {/*
                Disabled, never hidden, for a CV that came from a PDF or a
                .docx: there is no JSON Resume to give back for those, and a
                control that comes and goes is one the user cannot learn.
              */}
              <button
                type="button"
                data-testid="analysis-save-json"
                disabled={selectedCv === null || selectedCv.json_resume === null || exporting}
                title={
                  selectedCv !== null && selectedCv.json_resume === null
                    ? 'Only a CV that arrived as a JSON Resume can be saved as one.'
                    : undefined
                }
                onClick={() => void onSaveJsonResume()}
                className={SECONDARY_BUTTON}
              >
                {exporting ? 'Saving…' : 'Save as JSON Resume'}
              </button>
            </div>

            <p className="mt-1 text-xs text-ink-faint">
              PDF, Word (.docx) or JSON Resume (.json). The file is read on this machine and never
              uploaded anywhere. A CV that arrived as a JSON Resume can be saved back out as one,
              unchanged, to take anywhere that reads the format.
            </p>

            {exportMessage === null ? null : (
              <p
                role="status"
                data-testid="analysis-export-message"
                className="mt-2 rounded-control bg-teal/10 px-3 py-2 break-all text-teal-ink"
              >
                {exportMessage}
              </p>
            )}

            {uploadProblem === null ? null : (
              <p
                role="alert"
                data-testid="analysis-upload-problem"
                className="mt-2 rounded-control bg-danger/5 px-3 py-2 text-danger"
              >
                {uploadProblem}
              </p>
            )}

            {warnings.length === 0 ? null : (
              <ul
                data-testid="analysis-cv-warnings"
                className="mt-2 space-y-1 rounded-control bg-gold/10 px-3 py-2 text-gold-ink"
              >
                {warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            )}
          </div>

          {/* ── 2. The advert ─────────────────────────────────────────── */}
          <div>
            {/*
              What came with a job handed over from Search (L-190) — usually
              that only a preview of the advert arrived. ABOVE the box, because
              it is about what is in the box and has to be read first; gold,
              because it is something to act on, not a failure.
            */}
            {jobNote === null ? null : (
              <p
                role="status"
                data-testid="analysis-job-note"
                className="mb-2 rounded-control bg-gold/10 px-3 py-2 text-gold-ink"
              >
                {jobNote}
              </p>
            )}
            <label htmlFor="analysis-job-text" className="block text-xs font-medium text-ink-muted">
              The job advert
            </label>
            <textarea
              id="analysis-job-text"
              data-testid="analysis-job-text"
              rows={7}
              value={jobText}
              placeholder="Paste the whole advert, including the requirements list."
              onChange={(event) => {
                const value = event.currentTarget.value;
                // Still that job while there is an advert in the box — pasting
                // the full advert over a preview is the edit the note asks for.
                // An empty box belongs to nothing.
                session.update(
                  value === '' ? { jobText: '', jobId: null, jobNote: null } : { jobText: value },
                );
              }}
              className="mt-1 w-full rounded-control border border-field-line bg-card px-2.5 py-1.5 text-ink"
            />

            {jobs.length === 0 ? null : (
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <label htmlFor="analysis-job-pick" className="text-xs text-ink-faint">
                  Or use one you are already tracking
                </label>
                <select
                  id="analysis-job-pick"
                  data-testid="analysis-job-pick"
                  value=""
                  onChange={(event) => {
                    const job = jobs.find(
                      (candidate) => candidate.id === event.currentTarget.value,
                    );
                    if (job !== undefined) {
                      session.update({ jobText: jobAdvertText(job), jobId: job.id, jobNote: null });
                    }
                  }}
                  className="min-w-0 flex-1 rounded-control border border-field-line bg-card px-2.5 py-1 text-ink"
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

          {/* ── 3. How to run it ──────────────────────────────────────── */}
          <div>
            <label htmlFor="analysis-provider" className="block text-xs font-medium text-ink-muted">
              How to check it
            </label>
            <select
              id="analysis-provider"
              data-testid="analysis-provider"
              value={optionKey}
              onChange={(event) => {
                const picked = event.currentTarget.value;
                session.update({ optionKey: picked });
                // Picked once, for the job (L-200).
                if (stepJob !== null) onJobChoice?.(stepJob, { optionKey: picked });
              }}
              className="mt-1 w-full rounded-control border border-field-line bg-card px-2.5 py-1.5 text-ink"
            >
              {options.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
            <p data-testid="analysis-provider-note" className="mt-1 text-xs text-ink-faint">
              {selectedOption?.note ?? 'Choose how to run this.'}
            </p>

            {/*
              Shown in ONE state only: the daemon answered and nothing in it can
              chat. Not an error — gold, because it is something the user can
              act on — and it carries the exact command, because "no chat models
              found" on its own is a dead end in an app with no support inbox.
            */}
            {localModelHint === null ? null : (
              <p
                data-testid="analysis-ollama-hint"
                className="mt-2 rounded-control bg-gold/10 px-3 py-2 text-xs text-gold-ink"
              >
                {localModelHint}
              </p>
            )}

            {/*
              Reachable regardless of which option is currently picked — a
              consent granted earlier must stay visible and revocable even
              after switching to Ollama or the basic match. See
              `ConsentGate.tsx` for why this lives here and not in Settings.
            */}
            <ConsentStatus
              granted={grantedConsents}
              onWithdraw={(kind) => void onWithdrawConsent(kind)}
            />
          </div>

          {/* ── 4. Run ────────────────────────────────────────────────── */}
          <div className="flex items-center gap-3">
            {/*
              The view's ONE blue button. Disabled, never hidden — and the
              reason is right next to it, because a grey button that says
              nothing is where a user's session ends.
            */}
            <button
              type="button"
              data-testid="analysis-run"
              data-primary="true"
              disabled={disabledReason !== null}
              onClick={() => void onRun()}
              className={PRIMARY_BUTTON}
            >
              {running ? 'Checking…' : 'Check this CV'}
            </button>

            <button
              type="button"
              data-testid="analysis-history-open"
              disabled={selectedCv === null || historyOpen}
              onClick={() => setHistoryOpen(true)}
              className={SECONDARY_BUTTON}
            >
              Past checks <span className="font-mono tabular-nums">({history.length})</span>
            </button>

            {disabledReason === null ? null : (
              <p data-testid="analysis-run-reason" className="text-ink-muted">
                {disabledReason}
              </p>
            )}
          </div>

          {running && selectedOption !== null && selectedOption.kind !== 'keyword' ? (
            <p
              data-testid="analysis-progress"
              role="status"
              className="rounded-control bg-sunken px-3 py-2 text-ink-muted"
            >
              {selectedOption.local
                ? `Asking ${selectedOption.model} on this machine. The first run after starting ` +
                  'your PC loads the model into memory, which takes 5 to 30 seconds. Nothing is ' +
                  'being sent anywhere.'
                : `Sending your CV and the advert to ${providerLabel(selectedOption.kind)}. ` +
                  'This usually takes a few seconds.'}{' '}
              <span className="font-mono tabular-nums">{elapsed}s</span>
            </p>
          ) : null}

          {/* ── 5. The result ─────────────────────────────────────────── */}
          {result === null ? (
            <div
              data-testid="analysis-empty"
              className="rounded-card border border-line border-dashed bg-card px-6 py-8 text-center"
            >
              <p className="font-medium text-ink">Nothing checked yet.</p>
              {/* cviper-allow-absolute-privacy-claim: the sentence names its own
                  subject — "The basic match" — which is the keyword scorer in
                  packages/keyword-scoring and reaches no network at all. */}
              <p className="mt-1 text-ink-muted">
                Pick a CV, paste an advert, and press the button. The basic match needs no account
                and no API key, and nothing leaves this machine.
              </p>
            </div>
          ) : (
            <>
              {/* Before the score, never in it — see `GateNotice.tsx`. */}
              {gates === null ? null : <GateNotice results={gates} />}
              <AnalysisResult
                analysis={result.analysis}
                provider={result.provider}
                model={result.model}
                retried={result.retried}
                aiAvailable={aiAvailable}
                atsKeywordScore={result.atsKeywordScore}
              />
              {/*
                The next step of the flow (L-190), after the result it follows
                from. Secondary: the view's one blue button is the check.
              */}
              {onTailor === undefined ? null : (
                <div>
                  <button
                    type="button"
                    data-testid="analysis-to-tailor"
                    onClick={() => onTailor(tailorHandoff())}
                    className={SECONDARY_BUTTON}
                  >
                    Tailor my CV for this job
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {historyOpen && selectedCv !== null ? (
          <DetailPane
            title="Past checks"
            subtitle={selectedCv.name}
            onClose={() => setHistoryOpen(false)}
          >
            {history.length === 0 ? (
              <p data-testid="analysis-history-empty" className="text-ink-muted">
                This CV has not been checked against anything yet.
              </p>
            ) : (
              <ul data-testid="analysis-history" className="space-y-2">
                {history.map((row) => (
                  <li
                    key={row.id}
                    data-testid="analysis-history-row"
                    className="flex items-baseline justify-between gap-2 rounded-card border border-line px-3 py-2"
                  >
                    <span className="min-w-0">
                      <span className="block font-medium text-ink">
                        {providerLabel(row.provider)}
                      </span>
                      <span className="block font-mono text-xs tabular-nums text-ink-faint">
                        {row.created_at.slice(0, 10)}
                      </span>
                    </span>
                    <span className="font-mono text-lg tabular-nums text-ink">
                      {row.match_score}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </DetailPane>
        ) : null}
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
