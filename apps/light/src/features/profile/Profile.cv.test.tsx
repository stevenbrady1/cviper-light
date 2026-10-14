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
  name: 'Steven Brady CV.pdf',
  file_path: null,
  extracted_text: CV_TEXT,
  json_resume: null,
  created_at: '2026-08-01T09:00:00.000Z',
};

/** Keeps the skills-gap panel off the database, as `Profile.test.tsx` does. */
const GAPS: GapsPort = { load: async () => ok({ cvText: null, jobs: [] }) };

beforeEach(() => parsing.extractText.mockReset());
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
  it('names the CV the app already has', async () => {
    await renderView({ cvPort: createFakeAnalysisPort({ cvs: [SAVED_CV] }) });

    const current = await screen.findByTestId('profile-cv-current');
    expect(current.textContent).toContain('Steven Brady CV.pdf');
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
      expect(screen.getByTestId('profile-cv-current').textContent).toContain('Steven Brady'),
    );

    files.nextCv({ name: 'New CV.docx', path: 'C:\\New CV.docx', bytes: new Uint8Array([1]) });
    parsing.extractText.mockResolvedValue(ok({ text: CV_TEXT, pageCount: null, warnings: [] }));
    const section = screen.getByTestId('profile-cv');
    await user.click(within(section).getByRole('button', { name: 'Upload a CV' }));

    await vi.waitFor(() =>
      expect(screen.getByTestId('profile-cv-current').textContent).toContain('New CV.docx'),
    );
    expect(cvPort.storedCvs().map((cv) => cv.name)).toEqual(['New CV.docx', 'Steven Brady CV.pdf']);
  });

  it('boundary: an empty file is refused in the parser’s words and the current CV is unchanged', async () => {
    const user = userEvent.setup();
    const { cvPort, files } = await renderView({
      cvPort: createFakeAnalysisPort({ cvs: [SAVED_CV] }),
    });
    await vi.waitFor(() =>
      expect(screen.getByTestId('profile-cv-current').textContent).toContain('Steven Brady'),
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
    expect(screen.getByTestId('profile-cv-current').textContent).toContain('Steven Brady');
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

  it('negative: a CV list that cannot be read says so, and the upload still works', async () => {
    const cvPort = createFakeAnalysisPort();
    cvPort.failNext('loadCvs');
    await renderView({ cvPort });

    expect((await screen.findByTestId('profile-cv-error')).getAttribute('role')).toBe('alert');
    expect(screen.getByTestId('profile-upload')).toHaveProperty('disabled', false);
  });
});
