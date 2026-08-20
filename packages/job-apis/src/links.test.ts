import { type BoardTemplate } from '@cviper/core-types';
import { describe, expect, it } from 'vitest';

import { boardTemplateProblem, buildBoardUrl } from './links';

function board(urlTemplate: string, encoding: BoardTemplate['encoding']): BoardTemplate {
  return { id: 'test', label: 'Test', urlTemplate, encoding };
}

const PLUS_QUERY = board('https://example.invalid/jobs?q={keyword}&l={location}', 'plus');
const HYPHEN_PATH = board('https://example.invalid/{keyword}-jobs-in-{location}', 'hyphen');

describe('buildBoardUrl — the two encodings', () => {
  it('plus: spaces become + and the value is form-encoded', () => {
    expect(
      buildBoardUrl(PLUS_QUERY, { keywords: 'business analyst', location: 'Milton Keynes' }),
    ).toBe('https://example.invalid/jobs?q=business+analyst&l=Milton+Keynes');
  });

  it('hyphen: spaces become hyphens and the rest is percent-encoded', () => {
    expect(
      buildBoardUrl(HYPHEN_PATH, { keywords: 'business analyst', location: 'Milton Keynes' }),
    ).toBe('https://example.invalid/business-analyst-jobs-in-Milton-Keynes');
  });

  it('boundary: collapses the whitespace and control characters a paste brings', () => {
    const pasted = { keywords: '  credit\tanalyst\n ', location: ' London ' };

    expect(buildBoardUrl(PLUS_QUERY, pasted)).toBe(
      'https://example.invalid/jobs?q=credit+analyst&l=London',
    );
    expect(buildBoardUrl(HYPHEN_PATH, pasted)).toBe(
      'https://example.invalid/credit-analyst-jobs-in-London',
    );
  });
});

describe('buildBoardUrl — special characters', () => {
  // `C#` is the case that matters most, and it is not a nicety. A raw `#`
  // starts a URL FRAGMENT, so `?q=C#` arrives at the job board as `?q=C` and
  // the user gets results for the letter C. Both encodings must escape it.
  it('encodes C# to %23 in BOTH encodings', () => {
    expect(buildBoardUrl(PLUS_QUERY, { keywords: 'C# developer', location: '' })).toBe(
      'https://example.invalid/jobs?q=C%23+developer',
    );
    expect(buildBoardUrl(HYPHEN_PATH, { keywords: 'C# developer', location: '' })).toBe(
      'https://example.invalid/C%23-developer-jobs',
    );
  });

  it('a # never survives into the URL as a fragment', () => {
    for (const template of [PLUS_QUERY, HYPHEN_PATH]) {
      const url = buildBoardUrl(template, { keywords: 'C#', location: 'C#' });

      expect(url).not.toContain('#');
      expect(new URL(url).hash).toBe('');
    }
  });

  it('encodes an ampersand so it cannot start a new query parameter', () => {
    const url = buildBoardUrl(PLUS_QUERY, { keywords: 'M&A analyst', location: 'London' });

    expect(url).toBe('https://example.invalid/jobs?q=M%26A+analyst&l=London');
    expect(new URL(url).searchParams.get('q')).toBe('M&A analyst');
    expect(buildBoardUrl(HYPHEN_PATH, { keywords: 'M&A', location: 'London' })).toBe(
      'https://example.invalid/M%26A-jobs-in-London',
    );
  });

  it('encodes a literal + so it is not read back as a space', () => {
    // `C++` typed into a `plus` board would otherwise decode as `C  `.
    const url = buildBoardUrl(PLUS_QUERY, { keywords: 'C++ developer', location: '' });

    expect(url).toBe('https://example.invalid/jobs?q=C%2B%2B+developer');
    expect(new URL(url).searchParams.get('q')).toBe('C++ developer');
    expect(buildBoardUrl(HYPHEN_PATH, { keywords: 'C++', location: '' })).toBe(
      'https://example.invalid/C%2B%2B-jobs',
    );
  });

  it('encodes non-ASCII characters as UTF-8 in both encodings', () => {
    const awkward = { keywords: 'Zürich', location: 'Genève' };

    expect(buildBoardUrl(PLUS_QUERY, awkward)).toBe(
      'https://example.invalid/jobs?q=Z%C3%BCrich&l=Gen%C3%A8ve',
    );
    expect(buildBoardUrl(HYPHEN_PATH, awkward)).toBe(
      'https://example.invalid/Z%C3%BCrich-jobs-in-Gen%C3%A8ve',
    );
  });

  it('negative: text that looks like a URL cannot change the destination', () => {
    const hostile = { keywords: 'https://evil.example.com/?x=', location: '../../admin' };

    for (const template of [PLUS_QUERY, HYPHEN_PATH]) {
      const url = buildBoardUrl(template, hostile);

      expect(new URL(url).hostname).toBe('example.invalid');
      expect(url).not.toContain('evil.example.com/?x=');
      expect(url).not.toContain('../..');
    }
  });
});

