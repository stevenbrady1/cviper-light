import { describe, expect, it } from 'vitest';

import {
  PROVIDER_DAILY_LIMIT,
  QUOTA_BLOCK_AT,
  QUOTA_RESERVE,
  QUOTA_WARN_AT,
  REED_DAILY_LIMIT,
  emptyQuota,
  parseQuotaState,
  quotaVerdict,
  recordProviderRequest,
  rollOverQuota,
  utcDateOf,
  type QuotaState,
} from './quota';

const TODAY = '2026-08-19';
const TOMORROW = '2026-08-20';

function stateWith(reed: number, adzuna = 0, date = TODAY): QuotaState {
  return { date, counts: { reed, adzuna } };
}

describe('utcDateOf', () => {
  it('reads the UTC calendar day, not the local one', () => {
    // The reset has to happen on the boundary Reed's own counter uses, and
    // Reed resets at midnight UTC. Using the local day would give a user in
    // Sydney a reset eleven hours before Reed gives them one.
    expect(utcDateOf(new Date('2026-08-19T09:00:00.000Z'))).toBe('2026-08-19');
  });

  it('boundary: the last millisecond of a day and the first of the next', () => {
    expect(utcDateOf(new Date('2026-08-19T23:59:59.999Z'))).toBe('2026-08-19');
    expect(utcDateOf(new Date('2026-08-20T00:00:00.000Z'))).toBe('2026-08-20');
  });

  it('negative: an invalid date has no calendar day', () => {
    expect(utcDateOf(new Date('nonsense'))).toBeNull();
  });
});

describe('the daily reset', () => {
  it('keeps the counts while the UTC date is unchanged', () => {
    expect(rollOverQuota(stateWith(40, 12), TODAY)).toEqual(stateWith(40, 12));
  });

  it('boundary: zeroes every count the moment the UTC date changes', () => {
    expect(rollOverQuota(stateWith(90, 40), TOMORROW)).toEqual(stateWith(0, 0, TOMORROW));
  });

  it('boundary: a count from a date in the FUTURE also resets', () => {
    // A clock that was wrong, or a laptop opened after a flight. Yesterday's
    // number and tomorrow's are equally "not today's".
    expect(rollOverQuota(stateWith(90, 0, '2026-09-01'), TODAY)).toEqual(stateWith(0, 0));
  });

  it('a blocked provider is usable again after the reset', () => {
    const blocked = stateWith(QUOTA_BLOCK_AT);
    expect(quotaVerdict(blocked, 'reed', TODAY).status).toBe('blocked');
    expect(quotaVerdict(blocked, 'reed', TOMORROW).status).toBe('ok');
  });
});

describe('counting a request', () => {
  it('counts the provider that was called and leaves the other alone', () => {
    const after = recordProviderRequest(emptyQuota(TODAY), 'reed', TODAY);
    expect(after).toEqual(stateWith(1, 0));
  });

  it('counts each provider separately - one submit can be two requests', () => {
    let state = emptyQuota(TODAY);
    state = recordProviderRequest(state, 'reed', TODAY);
    state = recordProviderRequest(state, 'adzuna', TODAY);
    expect(state).toEqual(stateWith(1, 1));
  });

  it('rolls the day over before counting, so the first request of a new day is one', () => {
    expect(recordProviderRequest(stateWith(99, 99), 'reed', TOMORROW)).toEqual(
      stateWith(1, 0, TOMORROW),
    );
  });

  it('never mutates the state it was given', () => {
    const before = emptyQuota(TODAY);
    recordProviderRequest(before, 'reed', TODAY);
    expect(before).toEqual(stateWith(0, 0));
  });
});

describe('the thresholds', () => {
  it('warns at 75 and blocks at 90, keeping 10 in reserve', () => {
    expect(QUOTA_WARN_AT).toBe(75);
    expect(QUOTA_BLOCK_AT).toBe(90);
    expect(QUOTA_RESERVE).toBe(10);
    // The reserve is the reason the block is not the limit: 10 requests left
    // is enough to test a new key and still run one urgent search.
    expect(QUOTA_BLOCK_AT + QUOTA_RESERVE).toBe(REED_DAILY_LIMIT);
  });

  it("Reed's published free tier is 100 requests a day", () => {
    expect(REED_DAILY_LIMIT).toBe(100);
    expect(PROVIDER_DAILY_LIMIT.reed).toBe(100);
  });
});

