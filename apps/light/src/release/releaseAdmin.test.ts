/**
 * The release-admin planner (L-178): what `release-admin.yml` may do to a
 * release, and the three things it must never do.
 *
 * The never-list is the point of the file. A workflow that can edit releases is
 * one typo away from publishing a draft nobody reviewed, deleting a download
 * people rely on, or re-pointing the permanent `updater` release every
 * installed copy reads. Each of those is a refusal proved here, and the sweep
 * at the bottom proves no input at all produces a publishing or tag-deleting
 * command.
 */
import { describe, expect, it } from 'vitest';

import {
  ADMIN_ACTIONS,
  parseReleaseRows,
  planReleaseAdmin,
  type ReleaseRow,
} from './releaseAdmin.ts';

const published = (tagName: string, isPrerelease = false): ReleaseRow => ({
  tagName,
  isDraft: false,
  isPrerelease,
});
const draft = (tagName: string): ReleaseRow => ({ tagName, isDraft: true, isPrerelease: false });

/** Today's shape: a published 0.2.0, a 0.3.0 pre-release, the updater, a stale draft. */
const TODAY: readonly ReleaseRow[] = [
  published('light-v0.3.0', true),
  published('updater', true),
  published('light-v0.2.0'),
  draft('light-v0.1.0'),
];

describe('happy paths', () => {
  it('clears the pre-release flag and makes the release Latest', () => {
    expect(planReleaseAdmin('clear-prerelease', 'light-v0.3.0', TODAY)).toEqual({
      kind: 'run',
      args: ['release', 'edit', 'light-v0.3.0', '--prerelease=false', '--latest'],
      summary: expect.stringContaining('Latest') as string,
    });
  });

  it('sets the pre-release flag on a published release', () => {
    expect(planReleaseAdmin('set-prerelease', 'light-v0.2.0', TODAY)).toEqual({
      kind: 'run',
      args: ['release', 'edit', 'light-v0.2.0', '--prerelease'],
      summary: expect.stringContaining('pre-release') as string,
    });
  });

  it('deletes a draft and keeps its git tag', () => {
    const plan = planReleaseAdmin('delete-draft', 'light-v0.1.0', TODAY);
    expect(plan).toEqual({
      kind: 'run',
      args: ['release', 'delete', 'light-v0.1.0', '--yes'],
      summary: expect.stringContaining('tag is kept') as string,
    });
  });

  it('reports setting a flag that is already set as nothing to do, not as a failure', () => {
    expect(planReleaseAdmin('set-prerelease', 'light-v0.3.0', TODAY)).toMatchObject({
      kind: 'noop',
    });
  });
});

describe('refusals', () => {
  it('never deletes a published release', () => {
    expect(planReleaseAdmin('delete-draft', 'light-v0.2.0', TODAY)).toMatchObject({
      kind: 'refuse',
      why: expect.stringContaining('published') as string,
    });
  });

  it('never edits a draft, so nothing here can publish one', () => {
    for (const action of ['set-prerelease', 'clear-prerelease'] as const) {
      expect(planReleaseAdmin(action, 'light-v0.1.0', TODAY)).toMatchObject({
        kind: 'refuse',
        why: expect.stringContaining('draft') as string,
      });
    }
  });

  it('never touches the permanent updater release', () => {
    for (const action of ADMIN_ACTIONS) {
      expect(planReleaseAdmin(action, 'updater', TODAY)).toMatchObject({ kind: 'refuse' });
    }
  });

  it('refuses to make an older version Latest over a newer full release', () => {
    const rows = [published('light-v0.3.0'), published('light-v0.2.0', true)];
    expect(planReleaseAdmin('clear-prerelease', 'light-v0.2.0', rows)).toMatchObject({
      kind: 'refuse',
      why: expect.stringContaining('light-v0.3.0') as string,
    });
  });

  it('compares versions as numbers, so 0.10.0 is newer than 0.9.0', () => {
    const rows = [published('light-v0.10.0'), published('light-v0.9.0', true)];
    expect(planReleaseAdmin('clear-prerelease', 'light-v0.9.0', rows)).toMatchObject({
      kind: 'refuse',
    });
    const reversed = [published('light-v0.9.0'), published('light-v0.10.0', true)];
    expect(planReleaseAdmin('clear-prerelease', 'light-v0.10.0', reversed)).toMatchObject({
      kind: 'run',
    });
  });

  it('lets an older release become Latest when the newer one is only a pre-release', () => {
    const rows = [published('light-v0.4.0', true), published('light-v0.3.0', true)];
    expect(planReleaseAdmin('clear-prerelease', 'light-v0.3.0', rows)).toMatchObject({
      kind: 'run',
    });
  });

  it('refuses a tag with no release', () => {
    expect(planReleaseAdmin('delete-draft', 'light-v9.9.9', TODAY)).toMatchObject({
      kind: 'refuse',
      why: expect.stringContaining('No release') as string,
    });
  });

  it('refuses a tag two releases share, rather than guessing which one', () => {
    const rows = [draft('light-v0.5.0'), draft('light-v0.5.0')];
    expect(planReleaseAdmin('delete-draft', 'light-v0.5.0', rows)).toMatchObject({
      kind: 'refuse',
      why: expect.stringContaining('2 releases') as string,
    });
  });

  it('refuses an action it does not know', () => {
    expect(planReleaseAdmin('publish', 'light-v0.1.0', TODAY)).toMatchObject({
      kind: 'refuse',
      why: expect.stringContaining('publish') as string,
    });
  });
});

