import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';

import { type ApplicationStatus } from '@cviper/core-types';

import { type Pane } from './TrackerSidePane';
import {
  createEntry,
  withEdit,
  withStatus,
  type ApplicationDraft,
  type TrackerEntry,
} from './model';
import { type TrackerPort } from './port';

/** How long the settle animation runs. Matches the keyframe in theme.css. */
const SETTLE_MS = 200;

export interface TrackerEntriesInput {
  readonly trackerPort: TrackerPort;
  /** The board. `Tracker` holds it, because all three of its hooks need it. */
  readonly entries: readonly TrackerEntry[];
  readonly setEntries: Dispatch<SetStateAction<readonly TrackerEntry[]>>;
  /** Adding a card opens it, and deleting one closes the pane. */
  readonly setPane: Dispatch<SetStateAction<Pane>>;
}

export interface TrackerEntries {
  readonly loading: boolean;
  readonly loadFailed: boolean;
  readonly error: string | null;
  readonly loadEntries: () => Promise<void>;
  readonly settlingId: string | null;
  readonly save: (previous: TrackerEntry, next: TrackerEntry) => Promise<void>;
  readonly onStatusChange: (applicationId: string, status: ApplicationStatus) => void;
  readonly onEdit: (applicationId: string, changes: Parameters<typeof withEdit>[1]) => void;
  readonly onCreate: (draft: ApplicationDraft) => Promise<void>;
  readonly onDelete: (entry: TrackerEntry) => Promise<void>;
}

/**
 * Reading the board, and every write to a card: the optimistic save behind a
 * move or an edit, adding a card and deleting one.
 *
 * Moved word for word out of `Tracker` (L-358). `onCreate` and `onDelete`
 * still change the board and the pane with nothing awaited between the two, so
 * React draws both in one render. `tracker.sameInstant.test.tsx` fails if any
 * render shows one without the other.
 */
export function useTrackerEntries({
  trackerPort,
  entries,
  setEntries,
  setPane,
}: TrackerEntriesInput): TrackerEntries {
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadInProgress = useRef(false);
  const loadRequest = useRef(0);
  const [settlingId, setSettlingId] = useState<string | null>(null);

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

  return {
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
  };
}
