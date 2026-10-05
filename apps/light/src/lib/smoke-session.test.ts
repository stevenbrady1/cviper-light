import { describe, expect, it } from 'vitest';

import { createSessionWhenWindowReady } from '../../e2e/smoke-session.ts';

/** A fake clock: sleeping advances time, so no test waits for real. */
function fakeClock(): { now: () => number; sleep: (ms: number) => Promise<void> } {
  let t = 0;
  return {
    now: () => t,
    sleep: (ms) => {
      t += ms;
      return Promise.resolve();
    },
  };
}

function noWindow(): Error {
  const error = new Error('No window could be found');
  error.name = 'NoSuchWindowError';
  return error;
}

describe('createSessionWhenWindowReady', () => {
  it('retries on NoSuchWindowError and returns the session once a window exists', async () => {
    let calls = 0;
    const result = await createSessionWhenWindowReady({
      create: () => {
        calls += 1;
        return calls < 4 ? Promise.reject(noWindow()) : Promise.resolve('session');
      },
      timeoutMs: 60_000,
      intervalMs: 500,
      ...fakeClock(),
    });
    expect(result).toBe('session');
    expect(calls).toBe(4);
  });

  it('gives up at the deadline and names the last error', async () => {
    let calls = 0;
    await expect(
      createSessionWhenWindowReady({
        create: () => {
          calls += 1;
          return Promise.reject(noWindow());
        },
        timeoutMs: 2_000,
        intervalMs: 500,
        ...fakeClock(),
      }),
    ).rejects.toThrow(/2000ms.*No window could be found/s);
    expect(calls).toBeGreaterThan(1);
    expect(calls).toBeLessThan(10);
  });

  it('rethrows any other error immediately, without retrying', async () => {
    let calls = 0;
    const boom = new Error('session not created');
    boom.name = 'SessionNotCreatedError';
    await expect(
      createSessionWhenWindowReady({
        create: () => {
          calls += 1;
          return Promise.reject(boom);
        },
        timeoutMs: 60_000,
        intervalMs: 500,
        ...fakeClock(),
      }),
    ).rejects.toBe(boom);
    expect(calls).toBe(1);
  });

  it('with a zero deadline tries exactly once, then fails naming the error', async () => {
    let calls = 0;
    await expect(
      createSessionWhenWindowReady({
        create: () => {
          calls += 1;
          return Promise.reject(noWindow());
        },
        timeoutMs: 0,
        intervalMs: 500,
        ...fakeClock(),
      }),
    ).rejects.toThrow(/No window could be found/);
    expect(calls).toBe(1);
  });

  it('with a negative deadline still tries once and succeeds if it can', async () => {
    const result = await createSessionWhenWindowReady({
      create: () => Promise.resolve('ok'),
      timeoutMs: -5,
      intervalMs: 500,
      ...fakeClock(),
    });
    expect(result).toBe('ok');
  });
});
