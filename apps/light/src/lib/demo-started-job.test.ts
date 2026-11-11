/**
 * L-363 — the started job the smoke job photographs (`e2e/demoStartedJob.ts`).
 *
 * That file is plain objects, because it runs under plain Node in the smoke
 * job. These tests hold every part of it to the app's OWN code, so what the
 * smoke job puts in the database is what the app would have put there — not
 * a shape somebody invented for a picture:
 *
 *   - the backup, to `importBackup`;
 *   - the two statements, to the app's approved list and `upsertInto`;
 *   - the Tailor draft, to `fromRow` and `toRow` (read back, written back,
 *     byte for byte), `renderTailoredCv` and `checkFabrication`;
 *   - the request counter's key and the network commands, to the app's own.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { checkFabrication } from '@cviper/ai-providers';
import { atsReadiness } from '@cviper/ats-checks';
import { importBackup, renderTailoredCv } from '@cviper/core-types';
import { describe, expect, it } from 'vitest';

import {
  CV_DELETE,
  JOB_WORKFLOW_UPSERT,
  NETWORK_COMMANDS,
  REQUEST_COUNT_KEY,
  STARTED_APPLICATION_ID,
  STARTED_CV_ID,
  STARTED_CV_TEXT,
  STARTED_JOB_ID,
  STARTED_JOB_TITLE,
  startedJobBackup,
  startedJobWorkflowValues,
} from '../../e2e/demoStartedJob.ts';
import { DEMO_ID_PREFIX, demoApplicationIds } from '../../e2e/demoBackup.ts';
import { allApprovedSql } from '../db/approvedAll';
import { upsertInto } from '../db/statements';
import { type JobWorkflowRow } from '../db/workflow';
import { jobAdvertText } from '../features/analysis/model';
import { continueStep, isStarted } from '../features/flow/steps';
import { fromRow, toRow } from '../features/tailor/persistence';
import { REQUEST_LOG_STORAGE_KEY } from '../status/requestLog';
import { REPO_ROOT } from './repo-scan';

const NOW = new Date('2026-11-11T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function imported() {
  const result = importBackup(JSON.parse(startedJobBackup(NOW)));
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function workflowRow(): JobWorkflowRow {
  const values = startedJobWorkflowValues(NOW);
  expect(values).toHaveLength(7);
  const [id, step, cvId, aiOption, advert, draftJson, updatedAt] = values;
  return {
    id: id ?? '',
    step: step ?? '',
    cv_id: cvId ?? null,
    ai_option: aiOption ?? null,
    advert: advert ?? '',
    draft_json: draftJson ?? null,
    updated_at: updatedAt ?? '',
  };
}

describe('the started job’s backup (L-363)', () => {
  it('is a backup the app imports: one job, its application, the CV and the analysis', () => {
    const backup = imported();
    expect(backup.jobs.map((job) => job.id)).toEqual([STARTED_JOB_ID]);
    expect(backup.applications.map((app) => [app.id, app.job_id])).toEqual([
      [STARTED_APPLICATION_ID, STARTED_JOB_ID],
    ]);
    expect(backup.cvs.map((cv) => [cv.id, cv.extracted_text])).toEqual([
      [STARTED_CV_ID, STARTED_CV_TEXT],
    ]);
    expect(backup.analyses.map((analysis) => [analysis.cv_id, analysis.job_id])).toEqual([
      [STARTED_CV_ID, STARTED_JOB_ID],
    ]);
  });

  it('the analysis is a Basic match one — worked out on the machine, no model', () => {
    const [analysis] = imported().analyses;
    expect(analysis?.provider).toBe('keyword');
    expect(analysis?.model).toMatch(/^keyword-v\d+$/);
    expect(analysis?.match_score).toBe(analysis?.result_json.match_score);
  });

  it('is analysed and tailored but not exported, so Continue goes to ATS Score', () => {
    const backup = imported();
    // Exported means a CV document saved to the application. There is none.
    expect(backup.documents).toEqual([]);
    const progress = { analysed: true, tailored: true, exported: false };
    expect(isStarted(progress)).toBe(true);
    expect(continueStep(progress)).toBe('ats');
  });

  it('every id is marked as demo data, and none collides with the five pictures’ demo ids', () => {
    const backup = imported();
    const ids = [
      ...backup.jobs.map((job) => job.id),
      ...backup.applications.map((app) => app.id),
      ...backup.cvs.map((cv) => cv.id),
      ...backup.analyses.map((analysis) => analysis.id),
    ];
    for (const id of ids) expect(id.startsWith(DEMO_ID_PREFIX)).toBe(true);
    expect(demoApplicationIds()).not.toContain(STARTED_APPLICATION_ID);
  });

  it('negative: carries no profile, and no email address or phone number anywhere', () => {
    const backup = imported();
    expect(backup.profile).toBeNull();
    const everything = startedJobBackup(NOW) + JSON.stringify(startedJobWorkflowValues(NOW));
    expect(everything).not.toMatch(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    // The app's own contact check finds neither on the CV or the draft.
    expect(atsReadiness(STARTED_CV_TEXT).contact.message).toMatch(
      /Missing: email address, phone number/,
    );
  });

  it('boundary: dates follow the clock it is given, and none is in the future', () => {
    const backup = imported();
    const stamps = [
      ...backup.jobs.map((job) => job.created_at),
      ...backup.applications.map((app) => app.updated_at),
      ...backup.cvs.map((cv) => cv.created_at),
      ...backup.analyses.map((analysis) => analysis.created_at),
      workflowRow().updated_at,
    ];
    for (const stamp of stamps) {
      const at = new Date(stamp).getTime();
      expect(at).toBeLessThanOrEqual(NOW.getTime());
      expect(NOW.getTime() - at).toBeLessThan(30 * DAY_MS);
    }
  });
});

describe('the started job’s Tailor draft (L-363)', () => {
  it('is written with the exact statement the app writes a job’s Tailor work with', async () => {
    expect(JOB_WORKFLOW_UPSERT).toBe(upsertInto('job_workflow'));
    expect(await allApprovedSql()).toContain(JOB_WORKFLOW_UPSERT);
  });

  it('negative: a statement off the approved list would be refused, so the clean-up one is on it', async () => {
    expect(await allApprovedSql()).toContain(CV_DELETE);
  });

  it('reads back the way Tailor reads it at launch: the draft, the CV and the job’s own advert', () => {
    const session = fromRow(workflowRow());
    expect(session.result).not.toBeNull();
    expect(session.cvId).toBe(STARTED_CV_ID);
    expect(session.result?.cvId).toBe(STARTED_CV_ID);
    // The job's own advert, so the screen does not say "edited".
    const [job] = imported().jobs;
    if (job === undefined) throw new Error('no job');
    expect(session.advert).toBe(jobAdvertText(job));
    expect(job.title).toBe(STARTED_JOB_TITLE);
  });

  it('is byte for byte what the app writes back for that session', () => {
    const row = workflowRow();
    expect(toRow(row.id, fromRow(row), row.updated_at)).toEqual(row);
  });

  it('its text and fabrication report are what the app works out from the CV it was written from', () => {
    const result = fromRow(workflowRow()).result;
    if (result === null) throw new Error('no draft');
    expect(result.text).toBe(renderTailoredCv(result.cv, null));
    expect(result.report).toEqual(checkFabrication(STARTED_CV_TEXT, result.cv, []));
    expect(result.report.clean).toBe(true);
    expect(result.userMetrics).toEqual([]);
  });
});

describe('the no-network guard the smoke job applies (L-363)', () => {
  it('reads the request counter under the key the app counts with', () => {
    expect(REQUEST_COUNT_KEY).toBe(REQUEST_LOG_STORAGE_KEY);
  });

  it('forbids only commands the app really registers — a misspelt name would guard nothing', () => {
    const lib = readFileSync(
      join(REPO_ROOT, 'apps', 'light', 'src-tauri', 'src', 'lib.rs'),
      'utf8',
    );
    const handler = lib.slice(lib.indexOf('generate_handler!['));
    const registered = new Set(
      [...handler.slice(0, handler.indexOf(']')).matchAll(/::(\w+)/g)].map((match) => match[1]),
    );
    expect(registered.size).toBeGreaterThan(10);
    for (const command of NETWORK_COMMANDS) expect(registered).toContain(command);
  });

  it('forbids every command the AI transport sends a chat or a model list with', () => {
    const transport = readFileSync(
      join(REPO_ROOT, 'apps', 'light', 'src', 'ai', 'transport.ts'),
      'utf8',
    );
    const named = [...transport.matchAll(/_COMMAND = '(\w+)'/g)].map((match) => match[1]);
    expect(named.length).toBeGreaterThan(3);
    // The loopback probe is the one exception, and the reason is in the file.
    for (const command of named.filter((name) => name !== 'ollama_probe')) {
      expect(NETWORK_COMMANDS).toContain(command);
    }
  });
});
