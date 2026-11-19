// @vitest-environment jsdom
/**
 * The one empty state (L-434). A screen with nothing in it yet says so in the
 * same shape everywhere: a small grey icon, a title, a sentence, and sometimes
 * one thing to press. Centred, with no border and no fill.
 *
 * Search's was a dashed box with an icon in a tinted tile. That reads as a
 * place to drop a file, which it is not. Search uses this part first; the other
 * screens move onto it later, one small change each.
 *
 * Classes are asserted here, as in `ui.test.tsx`: jsdom resolves no
 * stylesheet, so the class string is the only place the look can be pinned.
 *
 * The Search screen's own tests run unedited. They pin every word and every
 * branch, so they are the proof that moving onto this part changed no words.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SearchResults, type SearchResultsProps } from '../features/search/SearchResults';
import { EMPTY_FORM } from '../features/search/model';
import { EmptyState } from './EmptyState';

afterEach(() => {
  cleanup();
});

/** A border round the empty state, a fill behind it, or rounded corners. */
const BOXED = /\b(border\S*|bg-\S+|rounded-\S+)\b/;
/** Anything that forces a sentence onto one line, or the box to a fixed width. */
const CLIPPING = /\b(truncate|text-ellipsis|whitespace-nowrap|line-clamp-\S+|(min-|max-)?w-\S+)\b/;

/** Every class string inside `root`, the root's own included. */
function classesIn(root: HTMLElement): string[] {
  return [root, ...root.querySelectorAll('*')].map((node) => node.getAttribute('class') ?? '');
}

describe('EmptyState — an icon, a title and a sentence, with no box round them', () => {
  it('happy: draws the title and the body, in that order, under the test id', () => {
    render(
      <EmptyState icon="search" title="Nothing looked at yet." body="Press Search." testId="e" />,
    );
    const empty = screen.getByTestId('e');
    const paragraphs = [...empty.querySelectorAll('p')];
    expect(paragraphs.map((p) => p.textContent)).toEqual([
      'Nothing looked at yet.',
      'Press Search.',
    ]);
    expect(paragraphs[0]?.className).toContain('font-medium');
    expect(paragraphs[0]?.className).toContain('text-ink');
    expect(paragraphs[1]?.className).toContain('text-ink-muted');
    expect(empty.className).toContain('text-center');
  });

  it('happy: the icon adds no words, and a screen reader does not meet it', () => {
    render(<EmptyState icon="search" title="Nothing yet." body="Press Search." testId="e" />);
    const empty = screen.getByTestId('e');
    // The words a test or a screen reader reads are the title and the body, nothing else.
    expect(empty.textContent).toBe('Nothing yet.Press Search.');
    const svg = empty.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(svg?.getAttribute('width')).toBe('20');
    // Grey, from the ink scale (muted: faint is for sized text, L-213), not a tile tint.
    expect(svg?.parentElement?.className).toContain('text-ink-muted');
  });

  it('happy: no dashed border, no box, no fill, and no tinted tile', () => {
    render(<EmptyState icon="search" title="Nothing yet." body="Press Search." testId="e" />);
    for (const classes of classesIn(screen.getByTestId('e'))) {
      expect(classes).not.toMatch(BOXED);
      expect(classes).not.toContain('border-dashed');
    }
  });

  it('happy: the body may be a small piece of markup, drawn inside the sentence', () => {
    render(
      <EmptyState
        icon="search"
        title="Nothing yet."
        body={
          <>
            Tick a feed. <strong>Or</strong> press Search.
          </>
        }
        testId="e"
      />,
    );
    const body = screen.getByTestId('e').querySelectorAll('p')[1];
    expect(body?.textContent).toBe('Tick a feed. Or press Search.');
    expect(body?.querySelector('strong')?.textContent).toBe('Or');
  });

  it('negative: with no action there is no empty box where one would go', () => {
    render(<EmptyState icon="search" title="Nothing yet." body="Press Search." testId="e" />);
    const empty = screen.getByTestId('e');
    // The icon, the title and the body. Nothing else, not even an empty wrapper.
    expect(empty.children).toHaveLength(3);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('boundary: a very long body wraps; nothing cuts it to one line or fixes the width', () => {
    const long = `${'A long sentence that goes on '.repeat(40)}${'x'.repeat(300)}`;
    render(<EmptyState icon="search" title="Nothing yet." body={long} testId="e" />);
    const empty = screen.getByTestId('e');
    expect(empty.querySelectorAll('p')[1]?.textContent).toBe(long);
    for (const classes of classesIn(empty)) expect(classes).not.toMatch(CLIPPING);
  });

  it('boundary: an empty body still draws its line, so the title never moves', () => {
    render(<EmptyState icon="search" title="Nothing yet." body="" testId="e" />);
    expect(screen.getByTestId('e').querySelectorAll('p')).toHaveLength(2);
  });

  it('interaction: an action is drawn under the sentence, and its click reaches its handler', async () => {
    const onClick = vi.fn();
    render(
      <EmptyState
        icon="search"
        title="Nothing yet."
        body="Try the sample."
        action={
          <button type="button" onClick={onClick}>
            Try a sample
          </button>
        }
        testId="e"
      />,
    );
    const empty = screen.getByTestId('e');
    const button = screen.getByRole('button', { name: 'Try a sample' });
    expect(empty.contains(button)).toBe(true);
    expect(empty.lastElementChild?.contains(button)).toBe(true);
    await userEvent.setup().click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

/** Search's results area before anything has run. */
function searchResults(overrides: Partial<SearchResultsProps> = {}): SearchResultsProps {
  return {
    outcome: null,
    keylessOutcome: null,
    results: { jobs: [], clusters: [], ran: false },
    ordered: [],
    running: false,
    form: EMPTY_FORM,
    jobBoards: [],
    browser: { open: () => Promise.resolve({ ok: true, value: undefined }) },
    today: '2026-11-19',
    tracked: new Set(),
    savingId: null,
    notes: {},
    problems: {},
    bands: new Map(),
    dealBreakers: [],
    onSave: () => undefined,
    onOpen: () => undefined,
    onAnalyse: undefined,
    searchBlocked: false,
    noFreeFeedHere: false,
    noCountry: false,
    ...overrides,
  };
}

describe('Search draws its empty results area with the shared part', () => {
  it('no dashed box and no tile: a grey icon, hidden from screen readers, over the same words', () => {
    render(<SearchResults {...searchResults({ noCountry: true })} />);
    const empty = screen.getByTestId('search-empty');
    for (const classes of classesIn(empty)) expect(classes).not.toMatch(BOXED);
    const svg = empty.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.parentElement?.className).toContain('text-ink-muted');
    expect(empty.textContent).toBe('Nothing looked at yet.Choose a country to search.');
  });
});
