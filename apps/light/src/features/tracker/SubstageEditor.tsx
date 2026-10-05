import { useEffect, useRef, useState } from 'react';

import {
  INTERVIEW_SUBSTAGE_NAME_MAX,
  INTERVIEW_SUBSTAGES_MAX,
  type InterviewSubstage,
} from '@cviper/core-types';

import { QUIET_BUTTON, SECONDARY_BUTTON } from '../../app/buttons';

/**
 * Add, rename, reorder and remove the interview stages, in the side pane.
 *
 * ============================================================================
 * KEYBOARD FIRST
 * ============================================================================
 * Nothing here needs a mouse and nothing needs dragging. Every name is a text
 * box that commits on Enter or when it loses focus and cancels on Escape;
 * reordering is a pair of real buttons per row (disabled at the ends, never
 * hidden, so the row does not change shape); adding is a form, so Enter in the
 * box submits it.
 *
 * Every control carries the stage's NAME in its accessible label ("Move Panel
 * Round up"), because a screen reader walking the list hears the same three
 * words repeated otherwise.
 *
 * ============================================================================
 * AN ERROR BELONGS TO THE BOX IT IS ABOUT
 * ============================================================================
 * A refused rename keeps what was typed and says why next to that row, wired
 * with `aria-invalid` and `aria-describedby`; Escape is what puts the old name
 * back. A refused add does the same on the new-stage box. Whatever was
 * refused, the person is never made to retype.
 *
 * ============================================================================
 * REMOVING A STAGE THAT CARDS USE ASKS FIRST
 * ============================================================================
 * There is no undo, so the row turns into the question — with the number of
 * cards it affects — and focus lands on Keep, so a stray Enter keeps things as
 * they were. Unused stages go straight away.
 *
 * ============================================================================
 * WHAT THIS DOES NOT OWN
 * ============================================================================
 * The rules (empty, duplicate, too many) live in `interviewSubstages.ts`, and
 * saving lives in the board. This component hands a request up and the answer
 * comes back as `null` (done) or the sentence to show.
 *
 * `INTERVIEW_SUBSTAGES_MAX` is an EDITOR rule only. A merge import can leave
 * the app holding more; they all show, can be renamed and removed, and only
 * Add is switched off.
 */

interface SubstageEditorProps {
  readonly substages: readonly InterviewSubstage[];
  /** A save is in flight: nothing else may start until it answers. */
  readonly busy: boolean;
  /** How many cards are in this stage right now. */
  readonly usage: (id: string) => number;
  readonly onAdd: (name: string) => Promise<string | null>;
  readonly onRename: (id: string, name: string) => Promise<string | null>;
  readonly onMove: (id: string, direction: 'up' | 'down') => Promise<string | null>;
  readonly onRemove: (id: string) => Promise<string | null>;
}

type Message = { readonly text: string; readonly source: 'add' | 'general' };

const FIELD =
  'min-w-0 rounded-control border border-line bg-card px-2.5 py-1.5 text-ink ' +
  'placeholder:text-ink-muted aria-[invalid=true]:border-danger';

