import { describe, expect, it } from 'vitest';

import { BACKUP_SCHEMA_VERSION, exportBackup, importBackup, type BackupPayload } from './backup';
import {
  INTERVIEW_SUBSTAGE_NAME_MAX,
  INTERVIEW_SUBSTAGES_MAX,
  InterviewSubstageSchema,
  type Application,
  type InterviewSubstage,
} from './entities';

/**
 * Customisable interview sub-stages (L-205) are the fourth addition to the
 * format after v1 shipped: one new top-level collection and one new
 * application field. Both ADDITIVE and optional, so the version stays 1 — a
 * file written before they existed imports unchanged, and a file written
 * after them carries them through a round trip.
 */

const NOW = '2026-10-05T09:00:00.000Z';

function application(id: string, overrides: Partial<Application> = {}): Application {
  return {
    id,
    job_id: 'job-1',
    status: 'interviewing',
    applied_date: '2026-09-10',
    notes: null,
    next_action: null,
    next_action_date: null,
    updated_at: NOW,
    ...overrides,
  };
}

const STAGES: InterviewSubstage[] = [
  { id: 'sub-a', name: 'HR Screen', position: 0 },
  { id: 'sub-b', name: 'Technical Test', position: 1 },
  { id: 'sub-c', name: 'Panel Round', position: 2 },
];

/** A v1 file exactly as the app wrote it BEFORE sub-stages: no new keys at all. */
const LEGACY_APPLICATION = {
  id: 'app-1',
  job_id: 'job-1',
  status: 'interviewing',
  applied_date: '2026-09-10',
  notes: null,
  next_action: null,
  next_action_date: null,
  updated_at: NOW,
};

const LEGACY = {
  schemaVersion: 1,
  exportedAt: NOW,
  app: { name: 'cviper-light', version: '0.6.0' },
  profile: null,
  jobs: [
    {
      id: 'job-1',
      source: 'manual',
      external_id: null,
      title: 'Quant Developer',
      company: 'Man Group',
      agency: null,
      location: null,
      salary_min: null,
      salary_max: null,
      salary_currency: null,
      salary_period: null,
      description: null,
      url: null,
      posted_date: null,
      created_at: NOW,
    },
  ],
  applications: [LEGACY_APPLICATION],
  documents: [],
  cvs: [],
  analyses: [],
};

function payload(
  applications: Application[],
  interview_substages: InterviewSubstage[],
): BackupPayload {
  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: NOW,
    app: { name: 'cviper-light', version: '0.7.0' },
    profile: null,
    jobs: LEGACY.jobs as unknown as BackupPayload['jobs'],
    applications,
    interview_substages,
    documents: [],
    cvs: [],
    analyses: [],
  };
}

function withKeys(extra: Record<string, unknown>): string {
  return JSON.stringify({ ...LEGACY, ...extra });
}

describe('a current-format export without sub-stages', () => {
  it('imports unchanged, with an empty list and no sub-stage on the card', () => {
    const imported = importBackup(JSON.stringify(LEGACY));
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.value.interview_substages).toEqual([]);
    expect(imported.value.applications[0]?.interview_substage_id ?? null).toBeNull();
    expect(imported.value.__extra).toBeUndefined();
    expect(imported.value.applications[0]?.__extra).toBeUndefined();
  });

  it('keeps the schema version at 1 so an older reader is not locked out', () => {
    expect(BACKUP_SCHEMA_VERSION).toBe(1);
  });
});

describe('a new export', () => {
  it('writes the list sorted by position, and the card field beside its siblings', () => {
    const text = exportBackup(
      payload([application('app-1', { interview_substage_id: 'sub-b' })], [...STAGES].reverse()),
    );
    const parsed = JSON.parse(text) as {
      interview_substages: InterviewSubstage[];
      applications: Array<Record<string, unknown>>;
    };
    expect(parsed.interview_substages.map((s) => s.name)).toEqual([
      'HR Screen',
      'Technical Test',
      'Panel Round',
    ]);
    expect(parsed.applications[0]?.['interview_substage_id']).toBe('sub-b');
  });

  it('round-trips sub-stages and the card using one', () => {
    const original = payload([application('app-1', { interview_substage_id: 'sub-c' })], STAGES);
    const imported = importBackup(exportBackup(original));
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.value.interview_substages).toEqual(STAGES);
    expect(imported.value.applications[0]?.interview_substage_id).toBe('sub-c');
    // Byte-identical on a second pass: the format is deterministic.
    expect(exportBackup(imported.value)).toBe(exportBackup(original));
  });

  it('writes null for a card with no sub-stage', () => {
    const text = exportBackup(payload([application('app-1')], STAGES));
    const parsed = JSON.parse(text) as { applications: Array<Record<string, unknown>> };
    expect(parsed.applications[0]?.['interview_substage_id']).toBeNull();
  });
});

