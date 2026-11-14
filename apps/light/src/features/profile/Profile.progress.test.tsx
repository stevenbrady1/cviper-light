// @vitest-environment jsdom
/**
 * The checklist at the top of Profile (L-413): which of the six parts are
 * filled in, what to do next, and the one button that takes the user there.
 *
 * Driven through the real Profile with the fakes its other tests use, so the
 * count is whatever the two real loads and the real edits make it. The rules
 * themselves are `progress.test.ts`.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { emptyProfile, ok, type Cv, type Profile as CandidateProfile } from '@cviper/core-types';

import { type GapsPort } from './gapsPort';
import { PART_TITLE, PROFILE_PART_IDS, type ProfilePartId } from './progress';
import { FILLED } from './test/aiJobSearchFixtures';

const parsing = vi.hoisted(() => ({ extractText: vi.fn() }));
vi.mock('@cviper/cv-parsing', () => ({ extractText: parsing.extractText }));

const { Profile } = await import('./Profile');
const { createFakeProfilePort } = await import('./test/fakePort');
const { createFakeAnalysisPort } = await import('../analysis/test/fakePort');
const { createFakeFilePort } = await import('../../platform/test/fakeFilePort');

type FakeCvPort = ReturnType<typeof createFakeAnalysisPort>;

const NOW = new Date('2026-11-14T09:00:00.000Z');
const GAPS: GapsPort = { load: async () => ok({ cvText: null, jobs: [] }) };
const EMPTY = emptyProfile('2026-11-01T08:00:00.000Z');
const STAR = { title: '', situation: '', task: '', action: '', result: '' };

const CV: Cv = {
  id: 'cv-1',
  name: 'Alex Morgan CV.docx',
  file_path: null,
  extracted_text: 'Reporting analyst in social housing.',
  json_resume: null,
  created_at: '2026-11-03T09:00:00.000Z',
};

/** Every part of the form filled in; "Your CV" is the CV list's to fill. */
const FULL: CandidateProfile = {
  ...EMPTY,
  headline: 'Reporting analyst in social housing',
  languages: [{ name: 'English', level: 'Native' }],
  deal_breakers: ['Fully office-based'],
  energising: ['Hard problems'],
  star_examples: [{ ...STAR, title: 'Board pack in one day, not three' }],
};

beforeEach(() => parsing.extractText.mockReset());
afterEach(() => cleanup());

async function renderProfile(
  options: {
    profile?: CandidateProfile | null;
    cvs?: readonly Cv[];
    cvPort?: FakeCvPort;
  } = {},
) {
  const port = createFakeProfilePort(options.profile ?? null);
  const cvPort = options.cvPort ?? createFakeAnalysisPort({ cvs: options.cvs ?? [] });
  const files = createFakeFilePort();
  const user = userEvent.setup();
  render(<Profile port={port} now={NOW} gapsPort={GAPS} filePort={files} cvPort={cvPort} />);
  await screen.findByTestId('profile-headline');
  return { port, cvPort, files, user };
}

/** The count line, once both loads have answered. */
async function count(): Promise<string> {
  return (await screen.findByTestId('profile-progress-count')).textContent ?? '';
}

function pill(id: ProfilePartId): HTMLElement {
  return screen.getByTestId(`profile-progress-part-${id}`);
}

function fillIn(): HTMLButtonElement {
  return screen.getByTestId('profile-progress-fill') as HTMLButtonElement;
}

function typeAndBlur(testid: string, value: string): void {
  const element = screen.getByTestId(testid);
  fireEvent.change(element, { target: { value } });
  fireEvent.blur(element);
}

