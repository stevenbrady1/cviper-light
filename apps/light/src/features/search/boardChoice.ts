/**
 * Tick job boards, press "Also open in N boards", and each ticked board opens
 * in the browser with the search already filled in (L-219 part 4, owner
 * request 2026-10-14). Until L-329 the Search button did this as well as
 * searching; now Search only searches here, and opening the boards is its own
 * button. A saved search's Run still does both.
 *
 * ============================================================================
 * ONE DELIBERATE ACTION
 * ============================================================================
 * Nothing opens on its own. The boards open only when the user presses that
 * button (or runs a saved search), one browser tab per ticked board, in the
 * boards are listed (Settings → Job boards decides that order), each through
 * the same `buildBoardUrl` the single-board buttons used — so a board's link
 * carries exactly the filters it always did, and nothing is added to it.
 *
 * ============================================================================
 * REMEMBERED, AND FORGIVING ABOUT WHAT CHANGED SINCE
 * ============================================================================
 * The ticked ids live in `localStorage` under the app prefix, so "Delete
 * everything" clears them (`erase/localStorageKeys.contract.test.ts`). First
 * use ticks nothing. A board switched off or deleted in Settings since simply
 * drops out: it is never offered, never opened, and the next write leaves it
 * behind. Storage that cannot be read or holds nonsense reads as nothing
 * ticked — the cost of that is one tick, never a surprise tab.
 */
import { buildBoardUrl, type BrowserSearchInput } from '@cviper/job-apis';

import { type Board } from '../boards/model';
import { type BrowserPort } from '../../platform/browser';

export const BOARD_CHOICE_STORAGE_KEY = 'cviper.light.searchBoards';

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** The remembered ids, or none. Never throws. */
export function readBoardChoice(): string[] {
  try {
    const raw = storage()?.getItem(BOARD_CHOICE_STORAGE_KEY) ?? null;
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === 'string');
  } catch {
    return [];
  }
}

function writeBoardChoice(ids: readonly string[]): void {
  try {
    storage()?.setItem(BOARD_CHOICE_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Not remembered this time; the ticks on screen still work.
  }
}

/** The ticked boards that still exist and are switched on, in the board list's order. */
export function tickedBoards(boards: readonly Board[], ids: readonly string[]): Board[] {
  const wanted = new Set(ids);
  return boards.filter((board) => board.enabled && wanted.has(board.id));
}

/**
 * Tick or untick one board and remember the result. Ids of boards that are
 * gone or switched off are dropped here, silently.
 */
export function toggleBoard(
  ids: readonly string[],
  id: string,
  on: boolean,
  boards: readonly Board[],
): string[] {
  const next = new Set(ids);
  if (on) next.add(id);
  else next.delete(id);
  const kept = tickedBoards(boards, [...next]).map((board) => board.id);
  writeBoardChoice(kept);
  return kept;
}

/**
 * Tick exactly these boards and remember them — a saved search being run
 * (L-309). Ids of boards that are gone or switched off are dropped, as above.
 */
export function chooseBoards(ids: readonly string[], boards: readonly Board[]): string[] {
  const kept = tickedBoards(boards, ids).map((board) => board.id);
  writeBoardChoice(kept);
  return kept;
}

/**
 * What the button that opens the boards says: the count of tabs it will open
 * (L-329). Search itself only searches here; this is the second, separate
 * action, so its name says "also".
 */
export function openBoardsLabel(boardCount: number): string {
  if (boardCount === 0) return 'Also open in job boards';
  return `Also open in ${boardCount} ${boardCount === 1 ? 'board' : 'boards'}`;
}

/** Why that button cannot be pressed, or `null` when it can. */
export function openBoardsDisabledReason(boardCount: number): string | null {
  if (boardCount > 0) return null;
  return 'Tick a job board above to open this search in your browser too.';
}

/**
 * Open each board once, in order. A board that will not open does not stop
 * the rest; its name comes back so the screen can say which one it was.
 */
export async function openBoards(
  browser: BrowserPort,
  boards: readonly Board[],
  input: BrowserSearchInput,
): Promise<string[]> {
  const failed: string[] = [];
  for (const board of boards) {
    const opened = await browser.open(buildBoardUrl(board, input));
    if (!opened.ok) failed.push(board.label);
  }
  return failed;
}
