import { type DraftReview } from '@cviper/core-types';

import { PRIMARY_BUTTON, QUIET_BUTTON, SECONDARY_BUTTON } from '../../app/buttons';
import { MoreMenu } from '../../app/MoreMenu';
import { IconTile } from '../../ui';

import { AtsStep } from './AtsStep';
import { type AtsComparison } from './atsComparison';
import { contactSummary, type CvContact } from './cvContact';
import { type LetterResult, type Phase, type TailorResult } from './jobSessions';
import { TailorDraft } from './TailorDraft';
import { TailorLetter } from './TailorLetter';
import { TailorReview } from './TailorReview';
import { TailorSaveApplication, type TailorSaveApplicationProps } from './TailorSaveApplication';
import { STEP_ANCHOR, type PendingAction } from './tailorSteps';

export interface TailorResultViewProps {
  readonly result: TailorResult | null;
  readonly cvText: string;
  readonly atsComparison: AtsComparison | null;
  /** The user's added results changed since this draft was written (L-205). */
  readonly metricsChanged: boolean;
  readonly review: DraftReview | null;
  readonly letter: LetterResult | null;
  readonly phase: Phase;
  /** A run or a save is going: every action waits. */
  readonly busy: boolean;
  /** Review or letter, through the consent gate. */
  readonly onRun: (action: Exclude<PendingAction, 'tailor'>) => void;
  readonly onSaveText: (kind: 'cv' | 'cover_letter') => void;
  readonly onSaveDocument: (kind: 'cv' | 'cover_letter', format: 'docx' | 'pdf') => void;
  readonly saveApplication: Omit<TailorSaveApplicationProps, 'busy'>;
  /** The details confirmed for this draft's CV (L-346), or `null` before the first save. */
  readonly contact: CvContact | null;
  readonly onChangeContact: () => void;
}

/** Tailor, step 5: nothing yet, or the draft and everything done with it. */
export function TailorResultView({
  result,
  cvText,
  atsComparison,
  metricsChanged,
  review,
  letter,
  phase,
  busy,
  onRun,
  onSaveText,
  onSaveDocument,
  saveApplication,
  contact,
  onChangeContact,
}: TailorResultViewProps) {
  if (result === null) {
    return (
      <div
        data-testid="tailor-empty"
        className="rounded-card border border-line border-dashed bg-card px-6 py-8 text-center"
      >
        <div className="mb-3 flex justify-center">
          <IconTile icon="tailor" />
        </div>
        <p className="font-medium text-ink">Nothing tailored yet.</p>
        <p className="mt-1 text-ink-muted">
          Pick a CV and an advert, then press the button. Every employer, date, figure and
          certification in the result is checked against your original CV before you see it.
        </p>
      </div>
    );
  }

  return (
    <div data-testid="tailor-result" className="space-y-4">
      <TailorDraft result={result} cvText={cvText} contact={contact} />

      {/*
        The ATS Score step (L-198): this draft re-scored against the same
        advert, before → after, so the last thing read before saving is
        whether tailoring helped. Pure and offline — see `atsComparison.ts`.
      */}
      <span id={STEP_ANCHOR.ats} aria-hidden="true" />
      {atsComparison === null ? null : (
        <AtsStep
          comparison={atsComparison}
          fabrication={{ clean: result.report.clean, flagged: result.report.flagged.length }}
        />
      )}

      {metricsChanged ? (
        <p data-testid="tailor-metrics-changed-note" className="text-xs text-ink-muted">
          Your added results changed since this draft. Re-run tailoring to use them.
        </p>
      ) : null}

      {/* What a saved CV will carry at the top (L-346), once the user has said. */}
      {contact === null ? null : (
        <div
          data-testid="tailor-contact-line"
          className="flex flex-wrap items-center gap-2 text-xs text-ink-muted"
        >
          <span>
            {`At the top of this CV: ${contactSummary(contact) || 'no name or contact details.'}`}
          </span>
          <button
            type="button"
            data-testid="tailor-contact-change"
            disabled={busy}
            onClick={onChangeContact}
            className={QUIET_BUTTON}
          >
            Change
          </button>
        </div>
      )}

      {/*
        The one blue button once there is a draft (L-400): Save as PDF. The
        other formats sit in the shared menu; "Tailor CV" turns grey above.
      */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="tailor-save-pdf-cv"
          data-primary="true"
          disabled={busy}
          onClick={() => onSaveDocument('cv', 'pdf')}
          className={PRIMARY_BUTTON}
        >
          Save as PDF…
        </button>
        <MoreMenu
          label="More formats"
          showLabel
          testId="tailor-save-more"
          items={[
            {
              label: 'Save as Word…',
              onSelect: () => onSaveDocument('cv', 'docx'),
              disabled: busy,
              testId: 'tailor-save-docx-cv',
            },
            {
              label: 'Save as text…',
              onSelect: () => onSaveText('cv'),
              disabled: busy,
              testId: 'tailor-save-text',
            },
          ]}
        />
        <button
          type="button"
          data-testid="tailor-review-run"
          disabled={busy}
          onClick={() => onRun('review')}
          className={SECONDARY_BUTTON}
        >
          {phase === 'reviewing' ? 'Reviewing…' : 'Review the draft'}
        </button>
        <button
          type="button"
          data-testid="tailor-letter-run"
          disabled={busy}
          onClick={() => onRun('letter')}
          className={SECONDARY_BUTTON}
        >
          {phase === 'writing' ? 'Writing…' : 'Write the cover letter'}
        </button>
      </div>

      {review === null ? null : <TailorReview review={review} />}

      {letter === null ? null : (
        <TailorLetter
          letter={letter}
          busy={busy}
          onSaveText={() => onSaveText('cover_letter')}
          onSaveDocument={(format) => onSaveDocument('cover_letter', format)}
        />
      )}

      {/* ── Save to an application ─────────────────────────────── */}
      <span id={STEP_ANCHOR.export} aria-hidden="true" />
      <TailorSaveApplication {...saveApplication} busy={busy} />
    </div>
  );
}
