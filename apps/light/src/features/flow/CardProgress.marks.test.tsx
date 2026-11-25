// @vitest-environment jsdom
/**
 * L-464 — a tracker card speaks the step bar's marks.
 *
 * The card's line says "Step 3 of 5 · Tailor": the step Continue opens. Its
 * dots used to count steps done, with a filled dot for "done", while the big
 * step bar (`JobStepBar`) uses a filled dot for "you are here". So one mark
 * meant two things, and "Step 3" sat over two filled dots. Now the card uses
 * the step bar's own marks: a tick for done, the filled dot for the step
 * Continue opens, an empty ring for still to do, a struck-through ring for
 * skipped. The filled dot is always the step the line names.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FLOW_HINT } from '../../app/hints';
import { CardProgress } from './CardProgress';
import { STEPS, type JobProgress, type StepId } from './steps';

afterEach(() => {
  cleanup();
});

function marks(): (string | null)[] {
  return [...screen.getByTestId('tracker-card-progress-app-1').querySelectorAll('[data-mark]')].map(
    (mark) => mark.getAttribute('data-mark'),
  );
}

function renderProgress(progress: JobProgress) {
  const onContinue = vi.fn<(step: StepId) => void>();
  render(<CardProgress applicationId="app-1" progress={progress} onContinue={onContinue} />);
  return { onContinue, user: userEvent.setup() };
}

/** "Step N of 5 · Name" → N. */
function position(): number {
  const text = screen.getByTestId('tracker-card-step-app-1').textContent ?? '';
  const match = /^Step ([1-5]) of 5 · /.exec(text);
  if (match === null) throw new Error(`no step line: ${text}`);
  return Number(match[1]);
}

const ALL_STATES: JobProgress[] = [false, true].flatMap((analysed) =>
  [false, true].flatMap((tailored) =>
    [false, true].map((exported) => ({ analysed, tailored, exported })),
  ),
);

describe('a tracker card speaks the step bar’s marks (L-464)', () => {
  it('happy: an analysed job, on Step 3 of 5, shows ✓✓●○○', () => {
    renderProgress({ analysed: true, tailored: false, exported: false });
    expect(position()).toBe(3);
    expect(marks()).toEqual(['tick', 'tick', 'dot', 'ring', 'ring']);
  });

  it('happy: for all 8 progress states there is exactly one dot, at the step the line names', () => {
    for (const progress of ALL_STATES) {
      renderProgress(progress);
      const state = JSON.stringify(progress);
      const drawn = marks();
      expect(
        drawn.filter((mark) => mark === 'dot'),
        state,
      ).toHaveLength(1);
      expect(drawn.indexOf('dot'), state).toBe(position() - 1);
      cleanup();
    }
  });

  it('negative: a brand-new job (only found) shows ✓●○○○, never a filled dot for done', () => {
    renderProgress({ analysed: false, tailored: false, exported: false });
    expect(marks()).toEqual(['tick', 'dot', 'ring', 'ring', 'ring']);
  });

  it('negative: tailored but never analysed shows Analyse struck through, not empty', () => {
    renderProgress({ analysed: false, tailored: true, exported: false });
    expect(marks()).toEqual(['tick', 'skipped', 'tick', 'dot', 'ring']);
  });

  it('boundary: everything done is ✓✓✓✓●, with the dot on Export, where Continue opens', () => {
    renderProgress({ analysed: true, tailored: true, exported: true });
    expect(marks()).toEqual(['tick', 'tick', 'tick', 'tick', 'dot']);
    // Export still counts as done in the words a screen reader hears.
    const row = screen.getByTestId('tracker-card-progress-app-1');
    expect(row.getAttribute('data-done')).toBe('5');
    expect(row.textContent).toContain('5 of 5 steps done. Next: Export.');
  });

  it('boundary: exported but not analysed shows ✓●○○✓, and Export still counts as done', () => {
    renderProgress({ analysed: false, tailored: false, exported: true });
    expect(marks()).toEqual(['tick', 'dot', 'ring', 'ring', 'tick']);
    const row = screen.getByTestId('tracker-card-progress-app-1');
    expect(row.getAttribute('data-done')).toBe('2');
    expect(row.textContent).toContain('2 of 5 steps done. Next: Analyse.');
  });

  it('interaction: Continue opens the step whose mark is the dot', async () => {
    const { onContinue, user } = renderProgress({
      analysed: true,
      tailored: true,
      exported: false,
    });
    const dotAt = marks().indexOf('dot');
    await user.click(screen.getByTestId('tracker-card-continue-app-1'));
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onContinue).toHaveBeenCalledWith(STEPS[dotAt]?.id);
  });

  it('the dots’ ⓘ explains every mark the card can draw', () => {
    expect(FLOW_HINT.cardDots).toBe(
      'How far this job has got: one mark for each step — Find, Analyse, Tailor, ATS Score, ' +
        'Export. A tick is done, the filled dot is the step Continue opens, an empty ring is ' +
        'still to do, and a struck-through ring was skipped.',
    );
  });
});
