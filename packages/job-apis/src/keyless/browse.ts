/**
 * One browse of the keyless feeds.
 *
 * ============================================================================
 * THE ONE RULE: NO FAILURE MAY ARRIVE AS AN EMPTY LIST
 * ============================================================================
 * Free feeds rot quietly. A source that 404s, that has changed shape, or that
 * answers 200 with nothing in it will otherwise reach the screen as an empty
 * results list — which reads as "there are no jobs like that", which is the one
 * sentence the user cannot check and cannot act on.
 *
 * So every source's outcome carries three things, and the screen needs all
 * three to say the right sentence:
 *
 *   error   — the feed failed. Named, shown, and not the user's fault.
 *   fetched — how many adverts the feed published, BEFORE the local filter.
 *   jobs    — how many of them answer what the user typed.
 *
 * `error === null && fetched > 0 && jobs === []` is "nothing matched", and it
 * is a completely different sentence from any of the failures. It is also the
 * only one of them the user can do anything about.
 *
 * ============================================================================
 * EVERY SOURCE SUCCEEDS OR FAILS ON ITS OWN
 * ============================================================================
 * Same shape as `searchJobs`, and for the same reason: Guardian being down is
 * not a reason to throw away the Arbeitnow adverts the user was also waiting
 * for. There is no "the browse failed".
 *
 * ============================================================================
 * NO QUOTA, AND NO CREDENTIAL
 * ============================================================================
 * There is deliberately no `quota` in the request or the outcome. `quota.ts`
 * counts Reed's hundred-a-day allowance; a feed with no account has no
 * allowance, and counting a browse against Reed's would take real searches away
 * from the user for nothing. There is no key on this path either — see
 * `types.ts`, and the structural test in `keyless.rs`.
 */
import { type IsoTimestamp } from '@cviper/core-types';

import { type SearchResultJob } from '../normalise';

import { normaliseArbeitnowFeed } from './arbeitnow';
import {
  keylessEmptyFeed,
  keylessHttpStatusError,
  keylessUnreachable,
  type KeylessError,
} from './errors';
import { filterKeylessJobs, type KeylessFilter } from './filter';
import { normaliseGuardianFeed } from './guardian';
import {
  KEYLESS_PAGES,
  KEYLESS_SOURCE_IDS,
  type KeylessFetchTransport,
  type KeylessSourceId,
} from './types';

export interface KeylessBrowseRequest {
  /** The feeds the user has ticked. One not listed is never contacted. */
  readonly sources: readonly KeylessSourceId[];
  /** What to narrow the published pages down to, ON THIS MACHINE. */
  readonly filter: KeylessFilter;
  readonly createdAt: IsoTimestamp;
  readonly newId: () => string;
}

export interface KeylessSourceOutcome {
  readonly source: KeylessSourceId;
  /**
   * How many adverts the feed published, before the local filter ran.
   *
   * The number that lets the screen tell "this feed is dead" from "your words
   * matched none of what it published". Without it the two are the same empty
   * list.
   */
  readonly fetched: number;
  /** The adverts that answer the filter, in the order the feed published them. */
  readonly jobs: readonly SearchResultJob[];
  /**
   * What went wrong, or `null`.
   *
   * NOT exclusive with `jobs`: when page 1 arrives and page 2 fails, the user
   * keeps page 1's adverts AND is told that part of the feed could not be read.
   * Dropping either half would be a lie — one about the adverts, one about how
   * much was actually looked at.
   */
  readonly error: KeylessError | null;
}

export interface KeylessBrowseOutcome {
  readonly outcomes: readonly KeylessSourceOutcome[];
  /** Every advert that answered, from every feed, in source order. */
  readonly jobs: readonly SearchResultJob[];
}

/** Which reader reads which feed. */
const READERS = {
  arbeitnow: normaliseArbeitnowFeed,
  guardian: normaliseGuardianFeed,
} as const;

interface Collected {
  readonly jobs: SearchResultJob[];
  readonly error: KeylessError | null;
}

/**
 * Read one source, page by page, stopping at the first page that fails.
 *
 * Sequential rather than parallel, on purpose: Arbeitnow's own terms say
 * "please do not abuse", and two requests to the same host in the same
 * millisecond is the shape of thing that gets a free feed closed. Sources run
 * in parallel with each other, because they are different servers.
 */
async function collect(
  transport: KeylessFetchTransport,
  source: KeylessSourceId,
  request: KeylessBrowseRequest,
): Promise<Collected> {
  const jobs: SearchResultJob[] = [];
  /*
    ============================================================================
    THE SAME ADVERT CAN LEGITIMATELY ARRIVE ON BOTH PAGES
    ============================================================================
    Arbeitnow updates hourly and orders newest first, so one advert posted
    between our two fetches shifts the page boundary by one and the last advert
    of page 1 comes back as the first of page 2. Listed twice it reads as two
    jobs; worse, the cross-post check then flags the pair as "2 similar
    postings", which is a confident wrong statement about one advert.

    Keyed by the feed's own id, so two genuinely different adverts are never
    folded together. An advert with no id is kept — dropping unidentifiable rows
    would lose real jobs to protect against a duplicate we cannot prove.
  */
  const seen = new Set<string>();
  const pages = KEYLESS_PAGES[source];

  for (let page = 1; page <= pages; page += 1) {
    let reply;
    try {
      reply = await transport.fetch(source, page);
    } catch {
      // A transport is not supposed to throw; a broken IPC or an unregistered
      // command does. Never swallowed — it becomes the same visible per-source
      // message every other failure becomes.
      return { jobs, error: keylessUnreachable(source) };
    }

    if (!reply.ok) return { jobs, error: reply.error };

    const { status, body } = reply.value;
    if (status < 200 || status >= 300) {
      return { jobs, error: keylessHttpStatusError(source, status) };
    }

    const parsed = READERS[source](body, {
      createdAt: request.createdAt,
      newId: request.newId,
    });
    if (!parsed.ok) return { jobs, error: parsed.error };

    for (const entry of parsed.value) {
      const id = entry.job.external_id;
      if (id !== null) {
        if (seen.has(id)) continue;
        seen.add(id);
      }
      jobs.push(entry);
    }
  }

  return { jobs, error: null };
}

/**
 * Browse the feeds the user ticked, and narrow what comes back on this machine.
 *
 * Never rejects and never returns a `Result`: there is no such thing as "the
 * browse failed", only per-source outcomes the screen renders side by side.
 */
export async function browseKeylessJobs(
  transport: KeylessFetchTransport,
  request: KeylessBrowseRequest,
): Promise<KeylessBrowseOutcome> {
  // Canonical order, deduplicated. The UI can pass its checkbox state in any
  // order, and a repeated source is a bug in the caller rather than a reason to
  // ask a free feed for the same page twice.
  const wanted = KEYLESS_SOURCE_IDS.filter((source) => request.sources.includes(source));

  const collected = await Promise.all(
    wanted.map(async (source) => ({ source, ...(await collect(transport, source, request)) })),
  );

  const outcomes: KeylessSourceOutcome[] = collected.map(({ source, jobs, error }) => ({
    source,
    fetched: jobs.length,
    jobs: filterKeylessJobs(jobs, request.filter),
    // A feed that answered, parsed, and held NOTHING has stopped working. This
    // is the failure that would otherwise be completely silent, and it is the
    // reason this function exists rather than the UI calling the readers.
    error: error ?? (jobs.length === 0 ? keylessEmptyFeed(source) : null),
  }));

  return { outcomes, jobs: outcomes.flatMap((outcome) => outcome.jobs) };
}
