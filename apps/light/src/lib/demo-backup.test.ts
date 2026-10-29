/**
 * L-244 — the made-up applications the smoke job imports before it
 * photographs the app (`e2e/demoBackup.ts`).
 *
 * Built by the app's own `exportBackup`, so it is a file the app wrote; this
 * proves the app also READS it, before CI spends a Windows build finding out.
 */
import { describe, expect, it } from 'vitest';

import { importBackup } from '@cviper/core-types';

import { DEMO_ID_PREFIX, demoApplicationIds, demoBackup } from '../../e2e/demoBackup.ts';

const NOW = new Date('2026-10-28T12:00:00.000Z');

describe('the screenshot demo backup (L-244)', () => {
  it('is a backup the app imports', () => {
    const imported = importBackup(JSON.parse(demoBackup(NOW)));
    expect(imported.ok).toBe(true);
  });

  it('fills every Tracker column but Rejected, so the board looks used', () => {
    const imported = importBackup(JSON.parse(demoBackup(NOW)));
    if (!imported.ok) throw new Error(imported.error.message);
    const statuses = new Set(imported.value.applications.map((app) => app.status));
    expect([...statuses].sort()).toEqual(['applied', 'interviewing', 'offer', 'saved']);
    expect(imported.value.applications.length).toBeGreaterThanOrEqual(5);
  });

  it('every id is marked as demo data, so the smoke job can find and delete exactly these', () => {
    const imported = importBackup(JSON.parse(demoBackup(NOW)));
    if (!imported.ok) throw new Error(imported.error.message);
    const ids = [
      ...imported.value.jobs.map((job) => job.id),
      ...imported.value.applications.map((app) => app.id),
    ];
    for (const id of ids) expect(id.startsWith(DEMO_ID_PREFIX)).toBe(true);
    expect(demoApplicationIds()).toEqual(imported.value.applications.map((app) => app.id));
  });

  it('negative: names no real person, and no profile, CV or document rides along', () => {
    const imported = importBackup(JSON.parse(demoBackup(NOW)));
    if (!imported.ok) throw new Error(imported.error.message);
    expect(imported.value.profile).toBeNull();
    expect(imported.value.cvs).toEqual([]);
    expect(imported.value.documents).toEqual([]);
    expect(imported.value.analyses).toEqual([]);
  });

  it('boundary: dates follow the clock it is given, so "how long it has sat still" stays sensible', () => {
    const imported = importBackup(JSON.parse(demoBackup(NOW)));
    if (!imported.ok) throw new Error(imported.error.message);
    for (const app of imported.value.applications) {
      const updated = new Date(app.updated_at).getTime();
      expect(updated).toBeLessThanOrEqual(NOW.getTime());
      expect(NOW.getTime() - updated).toBeLessThan(30 * 24 * 60 * 60 * 1000);
    }
  });
});
