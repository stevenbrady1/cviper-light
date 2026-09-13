// @vitest-environment jsdom
/**
 * Reading Guardian Jobs' RSS, against the real feed.
 *
 * ============================================================================
 * WHY THIS ONE FILE NEEDS A BROWSER ENVIRONMENT
 * ============================================================================
 * `guardian.ts` parses XML with `DOMParser`, which the app's WebView has and a
 * bare Node process does not. jsdom is the same `DOMParser` implementation the
 * app's own component tests run against, so what is exercised here is the real
 * code path rather than a stand-in — the alternative, injecting a parser, would
 * leave the only implementation that ships untested.
 *
 * `fixtures/guardian-jobsrss.xml` is the COMPLETE live feed, captured
 * 2026-09-13, byte for byte. All twenty items, nothing trimmed.
 */
import { describe, expect, it } from 'vitest';

// The fixture as bytes, through Vite's `?raw`, rather than through `node:fs`.
// This file runs in jsdom, where `import.meta.url` is an http URL and
// `readFileSync` cannot resolve it — and hardcoding a path relative to the
// working directory breaks the moment the suite is run from somewhere else.
import FEED from '../fixtures/guardian-jobsrss.xml?raw';

import { normaliseGuardianFeed } from './guardian';

const CONTEXT = {
  createdAt: '2026-09-13T09:00:00.000Z' as const,
  newId: (() => {
    let next = 0;
    return () => `id-${++next}`;
  })(),
};

function jobsFrom(body: string) {
  const parsed = normaliseGuardianFeed(body, CONTEXT);
  if (!parsed.ok) throw new Error(`expected a parse: ${parsed.error.message}`);
  return parsed.value;
}

