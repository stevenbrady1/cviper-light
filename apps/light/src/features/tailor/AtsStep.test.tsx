// @vitest-environment jsdom
/**
 * The ATS Score step's rendering (L-198): before → after, refusals shown as
 * a dash with a reason (never a zero), the "only if it is true" wording beside
 * still-missing words, and the fabrication result repeated on this step.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { AtsStep } from './AtsStep';
import { type AtsComparison } from './atsComparison';

const BASE: AtsComparison = {
  keyword: { before: 54, after: 81, delta: 27, beforeReason: null, afterReason: null },
  bullets: { before: 41, after: 63, delta: 22, totalBefore: 4, totalAfter: 4 },
  checks: [
    {
      id: 'section_headers',
      label: 'Structure & sections',
      before: 'pass',
      after: 'pass',
      afterMessage: 'All standard sections (Experience, Education, Skills) found.',
    },
    {
      id: 'contact_info',
      label: 'Contact details',
      before: 'warn',
      after: 'warn',
      afterMessage:
        'Missing: phone number. Recruiters need to contact you — ensure both are at the top of your CV.',
    },
    {
      id: 'cv_length',
      label: 'Length',
      before: 'pass',
      after: 'pass',
      afterMessage: '420 words — well within the optimal 300-1200 word range for a 1-2 page CV.',
    },
  ],
  stillMissing: ['Power BI', 'dbt'],
  wordsAfter: 420,
};

function renderStep(comparison: AtsComparison = BASE, fabrication = { clean: true, flagged: 0 }) {
  render(<AtsStep comparison={comparison} fabrication={fabrication} />);
}

afterEach(() => {
  cleanup();
});

describe('AtsStep', () => {
  it('happy: shows keyword coverage and bullet strength before → after with a rising delta', () => {
    renderStep();
    const keyword = screen.getByTestId('tailor-ats-keyword');
    expect(within(keyword).getByText('54')).toBeTruthy();
    expect(within(keyword).getByText('81')).toBeTruthy();
    expect(screen.getByTestId('tailor-ats-keyword-delta').textContent).toBe('▲ +27');
    expect(screen.getByTestId('tailor-ats-band').textContent).toBe('Reads well');
    expect(screen.getByTestId('tailor-ats-bullets-delta').textContent).toBe('▲ +22');
  });

  it('lists only the checks that still need work, in the Python’s own words', () => {
    renderStep();
    const fixes = screen.getByTestId('tailor-ats-fixes');
    expect(fixes.textContent).toContain('Contact details');
    expect(fixes.textContent).toContain('Missing: phone number');
    expect(fixes.textContent).not.toContain('Structure & sections');
  });

  it('still-missing words always come with the "only if it is true" sentence', () => {
    renderStep();
    const missing = screen.getByTestId('tailor-ats-missing');
    expect(missing.textContent).toContain('Power BI, dbt');
    expect(missing.textContent).toContain('Only add a word if it is true for you.');
  });

  it('repeats the fabrication result on this step', () => {
    renderStep(BASE, { clean: false, flagged: 2 });
    const line = screen.getByTestId('tailor-ats-fabrication');
    expect(line.getAttribute('data-clean')).toBe('false');
    expect(line.textContent).toContain('2 things to check');
  });

  it('delta 0: says "no change", not "+0"', () => {
    renderStep({
      ...BASE,
      keyword: { ...BASE.keyword, after: 54, delta: 0 },
      bullets: { ...BASE.bullets, after: 41, delta: 0 },
    });
    expect(screen.getByTestId('tailor-ats-keyword-delta').textContent).toBe('no change');
    expect(screen.getByTestId('tailor-ats-bullets-delta').textContent).toBe('no change');
  });

  it('a regression is shown as a fall, in gold, never hidden', () => {
    renderStep({ ...BASE, keyword: { ...BASE.keyword, after: 50, delta: -4 } });
    const delta = screen.getByTestId('tailor-ats-keyword-delta');
    expect(delta.textContent).toBe('▼ -4');
    expect(delta.querySelector('.text-gold-ink')).not.toBeNull();
  });

  it('empty draft: a dash and the reason instead of a zero, and no bullet score', () => {
    renderStep({
      ...BASE,
      keyword: {
        before: 54,
        after: null,
        delta: null,
        beforeReason: null,
        afterReason: 'The CV is empty.',
      },
      bullets: { before: 41, after: 0, delta: -41, totalBefore: 4, totalAfter: 0 },
      stillMissing: [],
    });
    expect(screen.getByTestId('tailor-ats-keyword-delta').textContent).toBe('—');
    expect(screen.getByTestId('tailor-ats-keyword-reason').textContent).toContain(
      'The CV is empty.',
    );
    expect(screen.getByTestId('tailor-ats-bullets-delta').textContent).toBe('—');
    expect(screen.getByTestId('tailor-ats-no-bullets')).toBeTruthy();
    expect(screen.queryByTestId('tailor-ats-missing')).toBeNull();
  });

  it('is a labelled region with a captioned table, so it reads as one step', () => {
    renderStep();
    expect(screen.getByRole('region', { name: 'ATS score' })).toBeTruthy();
    expect(
      screen.getByRole('table', { name: 'ATS readiness before and after tailoring' }),
    ).toBeTruthy();
  });
});
