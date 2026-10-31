/**
 * The keyless-feed canary (L-339): does every free job feed the app ships
 * still answer with jobs the app can show?
 *
 * Run daily by `.github/workflows/feed-canary.yml` through `runFeedCanary.ts`
 * (`pnpm canary:feeds`). The judgement is here and is unit-tested with no
 * network; the runner is the shell that makes the real requests.
 *
 * ============================================================================
 * WHY THIS EXISTS
 * ============================================================================
 * Guardian Jobs closed on 2 Sep 2026. Its feed address began redirecting to a
 * web page about the closure, which answered 200, and the app read that page
 * for two months before anybody noticed (retired in L-336/L-337). The app
 * itself already tells the USER when a feed fails; nothing told US. This does.
 *
 * ============================================================================
 * THE FEED LIST IS THE APP'S OWN, NEVER A SECOND COPY
 * ============================================================================
 * The addresses live in exactly one place, `src-tauri/src/keyless.rs`, as
 * `&'static str`s inside `fn base_url`, because Rust owns every address the
 * app can reach. They are read out of that file here, the way the Rust tests
 * read `errors.ts` and `types.ts` from the other side. Which feeds exist is
 * `KEYLESS_SOURCE_IDS`. Any disagreement between the two — a source with no
 * address, an address for a source the frontend does not list, a Rust enum
 * member the frontend does not know — is a FAILURE of the canary, never a feed
 * quietly left unchecked.
 *
 * ============================================================================
 * THE REAL CODE PATH, NOT A LOOK-ALIKE
 * ============================================================================
 * Each feed is read through `browseKeylessJobs`, the function the Search screen
 * calls: the same pages, the same reader, the same "an empty feed is a dead
 * feed" rule. Only the transport differs — `fetch` here, `invoke()` into Rust
 * in the app.
 *
 * It is stricter than the app in two places, on purpose, because both are how
 * the Guardian feed died without the app noticing:
 *
 *   * A REDIRECT IS A FAILURE. The app's HTTP client follows redirects; a feed
 *     that has moved is exactly when it should not be trusted to.
 *   * THE CONTENT TYPE MUST BE THE ONE THE APP ASKS FOR (`fn accept` in
 *     keyless.rs). A web page answering 200 is a dead feed, however healthy
 *     the status looks.
 *
 * ============================================================================
 * A FAILED CHECK IS NEVER A PASS
 * ============================================================================
 * No function here throws, and none can return "fine" for a feed it did not
 * read. Finding no feeds at all is a problem, not an empty success.
 */
import {
  browseKeylessJobs,
  keylessHttpStatusError,
  keylessUnreachable,
  keylessUnreadable,
  KEYLESS_SOURCE_IDS,
  KEYLESS_SOURCE_LABEL,
  type KeylessFetchTransport,
  type KeylessSourceId,
} from '@cviper/job-apis';
import { err, ok } from '@cviper/core-types';

/** One feed to check: which source, where it lives, and what it should send. */
export interface CanaryFeed {
  readonly source: KeylessSourceId;
  readonly url: string;
  readonly accept: string;
}

/** What one request for one page came back with. */
export type FeedReply =
  | {
      readonly kind: 'answered';
      readonly status: number;
      readonly contentType: string | null;
      readonly location: string | null;
      readonly body: string;
    }
  | { readonly kind: 'unreachable'; readonly reason: string };

/** How the canary reaches a feed. Injected, so the tests need no network. */
export type FetchFeedPage = (feed: CanaryFeed, page: number) => Promise<FeedReply>;

export interface FeedVerdict {
  readonly source: KeylessSourceId;
  /** Adverts the reader produced, before anything else was asked of them. */
  readonly fetched: number;
  /** Adverts with both a title and a link: the ones the app can show and credit. */
  readonly usable: number;
  /** Empty means this feed passed. */
  readonly problems: readonly string[];
}

export interface CanaryResult {
  readonly verdicts: readonly FeedVerdict[];
  /** Empty means every feed passed. */
  readonly problems: readonly string[];
}

/** What these requests call themselves — the same as `USER_AGENT` in keyless.rs. */
const USER_AGENT = 'CViperLight';

const KEYLESS_RS = 'apps/light/src-tauri/src/keyless.rs';

// ── Reading keyless.rs ─────────────────────────────────────────────────────

/**
 * One line with its `//` comment gone — but not the `//` of `"https://…"`.
 * A comment stripper that cannot see string literals deletes every address.
 */
function withoutLineComment(line: string): string {
  let inString = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (inString && char === '\\') {
      index += 1;
    } else if (char === '"') {
      inString = !inString;
    } else if (!inString && char === '/' && line[index + 1] === '/') {
      return line.slice(0, index);
    }
  }
  return line;
}

