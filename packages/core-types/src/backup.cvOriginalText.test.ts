/**
 * L-218: a corrected CV's original text goes into a backup and comes back;
 * a CV that was never corrected is written exactly as before, and an older
 * file (no `original_text` anywhere) imports as "never corrected".
 */
import { describe, expect, it } from 'vitest';

import { BACKUP_SCHEMA_VERSION, exportBackup, importBackup, type BackupPayload } from './backup';
import { type Cv } from './entities';

const PLAIN: Cv = {
  id: 'cv-plain',
  name: 'Plain.docx',
  file_path: null,
  extracted_text: 'As read from the file.',
  created_at: '2026-08-01T09:00:00.000Z',
  json_resume: null,
};

const CORRECTED: Cv = {
  ...PLAIN,
  id: 'cv-fixed',
  name: 'Fixed.pdf',
  extracted_text: 'Corrected — Zoë, 2019-2024.',
  original_text: 'Misread 20192024',
};

function payload(cvs: Cv[]): BackupPayload {
  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: '2026-10-08T09:00:00.000Z',
    app: { name: 'cviper-light', version: '0.7.1' },
    profile: null,
    documents: [],
    interview_substages: [],
    jobs: [],
    applications: [],
    cvs,
    analyses: [],
  };
}

function cvsIn(text: string): Record<string, unknown>[] {
  return (JSON.parse(text) as { cvs: Record<string, unknown>[] }).cvs;
}

describe('backups and corrected CVs (L-218)', () => {
  it('happy: a corrected CV keeps both texts through export and import', () => {
    const back = importBackup(exportBackup(payload([CORRECTED])));
    expect(back.ok && back.value.cvs).toEqual([CORRECTED]);
  });

  it('a CV that was never corrected is written as null, and reads back with no key at all', () => {
    const written = cvsIn(exportBackup(payload([PLAIN])));
    expect(written[0]?.['original_text']).toBeNull();
    const back = importBackup(exportBackup(payload([PLAIN])));
    expect(back.ok && back.value.cvs).toEqual([PLAIN]);
  });

  it('boundary: an empty original (the file gave no text) is kept, not dropped', () => {
    const typed: Cv = { ...CORRECTED, original_text: '' };
    expect(cvsIn(exportBackup(payload([typed])))[0]?.['original_text']).toBe('');
    const back = importBackup(exportBackup(payload([typed])));
    expect(back.ok && back.value.cvs[0]?.original_text).toBe('');
  });

  it('negative: a file from before L-218 imports, every CV as never corrected', () => {
    const old = JSON.parse(exportBackup(payload([PLAIN]))) as Record<string, unknown>;
    const back = importBackup(old);
    expect(back.ok).toBe(true);
    expect(back.ok ? (back.value.cvs[0]?.original_text ?? null) : 'failed').toBeNull();
  });

  it('negative: an original_text that is not text is refused, not guessed at', () => {
    const bad = JSON.parse(exportBackup(payload([CORRECTED]))) as {
      cvs: Record<string, unknown>[];
    };
    bad.cvs[0]!['original_text'] = 42;
    expect(importBackup(bad).ok).toBe(false);
  });
});
