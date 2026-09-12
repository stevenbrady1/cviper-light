// @vitest-environment jsdom
/**
 * The consent dialog (Apple 5.1.2(i)) and the reachable withdraw list.
 *
 * ============================================================================
 * FOCUS LANDS ON "NOT NOW", NOT ON "SEND TO X"
 * ============================================================================
 * Same reasoning as `ConfirmDelete.tsx`, the app's other blocking dialog: a
 * stray Enter must not send anyone's CV anywhere. Escape is the same answer as
 * clicking "Not now".
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConsentGate, ConsentStatus } from './ConsentGate';

afterEach(() => {
  cleanup();
});

describe('ConsentGate', () => {
  it('names the provider and says what leaves the machine, under whose key', async () => {
    render(<ConsentGate kind="openai" onAccept={vi.fn()} onDecline={vi.fn()} />);

    const dialog = screen.getByTestId('analysis-consent-gate');
    expect(dialog.textContent).toContain('OpenAI');
    expect(dialog.textContent).toContain('CV');
    expect(dialog.textContent).toContain('advert');
    expect(dialog.textContent).toContain('API key');
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it('boundary: names Anthropic, never OpenAI, when that is the provider asking', () => {
    render(<ConsentGate kind="anthropic" onAccept={vi.fn()} onDecline={vi.fn()} />);

    const dialog = screen.getByTestId('analysis-consent-gate');
    expect(dialog.textContent).toContain('Anthropic');
    expect(dialog.textContent).not.toContain('OpenAI');
  });

  it('accepting calls onAccept and nothing else', async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn();
    const onDecline = vi.fn();
    render(<ConsentGate kind="openai" onAccept={onAccept} onDecline={onDecline} />);

    await user.click(screen.getByTestId('analysis-consent-accept'));

    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onDecline).not.toHaveBeenCalled();
  });

  it('negative: declining calls onDecline, never onAccept — nothing is sent', async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn();
    const onDecline = vi.fn();
    render(<ConsentGate kind="openai" onAccept={onAccept} onDecline={onDecline} />);

    await user.click(screen.getByTestId('analysis-consent-decline'));

    expect(onDecline).toHaveBeenCalledTimes(1);
    expect(onAccept).not.toHaveBeenCalled();
  });

  it('focus lands on Not now, not on Send — a stray Enter must not consent', async () => {
    render(<ConsentGate kind="openai" onAccept={vi.fn()} onDecline={vi.fn()} />);

    await vi.waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId('analysis-consent-decline')),
    );
  });

  it('Escape declines, the same as clicking Not now', async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn();
    const onDecline = vi.fn();
    render(<ConsentGate kind="openai" onAccept={onAccept} onDecline={onDecline} />);

    await user.keyboard('{Escape}');

    expect(onDecline).toHaveBeenCalledTimes(1);
    expect(onAccept).not.toHaveBeenCalled();
  });
});

describe('ConsentStatus', () => {
  it('is absent entirely when nothing has been granted', () => {
    render(<ConsentStatus granted={[]} onWithdraw={vi.fn()} />);
    expect(screen.queryByTestId('analysis-consent-status')).toBeNull();
  });

  it('lists a granted provider with a reachable withdraw affordance', async () => {
    const user = userEvent.setup();
    const onWithdraw = vi.fn();
    render(<ConsentStatus granted={['openai']} onWithdraw={onWithdraw} />);

    const row = screen.getByTestId('analysis-consent-status-openai');
    expect(row.textContent).toContain('OpenAI');

    await user.click(screen.getByTestId('analysis-consent-withdraw-openai'));
    expect(onWithdraw).toHaveBeenCalledWith('openai');
  });

  it('boundary: granting one provider lists only that one, not the other', () => {
    render(<ConsentStatus granted={['anthropic']} onWithdraw={vi.fn()} />);

    expect(screen.getByTestId('analysis-consent-status-anthropic')).toBeTruthy();
    expect(screen.queryByTestId('analysis-consent-status-openai')).toBeNull();
  });

  it('lists both, each with its own withdraw button, when both are granted', async () => {
    const user = userEvent.setup();
    const onWithdraw = vi.fn();
    render(<ConsentStatus granted={['anthropic', 'openai']} onWithdraw={onWithdraw} />);

    await user.click(screen.getByTestId('analysis-consent-withdraw-anthropic'));
    expect(onWithdraw).toHaveBeenCalledWith('anthropic');

    await user.click(screen.getByTestId('analysis-consent-withdraw-openai'));
    expect(onWithdraw).toHaveBeenCalledWith('openai');
  });
});
