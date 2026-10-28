/**
 * Changelog fragments (L-303): one file per change, gathered at release time.
 *
 * ============================================================================
 * WHY THE CHANGELOG IS NOT EDITED BY HAND ANY MORE
 * ============================================================================
 * Every pull request used to add its entry at the TOP of the same
 * `## [Unreleased]` section of `CHANGELOG.md`. Two PRs open at once therefore
 * always edited the same lines, and git cannot merge two insertions at one
 * spot: 8 of the 27 PRs from #370 to #419 conflicted, and 8 of the 10 conflict
 * fixes were in this one file. Each fix cost a local verify and another full
 * CI run.
 *
 * Now a PR adds `changes/unreleased/L-NNN.md`. Two PRs add two different files,
 * which never conflict. At release time `releaseChangelog.ts` calls
 * `foldRelease` to write them into `CHANGELOG.md` under the new version and
 * deletes them. `changes-unreleased.contract.test.ts` keeps the Unreleased
 * block of `CHANGELOG.md` free of entries, so the old habit fails the build
 * instead of quietly coming back.
 *
 * A fragment looks like this:
 *
 *     ---
 *     section: Fixed
 *     ---
 *
 *     - Screen readers now read status messages out (L-299). ...
 *
 * This module is pure — strings in, strings out — so every rule is tested
 * offline. The file reading, writing and deleting is in `releaseChangelog.ts`.
 */

/** Keep a Changelog's sections, in the order a release lists them. */
export const SECTIONS = ['Added', 'Changed', 'Fixed', 'Security'] as const;
export type Section = (typeof SECTIONS)[number];

export interface Fragment {
  /** The file name, for error messages: `L-301.md`. */
  readonly file: string;
  readonly lNumber: number;
  readonly section: Section;
  /** The bullet lines, as they will appear in `CHANGELOG.md`. */
  readonly body: string;
}

const FILE_NAME = /^L-([1-9]\d*)\.md$/u;
const UNRELEASED_HEADING = '## [Unreleased]';
/** A line that would make the Unreleased block hold an entry. */
const ENTRY_LINE = /^(#{3,}\s|[-*+]\s|\d+\.\s)/u;

function isSection(value: string): value is Section {
  return (SECTIONS as readonly string[]).includes(value);
}

/** Read one fragment. Throws, naming the file, on anything it will not fold. */
export function parseFragment(file: string, text: string): Fragment {
  const name = FILE_NAME.exec(file);
  if (name === null) {
    throw new Error(`${file}: the file name must be L-NNN.md, the work item's own number`);
  }
  const lNumber = Number(name[1]);
  const lines = text.replace(/\r\n/gu, '\n').split('\n');

  if (lines[0] !== '---') {
    throw new Error(`${file}: must start with front matter: "---", "section: <name>", "---"`);
  }
  const close = lines.indexOf('---', 1);
  if (close === -1) throw new Error(`${file}: the front matter is never closed with "---"`);

  let section: Section | null = null;
  for (const line of lines.slice(1, close)) {
    const field = /^(\w+):\s*(.*)$/u.exec(line);
    if (field === null || field[1] !== 'section') {
      throw new Error(`${file}: "${line}" — the front matter holds one field, "section"`);
    }
    const value = field[2] ?? '';
    if (!isSection(value)) {
      throw new Error(`${file}: section "${value}" must be one of ${SECTIONS.join(', ')}`);
    }
    section = value;
  }
  if (section === null) throw new Error(`${file}: the front matter has no "section"`);

  const bodyLines = lines.slice(close + 1).filter((line) => line.trim() !== '');
  if (bodyLines.length === 0) throw new Error(`${file}: there is no entry under the front matter`);
  const notBullet = bodyLines.find((line) => !line.startsWith('- '));
  if (notBullet !== undefined) {
    throw new Error(`${file}: "${notBullet}" — every line is a "- " bullet, one entry per line`);
  }
  const body = bodyLines.join('\n');
  if (!new RegExp(`\\bL-${lNumber}\\b`, 'u').test(body)) {
    throw new Error(`${file}: the entry never names L-${lNumber}, the number in its file name`);
  }

  return { file, lNumber, section, body };
}

/** Where the Unreleased block starts and ends, as line indexes; null if absent. */
function unreleasedBlock(lines: readonly string[]): { start: number; end: number } | null {
  const start = lines.indexOf(UNRELEASED_HEADING);
  if (start === -1) return null;
  let end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  if (end === -1)
    end = lines.findIndex((line, index) => index > start && /^\[[^\]]+\]:/u.test(line));
  return { start, end: end === -1 ? lines.length : end };
}

