/**
 * The follow-up rules, at every boundary that matters.
 *
 * Pure functions, so every edge — the 9/10-day line, the second marker, a
 * malformed marker line, null notes — is a plain assertion with no rendering.
 * A wrong answer here is a nudge sent a day early or a third follow-up the
 * user was told they should not send.
 */
import { describe, expect, it } from 'vitest';

import { type Application } from '@cviper/core-types';

import { createEntry, EMPTY_DRAFT, type TrackerEntry } from './model';
import {
  FOLLOW_UP_MARKER,
  MAX_FOLLOW_UPS,
  QUIET_AFTER_DAYS,
  describeFollowUpState,
  followUpState,
  followUpsSent,
  lastActivityDate,
  nudgeDate,
  quietDays,
  thankYouOffered,
  withFollowUpLogged,
  withThankYouLogged,
} from './followUp';

const NOW = '2026-09-01T09:00:00.000Z';

function entryWith(overrides: Partial<Application>): TrackerEntry {
  const base = createEntry(
    { ...EMPTY_DRAFT, title: 'Credit Risk Analyst', company: 'Lloyds', status: 'applied' },
    { jobId: 'job-1', applicationId: 'app-1' },
    NOW,
  );
  return {
    ...base,
    application: { ...base.application, applied_date: '2026-09-01', ...overrides },
  };
}

describe('the constants the sentences are built from', () => {
  it('waits ten days and allows two follow-ups', () => {
    expect(QUIET_AFTER_DAYS).toBe(10);
    expect(MAX_FOLLOW_UPS).toBe(2);
  });
});

describe('followUpsSent — reading the markers out of the notes', () => {
  it('boundary: null notes mean nothing was sent', () => {
    expect(followUpsSent(null)).toEqual([]);
  });

  it('boundary: empty notes mean nothing was sent', () => {
    expect(followUpsSent('')).toEqual([]);
  });

  it('reads one dated marker per line, in order', () => {
    const notes = 'Spoke to Dana.\nfollowed up 2026-09-11\nStill nothing.\nfollowed up 2026-09-21';
    expect(followUpsSent(notes)).toEqual(['2026-09-11', '2026-09-21']);
  });

  it('negative: a malformed marker line is ignored, not half-read', () => {
    const notes = [
      'followed up yesterday',
      'followed up 11/09/2026',
      'I followed up 2026-09-11 by phone',
      'followed up 2026-09-11 and again',
      'followed up 2026-09-12',
    ].join('\n');
    expect(followUpsSent(notes)).toEqual(['2026-09-12']);
  });

  it('tolerates Windows line endings and trailing spaces', () => {
    expect(followUpsSent('followed up 2026-09-11 \r\nfollowed up 2026-09-21\r\n')).toEqual([
      '2026-09-11',
      '2026-09-21',
    ]);
  });

  it('the marker pattern is anchored to a whole line', () => {
    expect(FOLLOW_UP_MARKER.test('followed up 2026-09-11')).toBe(true);
    expect(FOLLOW_UP_MARKER.test('followed up 2026-09-11 (email)')).toBe(false);
  });
});

describe('lastActivityDate', () => {
  it('is the applied date when nothing has been sent', () => {
    expect(lastActivityDate(entryWith({}).application, [])).toBe('2026-09-01');
  });

  it('is the last marker when it is later than the applied date', () => {
    expect(lastActivityDate(entryWith({}).application, ['2026-09-11', '2026-09-21'])).toBe(
      '2026-09-21',
    );
  });

  it('boundary: keeps the applied date when a marker predates it (a note copied from elsewhere)', () => {
    expect(lastActivityDate(entryWith({}).application, ['2026-08-01'])).toBe('2026-09-01');
  });

  it('boundary: null when there is no applied date and no marker', () => {
    expect(lastActivityDate(entryWith({ applied_date: null }).application, [])).toBeNull();
  });
});

describe('followUpState', () => {
  it('saved → not-sent: nothing was sent, nobody is late', () => {
    expect(followUpState(entryWith({ status: 'saved' }), '2026-12-01')).toBe('not-sent');
  });

  it.each(['rejected', 'offer'] as const)('%s → closed', (status) => {
    expect(followUpState(entryWith({ status }), '2026-12-01')).toBe('closed');
  });

  it('boundary: nine days quiet is too soon', () => {
    expect(followUpState(entryWith({}), '2026-09-10')).toBe('too-soon');
  });

  it('boundary: ten days quiet is due', () => {
    expect(followUpState(entryWith({}), '2026-09-11')).toBe('due');
  });

  it('boundary: the day it was applied is too soon', () => {
    expect(followUpState(entryWith({}), '2026-09-01')).toBe('too-soon');
  });

  it('negative: a clock set to yesterday is too soon, never due', () => {
    expect(followUpState(entryWith({}), '2026-08-31')).toBe('too-soon');
  });

  it('counts from the last marker, not the applied date', () => {
    const entry = entryWith({ notes: 'followed up 2026-09-11' });
    expect(followUpState(entry, '2026-09-20')).toBe('too-soon');
    expect(followUpState(entry, '2026-09-21')).toBe('due');
  });

  it('the second marker exhausts it, however long ago', () => {
    const entry = entryWith({ notes: 'followed up 2026-09-11\nfollowed up 2026-09-21' });
    expect(followUpState(entry, '2027-01-01')).toBe('exhausted');
  });

  it('interviewing follows the same clock as applied', () => {
    expect(followUpState(entryWith({ status: 'interviewing' }), '2026-09-11')).toBe('due');
  });

  it('boundary: applied with no date on record cannot be late', () => {
    expect(followUpState(entryWith({ applied_date: null }), '2026-12-01')).toBe('not-sent');
  });
});

