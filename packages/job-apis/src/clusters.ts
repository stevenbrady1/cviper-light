/**
 * Grouping cross-posted adverts - and NOT removing any of them.
 *
 * ============================================================================
 * FLAG, NEVER MERGE. THIS IS A DELIBERATE DEPARTURE FROM THE WEB APPLICATION.
 * ============================================================================
 * The source (`backend/core/dedupe_fingerprint.py`, `is_merge_match`)
 * auto-merges any pair inside the band. Its own comment on the wider "flag"
 * band explains exactly why that is dangerous:
 *
 *   A wrong merge deletes a real posting and its apply URL with no error and
 *   no way for the user to know; a wrong flag asks a question they can dismiss.
 *
 * The web app can afford the risk because the merge happens server-side, where
 * a support engineer can undo it. CViper Light writes to one SQLite file on one
 * machine and there is nobody to ask. A duplicate the user has to scroll past
 * costs them two seconds; a real advert this app quietly deleted costs them a
 * job they never knew existed.
 *
 * So this module returns CLUSTER METADATA and nothing else. There is no
 * function here that takes a list of jobs and returns a shorter one, which
 * means "it merged them" is not a bug that can be introduced by a mistake -
 * only by writing a new function that deliberately does it.
 */
import { type Job } from '@cviper/core-types';

import { computeFingerprint, isDuplicateMatch } from './fingerprint';

/**
 * Adverts that look like the same role posted more than once.
 *
 * Always two or more ids. The first is the one the advert list arrived in, so
 * the UI can show it as the head of the group without the card reordering
 * between renders.
 */
export interface DuplicateCluster {
  readonly jobIds: readonly string[];
}

/**
 * Group adverts whose descriptions fingerprint within the duplicate band.
 *
 * Quadratic in the number of adverts, which is fine and stays fine: a search
 * returns at most 100 per provider, so the worst case is a few tens of
 * thousands of 64-bit comparisons - microseconds, on the submit path, once.
 * An index over fingerprint prefixes would be the answer at a hundred times
 * this size and pure overhead at this one.
 *
 * A job with no fingerprint - no description, or one too short to discriminate
 * - is never grouped with anything. Without that rule every advert with a blank
 * description would collapse into one enormous false cluster.
 */
export function findCrossPostClusters(jobs: readonly Job[]): DuplicateCluster[] {
  const fingerprints = jobs.map((job) => computeFingerprint(job.description));

  // Union-find, so three adverts of the same role become ONE group of three
  // rather than three overlapping pairs. `parent[i]` indexes into `jobs`.
  const parent = jobs.map((_, index) => index);

  function root(index: number): number {
    let current = index;
    while ((parent[current] ?? current) !== current) {
      const next = parent[current] ?? current;
      // Path halving: keeps the structure flat without a second pass.
      parent[current] = parent[next] ?? next;
      current = parent[current] ?? next;
    }
    return current;
  }

  for (let left = 0; left < jobs.length; left += 1) {
    const leftPrint = fingerprints[left] ?? null;
    if (leftPrint === null) continue;

    for (let right = left + 1; right < jobs.length; right += 1) {
      const rightPrint = fingerprints[right] ?? null;
      if (rightPrint === null) continue;

      if (isDuplicateMatch(leftPrint, rightPrint)) {
        const leftRoot = root(left);
        const rightRoot = root(right);
        if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
      }
    }
  }

  // Collected in arrival order, so both the groups and the ids inside them are
  // stable between renders.
  const groups = new Map<number, string[]>();
  for (let index = 0; index < jobs.length; index += 1) {
    const job = jobs[index];
    if (job === undefined) continue;
    if ((fingerprints[index] ?? null) === null) continue;

    const key = root(index);
    const existing = groups.get(key);
    if (existing === undefined) groups.set(key, [job.id]);
    else existing.push(job.id);
  }

  const clusters: DuplicateCluster[] = [];
  for (const jobIds of groups.values()) {
    // A group of one is not a duplicate, it is a job.
    if (jobIds.length > 1) clusters.push({ jobIds });
  }
  return clusters;
}
