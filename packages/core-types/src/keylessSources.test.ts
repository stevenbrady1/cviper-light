/**
 * The two keyless feeds are real job sources, not a costume worn by an
 * existing one (L-110).
 *
 * ============================================================================
 * WHY `JobSource` HAD TO GROW RATHER THAN BE REUSED
 * ============================================================================
 * An advert browsed from Arbeitnow or Guardian Jobs is saved to the tracker
 * like any other, and `jobs (source, external_id)` is a UNIQUE index. Labelling
 * a Guardian advert `reed` would do two separate kinds of damage:
 *
 *   * the card would name the wrong board, which is a lie on screen and — for
 *     a feed whose terms ask to be credited — a broken promise;
 *   * a Guardian id and a Reed id would share a namespace, so two unrelated
 *     adverts that happen to carry the same number would collide in the index
 *     and the second one would be refused as "already saved".
 *
 * `JobSource` is a closed union backed by a Zod enum, so adding a member is a
 * deliberate act in exactly one file. The DB column is deliberately NOT
 * CHECK-constrained (see `0001_init.sql`), which is why this can be additive.
 */
import { describe, expect, it } from 'vitest';

import { JobSchema, type Job, type JobSource } from './entities';

function jobFrom(source: string): unknown {
  return {
    id: 'job-1',
    source,
    external_id: 'abc-123',
    title: 'Social Worker',
    company: 'LB Richmond upon Thames',
    location: 'London (South)',
    salary_min: null,
    salary_max: null,
    salary_currency: null,
    salary_period: null,
    description: null,
    url: 'https://example.com/job/1',
    posted_date: '2026-08-19',
    created_at: '2026-09-13T09:00:00.000Z',
  };
}

describe('JobSource covers the keyless feeds', () => {
  it('accepts a job browsed from Arbeitnow', () => {
    const parsed = JobSchema.parse(jobFrom('arbeitnow'));
    expect(parsed.source).toBe('arbeitnow');
  });

  it('accepts a job browsed from Guardian Jobs', () => {
    const parsed = JobSchema.parse(jobFrom('guardian'));
    expect(parsed.source).toBe('guardian');
  });

  it('negative: still refuses a source nobody has added', () => {
    // The point of a closed union. Widening it for two feeds must not widen it
    // for everything — a backup file naming an unknown board is still refused.
    expect(() => JobSchema.parse(jobFrom('monster'))).toThrow();
  });

  it('boundary: the empty string is not a source', () => {
    expect(() => JobSchema.parse(jobFrom(''))).toThrow();
  });

  it('makes both usable as a typed `Job.source`', () => {
    // A compile-time assertion as much as a runtime one: if either literal
    // left `JobSource`, this file would stop typechecking.
    const sources: readonly JobSource[] = ['arbeitnow', 'guardian'];
    const job: Pick<Job, 'source'> = { source: 'arbeitnow' };

    expect(sources).toContain(job.source);
  });
});
