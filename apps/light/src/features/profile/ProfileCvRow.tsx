import { useEffect, useId, useRef, useState, type FormEvent } from 'react';

import { type Cv } from '@cviper/core-types';

import { DESTRUCTIVE_BUTTON, QUIET_BUTTON, SECONDARY_BUTTON } from '../../app/buttons';
import { FIELD, FIELD_INVALID } from '../../app/fields';
import { Dialog } from '../../ui';

// --- One saved CV: its name, its facts, Rename and Delete (L-408) ------------

/** The longest name a CV can be given, in characters as a person counts them. */
export const MAX_CV_NAME = 100;

/**
 * A thin line above every row but the first (L-436). A border on each row, not
 * a divide colour on the list: `contrast.contract.test.ts` forbids those.
 */
const ROW_LINE = 'border-t border-line first:border-t-0';

/**
 * What is wrong with a name, already trimmed, or `null`.
 *
 * Counted in code points, so an emoji or an accented letter is one character
 * and not the two or four a `.length` would call it.
 */
export function cvNameProblem(name: string): string | null {
  if (name === '') return 'Give the CV a name.';
  if ([...name].length > MAX_CV_NAME) return 'Keep the name to 100 characters or fewer.';
  return null;
}

interface CvRowProps {
  readonly cv: Cv;
  /** "540 words. Added 3 November 2026.", or `''` when neither can be said. */
  readonly facts: string;
  /** Save the new name. Resolves to what went wrong, in words, or `null`. */
  readonly onRename: (cv: Cv, name: string) => Promise<string | null>;
  readonly onDelete: (cv: Cv) => void;
}

/**
 * Rename happens in the row, not in a pop-up: it can be undone by renaming
 * again, so the page has no reason to stop and wait. Delete cannot, so it asks
 * (`ConfirmDeleteCv` below, drawn by the list that owns the CVs).
 */
export function CvRow({ cv, facts, onRename, onDelete }: CvRowProps) {
  /** The name being typed, or `null` while the row is at rest. */
  const [draft, setDraft] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const renameRef = useRef<HTMLButtonElement>(null);
  const backToRename = useRef(false);
  const id = useId();

  // The box replaced the Rename button, so there is nothing for the browser to
  // hand focus back to: put it on the button once that is drawn again.
  useEffect(() => {
    if (draft !== null || !backToRename.current) return;
    backToRename.current = false;
    renameRef.current?.focus();
  }, [draft]);

  function close(): void {
    backToRename.current = true;
    setDraft(null);
    setProblem(null);
  }

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (draft === null || busy) return;

    const name = draft.trim();
    const wrong = cvNameProblem(name);
    if (wrong !== null) {
      setProblem(wrong);
      return;
    }
    if (name === cv.name) {
      close();
      return;
    }

    setBusy(true);
    const failed = await onRename(cv, name);
    setBusy(false);
    if (failed === null) close();
    else setProblem(failed);
  }

  if (draft !== null) {
    return (
      <li className={`${ROW_LINE} py-2.5`}>
        <form noValidate onSubmit={(event) => void onSubmit(event)}>
          <label htmlFor={`${id}-name`} className="block text-xs font-medium text-ink-muted">
            Name
          </label>
          <input
            id={`${id}-name`}
            data-testid={`profile-cv-name-input-${cv.id}`}
            type="text"
            value={draft}
            // A deliberate step the user just took: the box is where they are.
            autoFocus
            aria-invalid={problem !== null}
            aria-describedby={problem === null ? undefined : `${id}-problem`}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') close();
            }}
            className={`mt-1 w-full ${problem === null ? FIELD : FIELD_INVALID}`}
          />
          {problem === null ? null : (
            <p
              id={`${id}-problem`}
              role="alert"
              data-testid={`profile-cv-name-error-${cv.id}`}
              className="mt-1 text-xs break-words text-danger"
            >
              {problem}
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={busy}
              data-testid={`profile-cv-name-save-${cv.id}`}
              className={SECONDARY_BUTTON}
            >
              Save
            </button>
            <button
              type="button"
              onClick={close}
              data-testid={`profile-cv-name-cancel-${cv.id}`}
              className={QUIET_BUTTON}
            >
              Cancel
            </button>
          </div>
        </form>
      </li>
    );
  }

  // One row (L-436): the buttons sit to the right from `md` up, under the name on a phone.
  return (
    <li
      className={`${ROW_LINE} flex flex-col gap-1 py-2.5 md:flex-row md:items-center md:justify-between`}
    >
      {/* `min-w-0`: a flex item is otherwise never narrower than its longest word. */}
      <div className="min-w-0 flex-1">
        <span data-testid="profile-cv-name" className="block font-medium break-words text-ink">
          {cv.name}
        </span>
        {facts === '' ? null : (
          <span data-testid="profile-cv-facts" className="block text-xs text-ink-muted">
            {facts}
          </span>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        {/* Two rows each have a "Rename" and a "Delete": the label says whose. */}
        <button
          ref={renameRef}
          type="button"
          aria-label={`Rename ${cv.name}`}
          onClick={() => setDraft(cv.name)}
          data-testid={`profile-cv-rename-${cv.id}`}
          className={`${QUIET_BUTTON} text-xs`}
        >
          Rename
        </button>
        <button
          type="button"
          aria-label={`Delete ${cv.name}`}
          onClick={() => onDelete(cv)}
          data-testid={`profile-cv-delete-${cv.id}`}
          className={`${QUIET_BUTTON} text-xs`}
        >
          Delete
        </button>
      </div>
    </li>
  );
}

interface ConfirmDeleteCvProps {
  readonly name: string;
  /** How many saved checks were made with this CV, read as the question opened. */
  readonly checks: number;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/**
 * The question before a CV is deleted. There is no undo and no bin.
 *
 * It says what goes and what stays, and each half is a fact about the schema
 * that `db/cvDelete.sqlite.test.ts` proves on a real database: the checks made
 * with the CV are deleted with it; jobs, and the tailored CVs and letters saved
 * to them, are not. Focus opens on Cancel, so a stray Enter deletes nothing.
 */
export function ConfirmDeleteCv({ name, checks, onConfirm, onCancel }: ConfirmDeleteCvProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const whatGoes =
    checks === 0
      ? 'No saved checks use this CV.'
      : `This also deletes ${checks.toLocaleString('en-GB')} saved ${checks === 1 ? 'check' : 'checks'} made with this CV.`;

  return (
    <Dialog
      initialFocus={cancelRef}
      onEscape={onCancel}
      labelledBy="profile-cv-delete-title"
      describedBy="profile-cv-delete-body"
      testId="profile-cv-delete-dialog"
    >
      <h2 id="profile-cv-delete-title" className="font-semibold break-words text-ink">
        {`Delete ${name}?`}
      </h2>
      <p
        id="profile-cv-delete-body"
        data-testid="profile-cv-delete-body"
        className="mt-1 text-ink-muted"
      >
        {`${whatGoes} Your jobs stay. Tailored CVs and letters you saved to a job stay.`}
      </p>

      <div className="mt-4 flex items-center justify-end gap-2">
        <button
          ref={cancelRef}
          type="button"
          onClick={onCancel}
          data-testid="profile-cv-delete-cancel"
          className={SECONDARY_BUTTON}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          data-testid="profile-cv-delete-confirm"
          className={DESTRUCTIVE_BUTTON}
        >
          Delete
        </button>
      </div>
    </Dialog>
  );
}
