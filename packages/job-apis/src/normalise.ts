/**
 * Provider payload -> the shared `Job` type.
 *
 * ============================================================================
 * EVERY FIELD IS TREATED AS UNTRUSTED.
 * ============================================================================
 * Adzuna and Reed are third-party feeds that change without notice, and a job
 * advert is attacker-influenced text by definition - anyone can post one. So
 * nothing here indexes into a response and hopes: every read goes through a
 * checked accessor, one unusable record is skipped rather than allowed to lose
 * the page around it, and no function in this file can throw.
 *
 * ============================================================================
 * DELIBERATELY NOT PORTED: `_tag_affiliate_url`
 * ============================================================================
 * The web app appends `utm_source=cviper&utm_medium=job_board&utm_campaign=...`
 * to every outbound apply link. CViper Light does not, and will not. The
 * product promise is that nothing leaves the user's machine; a tagged link
 * announces them to a third party the moment they click it, and it does so
 * from a desktop app they cannot inspect. Recorded in docs/FEATURE-MATRIX.md
 * and asserted by a test in `normalise.test.ts`, so it cannot creep back in.
 */
import { err, ok, type IsoTimestamp, type Job, type Result } from '@cviper/core-types';

import { jobApiError, type JobApiError } from './errors';
import { toFiniteNumber } from './numbers';
import { classifyReedContractType, type ReedContractType } from './reed-contract';
import { classifyReedSalaryPeriod } from './reed-salary';
import { normaliseDescription, toIsoDateOrNull } from './text';
import { type JobProviderId } from './types';

/**
 * One advert, ready for the UI.
 *
 * `contractType` sits BESIDE the job rather than inside it because `Job` has no
 * column for it and the export format is additive-only forever - adding one
 * would be a `schemaVersion` bump and a decision on the cloud side. It is a
 * derived label for filtering and for a chip on the card, recomputed on every
 * search, so nothing is lost by not persisting it.
 */
export interface SearchResultJob {
  readonly job: Job;
  readonly contractType: ReedContractType;
}

/** What normalisation needs from the outside world: a clock and an id source. */
export interface NormaliseContext {
  /** The moment this search ran. ISO-8601 UTC, never a `Date`. */
  readonly createdAt: IsoTimestamp;
  /** Usually `crypto.randomUUID`. Injected so tests are deterministic. */
  readonly newId: () => string;
}

/** Shown when a provider omits the employer, which both of them sometimes do. */
export const UNKNOWN_COMPANY = 'Unknown';

/** Both providers are queried against the UK market - see `jobs.rs`. */
const CURRENCY = 'GBP';

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** A non-empty trimmed string, or `null`. Numbers are NOT coerced. */
function asText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * An external id, as a string.
 *
 * Adzuna sends `id` as a string and Reed sends `jobId` as a NUMBER. Both feed
 * `UNIQUE(source, external_id)`, so they have to agree on a type or the same
 * advert saves twice.
 */
function asExternalId(value: unknown): string | null {
  if (typeof value === 'string') return asText(value);
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

/** An `http`/`https` link, or `null`. Nothing else is a link worth offering. */
function asHttpUrl(value: unknown): string | null {
  const text = asText(value);
  if (text === null) return null;
  return /^https?:\/\//i.test(text) ? text : null;
}

/** Read the `results` array out of a provider body, or say why we cannot. */
function readResults(
  provider: JobProviderId,
  body: string,
): Result<readonly unknown[], JobApiError> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    return err(
      jobApiError(
        provider,
        'bad-response',
        'The reply from this job board could not be read. Try the search again.',
      ),
    );
  }

  const record = asRecord(parsed);
  const results = record?.['results'];
  if (!Array.isArray(results)) {
    return err(
      jobApiError(
        provider,
        'bad-response',
        'This job board sent a reply in an unexpected format. Try the search again.',
      ),
    );
  }

  return ok(results);
}

interface SalaryFields {
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  salary_period: Job['salary_period'];
}

/**
 * Build the four salary fields together, so they can never disagree.
 *
 * A currency or a period without a figure beside it is noise at best and a
 * claim we cannot support at worst, so all four are decided in one place.
 */
function salaryFields(min: unknown, max: unknown, period: Job['salary_period']): SalaryFields {
  const low = toFiniteNumber(min);
  const high = toFiniteNumber(max);

  if (low === null && high === null) {
    return { salary_min: null, salary_max: null, salary_currency: null, salary_period: null };
  }

  return {
    salary_min: low,
    salary_max: high,
    salary_currency: CURRENCY,
    salary_period: period,
  };
}

// ── Adzuna ───────────────────────────────────────────────────────────────────

/**
 * Adzuna's `location.display_name`, or the `area` array read backwards.
 *
 * `area` is ordered widest-first (`["UK", "London", "City of London"]`) while
 * `display_name` reads narrowest-first, so reversing produces a string in the
 * same shape rather than one that reads inside out.
 */
function adzunaLocation(result: Record<string, unknown>): string | null {
  const location = asRecord(result['location']);
  const display = asText(location?.['display_name']);
  if (display !== null) return display;

  const area = location?.['area'];
  if (!Array.isArray(area)) return null;

  const parts = area.map(asText).filter((part): part is string => part !== null);
  return parts.length === 0 ? null : parts.slice().reverse().join(', ');
}

