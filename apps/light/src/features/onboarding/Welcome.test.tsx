// @vitest-environment jsdom
/**
 * The first screen a new user sees.
 *
 * The assertions that matter here are about honesty and escape: every card says
 * whether it works now, the one that needs nothing is actionable before
 * anything is detected, nothing claims a local model that is not there, the
 * examples never pass for the user's own data, and there is always a way out
 * that does not require reading.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OLLAMA_DOWNLOAD_URL, type Availability } from '../analysis/providers';
import { createFakeBrowserPort } from '../../platform/test/fakeBrowserPort';

import { Welcome } from './Welcome';

const NOTHING: Availability = {
  ollamaRunning: false,
  ollamaModels: [],
  anthropicKey: false,
  openaiKey: false,
};

const OLLAMA_WITH_MODEL: Availability = {
  ...NOTHING,
  ollamaRunning: true,
  ollamaModels: [{ id: 'llama3.2:3b', label: 'llama3.2:3b (3.2B)' }],
};

/** A detection that never resolves, for asserting the pre-detection state. */
function pending(): () => Promise<Availability> {
  return () => new Promise<Availability>(() => undefined);
}

afterEach(() => {
  cleanup();
});

describe('the top of the page', () => {
  it('leads with the brand row and the new headline', async () => {
    render(<Welcome onDismiss={() => undefined} detect={() => Promise.resolve(NOTHING)} />);

    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe(
      'Your job hunt, organised.',
    );
    expect(screen.getByText('Pick where to start. You can try all three today.')).toBeTruthy();
    expect(screen.getByTestId('welcome-brand').textContent).toContain('CViper Light');
    expect(screen.getByTestId('welcome-brand').querySelector('img')).toBeTruthy();
  });

  it('shows the three trust items, in order', async () => {
    render(<Welcome onDismiss={() => undefined} detect={() => Promise.resolve(NOTHING)} />);

    const list = await screen.findByTestId('welcome-trust');
    const items = within(list).getAllByRole('listitem');
    expect(items.map((item) => item.textContent?.trim())).toEqual([
      'Saved on your device',
      'No account',
      'Free to use',
    ]);
  });

  it('names the trust row for a screen reader, and keeps its icons silent', async () => {
    render(<Welcome onDismiss={() => undefined} detect={() => Promise.resolve(NOTHING)} />);

    const list = await screen.findByTestId('welcome-trust');
    expect(list.getAttribute('aria-label')).toBe('What to know');
    const icons = list.querySelectorAll('svg');
    expect(icons.length).toBe(3);
    for (const icon of icons) expect(icon.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('the three cards', () => {
  it('negative: no card has a hover state, because no card is itself clickable', async () => {
    render(<Welcome onDismiss={() => undefined} detect={() => Promise.resolve(NOTHING)} />);
    await screen.findByTestId('welcome');

    for (const id of ['tracker', 'analysis', 'search']) {
      expect(screen.getByTestId(`welcome-card-${id}`).className, id).not.toContain('hover:');
    }
  });

  it('shows all three, each with a title, a hook and a status', async () => {
    render(<Welcome onDismiss={() => undefined} detect={() => Promise.resolve(NOTHING)} />);

    const tracker = await screen.findByTestId('welcome-card-tracker');
    expect(tracker.textContent).toContain('Track applications');
    expect(tracker.textContent).toContain('See who to chase next.');

    const analysis = screen.getByTestId('welcome-card-analysis');
    expect(analysis.textContent).toContain('Check your CV');
    expect(analysis.textContent).toContain("Find the words you're missing.");

    const search = screen.getByTestId('welcome-card-search');
    expect(search.textContent).toContain('Find jobs');
    expect(search.textContent).toContain('Search UK jobs in one place.');

    expect(screen.getByTestId('welcome-status-tracker').textContent).toBe('Ready now');
    expect(screen.getByTestId('welcome-status-search').textContent).toBe('Ready now');
  });

  it('labels each button as the mockup does', async () => {
    render(<Welcome onDismiss={() => undefined} detect={() => Promise.resolve(NOTHING)} />);

    expect((await screen.findByTestId('welcome-action-tracker')).textContent).toBe('Open my board');
    expect(screen.getByTestId('welcome-action-analysis').textContent).toBe('Check my CV');
    expect(screen.getByTestId('welcome-action-search').textContent).toBe('Find jobs');
  });

  it('has exactly one primary button, and it is "Check my CV"', async () => {
    render(<Welcome onDismiss={() => undefined} detect={() => Promise.resolve(NOTHING)} />);

    await screen.findByTestId('welcome');
    const primaries = document.querySelectorAll('[data-primary="true"]');
    expect(primaries).toHaveLength(1);
    expect(primaries[0]?.textContent).toBe('Check my CV');
  });

  it('marks the CV card "Start here", and only that card', async () => {
    render(<Welcome onDismiss={() => undefined} detect={() => Promise.resolve(NOTHING)} />);

    const analysis = await screen.findByTestId('welcome-card-analysis');
    expect(within(analysis).getByTestId('welcome-start-here').textContent).toBe('Start here');
    expect(analysis.dataset['featured']).toBe('true');

    expect(screen.getAllByTestId('welcome-start-here')).toHaveLength(1);
    expect(screen.getByTestId('welcome-card-tracker').dataset['featured']).toBeUndefined();
  });

  it('makes the tracker card actionable before any detection has finished', async () => {
    // The card that needs nothing must not wait on a probe of something it does
    // not use. This is the first impression of a zero-setup product.
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(<Welcome onDismiss={onDismiss} detect={pending()} />);

    const action = await screen.findByTestId('welcome-action-tracker');
    expect(action).toHaveProperty('disabled', false);

    await user.click(action);
    expect(onDismiss).toHaveBeenCalledWith('tracker');
  });

  it('takes the user to the view a card names', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(<Welcome onDismiss={onDismiss} detect={() => Promise.resolve(NOTHING)} />);

    await user.click(await screen.findByTestId('welcome-action-search'));
    expect(onDismiss).toHaveBeenCalledWith('search');

    await user.click(screen.getByTestId('welcome-action-analysis'));
    expect(onDismiss).toHaveBeenCalledWith('analysis');
  });
});

describe('the examples on each card are examples, not the user’s data', () => {
  it('hides every preview from assistive tech and captions it as an example', async () => {
    render(<Welcome onDismiss={() => undefined} detect={() => Promise.resolve(NOTHING)} />);
    await screen.findByTestId('welcome');

    for (const id of ['tracker', 'analysis', 'search']) {
      const preview = screen.getByTestId(`welcome-preview-${id}`);
      expect(preview.getAttribute('aria-hidden'), id).toBe('true');
      expect(preview.textContent, id).toContain('Example');
    }
  });

  it('captions each example at the smallest text token, not an arbitrary size', async () => {
    render(<Welcome onDismiss={() => undefined} detect={() => Promise.resolve(NOTHING)} />);
    await screen.findByTestId('welcome');

    for (const id of ['tracker', 'analysis', 'search']) {
      const caption = within(screen.getByTestId(`welcome-preview-${id}`)).getByText('Example');
      expect(caption.className, id).toContain('text-xs');
      expect(caption.className, id).not.toContain('text-[11px]');
    }
  });

  it('the CV example shows a match score and nothing more', async () => {
    render(<Welcome onDismiss={() => undefined} detect={() => Promise.resolve(NOTHING)} />);

    const preview = await screen.findByTestId('welcome-preview-analysis');
    // Two spans side by side, spaced by a flex gap rather than a text space.
    expect(preview.textContent).toMatch(/72%\s*match/);
    expect(preview.textContent).not.toContain('key words missing');
  });

  it('shows the score in the display numeral convention', async () => {
    render(<Welcome onDismiss={() => undefined} detect={() => Promise.resolve(NOTHING)} />);

    const score = await screen.findByTestId('welcome-preview-score');
    expect(score.textContent).toBe('72%');
    for (const cls of ['font-display', 'font-normal', 'lining-nums', 'tabular-nums']) {
      expect(score.className).toContain(cls);
    }
  });

  it('shows one fresh and one gone-quiet application on the board example', async () => {
    render(<Welcome onDismiss={() => undefined} detect={() => Promise.resolve(NOTHING)} />);

    const preview = await screen.findByTestId('welcome-preview-tracker');
    expect(preview.textContent).toContain('Acme Ltd');
    expect(preview.textContent).toContain('Northwind');
    expect(preview.querySelector('.border-l-teal')).toBeTruthy();
    expect(preview.querySelector('.border-l-gold')).toBeTruthy();
  });
});

describe('the live Ollama detection on the CV card', () => {
  it('says "local AI found" in the pill when a usable model is there', async () => {
    render(
      <Welcome onDismiss={() => undefined} detect={() => Promise.resolve(OLLAMA_WITH_MODEL)} />,
    );

    const pill = await screen.findByText('Ready now · local AI found');
    expect(pill.getAttribute('data-testid')).toBe('welcome-status-analysis');
    expect(screen.getByTestId('welcome-local-model').textContent).toContain('llama3.2:3b');
  });

  it('negative: never says "local AI found" when nothing was detected', async () => {
    render(<Welcome onDismiss={() => undefined} detect={() => Promise.resolve(NOTHING)} />);

    const line = (await screen.findByTestId('welcome-local-model')).textContent ?? '';
    expect(line.toLowerCase()).toContain('works with nothing');
    expect(screen.getByTestId('welcome-status-analysis').textContent).toBe('Ready now');
    expect(screen.getByTestId('welcome').textContent).not.toContain('local AI found');
  });

  it('negative: Ollama running with no chat model is not "found" either', async () => {
    render(
      <Welcome
        onDismiss={() => undefined}
        detect={() => Promise.resolve({ ...NOTHING, ollamaRunning: true })}
      />,
    );

    const line = (await screen.findByTestId('welcome-local-model')).textContent ?? '';
    // L-240: plain words and a link, not a terminal command.
    expect(line).toContain('add a chat model in it');
    expect(line).not.toContain('ollama pull');
    expect(screen.getByTestId('welcome').textContent).not.toContain('local AI found');
  });

  it('Ollama running with no chat model: the link opens the download page (L-240)', async () => {
    const user = userEvent.setup();
    const browser = createFakeBrowserPort();
    render(
      <Welcome
        onDismiss={() => undefined}
        browser={browser}
        detect={() => Promise.resolve({ ...NOTHING, ollamaRunning: true })}
      />,
    );

    const link = await screen.findByRole('button', { name: 'Open Ollama’s download page' });
    await user.click(link);

    expect(browser.opened()).toEqual([OLLAMA_DOWNLOAD_URL]);
  });

  it('negative: no Ollama link on a machine with no Ollama at all — no advert', async () => {
    render(<Welcome onDismiss={() => undefined} detect={() => Promise.resolve(NOTHING)} />);

    await vi.waitFor(() =>
      expect(screen.getByTestId('welcome-local-model').textContent).toContain('works with nothing'),
    );
    expect(screen.queryByRole('button', { name: 'Open Ollama’s download page' })).toBeNull();
  });

  it('boundary: no Ollama link once a chat model is found', async () => {
    render(
      <Welcome
        onDismiss={() => undefined}
        detect={() =>
          Promise.resolve({
            ...NOTHING,
            ollamaRunning: true,
            ollamaModels: [{ id: 'llama3.2:3b', label: 'llama3.2:3b (3.2B)' }],
          })
        }
      />,
    );

    await vi.waitFor(() =>
      expect(screen.getByTestId('welcome-local-model').textContent).toContain('llama3.2:3b'),
    );
    expect(screen.queryByRole('button', { name: 'Open Ollama’s download page' })).toBeNull();
  });

  it('boundary: says it is still looking rather than claiming anything', async () => {
    render(<Welcome onDismiss={() => undefined} detect={pending()} />);

    expect((await screen.findByTestId('welcome-local-model')).textContent).toContain('Looking');
    expect(screen.getByTestId('welcome-status-analysis').textContent).toBe('Ready now');
  });

  it('negative: a detection that fails does not take the screen down with it', async () => {
    render(
      <Welcome onDismiss={() => undefined} detect={() => Promise.reject(new Error('no IPC'))} />,
    );

    const line = (await screen.findByTestId('welcome-local-model')).textContent ?? '';
    expect(line.toLowerCase()).toContain('works with nothing');
    expect(screen.getByTestId('welcome-card-tracker')).toBeTruthy();
    expect(screen.getByTestId('welcome').textContent).not.toContain('local AI found');
  });
});

describe('the footer', () => {
  it('keeps the GitHub update-check disclosure on the page', async () => {
    render(<Welcome onDismiss={() => undefined} detect={() => Promise.resolve(NOTHING)} />);

    const disclosure = await screen.findByTestId('welcome-update-check');
    expect(disclosure.textContent).toContain('GitHub');
    expect(disclosure.textContent).toContain('Settings');
  });

  it('sets the disclosure at body-adjacent size in muted ink, not small faint print', async () => {
    render(<Welcome onDismiss={() => undefined} detect={() => Promise.resolve(NOTHING)} />);

    const disclosure = await screen.findByTestId('welcome-update-check');
    expect(disclosure.className).toContain('text-sm');
    expect(disclosure.className).toContain('text-ink-muted');
    expect(disclosure.className).not.toContain('text-xs');
    expect(disclosure.className).not.toContain('text-ink-faint');
  });
});

describe('getting out of it', () => {
  it('"I\'ll look around myself" dismisses without choosing anything, as Skip did', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(<Welcome onDismiss={onDismiss} detect={() => Promise.resolve(NOTHING)} />);

    const out = await screen.findByTestId('welcome-skip');
    expect(out.textContent).toContain("I'll look around myself");

    await user.click(out);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledWith(null);
  });

  it('closes on Escape, like every other overlay in this app', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(<Welcome onDismiss={onDismiss} detect={() => Promise.resolve(NOTHING)} />);

    await screen.findByTestId('welcome');
    await user.keyboard('{Escape}');

    expect(onDismiss).toHaveBeenCalledWith(null);
  });
});
