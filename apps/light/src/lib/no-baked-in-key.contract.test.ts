/**
 * The no-baked-in-key contract: no API key, secret or token is compiled into
 * this app, read from the build environment, or defaulted in code.
 *
 * ============================================================================
 * WHY THIS EXISTS
 * ============================================================================
 * Every request Light makes to a paid service carries a key the USER pasted
 * into Settings, stored in the operating system's credential store
 * (`secrets.rs`). That is what makes the app free to run for the person who
 * publishes it: there is no key of ours to bill.
 *
 * The way that stops being true is not dramatic. It is a convenience during
 * development — `const OPENAI_KEY = import.meta.env.VITE_OPENAI_KEY` so the
 * search works without the wizard — that gets committed, then bundled, then
 * shipped inside a binary anyone can run `strings` over. At that point the
 * key is public, the bill is ours, and a stranger's usage is
 * indistinguishable from a user's.
 *
 * The hosted product's ADR 012 calls this invariant R-COST. This is its
 * source-level half; the artefact-level half (a secret scan over the BUILT
 * bundle) lives in CI, because a key can also arrive through a build step
 * that never touches source.
 *
 * ============================================================================
 * WHAT IS FORBIDDEN
 * ============================================================================
 *   * A key-shaped literal: OpenAI `sk-…`, Anthropic `sk-ant-…`, Google
 *     `AIza…`. Test files are excluded — they plant fakes to prove redaction.
 *   * Reading a key from the build environment: `import.meta.env.*KEY`,
 *     `process.env.*SECRET`, Rust `env!("…TOKEN")` / `option_env!`.
 *   * A default: `DEFAULT_API_KEY`, `FALLBACK_KEY`, `apiKey: '…'` with a
 *     non-empty literal.
 *
 * Comments are stripped first, so this file's own examples do not trip it.
 */
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT, displayPath, shippedText, walk } from './repo-scan.ts';

export const KEY_SHAPES: readonly RegExp[] = [
  /\bsk-ant-[A-Za-z0-9_-]{16,}/,
  /\bsk-[A-Za-z0-9_-]{20,}/,
  /\bAIza[0-9A-Za-z_-]{30,}/,
];

export const KEY_SOURCES: readonly RegExp[] = [
  /import\.meta\.env\.\w*(KEY|SECRET|TOKEN)\w*/i,
  /process\.env\.\w*(KEY|SECRET|TOKEN)\w*/i,
  /\b(env|option_env)!\s*\(\s*"[^"]*(KEY|SECRET|TOKEN)[^"]*"/i,
  /\b(DEFAULT|FALLBACK|BUILTIN|EMBEDDED)_(API_)?(KEY|SECRET|TOKEN)\b/,
  /\bapi[_-]?key\s*[:=]\s*["'`][^"'`]{8,}["'`]/i,
];

export function bakedInKeysIn(text: string): string[] {
  return [...KEY_SHAPES, ...KEY_SOURCES].flatMap((pattern) =>
    [...text.matchAll(new RegExp(pattern.source, pattern.flags + 'g'))].map((match) => match[0]),
  );
}

const SCANNED_EXTENSIONS = ['.ts', '.tsx', '.rs', '.json', '.sql', '.toml', '.html'] as const;
const FILES = [
  ...walk(join(REPO_ROOT, 'apps'), { extensions: SCANNED_EXTENSIONS }),
  ...walk(join(REPO_ROOT, 'packages'), { extensions: SCANNED_EXTENSIONS }),
].filter((file) => !file.endsWith('Cargo.lock') && !file.endsWith('pnpm-lock.yaml'));

describe('the baked-in-key detector', () => {
  it('catches every forbidden shape on planted examples', () => {
    // Built at runtime so the fixtures are not themselves key-shaped literals
    // in this file's source.
    const openai = 'sk-' + 'A'.repeat(24);
    const anthropic = 'sk-ant-' + 'B'.repeat(24);
    const google = 'AIza' + 'C'.repeat(35);
    expect(bakedInKeysIn(`const k = "${openai}"`)).toEqual([openai]);
    expect(bakedInKeysIn(`const k = "${anthropic}"`)).toHaveLength(2); // sk-ant-… and its sk-… tail
    expect(bakedInKeysIn(`const k = "${google}"`)).toEqual([google]);
    expect(bakedInKeysIn('const k = import.meta.env.VITE_OPENAI_KEY')).toEqual([
      'import.meta.env.VITE_OPENAI_KEY',
    ]);
    expect(bakedInKeysIn('let k = env!("ADZUNA_APP_KEY");')).toHaveLength(1);
    expect(bakedInKeysIn('const DEFAULT_API_KEY = "";')).toEqual(['DEFAULT_API_KEY']);
    expect(bakedInKeysIn('{ apiKey: "abcdefghijkl" }')).toHaveLength(1);
  });

  it('lets the honest shapes through', () => {
    // A key read from the credential store, an empty placeholder, a schema
    // field named "key", a test-only fake shorter than a real key.
    expect(bakedInKeysIn('const key = await invoke("secret_get", { provider })')).toEqual([]);
    expect(bakedInKeysIn('apiKey: ""')).toEqual([]);
    expect(bakedInKeysIn('required: ["key", "value"]')).toEqual([]);
    expect(bakedInKeysIn('const fake = "sk-short"')).toEqual([]);
  });
});

describe('no key is compiled into Light', () => {
  it('scans the real tree', () => {
    // Anti-inert: the Rust transport and the Vite config must be in scope,
    // because those are the two places a key would be read from.
    expect(FILES.length).toBeGreaterThan(80);
    expect(FILES.some((file) => file.endsWith('providers.rs'))).toBe(true);
    expect(FILES.some((file) => file.endsWith('vite.config.ts'))).toBe(true);
  });

  it('finds no key-shaped literal, build-env read or default key', () => {
    const offenders = FILES.flatMap((file) =>
      bakedInKeysIn(shippedText(file)).map((found) => `${displayPath(file)}: ${found}`),
    );
    expect(
      offenders,
      'A key in the source is a key in the binary, and a key in the binary is public. ' +
        'Keys come from the OS credential store via secrets.rs, or from nowhere.',
    ).toEqual([]);
  });
});
