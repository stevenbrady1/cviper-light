import { useEffect, useState } from 'react';

import { type Cv, type Job, type Profile } from '@cviper/core-types';

import { type ProfilePort } from '../profile/port';

import { readAvailability } from './availability';
import { type AnalysisPort } from './port';
import { ollamaHint, providerOptions } from './providers';
import { type AnalysisSession } from './session';

export interface AnalysisLibraryInput {
  readonly analysisPort: AnalysisPort;
  readonly profiles: ProfilePort;
  readonly session: AnalysisSession;
  readonly setError: (message: string | null) => void;
}

/**
 * What the Analysis screen reads when it opens: the CVs, the saved jobs, the
 * profile the gates use, and what this machine can run.
 */
export function useAnalysisLibrary({
  analysisPort,
  profiles,
  session,
  setError,
}: AnalysisLibraryInput) {
  const [cvs, setCvs] = useState<readonly Cv[]>([]);
  /**
   * False until the first read of the CV list comes back.
   *
   * Without it the picker says "No CV uploaded yet" — and disables itself —
   * during the read, which is not an empty state but a wrong answer with a
   * dead control attached.
   */
  const [cvsLoaded, setCvsLoaded] = useState(false);
  const [jobs, setJobs] = useState<readonly Job[]>([]);
  const [options, setOptions] = useState(() =>
    providerOptions({
      ollamaRunning: false,
      ollamaModels: [],
      anthropicKey: false,
      openaiKey: false,
    }),
  );
  /**
   * The one sentence worth saying about Ollama, or `null`.
   *
   * Held as the computed string rather than as the whole `Availability`, so
   * there is exactly one place — `ollamaHint` — that decides when it is said.
   */
  const [localModelHint, setLocalModelHint] = useState<string | null>(null);
  /** The saved profile, or `null` — never saved, or could not be read. */
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    let cancelled = false;

    void profiles.load().then((loaded) => {
      // A failed read is SILENT here, and deliberately so: the gates then run
      // with no languages and no work rights, which `runGates` treats as
      // silence — every requirement becomes "check this", never a hard stop.
      // A red banner over a screen that scores perfectly well would be the
      // wrong lesson, and the profile view reports its own read failures.
      if (!cancelled && loaded.ok) setProfile(loaded.value);
    });

    return () => {
      cancelled = true;
    };
  }, [profiles]);

  useEffect(() => {
    let cancelled = false;

    void analysisPort.loadCvs().then((loaded) => {
      if (cancelled) return;
      // Set on both branches: a failed read is still a finished read, and the
      // error banner below is the honest thing to show, not a permanent
      // "Reading…".
      setCvsLoaded(true);
      if (!loaded.ok) {
        // Never swallowed. A screen that shows no CVs when the database will
        // not open is indistinguishable from a screen with no CVs on it.
        setError(`${loaded.error.message} Your data is still on this machine.`);
        return;
      }
      setCvs(loaded.value);
      // Only when nothing is selected: coming back to this view (L-187) keeps
      // the CV the user was working on.
      session.update((current) => ({
        selectedCvId: current.selectedCvId ?? loaded.value[0]?.id ?? null,
      }));
    });

    void analysisPort.loadJobs().then((loaded) => {
      // A failure here is NOT surfaced: the tracked-job shortcut is a
      // convenience, and losing it must not put a red banner over a screen that
      // otherwise works perfectly with a pasted advert.
      if (!cancelled && loaded.ok) setJobs(loaded.value);
    });

    return () => {
      cancelled = true;
    };
  }, [analysisPort, session, setError]);

  useEffect(() => {
    let cancelled = false;

    void readAvailability().then((availability) => {
      if (cancelled) return;
      setOptions(providerOptions(availability));
      setLocalModelHint(ollamaHint(availability));
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return { cvs, setCvs, cvsLoaded, jobs, options, localModelHint, profile };
}
