// @vitest-environment jsdom
/**
 * Outside the United Kingdom, the app does not talk as if you were in it (L-423).
 *
 * ============================================================================
 * A FORBID-LIST OVER WHAT IS DRAWN, NOT OVER THE SOURCE
 * ============================================================================
 * CViper Light is for anyone, in any country (owner decision, 13 Nov 2026). So
 * on the screens a person in Germany reads first — the welcome, Search and
 * Settings — the words UK, U.K., United Kingdom, Britain, British, London,
 * pounds and the £ sign must be ABSENT.
 *
 * The check reads the rendered screen: every piece of text, and every grey
 * hint, label and tooltip. It never opens a source file, so a comment can
 * neither satisfy it nor break it, and a sentence added later is held to the
 * rule without anybody remembering to list it here.
 *
 * What may stay is named below, ONE SENTENCE AT A TIME, each with its reason.
 * There is no blanket skip. An exception nothing uses any more fails the test,
 * so the list cannot quietly outlive the words it excused.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));

const { default: App } = await import('./App');
const { markWelcomeSeen } = await import('../features/onboarding/store');
const { COUNTRY_STORAGE_KEY } = await import('../features/search/country');
const { createFakeTrackerPort } = await import('../features/tracker/test/fakePort');
const { createFakeProfilePort } = await import('../features/profile/test/fakePort');
const { createFakeTailorPort } = await import('../features/tailor/test/fakePort');

const NOW = new Date(2026, 10, 17, 9, 0, 0);

/**
 * "UK" is matched in capitals only: `reed.co.uk` is an address, not a claim
 * about where you are. The rest are matched in any case. All are whole words,
 * so "bulk", "duke" and "ukulele" are not caught.
 */
const FORBIDDEN: readonly RegExp[] = [
  /\bUK\b/,
  /\bU\.K\./,
  /\bUnited Kingdom\b/i,
  /\bBritain\b/i,
  /\bBritish\b/i,
  /\bLondon\b/i,
  /\bpounds?\b/i,
  /£/,
];

function forbiddenIn(text: string): boolean {
  return FORBIDDEN.some((word) => word.test(text));
}

interface Allowed {
  /** The nearest `data-testid` above the words. */
  readonly where: string;
  /** The exact words that may stay. */
  readonly phrase: string;
  readonly why: string;
}

/** The grey hints, labels and tooltips a person also reads. */
const READ_ATTRIBUTES = ['placeholder', 'aria-label', 'title', 'alt'] as const;

interface Found {
  readonly where: string;
  readonly text: string;
}

function nearestTestId(element: Element | null): string {
  return element?.closest('[data-testid]')?.getAttribute('data-testid') ?? '(no test id)';
}

/** Every piece of text on the screen, with the nearest test id above it. */
function everythingRead(): Found[] {
  const found: Found[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const parent = node.parentElement;
    // The Country picker is where "United Kingdom" is CHOSEN: its own entries
    // are the one place the name of every country belongs.
    if (parent?.closest('#search-country') !== null && parent !== null) continue;
    const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (text !== '') found.push({ where: nearestTestId(parent), text });
  }
  for (const element of document.body.querySelectorAll('*')) {
    for (const attribute of READ_ATTRIBUTES) {
      const text = element.getAttribute(attribute)?.trim() ?? '';
      if (text !== '') found.push({ where: nearestTestId(element), text });
    }
  }
  return found;
}

/** What breaks the rule on this screen, and which exceptions were never used. */
function judge(allowed: readonly Allowed[]): { offences: string[]; unused: string[] } {
  const used = new Set<Allowed>();
  const offences = everythingRead().flatMap(({ where, text }) => {
    let rest = text;
    for (const exception of allowed) {
      if (exception.where === where && rest.includes(exception.phrase)) {
        used.add(exception);
        rest = rest.split(exception.phrase).join(' ');
      }
    }
    return forbiddenIn(rest) ? [`${where}: “${text}”`] : [];
  });
  const unused = allowed
    .filter((exception) => !used.has(exception))
    .map(({ where, phrase }) => `${where}: “${phrase}”`);
  return { offences, unused };
}

beforeEach(() => {
  localStorage.clear();
  tauri.invoke.mockReset();
  tauri.invoke.mockImplementation(async (command) => {
    if (command === 'ollama_probe') return null;
    if (command === 'secret_status') return false;
    throw new Error(`unexpected command ${command}`);
  });
});

afterEach(() => {
  cleanup();
});

function renderApp() {
  return render(
    <App
      trackerPort={createFakeTrackerPort([])}
      profilePort={createFakeProfilePort()}
      tailorPort={createFakeTailorPort()}
      now={NOW}
    />,
  );
}

/**
 * Someone who has used the app, searching a country that is not the UK. With
 * `keys`, every key is saved: Search then draws the Adzuna and Reed tick boxes,
 * which is where "Reed lists UK jobs only." lives.
 */