export function SubstageEditor({
  substages,
  busy,
  usage,
  onAdd,
  onRename,
  onMove,
  onRemove,
}: SubstageEditorProps) {
  const [newName, setNewName] = useState('');
  const [message, setMessage] = useState<Message | null>(null);
  const [status, setStatus] = useState('');
  /** Names being typed, by id. Absent means "show the stored name". */
  const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>({});
  const [rowErrors, setRowErrors] = useState<Readonly<Record<string, string>>>({});
  const [confirming, setConfirming] = useState<{ id: string; cards: number } | null>(null);

  const inputs = useRef(new Map<string, HTMLInputElement>());
  const newBox = useRef<HTMLInputElement>(null);
  const keepButton = useRef<HTMLButtonElement>(null);
  /** Rows whose rename is in flight: Enter then blur must not save twice. */
  const committing = useRef(new Set<string>());
  const pendingFocus = useRef<{ removedId: string; target: string | 'new' } | null>(null);

  // Into the pane when it opens: the first stage's name, or the add box if
  // there are none. A keyboard user opened this; they should be IN it.
  useEffect(() => {
    const first = substages[0];
    (first === undefined ? newBox.current : inputs.current.get(first.id))?.focus();
    // Once, on open.
  }, []);

  // After a removal, once the row is really gone, to the next row, else the
  // previous, else the add box.
  useEffect(() => {
    const pending = pendingFocus.current;
    if (pending === null || substages.some((substage) => substage.id === pending.removedId)) return;
    pendingFocus.current = null;
    (pending.target === 'new' ? newBox.current : inputs.current.get(pending.target))?.focus();
  }, [substages]);

  // The question is a safe default: Keep, not Remove.
  useEffect(() => {
    if (confirming !== null) keepButton.current?.focus();
  }, [confirming]);

  const atLimit = substages.length >= INTERVIEW_SUBSTAGES_MAX;

  function clearFeedback(): void {
    setMessage(null);
    setStatus('');
  }

  function discardDraft(id: string): void {
    setDrafts((current) => {
      const { [id]: _discarded, ...rest } = current;
      return rest;
    });
    setRowErrors((current) => {
      const { [id]: _discarded, ...rest } = current;
      return rest;
    });
  }

  /** Commit a rename in progress. `true` when there is nothing left unsaved. */
  async function commitName(substage: InterviewSubstage): Promise<boolean> {
    if (committing.current.has(substage.id)) return false;
    const draft = drafts[substage.id];
    if (draft === undefined || draft === substage.name) {
      discardDraft(substage.id);
      return true;
    }

    committing.current.add(substage.id);
    try {
      clearFeedback();
      const problem = await onRename(substage.id, draft);
      if (problem === null) {
        discardDraft(substage.id);
        setStatus(`Renamed to ${draft.trim()}`);
        return true;
      }
      // Refused: the draft STAYS, with the reason on its row. Escape reverts.
      setRowErrors((current) => ({ ...current, [substage.id]: problem }));
      return false;
    } finally {
      committing.current.delete(substage.id);
    }
  }

  async function act(
    substage: InterviewSubstage,
    request: () => Promise<string | null>,
    done: string,
  ): Promise<boolean> {
    // Any rename in progress on this row is saved first, so the action lands on
    // the row that was clicked and nothing typed is lost.
    if (!(await commitName(substage))) return false;
    clearFeedback();
    const problem = await request();
    if (problem === null) {
      setStatus(done);
      return true;
    }
    setMessage({ text: problem, source: 'general' });
    return false;
  }

  async function remove(substage: InterviewSubstage, index: number): Promise<void> {
    const next = substages[index + 1] ?? substages[index - 1];
    pendingFocus.current = { removedId: substage.id, target: next?.id ?? 'new' };
    const removed = await act(substage, () => onRemove(substage.id), `Removed ${substage.name}`);
    if (!removed) pendingFocus.current = null;
  }

  function requestRemove(substage: InterviewSubstage, index: number): void {
    const cards = usage(substage.id);
    if (cards > 0) {
      setConfirming({ id: substage.id, cards });
      return;
    }
    void remove(substage, index);
  }

  const messageId = 'substage-message';
  const addInvalid = message?.source === 'add';

  return (
    <div data-testid="substage-editor" aria-busy={busy} className="space-y-4">
      <div className="space-y-1">
        <p className="text-ink-muted">
          Break Interviewing into your own stages. A card in Interviewing can be in one of them.
          Removing a stage never removes a card — it just stops saying which stage it is in.
        </p>
        <p id="substage-hint" className="text-xs text-ink-muted">
          Press Enter to save, Escape to cancel.
        </p>
      </div>

      {/* Spoken, not shown loudly: what just happened. */}
      <p role="status" aria-live="polite" data-testid="substage-status" className="sr-only">
        {status}
      </p>

      {message === null ? null : (
        <p
          id={messageId}
          role="alert"
          data-testid="substage-error"
          className="rounded-control border border-danger/30 bg-danger/5 px-3 py-2 text-danger"
        >
          {message.text}
        </p>
      )}

      {substages.length === 0 ? (
        <p data-testid="substage-empty" className="text-ink-muted">
          Add the stages your interviews usually follow, for example “HR Screen”.
        </p>
      ) : (
        <ol className="space-y-3">
          {substages.map((substage, index) => {
            const rowError = rowErrors[substage.id];
            const errorId = `substage-row-error-${substage.id}`;
            const asking = confirming?.id === substage.id;

            return (
              <li key={substage.id} className="space-y-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <input
                    ref={(element) => {
                      if (element === null) inputs.current.delete(substage.id);
                      else inputs.current.set(substage.id, element);
                    }}
                    type="text"
                    aria-label={`Name of ${substage.name}`}
                    aria-invalid={rowError === undefined ? undefined : true}
                    aria-describedby={rowError === undefined ? 'substage-hint' : errorId}
                    readOnly={busy}
                    value={drafts[substage.id] ?? substage.name}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setDrafts((current) => ({ ...current, [substage.id]: value }));
                    }}
                    onBlur={() => void commitName(substage)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void commitName(substage);
                      } else if (
                        event.key === 'Escape' &&
                        (drafts[substage.id] !== undefined || rowError !== undefined)
                      ) {
                        // Only the edit is abandoned; the pane stays open.
                        event.preventDefault();
                        event.stopPropagation();
                        discardDraft(substage.id);
                      }
                    }}
                    className={`${FIELD} min-w-32 flex-1 basis-40`}
                  />

                  {asking ? null : (
                    <>
                      {/* mouseDown is cancelled so the click does not first blur the
                          box: that blur would start a save, disable these buttons, and
                          swallow the click. `act` saves the draft itself. */}
                      <button
                        type="button"
                        aria-label={`Move ${substage.name} up`}
                        disabled={busy || index === 0}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() =>
                          void act(
                            substage,
                            () => onMove(substage.id, 'up'),
                            `Moved ${drafts[substage.id]?.trim() ?? substage.name} up`,
                          )
                        }
                        className={`${QUIET_BUTTON} min-w-11`}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        aria-label={`Move ${substage.name} down`}
                        disabled={busy || index === substages.length - 1}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() =>
                          void act(
                            substage,
                            () => onMove(substage.id, 'down'),
                            `Moved ${drafts[substage.id]?.trim() ?? substage.name} down`,
                          )
                        }
                        className={`${QUIET_BUTTON} min-w-11`}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove ${substage.name}`}
                        disabled={busy}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => requestRemove(substage, index)}
                        className={SECONDARY_BUTTON}
                      >
                        Remove
                      </button>
                    </>
                  )}
                </div>

                {asking && confirming !== null ? (
                  <div
                    data-testid="substage-confirm"
                    role="group"
                    aria-label={`Remove ${substage.name}?`}
                    className="space-y-2 rounded-control border border-line bg-sunken px-3 py-2"
                    onKeyDown={(event) => {
                      if (event.key !== 'Escape') return;
                      event.preventDefault();
                      event.stopPropagation();
                      setConfirming(null);
                      inputs.current.get(substage.id)?.focus();
                    }}
                  >
                    <p className="text-ink">
                      {`Remove ${substage.name}? ${confirming.cards} ${
                        confirming.cards === 1 ? 'card' : 'cards'
                      } will go back to No stage.`}
                    </p>
                    <div className="flex gap-2">
                      <button
                        ref={keepButton}
                        type="button"
                        onClick={() => {
                          setConfirming(null);
                          inputs.current.get(substage.id)?.focus();
                        }}
                        className={SECONDARY_BUTTON}
                      >
                        Keep
                      </button>
                      <button
                        type="button"
                        data-testid="substage-confirm-remove"
                        aria-label={`Remove ${substage.name}`}
                        disabled={busy}
                        onClick={() => {
                          setConfirming(null);
                          void remove(substage, index);
                        }}
                        className={SECONDARY_BUTTON}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ) : null}

                {rowError === undefined ? null : (
                  <p
                    id={errorId}
                    role="alert"
                    data-testid={errorId}
                    className="text-xs text-danger"
                  >
                    {rowError}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}

      <form
        className="border-t border-line pt-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (atLimit || busy) return;
          void (async () => {
            clearFeedback();
            const added = newName.trim();
            const problem = await onAdd(newName);
            if (problem === null) {
              setNewName('');
              setStatus(`Added ${added}`);
            } else {
              // Kept in the box so it can be corrected rather than retyped.
              setMessage({ text: problem, source: 'add' });
            }
          })();
        }}
      >
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor="substage-new" className="block text-xs font-medium text-ink-muted">
            New interview stage
          </label>
          <span
            id="substage-count"
            data-testid="substage-count"
            className={`font-mono text-xs tabular-nums ${
              newName.length > INTERVIEW_SUBSTAGE_NAME_MAX ? 'text-danger' : 'text-ink-muted'
            }`}
          >
            {`${newName.length} / ${INTERVIEW_SUBSTAGE_NAME_MAX}`}
          </span>
        </div>
        <div className="mt-1 flex gap-2">
          <input
            id="substage-new"
            ref={newBox}
            type="text"
            value={newName}
            placeholder="Panel Round"
            aria-invalid={addInvalid ? true : undefined}
            aria-describedby={addInvalid ? `${messageId} substage-count` : 'substage-count'}
            onChange={(event) => setNewName(event.currentTarget.value)}
            className={`${FIELD} flex-1`}
          />
          <button
            type="submit"
            data-testid="substage-add"
            disabled={busy || atLimit}
            className={SECONDARY_BUTTON}
          >
            Add stage
          </button>
        </div>
        {atLimit ? (
          <p data-testid="substage-limit" className="mt-1 text-xs text-ink-muted">
            {`You have ${substages.length} interview stages. You can add up to ${INTERVIEW_SUBSTAGES_MAX}: remove one to add another.`}
          </p>
        ) : null}
      </form>
    </div>
  );
}
