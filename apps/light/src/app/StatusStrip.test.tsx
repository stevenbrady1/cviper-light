// @vitest-environment jsdom
/**
 * The rail's AI row (L-182): which cloud AI providers this machine has a key
 * for, answered without opening Settings.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type EnvironmentStatus, NO_AI_KEYS } from '../status/environment';

import { statusDotHint } from './hints';
import { Sidebar } from './Sidebar';
import { StatusStrip } from './StatusStrip';

afterEach(() => {
  cleanup();
});

function status(ai: Partial<EnvironmentStatus['ai']> = {}): EnvironmentStatus {
  return {
    ollama: 'absent',
    adzuna: 'missing',
    reed: 'missing',
    ai: { ...NO_AI_KEYS, ...ai },
    requestsToday: 0,
  };
}

describe('the AI row of the status strip', () => {
  it('names each provider that has a saved key, with a teal dot', () => {
    render(<StatusStrip status={status({ google: 'configured', mistral: 'configured' })} />);

    const gemini = screen.getByTestId('status-ai-google');
    expect(gemini.textContent).toContain('Gemini');
    expect(gemini.getAttribute('data-state')).toBe('configured');
    expect(gemini.querySelector('[aria-hidden="true"]')?.className).toContain('bg-teal');
    expect(screen.getByTestId('status-ai-mistral').textContent).toContain('Mistral');
  });

  it('leaves out providers with no key, so the rail does not list six grey names', () => {
    render(<StatusStrip status={status({ google: 'configured' })} />);

    expect(screen.queryByTestId('status-ai-openai')).toBeNull();
    expect(screen.queryByTestId('status-ai-openrouter')).toBeNull();
    expect(screen.queryByTestId('status-ai-none')).toBeNull();
  });

  it('boundary: with no AI key at all the AI row is left out entirely (L-191)', () => {
    render(<StatusStrip status={status({ google: 'configured' })} />);
    expect(screen.getByTestId('status-ai-google')).toBeTruthy();

    cleanup();
    render(<StatusStrip status={status()} />);
    expect(screen.queryByTestId('status-ai-none')).toBeNull();
    expect(screen.queryByTestId(/^status-ai-/)).toBeNull();
  });

  it('negative: a key the store cannot read shows gold, because it needs the user', () => {
    render(<StatusStrip status={status({ openai: 'unreadable' })} />);

    const openai = screen.getByTestId('status-ai-openai');
    expect(openai.getAttribute('data-state')).toBe('unreadable');
    expect(openai.querySelector('[aria-hidden="true"]')?.className).toContain('bg-gold');
  });

  it('before the first read, shows no rows and no "nothing set up" line', () => {
    render(<StatusStrip status={null} />);

    expect(screen.queryByTestId('status-ai-none')).toBeNull();
    expect(screen.queryByTestId('status-none')).toBeNull();
    expect(screen.getByTestId('status-requests')).toBeTruthy();
  });

  it('tells a screen reader each state in words, not only by colour', () => {
    render(<StatusStrip status={status({ anthropic: 'configured' })} />);

    expect(screen.getByTestId('status-ai-anthropic').textContent).toContain('key saved');
  });
});

/**
 * L-191: the list shows what IS set up, and nothing else.
 *
 * The owner reversed the old "three quiet grey dots" rule: a list of things
 * that are not there is clutter. Two states still show, because they need the
 * user rather than describe an absence — a half-entered Adzuna and a key the
 * credential store will not read (gold). And an empty list is never left
 * empty: one line says so and offers the way to Settings.
 */
