import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  emptyProfile,
  type Profile as CandidateProfile,
  type ProfileLanguage,
  type StarExample,
} from '@cviper/core-types';

import { QUIET_BUTTON, SECONDARY_BUTTON } from '../../app/buttons';
import { ViewHeader } from '../../app/ViewHeader';
import { viewById } from '../../app/views';
import { useDebouncedField } from '../../lib/useDebouncedField';

import {
  addLanguage,
  addStarExample,
  linesToList,
  listToLines,
  removeLanguage,
  removeStarExample,
  textOrNull,
  withLanguage,
  withStarExample,
} from './model';
import { createDbProfilePort, type ProfilePort } from './port';

/**
 * The candidate profile: who you are, what you want, what you will not take.
 *
 * ============================================================================
 * THERE IS NO SAVE BUTTON, FOR THE SAME REASON THE TRACKER HAS NONE
 * ============================================================================
 * Every box commits shortly after you stop typing, and immediately if you
 * click away — `useDebouncedField`, exactly as `ApplicationDetail` uses it.
 * A profile is the kind of thing a person fills in over weeks, one line at a
 * time as they think of it; a Save button would make every one of those
 * moments a moment to lose work.
 *
 * So this view has NO primary button at all. Blue means "the thing this
 * screen is for", and this screen is for writing, which needs no button.
 *
 * ============================================================================
 * ONE ROW, LOADED ONCE, EDITED IN PLACE
 * ============================================================================
 * The port's `load` comes back `null` on a machine that has never had a
 * profile, and the view starts from `emptyProfile` so every box exists from
 * the first visit. Every edit goes through `apply`, which stamps `updated_at`
 * from the injected clock and hands the WHOLE profile to the port: there is
 * one row and no reason to make the data layer merge fields.
 *
 * The lists that live in rows (languages, STAR examples) are keyed by a local
 * counter, not their index. Rows are removed from the middle; an index key
 * would hand the third row's draft to what is now the second row.
 */

/** How long after the last keystroke a field saves itself. Same as the tracker. */
export const AUTOSAVE_DELAY_MS = 600;

export interface ProfileProps {
  /**
   * Injected by tests. Defaults to the real SQLite-backed port — a component
   * that reached into `src/db` directly could only be tested by pretending to
   * be SQLite.
   */
  readonly port?: ProfilePort | undefined;
  /**
   * Injected by tests so `updated_at` is deterministic. `| undefined` because
   * `exactOptionalPropertyTypes` is on and the shell forwards its own optional
   * prop straight through.
   */
  readonly now?: Date | undefined;
}

/** The loaded profile plus the stable keys for its two lists of rows. */
interface Loaded {
  readonly profile: CandidateProfile;
  readonly languageKeys: readonly number[];
  readonly starKeys: readonly number[];
}

const FIELD = 'mt-1 w-full rounded-control border border-line bg-card px-2.5 py-1.5 text-ink';
const LABEL = 'block text-xs font-medium text-ink-muted';

