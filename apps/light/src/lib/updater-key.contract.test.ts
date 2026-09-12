/**
 * The updater-key contract: nothing in this repository describes the updater's
 * public signing key as a placeholder, because it stopped being one in
 * `ce13a96`.
 *
 * ============================================================================
 * WHY THIS EXISTS
 * ============================================================================
 * `plugins.updater.pubkey` in `apps/light/src-tauri/tauri.conf.json` is a REAL
 * minisign public key, id `7029FCBC6B4F158F`. Its private half lives in this
 * repository's GitHub Actions secrets (`TAURI_SIGNING_PRIVATE_KEY` and
 * `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`), and the draft `light-v0.1.0` release
 * carries `.sig` files that verify against it.
 *
 * For a while after that commit three documents still called it a placeholder
 * and told the reader to replace it before the first release. That is not a
 * stale sentence, it is a loaded gun. This app checks ONE hardcoded public key
 * and has no revocation path, so anybody who obligingly runs
 * `pnpm tauri signer generate` to "finish the job" permanently severs every
 * installed copy from every future update. The damage is silent, arrives
 * whenever the next release does, and cannot be repaired by shipping another
 * one: the binaries that would have to accept a new key are already on other
 * people's machines.
 *
 * Documentation that invites a reader to destroy the product is worth a guard.
 *
 * ============================================================================
 * A FORBID-LIST, NOT AN ALLOW-LIST (LESSON-033)
 * ============================================================================
 * This encodes "the placeholder claim must be ABSENT", never "the correct
 * sentence must be PRESENT". A guard asserting RELEASE-SIGNING.md CONTAINS
 * "never regenerate this key" would pass the day somebody reworded the warning
 * into something weaker and fail the day somebody improved it, and the first
 * person to hit that would delete the guard rather than the sentence.
 *
 * Two shapes are forbidden:
 *
 *   1. The retired literal the real key replaced. It has exactly one meaning
 *      and no honest use anywhere in this repository.
 *   2. A block of text that names the updater key AND calls something a
 *      placeholder. Any rewording that still means "this key is a placeholder"
 *      trips it.
 *
 * A NEGATED mention walks through — "the pubkey is real, not a placeholder" is
 * the correction, and a guard that fired on the fix would be worse than no
 * guard. That is the one nuance here, and it is proved in both directions
 * below.
 *
 * ============================================================================
 * THE UNIT IS A BLOCK, NOT A LINE OR A CHARACTER WINDOW
 * ============================================================================
 * The two terms are rarely on one line. "## What the placeholder does today"
 * sits three lines above the sentence naming the pubkey, and a markdown table
 * puts them in a header row and a body row either side of a separator.
 *
 * So the unit is a block of consecutive non-blank lines — a paragraph, a list,
 * a whole table — and a markdown heading is adjudicated together with the
 * section beneath it, because a heading is a claim about what follows. That is
 * a real thought either way, and it needs no tuned character distance that
 * silently stops reaching the second term when somebody widens a table.
 *
 * ============================================================================
 * WHAT COUNTS AS TEXT, AND THE LIMITATION THAT COMES WITH IT
 * ============================================================================
 * COMMENTS ARE EXCLUDED, for the reason `repo-scan.ts` gives: a guard that
 * fires on the comment explaining the fix is a guard somebody deletes. Source
 * comments are stripped with the shared `stripComments`, and `#` comments are
 * stripped from YAML and TOML.
 *
 * Markdown is NOT stripped, because in a document the prose IS the artefact —
 * there is no "mere commentary" in a file whose whole job is to instruct a
 * human. Fenced code and HTML comments are blanked, so a sample or an aside
 * cannot trip it.
 *
 * The limitation that buys, stated rather than hidden: a stale claim living in
 * a `//` docblock in TypeScript is NOT caught. Four of them were corrected by
 * hand alongside this guard (`settings/updates/port.ts`, `model.ts`,
 * `model.test.ts`, `test/fakeUpdatePort.ts`). What the guard holds is every
 * document a person opens before touching the key, which is where the
 * instruction to regenerate it actually lived.
 *
 * `tauri.conf.json` is excluded from the prose scan and checked separately
 * below: a config file HOLDING a placeholder is a different defect from a
 * document LYING about one, and conflating them would make the failure message
 * point at the wrong thing.
 *
 * ============================================================================
 * WHY THIS CANNOT GO QUIETLY INERT
 * ============================================================================
 * The premise is asserted first: if `tauri.conf.json` ever goes back to a
 * placeholder, `the key in tauri.conf.json is real` fails loudly and names that
 * as the problem, rather than this file quietly adjudicating documents against
 * an assumption that no longer holds.
 *
 * Then the corpus is floored three ways — file count, block count, and the
 * named files this guard exists for, asserted present BY NAME. A broken `git
 * ls-files`, a moved document or a renamed directory fails there instead of
 * passing an empty scan. `git ls-files` failing is a hard error and never an
 * empty list: an alarm that cannot see is not an alarm that says everything is
 * fine.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT, stripComments } from './repo-scan.ts';

/** The minisign key id baked into every shipped binary. */
const KEY_ID = '7029FCBC6B4F158F';

