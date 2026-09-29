// @vitest-environment jsdom
/**
 * The rail's AI row (L-182): which cloud AI providers this machine has a key
 * for, answered without opening Settings.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { type EnvironmentStatus, NO_AI_KEYS } from '../status/environment';

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

  it('boundary: with no AI key at all it shows one quiet "AI keys" dot, not a warning', () => {
    render(<StatusStrip status={status()} />);

    const none = screen.getByTestId('status-ai-none');
    expect(none.textContent).toContain('AI keys');
    expect(none.getAttribute('data-state')).toBe('missing');
    expect(none.querySelector('[aria-hidden="true"]')?.className).not.toContain('bg-gold');
    expect(none.textContent).toContain('no AI key saved');
  });

  it('negative: a key the store cannot read shows gold, because it needs the user', () => {
    render(<StatusStrip status={status({ openai: 'unreadable' })} />);

    const openai = screen.getByTestId('status-ai-openai');
    expect(openai.getAttribute('data-state')).toBe('unreadable');
    expect(openai.querySelector('[aria-hidden="true"]')?.className).toContain('bg-gold');
  });

  it('before the first read, shows the quiet empty row rather than guessing', () => {
    render(<StatusStrip status={null} />);

    expect(screen.getByTestId('status-ai-none')).toBeTruthy();
  });

  it('tells a screen reader each state in words, not only by colour', () => {
    render(<StatusStrip status={status({ anthropic: 'configured' })} />);

    expect(screen.getByTestId('status-ai-anthropic').textContent).toContain('key saved');
  });
});
