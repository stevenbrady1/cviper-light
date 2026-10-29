// @vitest-environment jsdom
/**
 * The tracker card's small step bar (L-200): the dots, what a screen reader
 * hears, and where Continue goes — pressed by mouse and by keyboard.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CardProgress } from './CardProgress';
import { type JobProgress, type StepId } from './steps';

afterEach(() => {
  cleanup();
});

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

    expect(row.textContent).toContain('●●●○○');
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
    expect(screen.getByTestId('tracker-card-progress-app-1').textContent).toContain('●○●○○');
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
    const dots = screen.getByText('●●○○○');
    expect(dots.closest('[aria-hidden="true"]')).not.toBeNull();
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
