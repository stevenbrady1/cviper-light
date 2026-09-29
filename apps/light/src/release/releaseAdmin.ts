/**
 * What `release-admin.yml` may do to a release (L-178). Pure: it decides, and
 * `runReleaseAdmin.ts` is the shell that asks `gh` and carries the decision out.
 *
 * ============================================================================
 * THREE ACTIONS, AND WHAT IS DELIBERATELY NOT ONE
 * ============================================================================
 *   set-prerelease    on a PUBLISHED release
 *   clear-prerelease  on a PUBLISHED release, which also makes it Latest
 *   delete-draft      on a DRAFT, keeping its git tag
 *
 * Publishing is not here and must not be added. The human review of a draft is
 * what caught the 0.3.0 draft going out with one line of notes; a workflow that
 * can publish is a workflow that skips that review.
 *
 * ============================================================================
 * THE REFUSALS
 * ============================================================================
 *   * The tag must be exactly `light-vX.Y.Z`. That keeps the permanent
 *     `updater` release — the one every installed copy reads — out of reach,
 *     and makes a typed space or a bare `0.3.0` a clear refusal instead of a
 *     "release not found" that reads as though the release were missing.
 *   * No release, or TWO releases carrying the tag: refused, rather than
 *     acting on whichever one `gh` happens to resolve.
 *   * A draft is never edited, so no edit here can publish one.
 *   * A published release is never deleted: it is somebody's download.
 *   * `clear-prerelease` makes the release Latest, so it is refused while a
 *     NEWER full (non-pre-release) version is published — that would point the
 *     "Latest" badge backwards.
 */

export const ADMIN_ACTIONS = ['set-prerelease', 'clear-prerelease', 'delete-draft'] as const;
export type AdminAction = (typeof ADMIN_ACTIONS)[number];

/** A release as `gh release list --json tagName,isDraft,isPrerelease` prints it. */
export interface ReleaseRow {
  readonly tagName: string;
  readonly isDraft: boolean;
  readonly isPrerelease: boolean;
}

export type AdminPlan =
  | { readonly kind: 'run'; readonly args: readonly string[]; readonly summary: string }
  | { readonly kind: 'noop'; readonly summary: string }
  | { readonly kind: 'refuse'; readonly why: string };

const RELEASE_TAG = /^light-v(\d+)\.(\d+)\.(\d+)$/;

type Version = readonly [number, number, number];

function versionOf(tag: string): Version | null {
  const match = RELEASE_TAG.exec(tag);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function isNewer(a: Version, b: Version): boolean {
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return (a[index] ?? 0) > (b[index] ?? 0);
  }
  return false;
}

function isAdminAction(value: string): value is AdminAction {
  return (ADMIN_ACTIONS as readonly string[]).includes(value);
}

export function planReleaseAdmin(
  action: string,
  tag: string,
  releases: readonly ReleaseRow[],
): AdminPlan {
  if (!isAdminAction(action)) {
    return {
      kind: 'refuse',
      why: `'${action}' is not an action this workflow has. It can ${ADMIN_ACTIONS.join(', ')}; publishing a draft stays a human step.`,
    };
  }

  const version = versionOf(tag);
  if (version === null) {
    return {
      kind: 'refuse',
      why: `The tag was ${JSON.stringify(tag)}. It has to be exactly light-vX.Y.Z, for example light-v0.3.0 — never 'updater', a bare version, or anything with spaces.`,
    };
  }

  const matches = releases.filter((release) => release.tagName === tag);
  if (matches.length === 0) {
    return { kind: 'refuse', why: `No release carries the tag ${tag}.` };
  }
  if (matches.length > 1) {
    return {
      kind: 'refuse',
      why: `${matches.length} releases carry the tag ${tag}. Tidy this one by hand, so the wrong one is not changed.`,
    };
  }
  const release = matches[0] as ReleaseRow;

  if (action === 'delete-draft') {
    if (!release.isDraft) {
      return {
        kind: 'refuse',
        why: `${tag} is published, and a published release is somebody's download. Only drafts are deleted here.`,
      };
    }
    return {
      kind: 'run',
      args: ['release', 'delete', tag, '--yes'],
      summary: `Deleted the draft release ${tag}. Its git tag is kept.`,
    };
  }

  if (release.isDraft) {
    return {
      kind: 'refuse',
      why: `${tag} is still a draft. Drafts are not edited here, so nothing this workflow does can publish one — publish it by hand first.`,
    };
  }

  if (action === 'set-prerelease') {
    if (release.isPrerelease) {
      return { kind: 'noop', summary: `${tag} is already a pre-release. Nothing was changed.` };
    }
    return {
      kind: 'run',
      args: ['release', 'edit', tag, '--prerelease'],
      summary: `${tag} is now a pre-release.`,
    };
  }

  const newer = releases.filter((other) => {
    const otherVersion = versionOf(other.tagName);
    return (
      !other.isDraft &&
      !other.isPrerelease &&
      otherVersion !== null &&
      isNewer(otherVersion, version)
    );
  });
  if (newer.length > 0) {
    return {
      kind: 'refuse',
      why: `${newer.map((other) => other.tagName).join(', ')} is newer and already a full release, so making ${tag} Latest would point the badge backwards.`,
    };
  }
  return {
    kind: 'run',
    args: ['release', 'edit', tag, '--prerelease=false', '--latest'],
    summary: `${tag} is no longer a pre-release and is now Latest.`,
  };
}

/**
 * The listing `gh` printed. Throws on anything else: an unreadable listing read
 * as "no releases" would turn every request into a confident "No release
 * carries the tag".
 */
export function parseReleaseRows(raw: string): ReleaseRow[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`gh printed something that is not a list of releases: ${raw.slice(0, 200)}`);
  }
  return parsed.map((entry) => {
    const record = entry as Partial<Record<keyof ReleaseRow, unknown>>;
    if (
      typeof record.tagName !== 'string' ||
      typeof record.isDraft !== 'boolean' ||
      typeof record.isPrerelease !== 'boolean'
    ) {
      throw new Error(
        `gh printed a release without tagName, isDraft and isPrerelease: ${JSON.stringify(entry)}`,
      );
    }
    return { tagName: record.tagName, isDraft: record.isDraft, isPrerelease: record.isPrerelease };
  });
}
