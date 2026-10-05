/**
 * Running one fetch: what reaches the network, and what one failure looks like.
 *
 * ============================================================================
 * THE TWO PROMISES THIS FILE EXISTS FOR
 * ============================================================================
 * 1. A BLOCKED DOMAIN MAKES NO REQUEST AT ALL. Not a request that is thrown
 *    away, not a request that is cancelled — none. The transport FACTORY is
 *    injected, and the tests below fail if it is so much as called, so "this
 *    path cannot reach the network" is provable rather than intended. Same
 *    device as `runExtraction.test.ts`.
 *
 * 2. EVERY FAILURE PRODUCES THE SAME SENTENCE. A timeout, a 404, a PDF, a
 *    login wall, a blocked redirect and a blocklisted domain are six different
 *    things to a developer and one thing to somebody trying to record a job:
 *    the page did not come, open it yourself. A raw error, a status code or a
 *    kind string reaching the user would be six different dead ends instead.
 *    The one exception (L-188) is a site we KNOW refuses apps — blocklisted,
 *    or a 401, 403 or 999 — which is told so, with the same route forward.
 */
import { describe, expect, it, vi } from 'vitest';

import { err, ok, type Result } from '@cviper/core-types';

import { MAX_DESCRIPTION_LENGTH } from './model';
import { FETCH_FALLBACK_NOTE, FETCH_SITE_REFUSES_NOTE, runFetch } from './runFetch';
import type { FetchedPage, PageFetchError, PageFetchTransport } from './pageFetch';

/** A page long enough to be a real advert. */
const ADVERT_PAGE = `<!DOCTYPE html><html><body>
  <nav>Home Jobs Risk</nav>
  <main>
    <h1>Credit Risk Analyst</h1>
    <p>Lloyds Banking Group &middot; City of London (hybrid, 3 days on site)</p>
    <p>&pound;45,000 &ndash; &pound;55,000 per annum plus bonus.</p>
    <p>You will sit in second-line credit risk for the wholesale book, reviewing
    limit applications from the corporate and institutional coverage teams and
    challenging the assumptions behind them. Experience of corporate credit
    analysis in a bank or a rating agency is essential, along with the
    confidence to say no to a relationship manager who does not want to hear it.
    Study support for ACCA or CFA is available, and the team sits three days a
    week in the City office with the rest of the week worked from home.</p>
  </main>
  <footer>&copy; 2026 Lloyds. Cookies. Privacy.</footer>
</body></html>`;

/** A transport that answers with one reply and counts how often it was asked. */
function transportFor(
  reply: Result<FetchedPage, PageFetchError>,
): PageFetchTransport & { calls: number } {
  const state = { calls: 0 };
  return {
    get calls() {
      return state.calls;
    },
    fetchPage(): Promise<Result<FetchedPage, PageFetchError>> {
      state.calls += 1;
      return Promise.resolve(reply);
    },
  };
}

/** A factory that fails the test if anything ever asks it for a transport. */
function forbiddenTransport(): PageFetchTransport {
  throw new Error('the network was reached on a path that must never reach it');
}

describe('a page that can be read', () => {
  it('comes back as the advert text, chrome and markup gone', async () => {
    const outcome = await runFetch('https://jobs.example.com/advert/1', () =>
      transportFor(ok({ status: 200, body: ADVERT_PAGE })),
    );

    expect(outcome.available).toBe(true);
    expect(outcome.reason).toBeNull();
    expect(outcome.text).toContain('Credit Risk Analyst');
    expect(outcome.text).toContain('£45,000 – £55,000');
    expect(outcome.text).not.toContain('Cookies. Privacy.');
    expect(outcome.text).not.toContain('<');
  });

  it('asks for exactly the address it was given, once', async () => {
    const transport = transportFor(ok({ status: 200, body: ADVERT_PAGE }));
    const fetchPage = vi.spyOn(transport, 'fetchPage');

    await runFetch('  https://jobs.example.com/advert/1  ', () => transport);

    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledWith('https://jobs.example.com/advert/1');
  });
});

