import {
  ADZUNA_ATTRIBUTION_URL,
  ARBEITNOW_ATTRIBUTION,
  type JobSearchOutcome,
  type KeylessBrowseOutcome,
  type KeylessSourceId,
} from '@cviper/job-apis';

import { LiveStatus } from '../../app/LiveStatus';
import { IconTile } from '../../ui';
import { type Board } from '../boards/model';
import { ANALYSE_DISCLOSURE } from '../flow/advert';
import { type BrowserPort } from '../../platform/browser';

import { FewResults, NothingMatchedNotes, fewResultsText } from './KeylessBar';
import { nothingMatchedNote, type CombinedResults } from './keylessModel';
import { clusterSiblings, externalKey, type SearchForm } from './model';
import { dealBreakersIn, type RankBand } from './rank';
import { ResultCard } from './ResultCard';

/** What happened the last time Save was pressed, per advert. */
export type CardNotes = Readonly<Record<string, string>>;

/**
 * Everything under the results header: failures, the empty and few-results
 * states, attributions and the cards.
 *
 * Presentational. Search runs the searches and owns every piece of state shown
 * here; the per-card actions go back through the callbacks.
 */
export interface SearchResultsProps {
  readonly outcome: JobSearchOutcome | null;
  readonly keylessOutcome: KeylessBrowseOutcome | null;
  readonly results: CombinedResults;
  /** `results.jobs`, in the order to show them. */
  readonly ordered: CombinedResults['jobs'];
  readonly running: boolean;
  readonly form: SearchForm;
  readonly jobBoards: readonly Board[];
  readonly browser: BrowserPort;
  readonly today: string;
  readonly tracked: ReadonlySet<string>;
  readonly savingId: string | null;
  readonly notes: CardNotes;
  readonly problems: CardNotes;
  readonly bands: ReadonlyMap<string, RankBand | null>;
  readonly dealBreakers: readonly string[];
  readonly onSave: (jobId: string) => void;
  readonly onOpen: (url: string | null) => void;
  /** Left undefined, the cards draw no Analyse button and the disclosure is not shown. */
  readonly onAnalyse: ((jobId: string) => void) | undefined;
  /** Search cannot be pressed, so the empty page must not say to press it (L-335). */
  readonly searchBlocked: boolean;
}

