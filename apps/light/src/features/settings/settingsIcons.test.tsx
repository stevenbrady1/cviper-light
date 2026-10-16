// @vitest-environment jsdom
/**
 * Every Settings section heading shows its own duotone icon (L-256), in the
 * heading's tile, beside its label — and the heading's accessible name is still
 * just the label.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { type ComponentType } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  AboutIcon,
  DeleteEverythingIcon,
  GettingStartedIcon,
  JobBoardsIcon,
  PrivacyIcon,
  ReportProblemIcon,
  UpdatesIcon,
  YourDataIcon,
  type SettingsIconProps,
} from '../../ui/SettingsIcons';
import { createFakeFilePort } from '../../platform/test/fakeFilePort';

import { Settings } from './Settings';
import { createFakeBackupPort } from './test/fakePort';

afterEach(() => cleanup());

const SECTIONS: ReadonlyArray<readonly [string, ComponentType<SettingsIconProps>]> = [
  ['Your data', YourDataIcon],
  ['Job boards', JobBoardsIcon],
  ['Updates', UpdatesIcon],
  ['Getting started', GettingStartedIcon],
  ['Privacy', PrivacyIcon],
  ['About', AboutIcon],
  ['Report a problem', ReportProblemIcon],
  ['Delete everything', DeleteEverythingIcon],
];

/**
 * What the icon draws on its own, at the section tile's size. Delete
 * everything sits in a danger tile, which draws it in one colour (L-256).
 */
function expected(Icon: ComponentType<SettingsIconProps>, monochrome = false): string {
  const { container, unmount } = render(
    <Icon size={16} className="shrink-0" monochrome={monochrome} />,
  );
  const html = container.querySelector('svg')?.outerHTML ?? '';
  unmount();
  return html;
}

function renderSettings() {
  render(<Settings port={createFakeBackupPort()} filePort={createFakeFilePort()} />);
}

describe('the Settings section icons', () => {
  it.each(SECTIONS)('%s shows its own icon in the heading tile', (label, Icon) => {
    const markup = expected(Icon, label === 'Delete everything');
    renderSettings();

    const heading = screen.getByRole('heading', { name: label, level: 2 });
    // SectionHeading: [tile][text block containing the heading].
    const row = heading.closest('div.flex.items-start');
    const tile = row?.querySelector(':scope > span[aria-hidden="true"]');
    expect(tile, label).not.toBeNull();
    expect(tile?.querySelector('svg')?.outerHTML, label).toBe(markup);
  });

  it('no section heading still draws a single-colour line icon', () => {
    renderSettings();
    for (const [label] of SECTIONS) {
      const heading = screen.getByRole('heading', { name: label, level: 2 });
      const svg = heading.closest('div.flex.items-start')?.querySelector('svg');
      // The old drawings had stroke-width 2.
      expect(svg?.getAttribute('stroke-width'), label).toBe('1.75');
    }
  });

  it('the seven non-danger headings draw their accent through the token', () => {
    renderSettings();
    for (const [label] of SECTIONS.filter(([name]) => name !== 'Delete everything')) {
      const heading = screen.getByRole('heading', { name: label, level: 2 });
      const svg = heading.closest('div.flex.items-start')?.querySelector('svg');
      expect(svg?.innerHTML, label).toContain('var(--color-section-icon-accent)');
    }
  });

  it('Delete everything draws the whole bin in the danger colour — no teal accent', () => {
    renderSettings();
    const heading = screen.getByRole('heading', { name: 'Delete everything', level: 2 });
    const svg = heading.closest('div.flex.items-start')?.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.querySelector('[stroke="var(--color-section-icon-accent)"]')).toBeNull();
    expect(svg?.innerHTML).not.toContain('--color-section-icon-accent');
    const lines = [...(svg?.querySelectorAll('line') ?? [])];
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line.getAttribute('stroke')).toBe('currentColor');
    // The tile is the danger tone, so currentColor is the danger colour.
    expect(svg?.closest('span')?.className).toContain('text-danger');
  });

  it('the headings’ accessible names are still just the labels', () => {
    renderSettings();
    for (const [label] of SECTIONS) {
      expect(screen.getByRole('heading', { name: label, level: 2 }).textContent).toBe(label);
    }
  });
});
