import { err, ok } from '@cviper/core-types';

import { type EraseStep } from '../../privacy/dataLocations';
import { type ErasePort } from '../port';

/**
 * An in-memory `ErasePort` that remembers what was asked of it.
 *
 * `failNext(step)` makes ONE call to that step refuse, so a test can prove the
 * other steps still run and the message names the right one.
 */
export interface FakeErasePort extends ErasePort {
  readonly calls: EraseStep[];
  readonly failNext: (step: EraseStep) => void;
}

export function createFakeErasePort(): FakeErasePort {
  const calls: EraseStep[] = [];
  const failing = new Set<EraseStep>();

  async function step(name: EraseStep, refusal: string) {
    calls.push(name);
    if (failing.delete(name)) return err({ message: refusal });
    return ok(undefined);
  }

  return {
    calls,
    failNext: (name) => failing.add(name),
    wipeDatabase: () => step('database', 'The database is locked by another copy of CViper.'),
    forgetKeys: () =>
      step(
        'keys',
        'reed_api_key: This computer’s credential store is locked. Unlock it and try again.',
      ),
    forgetPreferences: () => step('preferences', 'The file could not be written.'),
  };
}
