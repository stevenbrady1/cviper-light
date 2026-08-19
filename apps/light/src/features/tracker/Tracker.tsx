import { useCallback, useEffect, useMemo, useState } from 'react';

import { type ApplicationStatus } from '@cviper/core-types';

import { PRIMARY_BUTTON } from '../../app/buttons';
import { DetailPane } from '../../app/DetailPane';
import { ViewHeader } from '../../app/ViewHeader';
import { todayIsoDate } from '../../lib/dates';
import { viewById } from '../../app/views';

import { ApplicationDetail } from './ApplicationDetail';
import { NewApplicationForm } from './NewApplicationForm';
import { TrackerColumn } from './TrackerColumn';
import {
  TRACKER_COLUMNS,
  createEntry,
  groupByStatus,
  withEdit,
  withStatus,
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
}

type Pane = { kind: 'closed' } | { kind: 'new' } | { kind: 'entry'; applicationId: string };

export function Tracker({ port, now }: TrackerProps) {
  // Created once. A new port object every render would restart the load effect
  // on every keystroke.
  const trackerPort = useMemo(() => port ?? createDbTrackerPort(), [port]);
  const clock = useMemo(() => now ?? new Date(), [now]);
  const today = todayIsoDate(clock);

  const [entries, setEntries] = useState<readonly TrackerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pane, setPane] = useState<Pane>({ kind: 'closed' });
  const [settlingId, setSettlingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void trackerPort.load().then((loaded) => {
      if (cancelled) return;
      setLoading(false);
      if (loaded.ok) setEntries(loaded.value);
      // Never swallowed. A board that silently shows nothing when the database
      // will not open is indistinguishable from a board with nothing on it.
      else setError(`${loaded.error.message} Your data is still on this machine.`);
    });

    return () => {
      cancelled = true;
    };
  }, [trackerPort]);

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

  const grouped = useMemo(() => groupByStatus(entries), [entries]);
  const selected =
    pane.kind === 'entry'
      ? (entries.find((entry) => entry.application.id === pane.applicationId) ?? null)
      : null;

  const view = viewById('tracker');
  const boardIsEmpty = !loading && entries.length === 0;

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="view-tracker">
      <ViewHeader
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
          boardIsEmpty ? null : (
            <AddApplicationButton
              testId="tracker-add"
              disabled={pane.kind === 'new'}
              onClick={() => setPane({ kind: 'new' })}
            />
          )
        }
      />

      {error === null ? null : (
        <p
          role="alert"
          data-testid="tracker-error"
          className="border-b border-danger/30 bg-danger/5 px-6 py-2 text-danger"
        >
          {error}
        </p>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden p-4">
          {loading ? (
            <p className="text-ink-muted">Reading your applications…</p>
          ) : boardIsEmpty ? (
            <EmptyBoard onAdd={() => setPane({ kind: 'new' })} disabled={pane.kind === 'new'} />
          ) : (
            <div className="flex h-full min-h-0 gap-2">
              {TRACKER_COLUMNS.map((status) => (
                <TrackerColumn
                  key={status}
                  status={status}
                  entries={grouped[status]}
                  today={today}
                  now={clock}
                  selectedId={selected?.application.id ?? null}
                  settlingId={settlingId}
                  onSelect={(applicationId) => setPane({ kind: 'entry', applicationId })}
                  onDropCard={onStatusChange}
                />
              ))}
            </div>
          )}
        </div>

        {pane.kind === 'new' ? (
          <DetailPane
            title="New application"
            subtitle="Anything you have applied to, typed in by hand."
            onClose={() => setPane({ kind: 'closed' })}
          >
            <NewApplicationForm
              onCreate={(draft) => void onCreate(draft)}
              onCancel={() => setPane({ kind: 'closed' })}
            />
          </DetailPane>
        ) : selected === null ? null : (
          <DetailPane
            title={selected.job.title}
            subtitle={[selected.job.company, selected.job.location]
              .filter((part) => part !== null && part !== '')
              .join(' · ')}
            onClose={() => setPane({ kind: 'closed' })}
          >
            {/*
              Keyed by the application id so every field resets when the
              selection changes. Without it, a debounced note from the last card
              could land on this one.
            */}
            <ApplicationDetail
              key={selected.application.id}
              entry={selected}
              today={today}
              now={clock}
              onEdit={(changes) => onEdit(selected.application.id, changes)}
              onStatusChange={(status) => onStatusChange(selected.application.id, status)}
              onDelete={() => void onDelete(selected)}
            />
          </DetailPane>
        )}
      </div>
    </section>
  );
}

/**
 * The single "Add application" button, wherever it happens to be.
 *
 * One component so the two placements cannot drift into two different buttons,
 * and so `data-primary` — which the tests count — is attached in exactly one
 * place.
 */
function AddApplicationButton({
  testId,
  disabled,
  onClick,
  className = '',
}: {
  testId: string;
  disabled: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      data-primary="true"
      disabled={disabled}
      onClick={onClick}
      className={`${PRIMARY_BUTTON} ${className}`}
    >
      Add application
      {disabled ? <span className="sr-only"> — the form is already open</span> : null}
    </button>
  );
}

/**
 * The empty board.
 *
 * An invitation, not an apology. It does not say "no applications found" — it
 * says what this screen is for and offers the one action that makes it useful,
 * with the reassurance that matters most here: this works with nothing set up.
 */
function EmptyBoard({ onAdd, disabled }: { onAdd: () => void; disabled: boolean }) {
  return (
    <div
      data-testid="tracker-empty"
      className="flex h-full items-center justify-center rounded-card border border-line border-dashed bg-card"
    >
      <div className="max-w-sm px-6 text-center">
        <p className="font-medium text-ink">Start with the last job you applied to.</p>
        <p className="mt-1 text-ink-muted">
          The board keeps every application in one place and shows you which ones have gone quiet.
          It needs no account and no API key.
        </p>
        <AddApplicationButton
          testId="tracker-empty-add"
          className="mt-4"
          disabled={disabled}
          onClick={onAdd}
        />
      </div>
    </div>
  );
}
