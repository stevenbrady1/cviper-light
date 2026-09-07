/**
 * Where every byte CViper Light keeps actually lives, in plain words.
 *
 * Read by two screens: the privacy notice (so a user can see it) and the
 * "delete everything" confirmation (so the user knows what is about to go).
 * One list, so the two can never disagree about what exists.
 *
 * `erasedBy` names the step of `runErase` that removes it. Every location has
 * one — a location nothing erases would make "delete everything" a lie, and
 * `EraseEverything.test.tsx` checks the claim.
 */
import { BOARD_STORE_FILE } from '../../boards/port';
import { DB_URL } from '../../../db/constants';

export type EraseStep = 'database' | 'keys' | 'preferences';

export interface DataLocation {
  /** What it is, as the user would name it. */
  readonly what: string;
  /** Where it is on this computer. */
  readonly where: string;
  readonly erasedBy: EraseStep;
}

/** `sqlite:cviper.db` → `cviper.db`: the filename, not the driver prefix. */
export const DB_FILENAME = DB_URL.replace(/^sqlite:/, '');

export const DATA_LOCATIONS: readonly DataLocation[] = [
  {
    what: 'Your jobs, applications, CV text and every analysis',
    where: `one database file, ${DB_FILENAME}, in this app’s data folder for your user account`,
    erasedBy: 'database',
  },
  {
    what: 'Your API keys',
    where:
      'this device’s credential store (the Keychain on an iPhone, iPad or Mac; Credential Manager on Windows; the Secret Service on Linux), one entry per key',
    erasedBy: 'keys',
  },
  {
    what: 'Which job boards you enabled and how you ordered them',
    where: `${BOARD_STORE_FILE} in the same data folder`,
    erasedBy: 'preferences',
  },
  {
    what: 'Small conveniences: your last search, today’s request count, and that you have seen the introduction',
    where: 'this app’s own browser storage, which no other program reads',
    erasedBy: 'preferences',
  },
];
