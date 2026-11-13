// @vitest-environment jsdom
/**
 * The ATS Score step's rendering (L-198): before → after, refusals shown as
 * a dash with a reason (never a zero), the "only if it is true" wording beside
 * still-missing words, and the fabrication result repeated on this step.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ATS_HINT } from '../../app/hints';

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
      // A result cell's hint opens on hover and tap, with no "i" and no Tab
      // stop: the "i" is on the row and column labels (L-384, owner decision).
      const hint = mark.closest('[aria-describedby]')!;
      expect(hint.hasAttribute('tabindex')).toBe(false);
      expect(hint.querySelector('button')).toBeNull();
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

/**
 * Which hints carry the "i" (L-384, owner decision 12 Nov 2026): the labels —
 * the heading, the column headers, the row labels and the two line labels
 * under the table. The result cells (status, change, band, the no-score dash)
 * open their hint on hover and tap, with no "i": an "i" in every cell made the
 * table about nineteen icons busy, and on a phone it dropped onto its own line.
 */
describe('the "i" is on the labels, not the results (L-384)', () => {
  const I = 'button[aria-label="What this means"]';

  /** The tip a hint on `element` (or around it) points at. */
  function tipOf(element: Element): HTMLElement {
    const id = element.closest('[aria-describedby]')?.getAttribute('aria-describedby') ?? '';
    const tip = document.getElementById(id);
    if (tip === null) throw new Error('no hint here');
    return tip;
  }

  it('happy: the heading, both column headers, every row label and both line labels have an "i"', () => {
    renderStep(BASE, { clean: false, flagged: 1 });
    const step = screen.getByTestId('tailor-ats');
    const labelled = [
      step.querySelector('#tailor-ats-heading')!,
      ...step.querySelectorAll('thead th:not(:first-child)'),
      ...step.querySelectorAll('[data-testid="tailor-ats-bars"] > li > :first-child'),
      ...step.querySelectorAll('tbody th'),
      screen.getByTestId('tailor-ats-missing'),
      screen.getByTestId('tailor-ats-fabrication'),
    ];
    expect(labelled.map((element) => element.textContent?.trim())).toEqual([
      'ATS score',
      'Before',
      'After',
      'Keyword coverage',
      'Bullet strength',
      'Structure & sections',
      'Contact details',
      'Length',
      expect.stringContaining('Still missing from the advert:'),
      expect.stringContaining('Fabrication check:'),
    ]);
    for (const element of labelled) expect(element.querySelectorAll(I)).toHaveLength(1);
    expect(step.querySelectorAll(I)).toHaveLength(labelled.length);
  });

  it('negative: no result cell — status, change, band — holds a button', () => {
    renderStep({ ...BASE, checks: BASE.checks.map((check) => ({ ...check, before: 'fail' })) });
    // The table's six status cells; each bar line (word, bar, number, band
    // word) and each change, beside the bars.
    const cells = [
      ...screen.getByTestId('tailor-ats').querySelectorAll('tbody td'),
      ...screen.getByTestId('tailor-ats-bars').querySelectorAll('li > :not(:first-child)'),
      screen.getByTestId('tailor-ats-band'),
    ];
    expect(cells.length).toBeGreaterThanOrEqual(13);
    for (const cell of cells) expect(cell.querySelector('button')).toBeNull();
  });

  it('negative boundary: the no-score dash and "no change" hold no button either', () => {
    renderStep({
      ...BASE,
      keyword: { before: null, after: null, delta: null, beforeReason: 'x', afterReason: 'y' },
      bullets: { ...BASE.bullets, after: 41, delta: 0 },
    });
    const bars = screen.getByTestId('tailor-ats-bars');
    expect(within(bars).getAllByText('—').length).toBeGreaterThanOrEqual(3);
    expect(within(bars).getByText('no change')).toBeTruthy();
    expect(bars.querySelectorAll('li > :not(:first-child) button')).toHaveLength(0);
  });

  it("a click on a status cell's words opens its tip, and a second click closes it", () => {
    renderStep();
    const cell = screen.getByTestId('tailor-ats-check-contact_info').querySelectorAll('td')[0]!;
    const words = within(cell).getByText('Check');
    expect(tipOf(words).hidden).toBe(true);
    fireEvent.click(words);
    expect(tipOf(words).hidden).toBe(false);
    fireEvent.click(words);
    expect(tipOf(words).hidden).toBe(true);
  });

  it('hovering a change or the band word still shows its tip', () => {
    renderStep();
    for (const element of [
      within(screen.getByTestId('tailor-ats-keyword-delta')).getByText('+27'),
      screen.getByTestId('tailor-ats-band').firstElementChild!,
    ]) {
      fireEvent.mouseEnter(element);
      expect(tipOf(element).hidden).toBe(false);
      fireEvent.mouseLeave(element);
      expect(tipOf(element).hidden).toBe(true);
    }
  });
});