describe('a domain on the blocklist', () => {
  it('makes NO request at all — the transport is never even built', async () => {
    const outcome = await runFetch('https://uk.indeed.com/viewjob?jk=abc', forbiddenTransport);

    expect(outcome.available).toBe(false);
    // L-188: a blocklisted site is told as what it is — see the next block.
    expect(outcome.reason).toBe(FETCH_SITE_REFUSES_NOTE);
  });

  it('covers subdomains, because that is where the adverts actually live', async () => {
    for (const address of [
      'https://www.linkedin.com/jobs/view/4012345678/',
      'https://uk.indeed.com/viewjob?jk=abc',
      'https://www.indeed.com/viewjob?jk=abc',
      'https://gb.linkedin.com/jobs/view/1/',
    ]) {
      const outcome = await runFetch(address, forbiddenTransport);
      expect(outcome.available).toBe(false);
    }
  });

  it('the guard would notice a request — proved, not assumed', async () => {
    // A guard that cannot fail is worse than no guard. The same forbidden
    // factory, the same call, an address that is NOT on the list: it throws,
    // which is how we know the blocked cases above were silent because nothing
    // asked rather than because nothing counts.
    await expect(runFetch('https://jobs.example.com/advert/1', forbiddenTransport)).rejects.toThrow(
      /must never reach it/,
    );
  });
});

describe('a site that refuses apps (L-188)', () => {
  // The address from the bug report, tracking query and all. A LinkedIn job
  // link with a long query is the most common thing anyone pastes into Fetch.
  const REPORTED =
    'https://www.linkedin.com/jobs/view/4445438506/?alternateChannel=search' +
    '&eBP=CwEAAAGd8yKZaqfXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX' +
    '&refId=abcdEFGH%3D%3D&trackingId=ijklMNOP%3D%3D';

  it('the reported LinkedIn link makes no request and says the site blocks apps', async () => {
    const outcome = await runFetch(REPORTED, forbiddenTransport);

    expect(outcome.available).toBe(false);
    expect(outcome.text).toBe('');
    expect(outcome.reason).toBe(FETCH_SITE_REFUSES_NOTE);
  });

  it('every blocklisted address gets the same site-refuses sentence', async () => {
    for (const address of [
      'https://www.linkedin.com/jobs/view/4012345678/',
      'https://gb.linkedin.com/jobs/view/1/',
      'https://www.linkedin.com/jobs/search/?currentJobId=4445438506',
      'https://www.indeed.com/viewjob?jk=abc',
    ]) {
      const outcome = await runFetch(address, forbiddenTransport);
      expect(outcome.reason, address).toBe(FETCH_SITE_REFUSES_NOTE);
    }
  });

  it('a site that answers 401, 403 or 999 is refusing apps, and is told so', async () => {
    // 999 is LinkedIn's own non-standard "not for bots" status; 401 and 403
    // are the standard ways a site says "not to you".
    for (const status of [401, 403, 999]) {
      const outcome = await runFetch('https://jobs.example.com/1', () =>
        transportFor(ok({ status, body: ADVERT_PAGE })),
      );
      expect(outcome.available, String(status)).toBe(false);
      expect(outcome.reason, String(status)).toBe(FETCH_SITE_REFUSES_NOTE);
    }
  });

  it('boundary: the statuses either side of those are not a refusal', async () => {
    for (const status of [400, 402, 404, 998, 1000]) {
      const outcome = await runFetch('https://jobs.example.com/1', () =>
        transportFor(ok({ status, body: ADVERT_PAGE })),
      );
      expect(outcome.available, String(status)).toBe(false);
      expect(outcome.reason, String(status)).toBe(FETCH_FALLBACK_NOTE);
    }
  });

  it('negative: a lookalike domain is not blocklisted, so it is asked, and a plain failure stays plain', async () => {
    for (const address of [
      'https://notlinkedin.com/jobs/view/1/',
      'https://linkedin.com.example.test/jobs/view/1/',
    ]) {
      const transport = transportFor(err({ kind: 'network', message: 'unreachable' }));
      const outcome = await runFetch(address, () => transport);
      expect(transport.calls, address).toBe(1);
      expect(outcome.reason, address).toBe(FETCH_FALLBACK_NOTE);
    }
  });

  it('negative: a Rust "blocked" refusal is about OUR rules, not the site, and keeps the plain note', async () => {
    // A private address or a redirect off the site is this app refusing, and
    // "this site blocks apps" would be a false thing to say about it.
    const outcome = await runFetch('https://jobs.example.com/1', () =>
      transportFor(
        err({ kind: 'blocked', message: 'That address is not one this app will open.' }),
      ),
    );

    expect(outcome.reason).toBe(FETCH_FALLBACK_NOTE);
  });

  it('the sentence says the site blocks apps, that pasting works, and nothing else', () => {
    expect(FETCH_SITE_REFUSES_NOTE).toMatch(/blocks apps from reading its pages/i);
    expect(FETCH_SITE_REFUSES_NOTE).toMatch(/paste/i);
    expect(FETCH_SITE_REFUSES_NOTE).toMatch(/works/i);
    expect(FETCH_SITE_REFUSES_NOTE).toMatch(/browser/i);
    // Never a status code, and never a claim that the advert is gone — it is
    // there, the site just will not hand it to an app.
    expect(FETCH_SITE_REFUSES_NOTE).not.toMatch(/[0-9]/);
    for (const untrue of ['not exist', 'not found', 'no longer', 'removed', 'expired', 'error']) {
      expect(FETCH_SITE_REFUSES_NOTE.toLowerCase(), untrue).not.toContain(untrue);
    }
  });
});

