import { describe, expect, it } from 'vitest';

import { BACKUP_SCHEMA_VERSION, exportBackup, importBackup, type BackupPayload } from './backup';

/**
 * L-133: `cvs.file_path` is a path on the machine that wrote the export —
 * typically `C:\Users\<name>\...` on Windows — and the privacy notice
 * described this row only as "Your jobs, applications, CV text and every
 * analysis", saying nothing about the path or the username buried in it. A
 * backup shared with anyone (a support request, a house move to a new PC)
 * leaked that.
 *
 * The format is additive-only (see the header of backup.ts): the field
 * cannot be removed. So `exportBackup` keeps writing the key, but the VALUE
 * is always `null`, regardless of what the source `Cv` carries. Reading the
 * path back in is unaffected — the internal database keeps it for opening
 * the file locally — only what leaves the machine in an export changes.
 *
 * `backup.compat.test.ts` is the sibling for `json_resume`, the first field
 * ever added after v1 shipped; this file follows the same shape for the
 * field whose contract just changed the other way — present, but nulled.
 */

const BASE: Omit<BackupPayload, 'cvs'> = {
  schemaVersion: BACKUP_SCHEMA_VERSION,
  exportedAt: '2026-09-13T10:00:00.000Z',
  app: { name: 'cviper-light', version: '0.1.0' },
  jobs: [],
  applications: [],
  analyses: [],
};

const CV_WITH_PATH = {
  id: 'cv-1',
  name: 'Risk CV.pdf',
  file_path: 'C:\\Users\\steve\\Documents\\Risk CV.pdf',
  extracted_text: 'Some text',
  created_at: '2026-08-10T07:15:00.000Z',
  json_resume: null,
};

describe('exporting cvs.file_path (L-133)', () => {
  it('negative: a new export never carries a real path or the Windows username inside it', () => {
    // Two CVs, so the guard cannot pass by accident on a single lucky row —
    // one has a path with a username, the other never had one at all.
    const exported = exportBackup({
      ...BASE,
      cvs: [
        CV_WITH_PATH,
        { ...CV_WITH_PATH, id: 'cv-2', name: 'Cover letter.pdf', file_path: null },
      ],
    });

    expect(exported).not.toContain('C:\\Users\\steve');
    expect(exported).not.toContain('\\steve\\');

    const reimported = importBackup(exported);
    expect(reimported.ok).toBe(true);
    if (!reimported.ok) return;
    for (const cv of reimported.value.cvs) {
      expect(cv.file_path, cv.id).toBeNull();
    }
  });

  it('boundary: a CV that never had a path exports and imports the same way as one that did', () => {
    const withPath = exportBackup({ ...BASE, cvs: [CV_WITH_PATH] });
    const withoutPath = exportBackup({ ...BASE, cvs: [{ ...CV_WITH_PATH, file_path: null }] });

    // Same shape either way: the field the reader never had is written no
    // differently from the field that was deliberately emptied.
    expect(withPath).toBe(withoutPath);
  });

  it('an OLDER backup that carries a real path still imports, and the CV stays usable', () => {
    // Written by a build before this fix. The format promises this keeps
    // working forever, and the fix must not turn that promise into "unless
    // it happens to name a path".
    const olderExport = JSON.stringify({ ...BASE, cvs: [CV_WITH_PATH] }, null, 2);

    const imported = importBackup(olderExport);
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;

    const cv = imported.value.cvs[0];
    expect(cv?.file_path).toBe('C:\\Users\\steve\\Documents\\Risk CV.pdf');
    expect(cv?.extracted_text).toBe('Some text');
    expect(cv?.name).toBe('Risk CV.pdf');
  });
});
