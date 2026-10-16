/**
 * The leftover-keys question (L-251) asks about every credential Rust can store.
 *
 * Read from `secrets.rs`, like `everySecretIsErased.contract.test.ts`: a new
 * key added there must also be found, named and removable here, or the notice
 * would quietly leave it out of the question.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { SECRET_KEYS } from '../../status/environment';

import { LEFTOVER_KEY_LABELS, LEFTOVER_QUERIED_KEYS } from './leftoverKeys';

const SECRETS_RS = readFileSync(
  fileURLToPath(new URL('../../../src-tauri/src/secrets.rs', import.meta.url)),
  'utf8',
);

const ACCOUNTS = [...SECRETS_RS.matchAll(/SecretKey::\w+\s*=>\s*"([a-z_]+)"/g)].map(
  (match) => match[1] ?? '',
);

describe('the leftover-keys question covers every stored credential', () => {
  it('reads the real list (anti-inert)', () => {
    expect(ACCOUNTS.length).toBeGreaterThanOrEqual(10);
  });

  it('asks about every account Rust can store', () => {
    const asked: readonly string[] = LEFTOVER_QUERIED_KEYS;
    for (const account of ACCOUNTS) expect(asked, account).toContain(account);
  });

  it('has a plain name for every one of them', () => {
    const labels = LEFTOVER_KEY_LABELS as Readonly<Record<string, string>>;
    for (const account of ACCOUNTS) expect(labels[account], account).toBeTruthy();
  });

  it('asks about the same list "Delete everything" erases', () => {
    expect([...LEFTOVER_QUERIED_KEYS].sort()).toEqual([...SECRET_KEYS].sort());
  });
});
