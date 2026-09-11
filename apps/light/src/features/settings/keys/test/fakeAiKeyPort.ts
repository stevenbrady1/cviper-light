import { err, ok, type Result } from '@cviper/core-types';

import { type AiKeyPort, type AiKeyStoreError, type AiKeyTestFailure } from '../aiKeyPort';

/**
 * An in-memory `AiKeyPort`, for driving the OpenAI card in a test.
 *
 * ============================================================================
 * IT IS A REAL STORE, NOT A PAIR OF SPIES
 * ============================================================================
 * `save` puts the value in a variable and `status` reads that same variable
 * back. That is what makes "a failed test never wrote anything" assertable: the
 * test looks at `saved()` and finds `null`, rather than looking at a mock's call
 * count and believing it.
 *
 * `saved()` is a test-only window into the fake and is deliberately not part of
 * `AiKeyPort` — the real port cannot hand a saved key back, because there is no
 * command that would let it.
 */
export interface FakeAiKeyPort extends AiKeyPort {
  /** What is currently "in the credential store". Test-only. */
  readonly saved: () => string | null;
  /** What the next `test` call resolves with. Defaults to a pass. */
  readonly nextTest: (outcome: Result<void, AiKeyTestFailure>) => void;
  /** Make the next call to the named method fail. */
  readonly failNext: (method: 'save' | 'remove') => void;
  /** Make the store report `null` — one that would not answer. */
  readonly makeUnreadable: () => void;
  /** Every key each `test` call was given, in order. */
  readonly tested: () => readonly string[];
  readonly calls: Record<'status' | 'hint' | 'test' | 'save' | 'remove', number>;
}

const FAILURE: AiKeyStoreError = {
  message: 'The system credential store could not be opened. It may be locked.',
};

/**
 * The same masking rule `secret_hint` applies in Rust: bullets, and at most the
 * last four characters. Repeated here so the card is driven by a realistic
 * answer rather than a hand-written one.
 */
export function fakeHint(value: string): string {
  const characters = [...value];
  if (characters.length <= 8) return '••••';
  return `••••${characters.slice(-4).join('')}`;
}

export function createFakeAiKeyPort(initial: string | null = null): FakeAiKeyPort {
  let store: string | null = initial;
  let unreadable = false;
  const failing = new Set<'save' | 'remove'>();
  const testedWith: string[] = [];
  const calls = { status: 0, hint: 0, test: 0, save: 0, remove: 0 };

  let outcome: Result<void, AiKeyTestFailure> = ok(undefined);

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
    makeUnreadable: () => {
      unreadable = true;
    },

    async status() {
      calls.status += 1;
      return unreadable ? null : store !== null;
    },

    async hint() {
      calls.hint += 1;
      if (unreadable || store === null) return null;
      return fakeHint(store);
    },

    async test(key) {
      calls.test += 1;
      testedWith.push(key);
      return outcome;
    },

    async save(key) {
      calls.save += 1;
      if (refuses('save')) return err(FAILURE);
      store = key;
      return ok(undefined);
    },

    async remove() {
      calls.remove += 1;
      if (refuses('remove')) return err(FAILURE);
      store = null;
      return ok(undefined);
    },
  };
}
