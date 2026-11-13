import { type FabricationFlag } from '@cviper/ai-providers';

import { FLOW_HINT } from '../../app/hints';
import { cardClasses } from '../../ui';
import { providerInSentence } from '../analysis/model';

import { type CvContact } from './cvContact';
import { CvPage } from './CvPage';
import { lineDiff } from './diff';
import { type TailorResult } from './jobSessions';

const FLAG_LABELS: Readonly<Record<FabricationFlag['kind'], string>> = {
  employer: 'Employer not in your CV',
  date: 'Year not in your CV',
  certification: 'Certification not in your CV',
  metric: 'Figure not in your CV',
};

export interface TailorDraftProps {
  readonly result: TailorResult;
  /** The original CV text, for the "what changed" list. */
  readonly cvText: string;
  /** The details confirmed for this draft's CV (L-346), or `null`: the page shows no name. */
  readonly contact: CvContact | null;
}

/**
 * The tailored draft: the fabrication report FIRST and never red (see the note
 * at the top of `Tailor.tsx`), who wrote it, the CV as a page, and what changed.
 */
export function TailorDraft({ result, cvText, contact }: TailorDraftProps) {
  return (
    <>
      {/* The fabrication report — FIRST, and never red. */}
      <div
        data-testid="tailor-fabrication"
        data-clean={result.report.clean ? 'true' : 'false'}
        className={
          result.report.clean
            ? 'rounded-control bg-teal/10 px-3 py-2 text-teal-ink'
            : 'rounded-control bg-gold/10 px-3 py-2 text-gold-ink'
        }
      >
        {result.report.clean ? (
          <p>
            Checked: every employer, year, certification and figure in this draft is in your
            original CV.
          </p>
        ) : (
          <>
            <p className="font-medium">
              Check these before you use it — the model wrote things your CV does not say:
            </p>
            <ul className="mt-1 space-y-0.5">
              {result.report.flagged.map((flag) => (
                <li key={`${flag.kind}:${flag.text}`}>
                  <span className="text-xs uppercase">{FLAG_LABELS[flag.kind]}</span>
                  {': '}
                  <span className="font-medium">{flag.text}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <p data-testid="tailor-provenance" className="text-xs text-ink-faint">
        Written by {providerInSentence(result.provider)} · {result.model}
        {result.retried ? ' · recovered on retry' : ''}
      </p>

      <CvPage cv={result.cv} contact={contact} />

      <details className={`${cardClasses({ padding: 'none' })} px-4 py-3`}>
        <summary className="cursor-pointer font-medium text-ink">
          What changed against your original
        </summary>
        <p data-testid="tailor-diff-legend" className="mt-2 text-xs text-ink-muted">
          {FLOW_HINT.diff}
        </p>
        <ol data-testid="tailor-diff" className="mt-2 space-y-0.5 font-mono text-xs">
          {lineDiff(cvText, result.text).map((line, index) => (
            <li
              key={`${index}:${line.kind}`}
              data-diff={line.kind}
              className={
                line.kind === 'added'
                  ? 'bg-teal/10 text-ink'
                  : line.kind === 'removed'
                    ? 'bg-danger/10 text-ink-muted line-through'
                    : 'text-ink-muted'
              }
            >
              {line.text}
            </li>
          ))}
        </ol>
      </details>
    </>
  );
}
