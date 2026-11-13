// @vitest-environment jsdom
/**
 * Settings → "On this PC" (L-406).
 *
 * Settings listed seven AI companies and never mentioned the AI that runs on
 * the user's own computer — the one option that sends a CV nowhere. This box
 * reads the same live answer the welcome card reads and says it in the same
 * words (`localModelLine`), so the two cannot disagree.
 *
 * The assertions that matter are the negative ones: no "Ready" before the
 * probe has answered, none when it failed, and none when Ollama is running
 * with nothing that can chat.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BrowserPort } from '../../platform/browser';
import type { Availability } from '../analysis/providers';

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

const NOTHING: Availability = {
  ollamaRunning: false,
  ollamaModels: [],
  anthropicKey: false,
  openaiKey: false,
};

const ONE_MODEL: Availability = {
  ...NOTHING,
  ollamaRunning: true,
  ollamaModels: [{ id: 'llama3.2:3b', label: 'llama3.2:3b (3.2B)' }],
};

const NO_CHAT_MODEL: Availability = { ...NOTHING, ollamaRunning: true };

const NOTHING_FOUND_LINE = 'No AI is running on this PC. The basic CV match works without one.';
const LINK_NAME = 'Open Ollama’s download page';

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

function open(detect: () => Promise<Availability>, browser?: BrowserPort) {
  render(
    <Settings
      port={createFakeBackupPort()}
      updatePort={createFakeUpdatePort()}
      mobileOs={null}
      browser={browser ?? createFakeBrowserPort()}
      detectAvailability={detect}
    />,
  );
  return screen.getByTestId('settings-on-this-pc');
}

/** The box once the probe has answered and the box has said so. */
async function answered(availability: Availability, browser?: BrowserPort) {
  const box = open(() => Promise.resolve(availability), browser);
  await vi.waitFor(() => expect(box.textContent).not.toContain(LOOKING_FOR_LOCAL_AI));
  return box;
}

