import { err, ok, type Result } from '@cviper/core-types';

import { type UpdateInfo, type UpdatePort, type UpdateProblem } from '../port';

/**
 * An in-memory `UpdatePort`.
 *
 * It counts its calls, because the most important assertion in this feature is
 * a NEGATIVE one: that mounting the app calls `check` zero times. A fake that
 * only returned canned answers could not express that.
 */
export interface FakeUpdatePort extends UpdatePort {
  /** How many times each method has been called. */
  readonly calls: { check: number; install: number };
  /** What the next `check` resolves with. Defaults to "nothing newer". */
  readonly nextCheck: (outcome: Result<UpdateInfo | null, UpdateProblem>) => void;
  /** What the next `install` resolves with. Defaults to success. */
  readonly nextInstall: (outcome: Result<void, UpdateProblem>) => void;
}

export function createFakeUpdatePort(): FakeUpdatePort {
  const calls = { check: 0, install: 0 };
  let checkOutcome: Result<UpdateInfo | null, UpdateProblem> = ok(null);
  let installOutcome: Result<void, UpdateProblem> = ok(undefined);

  return {
    calls,
    nextCheck(outcome) {
      checkOutcome = outcome;
    },
    nextInstall(outcome) {
      installOutcome = outcome;
    },
    check() {
      calls.check += 1;
      return Promise.resolve(checkOutcome);
    },
    install() {
      calls.install += 1;
      return Promise.resolve(installOutcome);
    },
  };
}

/** An update that is genuinely on offer, for the available/installing paths. */
export const AN_UPDATE: UpdateInfo = {
  version: '0.2.0',
  notes: 'Faster CV parsing.',
  date: '2026-09-01',
};

/** A failure the port would produce when a downloaded update's signature will not verify. */
export const UNVERIFIABLE: Result<UpdateInfo | null, UpdateProblem> = err({
  message: 'The update could not be verified as genuine, so nothing was downloaded.',
});