/**
 * The literal the real key replaced in `ce13a96`.
 *
 * Assembled at runtime so this file's own source does not contain it — the
 * same trick `no-baked-in-key.contract.test.ts` uses for its fake keys, and
 * belt-and-braces on top of excluding this file from the corpus.
 */
const RETIRED_LITERAL = ['PLACEHOLDER', 'REPLACE', 'BEFORE', 'FIRST', 'RELEASE'].join('_');

const CONFIG_PATH = join(REPO_ROOT, 'apps', 'light', 'src-tauri', 'tauri.conf.json');

/** Names for the updater's key, as this repository actually writes them. */
const KEY_TERM = String.raw`(?:pub[-\s]?key|public\s+key|signing\s+key(?:pair)?|updater\s+key|signature\s+key|tauri\.conf\.json)`;

/** Calling something a placeholder. */
const PLACEHOLDER_TERM = String.raw`placeholders?`;

/**
 * A denial turns the claim into its correction.
 *
 * "The pubkey is real, not a placeholder" is the sentence this guard is FOR.
 * Recognised as a shape rather than an allow-list of blessed sentences, so it
 * keeps working when somebody rewrites the paragraph.
 */
const NEGATION =
  /\b(?:not|never|no longer|isn't|is not|was not|wasn't|rather than)\s+(?:a\s+|the\s+|just\s+a\s+|merely\s+a\s+|only\s+a\s+)?$/i;

const HAS_KEY_TERM = new RegExp(KEY_TERM, 'i');
const PLACEHOLDER_MENTIONS = new RegExp(String.raw`\b${PLACEHOLDER_TERM}\b`, 'gi');

/** Files that are data or generated, never prose about the key. */
const SKIPPED_FILES: ReadonlySet<string> = new Set([
  'pnpm-lock.yaml',
  'apps/light/src-tauri/Cargo.lock',
  // Checked on its own terms by `the key in tauri.conf.json is real`.
  'apps/light/src-tauri/tauri.conf.json',
]);

const SCANNED_EXTENSIONS = [
  '.md',
  '.ts',
  '.tsx',
  '.rs',
  '.json',
  '.yml',
  '.yaml',
  '.toml',
] as const;

export interface Offence {
  readonly file: string;
  readonly line: number;
  readonly found: string;
  readonly why: string;
}

/** A run of consecutive non-blank lines: a paragraph, a list, a whole table. */
interface Block {
  readonly text: string;
  readonly line: number;
}

/** Replace every non-newline character with a space, so offsets and lines survive. */
function blank(match: string): string {
  return match.replace(/[^\n]/g, ' ');
}

/**
 * Text as a reader meets it, with whatever is commentary in THAT language gone.
 */
