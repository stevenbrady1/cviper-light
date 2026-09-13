/**
 * The two date readers, and the wrong answers they are here to refuse.
 *
 * The bug these exist to prevent is on the record: the web app's date parser
 * raised on Reed's format, the surrounding `except` swallowed it, and every
 * Reed advert was stamped with today. "Posted 3 days ago" was never true. A
 * date reader that guesses is worse than one that says nothing, so every case
 * below that cannot be read confidently comes back `null`.
 */
import { describe, expect, it } from 'vitest';

import { rfc822ToIsoDate, unixSecondsToIsoDate } from './dates';

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

describe('rfc822ToIsoDate — Guardian’s pubDate', () => {
  it('reads the format the feed actually sends', () => {
    expect(rfc822ToIsoDate('Wed, 19 Aug 2026 23:00:00 +0000')).toBe('2026-08-19');
    expect(rfc822ToIsoDate('Mon, 24 Aug 2026 12:55:00 +0000')).toBe('2026-08-24');
  });

  it('reads it without the weekday, which RSS permits', () => {
    expect(rfc822ToIsoDate('19 Aug 2026 23:00:00 +0000')).toBe('2026-08-19');
  });

  it('reads a single-digit day', () => {
    expect(rfc822ToIsoDate('Tue, 1 Sep 2026 00:00:00 GMT')).toBe('2026-09-01');
  });

  it('ignores the zone, because the field is a calendar day', () => {
    // Shifting the day by an hour to honour an offset would change the date on
    // a card for a difference no reader could see.
    expect(rfc822ToIsoDate('Wed, 19 Aug 2026 23:00:00 +0100')).toBe('2026-08-19');
    expect(rfc822ToIsoDate('Wed, 19 Aug 2026 01:00:00 -0500')).toBe('2026-08-19');
  });

  it('negative: refuses prose, ISO, and anything that is not this format', () => {
    for (const value of ['last Tuesday', '2026-08-19', '', 'Wed, 19 Foo 2026', 19, null]) {
      expect(rfc822ToIsoDate(value), String(value)).toBeNull();
    }
  });

  it('boundary: refuses a day that does not exist rather than rolling it forward', () => {
    // `new Date(2026, 1, 31)` is the 3rd of March. A date that does not survive
    // a round trip is not a date.
    expect(rfc822ToIsoDate('Sat, 31 Feb 2026 00:00:00 +0000')).toBeNull();
    expect(rfc822ToIsoDate('Sat, 32 Aug 2026 00:00:00 +0000')).toBeNull();
  });

  it('boundary: reads a leap day in a leap year and refuses it otherwise', () => {
    expect(rfc822ToIsoDate('Sat, 29 Feb 2024 00:00:00 +0000')).toBe('2024-02-29');
    expect(rfc822ToIsoDate('Sat, 29 Feb 2026 00:00:00 +0000')).toBeNull();
  });
});
