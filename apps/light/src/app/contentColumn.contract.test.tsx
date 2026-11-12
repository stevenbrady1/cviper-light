// @vitest-environment jsdom
/**
 * L-341: Profile, Search, Settings, Analysis and Tailor share one content width.
 * L-326: that width is 1024px and CENTRED, and the page title lines up with it.
 *
 * Each of the five used to pick its own (`max-w-2xl`, `max-w-3xl`, or none), so
 * the cards' left edges jumped from screen to screen and two of them ran their
 * text across the whole of a wide window. `layout.ts` now holds the one width.
 *
 * This reads the RENDERED screens, not the source: each screen is opened from
 * the nav and its column found by `data-content-column`. On each:
 *
 *   - there is exactly one column, carrying `CONTENT_COLUMN`, which centres
 *     it (`mx-auto`); a left-aligned column is reported (L-326);
 *   - the scroll area carries `SIDE_PADDING` and no other side padding, and
 *     the header's title row carries `CONTENT_COLUMN`, so on a wide window
 *     the title lines up with the content;
 *   - nothing in the screen's scroll area is outside it;
 *   - no other `max-w-*` width class sits on the scroll area, on anything
 *     between it and the column, or on the column's own children. Deeper than
 *     that, a dialog or a table may size itself.
 *
 * jsdom does no layout, so the classes are what is read — the same classes the
 * browser lays out.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type JobProviderId } from '@cviper/job-apis';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));

const { default: App } = await import('./App');
const { CONTENT_COLUMN, SIDE_PADDING } = await import('./layout');
const { VIEWS } = await import('./views');
const { markWelcomeSeen } = await import('../features/onboarding/store');
const { createFakeTrackerPort } = await import('../features/tracker/test/fakePort');
const { createFakeProfilePort } = await import('../features/profile/test/fakePort');
const { createFakeAnalysisPort } = await import('../features/analysis/test/fakePort');
const { createFakeTailorPort } = await import('../features/tailor/test/fakePort');
const { createFakeSearchPort } = await import('../features/search/test/fakeSearchPort');
const { createFakeBoardPort } = await import('../features/boards/test/fakeBoardPort');
const { createFakeBackupPort } = await import('../features/settings/test/fakePort');
const { createFakeErasePort } = await import('../features/settings/erase/test/fakeErasePort');
const { createFakeFilePort } = await import('../platform/test/fakeFilePort');
const { createFakeOpenedCvPort } = await import('../platform/test/fakeOpenedCvPort');
const { createFakeBrowserPort } = await import('../platform/test/fakeBrowserPort');
const { WIDE_QUERY } = await import('./viewport');

const NO_KEYS: Record<JobProviderId, 'missing'> = { adzuna: 'missing', reed: 'missing' };

/** Every screen in the app except the Tracker board shares the column (L-326). */
const COLUMN_VIEWS = VIEWS.map((view) => view.id).filter((id) => id !== 'tracker');

/**
 * What must be IN each screen's column — proof the column wraps the screen's
 * real content, not an empty box. A new screen fails until it is listed here.
 */
