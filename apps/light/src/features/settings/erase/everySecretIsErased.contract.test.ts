/**
 * "Delete everything" reaches every credential-store entry the app can write.
 *
 * ============================================================================
 * READ FROM RUST, BECAUSE RUST DECIDES WHAT CAN BE STORED
 * ============================================================================
 * `forgetKeys` walks `SECRET_KEYS`, a hand-kept TypeScript list. The set of
 * entries that can actually exist is `SecretKey` in `secrets.rs`. Nothing tied
 * the two together, so a new entry — L-150's typed-address service, which
 * holds an address AND a key — could be saved by one and survive the other,
 * on a screen that had just said everything was gone.
 *
 * A forbid-list (LESSON-033): every account Rust names must be erasable. This
 * file does not know the entries by name, so the next one is caught without
 * anyone editing it.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { SECRET_KEYS } from '../../../status/environment';

const SECRETS_RS = readFileSync(
  fileURLToPath(new URL('../../../../src-tauri/src/secrets.rs', import.meta.url)),
  'utf8',
);

/** `SecretKey::OpenaiApiKey => "openai_api_key",` → `openai_api_key`, from `account()`. */
function accountsIn(source: string): string[] {
  return [...source.matchAll(/SecretKey::\w+\s*=>\s*"([a-z_]+)"/g)].map((match) => match[1] ?? '');
}

const ACCOUNTS = accountsIn(SECRETS_RS);

describe('every credential the app can store is erased', () => {
  it('finds the entries Rust can store', () => {
    // Anti-inert: the parse must see the real list, or the check below
    // passes about nothing.
    expect(ACCOUNTS.length).toBeGreaterThanOrEqual(10);
    expect(ACCOUNTS).toContain('openai_api_key');
    expect(ACCOUNTS).toContain('reed_api_key');
  });

  it('every one of them is on the list "delete everything" walks', () => {
    const erased: readonly string[] = SECRET_KEYS;
    for (const account of ACCOUNTS) {
      expect(erased, `${account} survives "delete everything"`).toContain(account);
    }
  });

  it('L-150: the typed-address service, address and key together, is erased', () => {
    expect(ACCOUNTS).toContain('custom_provider');
    expect(SECRET_KEYS as readonly string[]).toContain('custom_provider');
  });

  it('boundary: the parse reads only the account-mapping shape, comments included', () => {
    // Over-reading a comment can only ADD a name to check, which errs safe.
    expect(accountsIn('// SecretKey::Fake => "fake_key", in a comment')).toEqual(['fake_key']);
    expect(accountsIn('SecretKey::Fake => something_else')).toEqual([]);
  });
});
