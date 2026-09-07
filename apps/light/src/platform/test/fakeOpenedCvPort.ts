import { type Result } from '@cviper/core-types';

import { type FileError, type OpenedCvPort, type PickedCv } from '../files';

/**
 * An `OpenedCvPort` a test can drive: `open()` delivers a file (or a
 * refusal) to every current watcher, exactly as the OS would.
 */
export interface FakeOpenedCvPort extends OpenedCvPort {
  /** Deliver a file, or a refusal, to whoever is listening. */
  readonly open: (opened: Result<PickedCv, FileError>) => void;
  /** How many watchers are listening right now. */
  readonly listening: () => number;
}

export function createFakeOpenedCvPort(): FakeOpenedCvPort {
  const listeners = new Set<(opened: Result<PickedCv, FileError>) => void>();
  return {
    open: (opened) => {
      for (const listener of listeners) listener(opened);
    },
    listening: () => listeners.size,
    watch(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
