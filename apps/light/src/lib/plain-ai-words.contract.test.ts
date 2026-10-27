/**
 * L-295 — outside Settings, the app says "AI", not the words for its parts.
 *
 * A first-time user who has not set up AI met "Needs a local model or your own
 * key." on the interview and follow-up panels, "No local model or key set up"
 * on the tailor screen and "Extraction needs an AI provider (free with Ollama,
 * or your own key)" on Paste a job. Each is accurate, and each is three words
 * the user does not know, on the screen where they are deciding whether to
 * carry on. The owner chose the plainest wording (27 Oct 2026): "Needs AI — add
 * it in Settings." Settings is where the two kinds are explained (L-293's
 * three steps), so it is the one place these words belong.
 *
 * This reads the source, with comments removed, for the phrases. Naming
 * Ollama is NOT jargon once a user has installed it, so it is not on the list.
 *
 * Allowed, each for a reason that is not "it was already there":
 *   - ConsentGate.tsx — the consent dialog must say exactly how the CV is
 *     sent ("using the API key you added"); plain-but-vague is the wrong trade
 *     on a privacy disclosure, and `ConsentGate.test.tsx` pins that wording.
 *   - onboarding/cards.ts — the AI-use disclosure on the welcome card, the same
 *     sentence the store listing and privacy policy carry.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from './repo-scan.ts';

const SRC = join(REPO_ROOT, 'apps', 'light', 'src');
const SCANNED = [join(SRC, 'app'), join(SRC, 'features')];
const SETTINGS = join(SRC, 'features', 'settings');

const ALLOWED = new Set([
  'apps/light/src/features/analysis/ConsentGate.tsx',
  'apps/light/src/features/onboarding/cards.ts',
]);

export const JARGON = /\blocal model\b|\byour own key\b|\bAPI keys?\b|\bAI provider\b/i;

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (path === SETTINGS) continue;
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith('.d.ts'))
      out.push(path);
  }
  return out;
}

/** The source with block and line comments blanked, line numbers kept. */
export function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

/** Every line of words a user can read that uses one of the phrases. */
export function jargonLines(source: string): string[] {
  return withoutComments(source)
    .split('\n')
    .filter((line) => JARGON.test(line))
    .map((line) => line.trim());
}

describe('screens outside Settings use plain words for AI (L-295)', () => {
  it('no source file outside Settings says "local model", "your own key", "API key" or "AI provider"', () => {
    const offences: string[] = [];
    const files = SCANNED.flatMap(sources);
    for (const file of files) {
      const rel = relative(REPO_ROOT, file).replaceAll('\\', '/');
      if (ALLOWED.has(rel)) continue;
      for (const line of jargonLines(readFileSync(file, 'utf8'))) offences.push(`${rel}: ${line}`);
    }
    // The scan has to be reading something: features/ alone has well over 100.
    expect(files.length).toBeGreaterThan(100);
    expect(offences).toEqual([]);
  });

  it('every allowed file still exists, so an allowance cannot outlive its reason', () => {
    for (const rel of ALLOWED) {
      expect(() => statSync(join(REPO_ROOT, rel)), rel).not.toThrow();
    }
  });
});

describe('the guard itself', () => {
  it('negative: a string saying "local model" is caught', () => {
    expect(jargonLines("const NOTE = 'Needs a local model or your own key.';")).toHaveLength(1);
  });

  it('negative: JSX text saying "no API key" is caught', () => {
    expect(jargonLines('<p>It needs no account and no API key.</p>')).toHaveLength(1);
  });

  it('boundary: the same words in a comment are not a screen', () => {
    expect(
      jargonLines('// a local model answers\n/* your own key\n API key */ const x = 1;'),
    ).toEqual([]);
  });

  it('boundary: a URL in a string is not mistaken for a comment', () => {
    expect(jargonLines("const u = 'https://x.test'; const n = 'API key';")).toHaveLength(1);
  });

  it('happy: identifiers and the plain wording pass', () => {
    expect(jargonLines("const localModelHint = 'Needs AI — add it in Settings.';")).toEqual([]);
  });
});
