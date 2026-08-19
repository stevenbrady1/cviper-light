/**
 * Best-effort employment-type classification for a Reed advert.
 *
 * PORTED FROM `c:\Dev\job-match-pro\backend\job_sites_api.py`:
 *   `_REED_CONTRACT_SIGNALS`       lines 155-165
 *   `_classify_reed_contract_type` lines 168-199
 *
 * Ported faithfully in behaviour, including the three-tier fallback and the
 * deliberate omission in the signal list. Both explanatory comments are copied
 * VERBATIM — they are the reason the next person does not reintroduce the bug.
 */
import { toFiniteNumber } from './numbers';
import { DAY_RATE_CEILING } from './reed-salary';

/** The subset of a Reed `/search` job object these functions read. */
export interface ReedJobFields {
  contractType?: string | null;
  jobTitle?: string | null;
  jobDescription?: string | null;
  minimumSalary?: number | null;
  maximumSalary?: number | null;
}

/**
 * `'Contract'`, `'Permanent'`, or whatever else Reed states verbatim. The
 * `string & {}` arm keeps the two known values as autocomplete suggestions
 * without closing the set — Reed publishes values we have not seen.
 */
export type ReedContractType = 'Contract' | 'Permanent' | (string & {});

/**
 * Comment copied VERBATIM from the source — the omission it describes is
 * deliberate and is exactly the kind of thing a well-meaning reader "fixes"
 * into a bug:
 *
 *   Day-rate / contract signals scanned in the title + description when Reed's
 *   structured `contractType` field is absent. Reed's /search endpoint omits it
 *   for many listings, which historically defaulted every such role to
 *   "Permanent" — including clear day-rate contracts. We deliberately avoid the
 *   bare word "contract" here because permanent ads commonly say "permanent
 *   contract" / "employment contract"; only unambiguous signals are listed.
 *
 * DO NOT ADD "contract" TO THIS LIST. It is absent on purpose — "contractor" is
 * present and is unambiguous; the bare noun is not.
 */
export const REED_CONTRACT_SIGNALS: readonly string[] = [
  'day rate',
  'day-rate',
  'per day',
  '/day',
  'per diem',
  'outside ir35',
  'inside ir35',
  'ir35',
  'fixed term',
  'fixed-term',
  'interim',
  'contractor',
];

/**
 * Source docstring, copied VERBATIM:
 *
 *   Prefer Reed's explicit `contractType`; when it's missing (common on the
 *   /search endpoint) fall back to scanning the title/description for contract
 *   signals, then to a salary-magnitude heuristic: Reed returns the raw figure
 *   with no period, so a maximum under ~£2,000 is a day/hourly rate (contract)
 *   — a genuine annual permanent salary is never that low.
 *
 * The three tiers run in that order and the first hit wins.
 *
 * One tidy, flagged: tier 3 in the source hard-codes the literal `2000`
 * (line 194) rather than referencing `_DAY_RATE_CEILING`, which lives on the
 * `ReedAPI` class — and the source comment on that constant explicitly says it
 * should "mirror the threshold used by _classify_reed_contract_type". Both
 * values are 2000, so pointing them at one constant here is
 * behaviour-preserving and removes the chance of the two drifting apart.
 */
export function classifyReedContractType(job: ReedJobFields): ReedContractType {
  // Tier 1 — Reed's explicit field.
  const explicit = (job.contractType ?? '').trim();
  if (explicit) {
    const lowered = explicit.toLowerCase();
    if (lowered.includes('contract') || lowered.includes('temp') || lowered.includes('interim')) {
      return 'Contract';
    }
    if (lowered.includes('perm')) return 'Permanent';
    return explicit; // respect anything else Reed states verbatim
  }

  // Tier 2 — text signals in title + description.
  //
  // NOTE the asymmetry with tier 1, and keep it: tier 1 matches the bare word
  // "contract" because Reed's own structured field says "Contract" as a VALUE;
  // tier 2 must not, because free advert prose says "permanent contract".
  const blob = `${job.jobTitle ?? ''} ${job.jobDescription ?? ''}`.toLowerCase();
  if (REED_CONTRACT_SIGNALS.some((signal) => blob.includes(signal))) return 'Contract';

  // Tier 3 — salary magnitude. Only the MAXIMUM is consulted (source line 192),
  // unlike the period classifier, which takes max(min, max). Kept as-is.
  const maximum = toFiniteNumber(job.maximumSalary);
  if (maximum !== null && maximum > 0 && maximum < DAY_RATE_CEILING) return 'Contract';

  return 'Permanent';
}
