import { type Application, type ApplicationStatus, type Job } from '@cviper/core-types';
import { describe, expect, it } from 'vitest';

import {
  createEntry,
  draftIsValid,
  groupByStatus,
  joinEntries,
  MAX_FIELD_LENGTH,
  STATUS_LABELS,
  STATUS_PILL_TONES,
  TRACKER_COLUMNS,
  validateDraft,
  withEdit,
  withStatus,
  type ApplicationDraft,
} from './model';

const NOW = '2026-08-19T09:00:00.000Z';

function job(id: string, overrides: Partial<Job> = {}): Job {
  return {
    id,
    source: 'manual',
    external_id: null,
    title: `Job ${id}`,
    company: 'Acme',
    location: 'London',
    salary_min: null,
    salary_max: null,
    salary_currency: null,
    salary_period: null,
    description: null,
    url: null,
    posted_date: null,
    created_at: NOW,
    ...overrides,
  };
}

function application(id: string, overrides: Partial<Application> = {}): Application {
  return {
    id,
    job_id: `job-${id}`,
    status: 'saved',
    applied_date: null,
    notes: null,
    next_action: null,
    next_action_date: null,
    updated_at: NOW,
    ...overrides,
  };
}

function draft(overrides: Partial<ApplicationDraft> = {}): ApplicationDraft {
  return {
    title: 'Quant Developer',
    company: 'Jane Street',
    location: 'London',
    status: 'saved',
    ...overrides,
  };
}

describe('the five columns', () => {
  it('are exactly the five statuses, in pipeline order', () => {
    // A sixth column is not a UI decision. These map 1:1 onto the cloud app's
    // board, and adding one breaks the export format.
    expect(TRACKER_COLUMNS).toEqual(['saved', 'applied', 'interviewing', 'offer', 'rejected']);
  });

  it('gives every column a label and a pill tone', () => {
    for (const status of TRACKER_COLUMNS) {
      expect(STATUS_LABELS[status].length).toBeGreaterThan(0);
      expect(STATUS_PILL_TONES[status].length).toBeGreaterThan(0);
    }
  });

  it('uses red for rejected and for nothing else', () => {
    // The colour grammar has exactly one status allowed to be red.
    const red = TRACKER_COLUMNS.filter((status) => STATUS_PILL_TONES[status].includes('danger'));
    expect(red).toEqual(['rejected']);
  });
});

describe('joinEntries', () => {
  it('pairs each application with its job', () => {
    const entries = joinEntries([job('job-a')], [application('a')]);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.job.id).toBe('job-a');
    expect(entries[0]?.application.id).toBe('a');
  });

  it('negative: drops an application whose job is missing rather than drawing a blank card', () => {
    // Impossible through the app's own writes — the foreign key forbids it — so
    // it can only arrive from a half-finished import. A card with no title is
    // not something a user can act on or even identify.
    const entries = joinEntries([], [application('a')]);

    expect(entries).toEqual([]);
  });

  it('boundary: an empty board is an empty list, not an error', () => {
    expect(joinEntries([], [])).toEqual([]);
  });
});

describe('groupByStatus', () => {
  it('always returns all five columns, even the empty ones', () => {
    // A board that renders three columns because two are empty is a board whose
    // layout jumps about as the user works.
    const grouped = groupByStatus([]);

    expect(Object.keys(grouped).sort()).toEqual([...TRACKER_COLUMNS].sort());
    for (const status of TRACKER_COLUMNS) {
      expect(grouped[status]).toEqual([]);
    }
  });

  it('puts each entry in its own column', () => {
    const entries = TRACKER_COLUMNS.map((status, index) =>
      joinEntries(
        [job(`job-${index}`)],
        [application(String(index), { job_id: `job-${index}`, status })],
      ),
    ).flat();

    const grouped = groupByStatus(entries);

    for (const status of TRACKER_COLUMNS) {
      expect(grouped[status].map((entry) => entry.application.status)).toEqual([status]);
    }
  });

  it('orders a column by most recent movement, newest first', () => {
    const entries = joinEntries(
      [job('job-old'), job('job-new')],
      [
        application('old', { job_id: 'job-old', updated_at: '2026-08-01T09:00:00.000Z' }),
        application('new', { job_id: 'job-new', updated_at: '2026-08-18T09:00:00.000Z' }),
      ],
    );

    expect(groupByStatus(entries).saved.map((entry) => entry.application.id)).toEqual([
      'new',
      'old',
    ]);
  });

  it('boundary: breaks a timestamp tie deterministically', () => {
    // Two cards saved in the same millisecond must not swap places between
    // renders — the board would appear to shuffle on its own.
    const entries = joinEntries(
      [job('job-b'), job('job-a')],
      [application('b', { job_id: 'job-b' }), application('a', { job_id: 'job-a' })],
    );

    expect(groupByStatus(entries).saved.map((entry) => entry.application.id)).toEqual(['a', 'b']);
  });
});

