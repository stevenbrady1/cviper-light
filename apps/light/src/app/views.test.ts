import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { DEFAULT_VIEW, SEQUENCE_VIEWS, VIEWS, YOU_VIEWS, viewById, viewForShortcut } from './views';

describe('the view registry', () => {
  it('the menu order is Tracker, Search, Analysis, Tailor, then Profile, Settings (L-402)', () => {
    // The order the owner approved on 13 November 2026. It was Profile first
    // (L-154). A reorder changes what the menu teaches and where every
    // shortcut lands, so it should have to be deliberate.
    expect(VIEWS.map((view) => view.id)).toEqual([
      'tracker',
      'search',
      'analysis',
      'tailor',
      'profile',
      'settings',
    ]);
    expect(SEQUENCE_VIEWS.map((view) => view.id)).toEqual([
      'tracker',
      'search',
      'analysis',
      'tailor',
    ]);
  });

  it('negative: no view was renamed, added or dropped — the six ids and labels are unchanged', () => {
    // The menu names are the owner's (D7). L-402 moves them; it renames none.
    expect(Object.fromEntries(VIEWS.map((view) => [view.id, view.label]))).toEqual({
      analysis: 'Analysis',
      profile: 'Profile',
      search: 'Search',
      settings: 'Settings',
      tailor: 'Tailor',
      tracker: 'Tracker',
    });
  });

  it('boundary: Profile and Settings are the only two in the "You" group', () => {
    expect(YOU_VIEWS.map((view) => view.id)).toEqual(['profile', 'settings']);
  });

  it('accounts for every view exactly once', () => {
    expect([...SEQUENCE_VIEWS, ...YOU_VIEWS]).toHaveLength(VIEWS.length);
    expect(new Set(VIEWS.map((view) => view.id)).size).toBe(VIEWS.length);
  });

  it('opens on the tracker — the question the user arrived with', () => {
    expect(DEFAULT_VIEW).toBe('tracker');
    expect(VIEWS.some((view) => view.id === DEFAULT_VIEW)).toBe(true);
  });

  it('gives every view a label and a summary', () => {
    for (const view of VIEWS) {
      expect(view.label.length).toBeGreaterThan(0);
      expect(view.summary.length).toBeGreaterThan(0);
      // Sentence case, not Title Case: only the first letter is capitalised.
      expect(view.label.slice(1)).toBe(view.label.slice(1).toLowerCase());
    }
  });
});

describe('keyboard shortcuts', () => {
  it('binds Ctrl+1 to Ctrl+5 to the first five views in the menu, in order (L-402)', () => {
    expect(viewForShortcut(1)).toBe('tracker');
    expect(viewForShortcut(2)).toBe('search');
    expect(viewForShortcut(3)).toBe('analysis');
    expect(viewForShortcut(4)).toBe('tailor');
    expect(viewForShortcut(5)).toBe('profile');
  });

  it('negative: the numbering from before L-402 is gone', () => {
    // Ctrl+1 was Profile, Ctrl+3 Tracker, Ctrl+4 Analysis, Ctrl+5 Tailor.
    expect(viewForShortcut(1)).not.toBe('profile');
    expect(viewForShortcut(3)).not.toBe('tracker');
    expect(viewForShortcut(4)).not.toBe('analysis');
    expect(viewForShortcut(5)).not.toBe('tailor');
  });

  it('boundary: the digit of each of the first five views is its place in the menu', () => {
    expect(VIEWS.map((view) => view.shortcut)).toEqual([1, 2, 3, 4, 5, null]);
  });

  it('never binds two views to the same digit', () => {
    const digits = VIEWS.map((view) => view.shortcut).filter((digit) => digit !== null);
    expect(new Set(digits).size).toBe(digits.length);
  });

  it('boundary: an unbound digit resolves to nothing rather than to a default', () => {
    // Ctrl+6 must do nothing at all. Falling through to a default would move
    // the user somewhere they did not ask to go.
    expect(viewForShortcut(6)).toBeNull();
    expect(viewForShortcut(0)).toBeNull();
  });

  it('leaves Settings unbound, because it is not a step', () => {
    expect(VIEWS.find((view) => view.id === 'settings')?.shortcut).toBeNull();
  });
});

describe('viewById', () => {
  it('finds a view', () => {
    expect(viewById('tracker').label).toBe('Tracker');
  });

  it('negative: throws on an id that does not exist rather than rendering the wrong screen', () => {
    expect(() => viewById('nonsense' as never)).toThrow(/Unknown view/);
  });
});

describe('the window is never small enough to need a breakpoint', () => {
  // The rail is a fixed 240px and the detail pane a fixed 380px, so 620px of
  // every window is spoken for before a single card is drawn. This app has no
  // responsive layout and no hamburger BECAUSE the window cannot get small
  // enough to need one — and that is only true while `tauri.conf.json` says so.
  //
  // Read from the real config rather than restated here: a number copied into a
  // test is a number that agrees with itself and with nothing else.
  const config: unknown = JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../../src-tauri/tauri.conf.json', import.meta.url)),
      'utf8',
    ),
  );

  const windows = (config as { app: { windows: { minWidth: number; minHeight: number }[] } }).app
    .windows;

  it('declares a minimum of at least 1000x700', () => {
    expect(windows.length).toBeGreaterThan(0);
    for (const window of windows) {
      expect(window.minWidth).toBeGreaterThanOrEqual(1000);
      expect(window.minHeight).toBeGreaterThanOrEqual(700);
    }
  });

  it('leaves real room for the board once the rail and the pane are taken', () => {
    // 240 + 380 = 620. Anything under about 900 would leave a board too narrow
    // for five columns, which is the point at which somebody starts asking for
    // a collapsible sidebar.
    for (const window of windows) {
      expect(window.minWidth - 240 - 380).toBeGreaterThanOrEqual(360);
    }
  });
});
