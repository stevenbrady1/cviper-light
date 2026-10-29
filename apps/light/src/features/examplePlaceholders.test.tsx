// @vitest-environment jsdom
/**
 * L-330: an example in an empty box starts with "e.g. ", so it cannot be
 * mistaken for an answer.
 *
 * Grey text such as "Credit risk analyst moving into quant development" or
 * "UK citizen, no sponsorship needed" reads like a profile somebody already
 * filled in. A new user can look at the Profile screen, see every box
 * "answered", and move on with nothing saved.
 *
 * The rule is a forbid-list: on the real Profile and Search screens, a
 * placeholder that is NOT empty, does NOT start with exactly "e.g. " and a
 * real example, and is NOT one of the few neutral values named below, must be
 * absent. The placeholders are read from the rendered DOM, not from source, so
 * a box added later is held to the same rule without anybody remembering to
 * list it here.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ok } from '@cviper/core-types';
import { type JobProviderId } from '@cviper/job-apis';

import { createFakeBrowserPort } from '../platform/test/fakeBrowserPort';
import { type KeyState } from '../status/environment';

import { Profile } from './profile/Profile';
import { type GapsPort } from './profile/gapsPort';
import { createFakeProfilePort } from './profile/test/fakePort';
import { Search } from './search/Search';
import { createFakeSearchPort } from './search/test/fakeSearchPort';

/** The prefix every example starts with: lower case, both stops, one space. */
const EXAMPLE_PREFIX = 'e.g. ';

/**
 * Placeholders that are NOT examples, by the box they sit in. Each says what
 * an empty box MEANS rather than showing what to type, so "e.g." in front of
 * it would be wrong. Keyed by box, so the same word turning up as an example
 * somewhere else is still caught.
 */
const NOT_EXAMPLES: Readonly<Record<string, string>> = {
  // Empty means "no distance filter": the search runs without one.
  'search-distance': 'Any',
  // Empty means "no minimum salary": nothing is filtered out by pay.
  'search-salary': 'Any',
};

interface Placeholder {
  readonly box: string;
  readonly text: string;
}

/** Why one placeholder breaks the rule, or null when it is fine. */
function placeholderOffence({ box, text }: Placeholder): string | null {
  // No placeholder, or one with nothing to see, shows no grey text at all.
  if (text.trim() === '') return null;
  if (NOT_EXAMPLES[box] === text) return null;
  if (!text.startsWith(EXAMPLE_PREFIX)) {
    return `${box}: "${text}" is an example that does not start with "${EXAMPLE_PREFIX}"`;
  }
  if (text.slice(EXAMPLE_PREFIX.length).trim() === '') {
    return `${box}: "${text}" says "e.g." and then gives no example`;
  }
  return null;
}

/** Every placeholder in the document, named by the box it sits in. */
function renderedPlaceholders(): Placeholder[] {
  return [...document.querySelectorAll<HTMLElement>('[placeholder]')].map((element) => ({
    box: element.getAttribute('data-testid') ?? element.id,
    text: element.getAttribute('placeholder') ?? '',
  }));
}

function offences(placeholders: readonly Placeholder[]): string[] {
  return placeholders.flatMap((placeholder) => {
    const offence = placeholderOffence(placeholder);
    return offence === null ? [] : [offence];
  });
}

afterEach(() => {
  cleanup();
});

const GAPS: GapsPort = { load: async () => ok({ cvText: null, jobs: [] }) };

async function renderProfileWithEveryRow(): Promise<void> {
  render(
    <Profile
      port={createFakeProfilePort(null)}
      now={new Date('2026-10-29T09:00:00.000Z')}
      gapsPort={GAPS}
    />,
  );
  await screen.findByTestId('profile-headline');
  // The language and STAR rows only exist once added; add one of each so
  // their boxes are read too.
  fireEvent.click(screen.getByTestId('profile-language-add'));
  fireEvent.click(screen.getByTestId('profile-star-add'));
  await screen.findByTestId('profile-language-name-0');
}

const NO_KEYS: Record<JobProviderId, KeyState> = { adzuna: 'missing', reed: 'missing' };

async function renderSearch(): Promise<void> {
  let counter = 0;
  render(
    <Search
      port={createFakeSearchPort()}
      browser={createFakeBrowserPort()}
      readKeyStates={async () => NO_KEYS}
      now={new Date('2026-10-29T09:00:00.000Z')}
      newId={() => `generated-${(counter += 1)}`}
      onOpenSettings={vi.fn()}
    />,
  );
  await screen.findByTestId('search-keywords');
}

describe('example placeholders start with "e.g. " (L-330)', () => {
  it('on the Profile screen', async () => {
    await renderProfileWithEveryRow();
    const found = renderedPlaceholders();
    // The screen really has examples to judge: the rule cannot pass on an
    // empty page.
    expect(found.filter(({ text }) => text.trim() !== '').length).toBeGreaterThanOrEqual(10);
    expect(offences(found)).toEqual([]);
  });

  it('on the Search screen', async () => {
    await renderSearch();
    const found = renderedPlaceholders();
    expect(found.some(({ box }) => box === 'search-keywords')).toBe(true);
    expect(found.some(({ box }) => box === 'search-location')).toBe(true);
    expect(offences(found)).toEqual([]);
  });
});

describe('the rule itself', () => {
  it('passes a real example', () => {
    expect(placeholderOffence({ box: 'b', text: 'e.g. London' })).toBeNull();
    expect(placeholderOffence({ box: 'b', text: 'e.g. Banking\nHedge funds' })).toBeNull();
  });

  it('negative: an empty or blank placeholder is allowed', () => {
    expect(placeholderOffence({ box: 'b', text: '' })).toBeNull();
    expect(placeholderOffence({ box: 'b', text: '   ' })).toBeNull();
  });

  it('negative: an example without the prefix fails', () => {
    expect(placeholderOffence({ box: 'b', text: 'London' })).not.toBeNull();
  });

  it('a neutral value is allowed only in the box it is named for', () => {
    expect(placeholderOffence({ box: 'search-salary', text: 'Any' })).toBeNull();
    expect(placeholderOffence({ box: 'search-keywords', text: 'Any' })).not.toBeNull();
  });

  it.each([
    ['"e.g." with nothing after it', 'e.g.'],
    ['"e.g. " with only a space after it', 'e.g. '],
    ['"e.g." with no space before the example', 'e.g.London'],
    ['a capital E', 'E.g. London'],
    ['no stops', 'eg London'],
    ['one stop', 'e.g London'],
    ['the prefix after leading space', ' e.g. London'],
  ])('boundary: %s fails', (_name, text) => {
    expect(placeholderOffence({ box: 'b', text })).not.toBeNull();
  });
});
