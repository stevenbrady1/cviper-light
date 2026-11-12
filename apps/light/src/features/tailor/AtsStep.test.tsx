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

/**
 * What `element` shows, in order: each drawn mark as `[name]`, and the text
 * around it exactly (L-362). The drawn-mark version of `textContent`, so a
 * typed "▲ +27" and a drawn "[up] +27" are pinned the same way: which mark,
 * where, how many, and the very same words and numbers.
 */
function asShown(element: Node): string {
  if (element instanceof Element && element.hasAttribute('data-mark')) {
    return `[${element.getAttribute('data-mark') ?? ''}]`;
  }
  if (element.nodeType === Node.TEXT_NODE) return element.textContent ?? '';
  return [...element.childNodes].map(asShown).join('');
}

describe('AtsStep', () => {
  it('happy: shows keyword coverage and bullet strength before → after with a rising delta', () => {
    renderStep();
    const keyword = screen.getByTestId('tailor-ats-keyword');
    expect(within(keyword).getByText('54')).toBeTruthy();
    expect(within(keyword).getByText('81')).toBeTruthy();
    expect(asShown(screen.getByTestId('tailor-ats-keyword-delta'))).toBe('[up] +27');
    expect(screen.getByTestId('tailor-ats-band').textContent).toBe('Reads well');
    expect(asShown(screen.getByTestId('tailor-ats-bullets-delta'))).toBe('[up] +22');
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
    expect(asShown(delta)).toBe('[down] -4');
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

/**
 * L-362: the table's marks are drawn (`StateMark`), not typed, so they look
 * the same on every machine. OK, Check and Missing are a tick, a warning and a
 * cross; a rise and a fall are an up and a down arrow — five shapes, not five
 * colours. A drawn mark is hidden from a screen reader, so what one hears is
 * the words and numbers beside it, and each mark's hint, as before.
 */
describe('AtsStep draws its marks (L-362)', () => {
  const MIXED: AtsComparison = {
    ...BASE,
    checks: [
      { ...BASE.checks[0]!, before: 'warn', after: 'pass' },
      { ...BASE.checks[1]!, before: 'pass', after: 'warn' },
      { ...BASE.checks[2]!, before: 'fail', after: 'fail' },
    ],
  };

  /** Each check row's before and after cells, as shown. */
  function checkCells(): string[][] {
    return ['section_headers', 'contact_info', 'cv_length'].map((id) =>
      [...screen.getByTestId(`tailor-ats-check-${id}`).querySelectorAll('td')]
        .slice(0, 2)
        .map(asShown),
    );
  }

  it('happy: OK is a tick, Check a warning, Missing a cross — each before its word', () => {
    renderStep(MIXED);
    expect(checkCells()).toEqual([
      ['[warning] Check', '[tick] OK'],
      ['[tick] OK', '[warning] Check'],
      ['[cross] Missing', '[cross] Missing'],
    ]);
  });

  it('the five marks are five different shapes, and none carries a colour of its own', () => {
    renderStep({ ...MIXED, bullets: { ...BASE.bullets, after: 38, delta: -3 } });
    const shapes = new Map<string, string>();
    for (const mark of screen.getByTestId('tailor-ats').querySelectorAll('[data-mark]')) {
      shapes.set(mark.getAttribute('data-mark')!, mark.innerHTML);
      expect(mark.getAttribute('class') ?? '').not.toMatch(/\btext-/);
    }
    expect([...shapes.keys()].sort()).toEqual(['cross', 'down', 'tick', 'up', 'warning']);
    expect(new Set(shapes.values()).size).toBe(5);
  });

  it('no mark is typed any more', () => {
    renderStep({ ...MIXED, bullets: { ...BASE.bullets, after: 38, delta: -3 } });
    expect(screen.getByTestId('tailor-ats').textContent).not.toMatch(/[✓⚠✗✕▲▼]/);
  });

  it('negative: a score that did not change shows no arrow', () => {
    renderStep({
      ...BASE,
      keyword: { ...BASE.keyword, after: 54, delta: 0 },
      bullets: { ...BASE.bullets, after: 41, delta: 0 },
    });
    for (const id of ['tailor-ats-keyword-delta', 'tailor-ats-bullets-delta']) {
      expect(asShown(screen.getByTestId(id))).toBe('no change');
      expect(screen.getByTestId(id).querySelector('[data-mark]')).toBeNull();
    }
  });

  it('negative: a score that could not be measured shows no arrow either, only the dash', () => {
    renderStep({
      ...BASE,
      keyword: { ...BASE.keyword, after: null, delta: null, afterReason: 'The CV is empty.' },
    });
    expect(asShown(screen.getByTestId('tailor-ats-keyword-delta'))).toBe('—');
  });

  it('boundary: a rise of exactly one point is one up arrow and "+1"', () => {
    renderStep({ ...BASE, keyword: { ...BASE.keyword, after: 55, delta: 1 } });
    const delta = screen.getByTestId('tailor-ats-keyword-delta');
    expect(asShown(delta)).toBe('[up] +1');
    const hint = delta.querySelector('[aria-describedby]')!;
    expect(document.getElementById(hint.getAttribute('aria-describedby')!)!.textContent).toBe(
      'Up 1 point on your original CV: better.',
    );
  });

  it('boundary: a fall of exactly one point is one down arrow and "-1"', () => {
    renderStep({ ...BASE, keyword: { ...BASE.keyword, after: 53, delta: -1 } });
    const delta = screen.getByTestId('tailor-ats-keyword-delta');
    expect(asShown(delta)).toBe('[down] -1');
    const hint = delta.querySelector('[aria-describedby]')!;
    expect(document.getElementById(hint.getAttribute('aria-describedby')!)!.textContent).toBe(
      'Down 1 point on your original CV: worse.',
    );
  });

  it('boundary: every row missing, before and after — a cross in every cell', () => {
    renderStep({
      ...BASE,
      checks: BASE.checks.map((check) => ({ ...check, before: 'fail', after: 'fail' })),
    });
    expect(checkCells()).toEqual([
      ['[cross] Missing', '[cross] Missing'],
      ['[cross] Missing', '[cross] Missing'],
      ['[cross] Missing', '[cross] Missing'],
    ]);
    expect(screen.getByTestId('tailor-ats-fixes').querySelectorAll('li')).toHaveLength(3);
  });

  it('screen readers hear the same words: every mark is hidden, the words and hints stay', () => {
    renderStep({ ...MIXED, bullets: { ...BASE.bullets, after: 38, delta: -3 } });
    const step = screen.getByTestId('tailor-ats');
    const marks = [...step.querySelectorAll('[data-mark]')];
    expect(marks).toHaveLength(8); // two arrows and six status marks
    for (const mark of marks) {
      expect(mark.closest('[aria-hidden="true"]')).not.toBeNull();
      expect(mark.querySelector('[tabindex]')).toBeNull();
      // The focus stop is the hint's "i" button, after the mark and its word (L-384).
      const hint = mark.closest('[aria-describedby]')!;
      expect(hint.hasAttribute('tabindex')).toBe(false);
      expect(hint.querySelector('button[aria-label="What this means"]')).not.toBeNull();
    }
    // What a screen reader reads in each cell: the words and numbers, no mark.
    const read = (id: string) => screen.getByTestId(id).textContent;
    expect(read('tailor-ats-keyword-delta')).toBe(' +27');
    expect(read('tailor-ats-bullets-delta')).toBe(' -3');
    expect(
      [...screen.getByTestId('tailor-ats-check-cv_length').querySelectorAll('td')]
        .slice(0, 2)
        .map((cell) => cell.textContent),
    ).toEqual([' Missing', ' Missing']);
  });
});
