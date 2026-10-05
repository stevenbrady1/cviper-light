import { useState } from 'react';

import { INTERVIEW_SUBSTAGE_NAME_MAX, type InterviewSubstage } from '@cviper/core-types';

import { QUIET_BUTTON, SECONDARY_BUTTON } from '../../app/buttons';

/**
 * Add, rename, reorder and remove the interview sub-stages, in the side pane.
 *
 * ============================================================================
 * KEYBOARD FIRST
 * ============================================================================
 * Nothing here needs a mouse and nothing needs dragging. Every name is a text
 * box that commits on Enter or when it loses focus; reordering is a pair of
 * real buttons per row (disabled at the ends, never hidden, so the row does not
 * change shape); adding is a form, so Enter in the box submits it.
 *
 * Every control carries the stage's NAME in its accessible label ("Move Panel
 * Round up"), because a screen reader walking the list hears the same three
 * words repeated otherwise.
 *
 * ============================================================================
 * WHAT THIS DOES NOT OWN
 * ============================================================================
 * The rules (empty, duplicate, too many) live in `interviewSubstages.ts`, and
 * saving lives in the board. This component hands a request up — `onAdd`,
 * `onRename`, `onMove`, `onRemove` — and the answer comes back as `null` (done)
 * or the sentence to show. So a refusal is shown in ONE place, in the same
 * words, whichever control caused it.
 */

interface SubstageEditorProps {
  readonly substages: readonly InterviewSubstage[];
  readonly onAdd: (name: string) => Promise<string | null>;
  readonly onRename: (id: string, name: string) => Promise<string | null>;
  readonly onMove: (id: string, direction: 'up' | 'down') => Promise<string | null>;
  readonly onRemove: (id: string) => Promise<string | null>;
}

export function SubstageEditor({
  substages,
  onAdd,
  onRename,
  onMove,
  onRemove,
}: SubstageEditorProps) {
  const [newName, setNewName] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  /** Names being typed, by id. Absent means "show the stored name". */
  const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>({});

  async function run(action: Promise<string | null>): Promise<boolean> {
    const problem = await action;
    setMessage(problem);
    return problem === null;
  }

  function discardDraft(id: string): void {
    setDrafts((current) => {
      const { [id]: _discarded, ...rest } = current;
      return rest;
    });
  }

  async function commitName(substage: InterviewSubstage): Promise<void> {
    const draft = drafts[substage.id];
    if (draft === undefined || draft === substage.name) {
      discardDraft(substage.id);
      return;
    }
    // Success OR refusal, the box goes back to the stored name: the list is
    // the truth, and a rejected edit left showing would look as though it stuck.
    await run(onRename(substage.id, draft));
    discardDraft(substage.id);
  }

  return (
    <div data-testid="substage-editor" className="space-y-4">
      <p className="text-ink-muted">
        Break Interviewing into your own steps. A card in Interviewing can be in one of them.
        Removing a step never removes a card — it just stops saying which step it is in.
      </p>

      {message === null ? null : (
        <p
          role="alert"
          data-testid="substage-error"
          className="rounded-control border border-danger/30 bg-danger/5 px-3 py-2 text-danger"
        >
          {message}
        </p>
      )}

      {substages.length === 0 ? (
        <p data-testid="substage-empty" className="text-ink-muted">
          No steps yet. Add one below, for example “HR Screen”.
        </p>
      ) : (
        <ol className="space-y-2">
          {substages.map((substage, index) => (
            <li key={substage.id} className="flex items-center gap-1.5">
              <input
                type="text"
                aria-label={`Name of ${substage.name}`}
                maxLength={INTERVIEW_SUBSTAGE_NAME_MAX * 2}
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
                  } else if (event.key === 'Escape' && drafts[substage.id] !== undefined) {
                    // Only the edit is abandoned; the pane stays open.
                    event.preventDefault();
                    event.stopPropagation();
                    discardDraft(substage.id);
                  }
                }}
                className="min-w-0 flex-1 rounded-control border border-line bg-card px-2.5 py-1.5 text-ink"
              />
              <button
                type="button"
                aria-label={`Move ${substage.name} up`}
                disabled={index === 0}
                onClick={() => void run(onMove(substage.id, 'up'))}
                className={QUIET_BUTTON}
              >
                ↑
              </button>
              <button
                type="button"
                aria-label={`Move ${substage.name} down`}
                disabled={index === substages.length - 1}
                onClick={() => void run(onMove(substage.id, 'down'))}
                className={QUIET_BUTTON}
              >
                ↓
              </button>
              <button
                type="button"
                aria-label={`Remove ${substage.name}`}
                onClick={() => void run(onRemove(substage.id))}
                className={SECONDARY_BUTTON}
              >
                Remove
              </button>
            </li>
          ))}
        </ol>
      )}

      <form
        className="border-t border-line pt-3"
        onSubmit={(event) => {
          event.preventDefault();
          void (async () => {
            // Cleared only when the step was actually added, so a refused name
            // stays in the box to be corrected rather than retyped.
            if (await run(onAdd(newName))) setNewName('');
          })();
        }}
      >
        <label htmlFor="substage-new" className="block text-xs font-medium text-ink-muted">
          New interview stage
        </label>
        <div className="mt-1 flex gap-2">
          <input
            id="substage-new"
            type="text"
            value={newName}
            placeholder="Panel Round"
            onChange={(event) => setNewName(event.currentTarget.value)}
            className="min-w-0 flex-1 rounded-control border border-line bg-card px-2.5 py-1.5 text-ink placeholder:text-ink-faint"
          />
          <button type="submit" data-testid="substage-add" className={SECONDARY_BUTTON}>
            Add stage
          </button>
        </div>
      </form>
    </div>
  );
}
