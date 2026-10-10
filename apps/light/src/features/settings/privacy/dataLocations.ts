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
import { CONSENT_STORE_FILE } from '../../analysis/consent';
import { BOARD_STORE_FILE } from '../../boards/port';
import { WORKFLOW_STORE_FILE } from '../../tailor/persistence';
import { DB_URL, SAFETY_COPY_SUFFIX } from '../../../db/constants';

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
    // L-199: a working copy, so a restart does not lose a draft. Not in a
    // backup — what the user keeps is saved to the application as a document.
    what: 'Tailoring you have not saved yet: the advert, the draft CV, its review and the letter, for each job',
    where: `the same database file, on this computer only — an export always leaves it out`,
    erasedBy: 'database',
  },
  {
    // L-227: made on the first launch after an update that changes how the
    // data is stored, before the change runs. One copy, replaced each time.
    what: 'A safety copy of that database, made just before an update changes how it is stored, so an update that goes wrong cannot lose your data',
    where: `${DB_FILENAME}${SAFETY_COPY_SUFFIX} in the same data folder — only ever one, replaced at the next such update`,
    erasedBy: 'database',
  },
  {
    // L-150: a service the user adds is saved as its address and its key in
    // ONE entry, so the key can only go to that address.
    what: 'Your API keys, and the address of an AI service you added, kept with its key',
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
    what: 'Which AI providers you agreed to send your CV to',
    where: `${CONSENT_STORE_FILE} in the same data folder`,
    erasedBy: 'preferences',
  },
  {
    what: 'Which job you were last tailoring for, so it can be offered back — its id only, no text',
    where: `${WORKFLOW_STORE_FILE} in the same data folder`,
    erasedBy: 'preferences',
  },
  {
    what: 'Small conveniences: your last search, which free job feeds you ticked, which AI model each service uses, today’s request count, and that you have seen the introduction',
    where: 'this app’s own browser storage, which no other program reads',
    erasedBy: 'preferences',
  },
];
