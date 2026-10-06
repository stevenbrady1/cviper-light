/**
 * L-199, part 2: a job's Tailor work survives a restart.
 *
 *   - `toRow` / `fromRow` round-trip what Tailor holds, and a draft that
 *     cannot be read is dropped WITHOUT losing the job's advert and choices.
 *   - The write-through waits ~500 ms after the last change, writes each job
 *     once, never writes a pasted advert (it has no job), and writes nothing
 *     after "Delete everything".
 *   - Hydrating on launch restores every job and reopens the last one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ok, type TailoredCv } from '@cviper/core-types';

import { type JobWorkflowRow } from '../../db/workflow';
import { createJobSessions, type TailorResult } from './jobSessions';
import {
  WRITE_DELAY_MS,
  fromRow,
  hydrateJobSessions,
  startWriteThrough,
  toRow,
  type WorkflowPort,
} from './persistence';

const NOW = '2026-10-06T09:00:00.000Z';

const CV: TailoredCv = {
  summary: 'Credit risk analyst.',
  key_skills: ['Python'],
  experience: [
    {
      title: 'Analyst',
      company: 'Lloyds Banking Group',
      location: 'London',
      dates: '2020 – Present',
      bullets: ['Built models.'],
    },
  ],
  education: ['BSc Mathematics'],
  certifications: [],
};

const RESULT: TailorResult = {
  cv: CV,
  text: 'PROFESSIONAL SUMMARY\nCredit risk analyst.',
  report: { clean: true, flagged: [] },
  provider: 'ollama',
  model: 'llama3.1:8b',
  retried: false,
  userMetrics: [],
};

function fakePort(rows: JobWorkflowRow[] = [], lastJob: string | null = null) {
  const saved: JobWorkflowRow[] = [];
  const lastJobWrites: (string | null)[] = [];
  const port: WorkflowPort = {
    load: vi.fn(async () => ok(rows)),
    save: vi.fn(async (row: JobWorkflowRow) => {
      saved.push(row);
      return ok(undefined);
    }),
    readLastJob: vi.fn(async () => lastJob),
    writeLastJob: vi.fn(async (id: string | null) => {
      lastJobWrites.push(id);
    }),
  };
  return { port, saved, lastJobWrites };
}

describe('toRow / fromRow', () => {
  it('happy: round-trips the advert, the choices and the draft', () => {
    const row = toRow(
      'job-1',
      {
        ...createJobSessions().session('job-1'),
        cvId: 'cv-1',
        optionKey: 'ollama:llama3.1:8b',
        advert: 'Credit Risk Analyst. SQL.',
        result: RESULT,
      },
      NOW,
    );

    expect(row).toMatchObject({
      id: 'job-1',
      step: 'tailor',
      cv_id: 'cv-1',
      ai_option: 'ollama:llama3.1:8b',
      advert: 'Credit Risk Analyst. SQL.',
      updated_at: NOW,
    });
    expect(fromRow(row)).toMatchObject({
      cvId: 'cv-1',
      optionKey: 'ollama:llama3.1:8b',
      advert: 'Credit Risk Analyst. SQL.',
      result: RESULT,
      review: null,
      letter: null,
    });
  });

  it('boundary: no draft yet is stored as NULL, not as an empty object', () => {
    const row = toRow('job-1', { ...createJobSessions().session('job-1'), advert: 'A' }, NOW);
    expect(row.draft_json).toBeNull();
    expect(fromRow(row)).toMatchObject({ advert: 'A', result: null });
  });

  it('negative: a draft that is not JSON is dropped, and the advert and choices survive', () => {
    const restored = fromRow({
      id: 'job-1',
      step: 'tailor',
      cv_id: 'cv-1',
      ai_option: null,
      advert: 'Kept.',
      draft_json: '{not json',
      updated_at: NOW,
    });
    expect(restored).toMatchObject({ advert: 'Kept.', cvId: 'cv-1', result: null });
  });

  it('negative: a draft whose CV no longer fits the schema is dropped, not shown half-broken', () => {
    const restored = fromRow({
      id: 'job-1',
      step: 'tailor',
      cv_id: null,
      ai_option: null,
      advert: 'Kept.',
      draft_json: JSON.stringify({ result: { ...RESULT, cv: { summary: 42 } } }),
      updated_at: NOW,
    });
    expect(restored.result).toBeNull();
    expect(restored.advert).toBe('Kept.');
  });

  it('a restored job is never "running": the run it was in died with the app', () => {
    const row = toRow(
      'job-1',
      { ...createJobSessions().session('job-1'), advert: 'A', phase: 'tailoring' },
      NOW,
    );
    expect(fromRow(row).phase).toBe('idle');
  });
});

describe('startWriteThrough', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('happy: writes a job once, WRITE_DELAY_MS after the last change', async () => {
    const sessions = createJobSessions();
    const { port, saved } = fakePort();
    const stop = startWriteThrough(sessions, port, () => NOW);

    sessions.open('job-1', () => ({ advert: 'A' }));
    sessions.patch('job-1', { advert: 'AB' });
    await vi.advanceTimersByTimeAsync(WRITE_DELAY_MS - 1);
    sessions.patch('job-1', { advert: 'ABC' });
    await vi.advanceTimersByTimeAsync(WRITE_DELAY_MS - 1);
    expect(saved).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(saved.map((row) => row.advert)).toEqual(['ABC']);
    stop();
  });

  it('two jobs are written as two rows, each with its own work', async () => {
    const sessions = createJobSessions();
    const { port, saved } = fakePort();
    const stop = startWriteThrough(sessions, port, () => NOW);

    sessions.open('job-1', () => ({ advert: 'A' }));
    sessions.open('job-2', () => ({ advert: 'B' }));
    await vi.advanceTimersByTimeAsync(WRITE_DELAY_MS);

    expect(saved.map((row) => [row.id, row.advert]).sort()).toEqual([
      ['job-1', 'A'],
      ['job-2', 'B'],
    ]);
    stop();
  });

  it('negative: a pasted advert has no job, and is never written', async () => {
    const sessions = createJobSessions();
    const { port, saved } = fakePort();
    const stop = startWriteThrough(sessions, port, () => NOW);

    sessions.patch(null, { advert: 'Pasted advert' });
    await vi.advanceTimersByTimeAsync(WRITE_DELAY_MS * 2);

    expect(saved).toHaveLength(0);
    stop();
  });

  it('remembers the last job by id only, after the same pause', async () => {
    const sessions = createJobSessions();
    const { port, lastJobWrites } = fakePort();
    const stop = startWriteThrough(sessions, port, () => NOW);

    sessions.open('job-1', () => ({ advert: 'A' }));
    sessions.open('job-2', () => ({ advert: 'B' }));
    await vi.advanceTimersByTimeAsync(WRITE_DELAY_MS);

    expect(lastJobWrites).toEqual(['job-2']);
    stop();
  });

  it('negative: after "Delete everything" nothing pending is written back', async () => {
    const sessions = createJobSessions();
    const { port, saved, lastJobWrites } = fakePort();
    const stop = startWriteThrough(sessions, port, () => NOW);

    sessions.open('job-1', () => ({ advert: 'A' }));
    sessions.reset();
    await vi.advanceTimersByTimeAsync(WRITE_DELAY_MS * 2);

    expect(saved).toHaveLength(0);
    expect(lastJobWrites).toEqual([]);
    stop();
  });

  it('stop() cancels what is pending and stops listening', async () => {
    const sessions = createJobSessions();
    const { port, saved } = fakePort();
    const stop = startWriteThrough(sessions, port, () => NOW);

    sessions.open('job-1', () => ({ advert: 'A' }));
    stop();
    sessions.patch('job-1', { advert: 'B' });
    await vi.advanceTimersByTimeAsync(WRITE_DELAY_MS * 2);

    expect(saved).toHaveLength(0);
  });

  it('negative: a failed write is reported, and the next change tries again', async () => {
    const sessions = createJobSessions();
    const { port, saved } = fakePort();
    const onError = vi.fn();
    vi.mocked(port.save).mockResolvedValueOnce({
      ok: false,
      error: { code: 'QUERY_FAILED', message: 'database is locked', table: 'job_workflow' },
    });
    const stop = startWriteThrough(sessions, port, () => NOW, onError);

    sessions.open('job-1', () => ({ advert: 'A' }));
    await vi.advanceTimersByTimeAsync(WRITE_DELAY_MS);
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('database is locked'));

    sessions.patch('job-1', { advert: 'AB' });
    await vi.advanceTimersByTimeAsync(WRITE_DELAY_MS);
    expect(saved.map((row) => row.advert)).toEqual(['AB']);
    stop();
  });
});

describe('hydrateJobSessions', () => {
  const ROWS: JobWorkflowRow[] = [
    toRow(
      'job-1',
      { ...createJobSessions().session(null), advert: 'Advert 1', result: RESULT },
      NOW,
    ),
    toRow('job-2', { ...createJobSessions().session(null), advert: 'Advert 2' }, NOW),
  ];

  it('happy: restores every job and reopens the last one', async () => {
    const sessions = createJobSessions();
    const { port } = fakePort(ROWS, 'job-1');

    const resumed = await hydrateJobSessions(sessions, port);

    expect(resumed).toBe('job-1');
    expect(sessions.get().activeJobId).toBe('job-1');
    expect(sessions.active().result).toEqual(RESULT);
    expect(sessions.session('job-2').advert).toBe('Advert 2');
  });

  it('boundary: no last job leaves a paste showing, with every job still restored', async () => {
    const sessions = createJobSessions();
    const { port } = fakePort(ROWS, null);

    expect(await hydrateJobSessions(sessions, port)).toBeNull();
    expect(sessions.get().activeJobId).toBeNull();
    expect(sessions.session('job-1').advert).toBe('Advert 1');
  });

  it('negative: a last job with no work in progress (deleted since) is not resumed', async () => {
    const sessions = createJobSessions();
    const { port } = fakePort(ROWS, 'job-gone');

    expect(await hydrateJobSessions(sessions, port)).toBeNull();
    expect(sessions.get().activeJobId).toBeNull();
  });

  it('negative: an unreadable table resumes nothing and breaks nothing', async () => {
    const sessions = createJobSessions();
    const { port } = fakePort([], 'job-1');
    vi.mocked(port.load).mockResolvedValueOnce({
      ok: false,
      error: { code: 'MALFORMED_ROW', message: 'bad row', table: 'job_workflow' },
    });

    expect(await hydrateJobSessions(sessions, port)).toBeNull();
    expect(sessions.get().sessions.size).toBe(0);
  });

  it('edge: work the user started before the read finished is never overwritten', async () => {
    const sessions = createJobSessions();
    sessions.open('job-1', () => ({ advert: 'Typed while loading' }));
    const { port } = fakePort(ROWS, 'job-2');

    await hydrateJobSessions(sessions, port);

    expect(sessions.session('job-1').advert).toBe('Typed while loading');
    // And the user's own choice of job is not taken away from them.
    expect(sessions.get().activeJobId).toBe('job-1');
  });
});
