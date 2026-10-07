// @vitest-environment jsdom
/**
 * The tracker card's small step bar (L-200): the dots, what a screen reader
 * hears, and where Continue goes — pressed by mouse and by keyboard.
 */
import { cleanup, render, screen } from '@testing-library/react';
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
