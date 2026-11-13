// @vitest-environment jsdom
/**
 * Rename and Delete for a saved CV, on Profile (L-408).
 *
 * Delete removes user data, so the tests assert what is STORED afterwards, not
 * only what the screen says: the fake port's own list of CVs and of saved
 * checks, and how many times each write was asked for.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ok, type Analysis, type Cv } from '@cviper/core-types';

import { type GapsPort } from './gapsPort';

vi.mock('@cviper/cv-parsing', () => ({ extractText: vi.fn() }));

const { Profile } = await import('./Profile');
const { createFakeProfilePort } = await import('./test/fakePort');
const { createFakeAnalysisPort } = await import('../analysis/test/fakePort');
const { createFakeFilePort } = await import('../../platform/test/fakeFilePort');

type FakeCvPort = ReturnType<typeof createFakeAnalysisPort>;

const NOW = new Date('2026-10-14T09:00:00.000Z');

const NEWER: Cv = {
  id: 'cv-2',
  name: 'Jordan Lewis CV.pdf',
  file_path: null,
  extracted_text: 'Credit risk analyst. SQL, Python, IFRS 9.',
  json_resume: null,
  created_at: '2026-09-01T09:00:00.000Z',
};
const OLDER: Cv = {
  ...NEWER,
  id: 'cv-1',
  name: 'Old CV.docx',
  created_at: '2026-08-01T09:00:00.000Z',
};

function check(id: string, cvId: string): Analysis {
  return {
    id,
    cv_id: cvId,
    job_id: null,
    provider: 'keyword',
    model: 'none',
    match_score: 61,
    result_json: {} as Analysis['result_json'],
    created_at: '2026-09-02T09:00:00.000Z',
  };
}

/** Keeps the skills-gap panel off the database, as `Profile.test.tsx` does. */
const GAPS: GapsPort = { load: async () => ok({ cvText: null, jobs: [] }) };

const DB_REFUSAL = 'The database is locked by another copy of CViper.';

afterEach(() => cleanup());

async function renderView(cvPort: FakeCvPort) {
  const user = userEvent.setup();
  render(
    <Profile
      port={createFakeProfilePort(null)}
      now={NOW}
      gapsPort={GAPS}
      filePort={createFakeFilePort()}
      cvPort={cvPort}
    />,
  );
  await screen.findByTestId('profile-cv-list');
  return { user, cvPort };
}

function names(): (string | null)[] {
  return within(screen.getByTestId('profile-cv-list'))
    .getAllByTestId('profile-cv-name')
    .map((name) => name.textContent);
}

function nameBox(id: string): HTMLInputElement {
  return screen.getByTestId(`profile-cv-name-input-${id}`) as HTMLInputElement;
}

async function openRename(user: ReturnType<typeof userEvent.setup>, id: string) {
  await user.click(screen.getByTestId(`profile-cv-rename-${id}`));
  return nameBox(id);
}

describe('each saved CV has Rename and Delete', () => {
  it('draws both on every row, neither one blue, each named for its CV', async () => {
    await renderView(createFakeAnalysisPort({ cvs: [NEWER, OLDER] }));

    for (const cv of [NEWER, OLDER]) {
      const rename = screen.getByTestId(`profile-cv-rename-${cv.id}`);
      const remove = screen.getByTestId(`profile-cv-delete-${cv.id}`);
      expect(rename.textContent).toBe('Rename');
      expect(remove.textContent).toBe('Delete');
      // Two rows have a "Delete" each: a screen reader hears which CV.
      expect(rename.getAttribute('aria-label')).toBe(`Rename ${cv.name}`);
      expect(remove.getAttribute('aria-label')).toBe(`Delete ${cv.name}`);
      for (const button of [rename, remove]) {
        expect(button.hasAttribute('data-primary')).toBe(false);
        expect(button.className).not.toContain('bg-blue');
      }
    }
  });
});