describe('what the checklist says', () => {
  it('happy: five filled in and one not says 5 of 6, and Next names the one', async () => {
    await renderProfile({ profile: { ...FULL, energising: [] }, cvs: [CV] });

    expect(await count()).toBe('5 of 6 parts filled in');
    expect(screen.getByTestId('profile-progress-next').textContent).toBe(
      'Next: What energises you, what drains you',
    );
    expect(fillIn().textContent).toBe('Fill it in');
    expect(fillIn().disabled).toBe(false);
  });

  it('boundary: nothing filled in says 0 of 6, and Next is the first part on the page', async () => {
    await renderProfile();

    expect(await count()).toBe('0 of 6 parts filled in');
    expect(screen.getByTestId('profile-progress-next').textContent).toBe('Next: Your CV');
  });

  it('boundary: all filled in says so, names no Next, and the button is there but disabled', async () => {
    await renderProfile({ profile: FULL, cvs: [CV] });

    expect(await count()).toBe('All 6 parts filled in.');
    expect(screen.queryByTestId('profile-progress-next')).toBeNull();
    expect(fillIn().disabled).toBe(true);
  });

  it('Next is the first part not filled in, in page order, not the last one touched', async () => {
    await renderProfile({ profile: { ...FULL, languages: [], star_examples: [] }, cvs: [CV] });

    expect(await count()).toBe('4 of 6 parts filled in');
    expect(screen.getByTestId('profile-progress-next').textContent).toBe('Next: Languages');
  });

  it('lists the six parts in a real list, in page order, under the page’s own section titles', async () => {
    await renderProfile({ profile: FULL, cvs: [CV] });
    await count();

    const list = within(screen.getByTestId('profile-progress')).getByRole('list');
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(6);
    PROFILE_PART_IDS.forEach((id, index) => {
      // The words the section itself is headed with, read off the page.
      const heading = within(screen.getByTestId(`profile-${id}`)).getByRole('heading', {
        level: 2,
      });
      expect(heading.textContent).toBe(PART_TITLE[id]);
      expect(items[index]!.textContent).toContain(PART_TITLE[id]);
    });
  });

  it('filled in and not are told apart by a drawn mark and by words, not by colour alone', async () => {
    await renderProfile({ profile: { ...FULL, energising: [] }, cvs: [CV] });
    await count();

    expect(pill('about').querySelector('[data-mark]')?.getAttribute('data-mark')).toBe('tick');
    expect(pill('energy').querySelector('[data-mark]')?.getAttribute('data-mark')).toBe('ring');
    // A screen reader cannot see the mark: the same words are in the text.
    expect(pill('about').textContent).toBe('About you Done.');
    expect(pill('energy').textContent).toBe('What energises you, what drains you Not done yet.');
  });

  it('says nothing but the approved words: no percentage, no praise', async () => {
    await renderProfile({ profile: { ...FULL, energising: [] }, cvs: [CV] });
    await count();

    const said = screen.getByTestId('profile-progress').textContent ?? '';
    for (const word of ['%', 'almost', 'well done', 'great', 'complete', 'nearly']) {
      expect(said.toLowerCase()).not.toContain(word);
    }
  });
});

describe('"Fill it in" takes the user to the next part', () => {
  const NO_ROWS = { ...FULL, languages: [], star_examples: [] };
  const CASES: ReadonlyArray<{
    readonly part: ProfilePartId;
    readonly lands: string;
    readonly profile: CandidateProfile;
    readonly cvs: readonly Cv[];
  }> = [
    { part: 'cv', lands: 'profile-upload', profile: FULL, cvs: [] },
    { part: 'about', lands: 'profile-headline', profile: { ...FULL, headline: null }, cvs: [CV] },
    { part: 'languages', lands: 'profile-language-add', profile: NO_ROWS, cvs: [CV] },
    {
      part: 'languages',
      lands: 'profile-language-name-0',
      profile: { ...FULL, languages: [{ name: '', level: 'Fluent' }] },
      cvs: [CV],
    },
    {
      part: 'wants',
      lands: 'profile-deal-breakers',
      profile: { ...FULL, deal_breakers: [] },
      cvs: [CV],
    },
    {
      part: 'energy',
      lands: 'profile-energising',
      profile: { ...FULL, energising: [] },
      cvs: [CV],
    },
    { part: 'star', lands: 'profile-star-add', profile: { ...FULL, star_examples: [] }, cvs: [CV] },
    {
      part: 'star',
      lands: 'profile-star-title-0',
      profile: { ...FULL, star_examples: [STAR] },
      cvs: [CV],
    },
  ];

  it.each(CASES)('next is $part: focus lands on $lands', async ({ part, lands, profile, cvs }) => {
    const { user } = await renderProfile({ profile, cvs });
    await count();
    expect(screen.getByTestId('profile-progress-next').textContent).toBe(
      `Next: ${PART_TITLE[part]}`,
    );

    await user.click(fillIn());

    expect(document.activeElement?.getAttribute('data-testid')).toBe(lands);
    // Inside the part it named, not merely somewhere on the page.
    expect(screen.getByTestId(`profile-${part}`).contains(document.activeElement)).toBe(true);
  });

  it('works from the keyboard: Enter on the button moves focus the same way', async () => {
    const { user } = await renderProfile({ profile: { ...FULL, headline: null }, cvs: [CV] });
    await count();

    fillIn().focus();
    await user.keyboard('{Enter}');

    expect(document.activeElement?.getAttribute('data-testid')).toBe('profile-headline');
  });
});

