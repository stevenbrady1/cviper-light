/**
 * The job-provider contract.
 *
 * ============================================================================
 * THIS PACKAGE NEVER TOUCHES THE NETWORK AND NEVER SEES AN API KEY.
 * ============================================================================
 * It builds typed search parameters and reads response bodies. A
 * `JobSearchTransport` moves the bytes; in the app that is a thin wrapper over
 * `invoke()` into Rust, where the base URL lives and where the key is fetched
 * from the OS credential store and dropped again. In tests it is a hand-written
 * fake returning recorded fixture payloads, so every parser and every failure
 * path is exercised without a socket.
 *
 * Note what `JobSearchParams` is NOT: it is not a URL, not a query string and
 * not a set of provider-specific field names. Rust maps these fields onto
 * `what`/`where` for Adzuna and `keywords`/`locationName` for Reed. A caller
 * cannot name a destination even by accident.
 */
import { type Result } from '@cviper/core-types';

import { type JobApiError } from './errors';

/** The two providers this package can search. A CLOSED SET. */
export type JobProviderId = 'adzuna' | 'reed';

/** Every provider this package knows, in the order the UI lists them. */
export const JOB_PROVIDER_IDS: readonly JobProviderId[] = ['adzuna', 'reed'];

/** What the user asked for, validated and clamped. Built by `buildSearchParams`. */
export interface JobSearchParams {
  readonly keywords: string;
  readonly location: string;
  /** Already clamped to the provider's documented maximum page size. */
  readonly limit: number;
  /** Radius in miles. `null` means "do not send a radius at all". */
  readonly distanceMiles: number | null;
  /** `null` means "do not send a salary floor at all". */
  readonly salaryMin: number | null;
  /** `null` means "both" - no employment-type filter is sent. */
  readonly employmentType: 'Contract' | 'Permanent' | null;
}

/** One HTTP exchange that actually completed. A non-2xx is still a response. */
export interface JobApiHttpResponse {
  readonly status: number;
  readonly body: string;
}

/**
 * How a provider search reaches the network. INJECTED, ALWAYS.
 *
 * `Err` means the request never completed. A 401 is `Ok` with `status: 401` -
 * this package decides what that means, because the provider's status line is
 * the only part of its error worth reading.
 */
export interface JobSearchTransport {
  search(
    provider: JobProviderId,
    params: JobSearchParams,
  ): Promise<Result<JobApiHttpResponse, JobApiError>>;
}
