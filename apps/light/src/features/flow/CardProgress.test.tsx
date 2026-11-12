// @vitest-environment jsdom
/**
 * The tracker card's small step bar (L-200): the dots, what a screen reader
 * hears, and where Continue goes — pressed by mouse and by keyboard.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FLOW_HINT } from '../../app/hints';
import { CardProgress } from './CardProgress';
import { type JobProgress, type StepId } from './steps';

afterEach(() => {
  cleanup();
});

/** The drawn marks inside `element`, in order (L-360). */
function marksIn(element: Element): (string | null)[] {
  return [...element.querySelectorAll('[data-mark]')].map((mark) => mark.getAttribute('data-mark'));
}

function renderProgress(progress: JobProgress) {
  const onContinue = vi.fn<(step: StepId) => void>();
  render(<CardProgress applicationId="app-1" progress={progress} onContinue={onContinue} />);
  return { onContinue, user: userEvent.setup() };
}

describe('CardProgress', () => {
  it('happy: analysed and tailored shows ●●●○○ and Continue goes to ATS Score', async () => {
    const { onContinue, user } = renderProgress({
      analysed: true,
      tailored: true,
      exported: false,
    });
    const row = screen.getByTestId('tracker-card-progress-app-1');

    expect(marksIn(row)).toEqual(['dot', 'dot', 'dot', 'ring', 'ring']);
    expect(row.textContent).toContain('3 of 5 steps done. Next: ATS Score.');
    await user.click(screen.getByTestId('tracker-card-continue-app-1'));
    expect(onContinue).toHaveBeenCalledWith('ats');
  });

  it('says where Continue goes, to a screen reader, in its name', () => {
    renderProgress({ analysed: true, tailored: false, exported: false });
    expect(screen.getByRole('button', { name: 'Continue: Tailor' })).toBeTruthy();
  });

  it('works by keyboard', async () => {
    const { onContinue, user } = renderProgress({
      analysed: true,
      tailored: false,
      exported: false,
    });
    await user.tab();
    expect(document.activeElement).toBe(screen.getByTestId('tracker-card-continue-app-1'));
    await user.keyboard('{Enter}');
    expect(onContinue).toHaveBeenCalledWith('tailor');
  });

  it('boundary: everything done is ●●●●● and opens on Export', async () => {
    const { onContinue, user } = renderProgress({ analysed: true, tailored: true, exported: true });
    expect(screen.getByTestId('tracker-card-progress-app-1').getAttribute('data-done')).toBe('5');
    await user.click(screen.getByTestId('tracker-card-continue-app-1'));
    expect(onContinue).toHaveBeenCalledWith('export');
  });

  it('edge: a skipped Analyse is not a dot filled in', () => {
    renderProgress({ analysed: false, tailored: true, exported: false });
    expect(marksIn(screen.getByTestId('tracker-card-progress-app-1'))).toEqual([
      'dot',
      'ring',
      'dot',
      'ring',
      'ring',
    ]);
  });
});

/**
 * L-331: the dots never said which step the job is on. The card now says it in
 * words — "Step 3 of 5 · Tailor" — using the step names the step bar uses
 * (`STEPS`), and the step is the one Continue goes to (`continueStep`). The
 * row's accessible name is that same visible line, so what a screen reader
 * hears and what a sighted user reads cannot drift apart.
 */
