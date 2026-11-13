import { type ReactNode } from 'react';

import { type CheckStatus } from '@cviper/ats-checks';
import { atsBand } from '@cviper/keyword-scoring';

import { Hint } from '../../app/Hint';
import { StateMark, cardClasses, type StateMarkName } from '../../ui';
import {
  ATS_BAND_HINT,
  ATS_CHECK_HINT,
  ATS_HINT,
  ATS_STATUS_HINT,
  changeHint,
} from '../../app/hints';
import { ATS_BAND_TONE, ATS_BAND_WORD } from '../analysis/atsBandWords';

import { type AtsComparison } from './atsComparison';

/**
 * The ATS Score step (L-198): the tailored CV, re-scored, before → after.
 *
 * Sits between the tailored CV and the save buttons, so the last thing read
 * before exporting is whether tailoring helped. Same colour grammar as the
 * Analysis screen: nothing is red, a regression is gold, an improvement teal.
 *
 * The two numbers — keyword coverage and bullet strength, 0 to 100 — are a
 * Before bar and an After bar each (L-396), so the change is seen before it is
 * read. A bar is decoration, hidden from a screen reader: the words and
 * numbers beside it say everything, in reading order. The three checks are
 * words, not numbers, so they stay a table: the question is "what changed in
 * each row", and a table with a caption reads to a screen reader as exactly that.
 *
 * The marks are drawn (`StateMark`, L-362), not typed, so they look the same
 * on every machine, and each is its own shape: OK a tick, Check a warning,
 * Missing a cross, a rise an up arrow, a fall a down arrow. A mark is hidden
 * from a screen reader; the word or number beside it, and its hint, say it.
 */
export interface AtsStepProps {
  readonly comparison: AtsComparison;
  /** The fabrication check on the same draft: clean, or how many things to check. */
  readonly fabrication: { readonly clean: boolean; readonly flagged: number };
}

const STATUS_MARK: Readonly<Record<CheckStatus, StateMarkName>> = {
  pass: 'tick',
  warn: 'warning',
  fail: 'cross',
};

const STATUS_WORD: Readonly<Record<CheckStatus, string>> = {
  pass: 'OK',
  warn: 'Check',
  fail: 'Missing',
};

const STATUS_TONE: Readonly<Record<CheckStatus, string>> = {
  pass: 'whitespace-nowrap text-teal-ink',
  warn: 'whitespace-nowrap text-gold-ink',
  fail: 'whitespace-nowrap font-medium text-gold-ink',
};

// Every mark below carries a hint (L-215): what the tick, warning and cross,
// the up and down arrows, and — mean, in words, on hover, on a tap and to a
// screen reader. See `app/hints.ts`. A result cell's hint draws no "i" and is
// no Tab stop (`focusable={false}`): the "i" is on the row and column labels,
// so the table is not an icon in every cell (L-384, owner decision).

function Delta({ value }: { readonly value: number | null }) {
  if (value === null) {
    return (
      <Hint text={ATS_HINT.noScore} className="text-ink-faint" focusable={false}>
        —
      </Hint>
    );
  }
  if (value === 0) {
    return (
      <Hint text={ATS_HINT.noChange} className="whitespace-nowrap text-ink-faint" focusable={false}>
        no change
      </Hint>
    );
  }
  return (
    <Hint
      text={changeHint(value)}
      focusable={false}
      className={`whitespace-nowrap ${value > 0 ? 'text-teal-ink' : 'text-gold-ink'}`}
    >
      <StateMark name={value > 0 ? 'up' : 'down'} /> {value > 0 ? `+${value}` : value}
    </Hint>
  );
}

function Score({ value }: { readonly value: number | null }) {
  return value === null ? (
    <Hint text={ATS_HINT.noScore} className="text-ink-faint" focusable={false}>
      —
    </Hint>
  ) : (
    <span className="font-mono tabular-nums">{value}</span>
  );
}

/** After's bar by direction, as the change beside it: teal up, gold down, muted the same. */
function afterFill(delta: number | null): string {
  if (delta === null || delta === 0) return 'bg-ink-muted';
  return delta > 0 ? 'bg-teal' : 'bg-gold';
}

