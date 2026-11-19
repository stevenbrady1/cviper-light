import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';

import { QUIET_BUTTON, SECONDARY_BUTTON } from '../../app/buttons';
import { FIELD } from '../../app/fields';
import { LiveStatus } from '../../app/LiveStatus';
import { Icon } from '../../ui';

import { type SavedSearch } from './savedSearches';

/**
 * Whether the name box is open, what is typed in it, and the opener it hands
 * focus back to (L-433). One hook, so the opener can sit in Search's action row
 * while the box — a form of its own, and forms cannot nest — stays out here.
 */
export function useSaveSearchBox() {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const open = (suggestedName: string) => {
    // Already open: back into the box, keeping what was typed.
    if (naming) return input.current?.focus();
    setName(suggestedName);
    setProblem(null);
    setNaming(true);
  };

  const close = () => {
    setNaming(false);
    setProblem(null);
  };

  return { naming, setNaming, name, setName, problem, setProblem, opener, input, open, close };
}

export type SaveSearchBox = ReturnType<typeof useSaveSearchBox>;

export interface SaveSearchOpenerProps {
  readonly box: SaveSearchBox;
  readonly suggestedName: string;
  readonly disabled: boolean;
}

/** "Save this search": a quiet button, never a submit (L-433). Stays drawn while the box is open. */
export function SaveSearchOpener({ box, suggestedName, disabled }: SaveSearchOpenerProps) {
  return (
    <button
      ref={box.opener}
      type="button"
      data-testid="saved-search-open"
      aria-expanded={box.naming}
      onClick={() => box.open(suggestedName)}
      disabled={disabled}
      className={QUIET_BUTTON}
    >
      Save this search
    </button>
  );
}

/**
 * Saved searches (L-309): one chip per saved search, a delete button beside
 * each, and the name box for "Save this search".
 *
 * Search owns the list and does the saving, running and deleting; this panel
 * owns only the name box. Search hands it the box (`useSaveSearchBox`) and
 * draws the opener in its action row; left without one, the panel keeps its
 * own box and draws the opener itself.
 */
export interface SearchSavedProps {
  readonly saved: readonly SavedSearch[];
  /** What the name box starts with. */
  readonly suggestedName: string;
  /** Running a search: nothing here can be pressed until it is done. */
  readonly disabled: boolean;
  /** What happened last: "Saved …", "Deleted …". Shown and spoken. */
  readonly note: string | null;
  /** Save under this name. Returns why it could not, or `null` when it was saved. */
  readonly onSave: (name: string) => string | null;
  readonly onRun: (entry: SavedSearch) => void;
  readonly onDelete: (entry: SavedSearch) => void;
  /** The box whose opener is drawn elsewhere (Search's action row). */
  readonly box?: SaveSearchBox | undefined;
}

export function SearchSaved({
  saved,
  suggestedName,
  disabled,
  note,
  onSave,
  onRun,
  onDelete,
  box,
}: SearchSavedProps) {
  const own = useSaveSearchBox();
  const { naming, setNaming, name, setName, problem, setProblem, opener, input, close } =
    box ?? own;
  const wasNaming = useRef(false);

  useEffect(() => {
    // Focus moves into the box when it opens, so typing and Escape work
    // straight away, and back to "Save this search" when it closes, so a
    // keyboard user is not dropped at the top of the page.
    if (naming) {
      input.current?.focus();
      input.current?.select();
    } else if (wasNaming.current) {
      opener.current?.focus();
    }
    wasNaming.current = naming;
  }, [naming, input, opener]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const why = onSave(name);
    setProblem(why);
    if (why === null) setNaming(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  };

  return (
    <div data-testid="search-saved" className="space-y-2">
      {/* Hidden, not an empty line, when the opener is in Search's row (L-433). */}
      <div
        className={
          saved.length === 0 && box !== undefined ? 'hidden' : 'flex flex-wrap items-center gap-2'
        }
      >
        {saved.length === 0 ? null : <span className="text-xs text-ink-faint">Saved</span>}
        {saved.map((entry) => (
          <span key={entry.id} className="inline-flex items-center rounded-pill border border-line">
            <button
              type="button"
              data-testid={`saved-search-run-${entry.id}`}
              aria-label={`Run saved search: ${entry.name}`}
              /*
                Runs Search. A saved search is kept to be run, and one click on
                it is the same deliberate press as the Search button — unlike a
                Recent chip, which only fills the boxes.
              */
              onClick={() => onRun(entry)}
              disabled={disabled}
              className={`${QUIET_BUTTON} rounded-pill px-2 py-0.5 text-xs`}
            >
              {entry.name}
            </button>
            <button
              type="button"
              data-testid={`saved-search-delete-${entry.id}`}
              aria-label={`Delete saved search: ${entry.name}`}
              onClick={() => onDelete(entry)}
              disabled={disabled}
              className={`${QUIET_BUTTON} rounded-pill px-1.5 py-0.5 text-xs`}
            >
              <span className="flex h-lh items-center">
                <Icon name="close" size={12} />
              </span>
            </button>
          </span>
        ))}

        {box === undefined ? (
          <SaveSearchOpener box={own} suggestedName={suggestedName} disabled={disabled} />
        ) : null}
      </div>

      {naming ? (
        <form
          data-testid="saved-search-form"
          onSubmit={submit}
          className="flex flex-wrap items-end gap-2"
        >
          <div className="min-w-0">
            <label htmlFor="saved-search-name" className="block text-xs font-medium text-ink-muted">
              Name this search
            </label>
            <input
              ref={input}
              id="saved-search-name"
              data-testid="saved-search-name"
              type="text"
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
              onKeyDown={onKeyDown}
              aria-invalid={problem === null ? undefined : true}
              aria-describedby={problem === null ? undefined : 'saved-search-problem'}
              className={`${FIELD} mt-1 w-64 max-w-full`}
            />
          </div>
          <button type="submit" data-testid="saved-search-confirm" className={SECONDARY_BUTTON}>
            Save
          </button>
          <button
            type="button"
            data-testid="saved-search-cancel"
            onClick={close}
            className={QUIET_BUTTON}
          >
            Cancel
          </button>
          {problem === null ? null : (
            <p
              id="saved-search-problem"
              data-testid="saved-search-problem"
              className="w-full text-xs text-danger"
            >
              {problem}
            </p>
          )}
        </form>
      ) : null}

      {note === null ? null : (
        <p data-testid="saved-search-note" className="text-xs text-ink-muted">
          {note}
        </p>
      )}
      <LiveStatus text={problem ?? note} />
    </div>
  );
}