async function openAt(view: 'search' | 'settings', country: string, keys = false) {
  tauri.invoke.mockImplementation(async (command) => {
    if (command === 'ollama_probe') return null;
    if (command === 'secret_status') return keys;
    throw new Error(`unexpected command ${command}`);
  });
  localStorage.setItem(COUNTRY_STORAGE_KEY, country);
  markWelcomeSeen();
  const user = userEvent.setup();
  renderApp();
  await screen.findByTestId('status-strip');
  await user.click(screen.getByTestId(`nav-${view}`));
  await vi.waitFor(() =>
    expect(screen.getByTestId(`nav-${view}`).getAttribute('aria-current')).toBe('page'),
  );
  return user;
}

/* ------------------------------------------------------------------------- */
/* What may stay, sentence by sentence                                        */
/* ------------------------------------------------------------------------- */

const ON_SEARCH: readonly Allowed[] = [
  {
    where: 'provider-blocked-reed',
    phrase: 'Reed lists UK jobs only.',
    why: 'The reason the Reed tick box is switched off outside the UK. True, and owner-approved (13 Nov).',
  },
  {
    where: 'hint',
    phrase: 'with a small London list',
    why: 'What the free feed, Arbeitnow, actually holds: a fact about the feed, not about where you are.',
  },
];

const IN_SETTINGS: readonly Allowed[] = [
  {
    where: 'key-row-reed',
    phrase: 'one of the largest UK job boards',
    why: 'True of Reed, and it tells someone elsewhere that a Reed key is not for them (owner: unchanged).',
  },
  {
    where: 'privacy-host-www.jobs.service.gov.uk',
    phrase: 'GOV.UK’s Find a job',
    why: 'The name of a site, in the list of every address the app can open. Privacy wording is the owner’s.',
  },
];

describe('the check itself', () => {
  it.each(['UK jobs', 'in the U.K. only', 'the United Kingdom', 'Britain', 'British spelling'])(
    'catches “%s”',
    (text) => {
      expect(forbiddenIn(text)).toBe(true);
    },
  );

  it.each(['e.g. London', 'in pounds', 'one pound', '£45,000', 'the united kingdom', 'LONDON'])(
    'catches “%s”',
    (text) => {
      expect(forbiddenIn(text)).toBe(true);
    },
  );

  it.each(['bulk upload', 'a duke', 'ukulele', 'www.reed.co.uk', 'uk.indeed.com', 'Londonderry'])(
    'negative: leaves “%s” alone',
    (text) => {
      expect(forbiddenIn(text)).toBe(false);
    },
  );

  it('boundary: an exception excuses its own words in its own place, and nothing else', () => {
    document.body.innerHTML =
      '<p data-testid="a">Reed lists UK jobs only.</p>' +
      '<p data-testid="b">Reed lists UK jobs only.</p>' +
      '<p data-testid="a">Reed lists UK jobs only. Made in the UK.</p>' +
      '<input data-testid="c" placeholder="e.g. London" />';
    const { offences, unused } = judge([
      { where: 'a', phrase: 'Reed lists UK jobs only.', why: 'test' },
      { where: 'z', phrase: 'never drawn', why: 'test' },
    ]);
    expect(offences).toEqual([
      'b: “Reed lists UK jobs only.”',
      'a: “Reed lists UK jobs only. Made in the UK.”',
      'c: “e.g. London”',
    ]);
    expect(unused).toEqual(['z: “never drawn”']);
    document.body.innerHTML = '';
  });
});

describe('outside the UK, no screen talks as if you were in it (L-423)', () => {
  it('the welcome a brand-new install opens on', async () => {
    renderApp();
    await screen.findByTestId('welcome');
    // The screen really was drawn: the rule cannot pass on an empty page.
    expect(screen.getByTestId('welcome-card-search').textContent).toContain('Find jobs');
    expect(judge([])).toEqual({ offences: [], unused: [] });
  });

  it.each(['de', 'other'])('Search, with “Where to look” open (%s)', async (country) => {
    const user = await openAt('search', country, true);
    await user.click(screen.getByTestId('search-where-summary'));
    expect((screen.getByTestId('search-where-fold') as HTMLDetailsElement).open).toBe(true);
    expect(screen.getByTestId('search-keywords')).toBeTruthy();
    expect(judge(ON_SEARCH)).toEqual({ offences: [], unused: [] });
  });

  it.each(['de', 'other'])('Settings, with “Add a job board” open (%s)', async (country) => {
    const user = await openAt('settings', country);
    await user.click(await screen.findByTestId('boards-add-open'));
    await screen.findByTestId('boards-add-placeholders');
    expect(screen.getByTestId('settings-about')).toBeTruthy();
    expect(judge(IN_SETTINGS)).toEqual({ offences: [], unused: [] });
  });
});
