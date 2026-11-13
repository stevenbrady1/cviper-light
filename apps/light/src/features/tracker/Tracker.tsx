import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { type Job } from '@cviper/core-types';

import { type ChatTransport } from '@cviper/ai-providers';

import { ViewHeader } from '../../app/ViewHeader';
import { createTauriBrowserPort, type BrowserPort } from '../../platform/browser';
import { todayIsoDate } from '../../lib/dates';
import { viewById } from '../../app/views';

import { readAvailability as readRealAvailability } from '../analysis/availability';
import { type ConsentPort } from '../analysis/consent';
import { type Availability } from '../analysis/providers';
import { type BoardProgressPort } from '../flow/progress';
import { type StepId } from '../flow/steps';

import { FunnelStrip } from './FunnelStrip';
import { type PageFetchTransport } from './pageFetch';
import { TrackerAlerts } from './TrackerAlerts';
import { TrackerBoard } from './TrackerBoard';
import { AddApplicationButton, PasteJobButton } from './TrackerButtons';
import { EmptyBoard } from './TrackerEmptyBoard';
import { TrackerSidePane, type Pane } from './TrackerSidePane';
import { groupByStatus, type TrackerEntry } from './model';
import { createDbTrackerPort, type TrackerPort } from './port';
import { useBoardProgress } from './useBoardProgress';
import { useTrackerEntries } from './useTrackerEntries';
import { useTrackerSubstages } from './useTrackerSubstages';

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
  /** Open with the paste pane up and the cursor in its link box (L-324). Read at first draw. */
  readonly openPaste?: boolean | undefined;
  /** Told once the paste pane has been opened that way, so the shell can forget it. */
  readonly onOpened?: (() => void) | undefined;
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
  openPaste,
  onOpened,
}: TrackerProps) {
  // Created once. A new port object every render would restart the load effect
  // on every keystroke.
  const trackerPort = useMemo(() => port ?? createDbTrackerPort(), [port]);
  const browserPort = useMemo(() => browser ?? createTauriBrowserPort(), [browser]);
  const clock = useMemo(() => now ?? new Date(), [now]);
  const today = todayIsoDate(clock);

  // The board is held here because all three hooks below need it. Their order,
  // and the availability effect's place between them, is the order the effects
  // ran in when they all lived in this file (L-358): steps, availability, cards,
  // interview stages.
  const [entries, setEntries] = useState<readonly TrackerEntry[]>([]);

  const progressFor = useBoardProgress({ boardProgressPort, port, entries, tailoredJob });
  const [searchQuery, setSearchQuery] = useState('');
  const [pane, setPane] = useState<Pane>({ kind: openPaste === true ? 'paste' : 'closed' });
  // Into the link box on arrival from Search (L-324). This runs after the
  // pane's own effect (it is a child) and before the shell's page-title focus.
  const arrivedToPaste = useRef(openPaste === true);
  useEffect(() => {
    if (!arrivedToPaste.current) return;
    arrivedToPaste.current = false;
    document.getElementById('paste-job-url')?.focus({ preventScroll: true });
    onOpened?.();
  }, [onOpened]);
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

  const {
    loading,
    loadFailed,
    error,
    loadEntries,
    settlingId,
    save,
    onStatusChange,
    onEdit,
    onCreate,
    onDelete,
  } = useTrackerEntries({ trackerPort, entries, setEntries, setPane });
  const {
    substages,
    substagesLoaded,
    substagesFailed,
    substagesRef,
    savingSubstages,
    loadSubstages,
    onSubstageChange,
    applySubstages,
  } = useTrackerSubstages({ trackerPort, entries, setEntries, save });

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