describe('the count is true as the user works, with no reload', () => {
  it('typing a headline ticks "About you", and clearing it unticks it', async () => {
    await renderProfile();
    expect(await count()).toBe('0 of 6 parts filled in');

    typeAndBlur('profile-headline', 'Reporting analyst');
    expect(await count()).toBe('1 of 6 parts filled in');
    expect(pill('about').querySelector('[data-mark="tick"]')).not.toBeNull();

    typeAndBlur('profile-headline', '   ');
    expect(await count()).toBe('0 of 6 parts filled in');
    expect(pill('about').querySelector('[data-mark="ring"]')).not.toBeNull();
  });

  it('adding a language row does not tick "Languages" until it has a name', async () => {
    const { user } = await renderProfile();
    await count();

    await user.click(screen.getByTestId('profile-language-add'));
    expect(await count()).toBe('0 of 6 parts filled in');

    typeAndBlur('profile-language-name-0', 'Welsh');
    expect(await count()).toBe('1 of 6 parts filled in');

    await user.click(screen.getByTestId('profile-language-remove-0'));
    expect(await count()).toBe('0 of 6 parts filled in');
  });

  it('one line in a STAR example ticks "STAR examples"', async () => {
    const { user } = await renderProfile();
    await count();

    await user.click(screen.getByTestId('profile-star-add'));
    expect(pill('star').querySelector('[data-mark="ring"]')).not.toBeNull();

    typeAndBlur('profile-star-result-0', 'Passed the audit.');
    await vi.waitFor(() => expect(pill('star').querySelector('[data-mark="tick"]')).not.toBeNull());
  });

  it('uploading a CV on this page ticks "Your CV"', async () => {
    const { user, files } = await renderProfile();
    expect(await count()).toBe('0 of 6 parts filled in');

    files.nextCv({ name: 'New CV.docx', path: 'C:\\New CV.docx', bytes: new Uint8Array([1]) });
    parsing.extractText.mockResolvedValue(ok({ text: 'A CV.', pageCount: null, warnings: [] }));
    await user.click(screen.getByTestId('profile-upload'));

    await vi.waitFor(() =>
      expect(screen.getByTestId('profile-progress-count').textContent).toBe(
        '1 of 6 parts filled in',
      ),
    );
    expect(screen.getByTestId('profile-progress-next').textContent).toBe('Next: About you');
  });

  it('renaming a CV changes nothing; deleting the last one unticks "Your CV"', async () => {
    const { user } = await renderProfile({ cvs: [CV] });
    expect(await count()).toBe('1 of 6 parts filled in');

    await user.click(screen.getByTestId('profile-cv-rename-cv-1'));
    fireEvent.change(screen.getByTestId('profile-cv-name-input-cv-1'), {
      target: { value: 'Housing CV' },
    });
    await user.click(screen.getByTestId('profile-cv-name-save-cv-1'));
    await vi.waitFor(() =>
      expect(screen.getByTestId('profile-cv-current').textContent).toContain('Housing CV'),
    );
    expect(await count()).toBe('1 of 6 parts filled in');

    await user.click(screen.getByTestId('profile-cv-delete-cv-1'));
    await user.click(await screen.findByTestId('profile-cv-delete-confirm'));
    await vi.waitFor(() =>
      expect(screen.getByTestId('profile-progress-count').textContent).toBe(
        '0 of 6 parts filled in',
      ),
    );
  });
});