describe('Rename', () => {
  it('happy: a new name is saved and shown, and the row keeps its place', async () => {
    const { user, cvPort } = await renderView(createFakeAnalysisPort({ cvs: [NEWER, OLDER] }));

    const box = await openRename(user, 'cv-1');
    expect(box.value).toBe('Old CV.docx');
    expect(document.activeElement).toBe(box);
    expect(screen.getByLabelText('Name')).toBe(box);

    await user.clear(box);
    await user.type(box, '  Banking CV  ');
    await user.click(screen.getByTestId('profile-cv-name-save-cv-1'));

    await vi.waitFor(() => expect(names()).toEqual(['Jordan Lewis CV.pdf', 'Banking CV']));
    // Trimmed, and nothing but the name changed: same id, text and date.
    expect(cvPort.storedCvs().find((cv) => cv.id === 'cv-1')).toEqual({
      ...OLDER,
      name: 'Banking CV',
    });
    expect(cvPort.calls.saveCv).toBe(1);
    expect(document.activeElement).toBe(screen.getByTestId('profile-cv-rename-cv-1'));
  });

  it('happy: Enter in the box saves, and renaming the default CV updates "Used by default"', async () => {
    const { user, cvPort } = await renderView(createFakeAnalysisPort({ cvs: [NEWER, OLDER] }));

    const box = await openRename(user, 'cv-2');
    await user.clear(box);
    await user.type(box, 'Risk CV{Enter}');

    await vi.waitFor(() => expect(names()).toEqual(['Risk CV', 'Old CV.docx']));
    expect(screen.getByTestId('profile-cv-current').textContent).toContain('Risk CV');
    expect(cvPort.storedCvs().find((cv) => cv.id === 'cv-2')?.name).toBe('Risk CV');
  });

  it.each([
    ['empty', ''],
    ['only spaces', '    '],
  ])('negative: a name that is %s is refused and the old name stays', async (_, typed) => {
    const { user, cvPort } = await renderView(createFakeAnalysisPort({ cvs: [NEWER, OLDER] }));

    const box = await openRename(user, 'cv-1');
    await user.clear(box);
    if (typed !== '') await user.type(box, typed);
    await user.click(screen.getByTestId('profile-cv-name-save-cv-1'));

    const problem = await screen.findByTestId('profile-cv-name-error-cv-1');
    expect(problem.textContent).toBe('Give the CV a name.');
    expect(problem.getAttribute('role')).toBe('alert');
    expect(box.getAttribute('aria-invalid')).toBe('true');
    expect(box.getAttribute('aria-describedby')).toBe(problem.id);
    expect(cvPort.calls.saveCv).toBe(0);
    expect(cvPort.storedCvs().find((cv) => cv.id === 'cv-1')?.name).toBe('Old CV.docx');
  });

  it('boundary: exactly 100 characters saves; 101 is refused', async () => {
    const { user, cvPort } = await renderView(createFakeAnalysisPort({ cvs: [NEWER, OLDER] }));
    const hundred = 'n'.repeat(100);

    let box = await openRename(user, 'cv-1');
    await user.clear(box);
    await user.paste(`${hundred}x`);
    await user.click(screen.getByTestId('profile-cv-name-save-cv-1'));
    expect((await screen.findByTestId('profile-cv-name-error-cv-1')).textContent).toBe(
      'Keep the name to 100 characters or fewer.',
    );
    expect(cvPort.calls.saveCv).toBe(0);

    box = nameBox('cv-1');
    await user.clear(box);
    await user.paste(hundred);
    await user.click(screen.getByTestId('profile-cv-name-save-cv-1'));
    await vi.waitFor(() => expect(names()).toEqual(['Jordan Lewis CV.pdf', hundred]));
    expect(cvPort.storedCvs().find((cv) => cv.id === 'cv-1')?.name).toBe(hundred);
  });

  it('boundary: the limit counts characters as read, so 100 emoji are 100, and spaces around do not count', async () => {
    const { user, cvPort } = await renderView(createFakeAnalysisPort({ cvs: [OLDER] }));
    const hundred = '📄'.repeat(100);

    const box = await openRename(user, 'cv-1');
    await user.clear(box);
    await user.paste(`   ${hundred}   `);
    await user.click(screen.getByTestId('profile-cv-name-save-cv-1'));

    await vi.waitFor(() => expect(cvPort.storedCvs()[0]?.name).toBe(hundred));
  });

  it('edge: a name that did not change closes the box and writes nothing', async () => {
    const { user, cvPort } = await renderView(createFakeAnalysisPort({ cvs: [OLDER] }));

    await openRename(user, 'cv-1');
    await user.click(screen.getByTestId('profile-cv-name-save-cv-1'));

    await vi.waitFor(() => expect(screen.queryByTestId('profile-cv-name-input-cv-1')).toBeNull());
    expect(cvPort.calls.saveCv).toBe(0);
  });

  it('negative: a save the database refuses shows the error and keeps the old name', async () => {
    const cvPort = createFakeAnalysisPort({ cvs: [NEWER, OLDER] });
    const { user } = await renderView(cvPort);

    const box = await openRename(user, 'cv-1');
    await user.clear(box);
    await user.type(box, 'Banking CV');
    cvPort.failNext('saveCv');
    await user.click(screen.getByTestId('profile-cv-name-save-cv-1'));

    expect((await screen.findByTestId('profile-cv-name-error-cv-1')).textContent).toBe(
      `That CV could not be saved: ${DB_REFUSAL} Try again.`,
    );
    // The typed name is still in the box to try again; nothing changed in the store.
    expect(nameBox('cv-1').value).toBe('Banking CV');
    expect(cvPort.storedCvs().find((cv) => cv.id === 'cv-1')?.name).toBe('Old CV.docx');

    await user.click(screen.getByTestId('profile-cv-name-cancel-cv-1'));
    expect(names()).toEqual(['Jordan Lewis CV.pdf', 'Old CV.docx']);
  });

  it.each([
    ['Escape', async (user: ReturnType<typeof userEvent.setup>) => user.keyboard('{Escape}')],
    [
      'Cancel',
      async (user: ReturnType<typeof userEvent.setup>) =>
        user.click(screen.getByTestId('profile-cv-name-cancel-cv-1')),
    ],
  ])('edge: %s changes nothing and puts focus back on Rename', async (_, leave) => {
    const { user, cvPort } = await renderView(createFakeAnalysisPort({ cvs: [NEWER, OLDER] }));

    const box = await openRename(user, 'cv-1');
    await user.clear(box);
    await user.type(box, 'Half typed');
    await leave(user);

    expect(screen.queryByTestId('profile-cv-name-input-cv-1')).toBeNull();
    expect(names()).toEqual(['Jordan Lewis CV.pdf', 'Old CV.docx']);
    expect(cvPort.calls.saveCv).toBe(0);
    expect(document.activeElement).toBe(screen.getByTestId('profile-cv-rename-cv-1'));
  });
});