describe('quietDays and nudgeDate', () => {
  it('quietDays counts from the last activity', () => {
    expect(quietDays(entryWith({}), '2026-09-13')).toBe(12);
  });

  it('nudgeDate is the last activity plus the quiet period', () => {
    expect(nudgeDate(entryWith({}))).toBe('2026-09-11');
  });

  it('boundary: nudgeDate crosses a month end correctly', () => {
    expect(nudgeDate(entryWith({ applied_date: '2026-09-25' }))).toBe('2026-10-05');
  });

  it('boundary: both are null with nothing to count from', () => {
    expect(quietDays(entryWith({ applied_date: null }), '2026-09-13')).toBeNull();
    expect(nudgeDate(entryWith({ applied_date: null }))).toBeNull();
  });
});

describe('describeFollowUpState — one sentence per state', () => {
  it('not-sent', () => {
    expect(describeFollowUpState(entryWith({ status: 'saved' }), '2026-09-13')).toBe(
      'Nothing sent yet.',
    );
  });

  it('too-soon names the day to wait for', () => {
    expect(describeFollowUpState(entryWith({}), '2026-09-04')).toBe(
      'Sent 3 days ago — give it until 2026-09-11.',
    );
  });

  it('boundary: too-soon on the day itself and one day later read as English', () => {
    expect(describeFollowUpState(entryWith({}), '2026-09-01')).toBe(
      'Sent today — give it until 2026-09-11.',
    );
    expect(describeFollowUpState(entryWith({}), '2026-09-02')).toBe(
      'Sent 1 day ago — give it until 2026-09-11.',
    );
  });

  it('due', () => {
    expect(describeFollowUpState(entryWith({}), '2026-09-13')).toBe(
      'Quiet for 12 days. Worth a nudge.',
    );
  });

  it('exhausted', () => {
    const entry = entryWith({ notes: 'followed up 2026-09-11\nfollowed up 2026-09-21' });
    expect(describeFollowUpState(entry, '2027-01-01')).toBe(
      'Two follow-ups sent and no reply. The honest next step is recording the outcome.',
    );
  });

  it('closed', () => {
    expect(describeFollowUpState(entryWith({ status: 'rejected' }), '2026-09-13')).toBe('Closed.');
  });
});

describe('withFollowUpLogged', () => {
  it('creates the notes when there are none', () => {
    const logged = withFollowUpLogged(entryWith({}).application, '2026-09-11', NOW);
    expect(logged.notes).toBe('followed up 2026-09-11');
    expect(logged.updated_at).toBe(NOW);
  });

  it('appends on its own line, never onto the last line of prose', () => {
    const application = entryWith({ notes: 'Spoke to Dana.' }).application;
    expect(withFollowUpLogged(application, '2026-09-11', NOW).notes).toBe(
      'Spoke to Dana.\nfollowed up 2026-09-11',
    );
  });

  it('boundary: does not stack blank lines when the notes already end with one', () => {
    const application = entryWith({ notes: 'Spoke to Dana.\n\n' }).application;
    expect(withFollowUpLogged(application, '2026-09-11', NOW).notes).toBe(
      'Spoke to Dana.\nfollowed up 2026-09-11',
    );
  });

  it('round-trips: what it writes, followUpsSent reads back', () => {
    const once = withFollowUpLogged(entryWith({}).application, '2026-09-11', NOW);
    const twice = withFollowUpLogged(once, '2026-09-21', NOW);
    expect(followUpsSent(twice.notes)).toEqual(['2026-09-11', '2026-09-21']);
  });

  it('leaves every other field alone', () => {
    const application = entryWith({ next_action: 'Chase Dana' }).application;
    const logged = withFollowUpLogged(application, '2026-09-11', NOW);
    expect({ ...logged, notes: application.notes, updated_at: application.updated_at }).toEqual(
      application,
    );
  });
});

describe('withThankYouLogged', () => {
  it('records the note without counting as a follow-up', () => {
    const logged = withThankYouLogged(entryWith({}).application, '2026-09-11', NOW);
    expect(logged.notes).toBe('thank-you sent 2026-09-11');
    expect(followUpsSent(logged.notes)).toEqual([]);
    expect(logged.updated_at).toBe(NOW);
  });
});

describe('thankYouOffered', () => {
  it('is offered only on the move INTO interviewing', () => {
    expect(thankYouOffered('applied', 'interviewing')).toBe(true);
    expect(thankYouOffered('saved', 'interviewing')).toBe(true);
  });

  it('negative: not when already interviewing, and not when leaving it', () => {
    expect(thankYouOffered('interviewing', 'interviewing')).toBe(false);
    expect(thankYouOffered('interviewing', 'offer')).toBe(false);
    expect(thankYouOffered('applied', 'offer')).toBe(false);
  });
});
