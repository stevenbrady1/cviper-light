/**
 * A class added on top of a shared button style must not fight it (L-459).
 *
 * `buttons.ts` sets a button's text colour, background, padding and corner. A
 * call site that writes `${QUIET_BUTTON} px-0 text-blue` looks as if it
 * changes those, but Tailwind's stylesheet order decides the winner, not the
 * order in the string, and the shared style wins: `px-0` and `text-blue` did
 * nothing, and the reader believed they did. Dead classes also hide the day
 * the shared style changes and the call site was never as it looked.
 *
 * FORBID-LIST (LESSON-033). A class string that interpolates a button style
 * from `buttons.ts` must not also hold a utility from a property group that
 * style already sets, in the same state (`hover:` against `hover:`). Needing
 * a different look means a new style in `buttons.ts`, not an override.
 * Additions that set something the style does not (`w-full`, `mt-2`,
 * `text-xs`, `border`) are fine.
 *
 * The style definitions are READ from `buttons.ts` when the test runs, so
 * the rule follows the file. This reads the SOURCE, one template literal at a
 * time (jsdom resolves no stylesheet). Comments are stripped first, so the
 * comment explaining the rule can neither trip it nor satisfy it. A class
 * joined by `+` or passed through a variable is invisible to it.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as buttons from './buttons';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const ROOTS = ['apps/light/src', 'packages/ui/src'];

const TEMPLATE = /`((?:\\[\s\S]|[^`\\])*)`/g;
const INTERPOLATION = /\$\{[^}]*\}/g;

/** Every exported `*_BUTTON` string: a new style is covered without editing this file. */
const STYLES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries<unknown>(buttons).filter(
    (entry): entry is [string, string] => /_BUTTON$/.test(entry[0]) && typeof entry[1] === 'string',
  ),
);

const NAVY_HOVER =
  'Measured in WebKit: this one WINS over hover:text-ink (the link goes navy, not ink, under ' +
  'the pointer). It is kept so L-459 changes nothing visible. Decide it with the style: if it ' +
  'is wanted, make it part of a link style in buttons.ts and delete this entry.';

/**
 * Explicit exceptions: file, style and the exact conflicting class, with the
 * reason. An override that really wins belongs in `buttons.ts`.
 */
const ALLOWED: readonly { file: string; style: string; utility: string; reason: string }[] = [
  'features/search/ProviderToggles.tsx',
  'features/settings/about/About.tsx',
  'features/settings/keys/AiKeySetup.tsx',
  'features/settings/keys/KeySetup.tsx',
  'features/tracker/PasteJobForm.tsx',
].map((file) => ({
  file: `apps/light/src/${file}`,
  style: 'QUIET_BUTTON',
  utility: 'hover:text-navy',
  reason: NAVY_HOVER,
}));

const FONT_SIZE = /^text-(xs|sm|base|lg|[2-9]?xl|\[\d[^\]]*\])$/;
const TEXT_LAYOUT =
  /^text-(left|right|center|justify|start|end|wrap|nowrap|balance|pretty|ellipsis|clip)$/;

/** The property groups a utility sets. `p-*` sets two. */
function groups(utility: string): string[] {
  if (/^text-/.test(utility)) {
    return FONT_SIZE.test(utility) || TEXT_LAYOUT.test(utility) ? [] : ['text colour'];
  }
  if (/^bg-/.test(utility)) return ['background'];
  if (/^px-/.test(utility)) return ['padding-x'];
  if (/^py-/.test(utility)) return ['padding-y'];
  if (/^p-/.test(utility)) return ['padding-x', 'padding-y'];
  return [];
}

/** `hover:text-ink` into its state and utility; arbitrary `[...]` colons are not variants. */
function split(token: string): { variants: string; utility: string } {
  const cut = token.replace(/\[[^\]]*\]/g, '[]').lastIndexOf(':');
  return {
    variants: token
      .slice(0, cut + 1)
      .split(':')
      .sort()
      .join(':'),
    utility: token.slice(cut + 1).replace(/^[!-]/, ''),
  };
}

function setBy(classes: string): Map<string, string> {
  const set = new Map<string, string>();
  for (const token of classes.split(/\s+/).filter(Boolean)) {
    const { variants, utility } = split(token);
    for (const group of groups(utility)) set.set(`${variants}|${group}`, token);
  }
  return set;
}

/** Blank out comments, keeping every newline so line numbers stay true. */
export function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '))
    .replace(/(^|\s)\/\/.*$/gm, '$1');
}

interface Override {
  readonly file: string;
  readonly line: number;
  readonly style: string;
  readonly utility: string;
  readonly beats: string;
}

