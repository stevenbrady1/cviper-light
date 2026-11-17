/**
 * The job boards this build ships with.
 *
 * ============================================================================
 * THE LIST IS DATA, AND THIS IS THE ONLY PLACE IT IS READ.
 * ============================================================================
 * `src/config/job-boards.json` is the shipped list. It is the DEFAULT layer and
 * nothing else: the user's own enable/disable, order and custom boards are an
 * overlay on top of it (`model.ts`), so a board added to this file in a later
 * release turns up for everybody — including somebody who has already switched
 * three others off — while a board they switched off stays off.
 *
 * ============================================================================
 * A MALFORMED SHIPPED FILE DEGRADES; IT DOES NOT WHITE-SCREEN
 * ============================================================================
 * A `throw` at module scope here would take the whole application down at
 * import time, and the thing that would be broken is a row of buttons. So a bad
 * file leaves `SHIPPED_BOARDS` empty and `KeylessBar` says so, and
 * `defaults.test.ts` is what makes sure a bad file cannot be released: it
 * asserts `SHIPPED_BOARDS_PROBLEM` is `null` and that the United Kingdom's nine
 * ids are present, in order. The guard is in the test, where a human sees it,
 * rather than in a crash the user sees.
 *
 * ============================================================================
 * A BOARD IS FOR SOME COUNTRIES, OR FOR ALL OF THEM (L-422)
 * ============================================================================
 * An entry names the countries it is for; one that names none is for everywhere.
 * A person is offered the boards for the country they search in
 * (`shippedBoardsFor`). Each country's board has its OWN id, so switching one
 * country's Indeed off says nothing about another's, and the United Kingdom's
 * ids are the ones every existing choice is stored against.
 *
 * A board is listed for a country only if its address was PROVED there:
 * `shippedBoards.proved.contract.test.ts` holds the file to that table, both
 * ways. Somebody who has not chosen a country, or whose country is not on the
 * list, gets the boards that work everywhere.
 */
import { parseShippedBoards, type ShippedBoard } from '@cviper/core-types';

import rawBoards from '../../config/job-boards.json';

import { mergeBoards, type Board, type BoardPreferences } from './model';

const parsed = parseShippedBoards(rawBoards);

/** Every shipped board, for every country, in the order they are meant to appear. */
export const SHIPPED_BOARDS: readonly ShippedBoard[] = parsed.ok ? parsed.value : [];

/** Why the shipped file could not be read, or `null`. Asserted `null` by a test. */
export const SHIPPED_BOARDS_PROBLEM: string | null = parsed.ok ? null : parsed.error;

/** The built-in boards for one country. `null`, or a country not listed: the worldwide ones. */
export function shippedBoardsFor(country: string | null): readonly ShippedBoard[] {
  return SHIPPED_BOARDS.filter(
    (board) =>
      board.countries === undefined || (country !== null && board.countries.includes(country)),
  );
}

/** What a person is offered there: that country's boards, with their own choices on top. */
export function boardsFor(country: string | null, preferences: BoardPreferences): readonly Board[] {
  return mergeBoards(shippedBoardsFor(country), preferences);
}