export function Profile({ port, now }: ProfileProps) {
  // Created once. A new port object every render would restart the load.
  const profilePort = useMemo(() => port ?? createDbProfilePort(), [port]);

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The latest state, readable from a debounced commit that fires after the
  // render it was created in. Two fields flushing in the same tick — every
  // box on the way out of the view — must each build on the other's change,
  // not both on the state as it was.
  const latest = useRef<Loaded | null>(null);
  const nextKey = useRef(0);

  const stamp = useCallback(() => (now ?? new Date()).toISOString(), [now]);
  const keysFor = useCallback((count: number): number[] => {
    const keys: number[] = [];
    for (let at = 0; at < count; at += 1) keys.push(nextKey.current++);
    return keys;
  }, []);

  useEffect(() => {
    let cancelled = false;

    void profilePort.load().then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (!result.ok) {
        // Never swallowed. A form that silently shows empty boxes when the
        // database will not open is indistinguishable from an empty profile.
        setError(`${result.error.message} Your data is still on this machine.`);
        return;
      }
      const profile = result.value ?? emptyProfile(stamp());
      const initial: Loaded = {
        profile,
        languageKeys: keysFor(profile.languages.length),
        starKeys: keysFor(profile.star_examples.length),
      };
      latest.current = initial;
      setLoaded(initial);
    });

    return () => {
      cancelled = true;
    };
  }, [profilePort, stamp, keysFor]);

  /**
   * Change the profile and save it.
   *
   * OPTIMISTIC, and it says so when it is wrong: the screen updates at once,
   * and a failed write raises the message. The typed text is NOT rolled back
   * — it is still in the box in front of the user, and the next edit tries
   * again.
   */
  const apply = useCallback(
    (change: (current: Loaded) => Loaded) => {
      const current = latest.current;
      if (current === null) return;

      const changed = change(current);
      const next: Loaded = {
        ...changed,
        profile: { ...changed.profile, updated_at: stamp() },
      };
      latest.current = next;
      setLoaded(next);
      setError(null);

      void profilePort.save(next.profile).then((written) => {
        if (written.ok) return;
        setError(
          `That change could not be saved: ${written.error.message} It is still on screen — edit the field again to retry.`,
        );
      });
    },
    [profilePort, stamp],
  );

  const edit = useCallback(
    (changes: Partial<CandidateProfile>) =>
      apply((current) => ({ ...current, profile: { ...current.profile, ...changes } })),
    [apply],
  );

  const onAddLanguage = useCallback(
    () =>
      apply((current) => ({
        ...current,
        profile: addLanguage(current.profile),
        languageKeys: [...current.languageKeys, nextKey.current++],
      })),
    [apply],
  );

  const onLanguageChange = useCallback(
    (key: number, patch: Partial<ProfileLanguage>) =>
      apply((current) => ({
        ...current,
        profile: withLanguage(current.profile, current.languageKeys.indexOf(key), patch),
      })),
    [apply],
  );

  const onRemoveLanguage = useCallback(
    (key: number) =>
      apply((current) => ({
        ...current,
        profile: removeLanguage(current.profile, current.languageKeys.indexOf(key)),
        languageKeys: current.languageKeys.filter((candidate) => candidate !== key),
      })),
    [apply],
  );

  const onAddStar = useCallback(
    () =>
      apply((current) => ({
        ...current,
        profile: addStarExample(current.profile),
        starKeys: [...current.starKeys, nextKey.current++],
      })),
    [apply],
  );

  const onStarChange = useCallback(
    (key: number, patch: Partial<StarExample>) =>
      apply((current) => ({
        ...current,
        profile: withStarExample(current.profile, current.starKeys.indexOf(key), patch),
      })),
    [apply],
  );

  const onRemoveStar = useCallback(
    (key: number) =>
      apply((current) => ({
        ...current,
        profile: removeStarExample(current.profile, current.starKeys.indexOf(key)),
        starKeys: current.starKeys.filter((candidate) => candidate !== key),
      })),
    [apply],
  );

  const view = viewById('profile');

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="view-profile">
      <ViewHeader title={view.label} summary={view.summary} />

      {error === null ? null : (
        <p
          role="alert"
          data-testid="profile-error"
          className="border-b border-line bg-danger/5 px-4 py-2 text-danger md:px-6"
        >
          {error}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-5">
        {loading ? (
          <p data-testid="profile-loading" className="text-ink-muted">
            Loading…
          </p>
        ) : null}

        {loaded === null ? null : (
          <ProfileForm
            loaded={loaded}
            onEdit={edit}
            onAddLanguage={onAddLanguage}
            onLanguageChange={onLanguageChange}
            onRemoveLanguage={onRemoveLanguage}
            onAddStar={onAddStar}
            onStarChange={onStarChange}
            onRemoveStar={onRemoveStar}
          />
        )}
      </div>
    </section>
  );
}

// --- The form ---------------------------------------------------------------
//
// Split from the shell above so every `useDebouncedField` mounts ONCE, with
// the loaded value as its initial draft. Mounted before the load lands, the
// boxes would start empty and stay empty.

interface ProfileFormProps {
  readonly loaded: Loaded;
  readonly onEdit: (changes: Partial<CandidateProfile>) => void;
  readonly onAddLanguage: () => void;
  readonly onLanguageChange: (key: number, patch: Partial<ProfileLanguage>) => void;
  readonly onRemoveLanguage: (key: number) => void;
  readonly onAddStar: () => void;
  readonly onStarChange: (key: number, patch: Partial<StarExample>) => void;
  readonly onRemoveStar: (key: number) => void;
}

