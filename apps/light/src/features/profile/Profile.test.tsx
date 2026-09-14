// @vitest-environment jsdom
/**
 * The profile view, driven the way a user drives it: type into a box, and
 * the port receives the whole profile. Every assertion is against what the
 * FAKE PORT was handed — a render-only test would pass just as happily on a
 * form that saved nothing.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { emptyProfile, ok, type Profile as CandidateProfile } from '@cviper/core-types';

import { AUTOSAVE_DELAY_MS, Profile } from './Profile';
import { type GapsPort } from './gapsPort';
import { createFakeProfilePort } from './test/fakePort';

const NOW = new Date('2026-09-14T09:00:00.000Z');
const NOW_ISO = '2026-09-14T09:00:00.000Z';

/** Keeps the skills-gap panel off the database; its own states are `GapsPanel.test.tsx`. */
const GAPS: GapsPort = { load: async () => ok({ cvText: null, jobs: [] }) };

const SAVED: CandidateProfile = {
  ...emptyProfile('2026-09-01T08:00:00.000Z'),
  headline: 'Credit risk analyst',
  work_rights: 'UK citizen',
  languages: [{ name: 'French', level: 'B2' }],
  deal_breakers: ['Fully on-site', 'Below GBP 70k'],
  star_examples: [
    {
      title: 'IFRS 9 rebuild',
      situation: 'Failed audit.',
      task: 'Rebuild it.',
      action: 'Rewrote it.',
      result: 'Passed.',
    },
  ],
};

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

async function renderProfile(initial: CandidateProfile | null = null) {
  const port = createFakeProfilePort(initial);
  const user = userEvent.setup();
  render(<Profile port={port} now={NOW} gapsPort={GAPS} />);
  await screen.findByTestId('profile-headline');
  return { port, user };
}

function input(testid: string): HTMLInputElement | HTMLTextAreaElement {
  return screen.getByTestId(testid) as HTMLInputElement | HTMLTextAreaElement;
}

/** Type, then click away — the blur commits without waiting out the delay. */
function typeAndBlur(testid: string, value: string): void {
  const element = screen.getByTestId(testid);
  fireEvent.change(element, { target: { value } });
  fireEvent.blur(element);
}

describe('rendering', () => {
  it('renders the view with every section, empty, when there is no profile yet', async () => {
    const { port } = await renderProfile();

    expect(screen.getByTestId('view-profile')).toBeTruthy();
    for (const section of ['about', 'languages', 'wants', 'energy', 'star']) {
      expect(screen.getByTestId(`profile-${section}`)).toBeTruthy();
    }
    expect(input('profile-headline').value).toBe('');
    expect(input('profile-deal-breakers').value).toBe('');
    expect(screen.getByTestId('profile-languages-empty')).toBeTruthy();
    expect(screen.getByTestId('profile-star-empty')).toBeTruthy();
    // Nothing is written just by looking.
    expect(port.calls.save).toBe(0);
    expect(port.calls.load).toBe(1);
  });

  it('has no primary button: the screen is for writing, and writing saves itself', async () => {
    await renderProfile();
    expect(document.querySelectorAll('[data-primary="true"]')).toHaveLength(0);
  });

  it('shows a saved profile in its boxes, lists one per line', async () => {
    await renderProfile(SAVED);

    expect(input('profile-headline').value).toBe('Credit risk analyst');
    expect(input('profile-work-rights').value).toBe('UK citizen');
    expect(input('profile-deal-breakers').value).toBe('Fully on-site\nBelow GBP 70k');
    expect(input('profile-language-name-0').value).toBe('French');
    expect(input('profile-language-level-0').value).toBe('B2');
    expect(input('profile-star-title-0').value).toBe('IFRS 9 rebuild');
    expect(input('profile-star-result-0').value).toBe('Passed.');
    expect(screen.queryByTestId('profile-languages-empty')).toBeNull();
  });

  it('negative: says so when the profile cannot be loaded, and offers no boxes to lose work in', async () => {
    const port = createFakeProfilePort(SAVED);
    port.failNext('load');
    render(<Profile port={port} now={NOW} gapsPort={GAPS} />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('The database is locked');
    expect(alert.textContent).toContain('still on this machine');
    expect(screen.queryByTestId('profile-headline')).toBeNull();
  });
});

describe('editing a field', () => {
  it('hands the port the whole profile with the change and a fresh updated_at', async () => {
    const { port } = await renderProfile();

    typeAndBlur('profile-headline', '  Quant developer ');

    await vi.waitFor(() => expect(port.calls.save).toBe(1));
    const saved = port.saved();
    expect(saved?.headline).toBe('Quant developer');
    expect(saved?.id).toBe('me');
    expect(saved?.updated_at).toBe(NOW_ISO);
    // Everything else is the empty profile, intact.
    expect(saved?.languages).toEqual([]);
    expect(saved?.work_rights).toBeNull();
  });

  it('saves shortly after typing stops, without a blur', async () => {
    const { port } = await renderProfile();
    vi.useFakeTimers();

    fireEvent.change(screen.getByTestId('profile-work-rights'), {
      target: { value: 'UK citizen' },
    });
    expect(port.calls.save).toBe(0);

    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS + 10);

    expect(port.calls.save).toBe(1);
    expect(port.saved()?.work_rights).toBe('UK citizen');
  });

  it('turns a one-per-line box into a list, dropping blank lines', async () => {
    const { port } = await renderProfile();

    typeAndBlur('profile-deal-breakers', 'Fully on-site\n\n  Below GBP 70k \n');
    typeAndBlur('profile-target-sectors', 'Banking');
    typeAndBlur('profile-career-goals', 'Lead a team');
    typeAndBlur('profile-energising', 'Hard problems');
    typeAndBlur('profile-draining', 'Status meetings');
    typeAndBlur('profile-writing-style', 'Plain.');

    await vi.waitFor(() => expect(port.calls.save).toBe(6));
    const saved = port.saved();
    expect(saved?.deal_breakers).toEqual(['Fully on-site', 'Below GBP 70k']);
    expect(saved?.target_sectors).toEqual(['Banking']);
    expect(saved?.career_goals).toEqual(['Lead a team']);
    expect(saved?.energising).toEqual(['Hard problems']);
    expect(saved?.draining).toEqual(['Status meetings']);
    expect(saved?.writing_style).toBe('Plain.');
  });

  it('boundary: clearing a box saves null for text and an empty list for a list', async () => {
    const { port } = await renderProfile(SAVED);

    typeAndBlur('profile-headline', '   ');
    typeAndBlur('profile-deal-breakers', '\n\n');

    await vi.waitFor(() => expect(port.calls.save).toBe(2));
    expect(port.saved()?.headline).toBeNull();
    expect(port.saved()?.deal_breakers).toEqual([]);
  });

  it('builds each change on the last, so two edits do not overwrite each other', async () => {
    const { port } = await renderProfile();

    typeAndBlur('profile-headline', 'One');
    typeAndBlur('profile-work-rights', 'Two');

    await vi.waitFor(() => expect(port.calls.save).toBe(2));
    expect(port.saved()?.headline).toBe('One');
    expect(port.saved()?.work_rights).toBe('Two');
  });

  it('negative: an unchanged box writes nothing on blur', async () => {
    const { port } = await renderProfile(SAVED);

    fireEvent.blur(screen.getByTestId('profile-headline'));

    expect(port.calls.save).toBe(0);
  });

  it('negative: says so when the save fails, and keeps what was typed on screen', async () => {
    const { port } = await renderProfile();
    port.failNext('save');

    typeAndBlur('profile-headline', 'Quant developer');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('could not be saved');
    expect(alert.textContent).toContain('The database is locked');
    expect(input('profile-headline').value).toBe('Quant developer');
    expect(port.saved()).toBeNull();
  });
});

