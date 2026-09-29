// @vitest-environment jsdom
/**
 * The window-wide refusal of dropped files and links (L-186).
 *
 * `tauri.conf.json` turns the native drag-and-drop handler OFF, because on
 * Windows that handler swallows every HTML5 drag — which is why a card could
 * not be moved between tracker columns. With it off, WebView2 treats a file
 * dropped on the window the way Chromium does: it navigates to it. A CV PDF
 * dropped anywhere in the app would replace the whole app with a PDF viewer,
 * with no back button. These tests pin the refusal that prevents that, and —
 * just as important — that it never gets in the way of a drop the app itself
 * asked for.
 */
import { fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { refuseForeignDrops } from './foreignDrops';

interface FakeDataTransfer {
  types: string[];
  dropEffect: string;
}

function carrying(...types: string[]): FakeDataTransfer {
  return { types, dropEffect: 'copy' };
}

let uninstall: () => void = () => {};

beforeEach(() => {
  uninstall = refuseForeignDrops(window);
});

afterEach(() => {
  uninstall();
  document.body.innerHTML = '';
});

describe('a file dragged onto the window', () => {
  it('is refused on dragover, with a "no drop" cursor', () => {
    const dataTransfer = carrying('Files');

    // `fireEvent` returns false when something called `preventDefault`.
    const notCancelled = fireEvent.dragOver(document.body, { dataTransfer });

    expect(notCancelled).toBe(false);
    expect(dataTransfer.dropEffect).toBe('none');
  });

  it('is refused on drop, so the web view never navigates to it', () => {
    const notCancelled = fireEvent.drop(document.body, { dataTransfer: carrying('Files') });

    expect(notCancelled).toBe(false);
  });

  it('is refused on a nested element too — the guard sits on the window', () => {
    const inner = document.createElement('div');
    document.body.appendChild(inner);
    const dataTransfer = carrying('Files');

    expect(fireEvent.dragOver(inner, { dataTransfer })).toBe(false);
    expect(dataTransfer.dropEffect).toBe('none');
  });
});

describe('a link dragged onto the window', () => {
  it('is refused, because a dropped URL navigates the web view just like a file', () => {
    // Every `<a>` is draggable by default, including the advert link in the
    // detail pane. Dropped back onto the page, it would load the job site
    // INSIDE the app window.
    const dataTransfer = carrying('text/uri-list', 'text/plain');

    expect(fireEvent.dragOver(document.body, { dataTransfer })).toBe(false);
    expect(dataTransfer.dropEffect).toBe('none');
    expect(fireEvent.drop(document.body, { dataTransfer })).toBe(false);
  });
});

describe('drops the app asked for', () => {
  it('negative: leaves a drag alone when an in-app drop target already claimed it', () => {
    // A tracker column calls `preventDefault` and sets `move` for its own
    // payload. The window listener runs AFTER it (bubble phase), so if it
    // overwrote `dropEffect` the column would stop being a drop target — the
    // exact bug this change fixes, reintroduced one layer up.
    const column = document.createElement('section');
    column.addEventListener('dragover', (event) => {
      event.preventDefault();
      (event as DragEvent).dataTransfer!.dropEffect = 'move';
    });
    document.body.appendChild(column);
    const dataTransfer = carrying('application/x-cviper-application-id', 'Files');

    fireEvent.dragOver(column, { dataTransfer });

    expect(dataTransfer.dropEffect).toBe('move');
  });

  it('negative: leaves plain text alone, so text can still be dragged into a field', () => {
    const dataTransfer = carrying('text/plain');

    expect(fireEvent.dragOver(document.body, { dataTransfer })).toBe(true);
    expect(dataTransfer.dropEffect).toBe('copy');
    expect(fireEvent.drop(document.body, { dataTransfer })).toBe(true);
  });
});

describe('boundaries', () => {
  it('ignores a drag event with no dataTransfer at all', () => {
    expect(fireEvent.dragOver(document.body)).toBe(true);
    expect(fireEvent.drop(document.body)).toBe(true);
  });

  it('ignores a drag carrying no types', () => {
    const dataTransfer = carrying();

    expect(fireEvent.dragOver(document.body, { dataTransfer })).toBe(true);
    expect(dataTransfer.dropEffect).toBe('copy');
  });

  it('stops refusing once uninstalled', () => {
    uninstall();
    uninstall = () => {};

    expect(fireEvent.drop(document.body, { dataTransfer: carrying('Files') })).toBe(true);
  });
});