function ProfileForm({
  loaded,
  onEdit,
  onAddLanguage,
  onLanguageChange,
  onRemoveLanguage,
  onAddStar,
  onStarChange,
  onRemoveStar,
}: ProfileFormProps) {
  const { profile, languageKeys, starKeys } = loaded;

  const headline = useDebouncedField(
    profile.headline ?? '',
    (value) => onEdit({ headline: textOrNull(value) }),
    AUTOSAVE_DELAY_MS,
  );
  const workRights = useDebouncedField(
    profile.work_rights ?? '',
    (value) => onEdit({ work_rights: textOrNull(value) }),
    AUTOSAVE_DELAY_MS,
  );
  const writingStyle = useDebouncedField(
    profile.writing_style ?? '',
    (value) => onEdit({ writing_style: textOrNull(value) }),
    AUTOSAVE_DELAY_MS,
  );
  const dealBreakers = useDebouncedField(
    listToLines(profile.deal_breakers),
    (value) => onEdit({ deal_breakers: linesToList(value) }),
    AUTOSAVE_DELAY_MS,
  );
  const targetSectors = useDebouncedField(
    listToLines(profile.target_sectors),
    (value) => onEdit({ target_sectors: linesToList(value) }),
    AUTOSAVE_DELAY_MS,
  );
  const careerGoals = useDebouncedField(
    listToLines(profile.career_goals),
    (value) => onEdit({ career_goals: linesToList(value) }),
    AUTOSAVE_DELAY_MS,
  );
  const energising = useDebouncedField(
    listToLines(profile.energising),
    (value) => onEdit({ energising: linesToList(value) }),
    AUTOSAVE_DELAY_MS,
  );
  const draining = useDebouncedField(
    listToLines(profile.draining),
    (value) => onEdit({ draining: linesToList(value) }),
    AUTOSAVE_DELAY_MS,
  );

  return (
    <div className="max-w-2xl space-y-8">
      <section data-testid="profile-about">
        <h2 className="font-medium text-ink">About you</h2>
        <p className="mt-1 text-ink-muted">
          The short version of who you are. Everything written for you starts from here.
        </p>

        <div className="mt-3 space-y-4">
          <div>
            <label htmlFor="profile-headline" className={LABEL}>
              Headline
            </label>
            <input
              id="profile-headline"
              data-testid="profile-headline"
              value={headline.draft}
              placeholder="Credit risk analyst moving into quant development"
              onChange={(event) => headline.setDraft(event.currentTarget.value)}
              onBlur={headline.flush}
              className={FIELD}
            />
          </div>

          <div>
            <label htmlFor="profile-work-rights" className={LABEL}>
              Right to work
            </label>
            <input
              id="profile-work-rights"
              data-testid="profile-work-rights"
              value={workRights.draft}
              placeholder="UK citizen, no sponsorship needed"
              onChange={(event) => workRights.setDraft(event.currentTarget.value)}
              onBlur={workRights.flush}
              className={FIELD}
            />
          </div>

          <div>
            <label htmlFor="profile-writing-style" className={LABEL}>
              How you write
            </label>
            <textarea
              id="profile-writing-style"
              data-testid="profile-writing-style"
              rows={3}
              value={writingStyle.draft}
              placeholder="Plain, short sentences. No buzzwords. British spelling."
              onChange={(event) => writingStyle.setDraft(event.currentTarget.value)}
              onBlur={writingStyle.flush}
              className={FIELD}
            />
            <p className="mt-1 text-xs text-ink-faint">Saved as you type.</p>
          </div>
        </div>
      </section>

      <section data-testid="profile-languages">
        <h2 className="font-medium text-ink">Languages</h2>
        <p className="mt-1 text-ink-muted">Each one, and how well you speak it.</p>

        {languageKeys.length === 0 ? (
          <p data-testid="profile-languages-empty" className="mt-2 text-sm text-ink-faint">
            None added yet.
          </p>
        ) : null}

        <ul className="mt-3 space-y-2">
          {languageKeys.map((key, index) => {
            const language = profile.languages[index];
            if (language === undefined) return null;
            return (
              <LanguageRow
                key={key}
                index={index}
                language={language}
                onChange={(patch) => onLanguageChange(key, patch)}
                onRemove={() => onRemoveLanguage(key)}
              />
            );
          })}
        </ul>

        <button
          type="button"
          data-testid="profile-language-add"
          onClick={onAddLanguage}
          className={`mt-3 ${SECONDARY_BUTTON}`}
        >
          Add a language
        </button>
      </section>

      <section data-testid="profile-wants">
        <h2 className="font-medium text-ink">What you are looking for</h2>
        <p className="mt-1 text-ink-muted">One per line.</p>

        <div className="mt-3 space-y-4">
          <div>
            <label htmlFor="profile-deal-breakers" className={LABEL}>
              Deal breakers
            </label>
            <textarea
              id="profile-deal-breakers"
              data-testid="profile-deal-breakers"
              rows={3}
              value={dealBreakers.draft}
              placeholder={'Fully on-site\nBelow GBP 70k'}
              onChange={(event) => dealBreakers.setDraft(event.currentTarget.value)}
              onBlur={dealBreakers.flush}
              className={FIELD}
            />
          </div>

          <div>
            <label htmlFor="profile-target-sectors" className={LABEL}>
              Target sectors
            </label>
            <textarea
              id="profile-target-sectors"
              data-testid="profile-target-sectors"
              rows={3}
              value={targetSectors.draft}
              placeholder={'Banking\nHedge funds'}
              onChange={(event) => targetSectors.setDraft(event.currentTarget.value)}
              onBlur={targetSectors.flush}
              className={FIELD}
            />
          </div>

          <div>
            <label htmlFor="profile-career-goals" className={LABEL}>
              Career goals
            </label>
            <textarea
              id="profile-career-goals"
              data-testid="profile-career-goals"
              rows={3}
              value={careerGoals.draft}
              placeholder="Lead a small modelling team within three years"
              onChange={(event) => careerGoals.setDraft(event.currentTarget.value)}
              onBlur={careerGoals.flush}
              className={FIELD}
            />
          </div>
        </div>
      </section>

      <section data-testid="profile-energy">
        <h2 className="font-medium text-ink">What energises you, what drains you</h2>
        <p className="mt-1 text-ink-muted">
          One per line. Honest answers here keep you out of jobs you would hate.
        </p>

        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="profile-energising" className={LABEL}>
              Energising
            </label>
            <textarea
              id="profile-energising"
              data-testid="profile-energising"
              rows={4}
              value={energising.draft}
              placeholder="Hard technical problems"
              onChange={(event) => energising.setDraft(event.currentTarget.value)}
              onBlur={energising.flush}
              className={FIELD}
            />
          </div>

          <div>
            <label htmlFor="profile-draining" className={LABEL}>
              Draining
            </label>
            <textarea
              id="profile-draining"
              data-testid="profile-draining"
              rows={4}
              value={draining.draft}
              placeholder="Status meetings"
              onChange={(event) => draining.setDraft(event.currentTarget.value)}
              onBlur={draining.flush}
              className={FIELD}
            />
          </div>
        </div>
      </section>

      <section data-testid="profile-star">
        <h2 className="font-medium text-ink">STAR examples</h2>
        <p className="mt-1 text-ink-muted">
          Worked examples in the shape interviewers ask for them: the situation, the task, what you
          did, and what came of it.
        </p>

        {starKeys.length === 0 ? (
          <p data-testid="profile-star-empty" className="mt-2 text-sm text-ink-faint">
            None added yet.
          </p>
        ) : null}

        <ul className="mt-3 space-y-3">
          {starKeys.map((key, index) => {
            const example = profile.star_examples[index];
            if (example === undefined) return null;
            return (
              <StarCard
                key={key}
                index={index}
                example={example}
                onChange={(patch) => onStarChange(key, patch)}
                onRemove={() => onRemoveStar(key)}
              />
            );
          })}
        </ul>

        <button
          type="button"
          data-testid="profile-star-add"
          onClick={onAddStar}
          className={`mt-3 ${SECONDARY_BUTTON}`}
        >
          Add an example
        </button>
      </section>
    </div>
  );
}

