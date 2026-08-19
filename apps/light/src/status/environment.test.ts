/**
 * `@tauri-apps/api/core` is mocked — there is no Tauri runtime in a Vitest
 * process. What is asserted here is the CONTRACT: which commands are called,
 * with which arguments, and what the strip is told when the answers are absent,
 * partial or broken.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));

const { QUERIED_SECRET_KEYS, readEnvironmentStatus, readJobKeyStates, SECRET_KEYS } =
  await import('./environment');

const NOW = new Date(2026, 7, 19, 9, 0, 0);

/** Answer `secret_status` per key, and the Ollama probe with `tags`. */
function respond(options: { keys?: Record<string, boolean | Error>; tags?: string | null }): void {
  tauri.invoke.mockImplementation(async (command, args) => {
    if (command === 'ollama_probe') return options.tags ?? null;
    if (command === 'secret_status') {
      const key = String((args ?? {})['key']);
      const answer = options.keys?.[key] ?? false;
      if (answer instanceof Error) throw answer.message;
      return answer;
    }
    throw new Error(`unexpected command ${command}`);
  });
}

beforeEach(() => {
  tauri.invoke.mockReset();
});

describe('readEnvironmentStatus — the zero-configuration machine', () => {
  it('reports everything absent without a single error', () => {
    // This is what the app looks like the first time it is ever opened, and it
    // is a legitimate, fully working state — not a fault to be reported.
    respond({});

    return expect(readEnvironmentStatus(NOW)).resolves.toEqual({
      ollama: 'absent',
      adzuna: 'missing',
      reed: 'missing',
      requestsToday: 0,
    });
  });

  it('asks about exactly the search credentials, and nothing else', async () => {
    respond({});

    await readEnvironmentStatus(NOW);

    const asked = tauri.invoke.mock.calls
      .filter(([command]) => command === 'secret_status')
      .map(([, args]) => String((args ?? {})['key']))
      .sort();

    expect(asked).toEqual([...QUERIED_SECRET_KEYS].sort());
  });

  it('only ever names credentials the Rust side will accept', () => {
    // `SecretKey` in secrets.rs is a closed enum, and serde refuses a string
    // outside it before any of our Rust runs. A typo in the queried list would
    // therefore come back as an error rather than a `false`, so the subset
    // relationship is what keeps the strip truthful.
    for (const key of QUERIED_SECRET_KEYS) {
      expect(SECRET_KEYS).toContain(key);
    }
  });
});

describe('readEnvironmentStatus — Ollama', () => {
  it('is running when the daemon answers with anything at all', async () => {
    respond({ tags: '{"models":[]}' });

    await expect(readEnvironmentStatus(NOW)).resolves.toMatchObject({ ollama: 'running' });
  });

  it('boundary: an empty tag list still means the daemon is up', async () => {
    // A running Ollama with no models pulled is running. Reporting it as absent
    // would send the user to reinstall something that is already there.
    respond({ tags: '' });

    await expect(readEnvironmentStatus(NOW)).resolves.toMatchObject({ ollama: 'running' });
  });

  it('is absent when the probe comes back empty-handed', async () => {
    respond({ tags: null });

    await expect(readEnvironmentStatus(NOW)).resolves.toMatchObject({ ollama: 'absent' });
  });
});

describe('readEnvironmentStatus — provider keys', () => {
  it('reports Reed as configured when its key is saved', async () => {
    respond({ keys: { reed_api_key: true } });

    await expect(readEnvironmentStatus(NOW)).resolves.toMatchObject({ reed: 'configured' });
  });

  it('needs BOTH Adzuna credentials before it says configured', async () => {
    respond({ keys: { adzuna_app_id: true, adzuna_app_key: true } });

    await expect(readEnvironmentStatus(NOW)).resolves.toMatchObject({ adzuna: 'configured' });
  });

  it('calls a half-entered Adzuna incomplete, not missing', async () => {
    // Adzuna is the only provider needing two credentials, and one of them
    // alone does nothing. "Missing" would tell a user who has just pasted an
    // app id that nothing happened; "incomplete" tells them what is left.
    respond({ keys: { adzuna_app_id: true } });

    await expect(readEnvironmentStatus(NOW)).resolves.toMatchObject({ adzuna: 'incomplete' });
  });

  it('negative: a credential store that errors is unreadable, not missing', async () => {
    // A locked keychain is not an empty one. Reporting it as missing would
    // invite the user to paste a key they have already saved.
    respond({ keys: { reed_api_key: new Error('The system credential store is locked.') } });

    await expect(readEnvironmentStatus(NOW)).resolves.toMatchObject({ reed: 'unreadable' });
  });

  it('negative: one broken credential does not take the whole strip down', async () => {
    respond({
      keys: { reed_api_key: new Error('locked'), adzuna_app_id: true, adzuna_app_key: true },
      tags: '{"models":[]}',
    });

    await expect(readEnvironmentStatus(NOW)).resolves.toEqual({
      ollama: 'running',
      adzuna: 'configured',
      reed: 'unreadable',
      requestsToday: 0,
    });
  });

  it('negative: an answer that is not a boolean is unreadable, never a truthy yes', async () => {
    respond({ keys: { reed_api_key: 'yes' as unknown as boolean } });

    await expect(readEnvironmentStatus(NOW)).resolves.toMatchObject({ reed: 'unreadable' });
  });
});

describe('readJobKeyStates — what the search screen asks', () => {
  it('reports both boards, and asks about nothing else', async () => {
    respond({ keys: { reed_api_key: true, adzuna_app_id: true, adzuna_app_key: true } });

    await expect(readJobKeyStates()).resolves.toEqual({ adzuna: 'configured', reed: 'configured' });

    // No Ollama probe. The search screen does not care whether a language model
    // is running, and a loopback request per visit for a fact nobody draws is
    // a request nobody asked for.
    const commands = tauri.invoke.mock.calls.map((call) => call[0]);
    expect(commands).toEqual(['secret_status', 'secret_status', 'secret_status']);
  });

  it('boundary: one Adzuna credential of two is incomplete, not missing', async () => {
    respond({ keys: { adzuna_app_id: true } });

    await expect(readJobKeyStates()).resolves.toEqual({ adzuna: 'incomplete', reed: 'missing' });
  });

  it('negative: a store that will not answer is unreadable, never missing', async () => {
    respond({ keys: { reed_api_key: new Error('locked') } });

    await expect(readJobKeyStates()).resolves.toMatchObject({ reed: 'unreadable' });
  });

  it('negative: nothing rejects, whatever the credential store does', async () => {
    tauri.invoke.mockRejectedValue(new Error('IPC is broken'));

    await expect(readJobKeyStates()).resolves.toEqual({
      adzuna: 'unreadable',
      reed: 'unreadable',
    });
  });
});
