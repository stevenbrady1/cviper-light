import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';

import { buildBoardUrl } from '@cviper/job-apis';
import { BOARD_ENCODINGS, type BoardEncoding } from '@cviper/core-types';

import { QUIET_BUTTON, SECONDARY_BUTTON } from '../../app/buttons';

import { SHIPPED_BOARDS } from './defaults';
import {
  EMPTY_DRAFT,
  NO_PREFERENCES,
  addCustomBoard,
  customBoardFrom,
  mergeBoards,
  moveBoard,
  removeCustomBoard,
  setBoardEnabled,
  validateCustomBoard,
  type BoardPreferences,
  type CustomBoardDraft,
  type CustomBoardErrors,
} from './model';
import { createTauriBoardPreferencesPort, type BoardPreferencesPort } from './port';

/**
 * Which job boards the browser buttons offer, in which order, plus your own.
 *
 * ============================================================================
 * THE SHIPPED LIST IS NEVER EDITED. THIS WRITES A DIFF.
 * ============================================================================
 * Everything on this screen changes `BoardPreferences` — a list of what is
 * switched off, an order, and any boards the user added — and that is layered
 * over `job-boards.json` at render time. It is why a board added in a later
 * release turns up for somebody who has already reordered everything, and why a
 * board they switched off two versions ago stays off. See `model.ts`.
 *
 * ============================================================================
 * A CHANGE IS SHOWN IMMEDIATELY AND SAVED IMMEDIATELY
 * ============================================================================
 * There is no Save button, because there is nothing here that a person would
 * want to change and then abandon. The screen updates first and the write
 * follows; if the write fails the change stays on screen and a line under it
 * says, in as many words, that it will be gone at the next launch. Silently
 * reverting the checkbox they just ticked would be the worse answer — they
 * would conclude the checkbox is broken rather than that the disk is.
 *
 * ============================================================================
 * NO BOARD IS NAMED IN THIS FILE EITHER
 * ============================================================================
 * Same rule as `KeylessBar`. Every row comes from the merged list.
 */

/** How the two encodings are explained to somebody who is not a programmer. */
const ENCODING_LABEL: Readonly<Record<BoardEncoding, string>> = {
  plus: 'a plus sign — for links with a ? in them',
  hyphen: 'a hyphen — for links where the words are part of the address',
};

/** The example the add form previews, so a template can be checked by eye. */
const PREVIEW_INPUT = { keywords: 'business analyst', location: 'Milton Keynes' };

export interface BoardSettingsProps {
  /** Injected by tests. Defaults to the real `tauri-plugin-store` port. */
  readonly port?: BoardPreferencesPort | undefined;
}

