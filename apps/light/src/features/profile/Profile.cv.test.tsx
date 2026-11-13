// @vitest-environment jsdom
/**
 * "Your CV" on the Profile screen (L-240): which CV the app has, and the same
 * upload Analysis and Tailor use, into the same store.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { err, ok, type Cv } from '@cviper/core-types';

import { type GapsPort } from './gapsPort';

const parsing = vi.hoisted(() => ({ extractText: vi.fn() }));
vi.mock('@cviper/cv-parsing', () => ({ extractText: parsing.extractText }));

const { Profile } = await import('./Profile');
const { createFakeProfilePort } = await import('./test/fakePort');
const { createFakeAnalysisPort } = await import('../analysis/test/fakePort');
const { createFakeFilePort } = await import('../../platform/test/fakeFilePort');

type FakeCvPort = ReturnType<typeof createFakeAnalysisPort>;
type FakeFilePort = ReturnType<typeof createFakeFilePort>;

const NOW = new Date('2026-10-14T09:00:00.000Z');
const CV_TEXT =
  'Credit risk analyst, eight years in London banking. SQL, Python, Basel III, IFRS 9.';

const SAVED_CV: Cv = {
  id: 'cv-1',
  name: 'Jordan Lewis CV.pdf',
  file_path: null,
  extracted_text: CV_TEXT,
  json_resume: null,
  created_at: '2026-08-01T09:00:00.000Z',
};

/** Keeps the skills-gap panel off the database, as `Profile.test.tsx` does. */
const GAPS: GapsPort = { load: async () => ok({ cvText: null, jobs: [] }) };

beforeEach(() => {
  parsing.extractText.mockReset();
});
afterEach(() => cleanup());

async function renderView(
  options: { cvPort?: FakeCvPort; files?: FakeFilePort } = {},
): Promise<{ cvPort: FakeCvPort; files: FakeFilePort }> {
  const cvPort = options.cvPort ?? createFakeAnalysisPort();
  const files = options.files ?? createFakeFilePort();
  render(
    <Profile
      port={createFakeProfilePort(null)}
      now={NOW}
      gapsPort={GAPS}
      filePort={files}
      cvPort={cvPort}
    />,
  );
  await screen.findByTestId('profile-cv');
  return { cvPort, files };
}

