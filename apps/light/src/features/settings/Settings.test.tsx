// @vitest-environment jsdom
/**
 * Export and import, driven the way a user drives them.
 *
 * ============================================================================
 * THE ROUND TRIP IS THE POINT.
 * ============================================================================
 * A backup that writes a beautiful file nobody can read back is worth nothing,
 * and the two halves are easy to test separately and never together. So the
 * central test here exports through the real serialiser, feeds the ACTUAL BYTES
 * back through the file picker, and asserts the data arrived — no fixture, no
 * hand-written JSON, nothing that could be right in the test and wrong in the
 * app.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { type Application, type Cv, type Job } from '@cviper/core-types';

import { Settings } from './Settings';
import { createFakeBackupPort } from './test/fakePort';
import { createFakeFilePort } from '../../platform/test/fakeFilePort';

const NOW = new Date(2026, 7, 19, 9, 0, 0);

const JOB: Job = {
  id: 'job-1',
  source: 'manual',
  external_id: null,
  title: 'Credit Risk Analyst',
  company: 'Lloyds',
  location: 'London',
  salary_min: 65000,
  salary_max: 80000,
  salary_currency: 'GBP',
  salary_period: 'year',
  description: 'You will build SQL models.',
  url: null,
  posted_date: '2026-08-01',
  created_at: '2026-08-01T09:00:00.000Z',
};

const APPLICATION: Application = {
  id: 'app-1',
  job_id: 'job-1',
  status: 'applied',
  applied_date: '2026-08-02',
  notes: 'Spoke to Priya.',
  next_action: 'Chase the recruiter',
  next_action_date: '2026-08-21',
  updated_at: '2026-08-02T09:00:00.000Z',
};

const CV: Cv = {
  id: 'cv-1',
  name: 'Steven Brady CV.pdf',
  file_path: 'C:\\Users\\steve\\Documents\\CV.pdf',
  extracted_text: 'Credit risk analyst with eight years in London banking.',
  created_at: '2026-08-01T09:00:00.000Z',
};

const FULL = { jobs: [JOB], applications: [APPLICATION], cvs: [CV], analyses: [] };

afterEach(() => {
  cleanup();
});

function renderSettings(
  port = createFakeBackupPort(),
  filePort = createFakeFilePort(),
): {
  port: ReturnType<typeof createFakeBackupPort>;
  filePort: ReturnType<typeof createFakeFilePort>;
  user: ReturnType<typeof userEvent.setup>;
} {
  const user = userEvent.setup();
  render(<Settings port={port} filePort={filePort} now={NOW} />);
  return { port, filePort, user };
}

describe('the screen itself', () => {
  it('says what the file contains and that it never leaves the machine', async () => {
    renderSettings();

    const copy = screen.getByTestId('view-settings').textContent ?? '';
    expect(copy).toContain('one file on this computer');
    expect(copy).toContain('Nothing is uploaded');
    // And what import does, before anybody presses it.
    expect(copy).toContain('Nothing is deleted');
  });

  it('has exactly one enabled primary button', () => {
    renderSettings();

    const primaries = [...document.querySelectorAll('[data-primary="true"]')].filter(
      (button) => !(button as HTMLButtonElement).disabled,
    );
    expect(primaries).toHaveLength(1);
    expect(primaries[0]?.getAttribute('data-testid')).toBe('settings-export');
  });
});

describe('export', () => {
  it('writes the whole database and says where it went', async () => {
    const { user, filePort } = renderSettings(createFakeBackupPort(FULL));

    await user.click(screen.getByTestId('settings-export'));

    const message = await screen.findByTestId('settings-message');
    expect(message.textContent).toContain('C:\\Users\\steve\\Documents\\cviper-backup.json');
    expect(message.textContent).toContain('1 job, 1 application and 1 CV');
    expect(message.textContent).toContain('never left this machine');

    expect(filePort.written()).toHaveLength(1);
    const written = JSON.parse(filePort.written()[0]?.contents ?? '{}') as Record<string, unknown>;
    expect(written['schemaVersion']).toBe(1);
    expect(written['app']).toEqual({ name: 'cviper-light', version: '0.1.0' });
    expect(written['jobs']).toHaveLength(1);
  });

  it('offers a dated filename', async () => {
    const { user, filePort } = renderSettings(createFakeBackupPort(FULL));

    await user.click(screen.getByTestId('settings-export'));
    await screen.findByTestId('settings-message');

    // The fake records what it was asked to write; the suggested name reaches
    // the dialog, which `platform/files.test.ts` covers on the real port.
    expect(filePort.calls.saveBackup).toBe(1);
  });

  it('boundary: an empty database still exports, and says it is empty', async () => {
    const { user, filePort } = renderSettings();

    await user.click(screen.getByTestId('settings-export'));

    expect((await screen.findByTestId('settings-message')).textContent).toContain('nothing at all');
    expect(filePort.written()).toHaveLength(1);
  });

  it('says nothing at all when the user cancels the save dialog', async () => {
    const { user, filePort } = renderSettings(createFakeBackupPort(FULL));
    filePort.nextSavePath(null);

    await user.click(screen.getByTestId('settings-export'));

    expect(filePort.written()).toEqual([]);
    expect(screen.queryByTestId('settings-message')).toBeNull();
    expect(screen.queryAllByRole('alert')).toEqual([]);
  });

  it('negative: reports a database that will not open, and reassures', async () => {
    const port = createFakeBackupPort(FULL);
    port.failNext('read');
    const { user, filePort } = renderSettings(port);

    await user.click(screen.getByTestId('settings-export'));

    const problem = await screen.findByTestId('settings-problem');
    expect(problem.textContent).toContain('could not be read');
    expect(problem.textContent).toContain('nothing has been lost');
    expect(filePort.written()).toEqual([]);
  });

  it('negative: reports a file that could not be written', async () => {
    const { user, filePort } = renderSettings(createFakeBackupPort(FULL));
    filePort.failSave('Windows would not let CViper write there.');

    await user.click(screen.getByTestId('settings-export'));

    expect((await screen.findByTestId('settings-problem')).textContent).toContain(
      'would not let CViper write there',
    );
  });
});

describe('import', () => {
  it('states the counts BEFORE writing anything, and waits', async () => {
    const port = createFakeBackupPort();
    const { user, filePort } = renderSettings(port);

    filePort.nextBackup({
      name: 'cviper-backup-2026-08-19.json',
      path: 'C:\\backup.json',
      text: JSON.stringify({
        schemaVersion: 1,
        exportedAt: '2026-08-19T09:00:00.000Z',
        app: { name: 'cviper-light', version: '0.1.0' },
        jobs: [JOB],
        applications: [APPLICATION],
        cvs: [CV],
        analyses: [],
      }),
    });

    await user.click(screen.getByTestId('settings-import'));

    expect((await screen.findByTestId('settings-counts')).textContent).toBe(
      'This will add or update 1 job, 1 application and 1 CV.',
    );
    // The load-bearing half: nothing has been written yet.
    expect(port.calls.write).toBe(0);
    expect(port.snapshot().jobs).toEqual([]);
  });

  it('has one enabled primary while confirming, and it is the confirm button', async () => {
    const { user, filePort } = renderSettings();
    filePort.nextBackup({
      name: 'b.json',
      path: 'C:\\b.json',
      text: emptyBackup(),
    });

    await user.click(screen.getByTestId('settings-import'));
    await screen.findByTestId('settings-confirm');

    const enabled = [...document.querySelectorAll('[data-primary="true"]')].filter(
      (button) => !(button as HTMLButtonElement).disabled,
    );
    expect(enabled).toHaveLength(1);
    expect(enabled[0]?.getAttribute('data-testid')).toBe('settings-confirm-import');
  });

  it('writes only after the user confirms', async () => {
    const port = createFakeBackupPort();
    const { user, filePort } = renderSettings(port);

    filePort.nextBackup({
      name: 'cviper-backup.json',
      path: 'C:\\b.json',
      text: JSON.stringify({
        schemaVersion: 1,
        exportedAt: '2026-08-19T09:00:00.000Z',
        app: { name: 'cviper-light', version: '0.1.0' },
        jobs: [JOB],
        applications: [APPLICATION],
        cvs: [CV],
        analyses: [],
      }),
    });

    await user.click(screen.getByTestId('settings-import'));
    await screen.findByTestId('settings-confirm');
    await user.click(screen.getByTestId('settings-confirm-import'));

    expect((await screen.findByTestId('settings-message')).textContent).toContain(
      'Imported 1 job, 1 application and 1 CV from cviper-backup.json',
    );
    expect(port.snapshot().jobs).toEqual([JOB]);
    expect(port.snapshot().cvs).toEqual([CV]);
  });

  it('writes nothing when the user cancels the confirmation', async () => {
    const port = createFakeBackupPort();
    const { user, filePort } = renderSettings(port);

    filePort.nextBackup({ name: 'b.json', path: 'C:\\b.json', text: emptyBackup() });

    await user.click(screen.getByTestId('settings-import'));
    await user.click(await screen.findByTestId('settings-cancel-import'));

    expect(port.calls.write).toBe(0);
    expect(screen.queryByTestId('settings-confirm')).toBeNull();
  });

  it('says nothing at all when the user cancels the file picker', async () => {
    const { user, filePort } = renderSettings();
    filePort.nextBackup(null);

    await user.click(screen.getByTestId('settings-import'));

    expect(screen.queryByTestId('settings-confirm')).toBeNull();
    expect(screen.queryAllByRole('alert')).toEqual([]);
  });

  it('negative: a file from a NEWER version says so, and does not call it broken', async () => {
    const { user, filePort } = renderSettings();

    filePort.nextBackup({
      name: 'future.json',
      path: 'C:\\future.json',
      text: JSON.stringify({
        schemaVersion: 99,
        exportedAt: '2026-08-19T09:00:00.000Z',
        app: { name: 'cviper-light', version: '9.0.0' },
        jobs: [],
        applications: [],
        cvs: [],
        analyses: [],
      }),
    });

    await user.click(screen.getByTestId('settings-import'));

    const problem = await screen.findByTestId('settings-problem');
    expect(problem.textContent).toContain('newer version of CViper Light');
    expect(problem.textContent).toContain('Update CViper Light');
    expect(problem.textContent).toContain('do not delete it');
    // The failure this prevents: somebody deleting their only backup because
    // the app called a perfectly good file damaged.
    expect(problem.textContent?.toLowerCase()).not.toContain('damaged');
    expect(screen.queryByTestId('settings-confirm')).toBeNull();
  });

  it('negative: a damaged file is reported as damaged, with what to try', async () => {
    const { user, filePort } = renderSettings();
    filePort.nextBackup({ name: 'broken.json', path: 'C:\\broken.json', text: '{ "jobs": [' });

    await user.click(screen.getByTestId('settings-import'));

    expect((await screen.findByTestId('settings-problem')).textContent).toContain('damaged');
  });

  it('negative: a bad record names the record and says nothing was imported', async () => {
    const port = createFakeBackupPort();
    const { user, filePort } = renderSettings(port);

    filePort.nextBackup({
      name: 'partly-bad.json',
      path: 'C:\\p.json',
      text: JSON.stringify({
        schemaVersion: 1,
        exportedAt: '2026-08-19T09:00:00.000Z',
        app: { name: 'cviper-light', version: '0.1.0' },
        jobs: [JOB],
        applications: [{ ...APPLICATION, status: 'ghosted' }],
        cvs: [],
        analyses: [],
      }),
    });

    await user.click(screen.getByTestId('settings-import'));

    const problem = await screen.findByTestId('settings-problem');
    expect(problem.textContent).toContain('applications[0]');
    expect(problem.textContent).toContain('Nothing has been imported');
    // Atomic in fact, not only in words: the valid job in the same file is not
    // half-imported.
    expect(port.calls.write).toBe(0);
    expect(port.snapshot().jobs).toEqual([]);
  });

  it('negative: a write that fails says nothing was changed', async () => {
    const port = createFakeBackupPort();
    const { user, filePort } = renderSettings(port);

    port.failNext('write');
    filePort.nextBackup({ name: 'b.json', path: 'C:\\b.json', text: emptyBackup() });

    await user.click(screen.getByTestId('settings-import'));
    await user.click(await screen.findByTestId('settings-confirm-import'));

    expect((await screen.findByTestId('settings-problem')).textContent).toContain(
      'nothing was changed',
    );
  });

  it('boundary: an empty backup imports, and says it held nothing', async () => {
    const { user, filePort } = renderSettings();
    filePort.nextBackup({ name: 'empty.json', path: 'C:\\e.json', text: emptyBackup() });

    await user.click(screen.getByTestId('settings-import'));
    expect((await screen.findByTestId('settings-counts')).textContent).toContain('nothing at all');

    await user.click(screen.getByTestId('settings-confirm-import'));
    expect((await screen.findByTestId('settings-message')).textContent).toContain('nothing at all');
  });
});

describe('the round trip', () => {
  it('exports, then imports its own bytes back into an empty database', async () => {
    // No fixture. The bytes that go into the import are the bytes the export
    // produced, so a change to either half that broke the other fails here.
    const source = createFakeBackupPort(FULL);
    const filePort = createFakeFilePort();
    const { user } = renderSettings(source, filePort);

    await user.click(screen.getByTestId('settings-export'));
    await screen.findByTestId('settings-message');

    const exported = filePort.written()[0]?.contents ?? '';
    expect(exported).not.toBe('');

    cleanup();

    const destination = createFakeBackupPort();
    const restore = renderSettings(destination, createFakeFilePort());
    restore.filePort.nextBackup({
      name: 'cviper-backup-2026-08-19.json',
      path: 'C:\\backup.json',
      text: exported,
    });

    await restore.user.click(screen.getByTestId('settings-import'));
    await restore.user.click(await screen.findByTestId('settings-confirm-import'));
    await screen.findByTestId('settings-message');

    expect(destination.snapshot().jobs).toEqual([JOB]);
    expect(destination.snapshot().applications).toEqual([APPLICATION]);
    expect(destination.snapshot().cvs).toEqual([CV]);
  });

  it('does not delete what is already there', async () => {
    // `writeAll` merges, and the copy on screen promises it does. If the
    // promise and the behaviour ever part company, this is where it shows.
    const other: Job = { ...JOB, id: 'job-2', title: 'Quant Developer' };
    const destination = createFakeBackupPort({
      jobs: [other],
      applications: [],
      cvs: [],
      analyses: [],
    });
    const { user, filePort } = renderSettings(destination);

    filePort.nextBackup({
      name: 'b.json',
      path: 'C:\\b.json',
      text: JSON.stringify({
        schemaVersion: 1,
        exportedAt: '2026-08-19T09:00:00.000Z',
        app: { name: 'cviper-light', version: '0.1.0' },
        jobs: [JOB],
        applications: [],
        cvs: [],
        analyses: [],
      }),
    });

    await user.click(screen.getByTestId('settings-import'));
    await user.click(await screen.findByTestId('settings-confirm-import'));
    await screen.findByTestId('settings-message');

    expect(
      destination
        .snapshot()
        .jobs.map((job) => job.id)
        .sort(),
    ).toEqual(['job-1', 'job-2']);
  });
});

/** The smallest valid backup: correct shape, no records. */
function emptyBackup(): string {
  return JSON.stringify({
    schemaVersion: 1,
    exportedAt: '2026-08-19T09:00:00.000Z',
    app: { name: 'cviper-light', version: '0.1.0' },
    jobs: [],
    applications: [],
    cvs: [],
    analyses: [],
  });
}