export function BoardSettings({ port }: BoardSettingsProps = {}) {
  const boardsPort = useMemo(() => port ?? createTauriBoardPreferencesPort(), [port]);

  const [preferences, setPreferences] = useState<BoardPreferences>(NO_PREFERENCES);
  /*
    TWO PROBLEMS, TWO VOICES, AND THE DIFFERENCE IS DELIBERATE.

    A failed READ is a degraded load: the screen works, every shipped board is
    listed and every one of them searches. It is stated quietly, in the same
    shape as `search-tracked-problem`, because it is not a response to anything
    the user just did and an assertive live region would interrupt a screen
    reader to report that a file was missing.

    A failed WRITE is the opposite. The user pressed something, it appeared to
    work, and it will be gone at the next launch. That is an alert.
  */
  const [readProblem, setReadProblem] = useState<string | null>(null);
  const [saveProblem, setSaveProblem] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<CustomBoardDraft>(EMPTY_DRAFT);
  const [errors, setErrors] = useState<CustomBoardErrors>({});

  useEffect(() => {
    let cancelled = false;

    void boardsPort.read().then((loaded) => {
      if (cancelled) return;
      // Reported here, unlike on the search screen: this is the one place where
      // an unreadable file would look like the app having thrown the user's
      // choices away, and saying nothing about it is how that becomes a bug
      // report about a feature that never worked.
      if (!loaded.ok) setReadProblem(loaded.error.message);
      else setPreferences(loaded.value);
    });

    return () => {
      cancelled = true;
    };
  }, [boardsPort]);

  const boards = useMemo(() => mergeBoards(SHIPPED_BOARDS, preferences), [preferences]);

  const apply = useCallback(
    async (next: BoardPreferences) => {
      setPreferences(next);

      const written = await boardsPort.write(next);
      setSaveProblem(written.ok ? null : written.error.message);
    },
    [boardsPort],
  );

  const onAdd = useCallback(
    (event: FormEvent) => {
      event.preventDefault();

      const found = validateCustomBoard(draft);
      setErrors(found);

      const made = customBoardFrom(
        draft,
        boards.map((board) => board.id),
      );
      // `customBoardFrom` returns null for exactly the drafts `found` describes,
      // so this cannot save something the messages above say is wrong.
      if (made === null) return;

      void apply(addCustomBoard(preferences, made));
      setDraft(EMPTY_DRAFT);
      setErrors({});
      setAdding(false);
    },
    [apply, boards, draft, preferences],
  );

  const templateProblem = validateCustomBoard(draft).urlTemplate;
  const preview =
    draft.urlTemplate.trim() === '' || templateProblem !== undefined
      ? null
      : buildBoardUrl(
          {
            id: 'preview',
            label: 'preview',
            urlTemplate: draft.urlTemplate.trim(),
            encoding: draft.encoding,
          },
          PREVIEW_INPUT,
        );

  return (
    <section data-testid="boards-settings">
      <h2 className="font-medium text-ink">Job boards</h2>
      <p className="mt-1 text-ink-muted">
        The buttons under the search box send whatever you have typed to one of these sites, opened
        in your own browser. No key and no account is needed for any of them. Untick the ones you
        never use, put your favourites at the top, and add any site that is missing.
      </p>

      <ul data-testid="boards-list" className="mt-3 space-y-1">
        {boards.map((board, index) => (
          <li
            key={board.id}
            data-testid={`board-row-${board.id}`}
            className="flex items-center gap-2 rounded-control border border-line bg-card px-3 py-1.5"
          >
            <label className="flex min-w-0 flex-1 items-center gap-2">
              <input
                type="checkbox"
                data-testid={`board-toggle-${board.id}`}
                checked={board.enabled}
                onChange={(event) =>
                  void apply(setBoardEnabled(preferences, board.id, event.currentTarget.checked))
                }
              />
              <span className="min-w-0 truncate text-ink">{board.label}</span>
            </label>

            {board.userAdded ? (
              <span className="rounded-pill border border-line px-2 py-0.5 text-xs text-ink-faint">
                yours
              </span>
            ) : null}

            {/*
              Disabled at the ends, never hidden. A button that comes and goes
              as a row moves is a button the user cannot learn.
            */}
            <button
              type="button"
              data-testid={`board-up-${board.id}`}
              aria-label={`Move ${board.label} up`}
              disabled={index === 0}
              onClick={() => void apply(moveBoard(preferences, boards, board.id, 'up'))}
              className={QUIET_BUTTON}
            >
              ↑
            </button>
            <button
              type="button"
              data-testid={`board-down-${board.id}`}
              aria-label={`Move ${board.label} down`}
              disabled={index === boards.length - 1}
              onClick={() => void apply(moveBoard(preferences, boards, board.id, 'down'))}
              className={QUIET_BUTTON}
            >
              ↓
            </button>

            {board.userAdded ? (
              <button
                type="button"
                data-testid={`board-remove-${board.id}`}
                aria-label={`Remove ${board.label}`}
                onClick={() => void apply(removeCustomBoard(preferences, board.id))}
                className={QUIET_BUTTON}
              >
                Remove
              </button>
            ) : null}
          </li>
        ))}
      </ul>

      {readProblem === null ? null : (
        <p data-testid="boards-read-problem" className="mt-2 text-xs text-ink-muted">
          {readProblem}
        </p>
      )}

      {saveProblem === null ? null : (
        <p
          role="alert"
          data-testid="boards-problem"
          className="mt-2 rounded-control bg-danger/5 px-3 py-2 text-danger"
        >
          {saveProblem}
        </p>
      )}

      {adding ? (
        <form
          data-testid="boards-add-form"
          onSubmit={onAdd}
          className="mt-3 rounded-card border border-line bg-card p-4"
        >
          <h3 className="font-medium text-ink">Add a job board</h3>
          <p className="mt-1 text-ink-muted">
            Run a search on the site you want, copy the address out of your browser, and paste it
            below with <code>{'{keyword}'}</code> where the job title was and{' '}
            <code>{'{location}'}</code> where the place was.
          </p>

          <Field
            id="boards-new-label"
            label="Name"
            value={draft.label}
            error={errors.label}
            placeholder="eFinancialCareers"
            onChange={(label) => setDraft((current) => ({ ...current, label }))}
          />

          <Field
            id="boards-new-template"
            label="Address"
            value={draft.urlTemplate}
            error={errors.urlTemplate}
            placeholder="https://www.example.com/jobs?q={keyword}&location={location}"
            onChange={(urlTemplate) => setDraft((current) => ({ ...current, urlTemplate }))}
          />

          <div className="mt-3">
            <label
              htmlFor="boards-new-encoding"
              className="block text-xs font-medium text-ink-muted"
            >
              A space in the search becomes
            </label>
            <select
              id="boards-new-encoding"
              data-testid="boards-new-encoding"
              value={draft.encoding}
              onChange={(event) => {
                /*
                  Read EAGERLY, before `setDraft`. A lazy updater runs during
                  the next render, by which time React has finished dispatching
                  the event and `currentTarget` is null — reading it in there
                  throws, and it throws in front of the user rather than in a
                  test that never touched this control.
                */
                const encoding = event.currentTarget.value as BoardEncoding;
                setDraft((current) => ({ ...current, encoding }));
              }}
              className="mt-1 rounded-control border border-line bg-card px-2.5 py-1.5 text-ink"
            >
              {BOARD_ENCODINGS.map((encoding) => (
                <option key={encoding} value={encoding}>
                  {ENCODING_LABEL[encoding]}
                </option>
              ))}
            </select>
          </div>

          {preview === null ? null : (
            <p data-testid="boards-new-preview" className="mt-3 text-xs text-ink-faint">
              A search for <span className="text-ink-muted">business analyst</span> in{' '}
              <span className="text-ink-muted">Milton Keynes</span> would open{' '}
              <span className="font-mono break-all">{preview}</span>
            </p>
          )}

          <div className="mt-3 flex items-center gap-2">
            <button type="submit" data-testid="boards-add-submit" className={SECONDARY_BUTTON}>
              Add this board
            </button>
            <button
              type="button"
              data-testid="boards-add-cancel"
              onClick={() => {
                setAdding(false);
                setDraft(EMPTY_DRAFT);
                setErrors({});
              }}
              className={QUIET_BUTTON}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          data-testid="boards-add-open"
          onClick={() => setAdding(true)}
          className={`mt-3 ${SECONDARY_BUTTON}`}
        >
          Add a job board
        </button>
      )}
    </section>
  );
}

interface FieldProps {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly error: string | undefined;
  readonly placeholder: string;
  readonly onChange: (value: string) => void;
}

function Field({ id, label, value, error, placeholder, onChange }: FieldProps) {
  return (
    <div className="mt-3">
      <label htmlFor={id} className="block text-xs font-medium text-ink-muted">
        {label}
      </label>
      <input
        id={id}
        data-testid={id}
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.currentTarget.value)}
        className="mt-1 w-full rounded-control border border-line bg-card px-2.5 py-1.5 text-ink"
      />
      {error === undefined ? null : (
        <p data-testid={`${id}-error`} className="mt-1 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