// --- Rows -------------------------------------------------------------------

interface LanguageRowProps {
  readonly index: number;
  readonly language: ProfileLanguage;
  readonly onChange: (patch: Partial<ProfileLanguage>) => void;
  readonly onRemove: () => void;
}

function LanguageRow({ index, language, onChange, onRemove }: LanguageRowProps) {
  const name = useDebouncedField(
    language.name,
    (value) => onChange({ name: value }),
    AUTOSAVE_DELAY_MS,
  );
  const level = useDebouncedField(
    language.level,
    (value) => onChange({ level: value }),
    AUTOSAVE_DELAY_MS,
  );

  return (
    <li data-testid={`profile-language-${index}`} className="flex flex-wrap items-end gap-2">
      <div className="min-w-0 flex-1">
        <label htmlFor={`profile-language-name-${index}`} className={LABEL}>
          Language
        </label>
        <input
          id={`profile-language-name-${index}`}
          data-testid={`profile-language-name-${index}`}
          value={name.draft}
          placeholder="French"
          onChange={(event) => name.setDraft(event.currentTarget.value)}
          onBlur={name.flush}
          className={FIELD}
        />
      </div>
      <div className="min-w-0 flex-1">
        <label htmlFor={`profile-language-level-${index}`} className={LABEL}>
          Level
        </label>
        <input
          id={`profile-language-level-${index}`}
          data-testid={`profile-language-level-${index}`}
          value={level.draft}
          placeholder="Conversational"
          onChange={(event) => level.setDraft(event.currentTarget.value)}
          onBlur={level.flush}
          className={FIELD}
        />
      </div>
      <button
        type="button"
        data-testid={`profile-language-remove-${index}`}
        onClick={onRemove}
        className={QUIET_BUTTON}
      >
        Remove
      </button>
    </li>
  );
}

