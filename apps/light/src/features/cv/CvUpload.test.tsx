// @vitest-environment jsdom
/**
 * The upload button Tailor and Profile share (L-240), driven by a click.
 *
 * The parser is mocked here for the same reason `Analysis.test.tsx` mocks it:
 * pdf.js needs a worker. What is tested is that the button hands the bytes to
 * the parser, stores what comes back, tells the screen, and shows every
 * failure in words — and that a cancel says nothing at all.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { err, ok, type Cv } from '@cviper/core-types';

const parsing = vi.hoisted(() => ({ extractText: vi.fn() }));
vi.mock('@cviper/cv-parsing', () => ({ extractText: parsing.extractText }));

const { CvUpload } = await import('./CvUpload');
const { createFakeAnalysisPort } = await import('../analysis/test/fakePort');
const { createFakeFilePort } = await import('../../platform/test/fakeFilePort');

const NOW = new Date('2026-10-14T09:00:00.000Z');
const CV_TEXT =
  'Credit risk analyst, eight years in London banking. SQL, Python, Basel III, stress testing.';

function setup() {
  const port = createFakeAnalysisPort();
  const files = createFakeFilePort();
  const onUploaded = vi.fn<(cv: Cv) => void>();
  render(
    <CvUpload
      idPrefix="profile"
      files={files}
      saveCv={(cv) => port.saveCv(cv)}
      now={NOW}
      onUploaded={onUploaded}
    />,
  );
  return { port, files, onUploaded, user: userEvent.setup() };
}

beforeEach(() => {
  parsing.extractText.mockReset();
});
afterEach(() => cleanup());

describe('CvUpload', () => {
  it('is a button with an accessible name', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Upload a CV' })).toBeTruthy();
  });

  it('reads the file, stores it, and tells the screen which CV it is', async () => {
    const { port, files, onUploaded, user } = setup();
    const bytes = new Uint8Array([37, 80, 68, 70]);
    files.nextCv({ name: 'New CV.docx', path: 'C:\\New CV.docx', bytes });
    parsing.extractText.mockResolvedValue(ok({ text: CV_TEXT, pageCount: null, warnings: [] }));

    await user.click(screen.getByTestId('profile-upload'));

    await vi.waitFor(() => expect(onUploaded).toHaveBeenCalledTimes(1));
    expect(parsing.extractText).toHaveBeenCalledWith('New CV.docx', bytes);
    expect(port.storedCvs()).toHaveLength(1);
    expect(onUploaded.mock.calls[0]?.[0]).toEqual(port.storedCvs()[0]);
    expect(screen.queryAllByRole('alert')).toEqual([]);
  });

  it('shows the warnings when only some pages could be read', async () => {
    const { files, user } = setup();
    files.nextCv({ name: 'Half.pdf', path: 'C:\\Half.pdf', bytes: new Uint8Array([1]) });
    parsing.extractText.mockResolvedValue(
      ok({ text: CV_TEXT, pageCount: 3, warnings: ['1 of the 3 pages have no readable text.'] }),
    );

    await user.click(screen.getByTestId('profile-upload'));

    expect((await screen.findByTestId('profile-cv-warnings')).textContent).toContain(
      'no readable text',
    );
  });

  it('boundary: an empty file shows the parser’s own words and stores nothing', async () => {
    const { port, files, onUploaded, user } = setup();
    files.nextCv({ name: 'CV.docx', path: 'C:\\CV.docx', bytes: new Uint8Array(0) });
    parsing.extractText.mockResolvedValue(
      err({
        code: 'EMPTY_FILE',
        message: 'That file is empty. Pick the CV again.',
        detail: null,
      }),
    );

    await user.click(screen.getByTestId('profile-upload'));

    const problem = await screen.findByTestId('profile-upload-problem');
    expect(problem.getAttribute('role')).toBe('alert');
    expect(problem.textContent).toBe('That file is empty. Pick the CV again.');
    expect(port.storedCvs()).toEqual([]);
    expect(onUploaded).not.toHaveBeenCalled();
  });

  it('negative: a file the app cannot read is reported, not stored', async () => {
    const { port, files, onUploaded, user } = setup();
    files.failCv('CViper cannot read that kind of file. Pick a PDF or a Word (.docx) CV.');

    await user.click(screen.getByTestId('profile-upload'));

    expect((await screen.findByTestId('profile-upload-problem')).textContent).toContain(
      'cannot read that kind of file',
    );
    expect(parsing.extractText).not.toHaveBeenCalled();
    expect(port.storedCvs()).toEqual([]);
    expect(onUploaded).not.toHaveBeenCalled();
  });

  it('negative: a CV that read but could not be saved says so', async () => {
    const { port, files, onUploaded, user } = setup();
    port.failNext('saveCv');
    files.nextCv({ name: 'CV.docx', path: 'C:\\CV.docx', bytes: new Uint8Array([1]) });
    parsing.extractText.mockResolvedValue(ok({ text: CV_TEXT, pageCount: null, warnings: [] }));

    await user.click(screen.getByTestId('profile-upload'));

    expect((await screen.findByTestId('profile-upload-problem')).textContent).toContain(
      'could not be saved',
    );
    expect(onUploaded).not.toHaveBeenCalled();
  });

  it('says nothing at all when the dialog is cancelled', async () => {
    const { port, files, onUploaded, user } = setup();
    files.nextCv(null);

    await user.click(screen.getByTestId('profile-upload'));

    await vi.waitFor(() => expect(files.calls.pickCv).toBe(1));
    expect(parsing.extractText).not.toHaveBeenCalled();
    expect(port.storedCvs()).toEqual([]);
    expect(onUploaded).not.toHaveBeenCalled();
    expect(screen.queryAllByRole('alert')).toEqual([]);
  });

  it('a second, successful upload clears the last problem', async () => {
    const { files, onUploaded, user } = setup();
    files.failCv('CViper cannot read that kind of file.');
    await user.click(screen.getByTestId('profile-upload'));
    await screen.findByTestId('profile-upload-problem');

    files.nextCv({ name: 'CV.docx', path: 'C:\\CV.docx', bytes: new Uint8Array([1]) });
    parsing.extractText.mockResolvedValue(ok({ text: CV_TEXT, pageCount: null, warnings: [] }));
    await user.click(screen.getByTestId('profile-upload'));

    await vi.waitFor(() => expect(onUploaded).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('profile-upload-problem')).toBeNull();
  });
});