describe('buildBoardUrl — the empty-location rule', () => {
  /*
   * THE RULE, in one sentence: an empty value takes its connector with it.
   *
   *   1. If the placeholder is the WHOLE value of a query parameter, the whole
   *      parameter goes — `?q=analyst`, never `?q=analyst&l=`.
   *   2. If the placeholder is a WHOLE path segment, the segment goes.
   *   3. Otherwise the placeholder leaves with the joining punctuation and
   *      joining word next to it (`-in-`, `/in-`, `+`), preferring the side
   *      BEFORE it, so `...business-analyst-jobs-in-` becomes
   *      `...business-analyst-jobs` rather than a dangling `-in-`.
   */

  it('drops a query parameter whose entire value was the empty placeholder', () => {
    expect(buildBoardUrl(PLUS_QUERY, { keywords: 'analyst', location: '' })).toBe(
      'https://example.invalid/jobs?q=analyst',
    );
  });

  it('drops the `-in-` connector with the location, not just the placeholder', () => {
    expect(buildBoardUrl(HYPHEN_PATH, { keywords: 'analyst', location: '' })).toBe(
      'https://example.invalid/analyst-jobs',
    );
  });

  it('drops a `/in-` connector and the empty path segment it left behind', () => {
    const totaljobsLike = board('https://example.invalid/jobs/{keyword}/in-{location}', 'hyphen');

    expect(buildBoardUrl(totaljobsLike, { keywords: 'analyst', location: '' })).toBe(
      'https://example.invalid/jobs/analyst',
    );
  });

  it('keeps a literal word that is not a connector — only the separator goes', () => {
    // Google's template reads `{keyword}+jobs+{location}`. With no location the
    // word `jobs` STAYS: it is part of the search, not punctuation.
    const googleLike = board('https://example.invalid/s?q={keyword}+jobs+{location}&udm=8', 'plus');

    expect(buildBoardUrl(googleLike, { keywords: 'business analyst', location: '' })).toBe(
      'https://example.invalid/s?q=business+analyst+jobs&udm=8',
    );
  });

  it('leaves a template with no {location} completely alone', () => {
    const guardianLike = board('https://example.invalid/jobs/{keyword}/', 'hyphen');

    expect(buildBoardUrl(guardianLike, { keywords: 'business analyst', location: 'Leeds' })).toBe(
      'https://example.invalid/jobs/business-analyst/',
    );
  });

  it('never leaves a word that only meant something next to a value', () => {
    for (const template of [
      board('https://example.invalid/{keyword}-jobs-in-{location}', 'hyphen'),
      board('https://example.invalid/jobs/{keyword}/in-{location}', 'hyphen'),
      board('https://example.invalid/{keyword}-jobs-near-{location}', 'hyphen'),
      board('https://example.invalid/{keyword}-at-{location}', 'hyphen'),
    ]) {
      const url = buildBoardUrl(template, { keywords: 'analyst', location: '' });

      expect(url, template.urlTemplate).not.toMatch(/[-/](in|at|near)$/);
      expect(url, template.urlTemplate).not.toMatch(/[-+/]$/);
    }
  });

  it('boundary: a word merely CONTAINING a connector is not chopped', () => {
    // `-internal-` starts with `in`. Removing it would leave `ternal`, which is
    // the classic way this kind of rule goes wrong.
    const internal = board('https://example.invalid/{keyword}-internal-{location}', 'hyphen');

    expect(buildBoardUrl(internal, { keywords: 'analyst', location: '' })).toBe(
      'https://example.invalid/analyst-internal',
    );
  });

  it('boundary: an empty keyword is handled the same way, never a broken path', () => {
    for (const template of [
      PLUS_QUERY,
      HYPHEN_PATH,
      board('https://example.invalid/jobs/{keyword}/in-{location}', 'hyphen'),
      board('https://example.invalid/jobs/{keyword}/', 'hyphen'),
    ]) {
      const url = buildBoardUrl(template, { keywords: '', location: 'London' });

      expect(new URL(url).hostname, template.urlTemplate).toBe('example.invalid');
      expect(url, template.urlTemplate).not.toContain('//jobs');
      expect(url, template.urlTemplate).not.toContain('{');
    }
  });

  it('boundary: an entirely empty search still produces a usable URL', () => {
    for (const template of [
      PLUS_QUERY,
      HYPHEN_PATH,
      board('https://example.invalid/jobs/{keyword}/in-{location}', 'hyphen'),
    ]) {
      const url = buildBoardUrl(template, { keywords: '', location: '' });

      expect(() => new URL(url), template.urlTemplate).not.toThrow();
      expect(url, template.urlTemplate).not.toContain('?');
      expect(url, template.urlTemplate).not.toContain('{');
    }
  });
});