interface StarCardProps {
  readonly index: number;
  readonly example: StarExample;
  readonly onChange: (patch: Partial<StarExample>) => void;
  readonly onRemove: () => void;
}

/** The five parts, in the order they are told. */
const STAR_PARTS: ReadonlyArray<{
  readonly key: keyof StarExample;
  readonly label: string;
  readonly rows: number;
}> = [
  { key: 'title', label: 'Title', rows: 1 },
  { key: 'situation', label: 'Situation', rows: 2 },
  { key: 'task', label: 'Task', rows: 2 },
  { key: 'action', label: 'Action', rows: 3 },
  { key: 'result', label: 'Result', rows: 2 },
];

function StarCard({ index, example, onChange, onRemove }: StarCardProps) {
  return (
    <li
      data-testid={`profile-star-${index}`}
      className="rounded-card border border-line bg-card p-4 shadow-raised"
    >
      <div className="space-y-3">
        {STAR_PARTS.map((part) => (
          <StarField
            key={part.key}
            index={index}
            part={part.key}
            label={part.label}
            rows={part.rows}
            value={example[part.key]}
            onCommit={(value) => onChange({ [part.key]: value })}
          />
        ))}
      </div>
      <div className="mt-3 border-t border-line pt-3">
        <button
          type="button"
          data-testid={`profile-star-remove-${index}`}
          onClick={onRemove}
          className={QUIET_BUTTON}
        >
          Remove this example
        </button>
      </div>
    </li>
  );
}

interface StarFieldProps {
  readonly index: number;
  readonly part: keyof StarExample;
  readonly label: string;
  readonly rows: number;
  readonly value: string;
  readonly onCommit: (value: string) => void;
}

function StarField({ index, part, label, rows, value, onCommit }: StarFieldProps) {
  const field = useDebouncedField(value, onCommit, AUTOSAVE_DELAY_MS);
  const id = `profile-star-${part}-${index}`;

  return (
    <div>
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      <textarea
        id={id}
        data-testid={id}
        rows={rows}
        value={field.draft}
        onChange={(event) => field.setDraft(event.currentTarget.value)}
        onBlur={field.flush}
        className={FIELD}
      />
    </div>
  );
}