/**
 * Adzuna's employment type, from the two fields it publishes.
 *
 * Ported from `AdzunaJobsAPI.search` (job_sites_api.py lines 1367-1371), which
 * reads `contract_type` and falls back to `contract_time`. Adzuna has no
 * free-text signals worth scanning and no bare-figure salary problem - its
 * numbers are annualised at source - so there is no equivalent of Reed's
 * three-tier fallback here.
 */
function adzunaContractType(result: Record<string, unknown>): ReedContractType {
  const raw = (
    asText(result['contract_type']) ??
    asText(result['contract_time']) ??
    ''
  ).toLowerCase();
  if (raw.includes('contract')) return 'Contract';
  if (raw.includes('part')) return 'Part-time';
  return 'Permanent';
}

function normaliseAdzunaRecord(raw: unknown, context: NormaliseContext): SearchResultJob | null {
  const result = asRecord(raw);
  if (result === null) return null;

  const title = asText(result['title']);
  // No title means nothing to show on a card and nothing to search within. The
  // row is unusable rather than merely incomplete.
  if (title === null) return null;

  return {
    job: {
      id: context.newId(),
      source: 'adzuna',
      external_id: asExternalId(result['id']),
      title,
      company: asText(asRecord(result['company'])?.['display_name']) ?? UNKNOWN_COMPANY,
      location: adzunaLocation(result),
      // Adzuna annualises every salary it publishes, so the period is known
      // even though the response carries no field for it. This is exactly the
      // claim Reed cannot make, which is why Reed needs a classifier.
      ...salaryFields(result['salary_min'], result['salary_max'], 'year'),
      description: normaliseDescription(result['description']),
      url: asHttpUrl(result['redirect_url']),
      posted_date: toIsoDateOrNull(result['created']),
      created_at: context.createdAt,
    },
    contractType: adzunaContractType(result),
  };
}

export function normaliseAdzunaResponse(
  body: string,
  context: NormaliseContext,
): Result<SearchResultJob[], JobApiError> {
  const results = readResults('adzuna', body);
  if (!results.ok) return results;

  const jobs: SearchResultJob[] = [];
  for (const raw of results.value) {
    const entry = normaliseAdzunaRecord(raw, context);
    if (entry !== null) jobs.push(entry);
  }

  return ok(jobs);
}

// ── Reed ─────────────────────────────────────────────────────────────────────

/** `dd/MM/yyyy` - the format Reed's `date` and `expirationDate` actually use. */
const UK_DATE = /^(\d{2})\/(\d{2})\/(\d{4})$/;

/**
 * Reed's posted date -> `YYYY-MM-DD`.
 *
 * ============================================================================
 * REED SENDS `dd/MM/yyyy`, NOT ISO.
 * ============================================================================
 * The Python original ran `datetime.strptime(date.split('T')[0], '%Y-%m-%d')`
 * over it, which raises on `14/08/2026`; the surrounding `except` swallowed it
 * and the row fell through to `utc_now()`. Every Reed advert was therefore
 * stamped with today, and "posted 3 days ago" was never true for Reed.
 *
 * Both forms are accepted here because a provider that changes its date format
 * without telling anyone is not a hypothetical, and neither form is ambiguous.
 * Anything else is `null` - an unreadable date is not today.
 */
export function reedPostedDate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;

  const uk = UK_DATE.exec(raw.trim());
  if (uk !== null) {
    // Re-validated through the ISO path, so 31/02/2026 is refused rather than
    // rolled forward into March.
    return toIsoDateOrNull(`${uk[3]}-${uk[2]}-${uk[1]}`);
  }

  return toIsoDateOrNull(raw);
}

function normaliseReedRecord(raw: unknown, context: NormaliseContext): SearchResultJob | null {
  const result = asRecord(raw);
  if (result === null) return null;

  const title = asText(result['jobTitle']);
  if (title === null) return null;

  const minimum = toFiniteNumber(result['minimumSalary']);
  const maximum = toFiniteNumber(result['maximumSalary']);

  return {
    job: {
      id: context.newId(),
      source: 'reed',
      external_id: asExternalId(result['jobId']),
      title,
      company: asText(result['employerName']) ?? UNKNOWN_COMPANY,
      location: asText(result['locationName']),
      // THE PORTED FIX. Reed's figures carry no unit, so the unit is derived
      // and stored as data. See `reed-salary.ts` for what happened when it was
      // encoded into prose instead.
      ...salaryFields(minimum, maximum, classifyReedSalaryPeriod(minimum, maximum)),
      description: normaliseDescription(result['jobDescription']),
      url: asHttpUrl(result['jobUrl']),
      posted_date: reedPostedDate(result['date']),
      created_at: context.createdAt,
    },
    contractType: classifyReedContractType({
      contractType: asText(result['contractType']),
      jobTitle: title,
      // The RAW description, so an IR35 signal that only appears inside the
      // markup is still seen. `classifyReedContractType` lowercases and
      // substring-matches, so tags around a signal do not hide it.
      jobDescription:
        typeof result['jobDescription'] === 'string' ? result['jobDescription'] : null,
      minimumSalary: minimum,
      maximumSalary: maximum,
    }),
  };
}

export function normaliseReedResponse(
  body: string,
  context: NormaliseContext,
): Result<SearchResultJob[], JobApiError> {
  const results = readResults('reed', body);
  if (!results.ok) return results;

  const jobs: SearchResultJob[] = [];
  for (const raw of results.value) {
    const entry = normaliseReedRecord(raw, context);
    if (entry !== null) jobs.push(entry);
  }

  return ok(jobs);
}
