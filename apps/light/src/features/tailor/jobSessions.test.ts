/**
 * L-199: one Tailor session per job, kept above the view switch.
 *
 * The store is plain data with a listener list, like `analysis/session.ts`;
 * these tests pin the three things the screen relies on: a job's work is its
 * own, a job opened for the first time is seeded once and never re-seeded,
 * and an answer written for one job lands on that job whatever is showing.
 */
import { describe, expect, it, vi } from 'vitest';

import { EMPTY_TAILOR_JOB, createJobSessions } from './jobSessions';

describe('createJobSessions', () => {
  it('starts on a pasted advert, with nothing in it', () => {
    const store = createJobSessions();
    expect(store.get().activeJobId).toBeNull();
    expect(store.active()).toEqual(EMPTY_TAILOR_JOB);
  });

  it('happy: opening a job seeds it once, and makes it the active one', () => {
    const store = createJobSessions();
    store.open('job-a', () => ({ advert: 'Advert A' }));

    expect(store.get().activeJobId).toBe('job-a');
    expect(store.active().advert).toBe('Advert A');
  });

  it('a job opened again keeps its work — the seed is not applied a second time', () => {
    const store = createJobSessions();
    store.open('job-a', () => ({ advert: 'Advert A' }));
    store.patch('job-a', { advert: 'Advert A, edited' });

    const seed = vi.fn(() => ({ advert: 'Advert A' }));
    store.open('job-b', () => ({ advert: 'Advert B' }));
    store.open('job-a', seed);

    expect(seed).not.toHaveBeenCalled();
    expect(store.active().advert).toBe('Advert A, edited');
  });

  it('two jobs never share work', () => {
    const store = createJobSessions();
    store.open('job-a', () => ({ advert: 'Advert A' }));
    store.patch('job-a', { cvId: 'cv-1', error: 'A failed' });
    store.open('job-b', () => ({ advert: 'Advert B' }));

    expect(store.active()).toMatchObject({ advert: 'Advert B', cvId: null, error: null });
    expect(store.session('job-a')).toMatchObject({ cvId: 'cv-1', error: 'A failed' });
  });

  it('a late answer patched onto another job lands there, not on the one showing', () => {
    const store = createJobSessions();
    store.open('job-a', () => ({}));
    store.patch('job-a', { phase: 'tailoring' });
    store.open('job-b', () => ({}));

    store.patch('job-a', { phase: 'idle', error: 'answered' });

    expect(store.active()).toMatchObject({ phase: 'idle', error: null });
    expect(store.session('job-a')).toMatchObject({ phase: 'idle', error: 'answered' });
  });

  it('patch takes an updater that sees the latest state, not a stale copy', () => {
    const store = createJobSessions();
    store.patch(null, { cvId: 'cv-1' });
    store.patch(null, (current) => ({ cvId: current.cvId ?? 'cv-2' }));
    expect(store.session(null).cvId).toBe('cv-1');
  });

  it('edge: the pasted-advert slot is a job of its own (key null)', () => {
    const store = createJobSessions();
    store.patch(null, { advert: 'Pasted' });
    store.open('job-a', () => ({ advert: 'Advert A' }));
    store.open(null, () => ({ advert: 'never used' }));
    expect(store.active().advert).toBe('Pasted');
  });

  it('the snapshot is the SAME object until something changes (useSyncExternalStore)', () => {
    const store = createJobSessions();
    const first = store.get();
    expect(store.get()).toBe(first);
    store.patch(null, { advert: 'x' });
    expect(store.get()).not.toBe(first);
  });

  it('tells listeners about every change, and stops when asked', () => {
    const store = createJobSessions();
    const listener = vi.fn();
    const stop = store.watch(listener);
    store.open('job-a', () => ({}));
    store.patch('job-a', { advert: 'x' });
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    store.patch('job-a', { advert: 'y' });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('negative: reset forgets every job and goes back to a paste', () => {
    const store = createJobSessions();
    store.open('job-a', () => ({ advert: 'Advert A' }));
    store.reset();
    expect(store.get().activeJobId).toBeNull();
    expect(store.session('job-a')).toEqual(EMPTY_TAILOR_JOB);
  });
});