describe('CardProgress says which step the job is on (L-331)', () => {
  function visibleLine(): HTMLElement {
    return screen.getByTestId('tracker-card-step-app-1');
  }

  it('happy: a job only exported is on Step 2 of 5 · Analyse', () => {
    renderProgress({ analysed: false, tailored: false, exported: true });
    expect(visibleLine().textContent).toBe('Step 2 of 5 · Analyse');
  });

  it('happy: an analysed job is on Step 3 of 5 · Tailor', () => {
    renderProgress({ analysed: true, tailored: false, exported: false });
    expect(visibleLine().textContent).toBe('Step 3 of 5 · Tailor');
  });

  it('a draft not yet exported is on Step 4 of 5 · ATS Score', () => {
    renderProgress({ analysed: true, tailored: true, exported: false });
    expect(visibleLine().textContent).toBe('Step 4 of 5 · ATS Score');
  });

  it('boundary: everything done is Step 5 of 5 · Export, where Continue goes', () => {
    renderProgress({ analysed: true, tailored: true, exported: true });
    expect(visibleLine().textContent).toBe('Step 5 of 5 · Export');
  });

  it('the row’s accessible name is exactly the visible line', () => {
    renderProgress({ analysed: true, tailored: false, exported: false });
    const row = screen.getByRole('group', { name: 'Step 3 of 5 · Tailor' });
    expect(row).toBe(screen.getByTestId('tracker-card-progress-app-1'));
    expect(visibleLine().textContent).toBe('Step 3 of 5 · Tailor');
    // Visible: not the screen-reader-only class.
    expect(visibleLine().className).not.toContain('sr-only');
  });

  it('the dots stay decoration, hidden from a screen reader', () => {
    renderProgress({ analysed: true, tailored: false, exported: false });
    const row = screen.getByTestId('tracker-card-progress-app-1');
    expect(marksIn(row)).toEqual(['dot', 'dot', 'ring', 'ring', 'ring']);
    for (const dot of row.querySelectorAll('[data-mark]')) {
      expect(dot.closest('[aria-hidden="true"]')).not.toBeNull();
    }
    // One row of dots, as the typed "●●○○○" was one piece of text.
    const parents = new Set(
      [...row.querySelectorAll('[data-mark]')].map((dot) => dot.parentElement),
    );
    expect(parents.size).toBe(1);
  });

  it('Continue keeps its own name and behaviour inside the row', async () => {
    const { onContinue, user } = renderProgress({
      analysed: true,
      tailored: false,
      exported: false,
    });
    const row = screen.getByRole('group', { name: 'Step 3 of 5 · Tailor' });
    await user.click(within(row).getByRole('button', { name: 'Continue: Tailor' }));
    expect(onContinue).toHaveBeenCalledWith('tailor');
  });

  it('negative: progress with missing fields says no "undefined" and no "NaN"', () => {
    renderProgress({} as JobProgress);
    const text = screen.getByTestId('tracker-card-progress-app-1').textContent ?? '';
    expect(text).not.toMatch(/undefined|NaN|null/);
    expect(visibleLine().textContent).toMatch(/^Step [1-5] of 5 · \S/);
  });
});

/**
 * L-360: the dots are drawn (`StateMark`), not typed, so they look the same on
 * every machine. A step done is a filled dot and a step not done an empty
 * ring — two shapes, not two colours — and what a screen reader hears is
 * unchanged: the dots are hidden from it, and the words beside them stay.
 */
