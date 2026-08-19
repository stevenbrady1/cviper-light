import { err, ok, type Result } from '@cviper/core-types';
import { jobApiError, type JobApiError, type JobProviderId } from '@cviper/job-apis';

import { type SecretKeyName } from '../../../../status/environment';
import { keyProvider } from '../model';
import { type KeyPort, type KeyStoreError } from '../port';

/**
 * An in-memory `KeyPort`, for driving the wizard in a test.
 *
 * ============================================================================
 * IT IS A REAL STORE, NOT A PAIR OF SPIES
 * ============================================================================
 * `save` puts the value in a map and `status` reads that same map back. That is
 * what makes "a failed test never wrote anything" assertable: the test looks at
 * `saved()` and finds it empty, rather than looking at a mock's call count and
 * believing it.
 *
 * The one thing it CANNOT do is hand a saved value back out, because the real
 * port cannot either — `secret_status` answers a bool and there is no read
 * command (see `src-tauri/src/secrets.rs`). `saved()` is a test-only window
 * into the fake and is deliberately not part of `KeyPort`.
 */

export interface FakeKeyPort extends KeyPort {
  /** What is currently "in the credential store". Test-only. */
  readonly saved: () => Readonly<Partial<Record<SecretKeyName, string>>>;
  /** What the next `test` call resolves with. Defaults to one advert found. */
  readonly nextTest: (outcome: Result<number, JobApiError>) => void;
  /** Make the next call to the named method fail. */
  readonly failNext: (method: 'save' | 'remove') => void;
  /** Make this credential report `null` — a store that would not answer. */
  readonly makeUnreadable: (key: SecretKeyName) => void;
  /** The credentials each `test` call was given, in order. */
  readonly tested: () => readonly {
    provider: JobProviderId;
    values: Readonly<Partial<Record<SecretKeyName, string>>>;
  }[];
  readonly calls: Record<'status' | 'test' | 'save' | 'remove', number>;
}

const FAILURE: KeyStoreError = {
  message: 'The system credential store could not be opened. It may be locked.',
};

export function createFakeKeyPort(
  initial: Readonly<Partial<Record<SecretKeyName, string>>> = {},
): FakeKeyPort {
  const store: Partial<Record<SecretKeyName, string>> = { ...initial };
  const unreadable = new Set<SecretKeyName>();
  const failing = new Set<'save' | 'remove'>();
  const testedWith: {
    provider: JobProviderId;
    values: Readonly<Partial<Record<SecretKeyName, string>>>;
  }[] = [];
  const calls = { status: 0, test: 0, save: 0, remove: 0 };

  let outcome: Result<number, JobApiError> = ok(1);

  function refuses(method: 'save' | 'remove'): boolean {
    if (!failing.has(method)) return false;
    failing.delete(method);
    return true;
  }

  return {
    calls,
    saved: () => store,
    tested: () => testedWith,
    nextTest: (next) => {
      outcome = next;
    },
    failNext: (method) => failing.add(method),
    makeUnreadable: (key) => unreadable.add(key),

    async status(provider) {
      calls.status += 1;

      const answers: Partial<Record<SecretKeyName, boolean | null>> = {};
      for (const field of keyProvider(provider).fields) {
        answers[field.key] = unreadable.has(field.key) ? null : store[field.key] !== undefined;
      }
      return answers;
    },

    async test(provider, values) {
      calls.test += 1;
      testedWith.push({ provider, values: { ...values } });
      return outcome;
    },

    async save(key, value) {
      calls.save += 1;
      if (refuses('save')) return err(FAILURE);
      store[key] = value;
      return ok(undefined);
    },

    async remove(provider) {
      calls.remove += 1;
      if (refuses('remove')) return err(FAILURE);
      for (const field of keyProvider(provider).fields) delete store[field.key];
      return ok(undefined);
    },
  };
}

/** A rejected key, exactly as the real port would report a 401. */
export function rejectedKey(provider: JobProviderId): Result<number, JobApiError> {
  return err(
    jobApiError(provider, 'auth', 'The board rejected the saved key. Check it in Settings.', 401),
  );
}
