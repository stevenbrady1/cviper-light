// @vitest-environment jsdom
/**
 * The key port's contract with Rust.
 *
 * jsdom because the quota counter this path writes to lives in `localStorage`,
 * and "a key test is counted" is one of the things worth asserting.
 *
 * No real credential store and no socket: `invoke` is mocked, which is the only
 * honest way to test this layer. What is asserted is the SHAPE of the exchange
 * — which command, which arguments, and what each answer is turned into.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isErr, isOk } from '@cviper/core-types';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));

const { createTauriKeyPort } = await import('./port');
const { QUOTA_STORAGE_KEY, readQuota } = await import('../../../jobs/quotaStore');

const NOW = new Date('2026-08-19T09:00:00.000Z');

function envelope(status: number, body: string): string {
  return JSON.stringify({ status, body });
}

const REED_BODY = JSON.stringify({
  results: [
    {
      jobId: 55512345,
      jobTitle: 'Credit Risk Analyst',
      employerName: 'Barclays',
      locationName: 'London',
      minimumSalary: 500,
      maximumSalary: 550,
      jobDescription: 'A contract role inside IR35.',
      jobUrl: 'https://www.reed.co.uk/jobs/55512345',
      date: '14/08/2026',
    },
  ],
});

beforeEach(() => {
  localStorage.clear();
  tauri.invoke.mockReset();
});

describe('reading what is saved', () => {
  it('asks about exactly the credentials the board needs, by their Rust names', async () => {
    tauri.invoke.mockResolvedValue(true);

    const answers = await createTauriKeyPort(NOW).status('adzuna');

    expect(tauri.invoke.mock.calls.map((call) => call[1])).toEqual([
      { key: 'adzuna_app_id' },
      { key: 'adzuna_app_key' },
    ]);
    expect(tauri.invoke.mock.calls.every((call) => call[0] === 'secret_status')).toBe(true);
    expect(answers).toEqual({ adzuna_app_id: true, adzuna_app_key: true });
  });

  it('reports one credential of two, which is the incomplete case', async () => {
    tauri.invoke.mockImplementation(async (_command, args) =>
      args?.['key'] === 'adzuna_app_id' ? true : false,
    );

    expect(await createTauriKeyPort(NOW).status('adzuna')).toEqual({
      adzuna_app_id: true,
      adzuna_app_key: false,
    });
  });

  it('negative: a store that will not answer reads as null, never as false', async () => {
    tauri.invoke.mockRejectedValue('the keychain is locked');

    // `false` here would tell a user with a locked keychain that their saved
    // key is gone, and invite them to paste it again.
    expect(await createTauriKeyPort(NOW).status('reed')).toEqual({ reed_api_key: null });
  });

  it('negative: an answer that is not a boolean reads as null', async () => {
    tauri.invoke.mockResolvedValue('yes');

    expect(await createTauriKeyPort(NOW).status('reed')).toEqual({ reed_api_key: null });
  });
});

describe('testing a key that has not been saved', () => {
  it('calls job_test_credentials with the provider and the typed values', async () => {
    tauri.invoke.mockResolvedValue(envelope(200, REED_BODY));

    const tested = await createTauriKeyPort(NOW).test('reed', { reed_api_key: 'the-key' });

    expect(tauri.invoke).toHaveBeenCalledWith('job_test_credentials', {
      provider: 'reed',
      supplied: { reed_api_key: 'the-key' },
    });
    expect(isOk(tested) && tested.value).toBe(1);
  });

  it('sends only the credentials this board needs', async () => {
    tauri.invoke.mockResolvedValue(envelope(200, '{"results":[]}'));

    await createTauriKeyPort(NOW).test('reed', {
      reed_api_key: 'the-key',
      adzuna_app_id: 'not-reeds-business',
    });

    const args = JSON.stringify(tauri.invoke.mock.calls[0]?.[1] ?? {});
    expect(args).not.toContain('not-reeds-business');
  });

  it('never passes a URL — Rust owns every destination', async () => {
    tauri.invoke.mockResolvedValue(envelope(200, '{"results":[]}'));

    await createTauriKeyPort(NOW).test('adzuna', {
      adzuna_app_id: 'id',
      adzuna_app_key: 'key',
    });

    const args = JSON.stringify(tauri.invoke.mock.calls[0]?.[1] ?? {});
    expect(args).not.toMatch(/https?:\/\//);
  });

  it('boundary: a 200 that matched nothing is a PASS with zero results', async () => {
    // The key worked. A one-result probe simply matched nothing, and calling
    // that a failure would send the user back to re-paste a working key.
    tauri.invoke.mockResolvedValue(envelope(200, '{"results":[]}'));

    const tested = await createTauriKeyPort(NOW).test('reed', { reed_api_key: 'the-key' });

    expect(isOk(tested) && tested.value).toBe(0);
  });

  it('negative: a 401 is an auth failure, not a network one', async () => {
    tauri.invoke.mockResolvedValue(envelope(401, ''));

    const tested = await createTauriKeyPort(NOW).test('reed', { reed_api_key: 'wrong' });

    expect(isErr(tested) && tested.error.kind).toBe('auth');
    expect(isErr(tested) && tested.error.status).toBe(401);
  });

  it('negative: a 429 is a rate limit, which is not the key being wrong', async () => {
    tauri.invoke.mockResolvedValue(envelope(429, ''));

    const tested = await createTauriKeyPort(NOW).test('adzuna', {
      adzuna_app_id: 'id',
      adzuna_app_key: 'key',
    });

    expect(isErr(tested) && tested.error.kind).toBe('rate-limit');
  });

  it('negative: a 200 whose body is not the expected shape is a bad response', async () => {
    tauri.invoke.mockResolvedValue(envelope(200, 'not json at all'));

    const tested = await createTauriKeyPort(NOW).test('reed', { reed_api_key: 'the-key' });

    expect(isErr(tested) && tested.error.kind).toBe('bad-response');
  });

  it('negative: a structured Rust rejection keeps its kind', async () => {
    tauri.invoke.mockRejectedValue(
      JSON.stringify({ kind: 'no-key', message: 'Adzuna needs both an App ID and an App Key.' }),
    );

    const tested = await createTauriKeyPort(NOW).test('adzuna', { adzuna_app_id: 'only-one' });

    expect(isErr(tested) && tested.error.kind).toBe('no-key');
  });

  it('counts the test against the daily allowance, because it really was a request', async () => {
    tauri.invoke.mockResolvedValue(envelope(200, REED_BODY));

    await createTauriKeyPort(NOW).test('reed', { reed_api_key: 'the-key' });

    expect(readQuota(NOW).counts).toEqual({ reed: 1, adzuna: 0 });
  });

  it('counts a FAILED test too — the board answered, so the request was spent', async () => {
    tauri.invoke.mockResolvedValue(envelope(401, ''));

    await createTauriKeyPort(NOW).test('reed', { reed_api_key: 'wrong' });

    expect(readQuota(NOW).counts.reed).toBe(1);
  });

  it('stores nothing but a date and two numbers while doing it', async () => {
    tauri.invoke.mockResolvedValue(envelope(200, REED_BODY));

    await createTauriKeyPort(NOW).test('reed', { reed_api_key: 'sk-do-not-store-me' });

    const raw = localStorage.getItem(QUOTA_STORAGE_KEY) ?? '';
    expect(raw).not.toContain('sk-do-not-store-me');
  });

  it('never writes a key to the credential store as part of testing one', async () => {
    tauri.invoke.mockResolvedValue(envelope(200, REED_BODY));

    await createTauriKeyPort(NOW).test('reed', { reed_api_key: 'the-key' });

    // The whole point of test-before-save: the test path has no route to the
    // store at all. Saving is a separate call the caller makes afterwards.
    expect(tauri.invoke.mock.calls.map((call) => call[0])).toEqual(['job_test_credentials']);
  });
});

describe('saving and removing', () => {
  it('saves one credential under its Rust name', async () => {
    tauri.invoke.mockResolvedValue(null);

    const saved = await createTauriKeyPort(NOW).save('reed_api_key', 'the-key');

    expect(tauri.invoke).toHaveBeenCalledWith('secret_set', {
      key: 'reed_api_key',
      value: 'the-key',
    });
    expect(isOk(saved)).toBe(true);
  });

  it('negative: a refusal from the credential store comes back as a message', async () => {
    tauri.invoke.mockRejectedValue('That key is too long for this computer’s credential store.');

    const saved = await createTauriKeyPort(NOW).save('reed_api_key', 'k');

    expect(isErr(saved) && saved.error.message).toContain('too long');
  });

  it('negative: a rejection that is not a string still produces a sentence', async () => {
    tauri.invoke.mockRejectedValue({ unexpected: true });

    const saved = await createTauriKeyPort(NOW).save('reed_api_key', 'k');

    expect(isErr(saved) && saved.error.message.length).toBeGreaterThan(0);
    expect(isErr(saved) && saved.error.message).not.toContain('[object Object]');
  });

  it('removes EVERY credential a board needs, not just the first', async () => {
    tauri.invoke.mockResolvedValue(null);

    const removed = await createTauriKeyPort(NOW).remove('adzuna');

    // Half a credential authenticates nothing. Leaving one behind would put the
    // board straight back into the "half set up" state the user was clearing.
    expect(tauri.invoke.mock.calls).toEqual([
      ['secret_delete', { key: 'adzuna_app_id' }],
      ['secret_delete', { key: 'adzuna_app_key' }],
    ]);
    expect(isOk(removed)).toBe(true);
  });

  it('negative: reports a removal that failed rather than claiming success', async () => {
    tauri.invoke.mockImplementation(async (_command, args) => {
      if (args?.['key'] === 'adzuna_app_key') throw new Error('the keychain is locked');
      return null;
    });

    const removed = await createTauriKeyPort(NOW).remove('adzuna');

    expect(isErr(removed) && removed.error.message).toContain('locked');
  });
});
