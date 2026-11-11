import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  type ApplicationStatus,
  type InterviewSubstage,
  type Job,
  type Result,
} from '@cviper/core-types';

import { type ChatTransport } from '@cviper/ai-providers';

import { ViewHeader } from '../../app/ViewHeader';
import { createTauriBrowserPort, type BrowserPort } from '../../platform/browser';
import { todayIsoDate } from '../../lib/dates';
import { viewById } from '../../app/views';

import { readAvailability as readRealAvailability } from '../analysis/availability';
import { type ConsentPort } from '../analysis/consent';
import { type Availability } from '../analysis/providers';
import {
  NO_SAVED_PROGRESS,
  createDbBoardProgressPort,
  type BoardProgressPort,
  type SavedProgress,
} from '../flow/progress';
import { type JobProgress, type StepId } from '../flow/steps';

import { FunnelStrip } from './FunnelStrip';
import { type PageFetchTransport } from './pageFetch';
import { TrackerAlerts } from './TrackerAlerts';
import { TrackerBoard } from './TrackerBoard';
import { AddApplicationButton, PasteJobButton } from './TrackerButtons';
import { EmptyBoard } from './TrackerEmptyBoard';
import { TrackerSidePane, type Pane } from './TrackerSidePane';
import {
  createEntry,
  groupByStatus,
  withEdit,
  withStatus,
  withSubstage,
  type ApplicationDraft,
  type TrackerEntry,
} from './model';
import { createDbTrackerPort, type TrackerPort } from './port';

/**
 * The application tracker: five columns, one card per application.
 *
 * ============================================================================
 * WHAT THE BOARD IS FOR
 * ============================================================================
 * Not a dashboard. A LEDGER of an ongoing campaign, months long, dozens of
 * applications, that nobody but the user ever sees. Its single job is to answer
 * "where do I stand, and what has gone quiet" — which is why the column tells
 * you the status and the left edge of every card tells you the age.
 *
 * ============================================================================
 * IT WORKS WITH NOTHING CONFIGURED
 * ============================================================================
 * No API key, no Ollama, no network. Everything here is local SQLite through
 * `TrackerPort`, and `tracker.zeroKeys.test.tsx` drives the whole loop with
 * every credential absent and asserts that no provider transport is touched.
 * That is a promise in the product description, and this is the part of the
 * product that keeps it.
 *
 * ============================================================================
 * THE ONE MOTION
 * ============================================================================
 * A card that changes status gets `cviper-card-settle` for 200ms as it appears
 * in its new column, and nothing else in the app moves at all. See theme.css,
 * where `prefers-reduced-motion` removes even that.
 */

/** How long the settle animation runs. Matches the keyframe in theme.css. */
const SETTLE_MS = 200;

export interface TrackerProps {
  /**
   * Injected by tests. Defaults to the real SQLite-backed port — a component
   * that reached into `src/db` directly could only be tested by pretending to
   * be SQLite.
   */
  readonly port?: TrackerPort | undefined;
  /**
   * Injected by tests so "today" and every age are deterministic.
   *
   * `| undefined` on both is not noise: `exactOptionalPropertyTypes` is on, so
   * "absent" and "present but undefined" are different types, and the shell
   * forwards these straight through from its own optional props.
   */
  readonly now?: Date | undefined;
  /**
   * The shell owns which view is showing, so "no AI provider — open Settings"
   * has to come back here to be acted on. Same arrangement as `Search`.
   */
  readonly onOpenSettings?: (() => void) | undefined;
  /**
   * Injected by tests so a fake provider can answer the paste flow without a
   * socket. Left undefined in the app, where `runExtraction` builds the real
   * Tauri transport — and never builds one at all until Extract is pressed.
   */
  readonly createTransport?: (() => ChatTransport) | undefined;
  /**
   * Injected by tests so a fake page can answer the fetch-from-a-link flow
   * without a socket. Left undefined in the app, where `runFetch` builds the
   * real Tauri transport — and never builds one at all for an address it has
   * already decided not to fetch.
   */
  readonly createPageTransport?: (() => PageFetchTransport) | undefined;
  /** Injected by tests so the machine's real credentials are never consulted. */
  readonly readAvailability?: (() => Promise<Availability>) | undefined;
  /**
   * Injected by tests. Defaults to the real store-backed port, shared with
   * every other consent screen (L-141, L-171). Forwarded to the paste form and
   * to the detail pane's follow-up and interview panels.
   */
  readonly consentPort?: ConsentPort | undefined;
  /** Injected by tests: the real one opens the user's browser at the advert. */
  readonly browser?: BrowserPort | undefined;
  /**
   * "Analyse this job" and "Tailor my CV" on an application (L-190). The shell
   * owns which view is showing, so the entry goes back to it — the same
   * arrangement as `onOpenSettings`. Left undefined, no button is drawn.
   *
   * No page is fetched from here, unlike from a search result: a job on the
   * board holds the advert the user pasted or saved, and the pane already has
   * the route to fix a thin one — open the advert and paste it on Analysis.
   */
  readonly onAnalyse?: ((entry: TrackerEntry) => void) | undefined;
  readonly onTailor?: ((entry: TrackerEntry) => void) | undefined;
  /**
   * Where the cards' ●●●○○ come from (L-200). Left undefined, the database —
   * unless the tracker port was injected, when a faked data layer gets no
   * real reads behind it.
   */
  readonly boardProgressPort?: BoardProgressPort | undefined;
  /** Whether a job has a tailored draft — the Tailor sessions, read by the shell. */
  readonly tailoredJob?: ((jobId: string) => boolean) | undefined;
  /** "Continue" under a started job's card: the shell takes the user to that step. */
  readonly onContinue?: ((job: Job, step: StepId) => void) | undefined;
}

