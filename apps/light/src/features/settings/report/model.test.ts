/**
 * The problem report carries the version and the system, and carries nothing
 * else — proved on the produced URL AND on the shipped source of this folder.
 *
 * The behavioural half can only ever show that the two facts it was GIVEN came
 * out the other end. The structural half is what stops the next person adding a
 * third fact: a report that reached the database, the credential store or a log
 * file would satisfy every assertion about version and system while quietly
 * becoming an upload.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { stripComments } from '../../../lib/repo-scan.ts';

import {
  MAX_FACT_LENGTH,
  MAX_ISSUE_URL_LENGTH,
  REPORT_ISSUE_URL,
  clampFact,
  describeSystem,
  reportBody,
  reportUrl,
} from './model';

/** A real WebView2 user agent, from a Windows 11 machine. */
const WINDOWS_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/141.0.0.0 Safari/537.36 Edg/141.0.3537.85';

const FACTS = { version: '0.1.0', system: 'Windows NT 10.0; Win64; x64 · WebView2 141.0.3537.85' };

/** The body of a built URL, decoded back to the string that went in. */
function bodyOf(url: string): string {
  const body = new URL(url).searchParams.get('body');
  expect(body, 'the URL has no body parameter').not.toBeNull();
  return body ?? '';
}

describe('describeSystem', () => {
  it('happy: names the platform and the WebView2 version', () => {
    expect(describeSystem(WINDOWS_UA)).toBe('Windows NT 10.0; Win64; x64 · WebView2 141.0.3537.85');
  });

  it('falls back to the WebKit version when there is no Edg token', () => {
    // A Mac or an iPhone: WKWebView, no `Edg/`.
    expect(
      describeSystem(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)',
      ),
    ).toBe('Macintosh; Intel Mac OS X 10_15_7 · WebKit 605.1.15');
  });

  it('negative: an unrecognisable user agent is "unknown", never a crash', () => {
    expect(describeSystem('CViperLight')).toBe('unknown');
  });

  it('boundary: an empty user agent is "unknown"', () => {
    expect(describeSystem('')).toBe('unknown');
  });

  it('boundary: a platform with no engine token still reports the platform', () => {
    expect(describeSystem('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe(
      'Windows NT 10.0; Win64; x64',
    );
  });

  it('never returns the whole user agent', () => {
    // Pasting an opaque 120-character string into a public issue is exactly
    // what a privacy-minded user is right to object to.
    expect(describeSystem(WINDOWS_UA)).not.toContain('Mozilla/5.0');
    expect(describeSystem(WINDOWS_UA).length).toBeLessThan(WINDOWS_UA.length);
  });
});

describe('clampFact', () => {
  it('happy: leaves a real value alone', () => {
    expect(clampFact('0.1.0')).toBe('0.1.0');
  });

  it('negative: an empty or blank fact becomes "unknown"', () => {
    expect(clampFact('')).toBe('unknown');
    expect(clampFact('   \n\t ')).toBe('unknown');
  });

  it('collapses whitespace so a fact cannot forge extra lines in the body', () => {
    expect(clampFact('0.1.0\n- App version: 9.9.9')).toBe('0.1.0 - App version: 9.9.9');
  });

  it('boundary: at the limit is kept whole, one past it is cut', () => {
    expect(clampFact('a'.repeat(MAX_FACT_LENGTH))).toHaveLength(MAX_FACT_LENGTH);
    expect(clampFact('a'.repeat(MAX_FACT_LENGTH + 1))).toHaveLength(MAX_FACT_LENGTH);
  });
});

