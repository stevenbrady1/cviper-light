/**
 * One search, fanned out across the providers the user ticked.
 *
 * ============================================================================
 * EVERY PROVIDER SUCCEEDS OR FAILS ON ITS OWN.
 * ============================================================================
 * `searchJobs` does not return a `Result`. There is no such thing as "the
 * search failed" here, because Reed being down is not a reason to throw away
 * the Adzuna results the user was also waiting for. Each provider gets its own
 * outcome carrying either adverts or one error, and the UI renders both
 * outcomes side by side.
 *
 * ============================================================================
 * NOTHING HERE IS AUTOMATIC.
 * ============================================================================
 * This function is called from a submit handler and from nowhere else. There is
 * no debounce, no polling, no interval and no refetch-on-focus in this package,
 * on purpose: Reed's free tier is 100 requests a DAY, and a search-as-you-type
 * box would spend a third of that typing "credit risk analyst". A minimum gap
 * between submits is enforced in Rust as well - see `SUBMIT_MIN_INTERVAL` in
 * `src-tauri/src/jobs.rs` - because a disabled button is a suggestion and the
 * transport is the only place that can actually refuse.
 */
import { type IsoTimestamp, type Result } from '@cviper/core-types';

import { findCrossPostClusters, type DuplicateCluster } from './clusters';
import { httpStatusError, jobApiError, type JobApiError } from './errors';
import { normaliseAdzunaResponse, normaliseReedResponse, type SearchResultJob } from './normalise';
import { buildSearchParams, type SearchInput } from './params';
import { quotaVerdict, recordProviderRequest, type QuotaState } from './quota';
import {
  JOB_PROVIDER_IDS,
  type JobApiHttpResponse,
  type JobProviderId,
  type JobSearchTransport,
} from './types';

export interface JobSearchRequest {
  /** The providers the user has ticked. One not listed is never contacted. */
  readonly providers: readonly JobProviderId[];
  readonly input: SearchInput;
  /** Today's counts. Returned updated - this function mutates nothing. */
  readonly quota: QuotaState;
  /** Today's UTC date. Supplied by the caller so this stays pure of clocks. */
  readonly today: string;
  readonly createdAt: IsoTimestamp;
  readonly newId: () => string;
}

/** What one provider had to say. `error` and a non-empty `jobs` are exclusive. */
export interface ProviderOutcome {
  readonly provider: JobProviderId;
  readonly jobs: readonly SearchResultJob[];
  readonly error: JobApiError | null;
}

export interface JobSearchOutcome {
  readonly outcomes: readonly ProviderOutcome[];
  /** Every advert from every provider that answered, in provider order. */
  readonly jobs: readonly SearchResultJob[];
  /** Adverts that look like the same role twice. NOTHING is removed for this. */
  readonly clusters: readonly DuplicateCluster[];
  /** The quota after this search, with one count per request actually sent. */
  readonly quota: QuotaState;
}

/** Which parser reads which provider. */
const PARSERS = {
  adzuna: normaliseAdzunaResponse,
  reed: normaliseReedResponse,
} as const;

/**
 * Ask one provider, and turn whatever comes back into an outcome.
 *
 * `sent` says whether the provider's daily allowance was actually spent, which
 * is true for a 401 and a timeout as much as for a page of results, and false
 * when we never left the process.
 */
async function askProvider(
  transport: JobSearchTransport,
  provider: JobProviderId,
  request: JobSearchRequest,
): Promise<{ outcome: ProviderOutcome; sent: boolean }> {
  const verdict = quotaVerdict(request.quota, provider, request.today);
  if (verdict.status === 'blocked') {
    // Nothing is sent, so nothing is counted. The message already explains
    // when the allowance comes back.
    return {
      outcome: {
        provider,
        jobs: [],
        error: jobApiError(provider, 'quota', verdict.message ?? 'Daily limit reached.'),
      },
      sent: false,
    };
  }

  const params = buildSearchParams(provider, request.input);
  if (!params.ok) {
    return { outcome: { provider, jobs: [], error: params.error }, sent: false };
  }

  let response: Result<JobApiHttpResponse, JobApiError>;
  try {
    response = await transport.search(provider, params.value);
  } catch {
    // A transport is not supposed to throw, but a broken IPC or an unregistered
    // command does. Never swallowed: it becomes a typed error the caller has to
    // narrow on before it can reach a value.
    //
    // Counted as SENT even though it probably was not. We cannot tell from here
    // whether the bytes left the machine, and the two mistakes are not equal: an
    // over-count costs one search out of a hundred, an under-count walks the
    // user into Reed's real wall with a counter that says there is room.
    return {
      outcome: {
        provider,
        jobs: [],
        error: jobApiError(
          provider,
          'network',
          'The search could not be sent. Try again in a moment.',
        ),
      },
      sent: true,
    };
  }

  if (!response.ok) {
    return { outcome: { provider, jobs: [], error: response.error }, sent: true };
  }

  const { status, body } = response.value;
  if (status < 200 || status >= 300) {
    return {
      outcome: { provider, jobs: [], error: httpStatusError(provider, status) },
      sent: true,
    };
  }

  const parsed = PARSERS[provider](body, {
    createdAt: request.createdAt,
    newId: request.newId,
  });

  return parsed.ok
    ? { outcome: { provider, jobs: parsed.value, error: null }, sent: true }
    : { outcome: { provider, jobs: [], error: parsed.error }, sent: true };
}

/**
 * Run one search.
 *
 * Providers are contacted in parallel because they are independent and a user
 * waiting on two sequential HTTP calls waits twice as long for no reason. The
 * Rust throttle is per provider for exactly this case: one submit reaching two
 * providers at once is one submit, not two.
 */
export async function searchJobs(
  transport: JobSearchTransport,
  request: JobSearchRequest,
): Promise<JobSearchOutcome> {
  // Canonical order, deduplicated. The UI can pass its checkbox state in any
  // order it likes, and a repeated provider is a bug in the caller rather than
  // a reason to spend the allowance twice.
  const wanted = JOB_PROVIDER_IDS.filter((provider) => request.providers.includes(provider));

  const results = await Promise.all(
    wanted.map((provider) => askProvider(transport, provider, request)),
  );

  let quota = request.quota;
  const outcomes: ProviderOutcome[] = [];
  for (const result of results) {
    outcomes.push(result.outcome);
    if (result.sent) quota = recordProviderRequest(quota, result.outcome.provider, request.today);
  }

  const jobs = outcomes.flatMap((outcome) => outcome.jobs);

  return {
    outcomes,
    jobs,
    clusters: findCrossPostClusters(jobs.map((entry) => entry.job)),
    quota,
  };
}
