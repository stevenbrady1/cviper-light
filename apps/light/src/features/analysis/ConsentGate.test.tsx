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
import { useState } from 'react';
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

  // L-296 (from L-234): CVs often carry details an employer does not need —
  // health is special-category data under UK GDPR. The box says so, calmly,
  // at the one moment the user can still act on it.
  describe('the private-details tip (L-296)', () => {
    it('names the details and says they can be taken out first', () => {
      render(<ConsentGate kind="openai" onAccept={vi.fn()} onDecline={vi.fn()} />);

      const tip = screen.getByTestId('analysis-consent-sensitive');
      expect(tip.textContent).toMatch(/date of birth/);
      expect(tip.textContent).toMatch(/health/);
      expect(tip.textContent).toMatch(/nationality/);
      expect(tip.textContent).toMatch(/take them out of your CV before you send it/);
    });

    it('is read out with the question: the dialog is described by it', () => {
      render(<ConsentGate kind="openai" onAccept={vi.fn()} onDecline={vi.fn()} />);

      const dialog = screen.getByTestId('analysis-consent-gate');
      const ids = (dialog.getAttribute('aria-describedby') ?? '').split(/\s+/);
      expect(ids).toContain(screen.getByTestId('analysis-consent-sensitive').id);
    });

    // BOUNDARY — a typed-address service may be on the user's own network, but
    // the CV still leaves this app, so the tip is shown there too.
    it('boundary: is shown for a service at an address the user added', () => {
      render(<ConsentGate kind="custom" onAccept={vi.fn()} onDecline={vi.fn()} />);

      expect(screen.getByTestId('analysis-consent-sensitive')).toBeTruthy();
    });

    // NEGATIVE — a tip, not a warning: nothing is wrong, and nobody did
    // anything. Only the CV's TEXT is sent, so a photo is never mentioned.
    it('negative: is not an alert, does not mention a photo, and changes no answer', async () => {
      const user = userEvent.setup();
      const onAccept = vi.fn();
      render(<ConsentGate kind="openai" onAccept={onAccept} onDecline={vi.fn()} />);

      const tip = screen.getByTestId('analysis-consent-sensitive');
      expect(tip.getAttribute('role')).toBeNull();
      expect(tip.textContent).not.toMatch(/photo/i);
      expect(document.activeElement).toBe(screen.getByTestId('analysis-consent-decline'));
      await user.click(screen.getByTestId('analysis-consent-accept'));
      expect(onAccept).toHaveBeenCalledTimes(1);
    });
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

describe('ConsentGate keeps focus while it is open (L-236)', () => {
  function Host() {
    const [open, setOpen] = useState(false);
    return (
      <div>
        <button type="button" data-testid="opener" onClick={() => setOpen(true)}>
          Check my CV
        </button>
        <button type="button" data-testid="behind">
          Behind
        </button>
        {open ? (
          <ConsentGate kind="openai" onAccept={vi.fn()} onDecline={() => setOpen(false)} />
        ) : null}
      </div>
    );
  }

  it('Tab from the last button stays inside the dialog', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(screen.getByTestId('opener'));
    screen.getByTestId('analysis-consent-accept').focus();

    await user.tab();

    expect(document.activeElement).toBe(screen.getByTestId('analysis-consent-decline'));
  });

  it('returns focus to the opener when it closes', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(screen.getByTestId('opener'));

    await user.click(screen.getByTestId('analysis-consent-decline'));

    expect(document.activeElement).toBe(screen.getByTestId('opener'));
  });
});
