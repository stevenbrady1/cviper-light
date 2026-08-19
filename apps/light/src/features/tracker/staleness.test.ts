import { describe, expect, it } from 'vitest';

import { STALENESS_BANDS, stalenessBand, stalenessDescription } from './staleness';

describe('stalenessBand — the boundaries are the whole point', () => {
  // Each band has to end exactly where the next begins. An off-by-one here is
  // invisible on screen — the edge is simply the wrong colour on one card — so
  // the boundaries get asserted on both sides, every time.

  it('boundary: 6 is still moving, 7 has gone neutral', () => {
    expect(stalenessBand(6)).toBe('moving');
    expect(stalenessBand(7)).toBe('neutral');
  });

  it('boundary: 20 is still neutral, 21 has gone quiet', () => {
    expect(stalenessBand(20)).toBe('neutral');
    expect(stalenessBand(21)).toBe('quiet');
  });

  it('boundary: 44 is still quiet, 45 has gone cold', () => {
    expect(stalenessBand(44)).toBe('quiet');
    expect(stalenessBand(45)).toBe('cold');
  });

  it('boundary: today, day zero, is the freshest thing there is', () => {
    expect(stalenessBand(0)).toBe('moving');
  });

  it('covers the whole range with no gap and no overlap', () => {
    // Walks every day from 0 to 400 and asserts the band only ever moves
    // forwards. A band that went moving -> quiet -> neutral, or that returned
    // undefined for one day in the middle, fails here rather than on a user's
    // screen.
    const order = ['moving', 'neutral', 'quiet', 'cold'];
    let seen = 0;

    for (let days = 0; days <= 400; days += 1) {
      const band = stalenessBand(days);
      const index = order.indexOf(band);
      expect(index, `day ${days}`).toBeGreaterThanOrEqual(0);
      expect(index, `day ${days} went backwards`).toBeGreaterThanOrEqual(seen);
      seen = index;
    }

    expect(seen).toBe(order.indexOf('cold'));
  });

  it('stays cold however long the silence goes on', () => {
    expect(stalenessBand(365)).toBe('cold');
    expect(stalenessBand(10_000)).toBe('cold');
  });
});

describe('stalenessBand — input it should never get, handled anyway', () => {
  it('negative: an unknown age is neutral, not cold', () => {
    // `null` means the timestamp could not be read, which is a data problem,
    // not a stale application. Painting it gold would tell the user something
    // about their job hunt that is simply not true.
    expect(stalenessBand(null)).toBe('neutral');
  });

  it('negative: NaN is neutral for the same reason', () => {
    expect(stalenessBand(Number.NaN)).toBe('neutral');
  });

  it('negative: a negative age is treated as fresh', () => {
    // A future `updated_at` means a skewed clock or a backup from a machine set
    // to tomorrow. Nothing has gone stale in negative time.
    expect(stalenessBand(-1)).toBe('moving');
    expect(stalenessBand(-500)).toBe('moving');
  });
});

describe('the band definitions', () => {
  it('gives every band a colour and a description', () => {
    for (const band of ['moving', 'neutral', 'quiet', 'cold'] as const) {
      expect(STALENESS_BANDS[band].edgeClass.length).toBeGreaterThan(0);
      expect(STALENESS_BANDS[band].label.length).toBeGreaterThan(0);
    }
  });

  it('uses teal for fresh and gold for going quiet, never red', () => {
    // The colour grammar: red is destructive and the `rejected` status only. An
    // application nobody has touched for six weeks is not a rejection, and
    // colouring it red would say it was.
    expect(STALENESS_BANDS.moving.edgeClass).toContain('teal');
    expect(STALENESS_BANDS.quiet.edgeClass).toContain('gold');
    expect(STALENESS_BANDS.cold.edgeClass).toContain('gold');

    for (const band of ['moving', 'neutral', 'quiet', 'cold'] as const) {
      expect(STALENESS_BANDS[band].edgeClass).not.toContain('danger');
    }
  });

  it('fades the cold band rather than shouting louder than the quiet one', () => {
    // 45 days of silence is usually over, not urgent. It should recede.
    expect(STALENESS_BANDS.cold.edgeClass).toContain('/40');
  });
});

describe('stalenessDescription — the edge is never the only telling', () => {
  it('says how long it has been in words', () => {
    expect(stalenessDescription(0)).toContain('today');
    expect(stalenessDescription(1)).toContain('1 day');
    expect(stalenessDescription(9)).toContain('9 days');
  });

  it('boundary: says nothing misleading when the age is unknown', () => {
    expect(stalenessDescription(null)).toBe('Last change unknown');
  });
});