export function Tracker({
  port,
  now,
  onOpenSettings,
  createTransport,
  createPageTransport,
  readAvailability,
  browser,
  consentPort,
  onAnalyse,
  onTailor,
  boardProgressPort,
  tailoredJob,
  onContinue,
}: TrackerProps) {
  // Created once. A new port object every render would restart the load effect
  // on every keystroke.
  const trackerPort = useMemo(() => port ?? createDbTrackerPort(), [port]);
  const browserPort = useMemo(() => browser ?? createTauriBrowserPort(), [browser]);
  const clock = useMemo(() => now ?? new Date(), [now]);
  const today = todayIsoDate(clock);

  const [entries, setEntries] = useState<readonly TrackerEntry[]>([]);

  // ── Each job's steps (L-200) ─────────────────────────────────────────────
  const boardProgress = useMemo<BoardProgressPort>(
    () =>
      boardProgressPort ??
      (port === undefined ? createDbBoardProgressPort() : { loadAll: async () => new Map() }),
    [boardProgressPort, port],
  );
  const [savedProgress, setSavedProgress] = useState<ReadonlyMap<string, SavedProgress>>(
    () => new Map(),
  );
  // Re-read whenever the board changes: a card added, moved or removed may
  // have brought or taken a saved CV with it.
  useEffect(() => {
    let cancelled = false;
    void boardProgress.loadAll().then((loaded) => {
      if (!cancelled) setSavedProgress(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [boardProgress, entries]);
  const progressFor = useCallback(
    (entry: TrackerEntry): JobProgress => {
      const saved = savedProgress.get(entry.job.id) ?? NO_SAVED_PROGRESS;
      return {
        analysed: saved.analysed,
        tailored: tailoredJob?.(entry.job.id) ?? false,
        exported: saved.exported,
      };
    },
    [savedProgress, tailoredJob],
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadInProgress = useRef(false);
  const loadRequest = useRef(0);
  const [pane, setPane] = useState<Pane>({ kind: 'closed' });
  const [settlingId, setSettlingId] = useState<string | null>(null);
  /**
   * The user's interview sub-stages (L-205), and whether they were READ.
   *
   * The second matters more than it looks. Saving replaces the stored list with
   * this one, so editing after a failed read would write an empty list over the
   * real one. Until `substagesLoaded`, nothing that edits them is offered.
   */
  const [substages, setSubstages] = useState<readonly InterviewSubstage[]>([]);
  const [substagesLoaded, setSubstagesLoaded] = useState(false);
  /** Why the list could not be read, or null. */
  const [substagesFailed, setSubstagesFailed] = useState<string | null>(null);
  const substagesRef = useRef<readonly InterviewSubstage[]>([]);
  /** One sub-stage save at a time. A ref as well as state: the check must be synchronous. */
  const savingSubstagesRef = useRef(false);
  const [savingSubstages, setSavingSubstages] = useState(false);
  /**
   * What this machine can offer the detail pane's AI panels. `null` until the
   * first card is opened: the probe (Ollama's port, the credential store) is
   * not paid for by a board that is only being read, and it is paid once.
   */
  const [availability, setAvailability] = useState<Availability | null>(null);
  const probe = useMemo(() => readAvailability ?? readRealAvailability, [readAvailability]);

  useEffect(() => {
    if (pane.kind !== 'entry' || availability !== null) return;
    let cancelled = false;
    void probe().then((found) => {
      if (!cancelled) setAvailability(found);
    });
    return () => {
      cancelled = true;
    };
  }, [availability, pane.kind, probe]);

  const loadEntries = useCallback(async () => {
    if (loadInProgress.current) return;
    loadInProgress.current = true;
    const request = ++loadRequest.current;
    setLoading(true);

    try {
      const loaded = await trackerPort.load();
      if (request !== loadRequest.current) return;

      if (loaded.ok) {
        setEntries(loaded.value);
        setLoadFailed(false);
        setError(null);
      } else {
        setLoadFailed(true);
        setError(`${loaded.error.message} Your data is still on this machine.`);
      }
    } catch (loadError) {
      if (request !== loadRequest.current) return;
      const message = loadError instanceof Error ? loadError.message : String(loadError);
      setLoadFailed(true);
      setError(`${message} Your data is still on this machine.`);
    } finally {
      if (request === loadRequest.current) {
        loadInProgress.current = false;
        setLoading(false);
      }
    }
  }, [trackerPort]);

  useEffect(() => {
    void loadEntries();
    return () => {
      loadInProgress.current = false;
      loadRequest.current += 1;
    };
  }, [loadEntries]);

  const loadSubstages = useCallback(async () => {
    setSubstagesFailed(null);
    let message: string;
    try {
      const read = await trackerPort.substages();
      if (read.ok) {
        substagesRef.current = read.value;
        setSubstages(read.value);
        setSubstagesLoaded(true);
        return;
      }
      message = read.error.message;
    } catch (cause) {
      // A port that cannot answer is the same as one that said no.
      message = cause instanceof Error ? cause.message : String(cause);
    }
    // The board still works without them; only the editing is withheld.
    setSubstagesFailed(message);
  }, [trackerPort]);

  useEffect(() => {
    void loadSubstages();
  }, [loadSubstages]);

  /** Where focus goes back to when the stage editor closes. */
  const editorOpener = useRef<HTMLElement | null>(null);
  const previousPane = useRef<Pane['kind']>('closed');

  const openSubstageEditor = useCallback((trigger: HTMLElement | null) => {
    editorOpener.current = trigger;
    setPane({ kind: 'substages' });
  }, []);

  useEffect(() => {
    const was = previousPane.current;
    previousPane.current = pane.kind;
    if (was !== 'substages' || pane.kind === 'substages') return;
    // The opener may have been the detail pane's button, which is gone by now:
    // the column's own button is the next best place to land.
    const opener = editorOpener.current;
    editorOpener.current = null;
    const target =
      opener !== null && opener.isConnected
        ? opener
        : document.querySelector<HTMLElement>('[data-testid="tracker-edit-substages"]');
    target?.focus();
  }, [pane.kind]);

  const replace = useCallback((next: TrackerEntry) => {
    setEntries((current) =>
      current.map((entry) => (entry.application.id === next.application.id ? next : entry)),
    );
  }, []);

  /**
   * Write one changed entry.
   *
   * OPTIMISTIC, and it says so when it is wrong: the board updates immediately,
   * and a failed write puts the old entry back AND raises the message. Waiting
   * for SQLite before moving a dragged card makes the board feel broken; moving
   * it and never telling the user it did not stick would be worse.
   */
  const save = useCallback(
    async (previous: TrackerEntry, next: TrackerEntry) => {
      setError(null);
      replace(next);

      const written = await trackerPort.saveApplication(next.application);
      if (written.ok) return;

      replace(previous);
      setError(`That change could not be saved: ${written.error.message} Try again.`);
    },
    [replace, trackerPort],
  );

  const onStatusChange = useCallback(
    (applicationId: string, status: ApplicationStatus) => {
      const previous = entries.find((entry) => entry.application.id === applicationId);
      if (previous === undefined) return;
      if (previous.application.status === status) return;

      const next: TrackerEntry = {
        ...previous,
        application: withStatus(previous.application, status, new Date().toISOString()),
      };

      setSettlingId(applicationId);
      window.setTimeout(() => setSettlingId(null), SETTLE_MS);

      void save(previous, next);
    },
    [entries, save],
  );

  const onEdit = useCallback(
    (applicationId: string, changes: Parameters<typeof withEdit>[1]) => {
      const previous = entries.find((entry) => entry.application.id === applicationId);
      if (previous === undefined) return;

      const next: TrackerEntry = {
        ...previous,
        application: withEdit(previous.application, changes, new Date().toISOString()),
      };

      void save(previous, next);
    },
    [entries, save],
  );

  const onSubstageChange = useCallback(
    (applicationId: string, substageId: string | null) => {
      const previous = entries.find((entry) => entry.application.id === applicationId);
      if (previous === undefined) return;
      if ((previous.application.interview_substage_id ?? null) === substageId) return;

      const next: TrackerEntry = {
        ...previous,
        application: withSubstage(
          previous.application,
          substageId,
          substagesRef.current,
          new Date().toISOString(),
        ),
      };

      void save(previous, next);
    },
    [entries, save],
  );

  /**
   * Save a changed sub-stage list, optimistically, and answer with the reason
   * if it did not stick (`null` when it did).
   *
   * `removedId` is the one sub-stage being taken away, if any. The database
   * unsets it on every card that used it (`ON DELETE SET NULL`); the board does
   * the same in memory so it does not have to reload to agree. On a failed
   * save both go back, so the screen never shows a state the database refused.
   */
  const applySubstages = useCallback(
    async (
      change: Result<InterviewSubstage[], string>,
      removedId: string | null = null,
    ): Promise<string | null> => {
      if (!change.ok) return change.error;
      // Serial, because the save REPLACES the stored list: a second one built
      // on a list the first has not confirmed can delete real stages.
      if (savingSubstagesRef.current) return 'Wait for the current save to finish.';
      savingSubstagesRef.current = true;
      setSavingSubstages(true);

      try {
        const affected = new Set(
          entries
            .filter(
              (entry) =>
                removedId !== null && entry.application.interview_substage_id === removedId,
            )
            .map((entry) => entry.application.id),
        );

        substagesRef.current = change.value;
        setSubstages(change.value);
        if (removedId !== null) {
          setEntries((current) =>
            current.map((entry) =>
              affected.has(entry.application.id)
                ? { ...entry, application: { ...entry.application, interview_substage_id: null } }
                : entry,
            ),
          );
        }

        const written = await trackerPort.saveSubstages(change.value);
        if (written.ok) return null;

        // FAILED. Do not restore a snapshot: ask the database what it holds. The
        // write may have half landed, and a stale snapshot is what the next
        // edit would build its delete on.
        const [reread, reloaded] = await Promise.all([trackerPort.substages(), trackerPort.load()]);
        if (reread.ok) {
          substagesRef.current = reread.value;
          setSubstages(reread.value);
        } else {
          // Could not ask the database what it holds. Do NOT fall back to the
          // list from before the edit: that is exactly the stale picture the
          // next save would delete against. Block editing until Retry works.
          setSubstagesLoaded(false);
          setSubstagesFailed(reread.error.message);
        }
        if (reloaded.ok) {
          setEntries(reloaded.value);
        } else if (removedId !== null) {
          setEntries((current) =>
            current.map((entry) =>
              affected.has(entry.application.id)
                ? {
                    ...entry,
                    application: { ...entry.application, interview_substage_id: removedId },
                  }
                : entry,
            ),
          );
        }
        return `That change could not be saved: ${written.error.message} Try again.`;
      } finally {
        savingSubstagesRef.current = false;
        setSavingSubstages(false);
      }
    },
    [entries, trackerPort],
  );

  const onCreate = useCallback(
    async (draft: ApplicationDraft) => {
      setError(null);

      const entry = createEntry(
        draft,
        { jobId: crypto.randomUUID(), applicationId: crypto.randomUUID() },
        new Date().toISOString(),
      );

      const created = await trackerPort.create(entry);
      if (!created.ok) {
        setError(`That application could not be saved: ${created.error.message} Try again.`);
        return;
      }

      setEntries((current) => [...current, entry]);
      // Straight into the detail pane for the new card. The user almost always
      // wants to add a next action while it is still in their head.
      setPane({ kind: 'entry', applicationId: entry.application.id });
    },
    [trackerPort],
  );

  const onDelete = useCallback(
    async (entry: TrackerEntry) => {
      setError(null);

      const removed = await trackerPort.remove(entry);
      if (!removed.ok) {
        setError(`That application could not be deleted: ${removed.error.message} Try again.`);
        return;
      }

      setEntries((current) =>
        current.filter((candidate) => candidate.application.id !== entry.application.id),
      );
      setPane({ kind: 'closed' });
    },
    [trackerPort],
  );

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const visibleEntries = useMemo(() => {
    if (normalizedQuery === '') return entries;
    return entries.filter(({ job }) =>
      [job.title, job.company, job.agency, job.location].some(
        (value) => value?.toLowerCase().includes(normalizedQuery) ?? false,
      ),
    );
  }, [entries, normalizedQuery]);
  const grouped = useMemo(() => groupByStatus(visibleEntries), [visibleEntries]);
  const selected =
    pane.kind === 'entry'
      ? (entries.find((entry) => entry.application.id === pane.applicationId) ?? null)
      : null;

  const view = viewById('tracker');
  const boardIsReady = !loading && !loadFailed;
  const boardIsEmpty = boardIsReady && entries.length === 0;
  /**
   * Is a "start a new card" pane already open?
   *
   * Both entry points go disabled together. Two ways to start the same card,
   * one of them already on screen, is how a user ends up with a half-typed form
   * replaced under them by an empty one.
   */
  const paneIsOpenForNewWork = pane.kind === 'new' || pane.kind === 'paste';

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="view-tracker">
      <ViewHeader
        view={view.id}
        title={view.label}
        summary={view.summary}
        /*
         * The view's ONE blue button lives here once there are cards on the
         * board, and in the empty state before that — never in both at once,
         * because two identical blue buttons on one screen is exactly the thing
         * that stops blue meaning anything. It is disabled for as long as the
         * form it opens is on screen, and disabled rather than hidden so the
         * control does not move about as the user works.
         */
        action={
          !boardIsReady || boardIsEmpty ? null : (
            <div className="flex items-center gap-2">
              <PasteJobButton
                testId="tracker-paste"
                disabled={paneIsOpenForNewWork}
                onClick={() => setPane({ kind: 'paste' })}
              />
              <AddApplicationButton
                testId="tracker-add"
                disabled={paneIsOpenForNewWork}
                onClick={() => setPane({ kind: 'new' })}
              />
            </div>
          )
        }
      />

      {/*
        Not while loading and not on an empty board: five zeros and two dashes
        under the invitation to start would be the app reporting on a campaign
        that has not begun.
      */}
      {loading || boardIsEmpty ? null : <FunnelStrip entries={entries} />}

      <TrackerAlerts
        error={error}
        loadFailed={loadFailed}
        loading={loading}
        loadEntries={loadEntries}
        substagesFailed={substagesFailed}
        loadSubstages={loadSubstages}
      />

      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden p-2 md:p-4">
          {loading ? (
            <p className="text-ink-muted">Reading your applications…</p>
          ) : loadFailed ? (
            <p className="text-ink-muted">Your applications could not be loaded.</p>
          ) : boardIsEmpty ? (
            <EmptyBoard
              onAdd={() => setPane({ kind: 'new' })}
              onPaste={() => setPane({ kind: 'paste' })}
              disabled={paneIsOpenForNewWork}
            />
          ) : (
            <TrackerBoard
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              normalizedQuery={normalizedQuery}
              visibleEntries={visibleEntries}
              grouped={grouped}
              today={today}
              clock={clock}
              selected={selected}
              settlingId={settlingId}
              substages={substages}
              substagesLoaded={substagesLoaded}
              openSubstageEditor={openSubstageEditor}
              setPane={setPane}
              onStatusChange={onStatusChange}
              progressFor={progressFor}
              onContinue={onContinue}
            />
          )}
        </div>

        <TrackerSidePane
          pane={pane}
          setPane={setPane}
          onOpenSettings={onOpenSettings}
          createTransport={createTransport}
          createPageTransport={createPageTransport}
          readAvailability={readAvailability}
          consentPort={consentPort}
          substagesLoaded={substagesLoaded}
          loadSubstages={loadSubstages}
          substages={substages}
          savingSubstages={savingSubstages}
          entries={entries}
          applySubstages={applySubstages}
          substagesRef={substagesRef}
          onCreate={onCreate}
          selected={selected}
          today={today}
          clock={clock}
          browserPort={browserPort}
          onEdit={onEdit}
          onStatusChange={onStatusChange}
          onSubstageChange={onSubstageChange}
          openSubstageEditor={openSubstageEditor}
          substagesFailed={substagesFailed}
          onDelete={onDelete}
          trackerPort={trackerPort}
          availability={availability}
          onAnalyse={onAnalyse}
          onTailor={onTailor}
        />
      </div>
    </section>
  );
}
