import { useCallback, useEffect, useMemo, useState } from 'react';

import { extractText } from '@cviper/cv-parsing';
import {
  type Analysis as AnalysisRow,
  type Cv,
  type CvAnalysis,
  type Job,
} from '@cviper/core-types';

import { PRIMARY_BUTTON, SECONDARY_BUTTON } from '../../app/buttons';
import { DetailPane } from '../../app/DetailPane';
import { ViewHeader } from '../../app/ViewHeader';
import { viewById } from '../../app/views';
import { createTauriTransport } from '../../ai/transport';
import { createTauriFilePort, type FilePort } from '../../platform/files';

import { AnalysisResult } from './AnalysisResult';
import { readAvailability } from './availability';
import {
  jobAdvertText,
  newAnalysisRecord,
  newCvRecord,
  providerLabel,
  runDisabledReason,
} from './model';
import { createDbAnalysisPort, type AnalysisPort } from './port';
import {
  KEYWORD_KEY,
  defaultOptionKey,
  ollamaHint,
  optionByKey,
  providerOptions,
} from './providers';
import { runAnalysis } from './runAnalysis';
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

interface RunResult {
  readonly analysis: CvAnalysis;
  readonly provider: string;
  readonly model: string;
  readonly retried: boolean;
}

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
}

export function Analysis({ port, filePort, createTransport, now }: AnalysisProps = {}) {
  // Created once. A new port object every render would restart the load effect
  // on every keystroke in the advert box.
  const analysisPort = useMemo(() => port ?? createDbAnalysisPort(), [port]);
  const files = useMemo(() => filePort ?? createTauriFilePort(), [filePort]);

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
  const [selectedCvId, setSelectedCvId] = useState<string | null>(null);
  const [jobText, setJobText] = useState('');
  const [optionKey, setOptionKey] = useState<string>(KEYWORD_KEY);
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
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<RunResult | null>(null);
  const [history, setHistory] = useState<readonly AnalysisRow[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadProblem, setUploadProblem] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<readonly string[]>([]);

  // ── Loading ──────────────────────────────────────────────────────────────

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
      setSelectedCvId((current) => current ?? loaded.value[0]?.id ?? null);
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
  }, [analysisPort]);

  useEffect(() => {
    let cancelled = false;

    void readAvailability().then((availability) => {
      if (cancelled) return;
      const next = providerOptions(availability);
      setOptions(next);
      setOptionKey(defaultOptionKey(next));
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

    const extracted = await extractText(picked.value.name, picked.value.bytes);
    if (!extracted.ok) {
      // VERBATIM. Every message in `@cviper/cv-parsing` says what happened, why,
      // and what to do — "that PDF has 2 pages but no readable text at all,
      // which means it is almost certainly a scan". Replacing that with "could
      // not read file" throws away the only useful thing on the screen.
      setUploadProblem(extracted.error.message);
      setWarnings([]);
      return;
    }

    const cv = newCvRecord({
      id: crypto.randomUUID(),
      name: picked.value.name,
      path: picked.value.path,
      text: extracted.value.text,
      now: (now ?? new Date()).toISOString(),
    });

    const saved = await analysisPort.saveCv(cv);
    if (!saved.ok) {
      setError(`That CV could not be saved: ${saved.error.message} Try again.`);
      return;
    }

    setCvs((current) => [cv, ...current]);
    setSelectedCvId(cv.id);
    setResult(null);
    // Warnings ride along with a SUCCESSFUL extraction — some pages were images
    // and their contents are missing from the text. The user has to be told,
    // because the analysis below is about to be run on a partial CV.
    setWarnings(extracted.value.warnings);
  }, [analysisPort, files, now]);

  const onRun = useCallback(async () => {
    if (selectedCv === null || selectedOption === null) return;

    setError(null);
    setRunning(true);
    setElapsed(0);

    const run = await runAnalysis(
      {
        option: selectedOption,
        cvText: selectedCv.extracted_text ?? '',
        jobText,
      },
      // Passed, never called here. The keyword path returns before it asks the
      // factory for anything, which is what makes "the basic match cannot reach
      // the network" a provable statement rather than an intention.
      createTransport ?? createTauriTransport,
    );

    setRunning(false);

    if (!run.ok) {
      setResult(null);
      setError(run.error.message);
      return;
    }

    setResult(run.value);

    const record = newAnalysisRecord({
      id: crypto.randomUUID(),
      cvId: selectedCv.id,
      // Not wired to a specific job yet: the advert is free text, and guessing
      // which tracked job it came from would attach the result to the wrong
      // advert. `job_id` is nullable precisely for this.
      jobId: null,
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
  }, [analysisPort, createTransport, jobText, now, selectedCv, selectedOption]);

  // ── Rendering ────────────────────────────────────────────────────────────

  const disabledReason = runDisabledReason({
    cv: selectedCv,
    jobText,
    option: selectedOption,
    running,
  });

  const aiAvailable = options.some((option) => option.kind !== 'keyword');
  const view = viewById('analysis');

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="view-analysis">
      {/*
        No `action` here. The view's one primary button belongs beside the
        composer it acts on, next to the sentence explaining why it is disabled
        — a Run button in the corner, four inches from the advert box and from
        its own reason, is a button nobody connects to anything.
      */}
      <ViewHeader title={view.label} summary={view.summary} />

      {error === null ? null : (
        <p
          role="alert"
          data-testid="analysis-error"
          className="border-b border-danger/30 bg-danger/5 px-6 py-2 text-danger"
        >
          {error}
        </p>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 min-w-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {/* ── 1. The CV ─────────────────────────────────────────────── */}
          <div>
            <label htmlFor="analysis-cv" className="block text-xs font-medium text-ink-muted">
              Your CV
            </label>
            <div className="mt-1 flex items-center gap-2">
              <select
                id="analysis-cv"
                data-testid="analysis-cv"
                value={selectedCvId ?? ''}
                disabled={cvs.length === 0 || !cvsLoaded}
                onChange={(event) => {
                  const id = event.currentTarget.value;
                  setSelectedCvId(id === '' ? null : id);
                  setResult(null);
                  setWarnings([]);
                  setUploadProblem(null);
                }}
                className="min-w-0 flex-1 rounded-control border border-line bg-card px-2.5 py-1.5 text-ink"
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
            </div>

            <p className="mt-1 text-xs text-ink-faint">
              PDF or Word (.docx). The file is read on this machine and never uploaded anywhere.
            </p>

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
                className="mt-2 space-y-1 rounded-control bg-gold/10 px-3 py-2 text-gold"
              >
                {warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            )}
          </div>

          {/* ── 2. The advert ─────────────────────────────────────────── */}
          <div>
            <label htmlFor="analysis-job-text" className="block text-xs font-medium text-ink-muted">
              The job advert
            </label>
            <textarea
              id="analysis-job-text"
              data-testid="analysis-job-text"
              rows={7}
              value={jobText}
              placeholder="Paste the whole advert, including the requirements list."
              onChange={(event) => setJobText(event.currentTarget.value)}
              className="mt-1 w-full rounded-control border border-line bg-card px-2.5 py-1.5 text-ink"
            />

            {jobs.length === 0 ? null : (
              <div className="mt-1 flex items-center gap-2">
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
                    if (job !== undefined) setJobText(jobAdvertText(job));
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

          {/* ── 3. How to run it ──────────────────────────────────────── */}
          <div>
            <label htmlFor="analysis-provider" className="block text-xs font-medium text-ink-muted">
              How to check it
            </label>
            <select
              id="analysis-provider"
              data-testid="analysis-provider"
              value={optionKey}
              onChange={(event) => setOptionKey(event.currentTarget.value)}
              className="mt-1 w-full rounded-control border border-line bg-card px-2.5 py-1.5 text-ink"
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
                className="mt-2 rounded-control bg-gold/10 px-3 py-2 text-xs text-gold"
              >
                {localModelHint}
              </p>
            )}
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
            <AnalysisResult
              analysis={result.analysis}
              provider={result.provider}
              model={result.model}
              retried={result.retried}
              aiAvailable={aiAvailable}
            />
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
    </section>
  );
}
