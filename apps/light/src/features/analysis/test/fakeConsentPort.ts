import { ok, type Result } from '@cviper/core-types';

import {
  NO_CONSENT,
  type ConsentPort,
  type ConsentProblem,
  type ConsentProviderKind,
  type ConsentState,
} from '../consent';

/**
 * An in-memory `ConsentPort`, for driving the analysis view in a test.
 *
 * Same reasoning as `test/fakePort.ts`: the alternative is stubbing
 * `@tauri-apps/plugin-store` and answering `get`/`set`/`save` by hand, which
 * tests the stub. This satisfies the same TypeScript interface the real port
 * does, so a change to the real port's shape stops this compiling.
 */
export interface FakeConsentPort extends ConsentPort {
  readonly state: () => ConsentState;
}

export function createFakeConsentPort(initial: ConsentState = NO_CONSENT): FakeConsentPort {
  let state: ConsentState = { ...initial };

  async function set(
    kind: ConsentProviderKind,
    value: boolean,
  ): Promise<Result<ConsentState, ConsentProblem>> {
    state = { ...state, [kind]: value };
    return ok(state);
  }

  return {
    state: () => state,
    async read() {
      return ok(state);
    },
    grant: (kind) => set(kind, true),
    revoke: (kind) => set(kind, false),
  };
}
