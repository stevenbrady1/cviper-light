/**
 * The update check's state machine, and the promise it is built around.
 *
 * ============================================================================
 * THE THING BEING PROTECTED IS NOT THE UPDATER. IT IS THE PROMISE.
 * ============================================================================
 * CViper Light tells the user nothing leaves their machine. An automatic update
 * check on launch would be a silent HTTPS request to a third party, carrying an
 * IP address and a version string, made before the user has touched anything —
 * and it would happen on a screen that says no data is collected. The payload
 * being harmless is not the point: the promise would be false, and a promise
 * that is false in one small way is a promise nobody has any reason to believe.
 *
 * So the check is a button, and the copy says so out loud, so that the ABSENCE
 * of a launch-time check reads as a decision rather than as an oversight.
 */
import { describe, expect, it } from 'vitest';

import {
  NO_AUTOMATIC_CHECK_NOTE,
  describeUpdateState,
  nextStateAfterCheck,
  type UpdateState,
} from './model';

describe('the no-automatic-check promise', () => {
  it('is stated in the Settings copy, in plain words', () => {
    const note = NO_AUTOMATIC_CHECK_NOTE.toLowerCase();

    // Two separate facts, both required. "Only when you press the button" alone
    // does not tell the user that nothing happened at startup.
    expect(note).toContain('never checks on its own');
    expect(note).toContain('nothing leaves this machine until you press it');
  });
});

describe('nextStateAfterCheck', () => {
  it('reports an available update with its version', () => {
    const state = nextStateAfterCheck({
      ok: true,
      value: { version: '0.2.0', notes: 'Fixes the tracker.', date: null },
    });

    expect(state).toEqual({ kind: 'available', version: '0.2.0', notes: 'Fixes the tracker.' });
  });

  it('reports being up to date when nothing came back', () => {
    expect(nextStateAfterCheck({ ok: true, value: null })).toEqual({ kind: 'current' });
  });

  it('negative: keeps the failure message rather than replacing it', () => {
    // The port's messages already say what happened and what to do. Collapsing
    // them into "update check failed" throws away the only useful thing on the
    // screen — and with a placeholder pubkey, the message IS the diagnosis.
    const state = nextStateAfterCheck({
      ok: false,
      error: { message: 'The signature could not be verified.' },
    });

    expect(state).toEqual({ kind: 'failed', message: 'The signature could not be verified.' });
  });

  it('boundary: an update with no release notes is still an update', () => {
    const state = nextStateAfterCheck({
      ok: true,
      value: { version: '0.2.0', notes: null, date: null },
    });

    expect(state).toEqual({ kind: 'available', version: '0.2.0', notes: null });
  });
});

describe('describeUpdateState', () => {
  const CASES: ReadonlyArray<[UpdateState['kind'], UpdateState]> = [
    ['idle', { kind: 'idle' }],
    ['checking', { kind: 'checking' }],
    ['current', { kind: 'current' }],
    ['available', { kind: 'available', version: '0.2.0', notes: null }],
    ['installing', { kind: 'installing' }],
    ['installed', { kind: 'installed' }],
    ['failed', { kind: 'failed', message: 'No connection.' }],
  ];

  it.each(CASES)('says something useful in the %s state', (_kind, state) => {
    const described = describeUpdateState(state, '0.1.0');
    // `idle` is the only state with nothing to report — the button speaks for
    // itself — and every other state must not be a blank screen.
    if (state.kind === 'idle') expect(described).toBeNull();
    else expect((described ?? '').length).toBeGreaterThan(10);
  });

  it('names the version the user is on when there is nothing to install', () => {
    expect(describeUpdateState({ kind: 'current' }, '0.1.0')).toContain('0.1.0');
  });

  it('names the version on offer when there is one', () => {
    const described = describeUpdateState(
      { kind: 'available', version: '0.2.0', notes: null },
      '0.1.0',
    );
    expect(described).toContain('0.2.0');
  });

  it('tells the user a restart is what finishes the install', () => {
    expect((describeUpdateState({ kind: 'installed' }, '0.1.0') ?? '').toLowerCase()).toContain(
      'restart',
    );
  });

  it('negative: a failure shows the message it was given, not a generic one', () => {
    expect(describeUpdateState({ kind: 'failed', message: 'No connection.' }, '0.1.0')).toContain(
      'No connection.',
    );
  });
});
