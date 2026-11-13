/**
 * One pop-up window, not one per screen (L-356).
 *
 * The app had three pop-ups — ConfirmDelete, ConsentGate and
 * TailorContactDialog — and each built its own backdrop, dialog markers, focus
 * trap, first focus and Escape. A fourth copy was one paste away, and three
 * copies drift: a trap on one element and the markers on another breaks Tab
 * without a sound. `ui/Dialog.tsx` now owns all of it, and the three keep only
 * their words and buttons.
 *
 * A forbid-list (LESSON-033): outside `ui/Dialog.tsx`, shipped source must NOT
 * hold
 *   * the dialog markers — `role="dialog"` / `"alertdialog"` or `aria-modal`
 *     as an attribute, a props key or a `setAttribute` call;
 *   * a native `<dialog>` element or `showModal()`;
 *   * a call to the focus trap, except where `TRAP_ALLOWED` says why.
 *
 * Reading the markers is fine and stays allowed: `DetailPane` and the trap ask
 * `document.querySelector('[role="dialog"][aria-modal="true"]')` whether a
 * pop-up is open, and a selector is not a pop-up. Comments are stripped before
 * the scan, so the docblocks that explain the rule never trip it.
 */
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT, displayPath, shippedText, stripComments, walk } from './repo-scan.ts';

/** The one file allowed to draw a pop-up. */
const SHARED = 'apps/light/src/ui/Dialog.tsx';

/** The dialog markers, as something that MAKES a dialog rather than looks for one. */
const MARKERS: readonly RegExp[] = [
  // JSX attribute. The `[` look-behind leaves a CSS selector alone.
  /(?<![[\w-])role\s*=\s*\{?\s*(["'`])(alert)?dialog\1/,
  /(?<![[\w-])aria-modal(?=\s*(=|\/?>|\s[\w{]))/,
  // A props object or a spread.
  /(["'])aria-modal\1\s*:/,
  /\brole\s*:\s*(["'`])(alert)?dialog\1/,
  // The DOM, by hand.
  /setAttribute\(\s*(["'])aria-modal\1/,
  /setAttribute\(\s*(["'])role\1\s*,\s*(["'`])(alert)?dialog\2/,
  // The browser's own modal.
  /<dialog[\s>]/,
  /\.showModal\s*\(/,
];

/** Calling the trap: a modal built by hand, around the shared part. */
const TRAP_CALL = /(?<!function\s+)\buseFocusTrap\s*\(/;

/** Files that may call the trap without being a pop-up, each with the reason. */
const TRAP_ALLOWED: Readonly<Record<string, string>> = {
  'apps/light/src/app/DetailPane.tsx':
    'On a phone, and over the Tracker board on a desktop, the detail pane covers what is behind ' +
    'it and keeps Tab inside, but it is a panel, ' +
    'not a pop-up: it carries no dialog markers, so a pop-up can open over it and win Tab.',
};

export function hasMarker(text: string): boolean {
  return MARKERS.some((pattern) => pattern.test(text));
}

export function callsTrap(text: string): boolean {
  return TRAP_CALL.test(text);
}

const FILES = [join(REPO_ROOT, 'apps/light/src'), join(REPO_ROOT, 'packages')].flatMap(
  (directory) => walk(directory, { extensions: ['.ts', '.tsx'] }),
);
const SCANNED = FILES.map((path) => ({ file: displayPath(path), text: shippedText(path) }));

describe('one pop-up window (L-356)', () => {
  it('reads the tree, and the shared part itself is caught, so the patterns match real markup', () => {
    expect(FILES.length).toBeGreaterThan(50);
    const shared = SCANNED.find(({ file }) => file === SHARED);
    expect(shared).toBeDefined();
    expect(hasMarker(shared?.text ?? '')).toBe(true);
    expect(callsTrap(shared?.text ?? '')).toBe(true);
  });

  it('forbid-list: no shipped file outside ui/Dialog.tsx makes a dialog', () => {
    const offenders = SCANNED.filter(({ file, text }) => file !== SHARED && hasMarker(text));
    expect(offenders.map(({ file }) => file)).toEqual([]);
  });

  it('forbid-list: no shipped file outside ui/Dialog.tsx builds its own trap, unless allowed', () => {
    const offenders = SCANNED.filter(
      ({ file, text }) => file !== SHARED && TRAP_ALLOWED[file] === undefined && callsTrap(text),
    );
    expect(offenders.map(({ file }) => file)).toEqual([]);
  });

  it('every allowed trap still exists and still calls the trap, so the list cannot go stale', () => {
    for (const file of Object.keys(TRAP_ALLOWED)) {
      const found = SCANNED.find((scanned) => scanned.file === file);
      expect(found, file).toBeDefined();
      expect(callsTrap(found?.text ?? ''), file).toBe(true);
    }
  });

  describe('the check can fail', () => {
    it.each([
      '<div role="dialog" aria-labelledby="x">',
      "<div role='alertdialog'>",
      "<div role={'dialog'}>",
      '<div role={`dialog`}>',
      '<div aria-modal="true">',
      '<div aria-modal={true}>',
      '<div aria-modal data-testid="x">',
      '<div aria-modal>',
      "const props = { 'aria-modal': true };",
      "const props = { role: 'dialog' };",
      "node.setAttribute('aria-modal', 'true')",
      "node.setAttribute('role', 'dialog')",
      '<dialog open>',
      'ref.current?.showModal()',
    ])('catches %s', (line) => {
      expect(hasMarker(line)).toBe(true);
    });

    it('catches a hand-built trap', () => {
      expect(callsTrap('  useFocusTrap(dialogRef);')).toBe(true);
      expect(callsTrap('useFocusTrap (ref, covers)')).toBe(true);
    });

    it('negative: looking for an open pop-up is not making one', () => {
      expect(hasMarker(`document.querySelector('[role="dialog"][aria-modal="true"]')`)).toBe(false);
      expect(hasMarker(`screen.getByRole('dialog')`)).toBe(false);
      expect(hasMarker('<div role="region" aria-label="dialogue">')).toBe(false);
    });

    it('negative: defining the trap is not calling it', () => {
      expect(callsTrap('export function useFocusTrap(ref, active = true) {')).toBe(false);
      expect(callsTrap("import { useFocusTrap } from '../lib/useFocusTrap';")).toBe(false);
    });

    it('negative: comments are ignored, in TypeScript and in JSX', () => {
      const source = [
        '// <div role="dialog" aria-modal="true">',
        '/* useFocusTrap(dialogRef); <dialog> */',
        '{/* role="dialog" aria-modal="true" */}',
        '<p>Nothing here</p>',
      ].join('\n');
      expect(hasMarker(stripComments(source))).toBe(false);
      expect(callsTrap(stripComments(source))).toBe(false);
    });
  });
});