/**
 * One line under a number: the word, a bar as wide as the number, the number,
 * and a slot as wide as the change's (for the band word), so both bars of a
 * row are the same length. No number, no track: an empty one would read as 0.
 */
function BarLine(props: {
  readonly id: string;
  readonly word: string;
  readonly value: number | null;
  readonly fill: string;
  readonly children?: ReactNode;
}) {
  const { id, word, value, fill, children } = props;
  return (
    <div data-testid={`tailor-ats-${id}`} className="order-1 flex basis-full items-center gap-2">
      <span className="w-12 shrink-0 text-xs text-ink-muted">{word}</span>
      {value === null ? null : (
        <span
          data-testid={`tailor-ats-${id}-track`}
          aria-hidden="true"
          className="h-2 min-w-0 flex-1 overflow-hidden rounded-pill bg-sunken"
        >
          <span
            data-testid={`tailor-ats-${id}-bar`}
            className={`block h-full rounded-pill ${fill}`}
            style={{ width: `${value}%` }}
          />
        </span>
      )}
      <span className="ml-auto w-8 shrink-0 text-right">
        <Score value={value} />
      </span>
      <span className="w-24 shrink-0">{children}</span>
    </div>
  );
}

export function AtsStep({ comparison, fabrication }: AtsStepProps) {
  const { keyword, bullets, checks, stillMissing } = comparison;
  const toFix = checks.filter((check) => check.after !== 'pass');
  const afterBand = keyword.after === null ? null : atsBand(keyword.after);
  // No bullets on a side: nothing to score there, so no number and no change.
  const bulletsBefore = bullets.totalBefore === 0 ? null : bullets.before;
  const bulletsAfter = bullets.totalAfter === 0 ? null : bullets.after;
  const bulletsDelta = bulletsBefore === null || bulletsAfter === null ? null : bullets.delta;

  return (
    <section
      data-testid="tailor-ats"
      aria-labelledby="tailor-ats-heading"
      className={`space-y-3 ${cardClasses({ padding: 'none' })} px-4 py-3`}
    >
      <div>
        <h3
          id="tailor-ats-heading"
          className="font-mono text-[11px] font-medium tracking-[0.14em] text-ink-faint uppercase"
        >
          <Hint text={ATS_HINT.heading}>ATS score</Hint>
        </h3>
        <p className="mt-1 text-xs text-ink-muted">
          Your original CV and this draft, checked the same way, on this machine. Nothing is sent
          anywhere.
        </p>
      </div>

      {/*
        The change is last in reading order ("Keyword coverage. Before 54.
        After 81, Reads well. +27") but drawn at the right of the label line:
        the bar lines are `order-1`, so the change moves up beside the label.
      */}
      <ul data-testid="tailor-ats-bars" className="w-full max-w-lg space-y-3 text-ink">
        <li
          data-testid="tailor-ats-keyword"
          className="flex flex-wrap items-baseline gap-x-2 gap-y-1"
        >
          <span className="min-w-0 flex-1">
            <Hint text={ATS_HINT.keyword}>Keyword coverage</Hint>
          </span>
          <BarLine id="keyword-before" word="Before" value={keyword.before} fill="bg-ink-muted" />
          <BarLine
            id="keyword-after"
            word="After"
            value={keyword.after}
            fill={afterFill(keyword.delta)}
          >
            {afterBand === null ? null : (
              <span data-testid="tailor-ats-band" className={`text-xs ${ATS_BAND_TONE[afterBand]}`}>
                <Hint text={ATS_BAND_HINT[afterBand]} focusable={false}>
                  {ATS_BAND_WORD[afterBand]}
                </Hint>
              </span>
            )}
          </BarLine>
          <span className="w-24 shrink-0 text-xs" data-testid="tailor-ats-keyword-delta">
            <Delta value={keyword.delta} />
          </span>
        </li>

        <li
          data-testid="tailor-ats-bullets"
          className="flex flex-wrap items-baseline gap-x-2 gap-y-1"
        >
          <span className="min-w-0 flex-1">
            <Hint text={ATS_HINT.bullets}>Bullet strength</Hint>
          </span>
          <BarLine id="bullets-before" word="Before" value={bulletsBefore} fill="bg-ink-muted" />
          <BarLine
            id="bullets-after"
            word="After"
            value={bulletsAfter}
            fill={afterFill(bulletsDelta)}
          />
          <span className="w-24 shrink-0 text-xs" data-testid="tailor-ats-bullets-delta">
            <Delta value={bulletsDelta} />
          </span>
        </li>
      </ul>

      <table className="w-full max-w-lg text-left">
        <caption className="sr-only">ATS readiness before and after tailoring</caption>
        <thead className="text-xs text-ink-faint">
          <tr>
            <th scope="col" className="py-1 pr-3 font-medium">
              Check
            </th>
            <th scope="col" className="py-1 pr-3 font-medium">
              <Hint text={ATS_HINT.before}>Before</Hint>
            </th>
            <th scope="col" className="py-1 pr-3 font-medium">
              <Hint text={ATS_HINT.after}>After</Hint>
            </th>
          </tr>
        </thead>
        <tbody className="text-ink">
          {checks.map((check) => (
            <tr
              key={check.id}
              data-testid={`tailor-ats-check-${check.id}`}
              data-after={check.after}
            >
              <th scope="row" className="py-1 pr-3 font-normal">
                <Hint text={ATS_CHECK_HINT[check.id]}>{check.label}</Hint>
              </th>
              <td className={`py-1 pr-3 text-xs ${STATUS_TONE[check.before]}`}>
                <Hint text={ATS_STATUS_HINT[check.before]} focusable={false}>
                  <StateMark name={STATUS_MARK[check.before]} /> {STATUS_WORD[check.before]}
                </Hint>
              </td>
              <td className={`py-1 pr-3 text-xs ${STATUS_TONE[check.after]}`}>
                <Hint text={ATS_STATUS_HINT[check.after]} focusable={false}>
                  <StateMark name={STATUS_MARK[check.after]} /> {STATUS_WORD[check.after]}
                </Hint>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {keyword.after === null && keyword.afterReason !== null ? (
        <p data-testid="tailor-ats-keyword-reason" className="text-xs text-ink-muted">
          No keyword score for this draft: {keyword.afterReason}
        </p>
      ) : null}

      {bullets.totalAfter === 0 ? (
        <p data-testid="tailor-ats-no-bullets" className="text-xs text-ink-muted">
          No bullet points found in this draft, so there is nothing to score for bullet strength.
          Lines starting with “-” or “•” count as bullets.
        </p>
      ) : null}

      {toFix.length === 0 ? null : (
        <ul data-testid="tailor-ats-fixes" className="space-y-1 text-xs text-ink-muted">
          {toFix.map((check) => (
            <li key={check.id}>
              <span className="font-medium text-ink">{check.label}:</span> {check.afterMessage}
            </li>
          ))}
        </ul>
      )}

      {stillMissing.length === 0 ? null : (
        <p data-testid="tailor-ats-missing" className="text-xs text-ink-muted">
          <span className="font-medium text-ink">
            <Hint text={ATS_HINT.stillMissing}>Still missing from the advert:</Hint>
          </span>{' '}
          {stillMissing.join(', ')}. Only add a word if it is true for you.
        </p>
      )}

      <p
        data-testid="tailor-ats-fabrication"
        data-clean={fabrication.clean ? 'true' : 'false'}
        className={fabrication.clean ? 'text-xs text-teal-ink' : 'text-xs text-gold-ink'}
      >
        <Hint text={ATS_HINT.fabrication}>Fabrication check:</Hint>{' '}
        {fabrication.clean
          ? 'every employer, year, certification and figure is in your original CV.'
          : `${fabrication.flagged} ${fabrication.flagged === 1 ? 'thing' : 'things'} to check — listed at the top of the draft.`}
      </p>
    </section>
  );
}
