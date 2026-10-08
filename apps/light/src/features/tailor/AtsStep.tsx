import { type CheckStatus } from '@cviper/ats-checks';
import { atsBand } from '@cviper/keyword-scoring';

import { Hint } from '../../app/Hint';
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
 * A table, not a grid of cards: the question is "what changed in each row",
 * and a table with a caption reads to a screen reader as exactly that.
 */
export interface AtsStepProps {
  readonly comparison: AtsComparison;
  /** The fabrication check on the same draft: clean, or how many things to check. */
  readonly fabrication: { readonly clean: boolean; readonly flagged: number };
}

const STATUS_WORD: Readonly<Record<CheckStatus, string>> = {
  pass: '✓ OK',
  warn: '⚠ Check',
  fail: '✗ Missing',
};

const STATUS_TONE: Readonly<Record<CheckStatus, string>> = {
  pass: 'whitespace-nowrap text-teal-ink',
  warn: 'whitespace-nowrap text-gold-ink',
  fail: 'whitespace-nowrap font-medium text-gold-ink',
};

// Every mark below carries a hint (L-215): what ✓ ⚠ ✗, ▲ ▼ and — mean, in
// words, on hover, on focus and to a screen reader. See `app/hints.ts`.

function Delta({ value }: { readonly value: number | null }) {
  if (value === null) {
    return (
      <Hint text={ATS_HINT.noScore} className="text-ink-faint">
        —
      </Hint>
    );
  }
  if (value === 0) {
    return (
      <Hint text={ATS_HINT.noChange} className="whitespace-nowrap text-ink-faint">
        no change
      </Hint>
    );
  }
  return (
    <Hint
      text={changeHint(value)}
      className={`whitespace-nowrap ${value > 0 ? 'text-teal-ink' : 'text-gold-ink'}`}
    >
      {value > 0 ? `▲ +${value}` : `▼ ${value}`}
    </Hint>
  );
}

function Score({ value }: { readonly value: number | null }) {
  return value === null ? (
    <Hint text={ATS_HINT.noScore} className="text-ink-faint">
      —
    </Hint>
  ) : (
    <span className="font-mono tabular-nums">{value}</span>
  );
}

export function AtsStep({ comparison, fabrication }: AtsStepProps) {
  const { keyword, bullets, checks, stillMissing } = comparison;
  const toFix = checks.filter((check) => check.after !== 'pass');
  const afterBand = keyword.after === null ? null : atsBand(keyword.after);

  return (
    <section
      data-testid="tailor-ats"
      aria-labelledby="tailor-ats-heading"
      className="space-y-3 rounded-card border border-line bg-card px-4 py-3"
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
            <th scope="col" className="py-1 pr-3 font-medium">
              <span className="sr-only">Change</span>
            </th>
          </tr>
        </thead>
        <tbody className="text-ink">
          <tr data-testid="tailor-ats-keyword">
            <th scope="row" className="py-1 pr-3 font-normal">
              <Hint text={ATS_HINT.keyword}>Keyword coverage</Hint>
            </th>
            <td className="py-1 pr-3">
              <Score value={keyword.before} />
            </td>
            <td className="py-1 pr-3">
              <Score value={keyword.after} />
              {afterBand === null ? null : (
                <span
                  data-testid="tailor-ats-band"
                  className={`ml-2 text-xs ${ATS_BAND_TONE[afterBand]}`}
                >
                  <Hint text={ATS_BAND_HINT[afterBand]}>{ATS_BAND_WORD[afterBand]}</Hint>
                </span>
              )}
            </td>
            <td className="py-1 pr-3 text-xs" data-testid="tailor-ats-keyword-delta">
              <Delta value={keyword.delta} />
            </td>
          </tr>

          <tr data-testid="tailor-ats-bullets">
            <th scope="row" className="py-1 pr-3 font-normal">
              <Hint text={ATS_HINT.bullets}>Bullet strength</Hint>
            </th>
            <td className="py-1 pr-3">
              <Score value={bullets.totalBefore === 0 ? null : bullets.before} />
            </td>
            <td className="py-1 pr-3">
              <Score value={bullets.totalAfter === 0 ? null : bullets.after} />
            </td>
            <td className="py-1 pr-3 text-xs" data-testid="tailor-ats-bullets-delta">
              <Delta
                value={bullets.totalBefore === 0 || bullets.totalAfter === 0 ? null : bullets.delta}
              />
            </td>
          </tr>

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
                <Hint text={ATS_STATUS_HINT[check.before]}>{STATUS_WORD[check.before]}</Hint>
              </td>
              <td className={`py-1 pr-3 text-xs ${STATUS_TONE[check.after]}`}>
                <Hint text={ATS_STATUS_HINT[check.after]}>{STATUS_WORD[check.after]}</Hint>
              </td>
              <td className="py-1 pr-3" />
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
