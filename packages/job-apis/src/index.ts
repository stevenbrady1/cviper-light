/**
 * @cviper/job-apis - job board clients (Adzuna, Reed) and keyless search links.
 *
 * ============================================================================
 * NO NETWORK, NO KEYS, NO CLOCK OF ITS OWN.
 * ============================================================================
 * This package builds typed search parameters and reads response bodies. It
 * does not know a base URL, it has never seen an API key, and it cannot reach
 * the network: a `JobSearchTransport` is injected, and in the app that is a
 * thin wrapper over `invoke()` into Rust. See `src-tauri/src/jobs.rs`.
 *
 * The normalisation, the Reed salary-period fix and the duplicate fingerprint
 * are PORTS, not fresh designs - from `backend/job_sites_api.py` and
 * `backend/helpers/dedupe_fingerprint.py` in the CViper web application. The
 * comments that explain WHY a rule is shaped the way it is are copied verbatim
 * from the source, because those are the ones that stop a later reader
 * "fixing" a deliberate decision back into a bug.
 */
export const JOB_APIS_PACKAGE = '@cviper/job-apis' as const;

// ── The contract ─────────────────────────────────────────────────────────────

export {
  JOB_PROVIDER_IDS,
  type JobApiHttpResponse,
  type JobProviderId,
  type JobSearchParams,
  type JobSearchTransport,
} from './types';

export {
  PROVIDER_LABEL,
  httpStatusError,
  jobApiError,
  type JobApiError,
  type JobApiErrorKind,
} from './errors';

// ── Building a search ────────────────────────────────────────────────────────

export {
  DEFAULT_RESULT_LIMIT,
  MAX_QUERY_CHARS,
  PROVIDER_RESULT_CAP,
  buildSearchParams,
  type SearchInput,
} from './params';

// ── Reading a response ───────────────────────────────────────────────────────

export {
  UNKNOWN_COMPANY,
  normaliseAdzunaResponse,
  normaliseReedResponse,
  reedPostedDate,
  type NormaliseContext,
  type SearchResultJob,
} from './normalise';

export { DAY_RATE_CEILING, classifyReedSalaryPeriod, type ReedSalaryPeriod } from './reed-salary';

export {
  REED_CONTRACT_SIGNALS,
  classifyReedContractType,
  type ReedContractType,
  type ReedJobFields,
} from './reed-contract';

export {
  DESCRIPTION_MAX_CHARS,
  normaliseDescription,
  toIsoDateOrNull,
  unescapeHtmlEntities,
} from './text';

// ── Running a search ─────────────────────────────────────────────────────────

export {
  searchJobs,
  type JobSearchOutcome,
  type JobSearchRequest,
  type ProviderOutcome,
} from './search';

// ── Cross-post detection: FLAG, never merge ──────────────────────────────────

export { findCrossPostClusters, type DuplicateCluster } from './clusters';

export {
  FINGERPRINT_BITS,
  FINGERPRINT_VERSION,
  MERGE_MAX_HAMMING,
  MIN_FINGERPRINT_TOKENS,
  SHINGLE_SIZE,
  computeFingerprint,
  fingerprintFromStorage,
  fingerprintToStorage,
  hammingDistance,
  isDuplicateMatch,
  normaliseTokens,
  shingles,
} from './fingerprint';

// ── Keyless browser links: no key, no scraper, no account ────────────────────

export { buildIndeedSearchUrl, buildLinkedInSearchUrl, type BrowserSearchInput } from './links';

// ── The daily request budget ─────────────────────────────────────────────────

export {
  PROVIDER_DAILY_LIMIT,
  QUOTA_BLOCK_AT,
  QUOTA_RESERVE,
  QUOTA_WARN_AT,
  REED_DAILY_LIMIT,
  emptyQuota,
  parseQuotaState,
  quotaVerdict,
  recordProviderRequest,
  rollOverQuota,
  utcDateOf,
  type QuotaCounts,
  type QuotaState,
  type QuotaStatus,
  type QuotaVerdict,
} from './quota';
