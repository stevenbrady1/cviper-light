/**
 * One canonical privacy-policy URL, spelled the same way everywhere it is
 * named — and no doc claiming Fetch never loads a page.
 *
 * ============================================================================
 * WHY THIS EXISTS: TWO SPELLINGS RESOLVE TODAY, WHICH IS DRIFT WAITING TO HAPPEN
 * ============================================================================
 * `https://cviper.ai/privacy/` is the address this app actually ships —
 * `CVIPER_PRIVACY_URL` in `features/signposts/links.ts`, since L-114. A
 * `/light/privacy` path on the same site is a live forwarder to it, kept
 * alive on the website on purpose. Both resolve today, so nothing 404s — but
 * `docs/STORE-SUBMISSION.md` itself calls a wrong policy URL one of the
 * slowest store failures to resolve, and a docs tree naming two spellings is
 * one careless edit away from that. Nothing scanned `docs/` for this before
 * now (L-138).
 *
 * This is a lexical scan, not a link checker: it fetches nothing. It insists
 * every mention of the address — in docs (comments included: a stale URL in
 * a comment still misleads the next reader) and in shipped `.ts`/`.tsx`
 * (comments and string literals both) — is spelled exactly as the one
 * constant that is actually shipped.
 *
 * ============================================================================
 * THE SECOND CHECK: "NEVER LOADS A PAGE ITSELF" IS FALSE
 * ============================================================================
 * `fetch_job_page` is registered unconditionally in `src-tauri/src/lib.rs`,
 * so Fetch ships on every platform, iOS included, and the app DOES load one
 * page the user asks for — on request, no credentials, private addresses
 * refused (see the `fetched-advert` entry in `lib/outbound-hosts.ts`). A doc
 * that says the app "never loads a page itself" is describing a build that
 * does not exist. This guard reads `lib.rs` to confirm the premise still
 * holds, then forbids the phrase under `docs/`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CVIPER_PRIVACY_URL } from '../features/signposts/links.ts';
import { REPO_ROOT, displayPath, walk } from './repo-scan.ts';

/**
 * Any privacy-policy-shaped address under the cviper.ai domain, with or
 * without a scheme, with or without the `/light` segment, with or without a
 * trailing slash — every spelling seen in this repository's history. Stops
 * at the first character that cannot appear in the canonical URL (a
 * backtick, quote, space, parenthesis, or sentence-ending period), so a
 * match is exactly the substring a reader would read as "the URL".
 */
const POLICY_URL_PATTERN = /(?:https?:\/\/)?cviper\.ai\/[\w/-]*privacy[\w/-]*/g;

const FORBIDDEN_PHRASE = 'never loads a page itself';

const DOC_FILES = [
  ...walk(join(REPO_ROOT, 'docs'), { extensions: ['.md'], excludeTests: false }),
  join(REPO_ROOT, 'README.md'),
  ...walk(join(REPO_ROOT, 'apps/light/src-tauri'), { extensions: ['.md'], excludeTests: false }),
];

const CODE_FILES = walk(join(REPO_ROOT, 'apps/light/src'), {
  extensions: ['.ts', '.tsx'],
  excludeTests: false,
});

const SCANNED_FILES = [...DOC_FILES, ...CODE_FILES];

interface UrlMatch {
  readonly file: string;
  readonly line: number;
  readonly found: string;
}

/** Every policy-URL-shaped literal in a file, with its 1-based line number. */
function urlMatchesIn(path: string): UrlMatch[] {
  const text = readFileSync(path, 'utf8');
  return [...text.matchAll(POLICY_URL_PATTERN)].map((match) => ({
    file: displayPath(path),
    line: text.slice(0, match.index).split('\n').length,
    found: match[0],
  }));
}

const ALL_MATCHES: UrlMatch[] = SCANNED_FILES.flatMap((file) => urlMatchesIn(file));

const MISMATCHES = ALL_MATCHES.filter((match) => match.found !== CVIPER_PRIVACY_URL);

describe('one canonical privacy-policy URL', () => {
  it('scans a real tree', () => {
    // Anti-inert: an empty walk would make "finds none" vacuously true.
    // `links.ts` itself and `docs/STORE-SUBMISSION.md` must both be in scope.
    expect(ALL_MATCHES.length).toBeGreaterThanOrEqual(3);
    expect(DOC_FILES.length).toBeGreaterThan(5);
    expect(SCANNED_FILES.some((file) => file.endsWith('STORE-SUBMISSION.md'))).toBe(true);
    expect(SCANNED_FILES.some((file) => file.endsWith('links.ts'))).toBe(true);
  });

  it('is the address this app actually ships', () => {
    expect(CVIPER_PRIVACY_URL).toBe('https://cviper.ai/privacy/');
  });

  it('names every mention the same way', () => {
    expect(
      MISMATCHES,
      'Every entry below names the privacy policy under a spelling other than ' +
        `${CVIPER_PRIVACY_URL} — the address CVIPER_PRIVACY_URL actually ships. ` +
        'Fix the doc, do not add a second URL.',
    ).toEqual([]);
  });
});

describe('the "never loads a page itself" claim', () => {
  it('fetch_job_page really is registered (the premise this guard protects)', () => {
    const libRs = readFileSync(join(REPO_ROOT, 'apps/light/src-tauri/src/lib.rs'), 'utf8');
    expect(libRs).toContain('fetch_job_page');
  });

  it('no doc claims the app never loads a page itself', () => {
    const offenders = DOC_FILES.map((file) => ({
      file: displayPath(file),
      text: readFileSync(file, 'utf8'),
    }))
      .filter(({ text }) => text.includes(FORBIDDEN_PHRASE))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});
