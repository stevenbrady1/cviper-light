// @vitest-environment jsdom
/**
 * One drawn fold mark (L-462): the chevron "Where to look" drew, now shared by
 * Settings' "Job-board keys (optional)" fold and every key row.
 *
 * Settings puts folds inside a fold: the Reed and Adzuna rows sit inside
 * "Job-board keys". A mark that turns when ANY outer `.group` is open
 * (`group-open:`) would turn the closed rows' marks too. So the mark turns only
 * when its OWN fold is open: `details[open] > summary > mark`. jsdom loads no
 * Tailwind, so these tests read the selector out of the class and ask the DOM
 * which marks it matches. The real turn is measured in WebKit
 * (`e2e/contrast-webkit.spec.ts`).
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { createFakeBoardPort } from '../features/boards/test/fakeBoardPort';
import { KeyRow } from '../features/settings/keys/KeyRow';
import { createFakeKeyPort } from '../features/settings/keys/test/fakeKeyPort';
import { Settings } from '../features/settings/Settings';
import { createFakeBackupPort } from '../features/settings/test/fakePort';
import { createFakeFilePort } from '../platform/test/fakeFilePort';

import { FoldMark } from './Chevrons';

afterEach(cleanup);

const TURN = '[details[open]>summary>&]:rotate-90';

/** The fold's own mark: the first child of its title, hidden, with one drawing. */
function markOf(fold: HTMLElement): HTMLElement {
  const summary = fold.querySelector(':scope > summary');
  const mark = summary?.firstElementChild;
  if (!(mark instanceof HTMLElement)) throw new Error('the fold has no title mark');
  return mark;
}

/** Whether the turn's own selector picks this mark, as the built CSS would. */
function turned(mark: HTMLElement): boolean {
  const variant = /^\[(.+)\]:rotate-90$/.exec(TURN)?.[1] ?? '';
  return mark.matches(variant.replaceAll('&', '*'));
}

function renderSettings() {
  const user = userEvent.setup();
  render(
    <Settings
      port={createFakeBackupPort()}
      filePort={createFakeFilePort()}
      boardsPort={createFakeBoardPort()}
      keyPort={createFakeKeyPort()}
      now={new Date('2026-08-19T09:00:00.000Z')}
    />,
  );
  return { user };
}

function keysFold(): HTMLDetailsElement {
  return screen.getByTestId('settings-advanced') as HTMLDetailsElement;
}

/** Every fold this PR draws a mark on: "Job-board keys" and each key row. */
function settingsFolds(): HTMLElement[] {
  return [
    keysFold(),
    ...screen.getAllByTestId(
      /^(ai-key-row-(?!model-).+|custom-service-row|key-row-(reed|adzuna))$/,
    ),
  ];
}

describe('FoldMark (L-462)', () => {
  it('happy: one hidden span holding one svg, that turns only with its own fold, with no animation', () => {
    const { container } = render(<FoldMark testId="probe-mark" />);
    const mark = container.firstElementChild as HTMLElement;
    expect(mark.tagName).toBe('SPAN');
    expect(mark.getAttribute('aria-hidden')).toBe('true');
    expect(mark.dataset.testid).toBe('probe-mark');
    expect(mark.querySelectorAll('svg')).toHaveLength(1);
    expect(mark.className.split(' ')).toContain(TURN);
    expect(mark.className).not.toMatch(/transition|duration|animate/);
  });

  it('negative: it adds no words and no Tab stop, and never turns with an outer group', () => {
    const { container } = render(<FoldMark />);
    expect(container.textContent).toBe('');
    expect(container.querySelector('[tabindex], button, a, input, select')).toBeNull();
    expect(container.innerHTML).not.toContain('group-open:');
    expect((container.firstElementChild as HTMLElement).hasAttribute('data-testid')).toBe(false);
  });
});

describe('Settings folds draw the shared mark, not the browser’s (L-462)', () => {
  it('happy: "Job-board keys" and every key row draw one hidden mark and switch the browser’s off', () => {
    renderSettings();
    const folds = settingsFolds();
    // Six AI providers, your own service, and the two job boards, plus the fold.
    expect(folds).toHaveLength(10);
    for (const fold of folds) {
      const summary = fold.querySelector(':scope > summary')!;
      const name = fold.dataset.testid;
      const classes = summary.className.split(' ');
      expect(classes, name).toEqual(
        expect.arrayContaining(['list-none', '[&::-webkit-details-marker]:hidden']),
      );
      // Nothing is left for the old size-the-browser's-mark fix to size (L-364).
      expect(classes, name).not.toContain('marker:text-sm');
      const mark = markOf(fold);
      expect(mark.getAttribute('aria-hidden'), name).toBe('true');
      expect(mark.className.split(' '), name).toContain(TURN);
      expect(summary.querySelectorAll(':scope > span[aria-hidden="true"] svg'), name).toHaveLength(
        1,
      );
    }
  });

  it('negative: the names are unchanged (the mark adds no words), and nothing turns with a group', () => {
    renderSettings();
    const summary = within(keysFold()).getByText('Job-board keys (optional)');
    expect(summary.tagName).toBe('SUMMARY');
    expect(screen.getByRole('heading', { name: 'Reed' })).toBeTruthy();
    expect(keysFold().classList.contains('group')).toBe(false);
    expect(document.body.innerHTML).not.toContain('group-open:');
  });

  it('boundary: a closed key row inside an open fold keeps its mark unturned', () => {
    render(
      <details open data-testid="outer">
        <summary>
          <FoldMark />
          Outer
        </summary>
        <KeyRow cardTestId="probe-card" rowTestId="probe-row" name="Acme" pill={null}>
          <p>inside</p>
        </KeyRow>
      </details>,
    );
    expect(turned(markOf(screen.getByTestId('outer')))).toBe(true);
    expect(turned(markOf(screen.getByTestId('probe-row')))).toBe(false);
  });

  it('interaction: opening "Job-board keys" turns its mark only; the Reed row stays closed; closing turns it back', async () => {
    const { user } = renderSettings();
    const reed = screen.getByTestId('key-row-reed') as HTMLDetailsElement;
    expect(turned(markOf(keysFold()))).toBe(false);

    await user.click(within(keysFold()).getByText('Job-board keys (optional)'));
    expect(keysFold().open).toBe(true);
    expect(turned(markOf(keysFold()))).toBe(true);
    expect(reed.open).toBe(false);
    expect(turned(markOf(reed))).toBe(false);

    await user.click(reed.querySelector('summary')!);
    expect(reed.open).toBe(true);
    expect(turned(markOf(reed))).toBe(true);

    await user.click(within(keysFold()).getByText('Job-board keys (optional)'));
    expect(keysFold().open).toBe(false);
    expect(turned(markOf(keysFold()))).toBe(false);
  });
});