describe('buildBoardUrl — nothing is ever added to the link', () => {
  it('carries no tracking parameter of any kind', () => {
    const url = buildBoardUrl(PLUS_QUERY, { keywords: 'analyst', location: 'London' });

    expect(url).not.toMatch(/utm_|cviper|affiliate|ref=/i);
  });
});

describe('boardTemplateProblem — what a custom board may be saved as', () => {
  it('accepts a template that names the keyword and is a web address', () => {
    expect(boardTemplateProblem('https://example.invalid/jobs?q={keyword}')).toBeNull();
    expect(boardTemplateProblem('http://example.invalid/{keyword}-in-{location}')).toBeNull();
  });

  it('negative: refuses a template with no {keyword}', () => {
    // Without it every search on that board is the same search.
    expect(boardTemplateProblem('https://example.invalid/jobs?l={location}')).toContain(
      '{keyword}',
    );
  });

  it('negative: refuses anything that is not http or https', () => {
    for (const raw of [
      'javascript:alert({keyword})',
      'file:///c:/{keyword}',
      'data:text/html,{keyword}',
      'ftp://example.invalid/{keyword}',
      'example.invalid/{keyword}',
    ]) {
      expect(boardTemplateProblem(raw), raw).not.toBeNull();
    }
  });

  it('negative: refuses a template that cannot produce a URL at all', () => {
    expect(boardTemplateProblem('https:// example.invalid/{keyword}')).not.toBeNull();
    expect(boardTemplateProblem('https://{keyword}')).not.toBeNull();
  });

  it('boundary: refuses an empty or whitespace-only template', () => {
    expect(boardTemplateProblem('')).not.toBeNull();
    expect(boardTemplateProblem('   ')).not.toBeNull();
  });

  it('boundary: a template that is fine with a location is checked WITHOUT one too', () => {
    // The state that produces an invalid URL only when the location box is
    // empty is exactly the one a happy-path check would let through.
    expect(boardTemplateProblem('https://example.invalid/{keyword}/{location}')).toBeNull();
    expect(
      new URL(
        buildBoardUrl(board('https://example.invalid/{keyword}/{location}', 'hyphen'), {
          keywords: 'analyst',
          location: '',
        }),
      ).pathname,
    ).toBe('/analyst');
  });
});
