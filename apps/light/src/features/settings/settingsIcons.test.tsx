// @vitest-environment jsdom
/**
 * No Settings section heading draws an icon (L-440), and each heading's
 * accessible name is still just its label.
 *
 * Until L-440 every heading had its own duotone icon in a small tile beside it
 * (L-256, the owner's choice on 2026-10-16). A tile beside a title is the same
 * template tell L-431 took off the page titles, one level down, so the owner
 * chose to remove these too (2026-11-19). Delete everything loses its red tile;
 * its red Delete button and its warning words stay.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { DESTRUCTIVE_BUTTON } from '../../app/buttons';
import { createFakeFilePort } from '../../platform/test/fakeFilePort';

import { Settings } from './Settings';
import { createFakeBackupPort } from './test/fakePort';

afterEach(() => cleanup());

/** The headings that had a tile until L-440. Each must still be there. */
const SECTIONS = [
  'AI provider keys',
  'What I have agreed to',
  'Your data',
  'Job boards',
  'API keys',
  'Updates',
  'Getting started',
  'Privacy',
  'About',
  'Report a problem',
  'Delete everything',
] as const;

function renderSettings() {
  return render(<Settings port={createFakeBackupPort()} filePort={createFakeFilePort()} />);
}

/** Every svg or hidden tile in the heading's section that comes BEFORE the heading. */
function marksBefore(heading: Element): Element[] {
  const section = heading.closest('section');
  expect(section, heading.textContent ?? '').not.toBeNull();
  return [...(section?.querySelectorAll('svg, span[aria-hidden="true"]') ?? [])].filter(
    (mark) => (mark.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
  );
}

describe('the Settings section headings (L-440)', () => {
  it('every heading that had a tile is still there, as a level-2 heading', () => {
    const { container } = renderSettings();
    const names = [...container.querySelectorAll('h2')].map((h) => h.textContent);
    for (const label of SECTIONS) expect(names, label).toContain(label);
  });

  it('no Settings section heading draws an icon or a tile in front of it', () => {
    const { container } = renderSettings();
    const headings = [...container.querySelectorAll('h2')];
    expect(headings.length).toBeGreaterThanOrEqual(SECTIONS.length);
    for (const heading of headings) {
      expect(marksBefore(heading), heading.textContent ?? '').toEqual([]);
    }
  });

  it('Delete everything keeps its red Delete button', () => {
    renderSettings();
    expect(screen.getByTestId('settings-erase').className).toBe(`mt-3 ${DESTRUCTIVE_BUTTON}`);
  });

  it('each heading’s name is still just its label', () => {
    renderSettings();
    for (const label of SECTIONS) {
      // `hidden`: "API keys" sits in a closed <details>.
      const heading = screen.getByRole('heading', { name: label, level: 2, hidden: true });
      expect(heading.textContent, label).toBe(label);
    }
  });
});
