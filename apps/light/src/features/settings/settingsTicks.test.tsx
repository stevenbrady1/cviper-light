// @vitest-environment jsdom
/**
 * The last four tick boxes wear the house look (L-469): each job board's on/off
 * tick, "This runs on my own computer or network", the telemetry tick and the
 * update-on-launch tick. The input is `size-4 accent-blue` and its label is a
 * 44px target on a phone (`min-h-11 … md:min-h-0`), as Search's "Best match
 * first" (L-462). They stay real tick boxes, so the words still tick them.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ok } from '@cviper/core-types';

import { BoardSettings } from '../boards/BoardSettings';
import { NO_PREFERENCES } from '../boards/model';
import { createFakeBoardPort } from '../boards/test/fakeBoardPort';
import { COUNTRY_STORAGE_KEY } from '../search/country';

import { CustomServiceCard } from './keys/CustomServiceCard';
import { type CustomServicePort } from './keys/customServicePort';
import { createFakeKeyPort } from './keys/test/fakeKeyPort';
import { Settings } from './Settings';
import { TELEMETRY_NOTE } from './telemetry';
import { createFakeBackupPort } from './test/fakePort';
import { UPDATE_CHECK_STORAGE_KEY, updateCheckOnLaunchEnabled } from './updates/launchCheck';
import { UPDATE_CHECK_TOGGLE_LABEL } from './updates/model';
import { UpdateCheck } from './updates/UpdateCheck';
import { createFakeUpdatePort } from './updates/test/fakeUpdatePort';

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(COUNTRY_STORAGE_KEY, 'gb');
});

afterEach(() => {
  cleanup();
});

function classesOf(element: Element): string[] {
  return element.className.split(/\s+/).filter((name) => name !== '');
}

/** The input is the house tick, inside a label that is 44px tall on a phone. */
function houseTick(box: HTMLElement): void {
  expect(box.getAttribute('type')).toBe('checkbox');
  expect(classesOf(box)).toEqual(expect.arrayContaining(['size-4', 'accent-blue']));
  const label = box.closest('label')!;
  expect(label).not.toBeNull();
  expect(classesOf(label)).toEqual(expect.arrayContaining(['min-h-11', 'md:min-h-0']));
}

const LONG_NAME = 'A board with a very long name that goes on and on past the edge';

/** A user-added board, with a 60-plus character name. */
const LONG_BOARD = {
  id: 'custom-long',
  label: LONG_NAME,
  urlTemplate: 'https://www.example.com/jobs?q={keyword}',
  encoding: 'plus',
} as const;

async function openBoards() {
  const user = userEvent.setup();
  const port = createFakeBoardPort({ ...NO_PREFERENCES, custom: [LONG_BOARD] });
  render(<BoardSettings port={port} />);
  await screen.findByTestId('board-row-custom-long');
  return { user, port };
}

/** A card with nothing saved yet, so the own-network tick is free to move. */
function emptyService(): CustomServicePort {
  return {
    status: () => Promise.resolve(ok(null)),
    save: () => Promise.resolve(ok(undefined)),
    remove: () => Promise.resolve(ok(undefined)),
    listModels: () => Promise.resolve(ok([])),
  };
}

function renderSettings() {
  return render(
    <Settings
      port={createFakeBackupPort()}
      keyPort={createFakeKeyPort()}
      updatePort={createFakeUpdatePort()}
    />,
  );
}

describe('happy: the four tick boxes wear the house look', () => {
  it('each job board tick', async () => {
    await openBoards();
    const ticks = screen.getAllByTestId(/^board-toggle-/);
    expect(ticks.length).toBeGreaterThan(1);
    for (const tick of ticks) houseTick(tick);
  });

  it('"This runs on my own computer or network"', async () => {
    render(<CustomServiceCard port={emptyService()} />);
    houseTick(await screen.findByTestId('custom-service-own-network'));
  });

  it('the telemetry tick', async () => {
    renderSettings();
    houseTick(await screen.findByTestId('settings-telemetry'));
  });

  it('"Check for updates when the app starts"', async () => {
    render(<UpdateCheck port={createFakeUpdatePort()} version="0.1.0" />);
    houseTick(await screen.findByTestId('settings-update-on-launch'));
  });

  it('the ticks whose words can wrap keep the box on the first line', async () => {
    render(<UpdateCheck port={createFakeUpdatePort()} version="0.1.0" />);
    const box = await screen.findByTestId('settings-update-on-launch');
    expect(classesOf(box)).toContain('mt-1');
    expect(classesOf(box.closest('label')!)).toContain('items-start');
  });
});

