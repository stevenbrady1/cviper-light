/**
 * The date reader, and the wrong answers it is here to refuse.
 *
 * The bug it exists to prevent is on the record: the web app's date parser
 * raised on Reed's format, the surrounding `except` swallowed it, and every
 * Reed advert was stamped with today. "Posted 3 days ago" was never true. A
 * date reader that guesses is worse than one that says nothing, so every case
 * below that cannot be read confidently comes back `null`.
 */
import { describe, expect, it } from 'vitest';

import { unixSecondsToIsoDate } from './dates';

describe('unixSecondsToIsoDate — Arbeitnow’s created_at', () => {
  it('reads a real timestamp from the feed', () => {
    // 1789281934 is a value taken from the live page.
    expect(unixSecondsToIsoDate(1789281934)).toBe('2026-09-13');
  });

  it('negative: refuses anything that is not a finite number', () => {
    for (const value of ['1789281934', null, undefined, {}, [], Number.NaN, Infinity]) {
      expect(unixSecondsToIsoDate(value), String(value)).toBeNull();
    }
  });

  it('boundary: refuses zero and negatives rather than reporting 1970', () => {
    // Zero is what a feed sends when it has no date. "Posted 20,000 days ago"
    // is a worse answer than no answer.
    expect(unixSecondsToIsoDate(0)).toBeNull();
    expect(unixSecondsToIsoDate(-1)).toBeNull();
    expect(unixSecondsToIsoDate(946_684_799)).toBeNull();
  });

  it('boundary: reads the first second it will believe', () => {
    expect(unixSecondsToIsoDate(946_684_800)).toBe('2000-01-01');
  });

  it('boundary: refuses a millisecond value handed in as seconds', () => {
    // The commonest unit mistake in the world. 1789281934000 as seconds is the
    // year 58,000, and reading it would put a card at the top of every sort.
    expect(unixSecondsToIsoDate(1_789_281_934_000)).toBeNull();
  });
});
