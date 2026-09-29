/**
 * The analysis session store (L-187): what survives the analysis view being
 * unmounted by a view switch, and what makes a late answer land or be dropped.
 */
import { describe, expect, it, vi } from 'vitest';

import { type CvAnalysis } from '@cviper/core-types';

import { createAnalysisSession, EMPTY_ANALYSIS_SESSION, type RunResult } from './session';

const ANALYSIS: CvAnalysis = {
  matched_skills: ['sql'],
  missing_skills: [],
  matched_keywords: [],
  keyword_gaps: [],
  ats_notes: [],
  suggestions: [],
  summary: 'Fine.',
  match_score: 70,
  verdict: 'possible',
};

const RESULT: RunResult = {
  analysis: ANALYSIS,
  provider: 'ollama',
  model: 'llama3.2:3b',
  retried: false,
};

describe('the analysis session', () => {
  it('starts empty: no CV, no advert, no pick, no result, not running', () => {
    expect(createAnalysisSession().get()).toEqual(EMPTY_ANALYSIS_SESSION);
    expect(EMPTY_ANALYSIS_SESSION).toMatchObject({
      selectedCvId: null,
      jobText: '',
      optionKey: null,
      result: null,
      checkedAdvert: null,
      runError: null,
      warnings: [],
      running: false,
    });
  });

  it('keeps what it was given and tells whoever is watching', () => {
    const session = createAnalysisSession();
    const listener = vi.fn();
    session.watch(listener);

    session.update({ jobText: 'An advert', selectedCvId: 'cv-1' });
    session.update((current) => ({ jobText: `${current.jobText}, edited` }));

    expect(session.get().jobText).toBe('An advert, edited');
    expect(session.get().selectedCvId).toBe('cv-1');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('boundary: the snapshot is the same object until something changes', () => {
    // `useSyncExternalStore` re-renders forever on a getter that returns a
    // fresh object every call.
    const session = createAnalysisSession();
    const before = session.get();
    expect(session.get()).toBe(before);

    session.update({ jobText: 'x' });
    expect(session.get()).not.toBe(before);
  });

  it('stops telling a listener once it stops watching', () => {
    const session = createAnalysisSession();
    const listener = vi.fn();
    const stopWatching = session.watch(listener);
    stopWatching();

    session.update({ jobText: 'x' });
    expect(listener).not.toHaveBeenCalled();
  });

  it('a run that nothing superseded is still current when it answers', () => {
    const session = createAnalysisSession();
    session.update({ runError: 'last time failed' });

    const ticket = session.beginRun();

    expect(session.get().running).toBe(true);
    // A new attempt is not still the old failure.
    expect(session.get().runError).toBeNull();
    expect(session.isCurrent(ticket)).toBe(true);
  });

  it('negative: a later run makes the earlier one stale', () => {
    const session = createAnalysisSession();
    const first = session.beginRun();
    const second = session.beginRun();

    expect(session.isCurrent(first)).toBe(false);
    expect(session.isCurrent(second)).toBe(true);
  });

  it('negative: superseding stops the wait and makes the run stale, keeping the inputs', () => {
    const session = createAnalysisSession();
    session.update({ jobText: 'An advert', selectedCvId: 'cv-1' });
    const ticket = session.beginRun();

    session.supersede();

    expect(session.isCurrent(ticket)).toBe(false);
    expect(session.get().running).toBe(false);
    expect(session.get().jobText).toBe('An advert');
    expect(session.get().selectedCvId).toBe('cv-1');
  });

  it('negative: reset forgets everything, including a run still in flight', () => {
    const session = createAnalysisSession();
    session.update({
      selectedCvId: 'cv-1',
      jobText: 'An advert',
      optionKey: 'keyword',
      result: RESULT,
      checkedAdvert: 'An advert',
      warnings: ['Page 2 was an image.'],
    });
    const ticket = session.beginRun();

    session.reset();

    expect(session.get()).toEqual(EMPTY_ANALYSIS_SESSION);
    expect(session.isCurrent(ticket)).toBe(false);
  });
});
