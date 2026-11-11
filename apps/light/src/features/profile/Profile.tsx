import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  emptyProfile,
  ok,
  type Profile as CandidateProfile,
  type ProfileLanguage,
  type StarExample,
} from '@cviper/core-types';

import { CONTENT_COLUMN } from '../../app/layout';
import { ViewHeader } from '../../app/ViewHeader';
import { viewById } from '../../app/views';
import { createTauriFilePort, type FilePort } from '../../platform/files';
import { ErrorBox } from '../../ui';

import {
  addLanguage,
  addStarExample,
  removeLanguage,
  removeStarExample,
  withLanguage,
  withStarExample,
} from './model';
import { GapsPanel } from './GapsPanel';
import { createDbGapsPort, type GapsPort } from './gapsPort';
import { ImportAiJobSearch } from './ImportAiJobSearchPanel';
import { detectMobileOs } from '../../platform/os';
import { mergeImportedProfile, type ImportedProfile } from './importAiJobSearch';
import { createDbProfileCvPort, createDbProfilePort, type ProfilePort } from './port';
import { ProfileForm, type Loaded } from './ProfileForm';
import { YourCv } from './ProfileYourCv';
import { type CvStorePort } from '../cv/ingestCv';

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
 * (The one exception is inside the import review at the bottom (L-167):
 * "Add to my profile" is a decision about somebody else's file, and a
 * decision gets a button.)
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

export { AUTOSAVE_DELAY_MS } from './ProfileForm';

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
  /**
   * The skills-gap panel's read port. Injected by tests for the same reason
   * as `port`; defaults to the real SQLite-backed one.
   */
  readonly gapsPort?: GapsPort | undefined;
  /**
   * The folder picker behind "Import from an ai-job-search folder…" (L-167).
   * Injected by tests; defaults to the real Tauri-backed port.
   */
  readonly filePort?: FilePort | undefined;
  /**
   * The CVs, for "Your CV" (L-240). Injected by tests. Defaults to the real
   * SQLite-backed one — unless `port` was injected, when a test that faked the
   * data layer gets an empty list rather than real reads behind it.
   */
  readonly cvPort?: CvStorePort | undefined;
}

/** What a test that faked `port` but not `cvPort` gets: no CVs, and nowhere real to write. */
const NO_CV_STORE: CvStorePort = {
  loadCvs: async () => ok([]),
  saveCv: async () => ok(undefined),
};

export function Profile({ port, now, gapsPort, filePort, cvPort }: ProfileProps) {
  // Created once. A new port object every render would restart the load.
  const profilePort = useMemo(() => port ?? createDbProfilePort(), [port]);
  const cvStore = useMemo(
    () => cvPort ?? (port === undefined ? createDbProfileCvPort() : NO_CV_STORE),
    [cvPort, port],
  );
  const skillsPort = useMemo(() => gapsPort ?? createDbGapsPort(), [gapsPort]);
  const files = useMemo(() => filePort ?? createTauriFilePort(), [filePort]);
  // Bumped by an import, which changes fields from OUTSIDE their boxes. Every
  // `useDebouncedField` takes its initial value once, so the form is remounted
  // to show the merged profile; each box's pending draft flushes on the way
  // out, through `apply`, and so builds on the merge rather than undoing it.
  const [formGeneration, setFormGeneration] = useState(0);

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

  const onImport = useCallback(
    (imported: ImportedProfile) => {
      apply((current) => {
        const profile = mergeImportedProfile(current.profile, imported);
        // The merge appends, so every existing row keeps its key and index.
        return {
          profile,
          languageKeys: [
            ...current.languageKeys,
            ...keysFor(profile.languages.length - current.languageKeys.length),
          ],
          starKeys: [
            ...current.starKeys,
            ...keysFor(profile.star_examples.length - current.starKeys.length),
          ],
        };
      });
      setFormGeneration((generation) => generation + 1);
    },
    [apply, keysFor],
  );

  const view = viewById('profile');

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="view-profile">
      <ViewHeader view={view.id} title={view.label} summary={view.summary} />

      {error === null ? null : (
        <ErrorBox variant="strip" testId="profile-error">
          {error}
        </ErrorBox>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-5">
        <div data-content-column className={CONTENT_COLUMN}>
          {loading ? (
            <p data-testid="profile-loading" className="text-ink-muted">
              Loading…
            </p>
          ) : null}
          <YourCv store={cvStore} files={files} now={now} />

          {loaded === null ? null : (
            <ProfileForm
              key={formGeneration}
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

          <GapsPanel port={skillsPort} />

          {/*
            Not on a phone: there is no folder dialog there (`pick_folder` does
            not exist on iOS or Android), so the button would only ever produce
            the refusal sentence Rust keeps as a floor. Absent, not disabled —
            a control with no working state on this device teaches nothing.
          */}
          {loaded === null || detectMobileOs() !== null ? null : (
            <ImportAiJobSearch filePort={files} onApply={onImport} />
          )}
        </div>
      </div>
    </section>
  );
}
