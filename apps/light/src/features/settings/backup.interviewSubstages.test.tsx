// @vitest-environment jsdom
/**
 * Interview sub-stages (L-205) through the REAL export and import buttons.
 *
 * The format tests prove `exportBackup` and `importBackup` agree with each
 * other. They cannot prove the Settings screen hands the new collection to the
 * writer: `onConfirmImport` names every collection by hand, and one it forgets
 * is silently dropped — worse, a card written without the sub-stage it points
 * at breaks the foreign key and rolls the whole import back. So this exports
 * through the screen, feeds the actual bytes back through a second screen on an
 * empty database, and looks at what arrived.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { type Application, type InterviewSubstage, type Job } from '@cviper/core-types';

import { createFakeFilePort } from '../../platform/test/fakeFilePort';

import { Settings } from './Settings';
import { createFakeBackupPort } from './test/fakePort';

const NOW = new Date(2026, 9, 5, 9, 0, 0);

const JOB: Job = {
  id: 'job-1',
  source: 'manual',
  external_id: null,
  title: 'Quant Developer',
  company: 'Man Group',
  agency: null,
  location: 'London',
  salary_min: null,
  salary_max: null,
  salary_currency: null,
  salary_period: null,
  description: null,
  url: null,
  posted_date: null,
  created_at: '2026-10-01T09:00:00.000Z',
};

const STAGES: InterviewSubstage[] = [
  { id: 'sub-a', name: 'HR Screen', position: 0 },
  { id: 'sub-b', name: 'Panel Round', position: 1 },
];

const CARD: Application = {
  id: 'app-1',
  job_id: 'job-1',
  status: 'interviewing',
  applied_date: null,
  notes: null,
  next_action: null,
  next_action_date: null,
  updated_at: '2026-10-02T09:00:00.000Z',
  interview_substage_id: 'sub-b',
};

const EMPTY = {
  profile: null,
  jobs: [],
  applications: [],
  interview_substages: [],
  documents: [],
  cvs: [],
  analyses: [],
};

afterEach(cleanup);

async function exported(snapshot: Parameters<typeof createFakeBackupPort>[0]): Promise<string> {
  const user = userEvent.setup();
  const filePort = createFakeFilePort();
  render(<Settings port={createFakeBackupPort(snapshot)} filePort={filePort} now={NOW} />);
  await user.click(screen.getByTestId('settings-export'));
  await screen.findByTestId('settings-message');
  cleanup();
  return filePort.written()[0]?.contents ?? '';
}

async function importInto(text: string, destination = createFakeBackupPort(EMPTY)) {
  const user = userEvent.setup();
  const filePort = createFakeFilePort();
  render(<Settings port={destination} filePort={filePort} now={NOW} />);
  filePort.nextBackup({ name: 'b.json', path: 'C:\\b.json', text });
  await user.click(screen.getByTestId('settings-import'));
  return { user, destination };
}

describe('export then import, through the screen', () => {
  it('carries the sub-stages and the card using one onto an empty database', async () => {
    const text = await exported({
      ...EMPTY,
      jobs: [JOB],
      applications: [CARD],
      interview_substages: STAGES,
    });

    const written = JSON.parse(text) as { interview_substages: unknown[] };
    expect(written.interview_substages).toEqual(STAGES);

    const { user, destination } = await importInto(text);
    await user.click(await screen.findByTestId('settings-confirm-import'));
    await screen.findByTestId('settings-message');

    expect(destination.snapshot().interview_substages).toEqual(STAGES);
    expect(destination.snapshot().applications[0]?.interview_substage_id).toBe('sub-b');
  });

  it('a file from before sub-stages imports unchanged: nothing added, nothing refused', async () => {
    const legacy = JSON.stringify({
      schemaVersion: 1,
      exportedAt: '2026-09-01T09:00:00.000Z',
      app: { name: 'cviper-light', version: '0.6.0' },
      profile: null,
      jobs: [JOB],
      applications: [{ ...CARD, interview_substage_id: undefined }],
      documents: [],
      cvs: [],
      analyses: [],
    });

    const { user, destination } = await importInto(legacy);
    await user.click(await screen.findByTestId('settings-confirm-import'));
    await screen.findByTestId('settings-message');

    expect(destination.snapshot().applications).toHaveLength(1);
    expect(destination.snapshot().interview_substages).toEqual([]);
    expect(destination.snapshot().applications[0]?.interview_substage_id ?? null).toBeNull();
  });

  it('negative: a file with an unnamed sub-stage is refused whole, and nothing is written', async () => {
    const bad = JSON.stringify({
      schemaVersion: 1,
      exportedAt: '2026-10-01T09:00:00.000Z',
      app: { name: 'cviper-light', version: '0.7.0' },
      jobs: [JOB],
      applications: [CARD],
      interview_substages: [{ id: 'sub-b', name: '', position: 0 }],
      cvs: [],
      analyses: [],
    });

    const { destination } = await importInto(bad);

    expect((await screen.findByTestId('settings-problem')).textContent).toContain(
      'interview_substages[0]',
    );
    expect(destination.snapshot().jobs).toEqual([]);
    expect(destination.snapshot().interview_substages).toEqual([]);
  });
});