describe('every other way it can go wrong', () => {
  const refusals: ReadonlyArray<readonly [string, PageFetchError]> = [
    ['a timeout', { kind: 'network', message: 'That page took too long to answer.' }],
    ['an unreachable host', { kind: 'network', message: 'That page could not be reached.' }],
    [
      'a blocked redirect',
      { kind: 'blocked', message: 'That address is not one this app will open.' },
    ],
    ['a page that is too big', { kind: 'too-large', message: 'That page is too big to read.' }],
    ['a PDF', { kind: 'unsupported', message: 'That link is not a web page the app can read.' }],
    [
      'an address Rust would not parse',
      { kind: 'bad-url', message: 'That does not look like a web address the app can open.' },
    ],
    ['a broken IPC', { kind: 'bad-response', message: 'That page could not be fetched.' }],
  ];

  for (const [label, error] of refusals) {
    it(`${label} produces the one guided message`, async () => {
      const outcome = await runFetch('https://jobs.example.com/1', () => transportFor(err(error)));

      expect(outcome.available).toBe(false);
      expect(outcome.text).toBe('');
      expect(outcome.reason).toBe(FETCH_FALLBACK_NOTE);
    });
  }

  it('a 404 is a failure even though the request succeeded', async () => {
    const outcome = await runFetch('https://jobs.example.com/gone', () =>
      transportFor(ok({ status: 404, body: '<html><body><h1>Not found</h1></body></html>' })),
    );

    expect(outcome.available).toBe(false);
    expect(outcome.reason).toBe(FETCH_FALLBACK_NOTE);
  });

  it('boundary: 200 and 299 are pages, 199 and 300 are not', async () => {
    for (const status of [200, 299]) {
      const outcome = await runFetch('https://jobs.example.com/1', () =>
        transportFor(ok({ status, body: ADVERT_PAGE })),
      );
      expect(outcome.available).toBe(true);
    }
    for (const status of [199, 300, 301, 500]) {
      const outcome = await runFetch('https://jobs.example.com/1', () =>
        transportFor(ok({ status, body: ADVERT_PAGE })),
      );
      expect(outcome.available).toBe(false);
    }
  });

  it('a login wall is a failure, not a very short advert', async () => {
    const wall =
      '<html><body><main><h1>Sign in to see this job</h1><p>Join now.</p></main></body></html>';

    const outcome = await runFetch('https://jobs.example.com/1', () =>
      transportFor(ok({ status: 200, body: wall })),
    );

    expect(outcome.available).toBe(false);
    expect(outcome.reason).toBe(FETCH_FALLBACK_NOTE);
  });

  it('a JavaScript-only page is a failure too', async () => {
    const app = `<html><body><div id="root"></div><script>${'x'.repeat(50_000)}</script></body></html>`;

    const outcome = await runFetch('https://jobs.example.com/1', () =>
      transportFor(ok({ status: 200, body: app })),
    );

    expect(outcome.available).toBe(false);
  });
});

