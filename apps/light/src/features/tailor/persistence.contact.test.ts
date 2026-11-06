/**
 * L-346 — the details confirmed for a saved CV are kept with the job, in
 * `job_workflow.draft_json`, keyed by the CV they were confirmed for.
 *
 *   - They round-trip through `toRow` / `fromRow`, with the draft's `cvId`.
 *   - What cannot be read is dropped, one CV at a time, never half-used.
 *   - A pasted advert has no row, so its details stay in memory only.
 *   - "Delete everything" leaves nothing to be written back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ok, type TailoredCv } from '@cviper/core-types';

import { WIPE_ORDER } from '../../db/wipe';
import { type JobWorkflowRow } from '../../db/workflow';
import { createJobSessions, type TailorResult } from './jobSessions';
import {
  WRITE_DELAY_MS,
  fromRow,
  startWriteThrough,
  toRow,
  type WorkflowPort,
} from './persistence';

const NOW = '2026-11-06T09:00:00.000Z';

const CV: TailoredCv = {
  summary: 'Credit risk analyst.',
  key_skills: ['Python'],
  experience: [],
  education: [],
  certifications: [],
};

const RESULT: TailorResult = {
  cv: CV,
  cvId: 'cv-1',
  text: 'PROFESSIONAL SUMMARY\nCredit risk analyst.\n',
  report: { clean: true, flagged: [] },
  provider: 'ollama',
  model: 'llama3.1:8b',
  retried: false,
  userMetrics: [],
};

const JANE = { name: 'Jane Smith', email: 'jane@x.com', phone: '07700 900123' };

function row(draft: unknown): JobWorkflowRow {
  return {
    id: 'job-1',
    step: 'tailor',
    cv_id: 'cv-1',
    ai_option: null,
    advert: 'Advert.',
    draft_json: JSON.stringify(draft),
    updated_at: NOW,
  };
}

describe('toRow / fromRow keep the confirmed details (L-346)', () => {
  it('happy: the details and the draft’s CV id come back as they went in', () => {
    const session = {
      ...createJobSessions().session('job-1'),
      cvId: 'cv-1',
      result: RESULT,
      contact: { 'cv-1': JANE },
    };
    const restored = fromRow(toRow('job-1', session, NOW));
    expect(restored.contact).toEqual({ 'cv-1': JANE });
    expect(restored.result?.cvId).toBe('cv-1');
  });

  it('boundary: details with no draft are still a draft worth keeping', () => {
    const session = { ...createJobSessions().session('job-1'), contact: { 'cv-1': JANE } };
    const stored = toRow('job-1', session, NOW);
    expect(stored.draft_json).not.toBeNull();
    expect(fromRow(stored).contact).toEqual({ 'cv-1': JANE });
  });

  it('edge: a cleared field is kept cleared, not refilled', () => {
    const cleared = { ...JANE, email: '' };
    const session = { ...createJobSessions().session('job-1'), contact: { 'cv-1': cleared } };
    expect(fromRow(toRow('job-1', session, NOW)).contact['cv-1']).toEqual(cleared);
  });

  it('regression: a row written before L-346 reads with no details and no CV id', () => {
    const { cvId: _dropped, ...older } = RESULT;
    const restored = fromRow(row({ result: older }));
    expect(restored.contact).toEqual({});
    expect(restored.result?.cvId ?? null).toBeNull();
    expect(restored.result?.text).toBe(RESULT.text);
  });

  it('negative: malformed stored details are dropped one CV at a time', () => {
    const restored = fromRow(
      row({
        contact: {
          'cv-1': { name: 42, email: '', phone: '' },
          'cv-2': JANE,
          'cv-3': 'Jane Smith',
          'cv-4': null,
        },
      }),
    );
    expect(restored.contact).toEqual({ 'cv-2': JANE });
    expect(fromRow(row({ contact: 'Jane Smith' })).contact).toEqual({});
    expect(fromRow(row({ contact: [JANE] })).contact).toEqual({});
  });

  it('negative: a stored CV id that is not text is unknown, never a guess', () => {
    const restored = fromRow(row({ result: { ...RESULT, cvId: 7 } }));
    expect(restored.result?.cvId).toBeNull();
  });
});

describe('the write-through and the details (L-346)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function fakePort() {
    const saved: JobWorkflowRow[] = [];
    const port: WorkflowPort = {
      load: vi.fn(async () => ok([])),
      save: vi.fn(async (written: JobWorkflowRow) => {
        saved.push(written);
        return ok(undefined);
      }),
      readLastJob: vi.fn(async () => null),
      writeLastJob: vi.fn(async () => undefined),
    };
    return { port, saved };
  }

  it('happy: a tracked job’s details reach the database', async () => {
    const sessions = createJobSessions();
    const { port, saved } = fakePort();
    startWriteThrough(sessions, port, () => NOW);

    sessions.open('job-1', () => ({ advert: 'Advert.' }));
    sessions.patch('job-1', { contact: { 'cv-1': JANE } });
    await vi.advanceTimersByTimeAsync(WRITE_DELAY_MS);

    expect(saved.at(-1)?.draft_json).toContain('jane@x.com');
  });

  it('edge: a pasted advert’s details stay in memory only', async () => {
    const sessions = createJobSessions();
    const { port } = fakePort();
    startWriteThrough(sessions, port, () => NOW);

    sessions.open(null, () => ({ advert: 'Pasted.' }));
    sessions.patch(null, { contact: { 'cv-1': JANE } });
    await vi.advanceTimersByTimeAsync(WRITE_DELAY_MS * 2);

    expect(port.save).not.toHaveBeenCalled();
    expect(sessions.session(null).contact).toEqual({ 'cv-1': JANE });
  });

  it('negative: "Delete everything" before the write leaves nothing to write back', async () => {
    const sessions = createJobSessions();
    const { port } = fakePort();
    startWriteThrough(sessions, port, () => NOW);

    sessions.open('job-1', () => ({ advert: 'Advert.' }));
    sessions.patch('job-1', { contact: { 'cv-1': JANE } });
    sessions.reset();
    await vi.advanceTimersByTimeAsync(WRITE_DELAY_MS * 2);

    expect(port.save).not.toHaveBeenCalled();
    expect(sessions.session('job-1').contact).toEqual({});
    // And the rows already written go with the table the wipe empties.
    expect(WIPE_ORDER).toContain('job_workflow');
  });
});
