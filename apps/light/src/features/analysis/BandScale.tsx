import { type Verdict } from '@cviper/core-types';

/**
 * The match score: a large numeral over a horizontal band scale.
 *
 * ============================================================================
 * A BAND SCALE, AND DELIBERATELY NOT AN ARC GAUGE.
 * ============================================================================
 * The obvious rendering for a 0-100 score is a dial. It is the wrong one here,
 * and not for taste reasons.
 *
 * An arc implies a continuous, precise measurement — 71 meaningfully different
 * from 73. This number is not that. On the AI path it comes from a model whose
 * own calibration anchors are BANDS ("a candidate like this is a possible
 * fit"); on the keyword path it comes from counting words. Neither can tell 71
 * from 73, and a dial would quietly claim they can.
 *
 * So the score is drawn against the three bands the verdict is actually derived
 * from — weak, possible, strong — with a tick where it landed. The user reads
 * "possible, near the top of the band", which is exactly as much as is true,
 * and it uses the vocabulary the rest of the screen already uses.
 *
 * ============================================================================
 * THE BOUNDARIES ARE `deriveVerdict`, NOT A COPY OF IT
 * ============================================================================
 * `BANDS` below is checked against `deriveVerdict` by a test. A scale whose
 * bands disagreed with the badge next to it would show a tick sitting in
 * "strong" under the word "possible", which is worse than either alone.
 */

export interface Band {
  readonly verdict: Verdict;
  /** Lowest score in this band, inclusive. */
  readonly from: number;
  /** Highest score in this band, inclusive. */
  readonly to: number;
  readonly label: string;
}

/**
 * The three bands, in ascending order and covering 0-100 with no gap.
 *
 * MUST agree with `deriveVerdict` in `@cviper/core-types`: >= 75 strong,
 * >= 60 possible, everything else weak.
 */
export const BANDS: readonly Band[] = [
  { verdict: 'weak', from: 0, to: 59, label: 'weak' },
  { verdict: 'possible', from: 60, to: 74, label: 'possible' },
  { verdict: 'strong', from: 75, to: 100, label: 'strong' },
];

/**
 * The band fills.
 *
 * The colour grammar, applied without improvising: teal is present and moving,
 * gold is "needs you", and a weak match is NEITHER — it is information, not a
 * fault and not a rejection. Red is reserved for destructive actions and the
 * `rejected` status, so a weak score gets neutral ink rather than a warning
 * colour. Telling somebody their CV is a bad fit in the same colour the app
 * uses for "delete this" is a judgement the app has no standing to make.
 */
const BAND_FILL: Record<Verdict, string> = {
  weak: 'bg-line/60',
  possible: 'bg-gold/30',
  strong: 'bg-teal/30',
};

/** The numeral and the tick take the verdict's own colour. */
const VERDICT_INK: Record<Verdict, string> = {
  weak: 'text-ink-muted',
  possible: 'text-gold',
  strong: 'text-teal',
};

const TICK_FILL: Record<Verdict, string> = {
  weak: 'bg-ink-muted',
  possible: 'bg-gold',
  strong: 'bg-teal',
};

const VERDICT_WORD: Record<Verdict, string> = {
  weak: 'a weak match',
  possible: 'a possible match',
  strong: 'a strong match',
};

/** Percentage width of one band on a 0-100 scale. */
function bandWidth(band: Band): number {
  return band.to - band.from + 1;
}

/**
 * Clamp to the drawable range.
 *
 * A score outside 0-100 cannot come from either engine — the schema bounds it
 * and `clampAnalysis` enforces it — but a tick at `left: -40%` would sit
 * outside the component with no indication anything was wrong, and this is the
 * one number on the screen the user is going to read first.
 */
function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.min(100, Math.max(0, Math.round(score)));
}

interface BandScaleProps {
  readonly score: number;
  readonly verdict: Verdict;
}

export function BandScale({ score, verdict }: BandScaleProps) {
  const value = clampScore(score);

  return (
    <div
      data-testid="band-scale"
      data-score={value}
      data-verdict={verdict}
      role="img"
      aria-label={`Match score ${value} out of 100 — ${VERDICT_WORD[verdict]}.`}
    >
      <div className="flex items-baseline gap-2">
        {/*
          Plex Mono with tabular figures, per the type rules: this is a number
          the user compares against other runs, and it must not jitter between
          renders as the digits change.
        */}
        <span
          data-testid="band-scale-score"
          className={`font-mono text-5xl leading-none font-medium tabular-nums ${VERDICT_INK[verdict]}`}
        >
          {value}
        </span>
        <span className="text-ink-faint">out of 100</span>
      </div>

      <div className="relative mt-3">
        <div className="flex h-2 overflow-hidden rounded-pill">
          {BANDS.map((band) => (
            <div
              key={band.verdict}
              className={BAND_FILL[band.verdict]}
              style={{ width: `${bandWidth(band)}%` }}
            />
          ))}
        </div>

        {/*
          The tick. `left` is the resting position and is correct with no
          animation at all; `cviper-tick-in` only fades and lifts it into place,
          and `prefers-reduced-motion` removes even that. See theme.css.
        */}
        <div
          data-testid="band-scale-tick"
          aria-hidden="true"
          className={`cviper-tick-in absolute -top-1 h-4 w-0.5 rounded-pill ${TICK_FILL[verdict]}`}
          style={{ left: `${value}%`, transform: 'translateX(-50%)' }}
        />

        <div className="mt-1.5 flex">
          {BANDS.map((band) => (
            <span
              key={band.verdict}
              style={{ width: `${bandWidth(band)}%` }}
              className={`font-mono text-[11px] tracking-[0.14em] uppercase ${
                band.verdict === verdict ? VERDICT_INK[verdict] : 'text-ink-faint'
              }`}
            >
              {band.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
