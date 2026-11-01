import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import { type Analysis as AnalysisRow, type Cv, type Job, type Result } from '@cviper/core-types';
import { runGates } from '@cviper/keyword-scoring';

import { SECONDARY_BUTTON } from '../../app/buttons';
import { CONTENT_COLUMN } from '../../app/layout';
import { ViewHeader } from '../../app/ViewHeader';
import { viewById } from '../../app/views';
import { IconTile } from '../../ui';
import { createTauriTransport } from '../../ai/transport';
import {
  createTauriFilePort,
  type FileError,
  type FilePort,
  type PickedCv,
} from '../../platform/files';

import { createDbProfilePort, type ProfilePort } from '../profile/port';

import { createTauriBrowserPort, type BrowserPort } from '../../platform/browser';

import { AnalysisAdvert } from './AnalysisAdvert';
import { AnalysisCvPicker } from './AnalysisCvPicker';
import { AnalysisEngine } from './AnalysisEngine';
import { AnalysisHistory } from './AnalysisHistory';
import { AnalysisResult } from './AnalysisResult';
import { AnalysisRunBar } from './AnalysisRunBar';
import { AnalysisSample } from './AnalysisSample';
import { ConsentGate } from './ConsentGate';
import { cvCutNote } from './cvCutNote';
import { GateNotice } from './GateNotice';
import {
  createTauriConsentPort,
  isCloudKind,
  NO_CONSENT,
  type ConsentPort,
  type ConsentProviderKind,
  type ConsentState,
} from './consent';
import { jobAdvertText, newAnalysisRecord, providerInSentence, runDisabledReason } from './model';
import { createDbAnalysisPort, type AnalysisPort } from './port';
import { defaultOptionKey, optionByKey, type ProviderOption } from './providers';
import { runAnalysis } from './runAnalysis';
import { runSample, type SampleResult } from './sample';
import { createAnalysisSession, type AnalysisSession } from './session';
import { useAnalysisCvFiles } from './useAnalysisCvFiles';
import { useAnalysisLibrary } from './useAnalysisLibrary';
import { useAnalysisStepBar } from './useAnalysisStepBar';
import { type TailorHandoff } from '../flow/handoff';
import { JobStepBar } from '../flow/JobStepBar';
import { NO_SAVED_PROGRESS, createDbJobProgressPort, type JobProgressPort } from '../flow/progress';
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
 *
 * ============================================================================
 * WHERE THE PIECES LIVE (L-306)
 * ============================================================================
 * This file owns the run, the consent gate in front of it and the result. Each
 * input panel is its own component (`AnalysisCvPicker`, `AnalysisAdvert`,
 * `AnalysisEngine`, `AnalysisRunBar`), as are the sample and past checks; what
 * the screen reads on opening is `useAnalysisLibrary`, CV files in and out are
 * `useAnalysisCvFiles`, and the step bar is `useAnalysisStepBar`. The run stays
 * HERE on purpose: `ai-call-sites-consent.contract.test.ts` names this file as
 * the one that hands the transport to `runAnalysis`.
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
   * Opens Ollama's download page beside the Ollama hint (L-240). Injected by
   * tests; defaults to the real one, which hands the address to the browser.
   */
  readonly browser?: BrowserPort | undefined;
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
  browser,
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
  const browserPort = useMemo(() => browser ?? createTauriBrowserPort(), [browser]);
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

  const [elapsed, setElapsed] = useState(0);
  const [history, setHistory] = useState<readonly AnalysisRow[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The one-click sample (L-277): shown and forgotten, never saved. */
  const [sample, setSample] = useState<SampleResult | null>(null);
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

  const { cvs, setCvs, cvsLoaded, jobs, options, localModelHint, profile } = useAnalysisLibrary({
    analysisPort,
    profiles,
    session,
    setError,
  });

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

  const { exportMessage, exporting, uploadProblem, clearCvMessages, onUpload, onSaveJsonResume } =
    useAnalysisCvFiles({
      analysisPort,
      files,
      now,
      session,
      selectedCv,
      incomingCv,
      onIncomingCvHandled,
      setCvs,
      setError,
    });

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

  const { stepJob, saved, tailorHandoff, onBarStep } = useAnalysisStepBar({
    session,
    progress,
    jobs,
    cvs,
    cvsLoaded,
    jobId,
    jobText,
    selectedCvId,
    optionKey,
    result,
    checkedAdvert,
    jobChoice,
    onJobStep,
  });

  /** Said by the picker when the chosen AI will not read the whole CV (L-302). */
  const cvCut = cvCutNote(selectedCv?.extracted_text ?? null, selectedOption?.kind ?? null);

  /** What the run is doing, in words: shown with a counter, and spoken (L-299). */
  const progressText =
    running && selectedOption !== null && selectedOption.kind !== 'keyword'
      ? selectedOption.local
        ? `Asking ${selectedOption.model} on this machine. The first run after starting ` +
          'your PC loads the model into memory, which takes 5 to 30 seconds. Nothing is ' +
          'being sent anywhere.'
        : `Sending your CV and the advert to ${providerInSentence(selectedOption.kind)}. ` +
          'This usually takes a few seconds.'
      : null;

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="view-analysis">
      {/*
        No `action` here. The view's one primary button belongs beside the
        composer it acts on, next to the sentence explaining why it is disabled
        — a Run button in the corner, four inches from the advert box and from
        its own reason, is a button nobody connects to anything.
      */}
      <ViewHeader view={view.id} title={view.label} summary={view.summary} />

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
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-5">
          <div data-content-column className={`${CONTENT_COLUMN} space-y-5`}>
            <AnalysisCvPicker
              cvs={cvs}
              cvsLoaded={cvsLoaded}
              selectedCvId={selectedCvId}
              selectedCv={selectedCv}
              onPick={(id) => {
                // A run still in flight was for the CV being left: dropped.
                session.supersede();
                session.update({ selectedCvId: id, result: null, runError: null, warnings: [] });
                clearCvMessages();
                // Picked once, for the job (L-200).
                if (stepJob !== null) onJobChoice?.(stepJob, { cvId: id });
              }}
              onUpload={() => void onUpload()}
              onSaveJsonResume={() => void onSaveJsonResume()}
              exporting={exporting}
              exportMessage={exportMessage}
              uploadProblem={uploadProblem}
              warnings={warnings}
            />

            <AnalysisAdvert
              jobNote={jobNote}
              jobText={jobText}
              onJobTextChange={(value) =>
                // Still that job while there is an advert in the box — pasting
                // the full advert over a preview is the edit the note asks for.
                // An empty box belongs to nothing.
                session.update(
                  value === '' ? { jobText: '', jobId: null, jobNote: null } : { jobText: value },
                )
              }
              jobs={jobs}
              onPickJob={(job) =>
                session.update({ jobText: jobAdvertText(job), jobId: job.id, jobNote: null })
              }
            />

            <AnalysisEngine
              options={options}
              optionKey={optionKey}
              selectedOption={selectedOption}
              onOptionChange={(picked) => {
                session.update({ optionKey: picked });
                // Picked once, for the job (L-200).
                if (stepJob !== null) onJobChoice?.(stepJob, { optionKey: picked });
              }}
              cvCut={cvCut}
              localModelHint={localModelHint}
              browser={browserPort}
              grantedConsents={grantedConsents}
              onWithdrawConsent={(kind) => void onWithdrawConsent(kind)}
            />

            <AnalysisRunBar
              running={running}
              disabledReason={disabledReason}
              onRun={() => void onRun()}
              historyCount={history.length}
              historyDisabled={selectedCv === null || historyOpen}
              onOpenHistory={() => setHistoryOpen(true)}
              progressText={progressText}
              elapsed={elapsed}
            />

            {/* ── 5. The result ─────────────────────────────────────────── */}
            {result === null ? (
              <div
                data-testid="analysis-empty"
                className="rounded-card border border-line border-dashed bg-card px-6 py-8 text-center"
              >
                <div className="mb-3 flex justify-center">
                  <IconTile icon="analysis" />
                </div>
                <p className="font-medium text-ink">Nothing checked yet.</p>
                {/* cviper-allow-absolute-privacy-claim: the sentence names its own
                    subject — "The basic match" — which is the keyword scorer in
                    packages/keyword-scoring and reaches no network at all. */}
                <p className="mt-1 text-ink-muted">
                  Pick a CV, paste an advert, and press the button. The basic match needs no account
                  and no set-up, and nothing leaves this machine.
                </p>
                {/*
                  L-277: before the user has a CV, one click shows what a check
                  gives back. Secondary, so the view keeps its one blue button.
                  Only while there is no CV: after that the real thing is right
                  there and a sample would be in the way.
                */}
                {cvsLoaded && cvs.length === 0 && sample === null ? (
                  <button
                    type="button"
                    data-testid="analysis-try-sample"
                    onClick={() => setSample(runSample())}
                    className={`${SECONDARY_BUTTON} mt-4`}
                  >
                    Try it with a sample CV
                  </button>
                ) : null}
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
                  // L-290. The result is always the selected CV's: switching CV
                  // clears it (see the CV picker's handler).
                  cvText={selectedCv?.extracted_text ?? undefined}
                  // L-291: the advert this result CHECKED, not the box's current text.
                  advertText={checkedAdvert ?? undefined}
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

            {sample !== null && result === null ? (
              <AnalysisSample
                sample={sample}
                aiAvailable={aiAvailable}
                onHide={() => setSample(null)}
              />
            ) : null}
          </div>
        </div>

        {historyOpen && selectedCv !== null ? (
          <AnalysisHistory
            cvName={selectedCv.name}
            history={history}
            onClose={() => setHistoryOpen(false)}
          />
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
