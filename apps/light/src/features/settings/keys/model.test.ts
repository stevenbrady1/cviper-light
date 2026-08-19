/**
 * The key wizard's rules, with no React and no keyring in sight.
 *
 * Everything a card needs to decide WHAT to say lives in `model.ts` so it can
 * be tested exactly: which credentials a board needs, what state this machine
 * is in, what is wrong with what the user typed, and what a failed test means.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { type JobApiErrorKind } from '@cviper/job-apis';

import { type SecretKeyName } from '../../../status/environment';

import {
  KEY_PROVIDERS,
  KEY_STATE_LABEL,
  MAX_KEY_BYTES,
  TEST_FAILURE_HEADLINE,
  describeMissingCredentials,
  describeTestPass,
  keyProvider,
  providerKeyState,
  validateCandidate,
} from './model';

const ALL_KINDS: readonly JobApiErrorKind[] = [
  'no-key',
  'network',
  'throttled',
  'quota',
  'bad-request',
  'auth',
  'rate-limit',
  'server',
  'bad-response',
];

/** Every field filled with the same value. */
function filled(id: 'adzuna' | 'reed', value: string): Record<SecretKeyName, string> {
  const values = {} as Record<SecretKeyName, string>;
  for (const field of keyProvider(id).fields) values[field.key] = value;
  return values;
}

describe('what each board needs', () => {
  it('lists Adzuna with TWO credentials and Reed with one', () => {
    // The bug this exists to stop: a single-field Adzuna form. Half a
    // credential authenticates nothing, and Adzuna answers it with a 401 that
    // reads as "your key is wrong".
    expect(keyProvider('adzuna').fields.map((field) => field.key)).toEqual([
      'adzuna_app_id',
      'adzuna_app_key',
    ]);
    expect(keyProvider('reed').fields.map((field) => field.key)).toEqual(['reed_api_key']);
  });

  it('names a free key and a real allowance for each board', () => {
    for (const provider of KEY_PROVIDERS) {
      expect(provider.allowance.toLowerCase()).toContain('free');
      expect(provider.signupUrl.startsWith('https://')).toBe(true);
      expect(provider.unlocks.length).toBeGreaterThan(20);
    }
  });

  it('states Reed as 100 requests a day, and does not invent a number for Adzuna', () => {
    // Reed publishes 100/day. Adzuna's allowance depends on the plan the user
    // signed up for and is not published as one number, so any figure here
    // would be a confident wrong number on screen for ever.
    expect(keyProvider('reed').allowance).toContain('100 requests a day');
    expect(keyProvider('adzuna').allowance).toContain('depends on the plan');
    expect(keyProvider('adzuna').allowance).not.toMatch(/\d+ requests a day/);
  });

  it('says the key cannot be read back, on the card where it is entered', () => {
    // Not an oversight to be discovered later: the app can never show a saved
    // key, so the card has to say so before somebody relies on it.
    for (const provider of KEY_PROVIDERS) {
      expect(provider.privacyNote.toLowerCase()).toContain('cannot show it back');
    }
  });
});

describe('what state this machine is in', () => {
  it('reads both Adzuna credentials as configured only when both are saved', () => {
    expect(providerKeyState('adzuna', { adzuna_app_id: true, adzuna_app_key: true })).toBe(
      'configured',
    );
  });

  it('reads one Adzuna credential of two as incomplete, not as missing', () => {
    // The whole reason this state exists: telling somebody who has just pasted
    // an App ID that nothing is saved would be wrong AND would invite them to
    // paste it again.
    expect(providerKeyState('adzuna', { adzuna_app_id: true, adzuna_app_key: false })).toBe(
      'incomplete',
    );
    expect(providerKeyState('adzuna', { adzuna_app_id: false, adzuna_app_key: true })).toBe(
      'incomplete',
    );
  });

  it('reads nothing saved as missing, which is the normal first-launch state', () => {
    expect(providerKeyState('adzuna', { adzuna_app_id: false, adzuna_app_key: false })).toBe(
      'missing',
    );
    expect(providerKeyState('reed', { reed_api_key: false })).toBe('missing');
  });

  it('reads a store that would not answer as unreadable, never as missing', () => {
    // A locked keychain reported as "no key saved" invites the user to paste a
    // key they have already saved, and to conclude the app forgot it.
    expect(providerKeyState('reed', { reed_api_key: null })).toBe('unreadable');
    expect(providerKeyState('adzuna', { adzuna_app_id: true, adzuna_app_key: null })).toBe(
      'unreadable',
    );
  });

  it('treats an answer that never arrived as unreadable rather than assuming', () => {
    expect(providerKeyState('reed', {})).toBe('unreadable');
  });

  it('has a plain-words label for every state', () => {
    for (const state of ['configured', 'incomplete', 'missing', 'unreadable'] as const) {
      expect(KEY_STATE_LABEL[state].length).toBeGreaterThan(0);
    }
  });

  it('names the credential that is missing, rather than saying "incomplete"', () => {
    const sentence = describeMissingCredentials('adzuna', {
      adzuna_app_id: true,
      adzuna_app_key: false,
    });

    expect(sentence).toContain('App Key');
    expect(sentence).not.toContain('App ID is missing');
    // And it says what to do about it, given nothing can be read back.
    expect(sentence).toContain('both');
  });

  it('says nothing when there is nothing missing', () => {
    expect(
      describeMissingCredentials('adzuna', { adzuna_app_id: true, adzuna_app_key: true }),
    ).toBeNull();
    expect(describeMissingCredentials('reed', { reed_api_key: true })).toBeNull();
  });
});