describe('languages', () => {
  it('adds a row, fills it in, and the port receives it', async () => {
    const { port, user } = await renderProfile();

    await user.click(screen.getByTestId('profile-language-add'));

    expect(screen.getByTestId('profile-language-0')).toBeTruthy();
    expect(screen.queryByTestId('profile-languages-empty')).toBeNull();

    typeAndBlur('profile-language-name-0', 'French');
    typeAndBlur('profile-language-level-0', 'B2');

    await vi.waitFor(() =>
      expect(port.saved()?.languages).toEqual([{ name: 'French', level: 'B2' }]),
    );
  });

  it('removes a row and the port receives the shorter list', async () => {
    const { port, user } = await renderProfile({
      ...SAVED,
      languages: [
        { name: 'French', level: 'B2' },
        { name: 'German', level: 'A1' },
      ],
    });

    await user.click(screen.getByTestId('profile-language-remove-0'));

    await vi.waitFor(() =>
      expect(port.saved()?.languages).toEqual([{ name: 'German', level: 'A1' }]),
    );
    // The surviving row keeps its own text: it was not the second row's box
    // renamed, which is what an index key would have done.
    expect(input('profile-language-name-0').value).toBe('German');
    expect(screen.queryByTestId('profile-language-1')).toBeNull();
  });

  it('boundary: removing the only row brings the empty note back', async () => {
    const { user } = await renderProfile(SAVED);

    await user.click(screen.getByTestId('profile-language-remove-0'));

    expect(await screen.findByTestId('profile-languages-empty')).toBeTruthy();
  });
});

describe('STAR examples', () => {
  it('adds a card with the five parts, fills one in, and the port receives it', async () => {
    const { port, user } = await renderProfile();

    await user.click(screen.getByTestId('profile-star-add'));

    const card = screen.getByTestId('profile-star-0');
    for (const part of ['title', 'situation', 'task', 'action', 'result']) {
      expect(within(card).getByTestId(`profile-star-${part}-0`)).toBeTruthy();
    }

    typeAndBlur('profile-star-title-0', 'IFRS 9 rebuild');
    typeAndBlur('profile-star-result-0', 'Passed.');

    await vi.waitFor(() =>
      expect(port.saved()?.star_examples).toEqual([
        { title: 'IFRS 9 rebuild', situation: '', task: '', action: '', result: 'Passed.' },
      ]),
    );
  });

  it('removes a card and the port receives an empty list', async () => {
    const { port, user } = await renderProfile(SAVED);

    await user.click(screen.getByTestId('profile-star-remove-0'));

    await vi.waitFor(() => expect(port.saved()?.star_examples).toEqual([]));
    expect(screen.queryByTestId('profile-star-0')).toBeNull();
    expect(screen.getByTestId('profile-star-empty')).toBeTruthy();
  });
});