describe('quotaVerdict — Reed, which publishes a limit', () => {
  it('boundary: 74 is fine and 75 warns', () => {
    expect(quotaVerdict(stateWith(74), 'reed', TODAY).status).toBe('ok');
    expect(quotaVerdict(stateWith(QUOTA_WARN_AT), 'reed', TODAY).status).toBe('warn');
  });

  it('boundary: 89 still warns and 90 BLOCKS', () => {
    expect(quotaVerdict(stateWith(QUOTA_BLOCK_AT - 1), 'reed', TODAY).status).toBe('warn');
    expect(quotaVerdict(stateWith(QUOTA_BLOCK_AT), 'reed', TODAY).status).toBe('blocked');
  });

  it('boundary: past the block it stays blocked rather than wrapping', () => {
    expect(quotaVerdict(stateWith(1000), 'reed', TODAY).status).toBe('blocked');
    expect(quotaVerdict(stateWith(1000), 'reed', TODAY).remaining).toBe(0);
  });

  it('reports how many requests are left against the published limit', () => {
    expect(quotaVerdict(stateWith(0), 'reed', TODAY).remaining).toBe(100);
    expect(quotaVerdict(stateWith(QUOTA_BLOCK_AT), 'reed', TODAY).remaining).toBe(10);
  });

  it('says WHEN it resets, and says it in UTC', () => {
    // A user who does not know when the number goes back down assumes it never
    // does. "Tomorrow" is also wrong for anyone not on UTC.
    for (const used of [QUOTA_WARN_AT, QUOTA_BLOCK_AT]) {
      const message = quotaVerdict(stateWith(used), 'reed', TODAY).message ?? '';
      expect(message).toContain('midnight UTC');
    }
  });

  it('the blocked message explains that nothing was sent', () => {
    const message = quotaVerdict(stateWith(QUOTA_BLOCK_AT), 'reed', TODAY).message ?? '';
    expect(message).toMatch(/Reed/);
    expect(message.length).toBeGreaterThan(20);
  });

  it('says nothing at all while there is nothing to say', () => {
    expect(quotaVerdict(stateWith(0), 'reed', TODAY).message).toBeNull();
  });
});

describe('quotaVerdict — Adzuna, which publishes no usable limit', () => {
  it('counts Adzuna but never blocks it', () => {
    // ====================================================================
    // A DELIBERATE ASYMMETRY.
    // ====================================================================
    // Reed publishes 100/day for its free tier, so 90 is a real number. Adzuna
    // free-tier limits depend on the plan the user signed up for and cannot be
    // queried, so any block here would be a guess - and a guess that stops a
    // paying user searching at 90 when their plan allows 2,500. The count is
    // still kept and still shown; only the enforcement is Reed's.
    expect(PROVIDER_DAILY_LIMIT.adzuna).toBeNull();
    expect(quotaVerdict(stateWith(0, 5000), 'adzuna', TODAY).status).toBe('ok');
    expect(quotaVerdict(stateWith(0, 5000), 'adzuna', TODAY).remaining).toBeNull();
  });

  it('still records how many Adzuna requests went out today', () => {
    expect(quotaVerdict(stateWith(0, 37), 'adzuna', TODAY).used).toBe(37);
  });

  it("one provider's usage never affects the other's verdict", () => {
    expect(quotaVerdict(stateWith(95, 0), 'adzuna', TODAY).status).toBe('ok');
    expect(quotaVerdict(stateWith(0, 95), 'reed', TODAY).status).toBe('ok');
  });
});

describe('parseQuotaState — reading what was stored', () => {
  it('reads back what it wrote', () => {
    const state = stateWith(12, 3);
    expect(parseQuotaState(JSON.parse(JSON.stringify(state)))).toEqual(state);
  });

  it('negative: refuses anything that is not the exact shape', () => {
    // The store is a string bucket that survives app upgrades and can be
    // hand-edited. A count of "lots" or -5 must not reach the arithmetic.
    for (const bad of [
      null,
      undefined,
      42,
      'a string',
      [],
      {},
      { date: TODAY },
      { date: 42, counts: { reed: 1, adzuna: 1 } },
      { date: '19/08/2026', counts: { reed: 1, adzuna: 1 } },
      { date: TODAY, counts: { reed: 'lots', adzuna: 1 } },
      { date: TODAY, counts: { reed: -5, adzuna: 1 } },
      { date: TODAY, counts: { reed: 1.5, adzuna: 1 } },
      { date: TODAY, counts: { reed: Number.NaN, adzuna: 1 } },
      { date: TODAY, counts: { reed: 1 } },
      { date: TODAY, counts: null },
    ]) {
      expect(parseQuotaState(bad)).toBeNull();
    }
  });

  it('boundary: zero counts and a huge count both read back', () => {
    expect(parseQuotaState({ date: TODAY, counts: { reed: 0, adzuna: 0 } })).toEqual(
      stateWith(0, 0),
    );
    expect(parseQuotaState({ date: TODAY, counts: { reed: 999_999, adzuna: 0 } })).toEqual(
      stateWith(999_999, 0),
    );
  });

  it('ignores extra keys rather than refusing the whole state', () => {
    const parsed = parseQuotaState({
      date: TODAY,
      counts: { reed: 1, adzuna: 2, linkedin: 9 },
      somethingNew: true,
    });
    expect(parsed).toEqual(stateWith(1, 2));
  });
});
