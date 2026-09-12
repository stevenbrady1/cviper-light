// @vitest-environment jsdom
/**
 * The launch-check preference: one boolean, and the two ways it can go wrong.
 *
 * The interesting behaviour is not "it stores a value". It is what happens when
 * there is NO value and when storage cannot be read at all — because those are
 * the states most installs are actually in, and resolving either of them the
 * wrong way silently changes whether the app talks to the network.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LOCAL_STORAGE_PREFIX } from '../erase/port';

import {
  UPDATE_CHECK_STORAGE_KEY,
  setUpdateCheckOnLaunch,
  updateCheckOnLaunchEnabled,
} from './launchCheck';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('the key itself', () => {
  it('is under the erase prefix, so "delete everything" removes it', () => {
    // Not a style rule: a preference left behind by "delete everything" makes
    // that screen's promise false. `localStorageKeys.contract.test.ts` fails
    // the build over it; this says the same thing where it is readable.
    expect(UPDATE_CHECK_STORAGE_KEY.startsWith(LOCAL_STORAGE_PREFIX)).toBe(true);
  });
});

describe('with nothing stored', () => {
  it('is ON — a machine that has never been asked gets the default', () => {
    expect(updateCheckOnLaunchEnabled()).toBe(true);
  });
});

describe('once the user has chosen', () => {
  it('remembers OFF', () => {
    setUpdateCheckOnLaunch(false);
    expect(updateCheckOnLaunchEnabled()).toBe(false);
  });

  it('remembers ON again after being switched off', () => {
    setUpdateCheckOnLaunch(false);
    setUpdateCheckOnLaunch(true);
    expect(updateCheckOnLaunchEnabled()).toBe(true);
  });
});

describe('when the answer is not one this version understands', () => {
  it('boundary: an unrecognised value is the default, not "off"', () => {
    // A value written by a future version must not silently stop this one
    // checking. Only an explicit "off" switches it off.
    localStorage.setItem(UPDATE_CHECK_STORAGE_KEY, 'sometimes');
    expect(updateCheckOnLaunchEnabled()).toBe(true);
  });

  it('boundary: an empty value is the default', () => {
    localStorage.setItem(UPDATE_CHECK_STORAGE_KEY, '');
    expect(updateCheckOnLaunchEnabled()).toBe(true);
  });
});

describe('when storage cannot be used at all', () => {
  it('negative: a reading failure resolves to the DEFAULT, not to off', () => {
    // Resolving this to "off" would mean a user who never touched the setting
    // silently stopped receiving updates, and never found out. That is the
    // exact failure the launch check exists to prevent.
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage is disabled');
    });

    expect(updateCheckOnLaunchEnabled()).toBe(true);
  });

  it('negative: a writing failure does not throw at the caller', () => {
    // The switch still moves on screen — that is component state. It simply
    // will not survive a restart, and there is nothing useful to say about it.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage is full');
    });

    expect(() => setUpdateCheckOnLaunch(false)).not.toThrow();
  });
});