describe('validateDraft', () => {
  it('accepts a complete draft', () => {
    expect(validateDraft(draft())).toEqual({});
    expect(draftIsValid(validateDraft(draft()))).toBe(true);
  });

  it('negative: refuses an empty title and says what to do', () => {
    const errors = validateDraft(draft({ title: '' }));

    expect(errors.title).toBeDefined();
    expect(draftIsValid(errors)).toBe(false);
  });

  it('negative: refuses whitespace masquerading as a title', () => {
    expect(validateDraft(draft({ title: '   \t ' })).title).toBeDefined();
  });

  it('negative: refuses an empty company', () => {
    expect(validateDraft(draft({ company: '' })).company).toBeDefined();
  });

  it('boundary: a field at the length limit is accepted, one past it is not', () => {
    expect(validateDraft(draft({ title: 'x'.repeat(MAX_FIELD_LENGTH) })).title).toBeUndefined();
    expect(validateDraft(draft({ title: 'x'.repeat(MAX_FIELD_LENGTH + 1) })).title).toBeDefined();
  });

  it('boundary: trailing whitespace does not push a valid title over the limit', () => {
    const padded = `${'x'.repeat(MAX_FIELD_LENGTH)}     `;
    expect(validateDraft(draft({ title: padded })).title).toBeUndefined();
  });

  it('accepts an empty location, because plenty of adverts do not say', () => {
    expect(validateDraft(draft({ location: '' }))).toEqual({});
  });

  it('reports every broken field at once, not one at a time', () => {
    // Fixing one error only to be shown the next is the worst form to fill in.
    const errors = validateDraft(draft({ title: '', company: '' }));

    expect(Object.keys(errors).sort()).toEqual(['company', 'title']);
  });

  it('never blames the user', () => {
    const errors = validateDraft(draft({ title: '', company: '' }));

    for (const message of Object.values(errors)) {
      expect(message).not.toMatch(/\b(invalid|illegal|you must|error)\b/i);
    }
  });
});

describe('createEntry', () => {
  const ids = { jobId: 'job-1', applicationId: 'app-1' };

  it('makes a manual job and an application pointing at it', () => {
    const entry = createEntry(draft(), ids, NOW);

    expect(entry.job).toMatchObject({
      id: 'job-1',
      source: 'manual',
      external_id: null,
      title: 'Quant Developer',
      company: 'Jane Street',
      location: 'London',
      created_at: NOW,
    });
    expect(entry.application).toMatchObject({
      id: 'app-1',
      job_id: 'job-1',
      status: 'saved',
      updated_at: NOW,
    });
  });

  it('trims what the user typed', () => {
    const entry = createEntry(draft({ title: '  Quant Developer  ' }), ids, NOW);

    expect(entry.job.title).toBe('Quant Developer');
  });

  it('boundary: an empty optional field becomes null, never an empty string', () => {
    // The data model spells absence as `null` throughout. An empty string would
    // export as a value the cloud app then has to special-case.
    const entry = createEntry(draft({ location: '   ' }), ids, NOW);

    expect(entry.job.location).toBeNull();
  });

  it('starts with nothing outstanding', () => {
    const entry = createEntry(draft(), ids, NOW);

    expect(entry.application.notes).toBeNull();
    expect(entry.application.next_action).toBeNull();
    expect(entry.application.next_action_date).toBeNull();
    expect(entry.application.applied_date).toBeNull();
  });

  it('honours the status the user chose', () => {
    for (const status of TRACKER_COLUMNS) {
      expect(createEntry(draft({ status }), ids, NOW).application.status).toBe(status);
    }
  });
});

describe('withStatus', () => {
  const later = '2026-08-20T11:00:00.000Z';

  it('moves the card and counts that as movement', () => {
    // The staleness edge measures `updated_at`. A status change that left the
    // timestamp alone would show a card as weeks old seconds after it moved.
    const moved = withStatus(application('a'), 'applied', later);

    expect(moved.status).toBe('applied');
    expect(moved.updated_at).toBe(later);
  });

  it('records the applied date the first time, in the user’s own calendar', () => {
    const moved = withStatus(application('a'), 'applied', later);

    expect(moved.applied_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('never rewrites an applied date that is already there', () => {
    // Dragging a card out of `applied` and back again must not rewrite when the
    // user actually applied.
    const original = application('a', { status: 'applied', applied_date: '2026-07-01' });

    const back = withStatus(withStatus(original, 'interviewing', later), 'applied', later);

    expect(back.applied_date).toBe('2026-07-01');
  });

  it('does not invent an applied date for the other four statuses', () => {
    for (const status of ['saved', 'interviewing', 'offer', 'rejected'] as ApplicationStatus[]) {
      expect(withStatus(application('a'), status, later).applied_date).toBeNull();
    }
  });
});

describe('withEdit', () => {
  const later = '2026-08-20T11:00:00.000Z';

  it('applies the change and stamps it as movement', () => {
    // A note the user wrote today IS the application moving. Anything else and
    // the board tells them nothing has happened on the card they just worked on.
    const edited = withEdit(application('a'), { notes: 'Called the recruiter' }, later);

    expect(edited.notes).toBe('Called the recruiter');
    expect(edited.updated_at).toBe(later);
  });

  it('leaves everything it was not asked to change', () => {
    const original = application('a', { status: 'interviewing', notes: 'keep me' });

    const edited = withEdit(original, { next_action: 'Prepare' }, later);

    expect(edited.status).toBe('interviewing');
    expect(edited.notes).toBe('keep me');
    expect(edited.next_action).toBe('Prepare');
  });

  it('boundary: clearing a field to null is a real edit', () => {
    const original = application('a', { next_action_date: '2026-09-01' });

    expect(withEdit(original, { next_action_date: null }, later).next_action_date).toBeNull();
  });
});
