import { err, ok, type Result } from '@cviper/core-types';

import { NO_PREFERENCES, parseBoardPreferences, type BoardPreferences } from '../model';
import { type BoardPreferencesPort, type BoardPreferencesProblem } from '../port';

/**
 * An in-memory `BoardPreferencesPort`.
 *
 * Every write goes through `JSON.parse(JSON.stringify(...))` and back through
 * `parseBoardPreferences`, exactly as the real store does. A component test
 * that passes this therefore proves the value it saved is a value that survives
 * a file — a fake that handed the same object back would not.
 */
export interface FakeBoardPort extends BoardPreferencesPort {
  /** What is currently "on disk". */
  readonly saved: () => BoardPreferences;
  /** How many times each method has been called. */
  readonly calls: { read: number; write: number };
  /** Make every read fail, the way a read-only data directory would. */
  readonly failReads: (message: string | null) => void;
  /** Make every write fail, the way a full disk would. */
  readonly failWrites: (message: string | null) => void;
}

export function createFakeBoardPort(initial: BoardPreferences = NO_PREFERENCES): FakeBoardPort {
  let stored = parseBoardPreferences(JSON.parse(JSON.stringify(initial)));
  const calls = { read: 0, write: 0 };
  let readProblem: string | null = null;
  let writeProblem: string | null = null;

  function problem(message: string): Result<never, BoardPreferencesProblem> {
    return err({ message });
  }

  return {
    calls,
    saved: () => stored,
    failReads: (message) => {
      readProblem = message;
    },
    failWrites: (message) => {
      writeProblem = message;
    },

    read() {
      calls.read += 1;
      if (readProblem !== null) return Promise.resolve(problem(readProblem));
      return Promise.resolve(ok(stored));
    },

    write(next) {
      calls.write += 1;
      if (writeProblem !== null) return Promise.resolve(problem(writeProblem));

      stored = parseBoardPreferences(JSON.parse(JSON.stringify(next)));
      return Promise.resolve(ok(undefined));
    },
  };
}
