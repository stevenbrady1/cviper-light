/**
 * The words the user sees when a backup goes right, and when it does not.
 *
 * ============================================================================
 * WHY EVERY ERROR CODE GETS ITS OWN SENTENCE
 * ============================================================================
 * A backup file is the user's only copy of months of work. When one will not
 * import, "invalid file" is the worst possible answer: it does not say whether
 * the file is broken, whether it is somebody else's, or whether this build is
 * simply too old to read it — and those have completely different next steps.
 * The last of those is the one people actually hit, which is why
 * `SCHEMA_VERSION_TOO_NEW` has a test of its own.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  APP_NAME,
  APP_VERSION,
  BACKUP_ERROR_CODES,
  defaultBackupFilename,
  describeBackupError,
  describeCounts,
} from './backup';

describe('the app stamp on an exported file', () => {
  it('matches the version in package.json', () => {
    // The stamp is metadata a human reads when staring at a JSON file, and
    // nothing branches on it (see the warning on BACKUP_SCHEMA_VERSION). It
    // still has to be TRUE, and a hand-written constant drifts silently.
    const manifest = JSON.parse(
      readFileSync(fileURLToPath(new URL('../../../package.json', import.meta.url)), 'utf8'),
    ) as { name: string; version: string };

    expect(APP_VERSION).toBe(manifest.version);
    expect(APP_NAME).toBe('cviper-light');
  });
});

describe('defaultBackupFilename', () => {
  it('is dated, so a folder of backups sorts itself', () => {
    expect(defaultBackupFilename(new Date(2026, 7, 19, 9, 0, 0))).toBe(
      'cviper-backup-2026-08-19.json',
    );
  });

  it('boundary: pads single-digit months and days', () => {
    expect(defaultBackupFilename(new Date(2026, 0, 5, 9, 0, 0))).toBe(
      'cviper-backup-2026-01-05.json',
    );
  });

  it('uses the local calendar date, not UTC', () => {
    // A user in Sydney saving at 09:00 on the 19th must not get a file named
    // the 18th. `toISOString().slice(0, 10)` would do exactly that.
    const local = new Date(2026, 7, 19, 9, 0, 0);
    expect(defaultBackupFilename(local)).toContain(String(local.getFullYear()));
    expect(defaultBackupFilename(local)).toBe('cviper-backup-2026-08-19.json');
  });
});

describe('describeCounts', () => {
  it('lists everything the file holds, in plain words', () => {
    expect(describeCounts({ jobs: 43, applications: 12, cvs: 2, analyses: 7 })).toBe(
      '43 jobs, 12 applications, 2 CVs and 7 past checks',
    );
  });

  it('gets the singulars right', () => {
    expect(describeCounts({ jobs: 1, applications: 1, cvs: 1, analyses: 1 })).toBe(
      '1 job, 1 application, 1 CV and 1 past check',
    );
  });

  it('leaves out what is not there', () => {
    expect(describeCounts({ jobs: 3, applications: 0, cvs: 1, analyses: 0 })).toBe(
      '3 jobs and 1 CV',
    );
  });

  it('boundary: an empty file says so rather than producing an empty sentence', () => {
    // A real case: somebody exports before they have entered anything, then
    // imports it later wondering why nothing happened.
    expect(describeCounts({ jobs: 0, applications: 0, cvs: 0, analyses: 0 })).toBe(
      'nothing at all',
    );
  });

  it('boundary: a single category needs no comma and no "and"', () => {
    expect(describeCounts({ jobs: 0, applications: 0, cvs: 4, analyses: 0 })).toBe('4 CVs');
  });
});

describe('describeBackupError', () => {
  it('has a specific headline for every code, and none of them say "invalid file"', () => {
    // Exhaustive by construction: `BACKUP_ERROR_CODES` is the full union and
    // the map is keyed by it, so a new code added upstream is a compile error
    // here as well as a failure below.
    for (const code of BACKUP_ERROR_CODES) {
      const problem = describeBackupError({ code, message: 'upstream detail', path: null });

      expect(problem.headline.length, code).toBeGreaterThan(10);
      expect(problem.headline.toLowerCase(), code).not.toContain('invalid file');
      expect(problem.headline.toLowerCase(), code).not.toContain('error');
    }
  });

  it('gives every code a DIFFERENT headline', () => {
    // Five codes sharing one sentence is the same as having one code.
    const headlines = BACKUP_ERROR_CODES.map(
      (code) => describeBackupError({ code, message: '', path: null }).headline,
    );

    expect(new Set(headlines).size).toBe(BACKUP_ERROR_CODES.length);
  });

  it('says a file from the future came from a NEWER app, not that it is broken', () => {
    const problem = describeBackupError({
      code: 'SCHEMA_VERSION_TOO_NEW',
      message:
        'This backup was written in format version 2, but this build of CViper Light ' +
        'understands version 1. Update the app, then import it again.',
      path: 'schemaVersion',
    });

    expect(problem.headline).toContain('newer version');
    // The next step, spelled out: update, then try again. And explicitly NOT
    // "the file is damaged", which would send somebody to delete their backup.
    expect(`${problem.headline} ${problem.detail}`).toContain('Update');
    expect(problem.headline.toLowerCase()).not.toContain('damaged');
    expect(problem.headline.toLowerCase()).not.toContain('corrupt');
  });

  it('says nothing was imported when a record was bad, because nothing was', () => {
    const problem = describeBackupError({
      code: 'INVALID_RECORD',
      message: 'applications[3] could not be read',
      path: 'applications[3].status',
    });

    expect(`${problem.headline} ${problem.detail}`).toContain('Nothing has been imported');
  });

  it('keeps the upstream detail, because it names the record that broke', () => {
    const problem = describeBackupError({
      code: 'INVALID_RECORD',
      message: 'applications[3] could not be read',
      path: 'applications[3].status',
    });

    expect(problem.detail).toContain('applications[3]');
  });

  it('boundary: an upstream message that is empty still leaves a usable sentence', () => {
    const problem = describeBackupError({ code: 'MALFORMED_JSON', message: '', path: null });

    expect(problem.headline.length).toBeGreaterThan(10);
    expect(problem.detail.length).toBeGreaterThan(10);
  });
});
