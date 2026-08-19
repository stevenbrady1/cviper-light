// @vitest-environment jsdom
/**
 * The band scale, including the one thing that would quietly ruin it: bands
 * that disagree with the verdict they are supposed to be drawing.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { deriveVerdict } from '@cviper/core-types';

import { BANDS, BandScale } from './BandScale';

afterEach(() => {
  cleanup();
});

describe('the bands agree with deriveVerdict', () => {
  it('places every score from 0 to 100 in the band its verdict names', () => {
    // The contradiction this prevents: a tick sitting inside the "strong" block
    // underneath a badge that says "possible". Checked at every integer rather
    // than at the two edges, because a band list is easy to typo in the middle.
    for (let score = 0; score <= 100; score += 1) {
      const band = BANDS.find((candidate) => score >= candidate.from && score <= candidate.to);
      expect(band?.verdict, `score ${score}`).toBe(deriveVerdict(score));
    }
  });

  it('covers 0 to 100 with no gap and no overlap', () => {
    expect(BANDS[0]?.from).toBe(0);
    expect(BANDS[BANDS.length - 1]?.to).toBe(100);

    for (let index = 1; index < BANDS.length; index += 1) {
      expect(BANDS[index]?.from).toBe((BANDS[index - 1]?.to ?? -1) + 1);
    }
  });
});

describe('rendering', () => {
  it('shows the score as a number and describes it in words', () => {
    render(<BandScale score={71} verdict="possible" />);

    expect(screen.getByTestId('band-scale-score').textContent).toBe('71');
    expect(screen.getByTestId('band-scale').getAttribute('aria-label')).toBe(
      'Match score 71 out of 100 — a possible match.',
    );
  });

  it('puts the tick at the score', () => {
    render(<BandScale score={71} verdict="possible" />);

    expect(screen.getByTestId('band-scale-tick').style.left).toBe('71%');
  });

  it('boundary: 0 and 100 stay on the scale', () => {
    const { rerender } = render(<BandScale score={0} verdict="weak" />);
    expect(screen.getByTestId('band-scale-tick').style.left).toBe('0%');

    rerender(<BandScale score={100} verdict="strong" />);
    expect(screen.getByTestId('band-scale-tick').style.left).toBe('100%');
  });

  it('negative: a score outside the range is clamped rather than drawn off-screen', () => {
    // Unreachable through either engine, and it is still the first number the
    // user reads, so it must never render outside the component.
    const { rerender } = render(<BandScale score={-40} verdict="weak" />);
    expect(screen.getByTestId('band-scale-tick').style.left).toBe('0%');
    expect(screen.getByTestId('band-scale-score').textContent).toBe('0');

    rerender(<BandScale score={140} verdict="strong" />);
    expect(screen.getByTestId('band-scale-tick').style.left).toBe('100%');
  });

  it('negative: a score that is not a number renders as 0, not as NaN', () => {
    render(<BandScale score={Number.NaN} verdict="weak" />);

    expect(screen.getByTestId('band-scale-score').textContent).toBe('0');
    expect(screen.getByTestId('band-scale-tick').style.left).toBe('0%');
  });

  it('rounds a fractional score rather than showing a decimal', () => {
    render(<BandScale score={71.6} verdict="possible" />);
    expect(screen.getByTestId('band-scale-score').textContent).toBe('72');
  });

  it('carries the verdict where a test or a stylesheet can see it', () => {
    render(<BandScale score={82} verdict="strong" />);
    expect(screen.getByTestId('band-scale').dataset['verdict']).toBe('strong');
  });

  it('animates the tick exactly once, through the shared class', () => {
    // The motion budget is one moment per view. Anything else that started
    // moving would have to justify itself here.
    render(<BandScale score={50} verdict="weak" />);
    expect(screen.getByTestId('band-scale-tick').className).toContain('cviper-tick-in');
  });
});
