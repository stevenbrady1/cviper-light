import { PROVIDER_LABEL, type SearchResultJob } from '@cviper/job-apis';

import { QUIET_BUTTON, SECONDARY_BUTTON } from '../../app/buttons';

import { describeCluster, postedLabel } from './model';
import { describeSalary, formatSalary } from './salary';

/**
 * One advert, as a card.
 *
 * ============================================================================
 * THE SALARY LINE IS THE POINT OF THIS COMPONENT
 * ============================================================================
 * It renders `formatSalary`, which states the PERIOD the figures are in. A Reed
 * contract at £457–£550 a day is byte-for-byte indistinguishable from an
 * insulting annual salary, and the web application it was ported from showed it
 * as one. See `salary.ts` and the named regression test
 * `search.dayRate.test.tsx`.
 *
 * ============================================================================
 * A DUPLICATE IS FLAGGED HERE AND REMOVED NOWHERE
 * ============================================================================
 * When an advert is cross-posted, every copy is still on the page with its own
 * "Open original" button, and the card carries a note saying how many there
 * are. The web app merges them because a support engineer can undo a bad merge
 * server-side; this writes to one SQLite file on one machine, and a wrong merge
 * deletes a real advert and its apply URL with no error and nothing for the
 * user to notice.
 *
 * ============================================================================
 * THE SOURCE IS ALWAYS NAMED
 * ============================================================================
 * Partly so the user can tell which board to blame for a bad advert, and partly
 * because attributing Adzuna's data is a condition of their API terms. It is a
 * chip on every card rather than a footnote for that reason.
 */

interface ResultCardProps {
  readonly entry: SearchResultJob;
  readonly today: string;
  /** How many adverts are in this one's cross-post group, or `null`. */
  readonly clusterSize: number | null;
  /** Is this advert already on the tracker board? */
  readonly tracked: boolean;
  readonly busy: boolean;
  /** What happened the last time Save was pressed on this card. */
  readonly note: string | null;
  readonly problem: string | null;
  readonly onSave: () => void;
  readonly onOpen: () => void;
}

export function ResultCard({
  entry,
  today,
  clusterSize,
  tracked,
  busy,
  note,
  problem,
  onSave,
  onOpen,
}: ResultCardProps) {
  const { job, contractType } = entry;

  const salary = formatSalary(job);
  const posted = postedLabel(job.posted_date, today);
  const where = [job.company, job.location]
    .filter((part) => part !== null && part !== '')
    .join(' · ');

  return (
    <article
      data-testid={`result-${job.id}`}
      data-source={job.source}
      className="rounded-card border border-line bg-card px-4 py-3 shadow-raised"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="min-w-0 font-medium text-ink">{job.title}</h3>
        {/*
          The board this advert came from. Named on every card — Adzuna's API
          terms require their data to be attributed wherever it appears, and the
          user needs to know which board an odd advert came from anyway.
        */}
        <span
          data-testid={`result-source-${job.id}`}
          className="shrink-0 rounded-pill bg-sunken px-2 py-0.5 font-mono text-[11px] font-medium tracking-[0.08em] text-ink-muted uppercase"
        >
          {PROVIDER_LABEL[job.source === 'adzuna' ? 'adzuna' : 'reed']}
        </span>
      </div>

      <p className="truncate text-xs text-ink-muted">{where}</p>

      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {/*
          Mono and tabular, like every number in this app, so two salaries line
          up down a column instead of jittering.
        */}
        <span
          data-testid={`result-salary-${job.id}`}
          aria-label={describeSalary(job)}
          className="font-mono tabular-nums text-ink"
        >
          {salary ?? 'Salary not stated'}
        </span>

        <span className="rounded-pill bg-sunken px-2 py-0.5 text-[11px] font-medium text-ink-muted">
          {contractType}
        </span>

        {posted === null ? null : (
          <span
            data-testid={`result-posted-${job.id}`}
            className="font-mono text-xs tabular-nums text-ink-faint"
          >
            {posted}
          </span>
        )}
      </div>

      {clusterSize === null ? null : (
        <p
          data-testid={`result-cluster-${job.id}`}
          className="mt-2 rounded-control bg-gold/10 px-3 py-1.5 text-xs text-gold"
        >
          {describeCluster(clusterSize)}. Every one is still listed, with its own apply link —
          CViper never removes an advert it thinks is a copy.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid={`result-save-${job.id}`}
          /*
            Disabled once the advert is on the board, never hidden, and the
            label says which it is. A button that disappears leaves the user
            wondering whether the click worked.
          */
          disabled={busy || tracked}
          onClick={onSave}
          className={SECONDARY_BUTTON}
        >
          {tracked ? 'In your tracker' : 'Save to tracker'}
        </button>

        <button
          type="button"
          data-testid={`result-open-${job.id}`}
          disabled={job.url === null}
          onClick={onOpen}
          className={QUIET_BUTTON}
        >
          Open original →
        </button>
      </div>

      {note === null ? null : (
        <p role="status" data-testid={`result-note-${job.id}`} className="mt-2 text-xs text-teal">
          {note}
        </p>
      )}

      {problem === null ? null : (
        <p
          role="alert"
          data-testid={`result-problem-${job.id}`}
          className="mt-2 text-xs text-danger"
        >
          {problem}
        </p>
      )}
    </article>
  );
}
