/**
 * One canonical privacy-policy URL, spelled the same way everywhere it is
 * named — and no doc or shipped copy claiming Fetch never loads a page.
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
 * a comment still misleads the next reader) and in shipped, non-test
 * `.ts`/`.tsx` (comments and string literals both) — is spelled exactly as
 * the one constant that is actually shipped.
 *
 * ============================================================================
 * THE ESCAPE HATCH: `cviper-allow-legacy-privacy-url: <reason>`
 * ============================================================================
 * A lesson note or a "here is the mistake we made" retrospective legitimately
 * needs to quote the OLD spelling. Rather than make history unwritable, a
 * literal on the SAME LINE as a marker with a non-empty reason is not an
 * offence — same shape as `privacy-promise.contract.test.ts`'s
 * `cviper-allow-absolute-privacy-claim`. A bare marker, or one with an empty
 * reason (`cviper-allow-legacy-privacy-url:` and nothing after the colon),
 * suppresses NOTHING: a reason-less hatch is a silent bypass, which is the
 * exact failure a mandatory reason exists to stop. Example:
 *
 *     <!-- the old, wrong spelling was `cviper.ai/light/privacy` --
 *          cviper-allow-legacy-privacy-url: quoting L-138's own mistake -->
 *
 * ============================================================================
 * THE SECOND CHECK: "NEVER LOADS A PAGE ITSELF" IS FALSE, IN EITHER WORDING
 * ============================================================================
 * `fetch_job_page` is registered unconditionally in `src-tauri/src/lib.rs`,
 * so Fetch ships on every platform, iOS included, and the app DOES load one
 * page the user asks for — on request, no credentials, private addresses
 * refused (see the `fetched-advert` entry in `lib/outbound-hosts.ts`). Two
 * phrasings of the same false claim have shipped in this repository's docs
 * ("never loads a page itself", "does not load pages itself"); both are
 * forbidden, under `docs/` and in shipped code prose alike (comments stripped
 * for code, so a string literal like a Welcome-screen sentence still counts).
 * Matching is whitespace- and case-normalised, so a hard-wrapped sentence
 * split across a line break still trips it — a prettier reflow must never be
 * how this claim quietly becomes true again.
 *
 * The premise itself is re-checked every run, cfg-aware: the registration
 * must survive comment-stripping (not just commented out) AND must not sit
 * behind a `#[cfg(...)]` that excludes iOS — `desktop` excludes it in this
 * repository's own convention (see the updater plugin a few lines above
 * `fetch_job_page` in `lib.rs`), and so does `not(target_os = "ios")` or an
 * `any(...)` gate that never names `"ios"`. The reasoning mirrors
 * `ios-target.contract.test.ts`'s check that the updater plugin IS behind
 * `cfg(desktop)`; this one asserts the opposite property for Fetch.
 *
 * `docs/app-store/privacy-policy.md` is GENERATED (`policyDocument.ts`,
 * `policyDocument.test.ts` keeps it byte-identical to the render). If it
 * ever trips either check here, the fix is in `lib/outbound-hosts.ts` or
 * `policyDocument.ts`, never a hand-edit of the `.md` — the next render
 * would only undo it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CVIPER_PRIVACY_URL } from '../features/signposts/links.ts';
import { REPO_ROOT, displayPath, stripComments, stripRustTests, walk } from './repo-scan.ts';

/**
 * Any privacy-policy-shaped address under the cviper.ai domain, with or
 * without a scheme, with or without the `/light` segment, with or without a
 * trailing slash — every spelling seen in this repository's history. Stops
 * at the first character that cannot appear in the canonical URL (a
 * backtick, quote, space, parenthesis, or sentence-ending period), so a
 * match is exactly the substring a reader would read as "the URL".
 */
const POLICY_URL_PATTERN = /(?:https?:\/\/)?cviper\.ai\/[\w/-]*privacy[\w/-]*/g;

/** Both wordings of the false "Fetch loads nothing" claim that have shipped. */
const FORBIDDEN_PHRASES = ['never loads a page itself', 'does not load pages itself'] as const;

/**
 * The escape hatch for quoting the legacy URL spelling in a lesson note.
 * Group 1 is the reason; a suppression with no reason (undefined, or empty
 * after trimming) suppresses nothing.
 */
const LEGACY_URL_SUPPRESSION = /cviper-allow-legacy-privacy-url:\s*(\S.*)?$/;