/** Everything before the test module, with `//` comments gone. */
function productionRust(rust: string): string {
  const cut = rust.indexOf('#[cfg(test)]');
  return (cut === -1 ? rust : rust.slice(0, cut)).split('\n').map(withoutLineComment).join('\n');
}

/** The text between the `{` after `opening` and the brace that closes it. */
function bracedBody(source: string, opening: RegExp): string | null {
  const match = opening.exec(source);
  if (match === null) return null;
  const start = source.indexOf('{', match.index + match[0].length - 1);
  if (start === -1) return null;
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start + 1, index);
    }
  }
  return null;
}

/** `OtherBoard` -> `other_board`, which is what `rename_all = "snake_case"` sends. */
function snakeCase(variant: string): string {
  return variant.replace(/(?<!^)([A-Z])/g, '_$1').toLowerCase();
}

/** The `KeylessSource::X => "literal"` arms of one `fn` in keyless.rs, by source id. */
function matchArms(rust: string, fnName: string): Map<string, string> {
  const body = bracedBody(productionRust(rust), new RegExp(`fn ${fnName}\\s*\\([^)]*\\)[^{]*\\{`));
  const arms = new Map<string, string>();
  if (body === null) return arms;
  for (const arm of body.matchAll(/KeylessSource::(\w+)\s*=>\s*"([^"]*)"/g)) {
    arms.set(snakeCase(arm[1] ?? ''), arm[2] ?? '');
  }
  return arms;
}