export function readableText(source: string, file: string): string {
  const text = source.replaceAll('\r\n', '\n');

  if (file.endsWith('.md')) {
    return text
      .replace(/<!--[\s\S]*?-->/g, blank)
      .replace(/^```[\s\S]*?^```/gm, blank)
      .replace(/^~~~[\s\S]*?^~~~/gm, blank);
  }

  if (/\.(?:yml|yaml|toml)$/.test(file)) {
    // Over-stripping a `#` inside a quoted string can only ever HIDE a
    // violation, never invent one, which is the safe direction for a
    // forbid-list.
    return text.replace(/(^|\s)#.*$/gm, '$1');
  }

  return stripComments(text);
}

/** Blocks of one thought, with a markdown heading joined to the section it introduces. */
export function blocksOf(text: string): Block[] {
  const lines = text.split('\n');
  const groups: Block[] = [];
  let current: string[] = [];
  let start = 0;

  const flush = (): void => {
    if (current.length > 0) groups.push({ text: current.join('\n'), line: start + 1 });
    current = [];
  };

  lines.forEach((line, index) => {
    if (line.trim() === '') {
      flush();
      return;
    }
    if (current.length === 0) start = index;
    current.push(line);
  });
  flush();

  const isHeading = (block: Block): boolean =>
    block.text.split('\n').every((line) => /^\s*#{1,6}\s/.test(line));

  const merged: Block[] = [];
  let pending: Block | null = null;
  for (const block of groups) {
    if (isHeading(block)) {
      // Two headings in a row: the first introduces nothing, so it is
      // adjudicated alone rather than dropped.
      if (pending !== null) merged.push(pending);
      pending = block;
      continue;
    }
    merged.push(
      pending === null ? block : { text: `${pending.text}\n${block.text}`, line: pending.line },
    );
    pending = null;
  }
  if (pending !== null) merged.push(pending);

  return merged;
}

/** Every way one file calls the updater key a placeholder. */
export function placeholderClaimsIn(source: string, file: string): Offence[] {
  const text = readableText(source, file);
  const offences: Offence[] = [];

  const lineOf = (index: number): number => text.slice(0, index).split('\n').length;

  for (const match of text.matchAll(new RegExp(RETIRED_LITERAL, 'g'))) {
    offences.push({
      file,
      line: lineOf(match.index),
      found: match[0],
      why:
        'the literal the REAL key replaced in ce13a96. The updater public key is a real ' +
        `minisign key, id ${KEY_ID}; nothing in this repository should still name its placeholder.`,
    });
  }

  for (const block of blocksOf(text)) {
    if (!HAS_KEY_TERM.test(block.text)) continue;
    for (const mention of block.text.matchAll(PLACEHOLDER_MENTIONS)) {
      if (NEGATION.test(block.text.slice(0, mention.index))) continue;
      offences.push({
        file,
        line: block.line + block.text.slice(0, mention.index).split('\n').length - 1,
        found:
          block.text
            .split('\n')
            [block.text.slice(0, mention.index).split('\n').length - 1]?.trim()
            .slice(0, 120) ?? mention[0],
        why:
          `this text names the updater key and calls it a placeholder. It is a real minisign key, id ${KEY_ID}, ` +
          "whose private half is in this repository's Actions secrets. Regenerating it would stop every " +
          'installed copy from ever accepting an update again, and there is no way to undo that.',
      });
    }
  }

  return offences.sort((left, right) => left.line - right.line);
}

function explain(offences: readonly Offence[]): string {
  return offences.map((o) => `${o.file}:${o.line}  "${o.found}"\n    -> ${o.why}`).join('\n');
}

// ── The corpus ──────────────────────────────────────────────────────────────

/**
 * Every tracked file, from git itself.
 *
 * A failure here THROWS. `|| []` on a listing command is how an alarm becomes
 * indistinguishable from a clean system, and this repository has been bitten by
 * exactly that shape before.
 */
function trackedFiles(): string[] {
  const listing = execFileSync('git', ['ls-files', '-z'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return listing.split('\0').filter((path) => path.length > 0);
}

const SELF = 'apps/light/src/lib/updater-key.contract.test.ts';

const FILES = trackedFiles()
  .filter((path) => SCANNED_EXTENSIONS.some((extension) => path.endsWith(extension)))
  .filter((path) => !SKIPPED_FILES.has(path) && path !== SELF);

const SCANNED = FILES.map((path) => {
  const source = readFileSync(join(REPO_ROOT, path), 'utf8');
  return {
    name: path,
    offences: placeholderClaimsIn(source, path),
    blocks: blocksOf(readableText(source, path)).length,
  };
});

describe('the key in tauri.conf.json is real', () => {
  const pubkey = (
    JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as {
      plugins?: { updater?: { pubkey?: unknown } };
    }
  ).plugins?.updater?.pubkey;

  it('is a minisign public key, not a placeholder', () => {
    expect(typeof pubkey).toBe('string');
    expect(pubkey).not.toBe(RETIRED_LITERAL);

    const decoded = Buffer.from(String(pubkey), 'base64').toString('utf8');
    expect(decoded).toContain('minisign public key');
    expect(decoded).toContain(KEY_ID);
  });

  it('is the key every shipped binary already checks against', () => {
    // Pinned by id. A DIFFERENT real key here is the catastrophe this whole
    // contract exists to prevent, and it would otherwise satisfy every
    // assertion above.
    const decoded = Buffer.from(String(pubkey), 'base64').toString('utf8');
    expect(
      decoded.includes(KEY_ID),
      'The updater public key changed. Every installed copy verifies updates against the key ' +
        `baked into it, so replacing ${KEY_ID} orphans all of them permanently. If this was ` +
        'deliberate, it needs a new install, not a new release.',
    ).toBe(true);
  });
});

describe('no tracked file calls the updater key a placeholder', () => {
  it('opened a real corpus, including the documents this guard is for', () => {
    // Leg one: files. A broken `git ls-files` or a moved tree fails here.
    expect(FILES.length).toBeGreaterThan(150);

    // Leg two: the named documents. These are where the instruction to
    // regenerate the key actually lived.
    for (const required of [
      'apps/light/src-tauri/RELEASE-SIGNING.md',
      'docs/FEATURE-MATRIX.md',
      'docs/PLAN.md',
      'apps/light/src/features/settings/updates/port.ts',
    ]) {
      expect(FILES, `${required} is not in the corpus`).toContain(required);
    }

    // Leg three: text. An extractor returning nothing would clear the repo.
    const blocks = SCANNED.reduce((total, entry) => total + entry.blocks, 0);
    expect(blocks).toBeGreaterThan(2000);
  });

  it.each(SCANNED.map((entry) => [entry.name, entry] as const))('%s', (_name, entry) => {
    expect(entry.offences, `\n${explain(entry.offences)}\n`).toEqual([]);
  });
});

describe('the placeholder detector can actually fail', () => {
  const caught: ReadonlyArray<readonly [string, string, string]> = [
    ['the claim on one line', 'a.md', 'The pubkey is a placeholder.\n'],
    [
      'the FEATURE-MATRIX regression, transcribed',
      'a.md',
      '**Needs a human before it ships**: the updater is wired and tested but the\nsigning key in `tauri.conf.json` is a placeholder, so no release can currently\nbe verified by an installed copy.\n',
    ],
    [
      'the RELEASE-SIGNING regression: a heading above the section it describes',
      'a.md',
      '## What the placeholder does today\n\nRead out of `tauri-plugin-updater` rather than assumed. The pubkey is decoded\nin `verify_signature`.\n',
    ],
    [
      'the claim split across a markdown table',
      'a.md',
      '| Operation | With the placeholder in place |\n| --- | --- |\n| `cargo check` | Pass. The pubkey is an opaque string to the build. |\n',
    ],
    [
      'the retired literal, wherever it appears',
      'a.md',
      `The updater ships with the ${RETIRED_LITERAL} value.\n`,
    ],
    [
      'the claim in a markdown bullet',
      'a.md',
      '- **Built, unsigned.** `plugins.updater.pubkey` is a placeholder, so a real\n  check fails signature verification.\n',
    ],
    [
      'the claim in shipped source, outside a comment',
      'a.ts',
      "export const NOTE = 'The signing key is still a placeholder.';\n",
    ],
    [
      'the claim in a YAML value, outside a comment',
      'a.yml',
      "      - name: Note\n        run: echo 'the pubkey is a placeholder'\n",
    ],
  ];

  it.each(caught)('catches %s', (_name, file, source) => {
    expect(placeholderClaimsIn(source, file)).not.toEqual([]);
  });

  it('reports the file and the line of the claim', () => {
    const source = 'Some prose.\nThe pubkey is a placeholder.\n';
    const [offence, ...rest] = placeholderClaimsIn(source, 'a.md');
    expect(rest).toEqual([]);
    expect(offence?.file).toBe('a.md');
    expect(offence?.line).toBe(2);
    expect(offence?.why).toContain(KEY_ID);
  });
});

describe('honest text walks through', () => {
  // Every one of these is either in the corpus right now or is the correction
  // this guard exists to protect. A scanner that fires on any of them is one
  // somebody deletes in a week, taking the guard for the real defect with it.
  const honest: ReadonlyArray<readonly [string, string, string]> = [
    ['the correction itself', 'a.md', 'The pubkey is a real minisign key, not a placeholder.\n'],
    [
      'the correction, reworded',
      'a.md',
      'The signing key is no longer a placeholder — it is real and in use.\n',
    ],
    [
      'a real key described without the word at all',
      'a.md',
      'The updater public key is real, and regenerating it would break every install.\n',
    ],
    ['placeholder views, which are not keys', 'a.md', 'There are no placeholder views left.\n'],
    [
      'the search-link placeholders',
      'a.ts',
      "export const KEYWORD_PLACEHOLDER = '{keyword}';\nexport const LOCATION_PLACEHOLDER = '{location}';\n",
    ],
    [
      'a stub package README',
      'a.md',
      'This directory is a placeholder so the workspace shape is settled early.\n',
    ],
    ['an input placeholder attribute', 'a.tsx', '<input name="q" placeholder="Search jobs" />\n'],
    [
      'the signing key named with no placeholder claim near it',
      'a.md',
      'The private key and its password live in the repository secrets.\n',
    ],
    [
      'a comment in shipped source is not adjudicated',
      'a.ts',
      '// The pubkey used to be a placeholder.\nexport const x = 1;\n',
    ],
    [
      'a YAML comment is not adjudicated',
      'a.yml',
      '# running it here would fail on the placeholder signing key\nsteps: []\n',
    ],
    [
      'a fenced code sample in a document',
      'a.md',
      'Text about the pubkey.\n\n```\nplaceholder\n```\n',
    ],
  ];

  it.each(honest)('does not fire on %s', (_name, file, source) => {
    expect(placeholderClaimsIn(source, file), explain(placeholderClaimsIn(source, file))).toEqual(
      [],
    );
  });

  it('boundary: the two terms in DIFFERENT blocks are not one claim', () => {
    const source = 'The pubkey is checked on download.\n\nThere are no placeholder views left.\n';
    expect(placeholderClaimsIn(source, 'a.md')).toEqual([]);
  });

  it('boundary: empty and whitespace-only sources have nothing to say', () => {
    expect(placeholderClaimsIn('', 'a.md')).toEqual([]);
    expect(placeholderClaimsIn('   \n\n  \n', 'a.md')).toEqual([]);
    expect(blocksOf('')).toEqual([]);
  });

  it('boundary: a placeholder claim with no key term anywhere near it is not ours', () => {
    expect(placeholderClaimsIn('The org name below is a placeholder.\n', 'a.md')).toEqual([]);
  });
});
