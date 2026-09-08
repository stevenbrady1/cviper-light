import { describe, expect, it } from 'vitest';

import { BACKUP_SCHEMA_VERSION, exportBackup, importBackup, type BackupPayload } from './backup';

/**
 * `cvs.json_resume` (L-20b) is the first field added to the format after v1
 * shipped. Additive, so the version stays 1: a backup written before the field
 * existed must still import, and one written after must carry it through.
 */

const BASE: Omit<BackupPayload, 'cvs'> = {
  schemaVersion: BACKUP_SCHEMA_VERSION,
  exportedAt: '2026-09-08T10:00:00.000Z',
  app: { name: 'cviper-light', version: '0.1.0' },
  jobs: [],
  applications: [],
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
