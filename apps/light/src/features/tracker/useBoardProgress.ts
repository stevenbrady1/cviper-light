import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  NO_SAVED_PROGRESS,
  createDbBoardProgressPort,
  type BoardProgressPort,
  type SavedProgress,
} from '../flow/progress';
import { type JobProgress } from '../flow/steps';

import { type TrackerEntry } from './model';
import { type TrackerPort } from './port';

export interface BoardProgressInput {
  /** `TrackerProps.boardProgressPort`. */
  readonly boardProgressPort: BoardProgressPort | undefined;
  /** `TrackerProps.port`. When it was injected, a faked data layer gets no real reads behind it. */
  readonly port: TrackerPort | undefined;
  readonly entries: readonly TrackerEntry[];
  /** `TrackerProps.tailoredJob`. */
  readonly tailoredJob: ((jobId: string) => boolean) | undefined;
}

/**
 * Where the cards' steps come from (L-200): what each job has saved, read again
 * whenever the board changes, plus whether it has a tailored draft.
 *
 * Moved word for word out of `Tracker` (L-358).
 */
export function useBoardProgress({
  boardProgressPort,
  port,
  entries,
  tailoredJob,
}: BoardProgressInput): (entry: TrackerEntry) => JobProgress {
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
  return progressFor;
}
