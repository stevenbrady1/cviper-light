// @vitest-environment jsdom
/**
 * The "Bring a profile in" section of the Profile view (L-167), driven the
 * way a user drives it: press the button, read the review, add or cancel.
 * Every assertion about the outcome is against what the FAKE PROFILE PORT
 * was handed — a review that rendered but saved nothing would pass a
 * render-only test.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { emptyProfile, ok, type Profile as CandidateProfile } from '@cviper/core-types';

import { createFakeFilePort } from '../../platform/test/fakeFilePort';

import { Profile } from './Profile';
import { type GapsPort } from './gapsPort';
import { FILLED, PRISTINE } from './test/aiJobSearchFixtures';
import { createFakeProfilePort } from './test/fakePort';

const NOW = new Date('2026-09-14T09:00:00.000Z');
const NOW_ISO = '2026-09-14T09:00:00.000Z';
const GAPS: GapsPort = { load: async () => ok({ cvText: null, jobs: [] }) };

afterEach(() => cleanup());

async function renderProfile(initial: CandidateProfile | null = null) {
  const port = createFakeProfilePort(initial);
  const files = createFakeFilePort();
  render(<Profile port={port} now={NOW} gapsPort={GAPS} filePort={files} />);
  await screen.findByTestId('profile-headline');
  return { port, files };
}

/** Press the button and wait for the review; the fake has already been told what to answer. */
async function importFrom() {
  fireEvent.click(screen.getByTestId('profile-import-ajs'));
  return screen.findByTestId('profile-import-review');
}

describe('the section', () => {
  it('is there, quiet, with the one-line promise under the button', async () => {
    await renderProfile();
    const section = screen.getByTestId('profile-import');
    expect(within(section).getByTestId('profile-import-ajs').textContent).toMatch(
      /Import from an ai-job-search folder/,
    );
    expect(section.textContent).toMatch(
      /Reads four Markdown files from that folder, on this computer\. Nothing is uploaded\./,
    );
    expect(screen.queryByTestId('profile-import-review')).toBeNull();
    expect(screen.queryByTestId('profile-import-problem')).toBeNull();
  });

  it('a cancelled folder dialog shows nothing and saves nothing', async () => {
    const { port, files } = await renderProfile();
    files.nextWorkspace(null);
    fireEvent.click(screen.getByTestId('profile-import-ajs'));
    // Let the promise settle.
    await screen.findByTestId('profile-import-ajs');
    await Promise.resolve();
    expect(screen.queryByTestId('profile-import-review')).toBeNull();
    expect(screen.queryByTestId('profile-import-problem')).toBeNull();
    expect(port.calls.save).toBe(0);
    expect(files.calls.pickProfileWorkspace).toBe(1);
  });
});

