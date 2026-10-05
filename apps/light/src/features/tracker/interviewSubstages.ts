/**
 * The user's interview sub-stages — their rules, with no React and no storage.
 *
 * ============================================================================
 * WHAT A SUB-STAGE IS
 * ============================================================================
 * A name the user hangs on a card that is already in Interviewing: "HR Screen",
 * "Technical Test", "Panel Round", "Final". It is not a sixth column and not a
 * new status — the five statuses are frozen by contract with the cloud app (see
 * `entities.ts`). Every function here takes a list and returns a NEW one; the
 * caller decides what to save.
 *
 * ============================================================================
 * THE RULES
 * ============================================================================
 *   * A name is trimmed, never empty, and at most `INTERVIEW_SUBSTAGE_NAME_MAX`
 *     characters.
 *   * Names are unique ignoring case and surrounding space. Two cards in
 *     "Final" and "final" would be a typo the user could never see.
 *   * At most `INTERVIEW_SUBSTAGES_MAX` of them.
 *   * `position` is always 0..n-1 with no gaps, renumbered on every change, so
 *     a reorder is one save and an export is stable.
 *   * Removing one never deletes a card: it only takes the label off.
 */
import {
  INTERVIEW_SUBSTAGE_NAME_MAX,
  INTERVIEW_SUBSTAGES_MAX,
  err,
  ok,
  type Application,
  type InterviewSubstage,
  type Result,
} from '@cviper/core-types';

function renumbered(list: readonly InterviewSubstage[]): InterviewSubstage[] {
  return list.map((substage, index) => ({ ...substage, position: index }));
}

/** Case- and space-insensitive form, for the duplicate check only. */
function key(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * What is wrong with this name, in words the user can act on, or `null`.
 *
 * `exceptId` is the sub-stage being renamed, so keeping its own name (or only
 * changing its case) is not a clash with itself.
 */
function nameProblem(
  list: readonly InterviewSubstage[],
  name: string,
  exceptId: string | null,
): string | null {
  const trimmed = name.trim();

  if (trimmed === '') return 'Give the stage a name, for example “Technical Test”.';

  if (trimmed.length > INTERVIEW_SUBSTAGE_NAME_MAX) {
    return `That name is too long. Keep it to ${INTERVIEW_SUBSTAGE_NAME_MAX} characters or fewer.`;
  }

  if (list.some((substage) => substage.id !== exceptId && key(substage.name) === key(trimmed))) {
    return `You already have a stage called “${trimmed}”. Pick a different name.`;
  }

  return null;
}

export function addSubstage(
  list: readonly InterviewSubstage[],
  name: string,
  id: string,
): Result<InterviewSubstage[], string> {
  if (list.length >= INTERVIEW_SUBSTAGES_MAX) {
    return err(
      `You can have up to ${INTERVIEW_SUBSTAGES_MAX} interview stages. Remove one to add another.`,
    );
  }

  const problem = nameProblem(list, name, null);
  if (problem !== null) return err(problem);

  return ok(renumbered([...list, { id, name: name.trim(), position: list.length }]));
}

export function renameSubstage(
  list: readonly InterviewSubstage[],
  id: string,
  name: string,
): Result<InterviewSubstage[], string> {
  if (!list.some((substage) => substage.id === id)) {
    return err('That stage no longer exists.');
  }

  const problem = nameProblem(list, name, id);
  if (problem !== null) return err(problem);

  return ok(
    list.map((substage) => (substage.id === id ? { ...substage, name: name.trim() } : substage)),
  );
}

/**
 * Move one place. At either end, or for an unknown id, the list comes back
 * unchanged — the buttons that would call this are disabled there.
 */
export function moveSubstage(
  list: readonly InterviewSubstage[],
  id: string,
  direction: 'up' | 'down',
): InterviewSubstage[] {
  const from = list.findIndex((substage) => substage.id === id);
  const to = direction === 'up' ? from - 1 : from + 1;
  if (from === -1 || to < 0 || to >= list.length) return [...list];

  const moved = [...list];
  const [taken] = moved.splice(from, 1);
  if (taken !== undefined) moved.splice(to, 0, taken);
  return renumbered(moved);
}

export function removeSubstage(
  list: readonly InterviewSubstage[],
  id: string,
): InterviewSubstage[] {
  return renumbered(list.filter((substage) => substage.id !== id));
}

/**
 * Mirror, in memory, what `ON DELETE SET NULL` does in the database: every
 * card using the removed sub-stage loses the label and keeps everything else.
 * A card that did not use it comes back as the same object.
 */
export function clearSubstageFromApplications(
  applications: readonly Application[],
  removedId: string,
): Application[] {
  return applications.map((application) =>
    application.interview_substage_id === removedId
      ? { ...application, interview_substage_id: null }
      : application,
  );
}

/** The name of the sub-stage a card is in, or `null` if none, or it is gone. */
export function substageName(
  list: readonly InterviewSubstage[],
  id: string | null | undefined,
): string | null {
  if (id === null || id === undefined) return null;
  return list.find((substage) => substage.id === id)?.name ?? null;
}
