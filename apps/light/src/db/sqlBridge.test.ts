/**
 * The bridge sends queries to the app's own Rust commands, never the plugin's
 * (L-243). See `sqlBridge.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  load: vi.fn<(url: string) => Promise<unknown>>(),
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/plugin-sql', () => ({ default: { load: fakes.load } }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: fakes.invoke }));

const { default: bridge } = await import('./sqlBridge');
const { DB_URL } = await import('./constants');

beforeEach(() => {
  fakes.load.mockReset();
  fakes.invoke.mockReset();
  fakes.load.mockResolvedValue({
    execute: () => {
      throw new Error('the plugin connection must never run a query');
    },
    select: () => {
      throw new Error('the plugin connection must never run a query');
    },
  });
});

describe('sqlBridge (L-243)', () => {
  it('opens the database through the plugin, then sends execute to db_execute', async () => {
    fakes.invoke.mockResolvedValue([2, 7]);
    const db = await bridge.load(DB_URL);

    const result = await db.execute('COMMIT;', ['a', 1, null]);

    expect(fakes.load).toHaveBeenCalledWith(DB_URL);
    expect(fakes.invoke).toHaveBeenCalledWith('db_execute', {
      sql: 'COMMIT;',
      values: ['a', 1, null],
    });
    expect(result).toEqual({ rowsAffected: 2, lastInsertId: 7 });
  });

  it('sends select to db_select and returns its rows as they come', async () => {
    const rows = [{ id: 'x', n: 1 }];
    fakes.invoke.mockResolvedValue(rows);
    const db = await bridge.load(DB_URL);

    expect(await db.select('SELECT id FROM jobs')).toBe(rows);
    expect(fakes.invoke).toHaveBeenCalledWith('db_select', {
      sql: 'SELECT id FROM jobs',
      values: [],
    });
  });

  it('boundary: no values means an empty list, never undefined', async () => {
    fakes.invoke.mockResolvedValue([0, 0]);
    const db = await bridge.load(DB_URL);
    await db.execute('COMMIT;');
    expect(fakes.invoke.mock.calls[0]?.[1]).toEqual({ sql: 'COMMIT;', values: [] });
  });

  it('negative: refuses to open any other database file', async () => {
    await expect(bridge.load('sqlite:C:/Users/x/AppData/Roaming/Startup/evil.db')).rejects.toThrow(
      /Only sqlite:cviper\.db/,
    );
    expect(fakes.load).not.toHaveBeenCalled();
  });

  it('negative: a refusal from Rust reaches the caller as an error', async () => {
    fakes.invoke.mockRejectedValue('Not an approved statement (L-243): ATTACH');
    const db = await bridge.load(DB_URL);
    await expect(db.execute('ATTACH DATABASE x AS y')).rejects.toBe(
      'Not an approved statement (L-243): ATTACH',
    );
  });
});
