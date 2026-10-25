/**
 * Is zod configured BEFORE resume-schema builds a schema? (L-112)
 *
 * The twin of `packages/core-types/src/zod.test.ts`, which explains the defect,
 * the detector and why an outcome check exists alongside the static guard. Read
 * that file first; this one exists because the ordering claim has to hold for
 * EACH package independently.
 *
 * `@cviper/resume-schema` is the package that can be loaded without
 * `@cviper/core-types` ever being imported for its own sake — `schema.ts` reaches
 * across for `z` and nothing else. So a run that only ever imported core-types
 * would prove nothing about the JSON Resume schemas, which are the ones that
 * parse a user's actual CV file.
 */
import { describe, expect, it } from 'vitest';
import { globalConfig, util } from 'zod/v4/core';

// Side effect: evaluating the entry point constructs every JSON Resume schema.
import './index';

/** See the twin file — zod's `cached()` holds the probe in `_getter` until first read. */
function probeState(): 'evaluated' | 'never-asked' {
  // zod 4.6 replaced the self-replacing getter with a small `Cached` class: a
  // `value` getter on the PROTOTYPE that calls `_getter` once, then sets
  // `_getter` to undefined. So the own `_getter` slot is now the record of
  // whether anything ever asked - a function until the first read, undefined
  // after it.
  const holder: unknown = util.allowsEval;
  if (typeof holder !== 'object' || holder === null || !Object.hasOwn(holder, '_getter')) {
    throw new Error(
      "zod's `util.allowsEval` has no own `_getter` slot any more. Its `cached()` helper has " +
        'changed shape, so this file can no longer tell whether the eval probe ran. Read ' +
        'zod/v4/core/util and rewrite the detector — do not delete it.',
    );
  }
  const getter: unknown = Reflect.get(holder, '_getter');
  return typeof getter === 'function' ? 'never-asked' : 'evaluated';
}

describe('zod is configured jitless before resume-schema builds a schema', () => {
  it('has jitless set by the time the package has finished loading', () => {
    expect(globalConfig.jitless).toBe(true);
  });

  it('never let zod reach the eval probe — so no securitypolicyviolation is raised', () => {
    expect(probeState()).toBe('never-asked');
  });

  it('still parses a JSON Resume, and still refuses a malformed one', async () => {
    const { parseJsonResume } = await import('./index');
    const good = parseJsonResume('{"basics":{"name":"A Candidate"},"work":[]}');
    expect(good.ok).toBe(true);
    // Negative: `work` must be a list. A shape error is the thing jitless could
    // plausibly have changed, so it is asserted rather than assumed.
    expect(parseJsonResume('{"work":"one job"}').ok).toBe(false);
  });

  it('LAST: reading the probe proves the detector above can tell the difference', () => {
    // Runs last: the memoisation is permanent within this module registry.
    expect(util.allowsEval.value).toBe(false);
    expect(probeState()).toBe('evaluated');
  });
});
