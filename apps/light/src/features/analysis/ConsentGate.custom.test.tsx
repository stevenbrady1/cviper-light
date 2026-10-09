// @vitest-environment jsdom
/**
 * The consent dialog for L-150's typed-address service. CViper cannot name it,
 * may not have a key for it, and must still say plainly that this is the
 * moment the CV leaves.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConsentGate, ConsentStatus } from './ConsentGate';

afterEach(() => {
  cleanup();
});

describe('ConsentGate — the typed-address service (L-150)', () => {
  it('asks in a sentence that reads as one, and says where the address came from', () => {
    render(<ConsentGate kind="custom" onAccept={vi.fn()} onDecline={vi.fn()} />);

    const dialog = screen.getByTestId('analysis-consent-gate');
    expect(screen.getByRole('heading').textContent).toBe('Send this CV to your AI service?');
    expect(dialog.textContent).toContain('the address you added in Settings');
    expect(dialog.textContent).toContain('CV');
    expect(dialog.textContent).toContain('advert');
    expect(screen.getByTestId('analysis-consent-accept').textContent).toBe(
      'Send to your AI service',
    );
  });

  it('negative: does not claim a key was used — a service on your own network may have none', () => {
    render(<ConsentGate kind="custom" onAccept={vi.fn()} onDecline={vi.fn()} />);
    expect(screen.getByTestId('analysis-consent-gate').textContent).not.toContain('API key');
    expect(screen.getByTestId('analysis-consent-gate').textContent).not.toContain('Your AI');
  });

  it('negative: a named provider keeps its own wording', () => {
    render(<ConsentGate kind="mistral" onAccept={vi.fn()} onDecline={vi.fn()} />);
    const dialog = screen.getByTestId('analysis-consent-gate');
    expect(dialog.textContent).toContain('API key');
    expect(dialog.textContent).not.toContain('address you added');
  });

  it('accepts and declines like any other provider', async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn();
    const onDecline = vi.fn();
    render(<ConsentGate kind="custom" onAccept={onAccept} onDecline={onDecline} />);

    await user.click(screen.getByTestId('analysis-consent-accept'));
    expect(onAccept).toHaveBeenCalledTimes(1);
    await user.click(screen.getByTestId('analysis-consent-decline'));
    expect(onDecline).toHaveBeenCalledTimes(1);
  });

  it('the withdraw list starts its sentence with the capitalised name', () => {
    render(<ConsentStatus granted={['custom']} onWithdraw={vi.fn()} />);
    expect(document.body.textContent).toContain(
      'Your AI service can receive your CV and the adverts you check it against.',
    );
  });
});