describe('the tag has to be exactly light-vX.Y.Z', () => {
  it.each([
    ['', 'empty'],
    [' ', 'a space'],
    ['0.3.0', 'a bare version'],
    ['v0.3.0', 'the wrong prefix'],
    ['light-v0.3', 'two parts'],
    ['light-v0.3.0 ', 'a trailing space'],
    ['light-v0.3.0-rc1', 'a suffix'],
    ['light-v0.3.0\nupdater', 'a second line'],
  ])('refuses %j (%s)', (tag) => {
    expect(planReleaseAdmin('delete-draft', tag, [draft(tag)])).toMatchObject({
      kind: 'refuse',
    });
  });

  it('accepts multi-digit parts at the boundary', () => {
    expect(
      planReleaseAdmin('delete-draft', 'light-v10.20.30', [draft('light-v10.20.30')]),
    ).toMatchObject({ kind: 'run' });
  });
});

describe('no input produces a command outside the three', () => {
  const TAGS = ['light-v0.1.0', 'light-v0.2.0', 'light-v0.3.0', 'updater', '', 'x'];
  const ACTIONS = [...ADMIN_ACTIONS, 'publish', 'delete', ''];
  const plans = ACTIONS.flatMap((action) =>
    TAGS.map((tag) => ({ action, tag, plan: planReleaseAdmin(action, tag, TODAY) })),
  );

  it('sweeps a real set of plans (anti-inert)', () => {
    expect(plans.filter(({ plan }) => plan.kind === 'run').length).toBeGreaterThanOrEqual(3);
  });

  it('never publishes, never deletes a tag, never creates or uploads', () => {
    const offences = plans.flatMap(({ action, tag, plan }) => {
      if (plan.kind !== 'run') return [];
      const joined = plan.args.join(' ');
      return /--draft|--cleanup-tag|\bcreate\b|\bupload\b|--tag\b/.test(joined)
        ? [`${action} ${JSON.stringify(tag)} -> gh ${joined}`]
        : [];
    });
    expect(offences).toEqual([]);
  });

  it('only ever runs `gh release edit` or `gh release delete` on the tag it was given', () => {
    for (const { tag, plan } of plans) {
      if (plan.kind !== 'run') continue;
      expect(['edit', 'delete']).toContain(plan.args[1]);
      expect(plan.args.slice(0, 1)).toEqual(['release']);
      expect(plan.args[2]).toBe(tag);
    }
  });
});

describe('parseReleaseRows', () => {
  it('reads what `gh release list --json` prints', () => {
    const raw = JSON.stringify([
      { tagName: 'light-v0.3.0', isDraft: false, isPrerelease: true },
      { tagName: 'light-v0.1.0', isDraft: true, isPrerelease: false },
    ]);
    expect(parseReleaseRows(raw)).toEqual([published('light-v0.3.0', true), draft('light-v0.1.0')]);
  });

  it('throws on anything that is not a list of releases, rather than reading it as none', () => {
    expect(() => parseReleaseRows('{}')).toThrow(/not a list/);
    expect(() => parseReleaseRows('[{"tagName":"light-v0.3.0"}]')).toThrow(/isDraft/);
    expect(() => parseReleaseRows('not json')).toThrow();
  });
});
