// @vitest-environment jsdom
/**
 * jsdom, because this module's whole job is `localStorage` — and the one thing
 * worth asserting about it is what happens when the stored value is not what we
 * wrote.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { QUOTA_BLOCK_AT } from '@cviper/job-apis';

import { QUOTA_STORAGE_KEY, countProviderRequest, readQuota, writeQuota } from './quotaStore';

const NINE_AM = new Date('2026-08-19T09:00:00.000Z');
const NEXT_DAY = new Date('2026-08-20T00:00:00.000Z');

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('readQuota', () => {
  it('starts a fresh day when nothing has been stored', () => {
    expect(readQuota(NINE_AM)).toEqual({
      date: '2026-08-19',
      counts: { reed: 0, adzuna: 0 },
    });
  });

  it('reads back what was written', () => {
    writeQuota({ date: '2026-08-19', counts: { reed: 12, adzuna: 3 } });

    expect(readQuota(NINE_AM)).toEqual({
      date: '2026-08-19',
      counts: { reed: 12, adzuna: 3 },
    });
  });

  it('boundary: rolls over the moment the UTC day changes', () => {
    // A laptop left open over midnight gets its allowance back without a
    // restart, because the roll-over happens on read as well as on write.
    writeQuota({ date: '2026-08-19', counts: { reed: QUOTA_BLOCK_AT, adzuna: 40 } });

    expect(readQuota(new Date('2026-08-19T23:59:59.999Z')).counts.reed).toBe(QUOTA_BLOCK_AT);
    expect(readQuota(NEXT_DAY)).toEqual({
      date: '2026-08-20',
      counts: { reed: 0, adzuna: 0 },
    });
  });

  it('uses the UTC day, not the local one', () => {
    writeQuota({ date: '2026-08-19', counts: { reed: 5, adzuna: 0 } });

    // 23:00 UTC is already tomorrow in Sydney. Reed's counter resets on UTC, so
    // ours must too - otherwise the user gets a fresh allowance eleven hours
    // before Reed agrees, and a run of failed searches with a counter at zero.
    expect(readQuota(new Date('2026-08-19T23:00:00.000Z')).counts.reed).toBe(5);
  });
});

describe('readQuota — a stored value that is not ours', () => {
  it('negative: treats unreadable storage as an empty day rather than refusing', () => {
    for (const rubbish of [
      'not json',
      '[]',
      '42',
      'null',
      '{"date":"19/08/2026","counts":{"reed":1,"adzuna":1}}',
      '{"date":"2026-08-19","counts":{"reed":"lots","adzuna":1}}',
      '{"date":"2026-08-19","counts":{"reed":-5,"adzuna":1}}',
      '{"date":"2026-08-19"}',
    ]) {
      localStorage.setItem(QUOTA_STORAGE_KEY, rubbish);

      expect(readQuota(NINE_AM)).toEqual({
        date: '2026-08-19',
        counts: { reed: 0, adzuna: 0 },
      });
    }
  });

  it('negative: never throws when localStorage itself fails', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage is disabled');
    });

    // A counter that throws would take down the search it is counting.
    expect(() => readQuota(NINE_AM)).not.toThrow();
  });
});

describe('writeQuota', () => {
  it('negative: never throws when the store is full', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    expect(() => writeQuota({ date: '2026-08-19', counts: { reed: 1, adzuna: 0 } })).not.toThrow();
  });

  it('stores a date and two numbers, and nothing else', () => {
    // This app tells the user nothing leaves their machine. The safest way to
    // keep a diagnostic honest is to make sure there is nothing in it worth
    // leaking - no search text, no location, no results.
    writeQuota({ date: '2026-08-19', counts: { reed: 1, adzuna: 2 } });

    const raw = localStorage.getItem(QUOTA_STORAGE_KEY) ?? '';
    expect(JSON.parse(raw)).toEqual({ date: '2026-08-19', counts: { reed: 1, adzuna: 2 } });
    expect(raw).not.toMatch(/london|analyst|http/i);
  });
});

describe('countProviderRequest', () => {
  it('counts one request against one provider and leaves the other alone', () => {
    expect(countProviderRequest('reed', NINE_AM)).toEqual({
      date: '2026-08-19',
      counts: { reed: 1, adzuna: 0 },
    });

    expect(readQuota(NINE_AM).counts).toEqual({ reed: 1, adzuna: 0 });
  });

  it('accumulates across calls, because each one really was a request', () => {
    countProviderRequest('adzuna', NINE_AM);
    countProviderRequest('adzuna', NINE_AM);

    expect(readQuota(NINE_AM).counts.adzuna).toBe(2);
  });

  it('boundary: a request on the next UTC day starts the count again', () => {
    writeQuota({ date: '2026-08-19', counts: { reed: QUOTA_BLOCK_AT, adzuna: 4 } });

    // The roll-over is what makes "it resets at midnight UTC" true without a
    // restart. Reed's own counter resets then, so ours has to as well.
    expect(countProviderRequest('reed', NEXT_DAY)).toEqual({
      date: '2026-08-20',
      counts: { reed: 1, adzuna: 0 },
    });
  });

  it('negative: never throws when the store refuses to be written', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    // The count is lost; the request it was counting still happened, and
    // refusing to make it because a diagnostic failed would be the wrong trade.
    expect(() => countProviderRequest('reed', NINE_AM)).not.toThrow();
  });
});
