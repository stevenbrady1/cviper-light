// @vitest-environment jsdom
/**
 * Settings → "On this PC" (L-406).
 *
 * Settings listed seven AI companies and never mentioned the AI that runs on
 * the user's own computer — the one option that sends a CV nowhere. This box
 * says what the shell's own check found, in the welcome card's own words
 * (`localModelLine`), so the two screens cannot disagree.
 *
 * The assertions that matter are the negative ones: no "Ready" before the
 * check has answered, none when nothing was found, and none when Ollama is
 * running with nothing that can chat.
 *
 * The box asks nothing itself. `status/environment.test.ts` covers what the
 * check finds, and `app/App.onThisPc.test.tsx` that the shell hands it down.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BrowserPort } from '../../platform/browser';

import type { LocalAi } from './OnThisPc';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));

const { Settings } = await import('./Settings');
const { createFakeUpdatePort } = await import('./updates/test/fakeUpdatePort');
const { createFakeBackupPort } = await import('./test/fakePort');
const { createFakeBrowserPort } = await import('../../platform/test/fakeBrowserPort');
const { OLLAMA_DOWNLOAD_URL } = await import('../analysis/providers');
const { LOOKING_FOR_LOCAL_AI, localModelLine } = await import('../onboarding/cards');
const { OUTBOUND_HOSTS } = await import('../../lib/outbound-hosts');

const NOTHING: LocalAi = { ollama: 'absent' };
const NO_CHAT_MODEL: LocalAi = { ollama: 'running' };
const ONE_MODEL: LocalAi = {
  ollama: 'running',
  ollamaModels: [{ id: 'llama3.2:3b', label: 'llama3.2:3b (3.2B)' }],
};

const NOTHING_FOUND_LINE = 'No AI is running on this PC. The basic CV match works without one.';
const LINK_NAME = 'Open Ollama’s download page';

/** The welcome card's sentence for the same machine: one source for both screens. */
function welcomeLine(localAi: LocalAi): string {
  return localModelLine({
    ollamaRunning: localAi.ollama === 'running',
    ollamaModels: localAi.ollamaModels ?? [],
    anthropicKey: false,
    openaiKey: false,
  });
}

beforeEach(() => {
  localStorage.clear();
  tauri.invoke.mockReset();
  tauri.invoke.mockImplementation(async (command) => {
    if (command === 'secret_status') return false;
    throw new Error(`unexpected command: ${command}`);
  });
});

afterEach(() => {
  cleanup();
});

/** Settings with what the shell found; `undefined` is Settings drawn alone. */
function open(localAi: LocalAi | null | undefined, browser?: BrowserPort) {
  render(
    <Settings
      port={createFakeBackupPort()}
      updatePort={createFakeUpdatePort()}
      mobileOs={null}
      browser={browser ?? createFakeBrowserPort()}
      {...(localAi === undefined ? {} : { localAi })}
    />,
  );
  return screen.getByTestId('settings-on-this-pc');
}

