import { useEffect, useMemo, useState } from 'react';

import { type CombinedResults } from './keylessModel';
import { type SearchPort } from './port';
import { isScorable, rankResult, sortByBand, type RankBand } from './rank';

export interface SearchRanking {
  /** `undefined` until the port has answered; `null` when there is no CV. */
  readonly cvText: string | null | undefined;
  readonly dealBreakers: readonly string[];
  /** Is there a CV worth ranking against? */
  readonly rankable: boolean;
  readonly bestFirst: boolean;
  readonly setBestFirst: (next: boolean) => void;
  /** One band per advert id. `null` is "no pill", never "weak". */
  readonly bands: ReadonlyMap<string, RankBand | null>;
  /** The results in the order to show them. */
  readonly ordered: CombinedResults['jobs'];
}

/**
 * Ranking results against the CV on file, here, with no key (L-157).
 *
 * The CV and the profile's deal-breakers are read ONCE, when the screen opens,
 * through the port — two SQLite reads, no network.
 */
export function useSearchRanking(searchPort: SearchPort, results: CombinedResults): SearchRanking {
  /*
    `undefined` until the port has answered, so the screen draws NEITHER the
    toggle nor the "upload a CV" hint for the half-second before it knows —
    a hint that flashes and vanishes on every open would be read as a bug.
  */
  const [cvText, setCvText] = useState<string | null | undefined>(undefined);
  const [dealBreakers, setDealBreakers] = useState<readonly string[]>([]);
  const [bestFirst, setBestFirst] = useState(true);

  useEffect(() => {
    let cancelled = false;

    /*
      Two reads, once, and SILENT on failure. What is lost if either fails is
      the band on each card and the deal-breaker chips; the search itself is
      untouched, and a banner saying "could not read your CV" over a working
      search screen would be the larger error. `null` on failure means the
      screen shows the same quiet hint it shows when there is no CV — which is
      true enough: there is no CV it can rank against.
    */
    void searchPort.latestCvText().then((loaded) => {
      if (cancelled) return;
      setCvText(loaded.ok ? loaded.value : null);
    });
    void searchPort.dealBreakers().then((loaded) => {
      if (cancelled) return;
      setDealBreakers(loaded.ok ? loaded.value : []);
    });

    return () => {
      cancelled = true;
    };
  }, [searchPort]);

  /*
    A CV shorter than the scorer accepts counts as none: the toggle would
    otherwise sit there over a list with no bands on it, and the hint says the
    true thing — upload a CV.
  */
  const rankable = cvText !== undefined && isScorable(cvText);

  /*
    One band per advert, computed ONCE per list rather than once per render:
    the scorer is a few hundred regex tests per advert, and this runs over a
    whole page of results. Keyed by advert id so the sort and the cards read
    the same map. `null` entries are "no pill", never "weak" — see `rank.ts`.
  */
  const bands = useMemo(() => {
    const computed = new Map<string, RankBand | null>();
    for (const item of results.jobs) {
      computed.set(item.job.id, rankable ? rankResult(cvText, item.job) : null);
    }
    return computed;
  }, [cvText, rankable, results]);

  const ordered = useMemo(
    () => (rankable && bestFirst ? sortByBand(results.jobs, bands) : results.jobs),
    [bands, bestFirst, rankable, results],
  );

  return { cvText, dealBreakers, rankable, bestFirst, setBestFirst, bands, ordered };
}
