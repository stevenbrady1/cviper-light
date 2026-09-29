/**
 * The HTML5 drag-and-drop contract (L-186): no web view in this app may keep
 * Tauri's native drag-and-drop handler on.
 *
 * ============================================================================
 * WHY THIS EXISTS
 * ============================================================================
 * Issue #152: on Windows 11 (0.4.0, WebView2) a tracker card could not be moved
 * between status columns. The React side was correct — `dragstart` sets the
 * payload, the column calls `preventDefault` on `dragover` — and every jsdom
 * test was green. The break was one layer down: Tauri's `dragDropEnabled`
 * DEFAULTS TO TRUE, and on Windows wry implements it by revoking WebView2's own
 * OLE drop target and registering one that only understands dropped FILES
 * (`wry/src/webview2/drag_drop.rs`). Every in-page drag then lands on a target
 * that answers "no drop", and `dragover`/`drop` never reach the page. Tauri's
 * own docs say it: "Disabling it is required to use HTML5 drag and drop on the
 * frontend on Windows." macOS and Linux do not behave this way, which is how it
 * shipped.
 *
 * Nothing in a unit test can see this — jsdom has no WebView2 — and `tauri
 * build` is not run here. So the configuration is the thing asserted.
 *
 * ============================================================================
 * A FORBID-LIST, NOT AN ALLOW-LIST (LESSON-033)
 * ============================================================================
 * What is forbidden: a configured window whose EFFECTIVE `dragDropEnabled` is
 * anything but `false` (absent counts, because absent means true); a Rust
 * webview builder that does not call `disable_drag_drop_handler`; and frontend
 * code listening for Tauri's native drag-drop events, which with the handler
 * off would simply never fire — a feature that looks wired up and is dead.
 *
 * The one presence check is anti-inert, in the same spirit as the Store-build
 * contract: with the native handler off, WebView2 NAVIGATES to a file or link
 * dropped on the window (a CV PDF would replace the app). `main.tsx` must
 * therefore still install `refuseForeignDrops`, or turning the handler off has
 * traded one bug for a worse one.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT, displayPath, shippedText, walk } from './repo-scan.ts';

const TAURI_DIR = join(REPO_ROOT, 'apps/light/src-tauri');
const RUST_DIR = join(TAURI_DIR, 'src');
const WEB_DIR = join(REPO_ROOT, 'apps/light/src');
const MAIN_PATH = join(WEB_DIR, 'main.tsx');

/**
 * Every configured window that would keep the native handler on.
 *
 * Tauri reads the camelCase key and a kebab-case alias (`drag-drop-enabled`),
 * and defaults to true when neither is present — so a window is only safe when
 * one of them is literally `false`. Returns each offender's label (or index).
 */
export function windowsWithNativeDragDrop(config: unknown): string[] {
  const windows = (config as { app?: { windows?: unknown } } | null)?.app?.windows;
  if (!Array.isArray(windows)) return [];

  return windows.flatMap((window: unknown, index) => {
    const entry = (window ?? {}) as Record<string, unknown>;
    const value =
      'dragDropEnabled' in entry ? entry['dragDropEnabled'] : entry['drag-drop-enabled'];
    if (value === false) return [];
    const label = typeof entry['label'] === 'string' ? entry['label'] : `#${index}`;
    return [label];
  });
}

/** `tauri.conf.json` and every platform or flavour overlay beside it. */
const CONFIG_FILES = readdirSync(TAURI_DIR)
  .filter((name) => /^tauri(\.[\w-]+)?\.conf\.json$/.test(name))
  .map((name) => join(TAURI_DIR, name));

describe('windowsWithNativeDragDrop (the checker itself)', () => {
  it('negative: flags a window that says nothing, because absent means on', () => {
    expect(windowsWithNativeDragDrop({ app: { windows: [{ title: 'x' }] } })).toEqual(['#0']);
  });

  it('negative: flags a window that turns it on explicitly, by label', () => {
    expect(
      windowsWithNativeDragDrop({ app: { windows: [{ label: 'main', dragDropEnabled: true }] } }),
    ).toEqual(['main']);
  });

  it('negative: a truthy string is not `false`', () => {
    expect(windowsWithNativeDragDrop({ app: { windows: [{ dragDropEnabled: 'false' }] } })).toEqual(
      ['#0'],
    );
  });

  it('accepts `false` under either spelling Tauri reads', () => {
    expect(
      windowsWithNativeDragDrop({
        app: { windows: [{ dragDropEnabled: false }, { 'drag-drop-enabled': false }] },
      }),
    ).toEqual([]);
  });

  it('boundary: only the offending window of several is named', () => {
    expect(
      windowsWithNativeDragDrop({
        app: { windows: [{ label: 'a', dragDropEnabled: false }, { label: 'b' }] },
      }),
    ).toEqual(['b']);
  });

  it('boundary: a config with no windows (an overlay) has nothing to flag', () => {
    expect(windowsWithNativeDragDrop({ bundle: {} })).toEqual([]);
    expect(windowsWithNativeDragDrop({ app: { windows: [] } })).toEqual([]);
    expect(windowsWithNativeDragDrop(null)).toEqual([]);
  });
});

describe('the configured windows', () => {
  it('finds the main config (so the scan below is not vacuous)', () => {
    expect(CONFIG_FILES.map(displayPath)).toContain('apps/light/src-tauri/tauri.conf.json');
  });

  it.each(CONFIG_FILES.map((path) => [displayPath(path), path]))(
    '%s keeps no window on the native drag-and-drop handler',
    (_display, path) => {
      const config = JSON.parse(readFileSync(path, 'utf8')) as unknown;
      expect(
        windowsWithNativeDragDrop(config),
        'Set "dragDropEnabled": false on every window. Left on, Windows swallows every ' +
          'HTML5 drag and tracker cards cannot be moved (L-186, issue #152).',
      ).toEqual([]);
    },
  );
});

describe('webviews built in Rust', () => {
  it('never builds one without disabling the native handler', () => {
    const offenders = walk(RUST_DIR, { extensions: ['.rs'] }).filter((path) => {
      const source = shippedText(path);
      return (
        /\b(WebviewWindowBuilder|WebviewBuilder)\b/.test(source) &&
        !source.includes('disable_drag_drop_handler')
      );
    });
    expect(offenders.map(displayPath)).toEqual([]);
  });
});

describe('the frontend', () => {
  it('does not listen for native drag-drop events, which can no longer fire', () => {
    const NATIVE_DROP = /onDragDropEvent|tauri:\/\/drag-|TauriEvent\.DRAG_/;
    const offenders = walk(WEB_DIR, { extensions: ['.ts', '.tsx'] }).filter((path) =>
      NATIVE_DROP.test(shippedText(path)),
    );
    expect(offenders.map(displayPath)).toEqual([]);
  });

  it('still refuses dropped files and links window-wide (anti-inert)', () => {
    expect(shippedText(MAIN_PATH)).toMatch(/\brefuseForeignDrops\(\s*window\s*\)/);
  });
});
