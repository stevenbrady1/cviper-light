/**
 * Reading the Arbeitnow feed, against a recorded slice of the real one.
 *
 * ============================================================================
 * THE FIXTURE IS REAL, AND WHAT WAS DONE TO IT IS SAID HERE
 * ============================================================================
 * `fixtures/arbeitnow-page1.json` is page 1 of the live feed, captured on
 * 2026-09-13. `meta` and `links` are verbatim. Of the 250 adverts, 19 were kept
 * — every distinct spelling of London the page contained, one with no location
 * at all, and a spread of Paris/Berlin/Munich/remote rows — and each kept
 * advert's `description` was cut to its first 260 characters so the file is
 * 17 KB rather than 2.1 MB. No field was invented, renamed or reshaped.
 *
 * That trim is why this file states the counts it does. A fixture nobody can
 * read is a fixture nobody checks.
 */
import { describe, expect, it } from 'vitest';

import fixture from '../fixtures/arbeitnow-page1.json';

import { ARBEITNOW_TERMS, normaliseArbeitnowFeed } from './arbeitnow';

const CONTEXT = {
  createdAt: '2026-09-13T09:00:00.000Z' as const,
  newId: (() => {
    let next = 0;
    return () => `id-${++next}`;
  })(),
};

const BODY = JSON.stringify(fixture);

function jobsFrom(body: string) {
  const parsed = normaliseArbeitnowFeed(body, CONTEXT);
  if (!parsed.ok) throw new Error(`expected a parse: ${parsed.error.message}`);
  return parsed.value;
}

describe('normaliseArbeitnowFeed — the recorded page', () => {
  it('reads every advert in the page', () => {
    // 19 in, 19 out. A parser that silently drops rows is the failure this
    // number exists to catch — it would look exactly like a quiet feed.
    expect(jobsFrom(BODY)).toHaveLength(19);
  });

  it('stamps every advert with the arbeitnow source', () => {
    // Not `adzuna` wearing a hat: the card names this board and the tracker's
    // unique index keys on it.
    expect(new Set(jobsFrom(BODY).map((entry) => entry.job.source))).toEqual(
      new Set(['arbeitnow']),
    );
  });

  it('maps the fields of a real advert', () => {
    const first = jobsFrom(BODY)[0];
    expect(first?.job.title).toBe('Pre-Sales Senior Engineer');
    expect(first?.job.company).toBe('Kaluza');
    expect(first?.job.location).toBe('London');
    expect(first?.job.external_id).toBe('pre-sales-senior-engineer-london-223227');
    expect(first?.job.url).toMatch(/^https:\/\//);
  });

  it('turns the unix `created_at` into a calendar day', () => {
    // The feed sends seconds since the epoch; `Job.posted_date` is `YYYY-MM-DD`
    // and `JobSchema` validates it with `z.iso.date()` on the way into a backup.
    for (const entry of jobsFrom(BODY)) {
      expect(entry.job.posted_date, entry.job.title).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('strips the description down to text', () => {
    const described = jobsFrom(BODY).find((entry) => entry.job.description !== null);
    expect(described?.job.description).not.toMatch(/<[a-z]/i);
    expect(described?.job.description).not.toContain('&nbsp;');
  });

  it('quotes no salary, because the feed publishes none', () => {
    // Arbeitnow has no salary field. Inventing one from the description would
    // be a confident wrong number on a card, so all four salary fields stay
    // null and the card says "Salary not stated".
    for (const entry of jobsFrom(BODY)) {
      expect(entry.job.salary_min).toBeNull();
      expect(entry.job.salary_max).toBeNull();
      expect(entry.job.salary_currency).toBeNull();
      expect(entry.job.salary_period).toBeNull();
    }
  });

  it('boundary: an advert with no location is kept, with a null location', () => {
    // 8 of the real 250 had an empty location string. Dropping them would lose
    // real adverts; storing `""` would make the card print a stray separator.
    const nowhere = jobsFrom(BODY).filter((entry) => entry.job.location === null);
    expect(nowhere).toHaveLength(1);
    expect(nowhere[0]?.job.title).toBeTruthy();
  });

  it('reads the employment type out of `job_types` when the feed states one', () => {
    const types = new Set(jobsFrom(BODY).map((entry) => entry.contractType));
    expect(types.has('Permanent')).toBe(true);
    expect(types.has('Part-time')).toBe(true);
  });

  it('still carries the terms we are agreeing to', () => {
    // Their `meta.terms`, verbatim. If a future capture no longer says this,
    // the attribution promise in the UI needs re-reading, not silently keeping.
    expect(fixture.meta.terms).toBe(ARBEITNOW_TERMS);
    expect(ARBEITNOW_TERMS).toContain('linking back to the site');
  });
});

describe('normaliseArbeitnowFeed — a feed that has changed shape', () => {
  it('negative: refuses a body that is not JSON', () => {
    const parsed = normaliseArbeitnowFeed('<html>504 Gateway Timeout</html>', CONTEXT);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.source).toBe('arbeitnow');
    expect(parsed.error.kind).toBe('bad-response');
    // The message names the source, because it is shown on a screen that has
    // another source's results on it.
    expect(parsed.error.message).toContain('Arbeitnow');
  });

  it('negative: refuses a body with no `data` array', () => {
    expect(normaliseArbeitnowFeed('{"jobs":[]}', CONTEXT).ok).toBe(false);
    expect(normaliseArbeitnowFeed('{"data":"soon"}', CONTEXT).ok).toBe(false);
    expect(normaliseArbeitnowFeed('null', CONTEXT).ok).toBe(false);
    expect(normaliseArbeitnowFeed('[]', CONTEXT).ok).toBe(false);
  });

  it('boundary: an empty `data` array parses, and is NOT an error here', () => {
    // Deliberate split of responsibility. "Nothing in the page" is a real
    // answer to a parse, and a loud one to a browse — see `browse.ts`, which
    // is where a feed that has gone quiet is reported to the user.
    const parsed = normaliseArbeitnowFeed('{"data":[]}', CONTEXT);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toEqual([]);
  });

  it('boundary: one unusable advert does not take the page down with it', () => {
    const body = JSON.stringify({
      data: [
        'not an object',
        null,
        { company_name: 'No Title Ltd' },
        { slug: 'real-1', title: 'Data Engineer', company_name: 'Real Ltd', location: 'London' },
      ],
    });

    const jobs = jobsFrom(body);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.job.title).toBe('Data Engineer');
  });

  it('boundary: an advert with no company is named, not blanked', () => {
    const body = JSON.stringify({ data: [{ slug: 's', title: 'Analyst' }] });
    expect(jobsFrom(body)[0]?.job.company).toBe('Unknown');
  });

  it('negative: a non-http url is dropped rather than offered', () => {
    const body = JSON.stringify({
      data: [{ slug: 's', title: 'Analyst', url: 'javascript:alert(1)' }],
    });
    expect(jobsFrom(body)[0]?.job.url).toBeNull();
  });

  it('boundary: an unreadable `created_at` is no date at all', () => {
    for (const created_at of ['soon', null, -1, 0, 1e18, Number.NaN]) {
      const body = JSON.stringify({ data: [{ slug: 's', title: 'Analyst', created_at }] });
      expect(jobsFrom(body)[0]?.job.posted_date, String(created_at)).toBeNull();
    }
  });
});
