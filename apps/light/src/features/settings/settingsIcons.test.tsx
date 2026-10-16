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

/** What the icon draws on its own, at the section tile's size. */
function expected(Icon: ComponentType<SettingsIconProps>): string {
  const { container, unmount } = render(<Icon size={16} className="shrink-0" />);
  const html = container.querySelector('svg')?.outerHTML ?? '';
  unmount();
  return html;
}

function renderSettings() {
  render(<Settings port={createFakeBackupPort()} filePort={createFakeFilePort()} />);
}

describe('the Settings section icons', () => {
  it.each(SECTIONS)('%s shows its own icon in the heading tile', (label, Icon) => {
    const markup = expected(Icon);
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
      // The old drawings had stroke-width 2 and no accent.
      expect(svg?.getAttribute('stroke-width'), label).toBe('1.75');
      expect(svg?.innerHTML, label).toContain('var(--color-section-icon-accent)');
    }
  });

  it('the headings’ accessible names are still just the labels', () => {
    renderSettings();
    for (const [label] of SECTIONS) {
      expect(screen.getByRole('heading', { name: label, level: 2 }).textContent).toBe(label);
    }
  });
});