/** Files whose own job is to TALK ABOUT the canonical URL, not use it as one. */
const SELF_REFERENTIAL_FILES: ReadonlySet<string> = new Set([
  'apps/light/src/lib/policy-url.contract.test.ts',
  'apps/light/src/features/signposts/Signpost.test.tsx',
]);

const DOC_FILES = [
  ...walk(join(REPO_ROOT, 'docs'), { extensions: ['.md'], excludeTests: false }),
  join(REPO_ROOT, 'README.md'),
  ...walk(join(REPO_ROOT, 'apps/light/src-tauri'), { extensions: ['.md'], excludeTests: false }),
];

// `excludeTests: true` (the default) drops every `*.test.ts(x)` file, which is
// what keeps `Signpost.test.tsx` and this guard's own file out of the code
// leg — SELF_REFERENTIAL_FILES below is belt-and-braces, not the only guard.
const CODE_FILES = walk(join(REPO_ROOT, 'apps/light/src'), {
  extensions: ['.ts', '.tsx'],
}).filter((file) => !SELF_REFERENTIAL_FILES.has(displayPath(file)));

interface UrlMatch {
  readonly file: string;
  readonly line: number;
  readonly found: string;
}

/** Is the URL match on this line covered by a same-line, reasoned suppression? */
function isSuppressed(lineText: string): boolean {
  const match = LEGACY_URL_SUPPRESSION.exec(lineText);
  return match !== null && (match[1] ?? '').trim() !== '';
}

/** Every un-suppressed policy-URL-shaped literal in a file, with its line number. */
function urlMatchesIn(path: string): UrlMatch[] {
  const text = readFileSync(path, 'utf8');
  const lines = text.split('\n');
  return [...text.matchAll(POLICY_URL_PATTERN)]
    .map((match) => ({
      line: text.slice(0, match.index).split('\n').length,
      found: match[0],
    }))
    .filter(({ line }) => !isSuppressed(lines[line - 1] ?? ''))
    .map(({ line, found }) => ({ file: displayPath(path), line, found }));
}

const DOC_MATCHES: UrlMatch[] = DOC_FILES.flatMap((file) => urlMatchesIn(file));
const CODE_MATCHES: UrlMatch[] = CODE_FILES.flatMap((file) => urlMatchesIn(file));
const ALL_MATCHES: UrlMatch[] = [...DOC_MATCHES, ...CODE_MATCHES];

const MISMATCHES = ALL_MATCHES.filter((match) => match.found !== CVIPER_PRIVACY_URL);

describe('one canonical privacy-policy URL', () => {
  it('scans a real tree, with both legs non-trivial', () => {
    // Anti-inert, split by leg on purpose: a bug that emptied just one walk
    // (say, CODE_FILES resolving to nothing) would still leave a combined
    // floor satisfied by the other leg alone, and pass silently.
    expect(DOC_MATCHES.length, 'doc leg').toBeGreaterThanOrEqual(6);
    expect(CODE_MATCHES.length, 'code leg').toBeGreaterThanOrEqual(1);
    expect(DOC_FILES.length).toBeGreaterThan(5);
    expect(DOC_FILES.some((file) => file.endsWith('STORE-SUBMISSION.md'))).toBe(true);
    expect(CODE_FILES.some((file) => file.endsWith('links.ts'))).toBe(true);
  });

  it('is the address this app actually ships', () => {
    expect(CVIPER_PRIVACY_URL).toBe('https://cviper.ai/privacy/');
  });

  it('names every mention the same way', () => {
    expect(
      MISMATCHES,
      'Every entry below names the privacy policy under a spelling other than ' +
        `${CVIPER_PRIVACY_URL} — the address CVIPER_PRIVACY_URL actually ships. ` +
        'Fix the doc, do not add a second URL. Quoting the old spelling on purpose ' +
        '(a lesson note) needs `cviper-allow-legacy-privacy-url: <reason>` on the same line.',
    ).toEqual([]);
  });
});

