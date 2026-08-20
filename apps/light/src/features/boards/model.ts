/**
 * Which boards a person searches, in which order, and any they added
 * themselves — with no React in sight.
 *
 * ============================================================================
 * TWO LAYERS: SHIPPED DEFAULTS UNDERNEATH, THE USER ON TOP.
 * ============================================================================
 * `job-boards.json` is the base layer and is never edited. What is stored for
 * the user is a small DIFF against it — which boards are off, what order they
 * are in, and which boards are theirs. Everything follows from that shape:
 *
 *   * `disabled` is a list of what is OFF, never a list of what is ON. A board
 *     added to a later release is therefore visible to somebody who switched
 *     three others off two versions ago. An allow-list would hide it for ever,
 *     silently, and the user would never know there was anything to miss.
 *
 *   * `disabled` is keyed by ID, so a board they switched off stays off when
 *     the shipped list grows. The two rules are opposite sides of the same
 *     coin and there is a test for each.
 *
 *   * `order` may name boards that no longer exist and may omit boards that
 *     now do. Both are normal — it is a preference, not a schema — so it is
 *     read as "these first, in this order", and everything else follows in
 *     shipped order.
 */
import {
  BoardTemplateSchema,
  KEYWORD_PLACEHOLDER,
  type BoardEncoding,
  type BoardTemplate,
} from '@cviper/core-types';
import { boardTemplateProblem } from '@cviper/job-apis';

/** Everything stored for one person. Only ever a diff against the shipped list. */
export interface BoardPreferences {
  /** Ids that are switched OFF. See the header for why it is this way round. */
  readonly disabled: readonly string[];
  /** Ids in the order the user dragged them into. May be partial or stale. */
  readonly order: readonly string[];
  /** Boards the user added. Same shape as a shipped one. */
  readonly custom: readonly BoardTemplate[];
}

export const NO_PREFERENCES: BoardPreferences = { disabled: [], order: [], custom: [] };

/** A shipped or custom board, with the user's answer applied. */
export interface Board extends BoardTemplate {
  readonly enabled: boolean;
  /** `true` when the user added this board themselves — only those can be deleted. */
  readonly userAdded: boolean;
}

/** What the add-a-board form holds while it is being typed. */
export interface CustomBoardDraft {
  readonly label: string;
  readonly urlTemplate: string;
  readonly encoding: BoardEncoding;
}

export const EMPTY_DRAFT: CustomBoardDraft = { label: '', urlTemplate: '', encoding: 'plus' };

export type CustomBoardErrors = Partial<Record<'label' | 'urlTemplate', string>>;

// ── Merging ─────────────────────────────────────────────────────────────────

/**
 * The list the buttons and the settings screen both render.
 *
 * A custom board whose id collides with a shipped one is DROPPED rather than
 * allowed to shadow it. Only a hand-edited store can produce that, and letting
 * a file on disk redefine where the "LinkedIn" button goes is not something
 * this app should make possible.
 */
export function mergeBoards(
  shipped: readonly BoardTemplate[],
  preferences: BoardPreferences,
): readonly Board[] {
  const shippedIds = new Set(shipped.map((board) => board.id));
  const disabled = new Set(preferences.disabled);

  const all: Board[] = [
    ...shipped.map((board) => ({ ...board, enabled: !disabled.has(board.id), userAdded: false })),
    ...preferences.custom
      .filter((board) => !shippedIds.has(board.id))
      .map((board) => ({ ...board, enabled: !disabled.has(board.id), userAdded: true })),
  ];

  const byId = new Map(all.map((board) => [board.id, board]));
  const ordered: Board[] = [];
  const placed = new Set<string>();

  for (const id of preferences.order) {
    const board = byId.get(id);
    if (board === undefined || placed.has(id)) continue;
    ordered.push(board);
    placed.add(id);
  }

  for (const board of all) {
    if (!placed.has(board.id)) ordered.push(board);
  }

  return ordered;
}

// ── Changing ────────────────────────────────────────────────────────────────

export function setBoardEnabled(
  preferences: BoardPreferences,
  id: string,
  enabled: boolean,
): BoardPreferences {
  const without = preferences.disabled.filter((entry) => entry !== id);
  return { ...preferences, disabled: enabled ? without : [...without, id] };
}

/**
 * Move one board one place.
 *
 * Writes the WHOLE order out rather than a partial one, because a partial
 * order is ambiguous the moment the shipped list changes underneath it. At
 * either end this returns the preferences unchanged — the buttons that would
 * call it are disabled, and a no-op is the honest answer if one is pressed.
 */