describe('Delete', () => {
  it('happy: confirming removes the row, the CV and its saved checks, and asks for one delete', async () => {
    const cvPort = createFakeAnalysisPort({
      cvs: [NEWER, OLDER],
      analyses: [
        check('a-1', 'cv-1'),
        check('a-2', 'cv-1'),
        check('a-3', 'cv-1'),
        check('b-1', 'cv-2'),
      ],
    });
    const { user } = await renderView(cvPort);

    await user.click(screen.getByTestId('profile-cv-delete-cv-1'));
    const dialog = await screen.findByTestId('profile-cv-delete-dialog');
    expect(within(dialog).getByRole('heading').textContent).toBe('Delete Old CV.docx?');
    expect(screen.getByTestId('profile-cv-delete-body').textContent).toBe(
      'This also deletes 3 saved checks made with this CV. Your jobs stay. Tailored CVs and letters you saved to a job stay.',
    );
    // Nothing has been deleted by asking.
    expect(cvPort.calls.deleteCv).toBe(0);

    const confirm = screen.getByTestId('profile-cv-delete-confirm');
    expect(confirm.textContent).toBe('Delete');
    await user.click(confirm);

    await vi.waitFor(() => expect(names()).toEqual(['Jordan Lewis CV.pdf']));
    expect(screen.queryByTestId('profile-cv-delete-dialog')).toBeNull();
    expect(cvPort.calls.deleteCv).toBe(1);
    expect(cvPort.storedCvs()).toEqual([NEWER]);
    // The other CV's check is untouched.
    expect(cvPort.storedAnalyses().map((analysis) => analysis.id)).toEqual(['b-1']);
  });

  it('opens on Cancel, never on Delete, and names its heading and body for a screen reader', async () => {
    const { user } = await renderView(createFakeAnalysisPort({ cvs: [OLDER] }));

    await user.click(screen.getByTestId('profile-cv-delete-cv-1'));
    const dialog = await screen.findByTestId('profile-cv-delete-dialog');

    const cancel = screen.getByTestId('profile-cv-delete-cancel');
    expect(cancel.textContent).toBe('Cancel');
    expect(document.activeElement).toBe(cancel);
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(dialog.getAttribute('aria-labelledby') ?? '')?.textContent).toBe(
      'Delete Old CV.docx?',
    );
    expect(dialog.getAttribute('aria-describedby')).toBe(
      screen.getByTestId('profile-cv-delete-body').id,
    );
    expect(screen.getByTestId('profile-cv-delete-confirm').hasAttribute('data-primary')).toBe(
      false,
    );
  });

  it.each([
    [
      0,
      'No saved checks use this CV. Your jobs stay. Tailored CVs and letters you saved to a job stay.',
    ],
    [
      1,
      'This also deletes 1 saved check made with this CV. Your jobs stay. Tailored CVs and letters you saved to a job stay.',
    ],
    [
      3,
      'This also deletes 3 saved checks made with this CV. Your jobs stay. Tailored CVs and letters you saved to a job stay.',
    ],
    [
      1200,
      'This also deletes 1,200 saved checks made with this CV. Your jobs stay. Tailored CVs and letters you saved to a job stay.',
    ],
  ])('boundary: with %i saved checks the question says so', async (count, body) => {
    const analyses = Array.from({ length: count }, (_, index) =>
      check(`a-${String(index)}`, 'cv-1'),
    );
    const { user } = await renderView(createFakeAnalysisPort({ cvs: [OLDER], analyses }));

    await user.click(screen.getByTestId('profile-cv-delete-cv-1'));

    expect((await screen.findByTestId('profile-cv-delete-body')).textContent).toBe(body);
  });

  it.each([
    [
      'Cancel',
      async (user: ReturnType<typeof userEvent.setup>) =>
        user.click(screen.getByTestId('profile-cv-delete-cancel')),
    ],
    ['Escape', async (user: ReturnType<typeof userEvent.setup>) => user.keyboard('{Escape}')],
  ])('negative: %s deletes nothing and puts focus back on the row’s Delete', async (_, leave) => {
    const cvPort = createFakeAnalysisPort({
      cvs: [NEWER, OLDER],
      analyses: [check('a-1', 'cv-1')],
    });
    const { user } = await renderView(cvPort);

    await user.click(screen.getByTestId('profile-cv-delete-cv-1'));
    await screen.findByTestId('profile-cv-delete-dialog');
    await leave(user);

    expect(screen.queryByTestId('profile-cv-delete-dialog')).toBeNull();
    expect(cvPort.calls.deleteCv).toBe(0);
    expect(cvPort.storedCvs()).toEqual([NEWER, OLDER]);
    expect(cvPort.storedAnalyses()).toHaveLength(1);
    expect(names()).toEqual(['Jordan Lewis CV.pdf', 'Old CV.docx']);
    expect(document.activeElement).toBe(screen.getByTestId('profile-cv-delete-cv-1'));
  });

  it('negative: Enter on the question as it opens cancels, because focus is on Cancel', async () => {
    const cvPort = createFakeAnalysisPort({ cvs: [OLDER] });
    const { user } = await renderView(cvPort);

    await user.click(screen.getByTestId('profile-cv-delete-cv-1'));
    await screen.findByTestId('profile-cv-delete-dialog');
    await user.keyboard('{Enter}');

    expect(screen.queryByTestId('profile-cv-delete-dialog')).toBeNull();
    expect(cvPort.calls.deleteCv).toBe(0);
    expect(cvPort.storedCvs()).toEqual([OLDER]);
  });

  it('negative: when the saved checks cannot be counted, no question is asked and nothing is deleted', async () => {
    const cvPort = createFakeAnalysisPort({ cvs: [OLDER], analyses: [check('a-1', 'cv-1')] });
    const { user } = await renderView(cvPort);

    cvPort.failNext('loadHistory');
    await user.click(screen.getByTestId('profile-cv-delete-cv-1'));

    expect((await screen.findByTestId('profile-cv-error')).textContent).toBe(
      `${DB_REFUSAL} Your data is still on this machine.`,
    );
    expect(screen.queryByTestId('profile-cv-delete-dialog')).toBeNull();
    expect(cvPort.calls.deleteCv).toBe(0);
    expect(cvPort.storedCvs()).toEqual([OLDER]);
  });

  it('the count is read when the question opens, not when the screen did', async () => {
    const cvPort = createFakeAnalysisPort({ cvs: [OLDER] });
    const { user } = await renderView(cvPort);

    // A check saved on Analysis after Profile was drawn.
    await cvPort.saveAnalysis(check('late', 'cv-1'));
    await user.click(screen.getByTestId('profile-cv-delete-cv-1'));

    expect((await screen.findByTestId('profile-cv-delete-body')).textContent).toContain(
      'This also deletes 1 saved check made with this CV.',
    );
  });

  it('negative: a delete the database refuses keeps the row and shows the error', async () => {
    const cvPort = createFakeAnalysisPort({
      cvs: [NEWER, OLDER],
      analyses: [check('a-1', 'cv-1')],
    });
    const { user } = await renderView(cvPort);

    await user.click(screen.getByTestId('profile-cv-delete-cv-1'));
    await screen.findByTestId('profile-cv-delete-dialog');
    cvPort.failNext('deleteCv');
    await user.click(screen.getByTestId('profile-cv-delete-confirm'));

    expect((await screen.findByTestId('profile-cv-error')).textContent).toBe(
      `${DB_REFUSAL} Your data is still on this machine.`,
    );
    expect(names()).toEqual(['Jordan Lewis CV.pdf', 'Old CV.docx']);
    expect(cvPort.storedCvs()).toEqual([NEWER, OLDER]);
    expect(cvPort.storedAnalyses()).toHaveLength(1);
  });

  it('edge: deleting the default CV makes the next newest the default', async () => {
    const cvPort = createFakeAnalysisPort({ cvs: [NEWER, OLDER] });
    const { user } = await renderView(cvPort);
    expect(screen.getByTestId('profile-cv-current').textContent).toContain('Jordan Lewis CV.pdf');

    await user.click(screen.getByTestId('profile-cv-delete-cv-2'));
    await user.click(await screen.findByTestId('profile-cv-delete-confirm'));

    await vi.waitFor(() => expect(names()).toEqual(['Old CV.docx']));
    const current = screen.getByTestId('profile-cv-current');
    expect(current.textContent).toBe('Used by default: Old CV.docx.');
    // The row and its buttons are gone, so the keyboard lands on what is true now.
    expect(document.activeElement).toBe(current);
  });

  it('edge: deleting the last CV says there is none, and the upload is still there', async () => {
    const cvPort = createFakeAnalysisPort({ cvs: [OLDER] });
    const { user } = await renderView(cvPort);

    await user.click(screen.getByTestId('profile-cv-delete-cv-1'));
    await user.click(await screen.findByTestId('profile-cv-delete-confirm'));

    await vi.waitFor(() => expect(screen.queryByTestId('profile-cv-list')).toBeNull());
    expect(screen.getByTestId('profile-cv-current').textContent).toBe('No CV uploaded yet.');
    expect(cvPort.storedCvs()).toEqual([]);
    expect(screen.getByTestId('profile-upload')).toBeTruthy();
  });

  it('edge: a second press while the count is being read asks once', async () => {
    const cvPort = createFakeAnalysisPort({ cvs: [OLDER] });
    await renderView(cvPort);
    const before = cvPort.calls.loadHistory;

    const button = screen.getByTestId('profile-cv-delete-cv-1');
    fireEvent.click(button);
    fireEvent.click(button);
    await screen.findByTestId('profile-cv-delete-dialog');

    expect(cvPort.calls.loadHistory - before).toBe(1);
    expect(screen.getAllByTestId('profile-cv-delete-dialog')).toHaveLength(1);
  });
});