describe('what the user is told', () => {
  it('the message says what to do and never how it broke', async () => {
    expect(FETCH_FALLBACK_NOTE).toMatch(/open/i);
    expect(FETCH_FALLBACK_NOTE).toMatch(/paste/i);

    // No status code, no error kind, no jargon. A number in this sentence would
    // be an HTTP status leaking into a screen the user cannot act on.
    expect(FETCH_FALLBACK_NOTE).not.toMatch(/[0-9]/);
    for (const leak of [
      'blocked',
      'network',
      'unsupported',
      'bad-url',
      'timeout',
      'error',
      'HTTP',
    ]) {
      expect(FETCH_FALLBACK_NOTE.toLowerCase()).not.toContain(leak.toLowerCase());
    }
  });

  it('nothing a refusal carried ever reaches the user', async () => {
    // The Rust message is safe by construction, and it is STILL not shown —
    // one message means one message.
    const outcome = await runFetch('https://jobs.example.com/1', () =>
      transportFor(
        err({ kind: 'blocked', message: 'That address is not one this app will open.' }),
      ),
    );

    expect(outcome.reason).toBe(FETCH_FALLBACK_NOTE);
    expect(outcome.reason).not.toContain('address is not one');
  });
});

describe('what the user typed', () => {
  it('negative: an empty address makes no request', async () => {
    for (const raw of ['', '   ', '\n\t ']) {
      const outcome = await runFetch(raw, forbiddenTransport);
      expect(outcome.available).toBe(false);
      expect(outcome.reason).toBe(FETCH_FALLBACK_NOTE);
    }
  });

  it('negative: an address in a scheme we will not open makes no request', async () => {
    // Rust refuses these too. Refusing them here as well means the user finds
    // out immediately rather than after a round trip, and it is why the "no
    // request was made" promise can be checked at all.
    for (const raw of [
      'file:///C:/Windows/win.ini',
      'javascript:alert(1)',
      'data:text/html,<h1>hi</h1>',
      'ftp://example.com/pub',
      'not a url at all',
      'jobs.example.com/advert/1',
    ]) {
      const outcome = await runFetch(raw, forbiddenTransport);
      expect(outcome.available).toBe(false);
      expect(outcome.reason).toBe(FETCH_FALLBACK_NOTE);
    }
  });

  it('boundary: http as well as https, because plenty of small sites are still http', async () => {
    for (const scheme of ['http', 'https']) {
      const outcome = await runFetch(`${scheme}://jobs.example.com/1`, () =>
        transportFor(ok({ status: 200, body: ADVERT_PAGE })),
      );
      expect(outcome.available).toBe(true);
    }
  });

  it('boundary: an address with a port and a query is fetched as typed', async () => {
    const transport = transportFor(ok({ status: 200, body: ADVERT_PAGE }));
    const fetchPage = vi.spyOn(transport, 'fetchPage');

    await runFetch('https://jobs.example.com:8443/advert?id=1&ref=2', () => transport);

    expect(fetchPage).toHaveBeenCalledWith('https://jobs.example.com:8443/advert?id=1&ref=2');
  });
});

describe('a page longer than a saved description can be (L-207)', () => {
  it('is kept to the first MAX_DESCRIPTION_LENGTH characters and says it was cut', async () => {
    const body = `<main><p>${'Credit risk analyst. '.repeat(4000)}</p></main>`;
    const outcome = await runFetch('https://jobs.example.com/advert/long', () =>
      transportFor(ok({ status: 200, body })),
    );
    expect(outcome.available).toBe(true);
    expect(outcome.capped).toBe(true);
    expect(outcome.text.length).toBeLessThanOrEqual(MAX_DESCRIPTION_LENGTH);
  });

  it('an ordinary page is not marked as cut', async () => {
    const outcome = await runFetch('https://jobs.example.com/advert/1', () =>
      transportFor(ok({ status: 200, body: ADVERT_PAGE })),
    );
    expect(outcome.capped).toBe(false);
  });
});