describe('never a count it does not know', () => {
  it('while the CV list is still being read there is no count and no button to press', async () => {
    const real = createFakeAnalysisPort({ cvs: [CV] });
    let answer: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      answer = resolve;
    });
    const cvPort: FakeCvPort = {
      ...real,
      loadCvs: async () => {
        await held;
        return real.loadCvs();
      },
    };
    await renderProfile({ profile: FULL, cvPort });

    // The form is open; the card holds its place and claims nothing.
    const card = screen.getByTestId('profile-progress');
    expect(card.getAttribute('data-waiting')).toBe('true');
    expect(screen.queryByTestId('profile-progress-count')).toBeNull();
    expect(screen.queryByTestId('profile-progress-next')).toBeNull();
    expect(card.textContent).not.toMatch(/\d of 6|All 6/);
    expect(fillIn().disabled).toBe(true);
    // Not in the picture a screen reader gets either.
    expect(fillIn().closest('[aria-hidden="true"]')).not.toBeNull();

    await act(async () => {
      answer?.();
      await held;
    });
    expect(await count()).toBe('All 6 parts filled in.');
    expect(screen.getByTestId('profile-progress').getAttribute('data-waiting')).toBeNull();
  });

  it('negative: a CV list that cannot be read shows no checklist; its own error and the form are there', async () => {
    const cvPort = createFakeAnalysisPort({ cvs: [CV] });
    cvPort.failNext('loadCvs');
    await renderProfile({ profile: FULL, cvPort });

    expect((await screen.findByTestId('profile-cv-error')).textContent).toContain(
      'Your CVs could not be read',
    );
    expect(screen.queryByTestId('profile-progress')).toBeNull();
    expect(document.body.textContent).not.toMatch(/\d of 6 parts|All 6 parts/);
    expect((screen.getByTestId('profile-headline') as HTMLInputElement).value).toBe(
      'Reporting analyst in social housing',
    );
  });

  it('negative: a profile that cannot be read shows no checklist; its own error is there', async () => {
    const port = createFakeProfilePort(FULL);
    port.failNext('load');
    render(
      <Profile
        port={port}
        now={NOW}
        gapsPort={GAPS}
        filePort={createFakeFilePort()}
        cvPort={createFakeAnalysisPort({ cvs: [CV] })}
      />,
    );

    expect((await screen.findByTestId('profile-error')).textContent).toContain(
      'Your data is still on this machine.',
    );
    await screen.findByTestId('profile-cv-list');
    expect(screen.queryByTestId('profile-progress')).toBeNull();
    expect(document.body.textContent).not.toMatch(/\d of 6 parts|All 6 parts/);
  });

  it('a later failure to rename or delete a CV does not take the checklist away', async () => {
    const { user, cvPort } = await renderProfile({ cvs: [CV] });
    expect(await count()).toBe('1 of 6 parts filled in');

    cvPort.failNext('loadHistory');
    await user.click(screen.getByTestId('profile-cv-delete-cv-1'));
    await screen.findByTestId('profile-cv-error');

    // The list was read; what could not be read was the count of checks.
    expect(await count()).toBe('1 of 6 parts filled in');
  });
});

describe('one blue button on the screen', () => {
  it('"Fill it in" is the only primary button, and no pill is one', async () => {
    await renderProfile({ profile: { ...FULL, energising: [] }, cvs: [CV] });
    await count();

    const primaries = document.querySelectorAll('[data-primary="true"]');
    expect(primaries).toHaveLength(1);
    expect(primaries[0]).toBe(fillIn());
  });

  it('while an import is waiting for its own blue "Add to my profile", "Fill it in" is disabled, not hidden', async () => {
    const { files } = await renderProfile({ cvs: [CV] });
    await count();
    expect(fillIn().disabled).toBe(false);

    files.nextWorkspace(FILLED);
    fireEvent.click(screen.getByTestId('profile-import-ajs'));
    await screen.findByTestId('profile-import-review');
    await vi.waitFor(() => expect(fillIn().disabled).toBe(true));
    // Still on the page: a control that comes and goes cannot be learned.
    expect(fillIn().closest('[aria-hidden="true"]')).toBeNull();

    fireEvent.click(screen.getByTestId('profile-import-cancel'));
    await vi.waitFor(() => expect(fillIn().disabled).toBe(false));
  });

  it('an import that fills parts in is counted as soon as it is added', async () => {
    const { files } = await renderProfile({ cvs: [CV] });
    expect(await count()).toBe('1 of 6 parts filled in');

    files.nextWorkspace(FILLED);
    fireEvent.click(screen.getByTestId('profile-import-ajs'));
    fireEvent.click(
      within(await screen.findByTestId('profile-import-review')).getByTestId(
        'profile-import-apply',
      ),
    );

    await vi.waitFor(() =>
      expect(screen.getByTestId('profile-progress-count').textContent).not.toBe(
        '1 of 6 parts filled in',
      ),
    );
    expect(pill('about').querySelector('[data-mark="tick"]')).not.toBeNull();
    expect(fillIn().closest('[aria-hidden="true"]')).toBeNull();
  });
});
