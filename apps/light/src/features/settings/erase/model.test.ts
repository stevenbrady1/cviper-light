import { describe, expect, it } from 'vitest';

import { DATA_LOCATIONS } from '../privacy/dataLocations';

import { ERASE_STEPS, locationsErasedBy, runErase, summariseErase } from './model';
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