export function SearchResults({
  outcome,
  keylessOutcome,
  results,
  ordered,
  running,
  form,
  jobBoards,
  browser,
  today,
  tracked,
  savingId,
  notes,
  problems,
  bands,
  dealBreakers,
  onSave,
  onOpen,
  onAnalyse,
  searchBlocked,
}: SearchResultsProps) {
  const failures = (outcome?.outcomes ?? []).filter((entry) => entry.error !== null);
  /*
    ============================================================================
    A FEED THAT FAILED GETS A LINE OF ITS OWN. THIS IS THE POINT OF L-110.
    ============================================================================
    Free feeds rot: they move, they change shape, they get switched off. Every
    one of those failures reaches this screen as an empty list unless it is
    rendered, and an empty list reads as "there are no jobs like that" — a
    sentence the user cannot question and cannot act on.

    So `keylessFailures` is drawn above the results, exactly like the keyed
    boards' failures, and `nothingMatched` is a SEPARATE and differently worded
    line for the case where the feed worked and the filter matched none of what
    it published. Blurring the two is the bug this feature exists to prevent.
  */
  const keylessFailures = (keylessOutcome?.outcomes ?? []).filter((entry) => entry.error !== null);
  const nothingMatched = (keylessOutcome?.outcomes ?? [])
    .map((entry) => ({ source: entry.source, note: nothingMatchedNote(entry) }))
    .filter((entry): entry is { source: KeylessSourceId; note: string } => entry.note !== null);

  const showsAdzuna = results.jobs.some((entry) => entry.job.source === 'adzuna');
  // Arbeitnow's own terms ask for a link back to the site, so their credit is
  // shown wherever their adverts are — the same treatment Adzuna's terms get.
  const showsArbeitnow = results.jobs.some((entry) => entry.job.source === 'arbeitnow');

  return (
    <>
      {/*
        One line per board that failed, ABOVE results that are still there.
        Losing a whole page of Adzuna adverts because Reed was down is the
        failure this shape exists to prevent.
      */}
      {failures.map((entry) => (
        <p
          key={entry.provider}
          role="alert"
          data-testid={`search-error-${entry.provider}`}
          data-kind={entry.error?.kind}
          className="rounded-control bg-danger/5 px-3 py-2 text-danger"
        >
          {entry.error?.message}
        </p>
      ))}

      {/*
        One line per FEED that failed, in exactly the same place and shape.
        A 404, a feed that changed its payload, and a feed that answered
        with no jobs at all are three different sentences and all three are
        failures — none of them may reach the user as an empty list.
      */}
      {keylessFailures.map((entry) => (
        <p
          key={entry.source}
          role="alert"
          data-testid={`keyless-error-${entry.source}`}
          data-kind={entry.error?.kind}
          className="rounded-control bg-danger/5 px-3 py-2 text-danger"
        >
          {entry.error?.message}
        </p>
      ))}

      <NothingMatchedNotes entries={nothingMatched} />

      {/* The few-results message, spoken from here (L-238) — see `fewResultsText`. */}
      <LiveStatus
        text={results.ran && !running ? fewResultsText(results.jobs.length, jobBoards) : null}
      />
      {!results.ran ? (
        <div
          data-testid="search-empty"
          className="rounded-card border border-line border-dashed bg-card px-6 py-8 text-center"
        >
          <div className="mb-3 flex justify-center">
            <IconTile icon="search" />
          </div>
          <p className="font-medium text-ink">Nothing looked at yet.</p>
          <p className="mt-1 text-ink-muted">
            {searchBlocked
              ? 'Tick a free feed above to see the newest adverts here — they need no key.'
              : 'Type a job title and press Search to see the newest adverts from the free feeds.'}{' '}
            Or open the same search on a whole job board with the buttons above.
          </p>
        </div>
      ) : (
        <>
          {running ? null : (
            <FewResults
              count={results.jobs.length}
              form={form}
              browser={browser}
              boards={jobBoards}
            />
          )}

          {showsAdzuna ? (
            // Attribution, wherever Adzuna's data appears. A condition of
            // their API terms, and it belongs on screen rather than in a
            // licence file nobody opens.
            <p data-testid="adzuna-attribution" className="text-xs text-ink-faint">
              Jobs from Adzuna
            </p>
          ) : null}

          {showsArbeitnow ? (
            // The same, for Arbeitnow, whose own `meta.terms` say "I would
            // appreciate linking back to the site". Every card also keeps
            // its link to their page for that advert.
            <p data-testid="arbeitnow-attribution" className="text-xs text-ink-faint">
              {ARBEITNOW_ATTRIBUTION}
            </p>
          ) : null}

          {/*
            Once, above the list, not on every card: "Analyse this job" can
            open the advert's own page (L-190), and that request is said
            out loud before it is made — see `ANALYSE_DISCLOSURE`.
          */}
          {onAnalyse === undefined || results.jobs.length === 0 ? null : (
            <p data-testid="search-analyse-disclosure" className="text-xs text-ink-faint">
              {ANALYSE_DISCLOSURE}
            </p>
          )}

          {results.jobs.length === 0 &&
          failures.length === 0 &&
          keylessFailures.length === 0 &&
          nothingMatched.length === 0 ? (
            <p data-testid="search-no-results" className="text-ink-muted">
              No adverts matched that. Try broader keywords, a wider radius, or send the same words
              to your browser with the buttons above.
            </p>
          ) : null}

          <div data-testid="search-results" className="space-y-3">
            {ordered.map((entry) => {
              const siblings = clusterSiblings(entry.job.id, results.clusters);
              const key = externalKey(entry.job.source, entry.job.external_id);

              return (
                <ResultCard
                  key={entry.job.id}
                  entry={entry}
                  today={today}
                  clusterSize={siblings === null ? null : siblings.length}
                  tracked={key !== null && tracked.has(key)}
                  busy={savingId === entry.job.id}
                  note={notes[entry.job.id] || null}
                  problem={problems[entry.job.id] || null}
                  rank={bands.get(entry.job.id) ?? null}
                  dealBreakers={dealBreakersIn(dealBreakers, entry.job)}
                  onSave={() => onSave(entry.job.id)}
                  onOpen={() => onOpen(entry.job.url)}
                  onOpenSource={
                    entry.job.source === 'adzuna' ? () => onOpen(ADZUNA_ATTRIBUTION_URL) : undefined
                  }
                  onAnalyse={onAnalyse === undefined ? undefined : () => onAnalyse(entry.job.id)}
                />
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