describe('the set-up list shows only what is configured (L-191)', () => {
  it('shows a running Ollama and a saved key, and hides everything missing', () => {
    render(
      <StatusStrip
        status={{ ...status({ google: 'configured' }), ollama: 'running', reed: 'configured' }}
      />,
    );

    expect(screen.getByTestId('status-ollama').getAttribute('data-state')).toBe('running');
    expect(screen.getByTestId('status-reed').getAttribute('data-state')).toBe('configured');
    expect(screen.getByTestId('status-ai-google')).toBeTruthy();
    expect(screen.queryByTestId('status-adzuna')).toBeNull();
    expect(screen.queryByTestId('status-none')).toBeNull();
  });

  it('negative: an absent Ollama and missing keys are not drawn at all', () => {
    render(<StatusStrip status={{ ...status({ openai: 'configured' }) }} />);

    expect(screen.queryByTestId('status-ollama')).toBeNull();
    expect(screen.queryByTestId('status-adzuna')).toBeNull();
    expect(screen.queryByTestId('status-reed')).toBeNull();
  });

  it('keeps a half-entered Adzuna and an unreadable key, because they need the user', () => {
    render(<StatusStrip status={{ ...status(), adzuna: 'incomplete', reed: 'unreadable' }} />);

    const adzuna = screen.getByTestId('status-adzuna');
    expect(adzuna.getAttribute('data-state')).toBe('incomplete');
    expect(adzuna.querySelector('[aria-hidden="true"]')?.className).toContain('bg-gold');
    expect(screen.getByTestId('status-reed').getAttribute('data-state')).toBe('unreadable');
    expect(screen.queryByTestId('status-none')).toBeNull();
  });

  it('boundary: one search board set up shows alone, without a stray separator', () => {
    render(<StatusStrip status={{ ...status(), adzuna: 'configured' }} />);

    const row = screen.getByTestId('status-adzuna').parentElement;
    expect(row?.textContent).not.toContain('·');
    expect(screen.queryByTestId('status-reed')).toBeNull();
  });

  it('with nothing set up, says so in one quiet line — never an alert', () => {
    render(<StatusStrip status={status()} onOpenSettings={() => undefined} />);

    const none = screen.getByTestId('status-none');
    expect(none.textContent).toContain('Nothing set up yet');
    expect(screen.queryAllByRole('alert')).toEqual([]);
    expect(screen.getByTestId('status-requests')).toBeTruthy();
  });

  it('the "Settings" link in that line opens Settings', async () => {
    const onOpenSettings = vi.fn();
    render(<StatusStrip status={status()} onOpenSettings={onOpenSettings} />);

    await userEvent.setup().click(screen.getByTestId('status-none-settings'));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('boundary: without a way to open Settings, the line stays but offers no dead button', () => {
    render(<StatusStrip status={status()} />);

    expect(screen.getByTestId('status-none')).toBeTruthy();
    expect(screen.queryByTestId('status-none-settings')).toBeNull();
  });
});

describe('the side menu labels are words in Inter, not small mono capitals (L-432)', () => {
  function classesOf(element: Element): string[] {
    return element.className.split(/\s+/);
  }

  it('happy: the footer heading reads "Set up", with no CSS capitals, for screen readers only (S1)', () => {
    render(<StatusStrip status={status()} />);

    const heading = screen.getByRole('heading', { name: 'Set up' });
    expect(heading.textContent).toBe('Set up');
    expect(classesOf(heading)).toContain('sr-only');
    expect(classesOf(heading)).not.toContain('font-mono');
    expect(classesOf(heading)).not.toContain('uppercase');
  });

  it('happy: each "Ctrl N" hint is in the menu font, text-xs, and still shown', () => {
    render(<Sidebar activeView="tracker" onSelect={() => undefined} status={null} />);

    const hints = [...screen.getByTestId('sidebar').querySelectorAll('button span')].filter(
      (span) => /^Ctrl \d$/.test(span.textContent),
    );
    expect(hints.length).toBeGreaterThanOrEqual(5);
    for (const hint of hints) {
      expect(classesOf(hint), hint.textContent).toContain('text-xs');
      expect(classesOf(hint), hint.textContent).not.toContain('font-mono');
      // Owner decision: the hints stay visible; only the font changes.
      expect(classesOf(hint), hint.textContent).not.toEqual(
        expect.arrayContaining([expect.stringMatching(/^(hidden|sr-only|invisible)$/)]),
      );
    }
  });

  it('negative: the logo keeps its "LIGHT" in mono capitals, untouched', () => {
    render(<Sidebar activeView="tracker" onSelect={() => undefined} status={null} />);

    const light = [...screen.getByTestId('sidebar').querySelectorAll('p')].find(
      (p) => p.textContent === 'Light',
    );
    expect(light).toBeDefined();
    expect(classesOf(light as Element)).toEqual(expect.arrayContaining(['font-mono', 'uppercase']));
  });
});

/**
 * S1: a quieter menu footer. A teal dot means "ready" and needs nothing from
 * the user, so it loses its "i" (its tip still opens on hover and tap). The
 * "i" stays where it earns its place: "Requests today", a number nobody can
 * guess, and a gold dot, which needs the user.
 */
describe('a quieter footer (S1)', () => {
  const infoButtons = () =>
    within(screen.getByTestId('status-strip')).queryAllByRole('button', {
      name: 'What this means',
    });
  const shownTips = () =>
    screen
      .getAllByRole('tooltip', { hidden: true })
      .filter((tip) => !tip.hidden)
      .map((tip) => tip.textContent);

  it('happy: with Ollama running, the only "i" belongs to "Requests today"', () => {
    render(<StatusStrip status={{ ...status(), ollama: 'running' }} />);

    const buttons = infoButtons();
    expect(buttons).toHaveLength(1);
    expect(screen.getByTestId('status-requests').contains(buttons[0] as Element)).toBe(true);
  });

  it('negative: an unreadable AI key and a half-entered Adzuna keep their "i"', () => {
    render(<StatusStrip status={{ ...status({ openai: 'unreadable' }), adzuna: 'incomplete' }} />);

    for (const testId of ['status-ai-openai', 'status-adzuna']) {
      const mark = screen.getByTestId(testId).parentElement as HTMLElement;
      expect(
        within(mark).queryAllByRole('button', { name: 'What this means' }),
        testId,
      ).toHaveLength(1);
    }
    expect(infoButtons()).toHaveLength(3);
  });

  it("negative: a gold dot's 'i' is still a Tab stop that opens its tip", async () => {
    const user = userEvent.setup();
    render(<StatusStrip status={{ ...status(), adzuna: 'incomplete' }} />);

    await user.tab();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('What this means');
    expect(shownTips()).toEqual([statusDotHint('Adzuna', 'needs its second credential')]);
  });

  it('boundary: five things set up and ready still show exactly one "i"', () => {
    render(
      <StatusStrip
        status={{
          ...status({ google: 'configured', mistral: 'configured' }),
          ollama: 'running',
          adzuna: 'configured',
          reed: 'configured',
        }}
      />,
    );

    expect(screen.getByTestId('status-ollama')).toBeTruthy();
    expect(screen.getByTestId('status-ai-mistral')).toBeTruthy();
    expect(infoButtons()).toHaveLength(1);
  });

  it('boundary: nothing set up shows only the "Requests today" "i"', () => {
    render(<StatusStrip status={status()} />);

    expect(screen.getByTestId('status-none')).toBeTruthy();
    expect(infoButtons()).toHaveLength(1);
  });

  it('boundary: before the first read there is still no "Nothing set up yet" line (L-191)', () => {
    render(<StatusStrip status={null} />);

    expect(screen.queryByTestId('status-none')).toBeNull();
    expect(infoButtons()).toHaveLength(1);
  });

  it('interaction: a click on "Ollama" opens its tip and a second click closes it', async () => {
    const user = userEvent.setup();
    render(<StatusStrip status={{ ...status(), ollama: 'running' }} />);
    const tip = statusDotHint('Ollama', 'running on this machine');

    await user.click(screen.getByText('Ollama'));
    expect(shownTips()).toEqual([tip]);
    await user.click(screen.getByText('Ollama'));
    expect(shownTips()).toEqual([]);
  });

  it('interaction: hovering "Ollama" opens its tip and moving away closes it', async () => {
    const user = userEvent.setup();
    render(<StatusStrip status={{ ...status(), ollama: 'running' }} />);

    await user.hover(screen.getByText('Ollama'));
    expect(shownTips()).toEqual([statusDotHint('Ollama', 'running on this machine')]);
    await user.unhover(screen.getByText('Ollama'));
    expect(shownTips()).toEqual([]);
  });

  it('the heading is still found by its name, and carries sr-only', () => {
    render(<StatusStrip status={{ ...status(), ollama: 'running' }} />);

    expect(screen.getByRole('heading', { name: 'Set up' }).className.split(/\s+/)).toContain(
      'sr-only',
    );
  });
});