/** The members of `pub enum KeylessSource`, as the ids they travel as. */
export function rustKeylessVariants(rust: string): string[] {
  const body = bracedBody(productionRust(rust), /pub enum KeylessSource\s*\{/);
  if (body === null) return [];
  return [...body.matchAll(/^\s*([A-Z]\w*)\s*,?\s*$/gm)].map((member) =>
    snakeCase(member[1] ?? ''),
  );
}

/**
 * The feeds to check, read from keyless.rs and held against the frontend's list.
 *
 * `problems` is non-empty whenever the two disagree, so a feed added on either
 * side without the other is a red canary rather than a skipped one.
 */
export function canaryFeeds(
  rust: string,
  ids: readonly KeylessSourceId[] = KEYLESS_SOURCE_IDS,
): { feeds: CanaryFeed[]; problems: string[] } {
  const urls = matchArms(rust, 'base_url');
  const accepts = matchArms(rust, 'accept');
  const problems: string[] = [];
  const feeds: CanaryFeed[] = [];

  if (urls.size === 0) {
    problems.push(
      `No feed address was found in ${KEYLESS_RS} (fn base_url). The canary cannot see which ` +
        'feeds the app reads, so it cannot say any of them work.',
    );
  }

  for (const source of ids) {
    const url = urls.get(source);
    const accept = accepts.get(source);
    if (url === undefined || accept === undefined) {
      problems.push(
        `The app lists the keyless feed "${source}", but ${KEYLESS_RS} gives it no ` +
          `${url === undefined ? 'address (fn base_url)' : 'content type (fn accept)'}.`,
      );
      continue;
    }
    feeds.push({ source, url, accept });
  }

  const listed = new Set<string>(ids);
  for (const source of new Set([...urls.keys(), ...rustKeylessVariants(rust)])) {
    if (!listed.has(source)) {
      problems.push(
        `${KEYLESS_RS} has a keyless feed "${source}" that KEYLESS_SOURCE_IDS does not list, so ` +
          'the app never reads it and the canary would never check it.',
      );
    }
  }

  return { feeds, problems };
}

// ── Checking one feed ──────────────────────────────────────────────────────

/** `Application/JSON; charset=utf-8` -> `application/json`. */
function mediaType(value: string): string {
  return (value.split(';')[0] ?? '').trim().toLowerCase();
}

/**
 * Read one feed the way the Search screen does, and say what is wrong with it.
 *
 * Passes only when every page arrived as the content type the app asks for,
 * read cleanly through the real reader, and gave at least one advert with a
 * title (the card's heading, and what the local filter reads) and a link (the
 * credit the feed's own terms ask for).
 */
export async function checkFeed(
  feed: CanaryFeed,
  fetchPage: FetchFeedPage,
  now: Date = new Date(),
): Promise<FeedVerdict> {
  const { source, url } = feed;
  const label = KEYLESS_SOURCE_LABEL[source];
  const problems: string[] = [];
  const wanted = feed.accept.split(',').map(mediaType);

  const transport: KeylessFetchTransport = {
    async fetch(asked, page) {
      const reply = await fetchPage(feed, page);
      const where = `${label} page ${page} (${url})`;

      if (reply.kind === 'unreachable') {
        problems.push(`${where}: the request did not complete (${reply.reason}).`);
        return err(keylessUnreachable(asked));
      }

      if (reply.status < 200 || reply.status >= 300) {
        problems.push(
          reply.location === null
            ? `${where}: answered HTTP ${reply.status}.`
            : `${where}: answered HTTP ${reply.status}, redirecting to ${reply.location}. ` +
                'A feed that has moved is not followed: the app would be reading whatever that ' +
                'address serves now, which is how the closed Guardian feed went unnoticed.',
        );
        return err(keylessHttpStatusError(asked, reply.status));
      }

      if (reply.contentType === null) {
        problems.push(
          `${where}: answered HTTP ${reply.status} with no content type, so it cannot be told ` +
            `apart from a web page. The app asks for "${feed.accept}".`,
        );
        return err(keylessUnreadable(asked));
      }

      if (!wanted.includes(mediaType(reply.contentType))) {
        problems.push(
          `${where}: answered HTTP ${reply.status} with content type "${reply.contentType}", ` +
            `not "${feed.accept}". That is a web page or an error page, not the feed — the ` +
            'shape the closed Guardian feed took (L-336).',
        );
        return err(keylessUnreadable(asked));
      }

      return ok({ status: reply.status, body: reply.body });
    },
  };

  let next = 0;
  const { outcomes } = await browseKeylessJobs(transport, {
    sources: [source],
    filter: { keywords: '', location: '' },
    createdAt: now.toISOString(),
    newId: () => `canary-${(next += 1)}`,
  });

  const outcome = outcomes[0];
  if (outcome === undefined) {
    return {
      source,
      fetched: 0,
      usable: 0,
      problems: [...problems, `${label}: the browse returned no outcome for this feed at all.`],
    };
  }

  // The transport's own sentence is the clearer one when it has spoken. When it
  // has not, the failure was in the reading — unparseable, or empty.
  if (outcome.error !== null && problems.length === 0) {
    problems.push(`${label}: ${outcome.error.message}`);
  }

  const usable = outcome.jobs.filter(
    (entry) => entry.job.title.trim() !== '' && entry.job.url !== null,
  ).length;

  if (outcome.error === null && usable === 0) {
    problems.push(
      `${label}: ${outcome.fetched} advert(s) were read, but none had both a title and a link. ` +
        'The app needs both to show a job and credit the feed for it.',
    );
  }

  return { source, fetched: outcome.fetched, usable, problems };
}

// ── The real HTTP half ─────────────────────────────────────────────────────

/** `fetch failed (ENOTFOUND)` rather than a bare `fetch failed`. */
function describeFailure(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause: unknown = error.cause;
  if (cause instanceof Error) {
    const code = (cause as { code?: unknown }).code;
    return `${error.message} (${typeof code === 'string' ? code : cause.message})`;
  }
  return error.message;
}

/**
 * Pages over HTTP, asked for the way `keyless_fetch` asks: `?page=N`, the
 * feed's own `Accept`, the app's user agent, no credential.
 *
 * `redirect: 'manual'` so a 3xx comes back AS a 3xx — see the file header —
 * and a request that never completes comes back as `unreachable`, never thrown.
 */
export function httpFeedFetcher(fetchImpl: typeof fetch, timeoutMs: number): FetchFeedPage {
  return async (feed, page) => {
    const address = new URL(feed.url);
    address.searchParams.set('page', String(page));
    try {
      const response = await fetchImpl(address.toString(), {
        redirect: 'manual',
        headers: { accept: feed.accept, 'user-agent': USER_AGENT },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const body = await response.text();
      return {
        kind: 'answered',
        status: response.status,
        contentType: response.headers.get('content-type'),
        location: response.headers.get('location'),
        body,
      };
    } catch (error) {
      return { kind: 'unreachable', reason: describeFailure(error) };
    }
  };
}

// ── The whole run ──────────────────────────────────────────────────────────

/** Every keyless feed in keyless.rs, one after another. */
export async function runFeedCanary(rust: string, fetchPage: FetchFeedPage): Promise<CanaryResult> {
  const { feeds, problems } = canaryFeeds(rust);
  const verdicts: FeedVerdict[] = [];
  // One after another, not in parallel: these are free services, and a check
  // that runs once a day has no reason to hurry.
  for (const feed of feeds) {
    verdicts.push(await checkFeed(feed, fetchPage));
  }
  if (feeds.length === 0 && problems.length === 0) {
    problems.push('No keyless feeds were checked.');
  }
  return { verdicts, problems: [...problems, ...verdicts.flatMap((verdict) => verdict.problems)] };
}