describe('normaliseGuardianFeed — the real feed', () => {
  it('reads all twenty items', () => {
    // The feed publishes exactly 20. A parser that reads 19 has silently
    // dropped a job somebody could have applied for.
    expect(jobsFrom(FEED)).toHaveLength(20);
  });

  it('never mistakes the channel for an item', () => {
    // `<channel><title>Job Search RSS</title>` sits above the items and is the
    // classic RSS off-by-one: a `querySelector('title')` from the document
    // returns the CHANNEL's title, so every advert would be called "Job Search
    // RSS" and nobody would notice until they read the screen.
    const titles = jobsFrom(FEED).map((entry) => entry.job.title);
    expect(titles).not.toContain('Job Search RSS');
    expect(new Set(titles).size).toBeGreaterThan(15);
  });

  it('splits the employer off the front of the title', () => {
    // Guardian packs "EMPLOYER: Job Title" into one field. Left whole, every
    // card would repeat the employer inside the heading and the company line
    // would be empty.
    const first = jobsFrom(FEED)[0];
    expect(first?.job.company).toBe('LB RICHMOND UPON THAMES & LB WANDSWORTH');
    expect(first?.job.title).toBe('Social Worker');
  });

  it('decodes the entities the feed escapes', () => {
    const titles = jobsFrom(FEED).map((entry) => `${entry.job.company} ${entry.job.title}`);
    expect(titles.some((text) => text.includes('&'))).toBe(true);
    expect(titles.some((text) => text.includes('&amp;'))).toBe(false);
  });

  it('takes the location from the last line of the description', () => {
    const located = jobsFrom(FEED).map((entry) => entry.job.location);
    expect(located).toContain('London (South)');
    expect(located).toContain('Southampton');
    // Not the salary line, and not the teaser.
    expect(located.some((where) => where?.includes('£'))).toBe(false);
  });

  it('reads a stated salary and says it is a year', () => {
    const withSalary = jobsFrom(FEED).find((entry) => entry.job.salary_min === 38976);
    expect(withSalary?.job.salary_max).toBe(52767);
    expect(withSalary?.job.salary_currency).toBe('GBP');
    expect(withSalary?.job.salary_period).toBe('year');
  });

  it('quotes no salary where the feed states none', () => {
    // "Unremunerated (expenses paid)" is a real line in this feed. A trustee
    // post with £0 against it would be a wrong number, not a missing one.
    const unpaid = jobsFrom(FEED).find((entry) => entry.job.title.startsWith('Trustee (Strategy'));
    expect(unpaid).toBeDefined();
    expect(unpaid?.job.salary_min).toBeNull();
    expect(unpaid?.job.salary_max).toBeNull();
    expect(unpaid?.job.salary_period).toBeNull();
  });

  it('turns the RFC-822 pubDate into a calendar day', () => {
    for (const entry of jobsFrom(FEED)) {
      expect(entry.job.posted_date, entry.job.title).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(jobsFrom(FEED)[0]?.job.posted_date).toBe('2026-08-19');
  });

  it('keeps the advert link exactly as published', () => {
    // The feed's own links carry `TrackID` and `utm_source=rss` — Guardian
    // attributing traffic to its own feed. CViper adds nothing and removes
    // nothing: rewriting somebody else's link is not this app's business, and
    // the promise in the README is that CViper adds no tracking of its own.
    const first = jobsFrom(FEED)[0];
    expect(first?.job.url).toBe(
      'https://jobs.theguardian.com/job/10176723/social-worker/?TrackID=8&utm_source=rss&utm_medium=feed&utm_campaign=general',
    );
    expect(first?.job.url).not.toContain('cviper');
  });

  it('uses the numeric job id from the link, not the whole URL', () => {
    // `(source, external_id)` is a unique index. A URL as an id means the same
    // advert saves twice the day Guardian changes a tracking parameter.
    expect(jobsFrom(FEED)[0]?.job.external_id).toBe('10176723');
  });

  it('stamps every advert with the guardian source', () => {
    expect(new Set(jobsFrom(FEED).map((entry) => entry.job.source))).toEqual(new Set(['guardian']));
  });
});

describe('normaliseGuardianFeed — a feed that has changed shape', () => {
  it('negative: refuses an HTML error page', () => {
    const parsed = normaliseGuardianFeed('<html><body>404 Not Found</body></html>', CONTEXT);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.source).toBe('guardian');
    expect(parsed.error.kind).toBe('bad-response');
    expect(parsed.error.message).toContain('Guardian Jobs');
  });

  it('negative: refuses XML that is not well formed', () => {
    expect(normaliseGuardianFeed('<rss><channel><item><title>x', CONTEXT).ok).toBe(false);
  });

  it('negative: refuses an empty body', () => {
    expect(normaliseGuardianFeed('', CONTEXT).ok).toBe(false);
    expect(normaliseGuardianFeed('   ', CONTEXT).ok).toBe(false);
  });

  it('boundary: a well-formed feed with no items parses to nothing, and is not an error here', () => {
    const parsed = normaliseGuardianFeed(
      '<?xml version="1.0"?><rss version="2.0"><channel><title>Job Search RSS</title></channel></rss>',
      CONTEXT,
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toEqual([]);
  });

  it('boundary: an item with no title is skipped, the rest survive', () => {
    const body = `<?xml version="1.0"?><rss version="2.0"><channel>
      <item><link>https://jobs.theguardian.com/job/1/a/</link></item>
      <item><title>ACME: Analyst</title><link>https://jobs.theguardian.com/job/2/b/</link></item>
    </channel></rss>`;

    const jobs = jobsFrom(body);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.job.title).toBe('Analyst');
  });

  it('boundary: a title with no employer prefix keeps the whole title', () => {
    const body = `<?xml version="1.0"?><rss version="2.0"><channel>
      <item><title>Head of Engagement</title></item>
    </channel></rss>`;

    const jobs = jobsFrom(body);
    expect(jobs[0]?.job.title).toBe('Head of Engagement');
    expect(jobs[0]?.job.company).toBe('Unknown');
  });

  it('boundary: an hourly rate is not shown as a day rate', () => {
    // The figure alone cannot say: £10.50 is a plausible hourly rate and an
    // absurd day rate, and the magnitude rule would call it a day rate. The
    // words next to it decide, and this is the case where getting it wrong puts
    // a nonsense number on a card.
    const body = `<?xml version="1.0"?><rss version="2.0"><channel>
      <item><title>ACME: Kitchen Assistant</title><description>
£12.60 per hour:

ACME:
Serving lunches.
Leeds
</description></item>
    </channel></rss>`;

    const jobs = jobsFrom(body);
    expect(jobs[0]?.job.salary_min).toBe(12.6);
    expect(jobs[0]?.job.salary_period).toBe('hour');
  });

  it('boundary: a day rate is read as a day rate', () => {
    const body = `<?xml version="1.0"?><rss version="2.0"><channel>
      <item><title>ACME: Interim Analyst</title><description>
£450 - £550 per day:

ACME:
Six-month cover.
Bristol
</description></item>
    </channel></rss>`;

    const jobs = jobsFrom(body);
    expect(jobs[0]?.job.salary_min).toBe(450);
    expect(jobs[0]?.job.salary_max).toBe(550);
    expect(jobs[0]?.job.salary_period).toBe('day');
    // "per day" is also a contract signal — the same classifier Reed uses.
    expect(jobs[0]?.contractType).toBe('Contract');
  });

  it('boundary: a salary hidden behind a grade is still found', () => {
    // "Grade 4 (Outer London): £30,288 - £32,070 FTE" is a real line in this
    // feed. Anchoring the money to the start of the line would miss it.
    const body = `<?xml version="1.0"?><rss version="2.0"><channel>
      <item><title>ACME: Administrator</title><description>
Grade 4 (Outer London): £30,288 - £32,070 FTE:

ACME:
About us.
London
</description></item>
    </channel></rss>`;

    const jobs = jobsFrom(body);
    expect(jobs[0]?.job.salary_min).toBe(30288);
    expect(jobs[0]?.job.salary_max).toBe(32070);
    expect(jobs[0]?.job.salary_period).toBe('year');
  });

  it('negative: prose that names no figure quotes no salary', () => {
    for (const line of ['Competitive salary:', 'Unremunerated (expenses paid):', 'Negotiable']) {
      const body = `<?xml version="1.0"?><rss version="2.0"><channel>
        <item><title>ACME: Role</title><description>
${line}

ACME:
Teaser.
York
</description></item>
      </channel></rss>`;

      expect(jobsFrom(body)[0]?.job.salary_min, line).toBeNull();
      expect(jobsFrom(body)[0]?.job.salary_currency, line).toBeNull();
    }
  });

  it('boundary: an unreadable pubDate is no date at all', () => {
    const body = `<?xml version="1.0"?><rss version="2.0"><channel>
      <item><title>ACME: Role</title><pubDate>last Tuesday</pubDate></item>
    </channel></rss>`;

    expect(jobsFrom(body)[0]?.job.posted_date).toBeNull();
  });
});