describe('the Fetch registration is not quietly excluded from iOS', () => {
  const LIB_RS_PATH = join(REPO_ROOT, 'apps/light/src-tauri/src/lib.rs');
  const SHIPPED_LIB_RS = stripComments(stripRustTests(readFileSync(LIB_RS_PATH, 'utf8')));
  const REGISTRATION = 'fetch_page::fetch_job_page';

  /** The `(...)` content of a `#[cfg(` attribute starting at `hashIndex`, and the index just past its closing `]`. Handles nested parens (`not(any(...))`). */
  function balancedCfgAttribute(
    text: string,
    hashIndex: number,
  ): { readonly expr: string; readonly end: number } | null {
    const openParen = text.indexOf('(', hashIndex);
    if (openParen === -1) return null;
    let depth = 0;
    let i = openParen;
    for (; i < text.length; i++) {
      if (text[i] === '(') depth++;
      else if (text[i] === ')') {
        depth--;
        if (depth === 0) break;
      }
    }
    if (depth !== 0 || text[i + 1] !== ']') return null;
    return { expr: text.slice(openParen + 1, i), end: i + 2 };
  }

  /**
   * Every `#[cfg(...)]` attribute stacked directly above `index` — nearest
   * first — with nothing but whitespace between the attributes and the
   * target (cfg attributes stack as an AND, e.g. the updater plugin's two).
   * Stops as soon as something other than whitespace or a `#[cfg(...)]`
   * attribute sits in the gap, so a cfg guarding an unrelated earlier line
   * is never mistaken for one guarding this registration.
   */
  function stackedCfgsBefore(text: string, index: number): string[] {
    const attrs: string[] = [];
    let boundary = index;
    for (;;) {
      const trimmedEnd = text.slice(0, boundary).replace(/\s+$/, '');
      if (!trimmedEnd.endsWith(']')) break;
      const hashIndex = trimmedEnd.lastIndexOf('#[cfg(');
      if (hashIndex === -1) break;
      const parsed = balancedCfgAttribute(text, hashIndex);
      if (!parsed || parsed.end > trimmedEnd.length) break;
      if (text.slice(parsed.end, boundary).trim() !== '') break;
      attrs.push(parsed.expr);
      boundary = hashIndex;
    }
    return attrs;
  }

  /**
   * Would this cfg expression be false on iOS? Not a full evaluator — just
   * the shapes this repository actually uses: the `desktop` alias (this
   * project's own convention for "not iOS or Android", see the updater
   * plugin), a `not(...)` that mentions `target_os = "ios"`, and a positive
   * `target_os` gate that never names iOS at all.
   */
  function cfgExcludesIos(expr: string): boolean {
    const trimmed = expr.trim();
    if (trimmed === 'desktop') return true;
    if (trimmed === 'mobile') return false;
    const mentionsIos = /target_os\s*=\s*"ios"/.test(trimmed);
    if (!mentionsIos) return /target_os\s*=/.test(trimmed);
    return /^not\(/.test(trimmed);
  }

  it('fetch_job_page really is registered outside comments and tests (the premise this guard protects)', () => {
    expect(
      SHIPPED_LIB_RS.includes(REGISTRATION),
      'not found outside comments and #[cfg(test)] — commented out, deleted, or renamed?',
    ).toBe(true);
  });

  it('is not gated behind a cfg that excludes iOS', () => {
    const index = SHIPPED_LIB_RS.indexOf(REGISTRATION);
    const guards = index === -1 ? [] : stackedCfgsBefore(SHIPPED_LIB_RS, index);
    const excluding = guards.filter(cfgExcludesIos);
    expect(
      excluding,
      `a #[cfg(...)] on this registration would exclude iOS: ${excluding.join(', ')}`,
    ).toEqual([]);
  });
});

describe('no claim that the app never loads a page', () => {
  function normalise(text: string): string {
    return text.replace(/\s+/g, ' ').toLowerCase();
  }

  function forbiddenPhraseIn(text: string): string | null {
    const normalised = normalise(text);
    return FORBIDDEN_PHRASES.find((phrase) => normalised.includes(phrase)) ?? null;
  }

  it('no doc claims it, in either wording, even hard-wrapped', () => {
    const offenders = DOC_FILES.map((file) => ({
      file: displayPath(file),
      phrase: forbiddenPhraseIn(readFileSync(file, 'utf8')),
    })).filter((entry): entry is { file: string; phrase: string } => entry.phrase !== null);
    expect(offenders).toEqual([]);
  });

  it('no shipped code prose claims it either (comments stripped, strings included)', () => {
    const offenders = CODE_FILES.map((file) => ({
      file: displayPath(file),
      phrase: forbiddenPhraseIn(stripComments(readFileSync(file, 'utf8'))),
    })).filter((entry): entry is { file: string; phrase: string } => entry.phrase !== null);
    expect(offenders).toEqual([]);
  });
});
