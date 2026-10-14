// @vitest-environment jsdom
/**
 * Tailor's Ollama hint (L-240): plain words and a link to the download page,
 * not a terminal command — and only in the one state it has always spoken in.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));

const { Tailor } = await import('./Tailor');
const { createFakeTailorPort } = await import('./test/fakePort');
const { createFakeConsentPort } = await import('../analysis/test/fakeConsentPort');
const { createFakeFilePort } = await import('../../platform/test/fakeFilePort');
const { createFakeBrowserPort } = await import('../../platform/test/fakeBrowserPort');
const { OLLAMA_DOWNLOAD_URL } = await import('../analysis/providers');

const EMBEDDER_ONLY = JSON.stringify({
  models: [
    {
      model: 'nomic-embed-text:latest',
      name: 'nomic-embed-text:latest',
      details: { family: 'nomic-bert' },
    },
  ],
});

function probeAnswers(tags: string | null): void {
  tauri.invoke.mockImplementation(async (command) => {
    if (command === 'ollama_probe') return tags;
    if (command === 'secret_status') return false;
    throw new Error(`unexpected command: ${command}`);
  });
}

beforeEach(() => {
  tauri.invoke.mockReset();
});
afterEach(() => cleanup());

function renderTailor(browser = createFakeBrowserPort()) {
  render(
    <Tailor
      port={createFakeTailorPort()}
      filePort={createFakeFilePort()}
      consentPort={createFakeConsentPort()}
      browser={browser}
    />,
  );
  return browser;
}

describe('the Ollama hint on Tailor', () => {
  it('says what to do in plain words, and the link opens the download page', async () => {
    probeAnswers(EMBEDDER_ONLY);
    const user = userEvent.setup();
    const browser = renderTailor();

    const hint = await screen.findByTestId('tailor-ollama-hint');
    expect(hint.textContent).toContain('add a chat model in it');
    expect(hint.textContent).not.toContain('ollama pull');

    await user.click(within(hint).getByRole('button', { name: 'Open Ollama’s download page' }));
    expect(browser.opened()).toEqual([OLLAMA_DOWNLOAD_URL]);
  });

  it('negative: no hint and no link with no Ollama at all — no advert on every launch', async () => {
    probeAnswers(null);
    renderTailor();

    await screen.findByText('No local model or key set up');
    expect(screen.queryByTestId('tailor-ollama-hint')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open Ollama’s download page' })).toBeNull();
  });
});