/**
 * Every line under `## [Unreleased]` that is an entry rather than prose.
 * Empty means the block is clean.
 */
export function unreleasedProblems(changelog: string): string[] {
  const lines = changelog.split('\n');
  const block = unreleasedBlock(lines);
  if (block === null) return [`there is no "${UNRELEASED_HEADING}" heading`];
  const problems: string[] = [];
  for (let index = block.start + 1; index < block.end; index += 1) {
    const line = lines[index] ?? '';
    if (ENTRY_LINE.test(line)) problems.push(`line ${index + 1}: "${line}"`);
  }
  return problems;
}

/** The release's heading and sections, newest entry first in each section. */
export function renderRelease(
  fragments: readonly Fragment[],
  version: string,
  date: string,
): string {
  const parts = [`## [${version}] — ${date}`, ''];
  for (const section of SECTIONS) {
    const entries = fragments
      .filter((fragment) => fragment.section === section)
      .sort((a, b) => b.lNumber - a.lNumber);
    if (entries.length === 0) continue;
    parts.push(`### ${section}`, '', ...entries.map((fragment) => fragment.body), '');
  }
  return parts.join('\n');
}

function parseVersion(version: string): [number, number, number] | null {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.exec(version);
  return match === null ? null : [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isNewer(next: readonly number[], previous: readonly number[]): boolean {
  for (let index = 0; index < 3; index += 1) {
    const a = next[index] ?? 0;
    const b = previous[index] ?? 0;
    if (a !== b) return a > b;
  }
  return false;
}

function isRealDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(date);
}

/**
 * `CHANGELOG.md` with the fragments written in as release `version`.
 *
 * Refuses, rather than guessing, when there is nothing to release, when the
 * version or date is malformed or the version is not newer than the last one,
 * when `## [Unreleased]` already holds entries (they would be silently left
 * behind or silently merged), and when the compare links cannot be moved on.
 */
export function foldRelease(
  changelog: string,
  fragments: readonly Fragment[],
  version: string,
  date: string,
): string {
  if (fragments.length === 0) {
    throw new Error('nothing to release: changes/unreleased/ holds no fragments');
  }
  const seen = new Set<number>();
  for (const fragment of fragments) {
    if (seen.has(fragment.lNumber)) throw new Error(`L-${fragment.lNumber} twice in one release`);
    seen.add(fragment.lNumber);
  }

  const next = parseVersion(version);
  if (next === null) throw new Error(`version "${version}" must be MAJOR.MINOR.PATCH, e.g. 0.11.1`);
  if (!isRealDate(date)) throw new Error(`date "${date}" must be a real day as YYYY-MM-DD`);

  const problems = unreleasedProblems(changelog);
  if (problems.length > 0) {
    throw new Error(
      `## [Unreleased] in CHANGELOG.md already holds entries — move them into fragments first:\n  ${problems.join('\n  ')}`,
    );
  }

  const lines = changelog.split('\n');
  const linkIndex = lines.findIndex((line) => line.startsWith('[Unreleased]: '));
  const link = /^\[Unreleased\]: (.+)\/compare\/light-v(\S+)\.\.\.main$/u.exec(
    lines[linkIndex] ?? '',
  );
  if (link === null) {
    throw new Error(
      'there is no "[Unreleased]: <repo>/compare/light-vX.Y.Z...main" link to move on',
    );
  }
  const [, base, previousText = ''] = link;
  const previous = parseVersion(previousText);
  if (previous === null || !isNewer(next, previous)) {
    throw new Error(`version ${version} must be newer than ${previousText}, the last release`);
  }

  lines.splice(
    linkIndex,
    1,
    `[Unreleased]: ${base}/compare/light-v${version}...main`,
    `[${version}]: ${base}/compare/light-v${previousText}...light-v${version}`,
  );

  const block = unreleasedBlock(lines);
  if (block === null) throw new Error(`there is no "${UNRELEASED_HEADING}" heading`);
  lines.splice(block.end, 0, ...renderRelease(fragments, version, date).split('\n'));
  return lines.join('\n');
}