const SCREENS: Readonly<Record<string, readonly string[]>> = {
  profile: ['profile-cv', 'profile-about', 'profile-gaps', 'profile-import'],
  search: ['search-form'],
  settings: ['settings-free-note', 'settings-privacy-summary'],
  analysis: ['analysis-try-sample'],
  tailor: ['tailor-cv-pick'],
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  tauri.invoke.mockReset();
  tauri.invoke.mockImplementation(async (command) => {
    if (command === 'ollama_probe') return null;
    if (command === 'secret_status') return false;
    throw new Error(`unexpected command ${command}`);
  });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: () => ({
      matches: true,
      media: WIDE_QUERY,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
  markWelcomeSeen();
});

afterEach(() => {
  cleanup();
  delete (window as { matchMedia?: unknown }).matchMedia;
});

function renderApp() {
  const user = userEvent.setup();
  let counter = 0;
  render(
    <App
      trackerPort={createFakeTrackerPort()}
      profilePort={createFakeProfilePort()}
      analysisPort={createFakeAnalysisPort({ cvs: [], jobs: [] })}
      tailorPort={createFakeTailorPort({ cvs: [], jobs: [], applications: [] })}
      searchPort={createFakeSearchPort([])}
      boardsPort={createFakeBoardPort()}
      browser={createFakeBrowserPort()}
      readKeyStates={async () => NO_KEYS}
      filePort={createFakeFilePort()}
      openedCv={createFakeOpenedCvPort()}
      backupPort={createFakeBackupPort()}
      erasePort={createFakeErasePort()}
      workflowPort={null}
      newId={() => `generated-${(counter += 1)}`}
      now={new Date('2026-10-06T09:00:00.000Z')}
    />,
  );
  return { user };
}

// ── The rule ────────────────────────────────────────────────────────────────

/** A width cap, with or without a breakpoint prefix (`md:max-w-2xl`). */
const WIDTH = /^max-w-(?:xs|sm|md|lg|xl|[2-7]xl|full|screen-[a-z0-9]+)$/;
const SCROLLS = /^overflow(?:-y)?-(?:auto|scroll)$/;

const tokens = (element: Element): string[] =>
  (element.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);

const utility = (token: string): string => token.slice(token.lastIndexOf(':') + 1);

const describeBox = (element: Element): string =>
  `<${element.tagName.toLowerCase()} class="${element.getAttribute('class') ?? ''}">`;

/** Every way `view` breaks the shared-column rule. Empty means all is well. */
function columnProblems(view: Element, column: string): string[] {
  const columns = [...view.querySelectorAll('[data-content-column]')];
  if (columns.length !== 1) return [`${String(columns.length)} content columns, not 1`];
  const [only] = columns as [Element];
  const problems: string[] = [];
  const own = tokens(only);
  const wanted = column.split(' ');
  if (!wanted.every((token) => own.includes(token))) {
    problems.push(`the column does not carry ${column}`);
  }
  if (!own.map(utility).includes('mx-auto'))
    problems.push('the column is left-aligned (no mx-auto)');

  // Up from the column to its scroll area, then the column's own children.
  const path: Element[] = [];
  let node: Element | null = only;
  while (node !== null && view.contains(node)) {
    path.push(node);
    if (node !== only && tokens(node).some((token) => SCROLLS.test(utility(token)))) break;
    node = node.parentElement;
  }
  const area = path.at(-1);
  if (area === undefined || area === only || !tokens(area).some((t) => SCROLLS.test(utility(t)))) {
    problems.push('the column is not inside a scroll area');
  }
  for (const element of [...path, ...only.children]) {
    for (const token of tokens(element)) {
      if (!WIDTH.test(utility(token))) continue;
      if (element === only && wanted.includes(token)) continue;
      problems.push(`${describeBox(element)} sets its own width: ${token}`);
    }
  }
  return problems;
}

/** The scroll area the column sits in. */
function scrollAreaOf(columnElement: Element): Element {
  const area = columnElement.parentElement?.closest('.overflow-y-auto');
  if (area === null || area === undefined) throw new Error('no scroll area above the column');
  return area;
}

// ── The rule finds what it is for ───────────────────────────────────────────

function fixture(inner: string): Element {
  const view = document.createElement('section');
  view.innerHTML = `<div class="min-h-0 flex-1 overflow-y-auto px-6">${inner}</div>`;
  return view;
}

describe('the rule itself (L-341)', () => {
  it('happy: one centred column carrying the width passes', () => {
    const view = fixture(
      '<div data-content-column class="mx-auto max-w-5xl space-y-5"><section class="mt-5"></section></div>',
    );
    expect(columnProblems(view, 'mx-auto max-w-5xl')).toEqual([]);
  });

  it('negative: a raw max-w-2xl column is reported', () => {
    const view = fixture('<div data-content-column class="mx-auto max-w-2xl space-y-5"></div>');
    expect(columnProblems(view, 'mx-auto max-w-5xl')).toEqual([
      'the column does not carry mx-auto max-w-5xl',
      '<div class="mx-auto max-w-2xl space-y-5"> sets its own width: max-w-2xl',
    ]);
  });

  it('negative: a left-aligned column is reported (L-326)', () => {
    const view = fixture('<div data-content-column class="max-w-5xl"></div>');
    expect(columnProblems(view, 'mx-auto max-w-5xl')).toEqual([
      'the column does not carry mx-auto max-w-5xl',
      'the column is left-aligned (no mx-auto)',
    ]);
  });

  it('negative: a width on a child of the column, or above it, is reported', () => {
    const view = fixture(
      '<div class="md:max-w-3xl"><div data-content-column class="mx-auto max-w-5xl">' +
        '<section class="mt-5 max-w-2xl"></section></div></div>',
    );
    expect(columnProblems(view, 'mx-auto max-w-5xl')).toEqual([
      '<div class="md:max-w-3xl"> sets its own width: md:max-w-3xl',
      '<section class="mt-5 max-w-2xl"> sets its own width: max-w-2xl',
    ]);
  });

  it('negative: two columns, no column, no scroll area', () => {
    const column = 'mx-auto max-w-5xl';
    expect(
      columnProblems(
        fixture(`<div data-content-column class="${column}"></div><div data-content-column></div>`),
        column,
      ),
    ).toEqual(['2 content columns, not 1']);
    expect(columnProblems(fixture(`<div class="${column}"></div>`), column)).toEqual([
      '0 content columns, not 1',
    ]);
    const bare = document.createElement('section');
    bare.innerHTML = `<div data-content-column class="${column}"></div>`;
    expect(columnProblems(bare, column)).toEqual(['the column is not inside a scroll area']);
  });

  it('boundary: a width deeper than the column’s children is the content’s own business', () => {
    const view = fixture(
      '<div data-content-column class="mx-auto max-w-5xl"><section><table class="max-w-lg">' +
        '</table><div class="max-w-sm"></div></section></div>',
    );
    expect(columnProblems(view, 'mx-auto max-w-5xl')).toEqual([]);
  });
});

// ── The app ─────────────────────────────────────────────────────────────────

/** The side-padding classes (`px-*`, at any breakpoint) on one element. */
const sidePadding = (element: Element): string[] =>
  tokens(element).filter((token) => utility(token).startsWith('px-'));

/** Does the view's header hold a title row capped and centred like the column? */
const headerIsCentred = (view: Element): boolean =>
  [...(view.querySelector('header')?.querySelectorAll('*') ?? [])].some((element) =>
    CONTENT_COLUMN.split(' ').every((token) => tokens(element).includes(token)),
  );

describe('every screen but the Tracker board, one centred content width (L-341, L-326)', () => {
  it('the width is the one the owner chose: 1024px, centred', () => {
    expect(CONTENT_COLUMN).toBe('mx-auto max-w-5xl');
  });

  it('every view except tracker is in the list, so a new screen fails here', () => {
    expect(COLUMN_VIEWS.length).toBeGreaterThanOrEqual(5);
    expect(Object.keys(SCREENS).sort()).toEqual([...COLUMN_VIEWS].sort());
  });

  for (const view of COLUMN_VIEWS) {
    it(`${view}: its content sits in the one shared column`, async () => {
      const inside = SCREENS[view] ?? [];
      const { user } = renderApp();
      await screen.findByTestId('shell');
      await user.click(screen.getByTestId(`nav-${view}`));
      for (const id of inside) await screen.findByTestId(id);

      const section = screen.getByTestId(`view-${view}`);
      expect(columnProblems(section, CONTENT_COLUMN)).toEqual([]);

      const column = section.querySelector('[data-content-column]');
      if (column === null) throw new Error('no column');
      for (const id of inside) expect(column.contains(screen.getByTestId(id)), id).toBe(true);
      // Nothing in the scroll area is outside the column, so nothing is wider.
      expect([...scrollAreaOf(column).children]).toEqual([column]);
      // One side padding on every screen, and the title lines up (L-326).
      expect(sidePadding(scrollAreaOf(column))).toEqual(SIDE_PADDING.split(' '));
      expect(headerIsCentred(section), `${view}: header title row`).toBe(true);
    });
  }

  it('boundary: Tracker is not one of them, and keeps its own width', async () => {
    expect(COLUMN_VIEWS).not.toContain('tracker');
    expect(Object.keys(SCREENS)).not.toContain('tracker');
    const { user } = renderApp();
    await screen.findByTestId('shell');
    await user.click(screen.getByTestId('nav-tracker'));
    const tracker = await screen.findByTestId('view-tracker');
    expect(tracker.querySelectorAll('[data-content-column]')).toHaveLength(0);
    expect(tracker.innerHTML).not.toContain('max-w-5xl');
    // Its header stays full width, in line with the full-width board under it.
    expect(headerIsCentred(tracker)).toBe(false);
  });
});
