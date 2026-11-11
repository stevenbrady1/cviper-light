import { describe, expect, it } from 'vitest';

import { type BackupCounts } from '../backup';
import { DATA_LOCATIONS } from '../privacy/dataLocations';

import {
  ERASE_STEPS,
  eraseConfirmationText,
  locationsErasedBy,
  runErase,
  summariseErase,
} from './model';
import { createFakeErasePort } from './test/fakeErasePort';

describe('runErase', () => {
  it('runs every step, in order, database first', async () => {
    const port = createFakeErasePort();

    const outcomes = await runErase(port);

    expect(port.calls).toEqual([...ERASE_STEPS]);
    expect(port.calls[0]).toBe('database');
    expect(outcomes.every((outcome) => outcome.result.ok)).toBe(true);
  });

  it('keeps going when a step refuses, so one failure never cancels the rest', async () => {
    const port = createFakeErasePort();
    port.failNext('keys');

    const outcomes = await runErase(port);

    // The keychain refused; the preferences were STILL removed.
    expect(port.calls).toEqual(['database', 'keys', 'preferences']);
    expect(outcomes.map((outcome) => outcome.result.ok)).toEqual([true, false, true]);
  });

  it('runs every step even when the first one fails', async () => {
    const port = createFakeErasePort();
    port.failNext('database');

    await runErase(port);

    expect(port.calls).toEqual(['database', 'keys', 'preferences']);
  });
});

describe('summariseErase', () => {
  it('says everything is gone when every step succeeded', async () => {
    const summary = summariseErase(await runErase(createFakeErasePort()));

    expect(summary.allDone).toBe(true);
    expect(summary.failures).toEqual([]);
    expect(summary.headline).toContain('Everything has been deleted');
  });

  it('names what went and what stayed, and why', async () => {
    const port = createFakeErasePort();
    port.failNext('keys');

    const summary = summariseErase(await runErase(port));

    expect(summary.allDone).toBe(false);
    expect(summary.headline).toBe(
      'Deleted your jobs, applications, CVs and analyses and your preferences, but your API keys could not be removed.',
    );
    expect(summary.failures).toHaveLength(1);
    expect(summary.failures[0]).toContain('your API keys: reed_api_key');
  });

  it('says nothing was deleted when nothing was', async () => {
    const port = createFakeErasePort();
    port.failNext('database');
    port.failNext('keys');
    port.failNext('preferences');

    const summary = summariseErase(await runErase(port));

    expect(summary.allDone).toBe(false);
    expect(summary.headline).toMatch(/^Nothing was deleted/);
    expect(summary.failures).toHaveLength(3);
  });
});

/**
 * L-351. The confirmation once read "This will delete nothing at all, every
 * saved API key and every preference." `describeCounts` says "nothing at all"
 * for an empty database, which is right as the whole object of a sentence and
 * wrong as the first item of a list. These two shapes are forbidden in every
 * sentence the confirmation can show, so a new case cannot bring them back.
 */
describe('eraseConfirmationText', () => {
  const NONE: BackupCounts = {
    jobs: 0,
    applications: 0,
    cvs: 0,
    analyses: 0,
    documents: 0,
    profile: false,
  };

  const CASES: readonly (readonly [string, BackupCounts | null, string])[] = [
    [
      'empty',
      NONE,
      'Nothing is saved here yet, so there is no work to lose. Your saved API keys and your preferences will still be deleted.',
    ],
    [
      'one item',
      { ...NONE, cvs: 1 },
      'This will delete 1 CV, every saved API key and every preference.',
    ],
    [
      'many',
      { jobs: 43, applications: 12, cvs: 2, analyses: 7, documents: 3, profile: true },
      'This will delete 43 jobs, 12 applications, 2 CVs, 7 past checks, 3 archived documents and your profile, every saved API key and every preference.',
    ],
    [
      'profile only',
      { ...NONE, profile: true },
      'This will delete your profile, every saved API key and every preference.',
    ],
    [
      'count failed',
      null,
      'The database could not be read to count what is in it. Deleting will still empty it.',
    ],
  ];

  it.each(CASES)('%s: says exactly what it will do', (_name, counts, expected) => {
    expect(eraseConfirmationText(counts)).toBe(expected);
  });

  // "nothing" followed, in the same sentence, by a comma: "nothing" used as
  // the first item of a list. Case-sensitive on purpose: the approved empty
  // sentence OPENS with "Nothing is saved here yet, so …", where "Nothing" is
  // the subject and the comma joins two clauses. A list item is never the
  // first word of the sentence, so it is always lower case.
  const NOTHING_AS_A_LIST_ITEM = /\bnothing\b[^.]*,/;

  it('the forbidden shapes catch the sentence that shipped', () => {
    const shipped = 'This will delete nothing at all, every saved API key and every preference.';
    expect(shipped).toMatch(/delete nothing/i);
    expect(shipped).toMatch(NOTHING_AS_A_LIST_ITEM);
  });

  it.each(CASES)('%s: never says it will delete nothing', (_name, counts) => {
    const text = eraseConfirmationText(counts);
    expect(text).not.toMatch(/delete nothing/i);
    expect(text).not.toMatch(NOTHING_AS_A_LIST_ITEM);
  });
});

describe('the data map and the erase steps agree', () => {
  it('every location is erased by a step that runs', () => {
    for (const location of DATA_LOCATIONS) {
      expect(ERASE_STEPS, location.what).toContain(location.erasedBy);
    }
  });

  it('every step erases at least one location — no step is decorative', () => {
    for (const step of ERASE_STEPS) {
      expect(locationsErasedBy(step).length, step).toBeGreaterThan(0);
    }
  });

  it('lists every location exactly once across the steps', () => {
    const listed = ERASE_STEPS.flatMap((step) => locationsErasedBy(step));
    expect(listed.sort()).toEqual(DATA_LOCATIONS.map((location) => location.what).sort());
  });
});
