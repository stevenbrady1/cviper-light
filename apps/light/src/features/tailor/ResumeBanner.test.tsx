// @vitest-environment jsdom
/**
 * The "Continue where you left off" strip (L-199): what it says, and that its
 * two buttons do what they say.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ResumeBanner } from './ResumeBanner';

afterEach(() => {
  cleanup();
});

function renderBanner(title = 'Senior Data Analyst', company = 'Acme Ltd') {
  const onContinue = vi.fn();
  const onDismiss = vi.fn();
  render(
    <ResumeBanner title={title} company={company} onContinue={onContinue} onDismiss={onDismiss} />,
  );
  return { onContinue, onDismiss, user: userEvent.setup() };
}

describe('ResumeBanner', () => {
  it('names the job it would take the user back to', () => {
    renderBanner();
    expect(screen.getByTestId('resume-banner').textContent).toBe(
      'Continue where you left off — Tailor for Senior Data Analyst at Acme Ltd.ContinueNot now',
    );
  });

  it('Continue calls onContinue, and only that', async () => {
    const { onContinue, onDismiss, user } = renderBanner();
    await user.click(screen.getByTestId('resume-continue'));
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('Not now calls onDismiss, and only that', async () => {
    const { onContinue, onDismiss, user } = renderBanner();
    await user.click(screen.getByTestId('resume-dismiss'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onContinue).not.toHaveBeenCalled();
  });

  it('boundary: a job with no company still reads as a sentence', () => {
    renderBanner('Senior Data Analyst', '  ');
    expect(screen.getByTestId('resume-banner').textContent).toContain(
      'Tailor for Senior Data Analyst.',
    );
  });

  it('edge: no title and no company says what is kept instead of "Tailor for ."', () => {
    renderBanner('', '');
    expect(screen.getByTestId('resume-banner').textContent).toContain(
      'Continue where you left off — your tailored CV is still here.',
    );
  });

  it('is never a second primary action on the screen', () => {
    renderBanner();
    expect(document.querySelectorAll('[data-primary="true"]')).toHaveLength(0);
  });
});
