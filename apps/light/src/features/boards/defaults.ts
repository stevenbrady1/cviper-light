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
 * asserts `SHIPPED_BOARDS_PROBLEM` is `null` and that the nine ids are
 * present, in order. The guard is in the test, where a human sees it, rather
 * than in a crash the user sees.
 */
import { parseBoardTemplates, type BoardTemplate } from '@cviper/core-types';

import rawBoards from '../../config/job-boards.json';

const parsed = parseBoardTemplates(rawBoards);

/** The shipped boards, in the order they are meant to appear. */
export const SHIPPED_BOARDS: readonly BoardTemplate[] = parsed.ok ? parsed.value : [];

/** Why the shipped file could not be read, or `null`. Asserted `null` by a test. */
export const SHIPPED_BOARDS_PROBLEM: string | null = parsed.ok ? null : parsed.error;