describe('negative', () => {
  it('the telemetry tick stays disabled and unticked, and a click changes nothing', async () => {
    const user = userEvent.setup();
    renderSettings();
    const box = (await screen.findByTestId('settings-telemetry')) as HTMLInputElement;
    expect(box.disabled).toBe(true);
    expect(box.checked).toBe(false);

    await user.click(box);
    await user.click(screen.getByTestId('settings-telemetry-note'));

    expect(box.checked).toBe(false);
  });

  it('no words change', async () => {
    renderSettings();
    expect((await screen.findByTestId('settings-telemetry-note')).textContent).toBe(TELEMETRY_NOTE);
    cleanup();
    render(<CustomServiceCard port={emptyService()} />);
    const own = await screen.findByTestId('custom-service-own-network');
    expect(own.closest('label')!.textContent).toBe('This runs on my own computer or network');
    cleanup();
    render(<UpdateCheck port={createFakeUpdatePort()} version="0.1.0" />);
    const update = await screen.findByTestId('settings-update-on-launch');
    expect(update.closest('label')!.textContent).toBe(UPDATE_CHECK_TOGGLE_LABEL);
  });
});

describe('boundary: a board with a long name', () => {
  it('keeps its tick, its name and both arrows in the row; the name truncates', async () => {
    await openBoards();
    const row = screen.getByTestId('board-row-custom-long');
    const tick = within(row).getByTestId('board-toggle-custom-long');
    houseTick(tick);
    expect(LONG_NAME.length).toBeGreaterThanOrEqual(60);
    const name = within(row).getByText(LONG_NAME);
    expect(classesOf(name)).toEqual(expect.arrayContaining(['min-w-0', 'truncate']));
    expect(classesOf(tick.closest('label')!)).toEqual(
      expect.arrayContaining(['min-w-0', 'flex-1']),
    );
    expect(within(row).getByTestId('board-up-custom-long')).toBeTruthy();
    expect(within(row).getByTestId('board-down-custom-long')).toBeTruthy();
  });
});

describe('interaction: the words still tick the box', () => {
  it('a click on "Check for updates when the app starts" flips the setting, and back', async () => {
    const user = userEvent.setup();
    render(<UpdateCheck port={createFakeUpdatePort()} version="0.1.0" />);
    const box = (await screen.findByTestId('settings-update-on-launch')) as HTMLInputElement;
    const before = box.checked;
    expect(updateCheckOnLaunchEnabled()).toBe(before);

    await user.click(screen.getByText(UPDATE_CHECK_TOGGLE_LABEL));
    expect(box.checked).toBe(!before);
    expect(updateCheckOnLaunchEnabled()).toBe(!before);

    await user.click(screen.getByText(UPDATE_CHECK_TOGGLE_LABEL));
    expect(box.checked).toBe(before);
    localStorage.removeItem(UPDATE_CHECK_STORAGE_KEY);
  });

  it('a click on a board name switches that board off, and it is saved', async () => {
    const { user, port } = await openBoards();
    const box = screen.getByTestId('board-toggle-custom-long') as HTMLInputElement;
    expect(box.checked).toBe(true);

    await user.click(screen.getByText(LONG_NAME));

    expect(box.checked).toBe(false);
    expect(port.saved().disabled).toEqual(['custom-long']);
  });

  it('a click on "This runs on my own computer or network" ticks it', async () => {
    const user = userEvent.setup();
    render(<CustomServiceCard port={emptyService()} />);
    const box = (await screen.findByTestId('custom-service-own-network')) as HTMLInputElement;
    expect(box.checked).toBe(false);

    await user.click(screen.getByText('This runs on my own computer or network'));

    expect(box.checked).toBe(true);
  });
});
