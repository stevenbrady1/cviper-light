/**
 * The keyless-feed canary (L-339), tested with no network at all.
 *
 * Every reply below is a value handed to the checker, so these tests say what
 * the canary concludes about a feed that answered in a given way — they never
 * ask Arbeitnow anything. The live run is `pnpm canary:feeds`, and only the
 * scheduled `feed-canary.yml` makes it.
 *
 * The failure this exists for is the Guardian one: its feed closed on 2 Sep
 * 2026, the address started redirecting to a web page that answered 200, and
 * nothing noticed for two months. So the replies here are the shapes a dead
 * feed actually takes — a web page with a 200, a redirect, an empty list, a
 * 404 — and each must go red with a sentence that names what happened.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { KEYLESS_SOURCE_IDS } from '@cviper/job-apis';
import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from '../lib/repo-scan.ts';

import {
  canaryFeeds,
  checkFeed,
  httpFeedFetcher,
  runFeedCanary,
  rustKeylessVariants,
  type CanaryFeed,
  type FeedReply,
  type FetchFeedPage,
} from './feedCanary.ts';

const KEYLESS_RS = readFileSync(
  join(REPO_ROOT, 'apps', 'light', 'src-tauri', 'src', 'keyless.rs'),
  'utf8',
);

/** Page 1 of the live Arbeitnow feed, as recorded for the reader's own tests. */
const FIXTURE = readFileSync(
  join(REPO_ROOT, 'packages', 'job-apis', 'src', 'fixtures', 'arbeitnow-page1.json'),
  'utf8',
);

const FEED: CanaryFeed = {
  source: 'arbeitnow',
  url: 'https://feed.example.com/api/job-board-api',
  accept: 'application/json',
};

/** The same reply to every page asked for. */
function always(reply: FeedReply): FetchFeedPage {
  return () => Promise.resolve(reply);
}

function json(body: string, status = 200): FeedReply {
  return { kind: 'answered', status, contentType: 'application/json', location: null, body };
}

function oneAdvert(fields: Record<string, unknown>): string {
  return JSON.stringify({
    data: [{ slug: 'only-one-1', company_name: 'Acme', location: 'London', ...fields }],
  });
}

const GUARDIAN_STYLE_PAGE =
  '<!DOCTYPE html><html><head><title>Guardian Jobs has closed</title></head>' +
  '<body><p>Thank you for using Guardian Jobs.</p></body></html>';

// ── Which feeds: the app's own list, never a second copy ───────────────────

