// @vitest-environment jsdom
/**
 * Whether the welcome has been seen — one boolean, kept the same way every
 * other disposable preference in this app is kept.
 *
 * jsdom, because the whole module is `localStorage` and the interesting cases
 * are the ones where storage misbehaves.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WELCOME_STORAGE_KEY, forgetWelcome, hasSeenWelcome, markWelcomeSeen } from './store';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('remembering the welcome', () => {
  it('has not been seen on a brand new machine', () => {
    expect(hasSeenWelcome()).toBe(false);
  });

  it('has been seen once it is marked', () => {
    markWelcomeSeen();
    expect(hasSeenWelcome()).toBe(true);
  });

  it('can be forgotten, so Settings can show it again', () => {
    markWelcomeSeen();
    forgetWelcome();

    expect(hasSeenWelcome()).toBe(false);
  });

  it('negative: a value nobody recognises counts as not seen', () => {
    // A hand-edited or half-written value must not be read as consent to hide
    // the only explanation of what this app does.
    for (const raw of ['', 'maybe', '0', 'false', '{}']) {
      localStorage.setItem(WELCOME_STORAGE_KEY, raw);
      expect(hasSeenWelcome(), raw).toBe(false);
    }
  });

  it('negative: storage that will not answer counts as SEEN, not unseen', () => {
    // The one asymmetry in this file, and it is deliberate. If the flag cannot
    // be written, showing the welcome would show it on EVERY launch with a
    // dismiss button that never works — a trap. Not showing it costs a
    // first-time user one screen they can reopen from Settings.
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage is disabled');
    });

    expect(hasSeenWelcome()).toBe(true);
  });

  it('negative: a write that throws is swallowed rather than breaking the dismiss', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });

    expect(() => markWelcomeSeen()).not.toThrow();
  });

  it('boundary: marking twice is the same as marking once', () => {
    markWelcomeSeen();
    markWelcomeSeen();

    expect(hasSeenWelcome()).toBe(true);
  });
});
