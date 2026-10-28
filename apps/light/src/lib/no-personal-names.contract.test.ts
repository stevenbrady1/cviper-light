/**
 * L-298 — no personal name in the repository, outside the files that must
 * carry one.
 *
 * The owner asked for the app, its source, its test data and its docs to name
 * no person: generic wording ("the CViper team", "the owner") instead, and
 * invented names in test CVs. This guard keeps it that way.
 *
 * ============================================================================
 * WHY HASHES, NOT THE WORDS
 * ============================================================================
 * A guard that lists the names in plain text would itself be the one file
 * that names the person. So it lists SHA-256 hashes of the banned words, and
 * hashes every word it reads. It is a speed bump, not a secret: the words are
 * short, and the account name is in every GitHub URL anyway (see below).
 *
 * ============================================================================
 * ALLOWED, EACH FOR A REASON
 * ============================================================================
 *   - The Store manifest: `PublisherDisplayName` must equal what Partner
 *     Center shows, character for character, or the package is refused.
 *     Changing it is a Partner Center change first.
 *   - The privacy policy (its in-app copy, the document it is published from,
 *     and the tests that pin it): UK GDPR Art. 13 asks a privacy notice to
 *     name the controller. Whether a sole trader can drop the name is the
 *     owner's call, with legal advice — not a find-and-replace.
 *   - The msix contract test, which pins the manifest's display name.
 *
 * NOT covered, because code cannot change them: the GitHub account name in
 * every repository URL (including the updater endpoint, which installed
 * copies poll), the Apple signing certificate, and git history.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT, displayPath, walk } from './repo-scan.ts';

/** SHA-256 of each banned word, lower case. */
const BANNED: ReadonlySet<string> = new Set([
  'c7c084318b6f1bece6f74ffce1ea53596070345272dee8040037497c7d4cbffe',
  'f148389d080cfe85952998a8a367e2f7eaf35f2d72d2599a5b0412fe4094d65c',
  '3b9b05c720497601bfacaf66e58e8e37e3545ea9ab671665ad2e72e483c4872f',
  'e745dadf1d8de32bce89880a3a05968436b16de3c99040c7958fddff2b5d75d2',
]);

const ALLOWED: ReadonlySet<string> = new Set([
  'apps/light/src-tauri/msix/Package.appxmanifest',
  'docs/app-store/privacy-policy.md',
  'apps/light/src/features/settings/privacy/policyDocument.ts',
  'apps/light/src/features/settings/privacy/policyDocument.sections.contract.test.ts',
  'apps/light/src/lib/msix-store-build.contract.test.ts',
]);

const EXTENSIONS = [
  '.ts',
  '.tsx',
  '.rs',
  '.md',
  '.json',
  '.html',
  '.css',
  '.yml',
  '.yaml',
  '.toml',
  '.txt',
  '.nsi',
  '.appxmanifest',
  '.plist',
  '.sh',
  '.py',
];

const sha256 = (word: string): string => createHash('sha256').update(word).digest('hex');

/**
 * Every banned word in `text`, as `line:word`. A word is a run of letters and
 * digits, so the account name in a URL (letters then a digit) is one word of
 * its own and is not a banned one. A string escape (`\n`, `\t`, `\r`) is read
 * as the space it stands for: without that, a sign-off written as
 * `'Yours sincerely,\nName'` hid the name inside the word "nname".
 */
export function personalNames(text: string, banned: ReadonlySet<string> = BANNED): string[] {
  const found: string[] = [];
  text.split('\n').forEach((line, index) => {
    const unescaped = line.replace(/\\[ntr]/g, ' ');
    for (const word of unescaped.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
      if (banned.has(sha256(word))) found.push(`${index + 1}:${word}`);
    }
  });
  return found;
}

function scannedFiles(): string[] {
  const files = walk(REPO_ROOT, { extensions: EXTENSIONS, excludeTests: false }).filter(
    (path) => !displayPath(path).endsWith('pnpm-lock.yaml'),
  );
  return [...files, join(REPO_ROOT, 'LICENSE')];
}

describe('no personal names (L-298)', () => {
  it('no file outside the allowed list names a person', () => {
    const files = scannedFiles();
    expect(files.length).toBeGreaterThan(500);
    const offences = files
      .filter((path) => !ALLOWED.has(displayPath(path)))
      .flatMap((path) =>
        personalNames(readFileSync(path, 'utf8')).map((hit) => `${displayPath(path)}:${hit}`),
      );
    expect(offences).toEqual([]);
  });

  it('every allowed file still exists, so an allowance cannot outlive its reason', () => {
    for (const rel of ALLOWED) {
      expect(() => readFileSync(join(REPO_ROOT, rel)), rel).not.toThrow();
    }
  });
});

describe('the guard itself', () => {
  // The banned words are only known by hash, so these tests build them from
  // the hash list rather than spelling them out.
  it('has four banned words, none of them empty', () => {
    expect(BANNED.size).toBe(4);
    expect(BANNED.has(sha256(''))).toBe(false);
  });

  // NEGATIVE — an ordinary invented name and a town are not caught.
  it('negative: invented names and look-alike words pass', () => {
    expect(personalNames('Alex Morgan CV.pdf, Stevenage, Steventon, Bradyville')).toEqual([]);
  });

  // A stand-in banned list, so the matching can be tested without spelling
  // out the real words.
  const STAND_IN = new Set([sha256('zebedee')]);

  it('negative: a banned word is caught whatever its case or punctuation', () => {
    expect(personalNames('Made by ZEBEDEE.', STAND_IN)).toEqual(['1:zebedee']);
    expect(personalNames('first\n(zebedee)', STAND_IN)).toEqual(['2:zebedee']);
    // The escape as it is written in source, a backslash then n.
    expect(personalNames(String.raw`'Yours sincerely,\nZebedee'`, STAND_IN)).toEqual(['1:zebedee']);
  });

  // BOUNDARY — a banned word inside a longer word, or joined to a digit as in
  // an account name, is a different word.
  it('boundary: a banned word inside a longer word or an account name is not caught', () => {
    expect(personalNames('zebedees zebedee1 github.com/zebedee2/repo', STAND_IN)).toEqual([]);
  });
});
