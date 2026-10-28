import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';

import { QUIET_BUTTON, SECONDARY_BUTTON } from '../../app/buttons';
import { LiveStatus } from '../../app/LiveStatus';

import { type SavedSearch } from './savedSearches';

/**
 * Saved searches (L-309): one chip per saved search, a delete button beside
 * each, and "Save this search" to name what is in the boxes now.
 *
 * Search owns the list and does the saving, running and deleting; this panel
 * owns only whether the name box is open and what is typed in it.
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
}

export function SearchSaved({
  saved,
  suggestedName,
  disabled,
  note,
  onSave,
  onRun,
  onDelete,
}: SearchSavedProps) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
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
  }, [naming]);

  const open = () => {
    setName(suggestedName);
    setProblem(null);
    setNaming(true);
  };

  const close = () => {
    setNaming(false);
    setProblem(null);
  };

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
      <div className="flex flex-wrap items-center gap-2">
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
              <span aria-hidden="true">×</span>
            </button>
          </span>
        ))}

        {naming ? null : (
          <button
            ref={opener}
            type="button"
            data-testid="saved-search-open"
            onClick={open}
            disabled={disabled}
            className={`${QUIET_BUTTON} rounded-pill border border-dashed border-line px-2 py-0.5 text-xs`}
          >
            Save this search
          </button>
        )}
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
              className="mt-1 w-64 max-w-full rounded-control border border-field-line bg-card px-2.5 py-1.5 text-ink"
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