describe('Your CV, on Profile', () => {
  it('negative: the card does not claim the CV never leaves the computer (L-233 class)', async () => {
    // The FILE is read here, but a CV checked with a cloud AI is sent to that
    // provider. "Never uploaded anywhere" reads as "my CV never leaves", which
    // is the over-claim L-233 exists to remove. A forbid-list on the shape,
    // not a required wording.
    await renderView({ cvPort: createFakeAnalysisPort({ cvs: [SAVED_CV] }) });

    const copy = (screen.getByTestId('profile-cv').textContent ?? '').toLowerCase();
    for (const claim of ['never uploaded', 'never leaves', 'nowhere']) {
      expect(copy).not.toContain(claim);
    }
  });

  it('names the CV the app already has', async () => {
    await renderView({ cvPort: createFakeAnalysisPort({ cvs: [SAVED_CV] }) });

    const current = await screen.findByTestId('profile-cv-current');
    expect(current.textContent).toContain('Jordan Lewis CV.pdf');
  });

  it('says plainly when there is no CV yet', async () => {
    await renderView();

    expect((await screen.findByTestId('profile-cv-current')).textContent).toContain(
      'No CV uploaded yet',
    );
  });

  it('uploads into the shared store and shows the new CV as the current one', async () => {
    const user = userEvent.setup();
    const { cvPort, files } = await renderView({
      cvPort: createFakeAnalysisPort({ cvs: [SAVED_CV] }),
    });
    await vi.waitFor(() =>
      expect(screen.getByTestId('profile-cv-current').textContent).toContain('Jordan Lewis'),
    );

    files.nextCv({ name: 'New CV.docx', path: 'C:\\New CV.docx', bytes: new Uint8Array([1]) });
    parsing.extractText.mockResolvedValue(ok({ text: CV_TEXT, pageCount: null, warnings: [] }));
    const section = screen.getByTestId('profile-cv');
    await user.click(within(section).getByRole('button', { name: 'Upload a CV' }));

    await vi.waitFor(() =>
      expect(screen.getByTestId('profile-cv-current').textContent).toContain('New CV.docx'),
    );
    expect(cvPort.storedCvs().map((cv) => cv.name)).toEqual(['New CV.docx', 'Jordan Lewis CV.pdf']);
  });

  it('boundary: an empty file is refused in the parser’s words and the current CV is unchanged', async () => {
    const user = userEvent.setup();
    const { cvPort, files } = await renderView({
      cvPort: createFakeAnalysisPort({ cvs: [SAVED_CV] }),
    });
    await vi.waitFor(() =>
      expect(screen.getByTestId('profile-cv-current').textContent).toContain('Jordan Lewis'),
    );

    files.nextCv({ name: 'CV.docx', path: 'C:\\CV.docx', bytes: new Uint8Array(0) });
    parsing.extractText.mockResolvedValue(
      err({ code: 'EMPTY_FILE', message: 'That file is empty.', detail: null }),
    );
    await user.click(screen.getByTestId('profile-upload'));

    expect((await screen.findByTestId('profile-upload-problem')).textContent).toBe(
      'That file is empty.',
    );
    expect(cvPort.storedCvs()).toEqual([SAVED_CV]);
    expect(screen.getByTestId('profile-cv-current').textContent).toContain('Jordan Lewis');
  });

  it('negative: a file the app cannot read is reported and nothing is stored', async () => {
    const user = userEvent.setup();
    const { cvPort, files } = await renderView();

    files.failCv('CViper cannot read that kind of file. Pick a PDF or a Word (.docx) CV.');
    await user.click(screen.getByTestId('profile-upload'));

    expect((await screen.findByTestId('profile-upload-problem')).textContent).toContain(
      'cannot read that kind of file',
    );
    expect(cvPort.storedCvs()).toEqual([]);
  });

  it('negative: a CV that would not save says so and is not shown as current', async () => {
    const user = userEvent.setup();
    const { cvPort, files } = await renderView();

    cvPort.failNext('saveCv');
    files.nextCv({ name: 'CV.docx', path: 'C:\\CV.docx', bytes: new Uint8Array([1]) });
    parsing.extractText.mockResolvedValue(ok({ text: CV_TEXT, pageCount: null, warnings: [] }));
    await user.click(screen.getByTestId('profile-upload'));

    expect((await screen.findByTestId('profile-upload-problem')).textContent).toContain(
      'could not be saved',
    );
    expect(screen.getByTestId('profile-cv-current').textContent).toContain('No CV uploaded yet');
  });

  it('a cancelled dialog changes nothing and says nothing', async () => {
    const user = userEvent.setup();
    const { cvPort, files } = await renderView();

    files.nextCv(null);
    await user.click(screen.getByTestId('profile-upload'));

    await vi.waitFor(() => expect(files.calls.pickCv).toBe(1));
    expect(cvPort.storedCvs()).toEqual([]);
    expect(screen.queryByTestId('profile-upload-problem')).toBeNull();
  });

  describe('which CV the other screens start on (L-320)', () => {
    /** CVs as the store lists them: newest first. */
    const cvsNamed = (...names: string[]): Cv[] =>
      names.map((name, index) => ({
        ...SAVED_CV,
        id: `cv-${index}`,
        name,
        created_at: `2026-08-${String(20 - index).padStart(2, '0')}T09:00:00.000Z`,
      }));

    async function currentLine(): Promise<string | null> {
      await vi.waitFor(() =>
        expect(screen.getByTestId('profile-cv-current').textContent).not.toBe('Reading your CVs…'),
      );
      return screen.getByTestId('profile-cv-current').textContent;
    }

    it("three CVs: 'Used by default: <newest>, the newest of your 3 CVs.'", async () => {
      await renderView({
        cvPort: createFakeAnalysisPort({ cvs: cvsNamed('Newest.pdf', 'Middle.pdf', 'Oldest.pdf') }),
      });

      expect(await currentLine()).toBe('Used by default: Newest.pdf, the newest of your 3 CVs.');
    });

    it("two CVs: 'the newest of your 2 CVs'", async () => {
      await renderView({ cvPort: createFakeAnalysisPort({ cvs: cvsNamed('B.pdf', 'A.pdf') }) });

      expect(await currentLine()).toBe('Used by default: B.pdf, the newest of your 2 CVs.');
    });

    it("boundary: one CV: 'Used by default: <name>.' with no count", async () => {
      await renderView({ cvPort: createFakeAnalysisPort({ cvs: [SAVED_CV] }) });

      expect(await currentLine()).toBe('Used by default: Jordan Lewis CV.pdf.');
    });

    it("negative: no CV: says 'No CV uploaded yet' and never 'Used by default'", async () => {
      await renderView();

      const line = await currentLine();
      expect(line).toContain('No CV uploaded yet');
      expect(screen.getByTestId('profile-cv').textContent).not.toContain('Used by default');
    });

    it('edge: an upload here becomes the default and the count goes up by one', async () => {
      const user = userEvent.setup();
      const { files } = await renderView({
        cvPort: createFakeAnalysisPort({ cvs: cvsNamed('B.pdf', 'A.pdf') }),
      });
      expect(await currentLine()).toBe('Used by default: B.pdf, the newest of your 2 CVs.');

      files.nextCv({ name: 'New CV.docx', path: 'C:\\New CV.docx', bytes: new Uint8Array([1]) });
      parsing.extractText.mockResolvedValue(ok({ text: CV_TEXT, pageCount: null, warnings: [] }));
      await user.click(screen.getByTestId('profile-upload'));

      await vi.waitFor(() =>
        expect(screen.getByTestId('profile-cv-current').textContent).toBe(
          'Used by default: New CV.docx, the newest of your 3 CVs.',
        ),
      );
    });
  });

  describe('each saved CV, with its words and the day it was added (L-403)', () => {
    const wordsOf = (count: number): string =>
      Array.from({ length: count }, () => 'word').join(' ');
    /** Built from LOCAL parts, so the calendar day is the same on any machine. */
    const localInstant = (...parts: [number, number, number, number?, number?, number?, number?]) =>
      new Date(...parts).toISOString();
    const ADDED_3_NOV = localInstant(2026, 10, 3, 12);

    const cv = (id: string, over: Partial<Cv>): Cv => ({
      ...SAVED_CV,
      id,
      name: `${id}.pdf`,
      extracted_text: wordsOf(540),
      created_at: ADDED_3_NOV,
      ...over,
    });

    /** Each row as `[name, facts]`; `facts` is null when the row draws no facts line. */
    async function rows(): Promise<[string | null, string | null][]> {
      const list = await screen.findByTestId('profile-cv-list');
      return within(list)
        .getAllByRole('listitem')
        .map((row) => [
          within(row).getByTestId('profile-cv-name').textContent,
          within(row).queryByTestId('profile-cv-facts')?.textContent ?? null,
        ]);
    }

    async function factsOf(saved: Cv): Promise<string | null> {
      await renderView({ cvPort: createFakeAnalysisPort({ cvs: [saved] }) });
      return (await rows())[0]?.[1] ?? null;
    }

    it('happy: one row per CV, newest first, each with its words and the day it was added', async () => {
      await renderView({
        cvPort: createFakeAnalysisPort({
          cvs: [
            cv('newest', {}),
            cv('older', { extracted_text: wordsOf(312), created_at: localInstant(2026, 7, 19, 9) }),
          ],
        }),
      });

      expect(await rows()).toEqual([
        ['newest.pdf', '540 words. Added 3 November 2026.'],
        ['older.pdf', '312 words. Added 19 August 2026.'],
      ]);
    });

    it.each([
      ['never read', null],
      ['empty', ''],
      ['only white space', ' \n\t '],
    ])(
      "negative: a CV whose text is %s shows the date alone, never '0 words'",
      async (_label, extracted_text) => {
        const facts = await factsOf(cv('scan', { extracted_text }));

        expect(facts).toBe('Added 3 November 2026.');
      },
    );

    it.each([
      [1, '1 word. Added 3 November 2026.'],
      [2, '2 words. Added 3 November 2026.'],
      [1000, '1,000 words. Added 3 November 2026.'],
      [200_000, '200,000 words. Added 3 November 2026.'],
    ])('boundary: %i word(s) reads "%s"', async (count, expected) => {
      expect(await factsOf(cv('sized', { extracted_text: wordsOf(count) }))).toBe(expected);
    });

    it.each([
      ['empty', ''],
      ['not a date at all', 'not a date'],
      ['an impossible day', '2026-13-45T00:00:00.000Z'],
      ['a year the app cannot print', '+275760-09-13T00:00:00.000Z'],
    ])(
      "negative: a damaged 'added' date (%s) shows the words and no date, never 'Invalid Date'",
      async (_label, created_at) => {
        const facts = await factsOf(cv('damaged', { created_at: created_at as Cv['created_at'] }));

        expect(facts).toBe('540 words.');
        expect(screen.getByTestId('profile-cv').textContent).not.toMatch(/Invalid|NaN|undefined/);
      },
    );

    it('negative: no readable text and a damaged date draws the name and no facts line', async () => {
      await renderView({
        cvPort: createFakeAnalysisPort({
          cvs: [cv('bare', { extracted_text: null, created_at: 'nope' as Cv['created_at'] })],
        }),
      });

      expect(await rows()).toEqual([['bare.pdf', null]]);
    });

    it.each([
      [
        'the last instant of 2 November',
        localInstant(2026, 10, 2, 23, 59, 59, 999),
        '2 November 2026',
      ],
      ['the first instant of 3 November', localInstant(2026, 10, 3, 0, 0, 0, 0), '3 November 2026'],
      [
        'the last instant of a month',
        localInstant(2026, 10, 30, 23, 59, 59, 999),
        '30 November 2026',
      ],
      [
        'the last instant of a year',
        localInstant(2026, 11, 31, 23, 59, 59, 999),
        '31 December 2026',
      ],
      ['the first instant of a year', localInstant(2027, 0, 1, 0, 0, 0, 0), '1 January 2027'],
      ['a leap day', localInstant(2028, 1, 29, 12), '29 February 2028'],
    ])('boundary: %s is that day on the user’s own calendar', async (_label, created_at, day) => {
      expect(await factsOf(cv('edge', { created_at }))).toBe(`540 words. Added ${day}.`);
    });

    describe('in a time zone thirteen hours ahead of UTC', () => {
      const before = process.env.TZ;
      beforeEach(() => {
        process.env.TZ = 'Pacific/Auckland';
      });
      afterEach(() => {
        if (before === undefined) delete process.env.TZ;
        else process.env.TZ = before;
      });

      it.each([
        ['half past eleven at night on the 2nd', '2026-11-02T10:30:00.000Z', '2 November 2026'],
        ['half past midnight on the 3rd', '2026-11-02T11:30:00.000Z', '3 November 2026'],
      ])('boundary: %s there is that local day, not UTC’s', async (_label, created_at, day) => {
        // Proof the zone took: without it both rows would pass or fail together.
        expect(new Date('2026-11-02T11:30:00.000Z').getDate()).toBe(3);

        expect(await factsOf(cv('abroad', { created_at }))).toBe(`540 words. Added ${day}.`);
      });
    });

    it('boundary: no CV draws no list at all', async () => {
      await renderView();
      await screen.findByText('No CV uploaded yet.');

      expect(screen.queryByTestId('profile-cv-list')).toBeNull();
    });

    it('edge: an upload on this page adds its row at the top', async () => {
      const user = userEvent.setup();
      const { files } = await renderView({
        cvPort: createFakeAnalysisPort({ cvs: [cv('older', {})] }),
      });
      expect(await rows()).toHaveLength(1);

      files.nextCv({ name: 'New CV.docx', path: 'C:\\New CV.docx', bytes: new Uint8Array([1]) });
      parsing.extractText.mockResolvedValue(ok({ text: CV_TEXT, pageCount: null, warnings: [] }));
      await user.click(screen.getByTestId('profile-upload'));

      await vi.waitFor(async () => expect(await rows()).toHaveLength(2));
      const [first, second] = await rows();
      expect(first?.[0]).toBe('New CV.docx');
      expect(first?.[1]).toMatch(/^14 words\. Added \d{1,2} October 2026\.$/);
      expect(second?.[0]).toBe('older.pdf');
    });
  });

  it('negative: a CV list that cannot be read says so, and the upload still works', async () => {
    const cvPort = createFakeAnalysisPort();
    cvPort.failNext('loadCvs');
    await renderView({ cvPort });

    expect((await screen.findByTestId('profile-cv-error')).getAttribute('role')).toBe('alert');
    expect(screen.getByTestId('profile-upload')).toHaveProperty('disabled', false);
  });
});
