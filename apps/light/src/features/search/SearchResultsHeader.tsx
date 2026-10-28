import { PROVIDER_LABEL, REED_DAILY_LIMIT, type QuotaState } from '@cviper/job-apis';

/**
 * The results' own bookkeeping, beside them rather than above the search
 * (L-219): the best-match toggle, or the hint to upload a CV, and today's
 * request counts.
 */
export interface SearchResultsHeaderProps {
  /** `undefined` until the port has said whether there is a CV. */
  readonly cvText: string | null | undefined;
  readonly rankable: boolean;
  readonly bestFirst: boolean;
  readonly onBestFirst: (next: boolean) => void;
  readonly quota: QuotaState;
}

export function SearchResultsHeader({
  cvText,
  rankable,
  bestFirst,
  onBestFirst,
  quota,
}: SearchResultsHeaderProps) {
  return (
    /*
      The toggle when there is a CV to rank against; one quiet line when
      there is not; NOTHING until the port has said which. The toggle is
      hidden rather than disabled because a disabled "Best match first"
      with no explanation is a promise the screen is visibly not keeping.
    */
    <div
      data-testid="search-results-header"
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1"
    >
      {cvText === undefined ? null : rankable ? (
        <label className="flex items-center gap-2 text-ink-muted">
          <input
            type="checkbox"
            data-testid="search-sort-best"
            checked={bestFirst}
            onChange={(event) => onBestFirst(event.currentTarget.checked)}
          />
          Best match first
        </label>
      ) : (
        <p data-testid="search-rank-hint" className="text-xs text-ink-faint">
          Upload a CV on the Analysis screen and results will be ranked against it.
        </p>
      )}
      <div data-testid="search-quota" className="text-xs text-ink-faint sm:text-right">
        Requests today — {PROVIDER_LABEL.reed}{' '}
        <span className="font-mono tabular-nums">{quota.counts.reed}</span> of{' '}
        <span className="font-mono tabular-nums">{REED_DAILY_LIMIT}</span> · {PROVIDER_LABEL.adzuna}{' '}
        <span className="font-mono tabular-nums">{quota.counts.adzuna}</span>{' '}
        {/*
          A bare count for Adzuna, with no denominator. Their allowance
          depends on the plan the user bought and cannot be queried, so any
          figure here would be a confident wrong number on screen for ever.
          Counted, shown, never enforced.
        */}
        (allowance depends on your plan)
      </div>
    </div>
  );
}
