import { err, ok, type Profile } from '@cviper/core-types';

import { type DbError } from '../../../db';
import { type ProfilePort } from '../port';

/**
 * An in-memory `ProfilePort`, for driving the view in a test.
 *
 * Same reasoning as the tracker's fake: it satisfies the SAME TypeScript
 * interface the real port does, so a change to the real port's shape stops
 * this compiling. `port.test.ts` covers the other half — that the real port
 * calls the right data-layer functions.
 *
 * `failNext` makes the next call to a method return a `DbError`, which is how
 * the view's "could not be loaded" and "could not be saved" paths get tested.
 */

export interface FakeProfilePort extends ProfilePort {
  /** What was last saved, or `null` if nothing has been. */
  readonly saved: () => Profile | null;
  /** Make the next call to the named method fail. */
  readonly failNext: (method: 'load' | 'save') => void;
  /** How many times each method has been called. */
  readonly calls: Record<'load' | 'save', number>;
}

const FAILURE: DbError = {
  code: 'QUERY_FAILED',
  message: 'The database is locked by another copy of CViper.',
  table: 'profile',
};

export function createFakeProfilePort(initial: Profile | null = null): FakeProfilePort {
  let stored: Profile | null = initial;
  const failing = new Set<'load' | 'save'>();
  const calls = { load: 0, save: 0 };

  function refuses(method: 'load' | 'save'): boolean {
    if (!failing.has(method)) return false;
    failing.delete(method);
    return true;
  }

  return {
    calls,
    saved: () => stored,
    failNext: (method) => failing.add(method),

    async load() {
      calls.load += 1;
      return refuses('load') ? err(FAILURE) : ok(stored);
    },

    async save(profile) {
      calls.save += 1;
      if (refuses('save')) return err(FAILURE);
      stored = profile;
      return ok(undefined);
    },
  };
}
