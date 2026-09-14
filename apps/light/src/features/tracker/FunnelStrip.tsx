import { formatRate, funnelFrom } from './funnel';
import { type TrackerEntry } from './model';

/**
 * One quiet row under the board header: the campaign as a funnel (L-159).
 *
 *   SAVED   SENT   INTERVIEWING   OFFERS   REJECTED      Interview rate 33%
 *     6      12         4           1         5          Offer rate 8%
 *
 * ============================================================================
 * WHY IT IS A STRIP AND NOT A DASHBOARD
 * ============================================================================
 * The board answers "where do I stand" one card at a time. Over a months-long
 * campaign the user also needs the one-line version — how much has gone out,
 * how much of it turned into a conversation — and that is a glance, not a
 * screen. So: a single row, bordered like the error strip above it, eyebrow
 * labels in the same mono style every section heading in the app uses, and
 * the figures in tabular mono so a 9 becoming a 10 does not shove the row
 * sideways. Nothing here is clickable and nothing is coloured except the two
 * rates, which go teal — present, moving — when there is a rate to show.
 *
 * The arithmetic lives in `funnel.ts`, including WHY "sent" is not a column
 * and why a rate with nothing sent is a dash rather than 0%.
 */

interface FunnelStripProps {
  readonly entries: readonly TrackerEntry[];
}

const EYEBROW = 'font-mono text-[11px] font-medium tracking-[0.14em] text-ink-faint uppercase';

export function FunnelStrip({ entries }: FunnelStripProps) {
  const funnel = funnelFrom(entries);

  const figures: ReadonlyArray<readonly [key: string, label: string, value: number]> = [
    ['saved', 'Saved', funnel.saved],
    ['sent', 'Sent', funnel.sent],
    ['interviewing', 'Interviewing', funnel.interviewing],
    ['offers', 'Offers', funnel.offers],
    ['rejected', 'Rejected', funnel.rejected],
  ];

  return (
    <div
      data-testid="tracker-funnel"
      className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line px-4 py-2 md:px-6"
    >
      <dl className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
        {figures.map(([key, label, value]) => (
          <div key={key} className="flex flex-col">
            {/*
              The label comes first in the DOM, where a screen reader wants it,
              and second on screen, where the number is the thing to scan for.
            */}
            <dt className={`order-1 ${EYEBROW}`}>{label}</dt>
            <dd
              className="font-mono tabular-nums text-ink"
              data-testid={`tracker-funnel-count-${key}`}
            >
              {value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-wrap items-baseline gap-x-4 text-ink-muted md:ml-auto">
        <Rate
          testId="tracker-funnel-interview-rate"
          label="Interview rate"
          rate={funnel.interviewRate}
        />
        <Rate testId="tracker-funnel-offer-rate" label="Offer rate" rate={funnel.offerRate} />
      </div>
    </div>
  );
}

/** "Interview rate 33%" — teal when there is a figure, faint when there is not. */
function Rate({
  testId,
  label,
  rate,
}: {
  readonly testId: string;
  readonly label: string;
  readonly rate: number | null;
}) {
  return (
    <p data-testid={testId}>
      {label}{' '}
      <span className={`font-mono tabular-nums ${rate === null ? 'text-ink-faint' : 'text-teal'}`}>
        {formatRate(rate)}
      </span>
    </p>
  );
}