describe('where the box is', () => {
  it('sits between the "works with no key" line and the AI provider keys, under its own heading', () => {
    const box = open(ONE_MODEL);
    const note = screen.getByTestId('settings-free-note');
    const keys = screen.getByTestId('ai-key-setup');

    expect(within(box).getByRole('heading', { name: 'On this PC' })).toBeTruthy();
    expect(note.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(box.compareDocumentPosition(keys) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('asks nothing itself: opening Settings makes no Ollama probe of its own', () => {
    open(ONE_MODEL);

    // A box that asked for itself would grow after Settings had scrolled to a
    // section, and slide it down the screen (L-364).
    expect(tauri.invoke.mock.calls.filter(([command]) => command === 'ollama_probe')).toEqual([]);
  });
});

describe('a chat model was found', () => {
  it('happy: the box says so in the welcome card’s own sentence, and says Ready', () => {
    const box = open(ONE_MODEL);

    expect(screen.getByTestId('on-this-pc-line').textContent).toBe(welcomeLine(ONE_MODEL));
    expect(box.textContent).toContain('llama3.2:3b');
    expect(box.textContent).toContain('Nothing you check will leave your PC.');

    // The label is a word, not a colour alone.
    const pill = screen.getByTestId('on-this-pc-status');
    expect(pill.textContent).toBe('Ready');
    expect(pill.getAttribute('data-tone')).toBe('ready');
  });

  it('negative: it never says "In use", and holds nothing to press', () => {
    const box = open(ONE_MODEL);

    // Which AI reads a CV is chosen on each check, so "In use" could be untrue.
    expect(box.textContent).not.toContain('In use');
    expect(within(box).queryAllByRole('button')).toHaveLength(0);
  });

  it('boundary: two models found names the first, the one Analysis starts on', () => {
    const box = open({
      ollama: 'running',
      ollamaModels: [
        { id: 'qwen2.5:7b', label: 'qwen2.5:7b (7.6B)' },
        { id: 'llama3.2:3b', label: 'llama3.2:3b (3.2B)' },
      ],
    });

    expect(box.textContent).toContain('running qwen2.5:7b.');
    expect(box.textContent).not.toContain('llama3.2:3b');
  });

  it('boundary: a very long model name is shown whole and allowed to wrap', () => {
    const id = `${'verylongmodelname'.repeat(8)}:latest`;
    const box = open({ ollama: 'running', ollamaModels: [{ id, label: id }] });

    const line = screen.getByTestId('on-this-pc-line');
    expect(line.textContent).toContain(id);
    // Unbroken text this long needs leave to break, or it pushes the box wide.
    // WebKit measures the real thing in `e2e/contrast-webkit.spec.ts`.
    expect(line.className).toContain('break-words');
    expect(box.contains(screen.getByTestId('on-this-pc-status'))).toBe(true);
  });
});

describe('Ollama is running with no model that can chat', () => {
  it('says what to do in the existing sentence, with the label and the link', () => {
    const box = open(NO_CHAT_MODEL);

    expect(screen.getByTestId('on-this-pc-line').textContent).toBe(welcomeLine(NO_CHAT_MODEL));
    expect(box.textContent).toContain('add a chat model in it');

    const pill = screen.getByTestId('on-this-pc-status');
    expect(pill.textContent).toBe('Needs a chat model');
    expect(pill.getAttribute('data-tone')).toBe('attention');
    expect(within(box).getByRole('button', { name: LINK_NAME })).toBeTruthy();
  });

  it('boundary: an empty model list reads the same as none', () => {
    open({ ollama: 'running', ollamaModels: [] });

    expect(screen.getByTestId('on-this-pc-status').textContent).toBe('Needs a chat model');
  });

  it('negative: it is not "Ready"', () => {
    const box = open(NO_CHAT_MODEL);

    expect(box.textContent).not.toContain('Ready');
    expect(box.textContent).not.toContain('Nothing you check will leave your PC.');
  });
});

describe('no AI was found on this PC', () => {
  it('the box stays, with the one quiet line and the link — and no label', () => {
    const box = open(NOTHING);

    expect(within(box).getByRole('heading', { name: 'On this PC' })).toBeTruthy();
    expect(screen.getByTestId('on-this-pc-line').textContent).toBe(NOTHING_FOUND_LINE);
    expect(within(box).getByRole('button', { name: LINK_NAME })).toBeTruthy();
    expect(screen.queryByTestId('on-this-pc-status')).toBeNull();
  });

  it('negative: nothing is wrong, so nothing is drawn in a warning colour', () => {
    const box = open(NOTHING);

    expect(box.innerHTML).not.toMatch(/gold|danger/);
    expect(box.textContent).not.toContain('Ready');
  });

  it('negative: a model list with no Ollama running is still "nothing found", never Ready', () => {
    // Cannot come from the real check; a stale or malformed answer must not claim Ready.
    const box = open({ ollama: 'absent', ollamaModels: [{ id: 'ghost', label: 'ghost' }] });

    expect(screen.getByTestId('on-this-pc-line').textContent).toBe(NOTHING_FOUND_LINE);
    expect(box.textContent).not.toContain('Ready');
    expect(box.textContent).not.toContain('ghost');
  });
});

describe('before the check has answered', () => {
  it.each([
    ['the shell has no answer yet', null],
    ['Settings is drawn alone', undefined],
  ])('says it is looking — neither "Ready" nor "No AI": %s', (_name, localAi) => {
    const box = open(localAi);

    expect(within(box).getByRole('heading', { name: 'On this PC' })).toBeTruthy();
    expect(screen.getByTestId('on-this-pc-line').textContent).toBe(LOOKING_FOR_LOCAL_AI);
    expect(box.textContent).not.toContain('Ready');
    expect(box.textContent).not.toContain('No AI is running');
    expect(screen.queryByTestId('on-this-pc-status')).toBeNull();
    expect(within(box).queryByRole('button', { name: LINK_NAME })).toBeNull();
  });
});

describe('the link to Ollama’s download page', () => {
  it('hands the one allow-listed address to the browser port, and nothing else', async () => {
    const user = userEvent.setup();
    const browser = createFakeBrowserPort();
    const box = open(NOTHING, browser);

    await user.click(within(box).getByRole('button', { name: LINK_NAME }));

    expect(browser.opened()).toEqual([OLLAMA_DOWNLOAD_URL]);
    const listed = OUTBOUND_HOSTS.find((entry) => entry.host === new URL(OLLAMA_DOWNLOAD_URL).host);
    expect(listed?.purpose).toBe('opened-in-your-browser');
  });

  it('negative: a browser that will not open is said out loud, not swallowed', async () => {
    const user = userEvent.setup();
    const browser = createFakeBrowserPort();
    browser.failNext();
    const box = open(NOTHING, browser);

    await user.click(within(box).getByRole('button', { name: LINK_NAME }));

    expect((await within(box).findByRole('alert')).textContent).not.toBe('');
    expect(browser.opened()).toEqual([]);
  });
});

describe('Settings keeps no blue button at rest (L-321)', () => {
  it.each([
    ['ready', ONE_MODEL],
    ['no chat model', NO_CHAT_MODEL],
    ['nothing found', NOTHING],
  ])('the box adds none: %s', (_name, localAi) => {
    const box = open(localAi);

    expect(box.innerHTML).not.toMatch(/bg-blue|border-blue|text-blue/);
  });
});
