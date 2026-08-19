import { describe, expect, it } from 'vitest';

import {
  DESCRIPTION_MAX_CHARS,
  normaliseDescription,
  toIsoDateOrNull,
  unescapeHtmlEntities,
} from './text';

describe('unescapeHtmlEntities', () => {
  it('decodes the named entities job adverts actually contain', () => {
    expect(unescapeHtmlEntities('R&amp;D, M&amp;A &pound;50k')).toBe('R&D, M&A £50k');
    expect(unescapeHtmlEntities('&ldquo;great&rdquo; &ndash; really')).toBe('“great” – really');
  });

  it('decodes decimal and hexadecimal numeric entities', () => {
    expect(unescapeHtmlEntities('&#163;457')).toBe('£457');
    expect(unescapeHtmlEntities('&#xA3;457')).toBe('£457');
    expect(unescapeHtmlEntities('&#65;')).toBe('A');
  });

  it('decodes astral-plane code points without splitting a surrogate pair', () => {
    expect(unescapeHtmlEntities('&#128200;')).toBe('\u{1F4C8}');
  });

  it('negative: leaves an entity it does not know exactly as it found it', () => {
    // Same posture as Python's `html.unescape`, which also leaves an
    // unrecognised name alone rather than eating the text around it.
    expect(unescapeHtmlEntities('&notarealentity; stays')).toBe('&notarealentity; stays');
  });

  it('boundary: refuses out-of-range and malformed code points rather than throwing', () => {
    for (const bad of ['&#1114112;', '&#x110000;', '&#;', '&#xZZ;', '&#99999999999999;']) {
      expect(() => unescapeHtmlEntities(bad)).not.toThrow();
      expect(unescapeHtmlEntities(bad)).toBe(bad);
    }
  });
});

describe('normaliseDescription — stripping the markup', () => {
  it('removes tags and leaves the words', () => {
    expect(normaliseDescription('<p>Risk <strong>Analyst</strong></p>')).toBe('Risk Analyst');
  });

  it('handles the entity-escaped HTML Reed actually returns', () => {
    expect(normaliseDescription('&lt;p&gt;Day rate: &amp;pound;550&lt;/p&gt;')).toBe(
      'Day rate: &pound;550',
    );
  });

  it('REGRESSION: does not swallow a salary range written with angle brackets', () => {
    // `<[^>]*>` would match "<100k but >" in "salary <100k but >80k" and eat the
    // range. A letter is REQUIRED after the optional slash for that reason.
    expect(normaliseDescription('salary &lt;100k but &gt;80k')).toBe('salary <100k but >80k');
  });

  it('collapses the whitespace a stripped tag leaves behind', () => {
    expect(normaliseDescription('<li>One</li>\n\n<li>Two</li>')).toBe('One Two');
  });

  it('negative: an empty or blank description becomes null, not an empty string', () => {
    // `null` is the model's "absent". An empty string would render as a job
    // with a description that is simply blank, which is a different claim.
    for (const blank of ['', '   ', '<p></p>', '&nbsp;&nbsp;']) {
      expect(normaliseDescription(blank)).toBeNull();
    }
  });

  it('negative: anything that is not a string is null', () => {
    for (const bad of [null, undefined, 42, {}, []]) {
      expect(normaliseDescription(bad)).toBeNull();
    }
  });
});

describe('normaliseDescription — the length boundary', () => {
  it('keeps a description of exactly the maximum length', () => {
    const exact = 'x'.repeat(DESCRIPTION_MAX_CHARS);
    expect(normaliseDescription(exact)).toHaveLength(DESCRIPTION_MAX_CHARS);
  });

  it('truncates one character past the maximum', () => {
    const over = 'x'.repeat(DESCRIPTION_MAX_CHARS + 1);
    expect(normaliseDescription(over)).toHaveLength(DESCRIPTION_MAX_CHARS);
  });

  it('the cap is 8000 characters', () => {
    expect(DESCRIPTION_MAX_CHARS).toBe(8000);
  });
});

describe('toIsoDateOrNull', () => {
  it('slices a timestamp down to the calendar date', () => {
    expect(toIsoDateOrNull('2026-08-19T09:00:00Z')).toBe('2026-08-19');
    expect(toIsoDateOrNull('2026-08-19')).toBe('2026-08-19');
  });

  it('accepts the space-separated form Reed sometimes sends', () => {
    expect(toIsoDateOrNull('2026-08-19 09:00:00')).toBe('2026-08-19');
  });

  it('negative: a date that is not YYYY-MM-DD is null, never a guess', () => {
    for (const bad of ['19/08/2026', '2026-8-9', 'yesterday', '', null, undefined, 42]) {
      expect(toIsoDateOrNull(bad)).toBeNull();
    }
  });

  it('boundary: rejects an impossible date that a Date constructor would roll forward', () => {
    // `new Date('2026-02-30')` rolls to 2 March on some engines. A job posted
    // on a day that does not exist is a broken feed, not a job posted in March.
    expect(toIsoDateOrNull('2026-02-30')).toBeNull();
    expect(toIsoDateOrNull('2026-13-01')).toBeNull();
    expect(toIsoDateOrNull('2024-02-29')).toBe('2024-02-29');
  });
});
