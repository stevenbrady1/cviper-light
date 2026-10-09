/**
 * The release CI gate (L-221): a tagged commit is bundled only once every
 * required check has passed on it, and only if it is on main.
 */
import { describe, expect, it } from 'vitest';

import { isOnMain, judgeCiGate, parseCheckRuns, REQUIRED_CHECKS, type CheckRun } from './ciGate.ts';

const passed = (name: string): CheckRun => ({ name, status: 'completed', conclusion: 'success' });
const failed = (name: string): CheckRun => ({ name, status: 'completed', conclusion: 'failure' });
const running = (name: string): CheckRun => ({ name, status: 'in_progress', conclusion: null });

const ALL_GREEN: readonly CheckRun[] = REQUIRED_CHECKS.map(passed);

describe('a commit whose checks all passed', () => {
  it('passes', () => {
    expect(judgeCiGate(true, ALL_GREEN)).toEqual({ kind: 'pass' });
  });

  it('passes when a failed attempt was followed by a green re-run', () => {
    const runs = [failed('verify'), ...ALL_GREEN];
    expect(judgeCiGate(true, runs)).toEqual({ kind: 'pass' });
  });

  it('ignores checks it does not require', () => {
    const runs = [...ALL_GREEN, failed('l-numbers'), running('unsigned simulator build')];
    expect(judgeCiGate(true, runs)).toEqual({ kind: 'pass' });
  });
});

describe('a commit it must refuse', () => {
  it('refuses a commit that is not on main, even with every check green', () => {
    const verdict = judgeCiGate(false, ALL_GREEN);
    expect(verdict.kind).toBe('fail');
    expect(verdict.kind === 'fail' && verdict.reasons.join(' ')).toMatch(/not on main/);
  });

  it('fails when a required check finished red and nothing re-ran it', () => {
    const runs = [
      ...REQUIRED_CHECKS.filter((n) => n !== 'secret-scan').map(passed),
      failed('secret-scan'),
    ];
    const verdict = judgeCiGate(true, runs);
    expect(verdict).toEqual({
      kind: 'fail',
      reasons: ['"secret-scan" finished without a success (failure)'],
    });
  });

  it('treats cancelled and skipped as not passed', () => {
    const runs: CheckRun[] = [
      ...REQUIRED_CHECKS.filter((n) => n !== 'verify').map(passed),
      { name: 'verify', status: 'completed', conclusion: 'cancelled' },
      { name: 'verify', status: 'completed', conclusion: 'skipped' },
    ];
    expect(judgeCiGate(true, runs).kind).toBe('fail');
  });

  it('a failure is reported even while another required check is still running', () => {
    const runs = [failed('verify'), running('secret-scan')];
    expect(judgeCiGate(true, runs).kind).toBe('fail');
  });
});

describe('a commit it must wait for', () => {
  it('waits while a required check is still running', () => {
    const runs = [...REQUIRED_CHECKS.filter((n) => n !== 'verify').map(passed), running('verify')];
    expect(judgeCiGate(true, runs)).toEqual({ kind: 'wait', pending: ['verify'] });
  });

  it('waits while a failed attempt is being re-run', () => {
    const runs = [
      ...ALL_GREEN.filter((r) => r.name !== 'verify'),
      failed('verify'),
      running('verify'),
    ];
    expect(judgeCiGate(true, runs)).toEqual({ kind: 'wait', pending: ['verify'] });
  });

  it('boundary: no check runs at all is waiting, never passing', () => {
    expect(judgeCiGate(true, [])).toEqual({ kind: 'wait', pending: [...REQUIRED_CHECKS] });
  });

  it('boundary: a check name that differs only in case is not the required check', () => {
    const runs = [...ALL_GREEN.filter((r) => r.name !== 'verify'), passed('Verify')];
    expect(judgeCiGate(true, runs)).toEqual({ kind: 'wait', pending: ['verify'] });
  });
});

describe('where the commit sits against main', () => {
  it('accepts main itself and any ancestor of it', () => {
    expect(isOnMain('identical')).toBe(true);
    expect(isOnMain('behind')).toBe(true);
  });

  it('refuses a commit main does not contain', () => {
    expect(isOnMain('ahead')).toBe(false);
    expect(isOnMain('diverged')).toBe(false);
    expect(isOnMain('')).toBe(false);
  });
});

describe('reading the check runs gh prints', () => {
  it('reads one JSON object per line, with a null conclusion while running', () => {
    const raw =
      '{"name":"verify","status":"completed","conclusion":"success"}\n' +
      '{"name":"secret-scan","status":"queued","conclusion":null}\n\n';
    expect(parseCheckRuns(raw)).toEqual([
      passed('verify'),
      { name: 'secret-scan', status: 'queued', conclusion: null },
    ]);
  });

  it('boundary: empty output is no runs', () => {
    expect(parseCheckRuns('')).toEqual([]);
  });

  it('throws on a line it cannot read, rather than dropping it', () => {
    expect(() => parseCheckRuns('{"status":"completed"}')).toThrow(/without a name/);
    expect(() => parseCheckRuns('not json')).toThrow();
    expect(() => parseCheckRuns('42')).toThrow(/not an object/);
  });
});