describe('the canary checks every keyless feed the app ships', () => {
  it('reads a feed for every keyless source the frontend knows, and no others', () => {
    const { feeds, problems } = canaryFeeds(KEYLESS_RS);
    expect(problems).toEqual([]);
    expect(feeds.map((feed) => feed.source)).toEqual([...KEYLESS_SOURCE_IDS]);
  });

  it('agrees with the Rust enum, so a feed added on the Rust side is not skipped', () => {
    expect(rustKeylessVariants(KEYLESS_RS)).toEqual([...KEYLESS_SOURCE_IDS]);
  });

  it('anti-inert: it found at least one real https address in keyless.rs', () => {
    const { feeds } = canaryFeeds(KEYLESS_RS);
    expect(feeds.length).toBeGreaterThanOrEqual(1);
    for (const feed of feeds) {
      expect(feed.url).toMatch(/^https:\/\/[a-z0-9.-]+\//);
      expect(feed.accept.length).toBeGreaterThan(0);
    }
  });

  it('negative: a source the frontend lists but Rust has no address for is a problem', () => {
    const { feeds, problems } = canaryFeeds(KEYLESS_RS, ['arbeitnow', 'newfeed' as never]);
    expect(feeds.map((feed) => feed.source)).toEqual(['arbeitnow']);
    expect(problems.join('\n')).toMatch(/newfeed/);
  });

  it('negative: an address in keyless.rs for a source the frontend does not list is a problem', () => {
    const rust = KEYLESS_RS.replace(
      'KeylessSource::Arbeitnow => "https://www.arbeitnow.com/api/job-board-api",',
      'KeylessSource::Arbeitnow => "https://www.arbeitnow.com/api/job-board-api",\n' +
        '            KeylessSource::OtherBoard => "https://other.example.com/feed",',
    );
    expect(rust).not.toBe(KEYLESS_RS);
    expect(canaryFeeds(rust).problems.join('\n')).toMatch(/other_board/);
  });

  it('a commented-out arm is not a feed, and the live arm beside it still is', () => {
    const rust = KEYLESS_RS.replace(
      'KeylessSource::Arbeitnow => "https://www.arbeitnow.com/api/job-board-api",',
      'KeylessSource::Arbeitnow => "https://www.arbeitnow.com/api/job-board-api", // live\n' +
        '            // KeylessSource::Guardian => "https://jobs.example.com/rss",',
    );
    expect(rust).not.toBe(KEYLESS_RS);
    const { feeds, problems } = canaryFeeds(rust);
    expect(problems).toEqual([]);
    expect(feeds.map((feed) => feed.url)).toEqual(['https://www.arbeitnow.com/api/job-board-api']);
  });

  it('negative: a keyless.rs the canary cannot read is a problem, never an empty pass', () => {
    const { feeds, problems } = canaryFeeds('fn nothing_here() {}');
    expect(feeds).toEqual([]);
    expect(problems.length).toBeGreaterThan(0);
  });
});

// ── One feed ───────────────────────────────────────────────────────────────

describe('checkFeed', () => {
  it('(a) the recorded Arbeitnow page passes, through the real normaliser', async () => {
    const verdict = await checkFeed(FEED, always(json(FIXTURE)));
    expect(verdict.problems).toEqual([]);
    // 19 adverts in the fixture, all with a title and a link. Both pages get
    // the same body here, and the browse folds the repeats by slug.
    expect(verdict.usable).toBe(19);
  });

  it('(b) an HTML page answered with a 200 fails, and says it is a web page', async () => {
    const verdict = await checkFeed(
      FEED,
      always({
        kind: 'answered',
        status: 200,
        contentType: 'text/html; charset=UTF-8',
        location: null,
        body: GUARDIAN_STYLE_PAGE,
      }),
    );
    expect(verdict.usable).toBe(0);
    const said = verdict.problems.join('\n');
    expect(said).toMatch(/text\/html/);
    expect(said).toMatch(/web page/i);
    expect(said).toMatch(/Arbeitnow/);
  });

  it('(b) the same page mislabelled as JSON still fails, because it does not parse', async () => {
    const verdict = await checkFeed(FEED, always(json(GUARDIAN_STYLE_PAGE)));
    expect(verdict.usable).toBe(0);
    expect(verdict.problems.join('\n')).toMatch(/could not read/i);
  });

  it('(c) valid JSON with no adverts in it fails', async () => {
    const verdict = await checkFeed(FEED, always(json('{"data":[]}')));
    expect(verdict.usable).toBe(0);
    expect(verdict.problems.join('\n')).toMatch(/no jobs/i);
  });

  it('(d) a 404 fails, naming the status', async () => {
    const verdict = await checkFeed(FEED, always(json('{"message":"Not Found"}', 404)));
    expect(verdict.problems.join('\n')).toMatch(/HTTP 404/);
  });

  it('(d) a redirect fails, naming where it pointed — a feed that moved is not followed', async () => {
    const verdict = await checkFeed(
      FEED,
      always({
        kind: 'answered',
        status: 301,
        contentType: 'text/html',
        location: 'https://feed.example.com/news/we-have-closed',
        body: '',
      }),
    );
    const said = verdict.problems.join('\n');
    expect(said).toMatch(/HTTP 301/);
    expect(said).toMatch(/we-have-closed/);
  });

  it('(d) a request that never completes fails', async () => {
    const verdict = await checkFeed(FEED, always({ kind: 'unreachable', reason: 'ENOTFOUND' }));
    expect(verdict.problems.join('\n')).toMatch(/ENOTFOUND/);
  });

  it('(d) page 1 fine and page 2 broken still fails: the app reads both', async () => {
    const pages: FetchFeedPage = (_feed, page) =>
      Promise.resolve(page === 1 ? json(FIXTURE) : json('', 503));
    const verdict = await checkFeed(FEED, pages);
    expect(verdict.problems.join('\n')).toMatch(/page 2.*HTTP 503/);
  });

  it('(e) boundary: exactly one usable advert passes', async () => {
    const body = oneAdvert({ title: 'Nurse', url: 'https://feed.example.com/jobs/nurse' });
    const verdict = await checkFeed(FEED, always(json(body)));
    expect(verdict.problems).toEqual([]);
    expect(verdict.usable).toBe(1);
  });

  it('(e) boundary: one advert with no link is not usable, so it fails', async () => {
    const verdict = await checkFeed(FEED, always(json(oneAdvert({ title: 'Nurse' }))));
    expect(verdict.usable).toBe(0);
    expect(verdict.problems.join('\n')).toMatch(/title and a link/);
  });

  it('a content type with parameters is still the type the app asked for', async () => {
    const verdict = await checkFeed(
      FEED,
      always({
        ...json(FIXTURE),
        contentType: 'Application/JSON; charset=utf-8',
      } as FeedReply),
    );
    expect(verdict.problems).toEqual([]);
  });

  it('negative: a reply with no content type at all fails', async () => {
    const verdict = await checkFeed(
      FEED,
      always({ ...json(FIXTURE), contentType: null } as FeedReply),
    );
    expect(verdict.problems.join('\n')).toMatch(/content type/i);
  });
});

// ── The HTTP half, with a fake fetch ───────────────────────────────────────

describe('httpFeedFetcher', () => {
  it('asks for the page, the way the app does, and never follows a redirect', async () => {
    const seen: { url: string; init: RequestInit | undefined }[] = [];
    const fake = (input: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(input), init });
      return Promise.resolve(
        new Response('{"data":[]}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    };

    const reply = await httpFeedFetcher(fake as typeof fetch, 5_000)(FEED, 2);

    expect(reply).toEqual({
      kind: 'answered',
      status: 200,
      contentType: 'application/json',
      location: null,
      body: '{"data":[]}',
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe('https://feed.example.com/api/job-board-api?page=2');
    expect(seen[0]?.init?.redirect).toBe('manual');
    const headers = new Headers(seen[0]?.init?.headers);
    expect(headers.get('accept')).toBe('application/json');
    expect(headers.get('user-agent')).toBe('CViperLight');
    expect(seen[0]?.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('(d) a non-2xx comes back as the status, with the redirect target', async () => {
    const fake = () =>
      Promise.resolve(
        new Response(null, { status: 301, headers: { location: 'https://feed.example.com/gone' } }),
      );
    const reply = await httpFeedFetcher(fake as typeof fetch, 5_000)(FEED, 1);
    expect(reply).toMatchObject({
      kind: 'answered',
      status: 301,
      location: 'https://feed.example.com/gone',
    });
  });

  it('(d) a network error comes back as unreachable, never thrown and never a pass', async () => {
    const fake = () => Promise.reject(new TypeError('fetch failed'));
    const reply = await httpFeedFetcher(fake as typeof fetch, 5_000)(FEED, 1);
    expect(reply).toEqual({ kind: 'unreachable', reason: 'fetch failed' });
  });
});

// ── The whole run ──────────────────────────────────────────────────────────

describe('runFeedCanary', () => {
  it('passes when every feed in keyless.rs answers with usable adverts', async () => {
    const result = await runFeedCanary(KEYLESS_RS, always(json(FIXTURE)));
    expect(result.problems).toEqual([]);
    expect(result.verdicts.map((verdict) => verdict.source)).toEqual([...KEYLESS_SOURCE_IDS]);
  });

  it('fails when any feed fails', async () => {
    const result = await runFeedCanary(KEYLESS_RS, always(json('{"data":[]}')));
    expect(result.problems.length).toBeGreaterThan(0);
  });

  it('negative: no feeds found is a failure, not a quiet pass over nothing', async () => {
    const result = await runFeedCanary('fn nothing_here() {}', always(json(FIXTURE)));
    expect(result.verdicts).toEqual([]);
    expect(result.problems.length).toBeGreaterThan(0);
  });
});