/** Every template literal, outside comments, that adds a class the interpolated style already sets. */
export function overrides(file: string, source: string): Override[] {
  const code = withoutComments(source);
  const found: Override[] = [];
  for (const literal of code.matchAll(TEMPLATE)) {
    const body = literal[1] ?? '';
    const used = Object.keys(STYLES).filter((name) =>
      [...body.matchAll(INTERPOLATION)].some((hole) => new RegExp(`\\b${name}\\b`).test(hole[0])),
    );
    if (used.length === 0) continue;
    const added = body.replace(INTERPOLATION, ' ');
    for (const token of added.split(/\s+/).filter(Boolean)) {
      const { variants, utility } = split(token);
      for (const name of used) {
        const style = setBy(STYLES[name] ?? '');
        for (const group of groups(utility)) {
          const beats = style.get(`${variants}|${group}`);
          if (beats === undefined) continue;
          found.push({
            file,
            line: code.slice(0, literal.index).split('\n').length,
            style: name,
            utility: token,
            beats,
          });
        }
      }
    }
  }
  return found;
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

const FILES = ROOTS.flatMap((root) => walk(join(REPO, root)));
const FOUND = FILES.flatMap((path) =>
  overrides(relative(REPO, path).replace(/\\/g, '/'), readFileSync(path, 'utf8')),
);

function allowed(found: Override): boolean {
  return ALLOWED.some(
    (entry) =>
      entry.file === found.file && entry.style === found.style && entry.utility === found.utility,
  );
}

describe('classes on a shared button style do not fight it (L-459)', () => {
  it('reads the styles that exist and the files that use them', () => {
    // Anti-inert: an empty style list or a broken walk would pass everything below.
    expect(Object.keys(STYLES)).toEqual(
      expect.arrayContaining(['PRIMARY_BUTTON', 'SECONDARY_BUTTON', 'QUIET_BUTTON']),
    );
    expect(FILES.length).toBeGreaterThan(100);
    expect(
      FILES.filter((path) => /_BUTTON\}/.test(readFileSync(path, 'utf8'))).length,
    ).toBeGreaterThan(10);
  });

  it('no call site adds a class the shared style already sets, unless listed with a reason', () => {
    const offenders = FOUND.filter((found) => !allowed(found)).map(
      (found) =>
        `${found.file}:${String(found.line)}  ${found.utility} loses to ${found.beats} in ${found.style}`,
    );
    expect(
      offenders,
      'These classes do nothing: the shared style wins. Delete them, or make a new style in ' +
        'buttons.ts. If one really must stay, list it in ALLOWED with why.',
    ).toEqual([]);
  });

  it('no allowlist entry is stale', () => {
    for (const entry of ALLOWED) {
      expect(
        FOUND.some((found) => found.file === entry.file && found.utility === entry.utility),
        `${entry.file} ${entry.utility} is allowed but no longer used`,
      ).toBe(true);
      expect(entry.reason.length).toBeGreaterThan(30);
    }
  });

  it('boundary: a made-up override of text colour, padding and hover is reported', () => {
    const found = overrides(
      'x.tsx',
      'const a = `${QUIET_BUTTON} px-0 text-fuchsia-500 hover:bg-card hover:text-navy`;',
    );
    expect(found.map((item) => item.utility).sort()).toEqual([
      'hover:bg-card',
      'hover:text-navy',
      'px-0',
      'text-fuchsia-500',
    ]);
  });

  it('boundary: an override inside a comment is ignored', () => {
    expect(
      overrides(
        'x.tsx',
        '// `${QUIET_BUTTON} px-0 text-blue`\n/* `${QUIET_BUTTON} px-0 text-blue` */\nconst a = 1;',
      ),
    ).toEqual([]);
  });

  it('boundary: an override on a style picked by a ternary is still reported', () => {
    const found = overrides(
      'x.tsx',
      'const a = `w-full ${on ? PRIMARY_BUTTON : QUIET_BUTTON} text-fuchsia-500`;',
    );
    expect(found.map((item) => item.style).sort()).toEqual(['PRIMARY_BUTTON', 'QUIET_BUTTON']);
  });

  it('negative: additions that set something else pass', () => {
    expect(
      overrides(
        'x.tsx',
        'const a = `w-full mt-2 ml-auto text-xs min-w-11 shrink-0 border border-line ${QUIET_BUTTON}`;',
      ),
    ).toEqual([]);
  });

  it('negative: a state the style does not set is not a conflict', () => {
    // QUIET sets no `focus:` text colour or `md:` padding, so this adds rather than overrides.
    expect(overrides('x.tsx', 'const a = `${QUIET_BUTTON} focus:text-blue md:px-6`;')).toEqual([]);
  });

  it('negative: a string with no button style is never looked at', () => {
    expect(overrides('x.tsx', 'const a = `px-0 text-blue bg-card`;')).toEqual([]);
  });
});