describe('invalid sub-stage data on import', () => {
  it('rejects a sub-stage with an empty name, and imports nothing', () => {
    const imported = importBackup(
      withKeys({ interview_substages: [{ id: 'sub-a', name: '   ', position: 0 }] }),
    );
    expect(imported.ok).toBe(false);
    if (imported.ok) return;
    expect(imported.error.code).toBe('INVALID_RECORD');
    expect(imported.error.path).toMatch(/^interview_substages\[0\]/);
  });

  it('rejects a sub-stage that is not an object, and a list that is not an array', () => {
    expect(importBackup(withKeys({ interview_substages: ['HR Screen'] })).ok).toBe(false);
    expect(importBackup(withKeys({ interview_substages: 'HR Screen' })).ok).toBe(false);
  });

  it('rejects two sub-stages sharing an id', () => {
    const imported = importBackup(
      withKeys({
        interview_substages: [
          { id: 'sub-a', name: 'One', position: 0 },
          { id: 'sub-a', name: 'Two', position: 1 },
        ],
      }),
    );
    expect(imported.ok).toBe(false);
  });

  it('sanitises a card pointing at a sub-stage that is not in the file, to none', () => {
    const imported = importBackup(
      withKeys({
        interview_substages: [],
        applications: [{ ...LEGACY_APPLICATION, interview_substage_id: 'ghost' }],
      }),
    );
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.value.applications[0]?.interview_substage_id ?? null).toBeNull();
  });

  it('sanitises a sub-stage on a card that is not Interviewing, to none', () => {
    const imported = importBackup(
      withKeys({
        interview_substages: [{ id: 'sub-a', name: 'HR Screen', position: 0 }],
        applications: [{ ...LEGACY_APPLICATION, status: 'offer', interview_substage_id: 'sub-a' }],
      }),
    );
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.value.applications[0]?.interview_substage_id ?? null).toBeNull();
  });

  it('rejects a card whose sub-stage id is not a string', () => {
    const imported = importBackup(
      withKeys({ applications: [{ ...LEGACY_APPLICATION, interview_substage_id: 7 }] }),
    );
    expect(imported.ok).toBe(false);
  });

  it('allows duplicate NAMES (the ids differ and nothing breaks); the editor refuses them', () => {
    const imported = importBackup(
      withKeys({
        interview_substages: [
          { id: 'sub-a', name: 'Final', position: 0 },
          { id: 'sub-b', name: 'Final', position: 1 },
        ],
      }),
    );
    expect(imported.ok).toBe(true);
  });
});

describe('boundaries', () => {
  function many(count: number): InterviewSubstage[] {
    return Array.from({ length: count }, (_, index) => ({
      id: `sub-${index}`,
      name: `Stage ${index}`,
      position: index,
    }));
  }

  it('accepts exactly the maximum number of sub-stages', () => {
    const imported = importBackup(withKeys({ interview_substages: many(INTERVIEW_SUBSTAGES_MAX) }));
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.value.interview_substages).toHaveLength(INTERVIEW_SUBSTAGES_MAX);
  });

  it('rejects one more than the maximum', () => {
    const imported = importBackup(
      withKeys({ interview_substages: many(INTERVIEW_SUBSTAGES_MAX + 1) }),
    );
    expect(imported.ok).toBe(false);
    if (imported.ok) return;
    expect(imported.error.path).toBe('interview_substages');
  });

  it('accepts a name of exactly the maximum length and rejects one more', () => {
    const at = InterviewSubstageSchema.safeParse({
      id: 'a',
      name: 'x'.repeat(INTERVIEW_SUBSTAGE_NAME_MAX),
      position: 0,
    });
    const over = InterviewSubstageSchema.safeParse({
      id: 'a',
      name: 'x'.repeat(INTERVIEW_SUBSTAGE_NAME_MAX + 1),
      position: 0,
    });
    expect(at.success).toBe(true);
    expect(over.success).toBe(false);
  });

  it('rejects a negative or fractional position', () => {
    expect(InterviewSubstageSchema.safeParse({ id: 'a', name: 'A', position: -1 }).success).toBe(
      false,
    );
    expect(InterviewSubstageSchema.safeParse({ id: 'a', name: 'A', position: 1.5 }).success).toBe(
      false,
    );
  });
});
