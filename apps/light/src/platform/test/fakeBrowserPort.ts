import { err, ok } from '@cviper/core-types';

import { isOpenableUrl, type BrowserError, type BrowserPort } from '../browser';

/**
 * A `BrowserPort` that records what it was asked to open instead of opening it.
 *
 * It applies the REAL scheme check (`isOpenableUrl`) rather than accepting
 * anything, so a test that drives a link through this fake proves the app would
 * have been allowed to open it — a fake that accepted everything would pass
 * happily while the app refused the link in front of a user.
 */

export interface FakeBrowserPort extends BrowserPort {
  /** Every URL handed over, in order. */
  readonly opened: () => readonly string[];
  /** Make the next open fail, the way a machine with no browser would. */
  readonly failNext: () => void;
}

const FAILURE: BrowserError = {
  message: 'This computer did not open the link. Check that a default browser is set.',
};

export function createFakeBrowserPort(): FakeBrowserPort {
  const urls: string[] = [];
  let failing = false;

  return {
    opened: () => urls,
    failNext: () => {
      failing = true;
    },

    async open(url) {
      if (!isOpenableUrl(url)) {
        return err({ message: 'That link could not be opened because it is not a web address.' });
      }
      if (failing) {
        failing = false;
        return err(FAILURE);
      }
      urls.push(url);
      return ok(undefined);
    },
  };
}
