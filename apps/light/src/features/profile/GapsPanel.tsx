import { useEffect, useMemo, useState } from 'react';

import { displayTerm } from '../analysis/acronyms';

import { describeGaps, describedJobs, skillGaps, type SkillGap } from './gaps';
import { type GapsPort, type GapsSource } from './gapsPort';

/**
 * The skills-gap heatmap at the foot of the profile: what the adverts on the
 * board ask for that the CV does not say, one row per skill, most wanted
 * first.
 *
 * ============================================================================
 * KEYLESS. IT READS THE DATABASE AND NOTHING ELSE.
 * ============================================================================
 * No model, no request, no key. The counting is `gaps.ts`, the reading is the
 * port, and the panel is the join between the two plus four sentences for the
 * four ways there can be nothing to show. Each of those sentences names the
 * next thing to do, because "no data" on its own reads as "broken".
 *
 * ============================================================================
 * THE ORDER THE EMPTY STATES ARE CHECKED IN
 * ============================================================================
 * No adverts first, then no CV, then no descriptions. Someone with neither is
 * told to save adverts: the tracker is the screen this panel is about, and a
 * board of adverts with no CV still tells you what the market wants, which
 * `skillGaps` would happily list — every skill, uncovered. It is NOT listed,
 * because a heatmap of every word in every advert is a lexicon, not a gap.
 *
 * ============================================================================
 * THE BAR
 * ============================================================================
 * Its width is the one inline style in this feature. `share` is a continuous
 * value the theme cannot name a class for, and a bar that rounded to the
 * nearest of five width classes would show two skills wanted by 3 and 4 of 7
 * adverts as the same length. Its colour comes from the theme — gold is the
 * token for "something needs the user" — and never from a literal.
 */

type PanelState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly source: GapsSource };

export interface GapsPanelProps {
  readonly port: GapsPort;
}

export function GapsPanel({ port }: GapsPanelProps) {
  const [state, setState] = useState<PanelState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    void port.load().then((result) => {
      if (cancelled) return;
      setState(
        result.ok
          ? { status: 'ready', source: result.value }
          : {
              status: 'error',
              message: `${result.error.message} Your data is still on this machine.`,
            },
      );
    });

    return () => {
      cancelled = true;
    };
  }, [port]);

  return (
    <section data-testid="profile-gaps" className="mt-8 max-w-2xl border-t border-line pt-6">
      <h2 className="font-medium text-ink">Across your applications</h2>
      <Body state={state} />
    </section>
  );
}

function Body({ state }: { readonly state: PanelState }) {
  // Scanning is a few hundred regex tests per advert: done once per load,
  // not once per render.
  const scanned = useMemo(() => {
    if (state.status !== 'ready') return null;
    const described = describedJobs(state.source.jobs);
    return {
      described: described.length,
      gaps: skillGaps({ cvText: state.source.cvText, jobs: described }),
    };
  }, [state]);

  if (state.status === 'loading') {
    return (
      <p data-testid="profile-gaps-loading" className="mt-1 text-ink-muted">
        Reading your adverts…
      </p>
    );
  }

  if (state.status === 'error') {
    return (
      <p role="alert" data-testid="profile-gaps-error" className="mt-1 text-danger">
        {state.message}
      </p>
    );
  }

  const { source } = state;
  if (source.jobs.length === 0) {
    return <Empty>Save a few adverts to the tracker and this fills in.</Empty>;
  }
  if (source.cvText === null) {
    return (
      <Empty>
        Upload a CV on the Analysis screen to see what these adverts ask for that it does not
        mention.
      </Empty>
    );
  }
  if (scanned === null) return null;

  return (
    <>
      <p data-testid="profile-gaps-summary" className="mt-1 text-ink-muted">
        {describeGaps(scanned.gaps, scanned.described)}
      </p>
      {scanned.gaps.length === 0 ? null : (
        <ul data-testid="profile-gaps-list" className="mt-3 space-y-2">
          {scanned.gaps.map((gap) => (
            <GapRow key={gap.skill} gap={gap} described={scanned.described} />
          ))}
        </ul>
      )}
    </>
  );
}

function Empty({ children }: { readonly children: React.ReactNode }) {
  return (
    <p data-testid="profile-gaps-empty" className="mt-1 text-ink-muted">
      {children}
    </p>
  );
}

function GapRow({ gap, described }: { readonly gap: SkillGap; readonly described: number }) {
  const percent = Math.round(gap.share * 100);
  return (
    <li data-testid="profile-gap-row">
      <div className="flex items-baseline justify-between gap-3">
        <span data-testid="profile-gap-skill" className="min-w-0 truncate text-ink">
          {displayTerm(gap.skill)}
        </span>
        <span
          data-testid="profile-gap-count"
          className="shrink-0 font-mono text-xs tabular-nums text-ink-faint"
        >
          {gap.wantedBy} of {described} {described === 1 ? 'advert' : 'adverts'}
        </span>
      </div>
      <div className="mt-1 h-1.5 w-full rounded-pill bg-sunken" aria-hidden="true">
        <div
          data-testid="profile-gap-bar"
          className="h-full rounded-pill bg-gold/40"
          style={{ width: `${percent}%` }}
        />
      </div>
    </li>
  );
}
