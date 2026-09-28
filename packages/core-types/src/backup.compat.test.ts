import { describe, expect, it } from 'vitest';

import { BACKUP_SCHEMA_VERSION, exportBackup, importBackup, type BackupPayload } from './backup';
import { type Job } from './entities';

/**
 * `cvs.json_resume` (L-20b) is the first field added to the format after v1
 * shipped. Additive, so the version stays 1: a backup written before the field
 * existed must still import, and one written after must carry it through.
 */

const BASE: Omit<BackupPayload, 'cvs'> = {
  schemaVersion: BACKUP_SCHEMA_VERSION,
  exportedAt: '2026-09-08T10:00:00.000Z',
  app: { name: 'cviper-light', version: '0.1.0' },
  profile: null,
  jobs: [],
  applications: [],
  documents: [],
  analyses: [],
};

const OLD_CV = {
  id: 'cv-1',
  name: 'CV.pdf',
  file_path: null,
  extracted_text: 'Some text',
  created_at: '2026-08-10T07:15:00.000Z',
};

describe('backups and cvs.json_resume', () => {
  it('an old backup without the field imports with json_resume null', () => {
    const imported = importBackup(JSON.stringify({ ...BASE, cvs: [OLD_CV] }));
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.value.cvs[0]?.json_resume).toBeNull();
    // And nothing was mistaken for an unknown extra field.
    expect(imported.value.cvs[0]?.__extra).toBeUndefined();
  });

  it('a new export carries the original text, and it survives a round trip', () => {
    const original = '{"basics":{"name":"Steve"}}\n';
    const exported = exportBackup({
      ...BASE,
      cvs: [{ ...OLD_CV, name: 'CV.json', json_resume: original }],
    });
    expect(exported).toContain('"json_resume"');

    const back = importBackup(exported);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.value.cvs[0]?.json_resume).toBe(original);
  });

  it('negative: a json_resume that is not text or null is refused', () => {
    const imported = importBackup(
      JSON.stringify({ ...BASE, cvs: [{ ...OLD_CV, json_resume: 7 }] }),
    );
    expect(imported.ok).toBe(false);
    if (imported.ok) return;
    expect(imported.error.path).toContain('cvs[0]');
  });
});

const LEGACY_JOB = {
  id: 'job-legacy',
  source: 'manual' as const,
  external_id: null,
  title: 'Credit Risk Analyst',
  company: 'Lloyds Banking Group',
  location: null,
  salary_min: null,
  salary_max: null,
  salary_currency: null,
  salary_period: null,
  description: null,
  url: null,
  posted_date: null,
  created_at: '2026-08-19T09:00:00.000Z',
};

describe('backups and jobs.agency', () => {
  it('imports an old job without agency as null and exports it again', () => {
    const oldBackup = { ...BASE, cvs: [], jobs: [LEGACY_JOB] };
    const imported = importBackup(JSON.stringify(oldBackup));
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.value.jobs[0]?.agency).toBeNull();

    const roundTrip = importBackup(exportBackup(imported.value));
    expect(roundTrip.ok).toBe(true);
    if (!roundTrip.ok) return;
    expect(roundTrip.value.jobs[0]?.agency).toBeNull();
  });

  it('preserves distinct agency and hiring company names through export and import', () => {
    const job: Job = { ...LEGACY_JOB, agency: 'Harrington Search' };
    const exported = exportBackup({ ...BASE, cvs: [], jobs: [job] });
    const imported = importBackup(exported);
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.value.jobs[0]).toMatchObject({
      company: 'Lloyds Banking Group',
      agency: 'Harrington Search',
    });
  });
});
