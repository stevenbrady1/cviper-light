// @vitest-environment jsdom
/**
 * The examples on the welcome name no town (L-424).
 *
 * The welcome is read before a country is chosen (L-417), by someone who may be
 * anywhere. Its Find jobs example used to read "Data analyst · Leeds", which
 * told a person in Toronto the adverts would be English ones. Both example
 * rows now say "Remote" (the owner's word, 18 Nov 2026), which is true of
 * every country.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { type Availability } from '../analysis/providers';

import { Welcome } from './Welcome';

const NOTHING: Availability = {
  ollamaRunning: false,
  ollamaModels: [],
  anthropicKey: false,
  openaiKey: false,
};

/** The UK towns the app's other examples and fixtures use. */
const UK_TOWNS = /\b(Leeds|London|Bristol|Manchester|Birmingham|Glasgow|Edinburgh)\b/i;

afterEach(() => {
  cleanup();
});

async function renderWelcome(): Promise<HTMLElement> {
  render(<Welcome onDismiss={() => undefined} detect={() => Promise.resolve(NOTHING)} />);
  return screen.findByTestId('welcome');
}

/**
 * Every piece of text, a space between each. `textContent` runs neighbouring
 * pieces together ("Data analystLeedsBI developer"), which hides a whole word
 * from a whole-word check.
 */
function wordsOn(element: HTMLElement): string {
  const pieces: string[] = [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    pieces.push(node.textContent ?? '');
  }
  return pieces.join(' ');
}

describe('the Find jobs example on the welcome (L-424)', () => {
  it('happy path: both rows give a job title and "Remote", in the owner’s words', async () => {
    await renderWelcome();

    const rows = [...screen.getByTestId('welcome-preview-search').querySelectorAll('li')].map(
      (row) => [...row.querySelectorAll('span')].map((piece) => piece.textContent),
    );
    expect(rows).toEqual([
      ['Data analyst', 'Remote'],
      ['BI developer', 'Remote'],
    ]);
  });

  it('negative: the welcome names no UK town, anywhere on it', async () => {
    const welcome = await renderWelcome();

    // The screen really was drawn: the rule cannot pass on an empty page.
    expect(wordsOn(welcome)).toContain('Find jobs');
    expect(wordsOn(welcome)).not.toMatch(UK_TOWNS);
  });

  it('the check itself: it catches the old row as it was drawn, and leaves "Remote" alone', () => {
    const drawn = document.createElement('ul');
    drawn.innerHTML = '<li><span>Data analyst</span><span>Leeds</span></li><li>BI developer</li>';
    expect(wordsOn(drawn)).toMatch(UK_TOWNS);

    drawn.innerHTML = '<li><span>Data analyst</span><span>Remote</span></li>';
    expect(wordsOn(drawn)).not.toMatch(UK_TOWNS);
  });
});