describe('the review', () => {
  it('lists what was found, with counts, and the notes', async () => {
    const { files } = await renderProfile();
    files.nextWorkspace(FILLED);
    const review = await importFrom();

    expect(within(review).getByTestId('profile-import-found-headline').textContent).toMatch(
      /Credit risk analyst moving into quant development/,
    );
    expect(within(review).getByTestId('profile-import-found-languages').textContent).toMatch(/3/);
    expect(within(review).getByTestId('profile-import-found-deal_breakers').textContent).toMatch(
      /3/,
    );
    expect(within(review).getByTestId('profile-import-found-star_examples').textContent).toMatch(
      /2/,
    );
    expect(within(review).getByTestId('profile-import-notes').textContent).toMatch(
      /Half-finished example/,
    );
    // The two buttons are both there, and apply is live.
    expect((within(review).getByTestId('profile-import-apply') as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(within(review).getByTestId('profile-import-cancel')).toBeTruthy();
  });

  it('"Add to my profile" merges and saves through the profile port, never overwriting typed text', async () => {
    const typed: CandidateProfile = {
      ...emptyProfile('2026-09-01T08:00:00.000Z'),
      headline: 'What I typed',
      deal_breakers: ['fully on-site'],
      languages: [{ name: 'French', level: 'C1' }],
    };
    const { port, files } = await renderProfile(typed);
    files.nextWorkspace(FILLED);
    const review = await importFrom();

    fireEvent.click(within(review).getByTestId('profile-import-apply'));

    const saved = port.saved();
    expect(saved).not.toBeNull();
    expect(saved?.headline).toBe('What I typed');
    expect(saved?.deal_breakers).toEqual([
      'fully on-site',
      'Below GBP 70k',
      'Relocation outside the UK',
    ]);
    expect(saved?.languages).toEqual([
      { name: 'French', level: 'C1' },
      { name: 'English', level: 'Native' },
      { name: 'German', level: 'A2' },
    ]);
    expect(saved?.work_rights).toMatch(/UK citizen/);
    expect(saved?.star_examples).toHaveLength(2);
    expect(saved?.updated_at).toBe(NOW_ISO);
    expect(port.calls.save).toBe(1);

    // The review is gone, the form shows the merged values, and the new rows exist.
    expect(screen.queryByTestId('profile-import-review')).toBeNull();
    expect((screen.getByTestId('profile-deal-breakers') as HTMLTextAreaElement).value).toBe(
      'fully on-site\nBelow GBP 70k\nRelocation outside the UK',
    );
    expect((screen.getByTestId('profile-language-name-2') as HTMLInputElement).value).toBe(
      'German',
    );
    expect(screen.getByTestId('profile-star-1')).toBeTruthy();
    expect(screen.getByTestId('profile-import-done').textContent).toMatch(/Added/);
  });

  it('Cancel closes the review and saves nothing', async () => {
    const { port, files } = await renderProfile();
    files.nextWorkspace(FILLED);
    const review = await importFrom();

    fireEvent.click(within(review).getByTestId('profile-import-cancel'));

    expect(screen.queryByTestId('profile-import-review')).toBeNull();
    expect(port.calls.save).toBe(0);
    expect(port.saved()).toBeNull();
  });

  it('the pristine template says there is nothing to import, and apply is disabled', async () => {
    const { port, files } = await renderProfile();
    files.nextWorkspace(PRISTINE);
    const review = await importFrom();

    expect(within(review).getByTestId('profile-import-nothing').textContent).toMatch(
      /nothing to import/i,
    );
    expect((within(review).getByTestId('profile-import-apply') as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(within(review).getByTestId('profile-import-apply'));
    expect(port.calls.save).toBe(0);
  });
});

describe('refusals', () => {
  it('a folder Rust refused shows its sentence on the panel line, and nothing is saved', async () => {
    const { port, files } = await renderProfile();
    files.failWorkspace('That folder does not look like an ai-job-search workspace.');
    fireEvent.click(screen.getByTestId('profile-import-ajs'));

    const problem = await screen.findByTestId('profile-import-problem');
    expect(problem.textContent).toBe('That folder does not look like an ai-job-search workspace.');
    expect(screen.queryByTestId('profile-import-review')).toBeNull();
    expect(port.calls.save).toBe(0);
  });

  it('a later successful read clears the problem line', async () => {
    const { files } = await renderProfile();
    files.failWorkspace(
      'One of the profile files in that folder is not text, so it cannot be read.',
    );
    fireEvent.click(screen.getByTestId('profile-import-ajs'));
    await screen.findByTestId('profile-import-problem');

    files.nextWorkspace(FILLED);
    await importFrom();
    expect(screen.queryByTestId('profile-import-problem')).toBeNull();
  });

  it('a failed save after apply is reported on the view, not swallowed', async () => {
    const { port, files } = await renderProfile();
    files.nextWorkspace(FILLED);
    const review = await importFrom();
    port.failNext('save');

    fireEvent.click(within(review).getByTestId('profile-import-apply'));

    const alert = await screen.findByTestId('profile-error');
    expect(alert.textContent).toMatch(/could not be saved/);
  });
});
