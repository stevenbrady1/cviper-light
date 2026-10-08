/**
 * Every Store upload is recorded, and the next one must be higher (L-170).
 *
 * The L-168 guard pins the manifest to `tauri.conf.json`: EQUAL. The Store
 * wants something else — each upload STRICTLY GREATER than every version it
 * has been sent. Equality alone would demand a Store-fatal value after a
 * rollback (the app version reverted to one already uploaded) or a
 * resubmission (the same version sent again after a rejected upload).
 *
 * So uploads are written down in `store-submissions.json`, and two checks
 * read it:
 *   - every commit: the record is well formed and in order, and the app
 *     version is NEVER BELOW the last upload — a rollback fails here, in
 *     `pnpm test`, the day it is made;
 *   - pack time (`msix.yml`): the manifest about to be packed is STRICTLY
 *     ABOVE the last upload — the same version cannot be packed twice for
 *     submission.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from '../lib/repo-scan.ts';

import { expectedManifestVersion } from './appxManifestVersion.ts';
import {
  SUBMISSIONS_PATH,
  checkForPacking,
  checkPackAboveSubmissions,
  checkAppNotBelowSubmissions,
  compareManifestVersions,
  parseSubmissions,
} from './storeSubmissions.ts';

const read = (path: string) => readFileSync(join(REPO_ROOT, path), 'utf8');

const record = (...versions: string[]) =>
  JSON.stringify({
    submissions: versions.map((version, index) => ({
      version,
      date: `2026-10-${String(10 + index).padStart(2, '0')}`,
    })),
  });

function parsed(json: string) {
  const result = parseSubmissions(json);
  if (!result.ok) throw new Error(result.problems.join('\n'));
  return result.submissions;
}

// ── The real files ──────────────────────────────────────────────────────────

describe('the real record (every commit)', () => {
  it('is well formed and in order', () => {
    const result = parseSubmissions(read(SUBMISSIONS_PATH));
    expect(result.ok ? [] : result.problems).toEqual([]);
  });

  it('the app version is never below the last Store upload — a rollback fails here', () => {
    const appVersion = (
      JSON.parse(read('apps/light/src-tauri/tauri.conf.json')) as {
        version: string;
      }
    ).version;
    const submissions = parsed(read(SUBMISSIONS_PATH));
    expect(checkAppNotBelowSubmissions(expectedManifestVersion(appVersion), submissions)).toEqual(
      [],
    );
  });
});

// ── The rules ───────────────────────────────────────────────────────────────

describe('compareManifestVersions', () => {
  it('compares as numbers, segment by segment — 0.10 is above 0.9', () => {
    expect(compareManifestVersions('0.10.0.0', '0.9.0.0')).toBe(1);
    expect(compareManifestVersions('1.0.0.0', '0.65535.65535.0')).toBe(1);
    expect(compareManifestVersions('0.6.1.0', '0.6.1.0')).toBe(0);
    expect(compareManifestVersions('0.6.0.0', '0.6.1.0')).toBe(-1);
  });
});

describe('parseSubmissions', () => {
  it('happy: no uploads yet, and a record of two', () => {
    expect(parsed(record())).toEqual([]);
    expect(parsed(record('0.6.0.0', '0.7.0.0')).map((entry) => entry.version)).toEqual([
      '0.6.0.0',
      '0.7.0.0',
    ]);
  });

  it('negative: not JSON, or no submissions list, is refused', () => {
    expect(parseSubmissions('{').ok).toBe(false);
    expect(parseSubmissions('[]').ok).toBe(false);
    expect(parseSubmissions(JSON.stringify({ submissions: {} })).ok).toBe(false);
  });

  it('negative: a version the Store would not take is refused, with the reason', () => {
    for (const bad of ['0.6.0', '0.6.0.1', '0.06.0.0', '0.65536.0.0', 'v0.6.0.0', '']) {
      const result = parseSubmissions(record(bad));
      expect(result.ok, bad).toBe(false);
      if (!result.ok) expect(result.problems.join(' '), bad).toContain(SUBMISSIONS_PATH);
    }
  });

  it('boundary: the largest segment MSIX can hold is accepted', () => {
    expect(parsed(record('65535.65535.65535.0'))).toHaveLength(1);
  });

  it('negative: a date that is not YYYY-MM-DD is refused', () => {
    const bad = JSON.stringify({ submissions: [{ version: '0.6.0.0', date: '10/10/2026' }] });
    expect(parseSubmissions(bad).ok).toBe(false);
  });

  it('negative: a record out of order, or with the same version twice, is refused', () => {
    expect(parseSubmissions(record('0.7.0.0', '0.6.0.0')).ok).toBe(false);
    expect(parseSubmissions(record('0.6.0.0', '0.6.0.0')).ok).toBe(false);
  });
});

describe('every commit: the app version is never below the last upload', () => {
  const submissions = parsed(record('0.5.0.0', '0.6.0.0'));

  it('happy: above it, or no uploads yet', () => {
    expect(checkAppNotBelowSubmissions('0.7.0.0', submissions)).toEqual([]);
    expect(checkAppNotBelowSubmissions('0.1.0.0', [])).toEqual([]);
  });

  it('boundary: EQUAL is fine at commit time — the version just uploaded', () => {
    expect(checkAppNotBelowSubmissions('0.6.0.0', submissions)).toEqual([]);
  });

  it('negative: a rollback below the last upload is named', () => {
    const problems = checkAppNotBelowSubmissions('0.5.1.0', submissions);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('0.5.1.0');
    expect(problems[0]).toContain('0.6.0.0');
  });
});

describe('pack time: the manifest is strictly above the last upload', () => {
  const submissions = parsed(record('0.6.0.0'));

  it('happy: above it, or no uploads yet', () => {
    expect(checkPackAboveSubmissions('0.6.1.0', submissions)).toEqual([]);
    expect(checkPackAboveSubmissions('0.6.0.0', [])).toEqual([]);
  });

  it('negative: the SAME version again — a resubmission — is refused, and says to bump', () => {
    const problems = checkPackAboveSubmissions('0.6.0.0', submissions);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/bump/i);
  });

  it('negative: a LOWER version — a rollback — is refused', () => {
    expect(checkPackAboveSubmissions('0.5.9.0', submissions)).toHaveLength(1);
  });
});

describe('checkForPacking: the L-169 check and the L-170 check together', () => {
  const manifest = (version: string) =>
    `<Package><Identity Name="StBr.CViperLight" Version="${version}" /></Package>`;
  const input = (version: string, submissionsJson: string) => ({
    manifestXml: manifest(version),
    tauriConfJson: JSON.stringify({ version: '0.7.0' }),
    storeConfJson: JSON.stringify({ bundle: {} }),
    submissionsJson,
  });

  it('happy: matches the app and is above every upload', () => {
    expect(checkForPacking(input('0.7.0.0', record('0.6.0.0')))).toEqual({
      ok: true,
      appVersion: '0.7.0',
      manifestVersion: '0.7.0.0',
      lastSubmitted: '0.6.0.0',
    });
  });

  it('negative: matches the app but that version was already uploaded', () => {
    const verdict = checkForPacking(input('0.7.0.0', record('0.6.0.0', '0.7.0.0')));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.problems.join(' ')).toContain(SUBMISSIONS_PATH);
  });

  it('negative: a broken record stops the pack — it never reads as "no uploads"', () => {
    const verdict = checkForPacking(input('0.7.0.0', '{ not json'));
    expect(verdict.ok).toBe(false);
  });

  it('every problem is listed at once: a version mismatch AND a broken record', () => {
    const verdict = checkForPacking(input('0.6.0.0', '[]'));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.problems.length).toBeGreaterThanOrEqual(2);
  });
});