describe('where the box is', () => {
  it('sits between the "works with no key" line and the AI provider keys, under its own heading', async () => {
    const box = await answered(ONE_MODEL);
    const note = screen.getByTestId('settings-free-note');
    const keys = screen.getByTestId('ai-key-setup');

    expect(within(box).getByRole('heading', { name: 'On this PC' })).toBeTruthy();
    expect(note.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(box.compareDocumentPosition(keys) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('a chat model was found', () => {
  it('happy: the box says so in the welcome card’s own sentence, and says Ready', async () => {
    const box = await answered(ONE_MODEL);

    expect(screen.getByTestId('on-this-pc-line').textContent).toBe(localModelLine(ONE_MODEL));
    expect(box.textContent).toContain('llama3.2:3b');
    expect(box.textContent).toContain('Nothing you check will leave your PC.');

    // The label is a word, not a colour alone.
    const pill = screen.getByTestId('on-this-pc-status');
    expect(pill.textContent).toBe('Ready');
    expect(pill.getAttribute('data-tone')).toBe('ready');
  });

  it('negative: it never says "In use", and holds nothing to press', async () => {
    const box = await answered(ONE_MODEL);

    // Which AI reads a CV is chosen on each check, so "In use" could be untrue.
    expect(box.textContent).not.toContain('In use');
    expect(within(box).queryAllByRole('button')).toHaveLength(0);
    expect(within(box).queryByRole('button', { name: LINK_NAME })).toBeNull();
  });

  it('boundary: two models found names the first, the one Analysis starts on', async () => {
    const two: Availability = {
      ...ONE_MODEL,
      ollamaModels: [
        { id: 'qwen2.5:7b', label: 'qwen2.5:7b (7.6B)' },
        { id: 'llama3.2:3b', label: 'llama3.2:3b (3.2B)' },
      ],
    };
    const box = await answered(two);

    expect(box.textContent).toContain('running qwen2.5:7b.');
    expect(box.textContent).not.toContain('llama3.2:3b');
  });

  it('boundary: a very long model name is shown whole and allowed to wrap', async () => {
    const id = `${'verylongmodelname'.repeat(8)}:latest`;
    const box = await answered({ ...ONE_MODEL, ollamaModels: [{ id, label: id }] });

    const line = screen.getByTestId('on-this-pc-line');
    expect(line.textContent).toContain(id);
    // Unbroken text this long needs leave to break, or it pushes the box wide.
    expect(line.className).toContain('break-words');
    expect(box.contains(screen.getByTestId('on-this-pc-status'))).toBe(true);
  });
});

describe('Ollama is running with no model that can chat', () => {
  it('says what to do in the existing sentence, with the label and the link', async () => {
    const box = await answered(NO_CHAT_MODEL);

    expect(screen.getByTestId('on-this-pc-line').textContent).toBe(localModelLine(NO_CHAT_MODEL));
    expect(box.textContent).toContain('add a chat model in it');

    const pill = screen.getByTestId('on-this-pc-status');
    expect(pill.textContent).toBe('Needs a chat model');
    expect(pill.getAttribute('data-tone')).toBe('attention');
    expect(within(box).getByRole('button', { name: LINK_NAME })).toBeTruthy();
  });

  it('negative: it is not "Ready"', async () => {
    const box = await answered(NO_CHAT_MODEL);

    expect(box.textContent).not.toContain('Ready');
    expect(box.textContent).not.toContain('Nothing you check will leave your PC.');
  });
});

describe('no AI was found on this PC', () => {
  it('the box stays, with the one quiet line and the link — and no label', async () => {
    const box = await answered(NOTHING);

    expect(within(box).getByRole('heading', { name: 'On this PC' })).toBeTruthy();
    expect(screen.getByTestId('on-this-pc-line').textContent).toBe(NOTHING_FOUND_LINE);
    expect(within(box).getByRole('button', { name: LINK_NAME })).toBeTruthy();
    expect(screen.queryByTestId('on-this-pc-status')).toBeNull();
  });

  it('negative: nothing is wrong, so nothing is drawn in a warning colour', async () => {
    const box = await answered(NOTHING);

    expect(box.innerHTML).not.toMatch(/gold|danger/);
    expect(box.textContent).not.toContain('Ready');
  });

  it('negative: a saved AI key does not change what this PC has', async () => {
    // `localModelLine` goes on to talk about saved keys. This box is about the
    // computer, so a key must not turn "no AI on this PC" into something else.
    const box = await answered({ ...NOTHING, anthropicKey: true, openaiKey: true });

    expect(screen.getByTestId('on-this-pc-line').textContent).toBe(NOTHING_FOUND_LINE);
    expect(box.textContent).not.toContain('key');
  });

  it('negative: a probe that fails reads as nothing found, never as Ready', async () => {
    const box = open(() => Promise.reject(new Error('the probe broke')));

    await vi.waitFor(() =>
      expect(screen.getByTestId('on-this-pc-line').textContent).toBe(NOTHING_FOUND_LINE),
    );
    expect(box.textContent).not.toContain('Ready');
    expect(screen.queryByTestId('on-this-pc-status')).toBeNull();
  });
});

describe('before the probe has answered', () => {
  it('says it is looking — neither "Ready" nor "No AI"', () => {
    const box = open(() => new Promise<Availability>(() => undefined));

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
    const box = await answered(NOTHING, browser);

    await user.click(within(box).getByRole('button', { name: LINK_NAME }));

    expect(browser.opened()).toEqual([OLLAMA_DOWNLOAD_URL]);
    const listed = OUTBOUND_HOSTS.find((entry) => entry.host === new URL(OLLAMA_DOWNLOAD_URL).host);
    expect(listed?.purpose).toBe('opened-in-your-browser');
  });

  it('negative: a browser that will not open is said out loud, not swallowed', async () => {
    const user = userEvent.setup();
    const browser = createFakeBrowserPort();
    browser.failNext();
    const box = await answered(NOTHING, browser);

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
  ])('the box adds none: %s', async (_name, availability) => {
    const box = await answered(availability);

    expect(box.innerHTML).not.toMatch(/bg-blue|border-blue|text-blue/);
  });
});
