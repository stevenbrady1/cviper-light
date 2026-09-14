// @vitest-environment jsdom
/**
 * The gate rows above a result (L-156): one row per verdict, and the one
 * quiet line when nothing in the advert stops the user applying.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { type GateResult } from '@cviper/keyword-scoring';

import { GateNotice } from './GateNotice';

afterEach(() => {
  cleanup();
});

const CLEAR: GateResult = {
  kind: 'eligibility',
  verdict: 'pass',
  quote: null,
  language: null,
  reason: 'The advert states no citizenship, residency or clearance requirement.',
};

const FLAGGED: GateResult = {
  kind: 'eligibility',
  verdict: 'flag',
  quote: 'You must be eligible for SC clearance.',
  language: null,
  reason: 'The advert asks for security clearance. Check whether you hold it.',
};

const FAILED: GateResult = {
  kind: 'language',
  verdict: 'fail',
  quote: 'Fluent Polish is essential.',
  language: 'Polish',
  reason: 'The advert requires Polish. Your profile does not list it.',
};

const PASSED: GateResult = {
  kind: 'language',
  verdict: 'pass',
  quote: 'Fluent French is required.',
  language: 'French',
  reason: 'The advert requires French and your profile lists it (Native).',
};

describe('the collapsed line', () => {
  it('shows one quiet sentence when every gate passes', () => {
    render(<GateNotice results={[CLEAR, PASSED]} />);

    expect(screen.getByTestId('analysis-gates-clear').textContent).toBe(
      'Eligibility and language: nothing in the advert stops you applying.',
    );
    expect(screen.queryByTestId('analysis-gates')).toBeNull();
  });

  // BOUNDARY — `runGates` never returns an empty list, but the component must
  // not render a "nothing stops you" line it has no evidence for.
  it('renders nothing at all for an empty list', () => {
    const { container } = render(<GateNotice results={[]} />);
    expect(container.innerHTML).toBe('');
  });
});

describe('the rows', () => {
  it('renders a fail as a hard stop, with the advert quoted', () => {
    render(<GateNotice results={[CLEAR, FAILED]} />);

    const list = screen.getByTestId('analysis-gates');
    const row = within(list).getByTestId('analysis-gate-language-0');
    expect(row.textContent).toContain('Language: Polish');
    expect(within(row).getByTestId('analysis-gate-verdict').textContent).toBe('Hard stop');
    expect(within(row).getByTestId('analysis-gate-verdict').className).toContain('text-danger');
    expect(within(row).getByRole('blockquote').textContent).toContain(
      'Fluent Polish is essential.',
    );
    expect(row.textContent).toContain('does not list it');
    expect(screen.queryByTestId('analysis-gates-clear')).toBeNull();
  });

  it('renders a flag as something to check, in gold', () => {
    render(<GateNotice results={[FLAGGED]} />);

    const row = screen.getByTestId('analysis-gate-eligibility-0');
    expect(row.textContent).toContain('Eligibility');
    expect(within(row).getByTestId('analysis-gate-verdict').textContent).toBe('Check this');
    expect(within(row).getByTestId('analysis-gate-verdict').className).toContain('text-gold');
    expect(within(row).getByRole('blockquote').textContent).toContain('SC clearance');
  });

  // NEGATIVE — a pass sitting beside a flag is still shown, as clear, without a
  // blockquote when the advert said nothing.
  it('renders a pass as clear and omits the blockquote when there is no quote', () => {
    render(<GateNotice results={[CLEAR, FAILED]} />);

    const row = screen.getByTestId('analysis-gate-eligibility-0');
    expect(within(row).getByTestId('analysis-gate-verdict').textContent).toBe('Clear');
    expect(within(row).getByTestId('analysis-gate-verdict').className).toContain('text-teal');
    expect(within(row).queryByRole('blockquote')).toBeNull();
  });

  it('numbers rows per kind, in order', () => {
    render(<GateNotice results={[FLAGGED, FAILED, { ...PASSED, verdict: 'flag' }]} />);

    expect(screen.getByTestId('analysis-gate-eligibility-0')).toBeTruthy();
    expect(screen.getByTestId('analysis-gate-language-0').textContent).toContain('Polish');
    expect(screen.getByTestId('analysis-gate-language-1').textContent).toContain('French');
  });
});
