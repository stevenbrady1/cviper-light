// @vitest-environment jsdom
/**
 * The one link to Ollama's download page (L-240): what it opens, how it is
 * named for a screen reader, and what happens when the browser will not open.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { createFakeBrowserPort } from '../../platform/test/fakeBrowserPort';

import { OllamaDownloadLink } from './OllamaDownloadLink';
import { OLLAMA_DOWNLOAD_URL } from './providers';

afterEach(() => cleanup());

describe('OllamaDownloadLink', () => {
  it('opens the download page, byte for byte, in the browser', async () => {
    const user = userEvent.setup();
    const browser = createFakeBrowserPort();
    render(<OllamaDownloadLink idPrefix="x" browser={browser} />);

    await user.click(screen.getByRole('button', { name: 'Open Ollama’s download page' }));

    expect(browser.opened()).toEqual([OLLAMA_DOWNLOAD_URL]);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says it opens in the browser, so nobody expects it inside the app', () => {
    render(<OllamaDownloadLink idPrefix="x" browser={createFakeBrowserPort()} />);
    expect(screen.getByTestId('x-ollama-link').parentElement?.textContent).toContain(
      'Opens in your browser.',
    );
  });

  it('negative: a browser that will not open says so instead of doing nothing', async () => {
    const user = userEvent.setup();
    const browser = createFakeBrowserPort();
    browser.failNext();
    render(<OllamaDownloadLink idPrefix="x" browser={browser} />);

    await user.click(screen.getByTestId('x-ollama-link'));

    expect((await screen.findByRole('alert')).textContent).toBeTruthy();
  });
});
