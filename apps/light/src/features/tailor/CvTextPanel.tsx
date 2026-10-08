/**
 * The CV text the AI works from, and the way to correct it (L-218).
 *
 * ============================================================================
 * READ-ONLY UNTIL ASKED
 * ============================================================================
 * The text sits in a grey panel with no input border, so it does not look
 * like a box to type in — a white bordered box that ignores typing was the
 * report. Correcting it is a deliberate step: "Correct the text" opens a real
 * text box, and Save or Cancel closes it.
 *
 * ============================================================================
 * WHAT A CORRECTION DOES
 * ============================================================================
 * It is stored on the CV (`cvCorrection.ts`), so Analysis, Tailor and every
 * job use it. The panel says the text was corrected, shows what changed
 * against the FILE, and "Restore the text from the file" — after asking —
 * puts the file's text back. Nothing here is the AI's: it is the text read
 * from the file, as the user has corrected it.
 */
import { useState } from 'react';

import { wordCount, type Cv } from '@cviper/core-types';

import { QUIET_BUTTON, SECONDARY_BUTTON } from '../../app/buttons';

import { MAX_CV_TEXT_CHARS, correctedCv, isCorrected, restoredCv } from './cvCorrection';
import { lineDiff } from './diff';

export interface CvTextPanelProps {
  readonly cv: Cv;
  /** True while the AI is working, so the text it was sent cannot change under it. */
  readonly disabled: boolean;
  /** Store the CV. Resolves to a sentence saying why it failed, or `null`. */
  readonly onSave: (next: Cv) => Promise<string | null>;
}

const PROBLEM = {
  empty: 'The CV text cannot be empty. Undo with Cancel if you did not mean to clear it.',
  too_long: `The CV text can be at most ${MAX_CV_TEXT_CHARS.toLocaleString('en-GB')} characters.`,
} as const;

export function CvTextPanel({ cv, disabled, onSave }: CvTextPanelProps) {
  const text = cv.extracted_text ?? '';
  const corrected = isCorrected(cv);
  const [draft, setDraft] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);

  async function save(next: Cv): Promise<boolean> {
    setBusy(true);
    const failed = await onSave(next);
    setBusy(false);
    setProblem(failed);
    return failed === null;
  }

  async function onSaveDraft(value: string) {
    const next = correctedCv(cv, value);
    if (!next.ok) {
      setProblem(PROBLEM[next.error]);
      return;
    }
    if (await save(next.value)) setDraft(null);
  }

  async function onRestore() {
    if (await save(restoredCv(cv))) setConfirmRestore(false);
  }

  if (draft !== null) {
    return (
      <div data-testid="tailor-cv-edit">
        <label htmlFor="tailor-cv-edit-text" className="block text-xs font-medium text-ink-muted">
          Correct your CV text
        </label>
        <textarea
          id="tailor-cv-edit-text"
          data-testid="tailor-cv-edit-text"
          rows={14}
          maxLength={MAX_CV_TEXT_CHARS}
          value={draft}
          // A deliberate step the user just took: the box is where they are.
          autoFocus
          onChange={(event) => setDraft(event.currentTarget.value)}
          className="mt-1 w-full rounded-control border border-field-line bg-card px-2.5 py-1.5 font-sans text-ink"
        />
        <p className="mt-1 text-xs text-ink-faint">
          Fix anything that was misread. Add only what is true: the AI treats this text as your
          facts.{' '}
          <span data-testid="tailor-cv-edit-count" className="font-mono tabular-nums">
            {`${draft.length.toLocaleString('en-GB')} / ${MAX_CV_TEXT_CHARS.toLocaleString('en-GB')} characters`}
          </span>
        </p>
        {problem === null ? null : (
          <p role="alert" data-testid="tailor-cv-edit-problem" className="mt-1 text-xs text-danger">
            {problem}
          </p>
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            data-testid="tailor-cv-edit-save"
            disabled={busy}
            onClick={() => void onSaveDraft(draft)}
            className={SECONDARY_BUTTON}
          >
            Save the corrected text
          </button>
          <button
            type="button"
            data-testid="tailor-cv-edit-cancel"
            disabled={busy}
            onClick={() => {
              setDraft(null);
              setProblem(null);
            }}
            className={QUIET_BUTTON}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {text.trim() === '' ? (
        <p data-testid="tailor-cv-preview-empty" className="text-xs text-ink-faint">
          No text could be read from this CV, so there is nothing for the rewrite to work from. You
          can type or paste it in.
        </p>
      ) : (
        <>
          <p data-testid="tailor-cv-source" className="mb-1 text-xs text-ink-muted">
            {corrected
              ? `Read from ${cv.name}, then corrected by you. The AI works from exactly this text.`
              : `Read from ${cv.name}. The AI works from exactly this text.`}
          </p>
          {/* Focusable, so a keyboard alone can scroll a long CV. */}
          <pre
            data-testid="tailor-cv-preview-text"
            tabIndex={0}
            className="max-h-72 overflow-y-auto rounded-card bg-sunken px-4 py-3 font-sans text-ink whitespace-pre-wrap"
          >
            {text}
          </pre>
          <p data-testid="tailor-cv-preview-meta" className="mt-1 text-xs text-ink-faint">
            {cv.name} · <span className="font-mono tabular-nums">{wordCount(text)}</span> words
            {corrected ? ' · corrected' : ''}
          </p>
        </>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="tailor-cv-correct"
          disabled={disabled || busy}
          onClick={() => {
            setProblem(null);
            setConfirmRestore(false);
            setDraft(text);
          }}
          className={SECONDARY_BUTTON}
        >
          {text.trim() === '' ? 'Type or paste your CV text' : 'Correct the text'}
        </button>
        {corrected ? (
          <button
            type="button"
            data-testid="tailor-cv-restore"
            disabled={disabled || busy}
            onClick={() => setConfirmRestore(true)}
            className={QUIET_BUTTON}
          >
            Restore the text from the file
          </button>
        ) : null}
      </div>

      {confirmRestore ? (
        <div
          role="group"
          aria-label="Restore the text from the file"
          data-testid="tailor-cv-restore-confirm"
          className="mt-2 rounded-control bg-sunken px-3 py-2 text-ink"
        >
          <p>Put back the text read from {cv.name}? Your corrections will be lost.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              data-testid="tailor-cv-restore-yes"
              disabled={busy}
              onClick={() => void onRestore()}
              className={SECONDARY_BUTTON}
            >
              Restore
            </button>
            <button
              type="button"
              data-testid="tailor-cv-restore-keep"
              disabled={busy}
              onClick={() => setConfirmRestore(false)}
              className={QUIET_BUTTON}
            >
              Keep my corrections
            </button>
          </div>
        </div>
      ) : null}

      {problem === null ? null : (
        <p role="alert" data-testid="tailor-cv-edit-problem" className="mt-1 text-xs text-danger">
          {problem}
        </p>
      )}

      {corrected ? (
        <details data-testid="tailor-cv-changes" className="mt-2 text-xs">
          <summary className="cursor-pointer font-medium text-ink">What you changed</summary>
          <p className="mt-2 text-ink-muted">
            Green lines are yours. Struck-through lines were in the file and you changed or removed
            them.
          </p>
          <ol className="mt-2 space-y-0.5 font-mono">
            {lineDiff(cv.original_text ?? '', text).map((line, index) => (
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
      ) : null}
    </div>
  );
}
