import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';

import { type InterviewSubstage, type Result } from '@cviper/core-types';

import { withSubstage, type TrackerEntry } from './model';
import { type TrackerPort } from './port';

export interface TrackerSubstagesInput {
  readonly trackerPort: TrackerPort;
  readonly entries: readonly TrackerEntry[];
  readonly setEntries: Dispatch<SetStateAction<readonly TrackerEntry[]>>;
  /** `useTrackerEntries`' optimistic save, for a card moved to another sub-stage. */
  readonly save: (previous: TrackerEntry, next: TrackerEntry) => Promise<void>;
}

export interface TrackerSubstages {
  readonly substages: readonly InterviewSubstage[];
  readonly substagesLoaded: boolean;
  readonly substagesFailed: string | null;
  readonly substagesRef: RefObject<readonly InterviewSubstage[]>;
  readonly savingSubstages: boolean;
  readonly loadSubstages: () => Promise<void>;
  readonly onSubstageChange: (applicationId: string, substageId: string | null) => void;
  readonly applySubstages: (
    change: Result<InterviewSubstage[], string>,
    removedId?: string | null,
  ) => Promise<string | null>;
}

/**
 * The user's interview sub-stages (L-205): reading them, putting a card in one,
 * and saving a changed list.
 *
 * Moved word for word out of `Tracker` (L-358).
 */
export function useTrackerSubstages({
  trackerPort,
  entries,
  setEntries,
  save,
}: TrackerSubstagesInput): TrackerSubstages {
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

  return {
    substages,
    substagesLoaded,
    substagesFailed,
    substagesRef,
    savingSubstages,
    loadSubstages,
    onSubstageChange,
    applySubstages,
  };
}
