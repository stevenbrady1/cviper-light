/**
 * Loading a job into the analysis session (L-190).
 *
 * The session is the one piece of the Analysis screen that outlives it, so a
 * job handed over from Search or the tracker is written HERE, and the screen
 * picks it up when it mounts. What is kept and what is dropped is the whole
 * behaviour, and each half has a test.
 */
import { describe, expect, it } from 'vitest';

import { type Job } from '@cviper/core-types';

import { createAnalysisSession, EMPTY_ANALYSIS_SESSION } from '../analysis/session';

import { loadJobIntoAnalysis } from './handoff';

const JOB: Job = {
  id: 'job-stored',
  source: 'reed',
  external_id: '1',
  title: 'Credit Risk Analyst',
  company: 'Barclays',
  agency: null,
  location: 'London',
  salary_min: null,
  salary_max: null,
  salary_currency: null,
  salary_period: null,
  description: 'Strong SQL and Python.',
  url: null,
  posted_date: null,
  created_at: '2026-09-29T09:00:00.000Z',
};

const RESULT = {
  analysis: {} as never,
  provider: 'keyword',
  model: 'keyword',
  retried: false,
};

describe('a job arriving at Analysis', () => {
  it('fills the advert, remembers which job it is, and carries the note', () => {
    const session = createAnalysisSession();

    loadJobIntoAnalysis(session, { job: JOB, applicationId: 'app-1', note: 'Only a preview.' });

    expect(session.get()).toMatchObject({
      jobText: 'Credit Risk Analyst\nBarclays\nLondon\n\nStrong SQL and Python.',
      jobId: 'job-stored',
      jobNote: 'Only a preview.',
    });
  });

  it('keeps the CV, the option and the CV’s warnings the user already had', () => {
    const session = createAnalysisSession();
    session.update({
      selectedCvId: 'cv-2',
      optionKey: 'keyword',
      warnings: ['Page 3 was an image.'],
    });

    loadJobIntoAnalysis(session, { job: JOB, applicationId: null, note: null });

    expect(session.get()).toMatchObject({
      selectedCvId: 'cv-2',
      optionKey: 'keyword',
      warnings: ['Page 3 was an image.'],
    });
  });

  it('drops the previous advert’s result and failure', () => {
    const session = createAnalysisSession();
    session.update({ result: RESULT, checkedAdvert: 'Old advert', runError: 'It failed.' });

    loadJobIntoAnalysis(session, { job: JOB, applicationId: null, note: null });

    expect(session.get()).toMatchObject({ result: null, checkedAdvert: null, runError: null });
  });

  it('negative: a run still in flight for the previous advert is superseded', () => {
    const session = createAnalysisSession();
    const ticket = session.beginRun();

    loadJobIntoAnalysis(session, { job: JOB, applicationId: null, note: null });

    expect(session.isCurrent(ticket)).toBe(false);
    expect(session.get().running).toBe(false);
  });

  it('boundary: a fresh session starts with no job and no note, and a reset forgets them', () => {
    expect(EMPTY_ANALYSIS_SESSION.jobId).toBeNull();
    expect(EMPTY_ANALYSIS_SESSION.jobNote).toBeNull();

    const session = createAnalysisSession();
    loadJobIntoAnalysis(session, { job: JOB, applicationId: null, note: 'Only a preview.' });
    session.reset();

    expect(session.get().jobId).toBeNull();
    expect(session.get().jobNote).toBeNull();
    expect(session.get().jobText).toBe('');
  });
});
