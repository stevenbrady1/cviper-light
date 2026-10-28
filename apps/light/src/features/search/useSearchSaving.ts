import { useCallback, useEffect, useState } from 'react';

import { isPreviewAdvert } from '../flow/advert';
import { type AnalyseHandoff } from '../flow/handoff';

import { type CombinedResults } from './keylessModel';
import { externalKey } from './model';
import { type SearchPort } from './port';
import { type CardNotes } from './SearchResults';

export interface SearchSaving {
  /** `source|external_id` of every advert already in the tracker. */
  readonly tracked: ReadonlySet<string>;
  /** Why the tracker could not be checked, or `null`. Never an alert. */
  readonly trackedProblem: string | null;
  readonly notes: CardNotes;
  readonly problems: CardNotes;
  readonly savingId: string | null;
  readonly onSave: (jobId: string) => Promise<void>;
  readonly onAnalyseJob: (jobId: string) => Promise<void>;
  /** Called by a new search: last time's per-card notes no longer apply. */
  readonly clearCardNotes: () => void;
}

/**
 * Saving a result to the tracker, and "Analyse this job" (L-190).
 *
 * Owns which adverts are already tracked and the note or problem under each
 * card. Search owns the results themselves and passes them in.
 */
export function useSearchSaving(
  searchPort: SearchPort,
  results: CombinedResults,
  clock: Date,
  newId: (() => string) | undefined,
  onAnalyse: ((handoff: AnalyseHandoff) => void) | undefined,
): SearchSaving {
  const [tracked, setTracked] = useState<ReadonlySet<string>>(new Set());
  const [trackedProblem, setTrackedProblem] = useState<string | null>(null);
  const [notes, setNotes] = useState<CardNotes>({});
  const [problems, setProblems] = useState<CardNotes>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void searchPort.loadTracked().then((loaded) => {
      if (cancelled) return;
      if (!loaded.ok) {
        // Deliberately NOT an alert. What is lost is the "already in your
        // tracker" label; saving still works and reports its own failure if it
        // hits one. A red banner over a screen that otherwise works perfectly
        // would be the larger error.
        setTrackedProblem(
          `CViper could not check which adverts are already in your tracker. ${loaded.error.message}`,
        );
        return;
      }
      setTracked(loaded.value);
    });

    return () => {
      cancelled = true;
    };
  }, [searchPort]);

  const onSave = useCallback(
    async (jobId: string) => {
      const entry = results.jobs.find((candidate) => candidate.job.id === jobId);
      if (entry === undefined) return;

      setSavingId(jobId);
      setProblems((current) => ({ ...current, [jobId]: '' }));

      const saved = await searchPort.saveToTracker(
        entry.job,
        { applicationId: (newId ?? (() => crypto.randomUUID()))() },
        clock.toISOString(),
      );
      setSavingId(null);

      if (!saved.ok) {
        setProblems((current) => ({
          ...current,
          [jobId]: `That advert could not be saved. ${saved.error.message}`,
        }));
        return;
      }

      const key = externalKey(entry.job.source, entry.job.external_id);
      if (key !== null) setTracked((current) => new Set(current).add(key));

      setNotes((current) => ({
        ...current,
        [jobId]:
          saved.value.outcome === 'already-saved'
            ? // NOT an error. The same advert reached the user twice, which is
              // exactly what cross-posting looks like, and the database already
              // has it. Nothing is duplicated and nothing has gone wrong.
              'That advert is already in your tracker — nothing has been added twice.'
            : 'Saved to your tracker, under “Saved”.',
      }));
    },
    [clock, newId, results, searchPort],
  );

  /**
   * "Analyse this job" (L-190): save it, make the advert whole, hand it on.
   *
   * SAVED FIRST, so the analysis, the tailored CV and the letter all attach to
   * one tracker record — and the STORED job is what goes on, because an advert
   * saved last week has a different id from this search's copy of it.
   *
   * A PREVIEW has its full advert read from its own page next: one page, on
   * this press, through the fetch rules the tracker already uses. The card
   * says so while it happens, because a page can take a few seconds and a
   * button that does nothing visible for that long reads as broken. Whatever
   * the page gave, the job goes on — with a note when all there is is the
   * preview, which the Analysis screen shows above the advert.
   */
  const onAnalyseJob = useCallback(
    async (jobId: string) => {
      if (onAnalyse === undefined) return;
      const entry = results.jobs.find((candidate) => candidate.job.id === jobId);
      if (entry === undefined) return;

      setSavingId(jobId);
      setProblems((current) => ({ ...current, [jobId]: '' }));
      setNotes((current) => ({ ...current, [jobId]: '' }));

      const saved = await searchPort.saveToTracker(
        entry.job,
        { applicationId: (newId ?? (() => crypto.randomUUID()))() },
        clock.toISOString(),
      );

      if (!saved.ok) {
        setSavingId(null);
        setProblems((current) => ({
          ...current,
          [jobId]: `That advert could not be saved. ${saved.error.message}`,
        }));
        return;
      }

      const key = externalKey(entry.job.source, entry.job.external_id);
      if (key !== null) setTracked((current) => new Set(current).add(key));

      let job = saved.value.job;
      let note: string | null = null;
      if (isPreviewAdvert(job)) {
        setNotes((current) => ({ ...current, [jobId]: 'Reading the full advert…' }));
        const read = await searchPort.readFullAdvert(job);
        job = read.job;
        note = read.note;
      }

      setSavingId(null);
      setNotes((current) => ({ ...current, [jobId]: '' }));
      onAnalyse({ job, applicationId: saved.value.applicationId, note });
    },
    [clock, newId, onAnalyse, results, searchPort],
  );

  const clearCardNotes = useCallback(() => {
    setNotes({});
    setProblems({});
  }, []);

  return {
    tracked,
    trackedProblem,
    notes,
    problems,
    savingId,
    onSave,
    onAnalyseJob,
    clearCardNotes,
  };
}