describe('CardProgress draws its dots (L-360)', () => {
  it('the dots’ hint no longer quotes a typed dot the card does not show', () => {
    expect(FLOW_HINT.cardDots).not.toMatch(/[●○]/);
  });

  it('no dot is typed any more', () => {
    renderProgress({ analysed: true, tailored: true, exported: false });
    expect(screen.getByTestId('tracker-card-progress-app-1').textContent).not.toMatch(/[●○]/);
  });

  it('done and not done are two different shapes, in the same colour', () => {
    renderProgress({ analysed: true, tailored: false, exported: false });
    const row = screen.getByTestId('tracker-card-progress-app-1');
    const [done, notDone] = [
      row.querySelector('[data-mark="dot"]')!,
      row.querySelector('[data-mark="ring"]')!,
    ];
    expect(done.innerHTML).not.toBe(notDone.innerHTML);
    expect(done.parentElement).toBe(notDone.parentElement);
  });

  it('negative: a card with no progress has only Find filled in, and says so in words', () => {
    renderProgress({ analysed: false, tailored: false, exported: false });
    const row = screen.getByTestId('tracker-card-progress-app-1');
    expect(marksIn(row)).toEqual(['dot', 'ring', 'ring', 'ring', 'ring']);
    expect(row.getAttribute('data-done')).toBe('1');
    expect(row.textContent).toContain('1 of 5 steps done. Next: Analyse.');
  });

  it('boundary: all five steps done is five filled dots', () => {
    renderProgress({ analysed: true, tailored: true, exported: true });
    const row = screen.getByTestId('tracker-card-progress-app-1');
    expect(marksIn(row)).toEqual(['dot', 'dot', 'dot', 'dot', 'dot']);
    expect(row.textContent).toContain('5 of 5 steps done. Next: Export.');
  });

  it('screen readers hear the same words as before', () => {
    renderProgress({ analysed: true, tailored: true, exported: false });
    expect(screen.getByRole('group', { name: 'Step 4 of 5 · ATS Score' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Continue: ATS Score' })).toBeTruthy();
    expect(screen.getByText('3 of 5 steps done. Next: ATS Score.').className).toContain('sr-only');
  });

  it('the dots keep their explanation, and still take no Tab stop', () => {
    renderProgress({ analysed: true, tailored: false, exported: false });
    const row = screen.getByTestId('tracker-card-progress-app-1');
    const holder = row.querySelector('[data-mark]')!.closest('[aria-describedby]')!;
    const tip = document.getElementById(holder.getAttribute('aria-describedby')!)!;
    expect(tip.getAttribute('role')).toBe('tooltip');
    expect(tip.textContent).toBe(FLOW_HINT.cardDots);
    expect(holder.hasAttribute('tabindex')).toBe(false);
  });
});

/**
 * L-319: the button keeps its short visible word, "Continue" — the line just
 * above it already says the step in words ("Step 4 of 5 · ATS Score", L-331),
 * and the long form never fitted beside the dots. Where it goes is in its
 * accessible name, "Continue: ATS Score", the same step the line above names.
 */
describe('Continue reads "Continue" and is named for its step (L-319)', () => {
  function button(): HTMLElement {
    return screen.getByTestId('tracker-card-continue-app-1');
  }

  it('happy: an analysed job’s button reads "Continue", named "Continue: Tailor"', () => {
    renderProgress({ analysed: true, tailored: false, exported: false });
    expect(button().textContent).toBe('Continue');
    expect(screen.getByRole('button', { name: 'Continue: Tailor' })).toBe(button());
  });

  it('boundary: everything done still shows the button, enabled, named "Continue: Export"', () => {
    renderProgress({ analysed: true, tailored: true, exported: true });
    expect(button().textContent).toBe('Continue');
    expect(screen.getByRole('button', { name: 'Continue: Export' })).toBe(button());
    expect((button() as HTMLButtonElement).disabled).toBe(false);
    expect(button().getAttribute('aria-disabled')).toBeNull();
  });

  it('negative: for all 8 progress states the word is "Continue" and the name is the step the line above says', () => {
    for (const analysed of [false, true]) {
      for (const tailored of [false, true]) {
        for (const exported of [false, true]) {
          renderProgress({ analysed, tailored, exported });
          const state = JSON.stringify({ analysed, tailored, exported });
          expect(button().textContent, state).toBe('Continue');
          const step = /^Step [1-5] of 5 · (.+)$/.exec(
            screen.getByTestId('tracker-card-step-app-1').textContent ?? '',
          )?.[1];
          expect(['Analyse', 'Tailor', 'ATS Score', 'Export'], state).toContain(step);
          expect(screen.getByRole('button', { name: `Continue: ${String(step)}` }), state).toBe(
            button(),
          );
          cleanup();
        }
      }
    }
  });

  it('a click fires Continue once, with the step its name says', async () => {
    const { onContinue, user } = renderProgress({
      analysed: true,
      tailored: true,
      exported: false,
    });
    await user.click(screen.getByRole('button', { name: 'Continue: ATS Score' }));
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onContinue).toHaveBeenCalledWith('ats');
  });
});