describe('the report URL', () => {
  it('happy: goes to this app’s public issue form and carries both facts', () => {
    const url = reportUrl(FACTS);
    expect(url.startsWith(`${REPORT_ISSUE_URL}?`)).toBe(true);

    const body = bodyOf(url);
    expect(body).toContain('App version: 0.1.0');
    expect(body).toContain('WebView2 141.0.3537.85');
  });

  it('says, in the body the user reads, that nothing else is attached', () => {
    expect(bodyOf(reportUrl(FACTS))).toContain('writes no log file');
  });

  it('carries nothing but the two facts and fixed prose', () => {
    // The body for these facts IS `reportBody` of these facts — there is no
    // other input, so there is nothing else it could contain.
    expect(bodyOf(reportUrl(FACTS))).toBe(reportBody(FACTS));
  });

  it('negative: a fact that looks like key material is still only that fact', () => {
    // Nothing reads a key here, but if a hostile or broken `version` arrived it
    // must not gain any power over the body beyond being printed as a version.
    const poisoned = { version: 'sk-not-a-real-key', system: 'x' };
    const body = bodyOf(reportUrl(poisoned));
    expect(body).toBe(reportBody(poisoned));
    expect(body.split('App version:')).toHaveLength(2);
  });

  it('boundary: absurdly long facts still produce a URL inside GitHub’s limit', () => {
    const url = reportUrl({ version: 'v'.repeat(10_000), system: 's'.repeat(10_000) });
    expect(url.length).toBeLessThanOrEqual(MAX_ISSUE_URL_LENGTH);
    // And it is still a URL whose body decodes, rather than a string cut
    // through the middle of a percent-escape.
    expect(() => bodyOf(url)).not.toThrow();
  });

  it('boundary: shrinks the body when the limit demands it, and still decodes', () => {
    // The limit is a parameter so this branch is actually executed. At 8000 a
    // real report never reaches it, and an unexecuted branch is the same as an
    // unwritten one.
    const url = reportUrl(FACTS, 400);
    expect(url.length).toBeLessThanOrEqual(400);
    expect(() => bodyOf(url)).not.toThrow();
    expect(bodyOf(url).length).toBeLessThan(reportBody(FACTS).length);
  });

  it('boundary: a limit below the bare address stops rather than spinning', () => {
    const url = reportUrl(FACTS, 10);
    expect(url.startsWith(REPORT_ISSUE_URL)).toBe(true);
    expect(bodyOf(url)).toBe('');
  });

  it('boundary: an emoji in a fact is not cut through a surrogate pair', () => {
    const url = reportUrl({ version: '🙂'.repeat(60), system: '🙂'.repeat(60) }, 300);
    expect(() => bodyOf(url)).not.toThrow();
  });
});

describe('nothing in this folder can reach the user’s data', () => {
  // The structural half. A report that grew a log, a CV or a key would pass
  // every assertion above, because those all only ever see the two strings the
  // test handed in.
  const HERE = fileURLToPath(new URL('.', import.meta.url));

  const FILES = readdirSync(HERE)
    .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
    .sort();

  /** Every route to something that is not the version or the system. */
  const FORBIDDEN = [
    'secret_get',
    'secret_set',
    'secret_status',
    'SecretKey',
    'keyring',
    'readAll',
    'writeAll',
    'plugin-sql',
    'plugin-fs',
    'extracted_text',
    'json_resume',
    'localStorage',
    'sessionStorage',
    'indexedDB',
    'requestLog',
    'console.log',
  ];

  it('scans the real modules', () => {
    // Anti-inert: an empty read would clear this for ever.
    expect(FILES).toEqual(['ReportProblem.tsx', 'model.ts', 'port.ts']);
  });

  it('names no route to the database, the credential store or a log', () => {
    const offenders = FILES.flatMap((name) => {
      // Comments stripped first: the docblocks here explain what must NOT
      // happen, and a guard that fired on the prose warning about the bug is a
      // guard the next person deletes.
      const source = stripComments(readFileSync(join(HERE, name), 'utf8'));
      return FORBIDDEN.filter((token) => source.includes(token)).map(
        (token) => `${name}: ${token}`,
      );
    });
    expect(
      offenders,
      'A problem report carries the app version and the system, and nothing else. This app ' +
        'writes no log file and the owner has decided it will not start.',
    ).toEqual([]);
  });

  it('the scanner can actually fail', () => {
    // Proof the matcher bites, so a clean folder is a result rather than an
    // accident of the token list never matching anything.
    const planted = stripComments("const k = await invoke('secret_get', { key });\n");
    expect(FORBIDDEN.filter((token) => planted.includes(token))).toEqual(['secret_get']);
  });
});
