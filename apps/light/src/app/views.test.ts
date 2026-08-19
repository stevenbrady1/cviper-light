import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_VIEW,
  PINNED_VIEWS,
  SEQUENCE_VIEWS,
  VIEWS,
  viewById,
  viewForShortcut,
} from './views';

describe('the view registry', () => {
  it('lists the three steps in workflow order', () => {
    // Search, then Tracker, then Analysis — the order a job hunt happens in. A
    // reorder here changes what the rail teaches, so it should have to be
    // deliberate.
    expect(SEQUENCE_VIEWS.map((view) => view.id)).toEqual(['search', 'tracker', 'analysis']);
  });

  it('pins Settings to the bottom, outside the sequence', () => {
    expect(PINNED_VIEWS.map((view) => view.id)).toEqual(['settings']);
  });

  it('accounts for every view exactly once', () => {
    expect([...SEQUENCE_VIEWS, ...PINNED_VIEWS]).toHaveLength(VIEWS.length);
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
  it('binds Ctrl+1, Ctrl+2 and Ctrl+3 to the three steps, in order', () => {
    expect(viewForShortcut(1)).toBe('search');
    expect(viewForShortcut(2)).toBe('tracker');
    expect(viewForShortcut(3)).toBe('analysis');
  });

  it('never binds two views to the same digit', () => {
    const digits = VIEWS.map((view) => view.shortcut).filter((digit) => digit !== null);
    expect(new Set(digits).size).toBe(digits.length);
  });

  it('boundary: an unbound digit resolves to nothing rather than to a default', () => {
    // Ctrl+4 must do nothing at all. Falling through to a default would move
    // the user somewhere they did not ask to go.
    expect(viewForShortcut(4)).toBeNull();
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
