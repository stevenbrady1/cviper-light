/**
 * Only `schema-issues.ts` reads a schema validator's own words (L-350).
 *
 * ============================================================================
 * WHY THIS EXISTS
 * ============================================================================
 * Five AI features once showed "match_score: Invalid input: expected number,
 * received undefined" to a person, because the text built for the model's
 * repair turn and the sentence for the banner travelled in one `message`
 * field. The fix split them: `schema-issues.ts` turns issues into a
 * `repairHint` (for the model) and a `detail` (field names and reasons), and
 * hands the person a fixed sentence. `wrong-shape-wording.contract.test.ts`
 * checks the result through every entry point; this guard stops the next
 * feature from rebuilding the leak by hand before it ever runs.
 *
 * ============================================================================
 * A FORBID-LIST (LESSON-033)
 * ============================================================================
 * In every non-test source file under `src/` except `schema-issues.ts`, these
 * shapes must be ABSENT, with comments stripped first so a comment explaining
 * the rule can neither trip the guard nor satisfy it:
 *
 *   1. reading an issue's message — `issue.message`, `issues[0].message`,
 *      `firstIssue?.message`: the validator's raw words, outside the builder;
 *   2. reading `<something>Attempt.error.message` — an attempt failure has no
 *      `message`; reaching for one is the old two-reader field coming back;
 *   3. a `message:` built from a `repairHint` — the model's text on its way to
 *      a person's screen under another name.
 *
 * Known limit, stated rather than hidden: a lexical scan cannot follow data.
 * Destructuring `({ message }) => …` straight off an issue, or copying the hint
 * into a variable first, would get past this. The behavioural contract test is
 * the backstop for those.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SRC = dirname(fileURLToPath(import.meta.url));

/** The one file allowed to read the validator's words. */
const BUILDER = 'schema-issues.ts';

const FORBIDDEN: ReadonlyArray<readonly [string, RegExp]> = [
  ['an issue message read outside the builder', /\b\w*issues?\s*(?:\[[^\]]*\])?\s*\??\.message\b/i],
  ['an attempt failure read for `.message`', /\b\w*attempt\w*\s*\??\.error\s*\??\.message\b/i],
  ['a `message:` built from a repair hint', /\bmessage\s*:[^,;}\n]*\brepairHint\b/],
];

/** The source with block and line comments blanked, line numbers kept. */
export function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

/** Every forbidden shape in one file's source, as "rule: line". */
export function offencesIn(source: string): string[] {
  const out: string[] = [];
  for (const line of withoutComments(source).split('\n')) {
    for (const [rule, pattern] of FORBIDDEN) {
      if (pattern.test(line)) out.push(`${rule}: ${line.trim()}`);
    }
  }
  return out;
}

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) out.push(path);
  }
  return out;
}

describe('only the shared builder reads the validator’s words (L-350)', () => {
  it('no other source file under src/ reads an issue message or re-joins the two readers', () => {
    const files = sources(SRC);
    const offences: string[] = [];
    for (const file of files) {
      const rel = relative(SRC, file).replaceAll('\\', '/');
      if (rel === BUILDER) continue;
      for (const offence of offencesIn(readFileSync(file, 'utf8')))
        offences.push(`${rel}: ${offence}`);
    }
    // The scan has to be reading something: the seven entry points alone.
    expect(files.length).toBeGreaterThan(20);
    expect(offences).toEqual([]);
  });

  it('the builder still exists, so the exemption cannot outlive its reason', () => {
    expect(() => statSync(join(SRC, BUILDER))).not.toThrow();
  });
});

describe('the guard itself', () => {
  it('negative: the old builder line is caught', () => {
    expect(offencesIn('      return `${path}: ${issue.message}`;')).toHaveLength(1);
  });

  it('negative: an indexed or optional issue read is caught', () => {
    expect(offencesIn('const m = parsed.error.issues[0]?.message;')).toHaveLength(1);
    expect(offencesIn('const m = firstIssue?.message;')).toHaveLength(1);
  });

  it('negative: the L-350 leak — the attempt’s message as the final message — is caught', () => {
    expect(offencesIn('      message: secondAttempt.error.message,')).toHaveLength(1);
  });

  it('negative: the repair hint handed to the person is caught', () => {
    expect(
      offencesIn('return err({ kind, message: secondAttempt.error.repairHint });'),
    ).toHaveLength(1);
  });

  it('boundary: the same words in a comment are not code', () => {
    expect(offencesIn('// issue.message is read only in schema-issues.ts\nconst x = 1;')).toEqual(
      [],
    );
    expect(offencesIn('/* message: secondAttempt.error.message */ const x = 1;')).toEqual([]);
  });

  it('happy: a provider error passed through, and the hint going to the model, are allowed', () => {
    expect(
      offencesIn('return err({ kind: first.error.kind, message: first.error.message });'),
    ).toEqual([]);
    expect(
      offencesIn('buildRepairPrompt(user, firstAttempt.error.raw, firstAttempt.error.repairHint);'),
    ).toEqual([]);
  });
});
