// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { REQUEST_LOG_STORAGE_KEY, recordRequest, requestsToday } from './requestLog';

const MONDAY = new Date(2026, 7, 17, 10, 0, 0);
const TUESDAY = new Date(2026, 7, 18, 10, 0, 0);

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe('requestsToday', () => {
  it('starts at zero on a machine that has never made a request', () => {
    expect(requestsToday(MONDAY)).toBe(0);
  });

  it('counts what was recorded today', () => {
    recordRequest(MONDAY);
    recordRequest(MONDAY);
    recordRequest(MONDAY);

    expect(requestsToday(MONDAY)).toBe(3);
  });

  it('boundary: resets at the day boundary rather than accumulating forever', () => {
    // "Requests today" has to MEAN today. A running total since install would
    // be a different, far less useful number wearing the same label.
    recordRequest(MONDAY);
    recordRequest(MONDAY);

    expect(requestsToday(TUESDAY)).toBe(0);

    recordRequest(TUESDAY);
    expect(requestsToday(TUESDAY)).toBe(1);
  });

  it('does not resurrect yesterday’s count if the day comes back round', () => {
    // A user who changes their machine's clock, or travels east over a date
    // line, must not have an old total reappear.
    recordRequest(MONDAY);
    recordRequest(TUESDAY);

    expect(requestsToday(MONDAY)).toBe(0);
  });
});

describe('requestsToday — never trusts what is in storage', () => {
  it('negative: survives a corrupt entry and starts again from zero', () => {
    localStorage.setItem(REQUEST_LOG_STORAGE_KEY, 'not json at all');

    expect(requestsToday(MONDAY)).toBe(0);

    recordRequest(MONDAY);
    expect(requestsToday(MONDAY)).toBe(1);
  });

  it('negative: refuses a count that is not a number, or is nonsense', () => {
    for (const junk of [
      JSON.stringify({ date: '2026-08-17', count: 'lots' }),
      JSON.stringify({ date: '2026-08-17', count: -5 }),
      JSON.stringify({ date: '2026-08-17', count: 1.5 }),
      JSON.stringify({ date: 17, count: 3 }),
      JSON.stringify(['2026-08-17', 3]),
      JSON.stringify(null),
    ]) {
      localStorage.setItem(REQUEST_LOG_STORAGE_KEY, junk);
      expect(requestsToday(MONDAY), junk).toBe(0);
    }
  });
});

describe('recordRequest', () => {
  it('writes a shape the reader can read back', () => {
    recordRequest(MONDAY);

    expect(JSON.parse(localStorage.getItem(REQUEST_LOG_STORAGE_KEY) ?? 'null')).toEqual({
      date: '2026-08-17',
      count: 1,
    });
  });

  it('records nothing but a date and a count — no provider, no prompt, no URL', () => {
    // This is a COUNTER, not a log. The app promises nothing leaves the
    // machine, and the cheapest way to keep that true of a diagnostic is to
    // make sure there is nothing in it worth leaking.
    recordRequest(MONDAY);

    const stored: unknown = JSON.parse(localStorage.getItem(REQUEST_LOG_STORAGE_KEY) ?? 'null');
    expect(Object.keys(stored as object).sort()).toEqual(['count', 'date']);
  });
});
