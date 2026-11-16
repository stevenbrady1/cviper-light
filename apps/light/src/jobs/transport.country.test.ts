/**
 * The country a search carries across to Rust (L-415).
 *
 * `@tauri-apps/api/core` is mocked, as in `transport.test.ts`. What is asserted
 * is the contract with Rust: a country crosses as a bare code inside `params`,
 * a search that names none crosses exactly as it did before, and Rust's refusal
 * of a code it does not know never puts that code in front of the user.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildSearchParams, type JobSearchParams } from '@cviper/job-apis';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));

vi.mock('../status/requestLog', () => ({ recordRequest: vi.fn() }));

const { createTauriJobTransport } = await import('./transport');

beforeEach(() => {
  tauri.invoke.mockReset();
  tauri.invoke.mockResolvedValue(JSON.stringify({ status: 200, body: '{"results":[]}' }));
});

function built(country?: 'gb' | 'us'): JobSearchParams {
  const result = buildSearchParams('adzuna', {
    keywords: 'credit risk analyst',
    location: 'London',
    ...(country === undefined ? {} : { country }),
  });
  if (!result.ok) throw new Error('expected a search that can be built');
  return result.value;
}

describe('createTauriJobTransport — the country', () => {
  it('a search that names no country crosses to Rust exactly as it did before', async () => {
    await createTauriJobTransport().search('adzuna', built());

    expect(JSON.stringify(tauri.invoke.mock.calls[0]?.[1])).toBe(
      '{"provider":"adzuna","params":{"keywords":"credit risk analyst","location":"London",' +
        '"limit":20,"distance":null,"salaryMin":null,"employmentType":null}}',
    );
  });

  it('happy: a named country crosses as a bare code, and as nothing else', async () => {
    await createTauriJobTransport().search('adzuna', built('us'));

    expect(tauri.invoke).toHaveBeenCalledWith('job_search', {
      provider: 'adzuna',
      params: { ...built(), country: 'us' },
    });
    const args = JSON.stringify(tauri.invoke.mock.calls[0]?.[1] ?? {});
    expect(args).not.toMatch(/https?:/);
    expect(args).not.toContain('/');
  });

  it('negative: Rust refusing a country never shows the user what was sent', async () => {
    // What Tauri rejects with when serde will not read `params`: a sentence,
    // not our `{kind, message}` object, and it names the value it refused.
    tauri.invoke.mockRejectedValue(
      'invalid args `params` for command `job_search`: unknown variant `../../admin`, ' +
        'expected one of `gb`, `us`, `at`',
    );

    const result = await createTauriJobTransport().search('adzuna', {
      ...built(),
      country: '../../admin' as never,
    });

    expect(result).toEqual({
      ok: false,
      error: {
        provider: 'adzuna',
        kind: 'network',
        message: 'The search could not be sent. Try again.',
      },
    });
  });

  it('carries Rust’s Reed refusal through in its own words', async () => {
    tauri.invoke.mockRejectedValue(
      JSON.stringify({ kind: 'bad-request', message: 'Reed lists UK jobs only.' }),
    );

    const result = await createTauriJobTransport().search('reed', built('us'));

    expect(result).toEqual({
      ok: false,
      error: { provider: 'reed', kind: 'bad-request', message: 'Reed lists UK jobs only.' },
    });
  });
});