/**
 * L-396: the two number rows — Keyword coverage and Bullet strength — are drawn
 * as a Before bar and an After bar above the table, each as wide as its number.
 * A bar is decoration: hidden from a screen reader, which hears the words and
 * numbers beside it, in the order a sighted person reads them.
 */
describe('the bars (L-396)', () => {
  const LINES = ['keyword-before', 'keyword-after', 'bullets-before', 'bullets-after'] as const;
  const line = (id: string) => screen.getByTestId(`tailor-ats-${id}`);
  const track = (id: string) => screen.queryByTestId(`tailor-ats-${id}-track`);
  const bar = (id: string) => screen.queryByTestId(`tailor-ats-${id}-bar`);

  /** What a screen reader reads, in order: no hidden parts, no tips, no "i" buttons. */
  function spoken(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
    if (!(node instanceof Element)) return '';
    if (node.getAttribute('aria-hidden') === 'true') return '';
    if (node.getAttribute('role') === 'tooltip' || node.tagName === 'BUTTON') return '';
    return [...node.childNodes].map(spoken).join(' ');
  }
  const said = (element: Element) => spoken(element).replace(/\s+/g, ' ').trim();

  it('happy: each number row draws a Before bar and an After bar, each as wide as its number', () => {
    renderStep();
    expect(LINES.map((id) => bar(id)?.style.width)).toEqual(['54%', '81%', '41%', '63%']);
    for (const id of LINES) {
      expect(track(id)!.contains(bar(id))).toBe(true);
      expect(line(id).contains(track(id))).toBe(true);
    }
    expect(within(line('keyword-before')).getByText('Before')).toBeTruthy();
    expect(within(line('keyword-before')).getByText('54')).toBeTruthy();
    expect(within(line('keyword-after')).getByText('After')).toBeTruthy();
    expect(within(line('keyword-after')).getByText('81')).toBeTruthy();
    expect(within(line('keyword-after')).getByTestId('tailor-ats-band').textContent).toBe(
      'Reads well',
    );
    expect(within(line('bullets-before')).getByText('41')).toBeTruthy();
    expect(within(line('bullets-after')).getByText('63')).toBeTruthy();
  });

  it('happy: a rise draws a teal After bar, a fall a gold one, no change a muted one', () => {
    renderStep({ ...BASE, bullets: { ...BASE.bullets, after: 38, delta: -3 } });
    const tones = () => LINES.map((id) => bar(id)!.className.match(/\bbg-[\w-]+/g));
    expect(tones()).toEqual([['bg-ink-muted'], ['bg-teal'], ['bg-ink-muted'], ['bg-gold']]);
    cleanup();

    renderStep({
      ...BASE,
      keyword: { ...BASE.keyword, after: 54, delta: 0 },
      bullets: { ...BASE.bullets, after: 41, delta: 0 },
    });
    expect(tones()).toEqual([
      ['bg-ink-muted'],
      ['bg-ink-muted'],
      ['bg-ink-muted'],
      ['bg-ink-muted'],
    ]);
    // Nothing red, nothing blue, on any bar or track.
    for (const id of LINES) {
      expect(`${track(id)!.className} ${bar(id)!.className}`).not.toMatch(/red|blue|navy|danger/);
    }
  });

  it('negative: a score that could not be measured draws no bar, only the dash', () => {
    renderStep({
      ...BASE,
      keyword: { before: null, after: null, delta: null, beforeReason: 'x', afterReason: 'y' },
    });
    for (const id of ['keyword-before', 'keyword-after']) {
      // No track at all: an empty one would read as a 0.
      expect(track(id)).toBeNull();
      expect(bar(id)).toBeNull();
      const dash = within(line(id)).getByText('—');
      const tip = document.getElementById(dash.getAttribute('aria-describedby') ?? '');
      expect(tip?.textContent).toBe(ATS_HINT.noScore);
    }
    expect(screen.queryByTestId('tailor-ats-band')).toBeNull();
    // The other row still draws its bars.
    expect(bar('bullets-before')?.style.width).toBe('41%');
  });

  it('negative: no bar is read by a screen reader', () => {
    renderStep();
    for (const id of LINES) {
      expect(track(id)!.closest('[aria-hidden="true"]')).not.toBeNull();
      expect(track(id)!.textContent).toBe('');
      expect(track(id)!.querySelector('[tabindex], button')).toBeNull();
    }
    // The words and numbers, in reading order: label, Before, After, change.
    expect(said(screen.getByTestId('tailor-ats-keyword'))).toBe(
      'Keyword coverage Before 54 After 81 Reads well +27',
    );
    expect(said(screen.getByTestId('tailor-ats-bullets'))).toBe(
      'Bullet strength Before 41 After 63 +22',
    );
    // "Before" and "After" on the bar lines are plain words: no hint, no "i".
    for (const id of LINES) {
      const word = line(id).firstElementChild!;
      expect(word.textContent).toMatch(/^(Before|After)$/);
      expect(word.closest('[aria-describedby]')).toBeNull();
      expect(word.querySelector('[aria-describedby], button')).toBeNull();
    }
  });

  it('boundary: 0 draws an empty track and the number 0', () => {
    renderStep({
      ...BASE,
      keyword: { ...BASE.keyword, before: 0, delta: 81 },
      bullets: { ...BASE.bullets, before: 0, delta: 63 },
    });
    for (const id of ['keyword-before', 'bullets-before']) {
      expect(track(id)).not.toBeNull();
      expect(bar(id)?.style.width).toBe('0%');
      expect(within(line(id)).getByText('0')).toBeTruthy();
      expect(within(line(id)).queryByText('—')).toBeNull();
    }
  });

  it('boundary: 100 fills the track and does not spill out', () => {
    renderStep({
      ...BASE,
      keyword: { ...BASE.keyword, after: 100, delta: 46 },
      bullets: { ...BASE.bullets, after: 100, delta: 59 },
    });
    for (const id of ['keyword-after', 'bullets-after']) {
      expect(bar(id)?.style.width).toBe('100%');
      // The track clips what it holds, and holds only the bar.
      expect(track(id)!.className).toMatch(/\boverflow-hidden\b/);
      expect([...track(id)!.children]).toEqual([bar(id)]);
      expect(within(line(id)).getByText('100')).toBeTruthy();
    }
  });

  it('edge: a draft with no bullets: Bullet strength shows the dash and the no-bullets line', () => {
    renderStep({
      ...BASE,
      bullets: { before: 41, after: 0, delta: -41, totalBefore: 4, totalAfter: 0 },
    });
    expect(track('bullets-after')).toBeNull();
    expect(within(line('bullets-after')).getByText('—')).toBeTruthy();
    expect(within(line('bullets-after')).queryByText('0')).toBeNull();
    expect(screen.getByTestId('tailor-ats-bullets-delta').textContent).toBe('—');
    expect(screen.getByTestId('tailor-ats-no-bullets')).toBeTruthy();
    // The original CV had bullets: its bar is still drawn.
    expect(bar('bullets-before')?.style.width).toBe('41%');
  });

  it('the table holds only the three checks, in three columns', () => {
    renderStep();
    const table = screen.getByRole('table', { name: 'ATS readiness before and after tailoring' });
    expect([...table.querySelectorAll('thead th')].map((th) => th.textContent)).toEqual([
      'Check',
      'Before',
      'After',
    ]);
    const rows = [...table.querySelectorAll('tbody tr')];
    expect(rows.map((row) => row.getAttribute('data-testid'))).toEqual([
      'tailor-ats-check-section_headers',
      'tailor-ats-check-contact_info',
      'tailor-ats-check-cv_length',
    ]);
    for (const row of rows) {
      expect(row.children).toHaveLength(3);
      expect(row.querySelectorAll('th')).toHaveLength(1);
    }
    // The number rows are above the table, not in it; the bars keep the table's width cap.
    const bars = screen.getByTestId('tailor-ats-bars');
    expect(table.contains(screen.getByTestId('tailor-ats-keyword'))).toBe(false);
    expect(table.contains(screen.getByTestId('tailor-ats-bullets'))).toBe(false);
    expect(bars.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(bars.className).toMatch(/\bmax-w-lg\b/);
  });
});