export function moveBoard(
  preferences: BoardPreferences,
  boards: readonly Board[],
  id: string,
  direction: 'up' | 'down',
): BoardPreferences {
  const order = boards.map((board) => board.id);
  const from = order.indexOf(id);
  const to = direction === 'up' ? from - 1 : from + 1;

  if (from === -1 || to < 0 || to >= order.length) return preferences;

  const moved = [...order];
  const [taken] = moved.splice(from, 1);
  moved.splice(to, 0, taken ?? id);

  return { ...preferences, order: moved };
}

export function addCustomBoard(
  preferences: BoardPreferences,
  board: BoardTemplate,
): BoardPreferences {
  return { ...preferences, custom: [...preferences.custom, board] };
}

/**
 * Delete a board the user added, and every preference attached to it.
 *
 * The disabled flag and the place in the order go with it. Leaving them behind
 * would mean adding a board back later and finding it already switched off for
 * reasons nobody can see.
 */
export function removeCustomBoard(preferences: BoardPreferences, id: string): BoardPreferences {
  return {
    disabled: preferences.disabled.filter((entry) => entry !== id),
    order: preferences.order.filter((entry) => entry !== id),
    custom: preferences.custom.filter((board) => board.id !== id),
  };
}

// ── The add-a-board form ────────────────────────────────────────────────────

/** `eFinancialCareers` -> `custom-efinancialcareers`. */
function slugify(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug === '' ? 'board' : slug;
}

/**
 * An id nothing else is using.
 *
 * Namespaced with `custom-` so a board the user names "Reed" can never occupy
 * the id a future shipped board would want.
 */
export function customBoardId(label: string, taken: readonly string[]): string {
  const base = `custom-${slugify(label)}`;
  if (!taken.includes(base)) return base;

  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!taken.includes(candidate)) return candidate;
  }

  return `${base}-${Date.now()}`;
}

/**
 * What is wrong with the draft. An empty object means nothing is.
 *
 * The template check is `boardTemplateProblem`, which builds the URL twice —
 * once with a location and once WITHOUT — so a template that only breaks when
 * the location box is empty is refused here rather than discovered by the user
 * three weeks later.
 */
export function validateCustomBoard(draft: CustomBoardDraft): CustomBoardErrors {
  const errors: CustomBoardErrors = {};

  // A name that is already taken is NOT an error: `customBoardId` gives the
  // second one its own id. Refusing it would be the app telling somebody they
  // may not have two searches on the same site, which is a thing people do.
  if (draft.label.trim() === '') {
    errors.label = 'Give the board a name — it is what the button will say.';
  }

  const problem = boardTemplateProblem(draft.urlTemplate);
  if (problem !== null) errors.urlTemplate = problem;

  return errors;
}

/** The board this draft would save as, or `null` if it may not be saved. */
export function customBoardFrom(
  draft: CustomBoardDraft,
  taken: readonly string[],
): BoardTemplate | null {
  if (Object.keys(validateCustomBoard(draft)).length > 0) return null;

  return {
    id: customBoardId(draft.label, taken),
    label: draft.label.trim(),
    urlTemplate: draft.urlTemplate.trim(),
    encoding: draft.encoding,
  };
}

// ── Reading the store ───────────────────────────────────────────────────────

function stringsOf(raw: unknown): readonly string[] {
  return Array.isArray(raw)
    ? raw.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

/**
 * Read whatever came out of the store, and never throw.
 *
 * Rebuilt field by field rather than cast, so a key written by a future version
 * is dropped here instead of travelling on inside the app's state.
 *
 * ONE BAD CUSTOM BOARD LOSES THAT BOARD, NOT THE LIST — deliberately different
 * from `parseBoardTemplates`, which is all-or-nothing because it reads the file
 * WE ship and a half-good one there is a release that should not go out. This
 * reads a file on the user's disk, where losing four working boards because a
 * fifth is malformed is the worse answer.
 */
export function parseBoardPreferences(raw: unknown): BoardPreferences {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return NO_PREFERENCES;

  const record = raw as Record<string, unknown>;
  const rawCustom = record['custom'];

  const custom = (Array.isArray(rawCustom) ? rawCustom : [])
    .map((entry) => BoardTemplateSchema.safeParse(entry))
    .filter((parsed) => parsed.success)
    .map((parsed) => parsed.data)
    // A board with no `{keyword}` cannot search for anything. It can only get
    // here by hand-editing, and it is not worth rendering a button for.
    .filter((board) => board.urlTemplate.includes(KEYWORD_PLACEHOLDER));

  return {
    disabled: stringsOf(record['disabled']),
    order: stringsOf(record['order']),
    custom,
  };
}