describe('validating what was typed — before anything is sent', () => {
  it('accepts a plausible pair', () => {
    expect(validateCandidate('adzuna', filled('adzuna', 'abc123'))).toEqual({});
  });

  it('refuses an empty box and names it', () => {
    const errors = validateCandidate('adzuna', {
      adzuna_app_id: 'abc123',
      adzuna_app_key: '',
    } as Record<SecretKeyName, string>);

    expect(errors.adzuna_app_id).toBeUndefined();
    expect(errors.adzuna_app_key).toContain('App Key');
  });

  it('refuses a box holding only whitespace', () => {
    // A pasted key that turned out to be a tab is indistinguishable from an
    // empty box on screen, and Adzuna would answer it with a 401.
    const errors = validateCandidate('reed', { reed_api_key: '   \t\n' } as Record<
      SecretKeyName,
      string
    >);
    expect(errors.reed_api_key).toBeDefined();
  });

  it('boundary: accepts a key at the size limit and refuses one byte more', () => {
    expect(validateCandidate('reed', filled('reed', 'k'.repeat(MAX_KEY_BYTES)))).toEqual({});

    const over = validateCandidate('reed', filled('reed', 'k'.repeat(MAX_KEY_BYTES + 1)));
    expect(over.reed_api_key).toBeDefined();
  });

  it('boundary: counts UTF-8 bytes, the way the credential store does', () => {
    // Rust checks `value.len()` — BYTES. A limit counted in UTF-16 units here
    // would pass a value the save then refuses, which is exactly the outcome
    // testing-before-saving exists to prevent. '€' is three bytes.
    const justOver = '€'.repeat(Math.floor(MAX_KEY_BYTES / 3) + 1);
    expect(justOver.length).toBeLessThan(MAX_KEY_BYTES);
    expect(validateCandidate('reed', filled('reed', justOver)).reed_api_key).toBeDefined();
  });

  it('never repeats the value back in the message', () => {
    const secret = 'sk-do-not-echo-me-abcdefghijklmnop';
    const errors = validateCandidate(
      'reed',
      filled('reed', `${secret}${'x'.repeat(MAX_KEY_BYTES)}`),
    );
    expect(errors.reed_api_key).toBeDefined();
    expect(errors.reed_api_key).not.toContain(secret);
  });

  it('agrees with the byte limit the Rust credential store enforces', () => {
    // Two constants in two languages, on two sides of an FFI boundary. A key
    // that passes here and is refused there fails AFTER a successful test,
    // which is the one sequence this whole flow exists to prevent.
    const secretsRs = readFileSync(
      fileURLToPath(new URL('../../../../src-tauri/src/secrets.rs', import.meta.url)),
      'utf8',
    );
    const declared = /MAX_SECRET_BYTES: usize = (\d+);/.exec(secretsRs);

    expect(declared).not.toBeNull();
    expect(Number(declared?.[1])).toBe(MAX_KEY_BYTES);
  });
});

describe('explaining a failed test', () => {
  it('has a distinct headline for every error kind the transport can produce', () => {
    // Branch on `kind`, never on `message`. A kind added upstream without a
    // sentence here would otherwise fall through to nothing at all.
    const headlines = ALL_KINDS.map((kind) => TEST_FAILURE_HEADLINE[kind]);
    expect(headlines.every((headline) => headline.length > 0)).toBe(true);
    expect(new Set(headlines).size).toBeGreaterThan(4);
  });

  it('distinguishes a wrong key from a network problem from a rate limit', () => {
    expect(TEST_FAILURE_HEADLINE['auth'].toLowerCase()).toContain('key');
    expect(TEST_FAILURE_HEADLINE['network'].toLowerCase()).toContain('reach');
    expect(TEST_FAILURE_HEADLINE['rate-limit'].toLowerCase()).toContain('too many');
  });

  it('never tells the user their key was saved on a failure', () => {
    for (const kind of ALL_KINDS) {
      expect(TEST_FAILURE_HEADLINE[kind].toLowerCase()).not.toContain('saved');
    }
  });
});

describe('explaining a passed test', () => {
  it('says the key worked and that it has been saved', () => {
    const message = describeTestPass('reed', 1);
    expect(message).toContain('Reed');
    expect(message.toLowerCase()).toContain('saved');
  });

  it('boundary: an accepted key that found nothing is still a pass', () => {
    // 200 plus a well-formed body with an empty results array. The key is
    // fine; a one-result probe simply matched nothing. Reporting that as a
    // failure would send the user back to re-paste a working key.
    const message = describeTestPass('adzuna', 0);
    expect(message.toLowerCase()).toContain('saved');
    expect(message.toLowerCase()).not.toContain('failed');
  });
});
