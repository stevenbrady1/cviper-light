/**
 * The contrast contract (L-209).
 *
 * `text-teal` (#0e9f6e) on `bg-teal/10` or `bg-sunken` measures about 3:1, below
 * the WCAG 2.1 AA floor of 4.5:1 for normal text, and nothing noticed because
 * every token was chosen by eye. This reads theme.css, finds every text colour
 * used in the same class string as a background colour, composites any alpha
 * background over the surface it could sit on, and fails below 4.5:1.
 *
 * ============================================================================
 * HOW IT PAIRS THINGS, AND WHERE IT IS BLIND
 * ============================================================================
 * It is grep-based. It scans the non-test `.ts`/`.tsx` source of `apps/light/src`
 * and `packages/ui/src`, pulls out every quoted string, and inside each string
 * pairs every `text-*` / `placeholder:text-*` token with every `bg-*` token.
 *
 *   * A string with no `bg-*` is checked against `canvas` (the page) and `card`
 *     (a card), the two surfaces text normally lands on.
 *   * A string whose `bg-*` has an alpha (`bg-teal/10`) is composited over
 *     `card`, `canvas` and `sunken`, because the string cannot say which one is
 *     behind it. The worst case decides.
 *   * Variants (`hover:`, `focus:`, `placeholder:`) are ignored when pairing, so
 *     a hover background is checked against the resting text colour. That is
 *     deliberate: it is a state the user really sees.
 *
 * It CANNOT see: a text colour whose background is set by a parent in another
 * component or file (the parent's surface is invisible to a grep), classes built
 * by string concatenation, inline `style`, or non-text colours (borders, icons,
 * `fill-*`, which WCAG holds to 3:1 rather than 4.5:1). Those need a rendered
 * check. The theme has no dark mode today; `the theme has no dark variant` fails
 * the day one appears, so this audit cannot silently go stale.
 *
 * Large or bold text may be 3:1. Nothing is exempt automatically; if a pair is
 * genuinely large text or an icon, it goes in ALLOWLIST below with a reason.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const THEME = fileURLToPath(new URL('./theme.css', import.meta.url));
const REPO = fileURLToPath(new URL('../../../..', import.meta.url));
const ROOTS = [join(REPO, 'apps/light/src'), join(REPO, 'packages/ui/src')];

const AA_TEXT = 4.5;

/** Explicit, justified exceptions. Empty is the goal. */
const ALLOWLIST: readonly { file: string; text: string; bg: string; reason: string }[] = [];

type Rgb = readonly [number, number, number];

function parseTokens(css: string): Map<string, Rgb> {
  const tokens = new Map<string, Rgb>();
  for (const m of css.matchAll(/--color-([a-z-]+):\s*#([0-9a-fA-F]{6})\s*;/g)) {
    const hex = m[2] as string;
    tokens.set(m[1] as string, [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ]);
  }
  return tokens;
}

function luminance([r, g, b]: Rgb): number {
  const lin = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** `fg` at `alpha` over `base`. */
function composite(fg: Rgb, base: Rgb, alpha: number): Rgb {
  return [0, 1, 2].map((i) => fg[i]! * alpha + base[i]! * (1 - alpha)) as unknown as Rgb;
}

interface Use {
  readonly name: string;
  readonly alpha: number;
  /** State variants such as `hover` or `disabled`; '' for the resting state. */
  readonly state: string;
}
interface Pair {
  readonly text: Use;
  readonly bg: Use | null;
  readonly line: number;
}

/**
 * States that WCAG 1.4.3 exempts: "inactive user interface components" carry no
 * contrast requirement. A disabled button is the only case in this app.
 */
const EXEMPT_STATES: Readonly<Record<string, string>> = {
  disabled: 'WCAG 1.4.3 exempts inactive (disabled) UI components from the contrast minimum',
};

const BREAKPOINTS = new Set(['sm', 'md', 'lg', 'xl', '2xl']);

function colourRegex(names: readonly string[], prefix: string): RegExp {
  const alt = [...names].sort((a, b) => b.length - a.length).join('|');
  return new RegExp(`(?<![\\w-])((?:[a-z0-9-]+:)*)${prefix}-(${alt})(?:/(\\d+))?(?![\\w-])`, 'g');
}

function uses(body: string, re: RegExp): Use[] {
  return [...body.matchAll(re)].map((m) => ({
    name: m[2] as string,
    alpha: m[3] ? Number(m[3]) / 100 : 1,
    state: (m[1] as string)
      .split(':')
      .filter((v) => v !== '' && !BREAKPOINTS.has(v))
      .join(':'),
  }));
}

// ' and " cannot span lines, which keeps apostrophes in JSX prose from
// swallowing the code between them; only a template literal may.
const LITERAL =
  /'([^'\n\\]*(?:\\.[^'\n\\]*)*)'|"([^"\n\\]*(?:\\.[^"\n\\]*)*)"|`((?:\\[\s\S]|[^`\\])*)`/g;

/**
 * Every text/bg pairing, one quoted string at a time, one STATE at a time. A
 * state (`hover`, `disabled`, ...) replaces the resting colour only where it
 * names one: `bg-blue text-ink-inverse hover:bg-navy` is judged as inverse-on-blue
 * and inverse-on-navy, and `disabled:bg-line disabled:text-ink-faint` as its own
 * pair, never as faint-on-blue.
 */
function findPairs(source: string, names: readonly string[]): Pair[] {
  const textRe = colourRegex(names, 'text');
  const bgRe = colourRegex(names, 'bg');
  const pairs: Pair[] = [];
  for (const lit of source.matchAll(LITERAL)) {
    const body = (lit[1] ?? lit[2] ?? lit[3]) as string;
    const line = source.slice(0, lit.index).split('\n').length;
    const texts = uses(body, textRe);
    if (texts.length === 0) continue;
    const bgs = uses(body, bgRe);
    const states = new Set([...texts, ...bgs].map((u) => u.state));
    states.add('');
    for (const state of states) {
      const own = texts.filter((u) => u.state === state);
      const stateTexts = own.length > 0 ? own : texts.filter((u) => u.state === '');
      const ownBg = bgs.filter((u) => u.state === state);
      const stateBgs = ownBg.length > 0 ? ownBg : bgs.filter((u) => u.state === '');
      for (const text of stateTexts) {
        if (stateBgs.length === 0) pairs.push({ text, bg: null, line });
        for (const bg of stateBgs) pairs.push({ text, bg, line });
      }
    }
  }
  return pairs;
}

/** Ink that is only ever read on the navy rail: it is judged against navy. */
const INVERSE = new Set(['ink-inverse', 'ink-inverse-muted']);

const BASE_SURFACES = ['canvas', 'card'] as const;
const ALPHA_SURFACES = ['card', 'canvas', 'sunken'] as const;

/** Lowest ratio over every surface the pair could sit on. */
function worstRatio(pair: Pair, tokens: Map<string, Rgb>): number {
  const get = (n: string): Rgb => {
    const v = tokens.get(n);
    if (!v) throw new Error(`no --color-${n} in theme.css`);
    return v;
  };
  const inverse = INVERSE.has(pair.text.name);
  const surfaces: Rgb[] = [];
  if (pair.bg === null) {
    for (const s of inverse ? ['navy'] : BASE_SURFACES) surfaces.push(get(s));
  } else if (pair.bg.alpha >= 1) {
    surfaces.push(get(pair.bg.name));
  } else {
    for (const s of inverse ? ['navy'] : ALPHA_SURFACES) {
      surfaces.push(composite(get(pair.bg.name), get(s), pair.bg.alpha));
    }
  }
  return Math.min(
    ...surfaces.map((surface) =>
      contrast(composite(get(pair.text.name), surface, pair.text.alpha), surface),
    ),
  );
}

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') found.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found.sort();
}

/** Bare brand colours as text: `text-teal`, `hover:text-gold`; not `text-teal-ink`. */
const BARE_BRAND_TEXT = /(?<![w-])(?:[a-z0-9-]+:)*text-(?:teal|gold)(?![w-])/g;

const css = readFileSync(THEME, 'utf8');
const tokens = parseTokens(css);
const names = [...tokens.keys()];

function label(bg: Use | null): string {
  if (bg === null) return '(page/card)';
  return bg.alpha < 1 ? `${bg.name}/${Math.round(bg.alpha * 100)}` : bg.name;
}

function failures(): string[] {
  const out: string[] = [];
  for (const root of ROOTS) {
    for (const file of sourceFiles(root)) {
      const rel = relative(REPO, file).replaceAll('\\', '/');
      for (const pair of findPairs(readFileSync(file, 'utf8'), names)) {
        if (pair.text.state.split(':').some((v) => v in EXEMPT_STATES)) continue;
        const ratio = worstRatio(pair, tokens);
        if (ratio >= AA_TEXT) continue;
        const bg = label(pair.bg);
        if (ALLOWLIST.some((a) => a.file === rel && a.text === pair.text.name && a.bg === bg)) {
          continue;
        }
        out.push(`${rel}:${pair.line}  text-${pair.text.name} on ${bg} = ${ratio.toFixed(2)}:1`);
      }
    }
  }
  return out;
}

describe('text contrast contract (WCAG 2.1 AA, 4.5:1)', () => {
  it('finds the theme tokens and the source files', () => {
    expect(tokens.get('teal')).toBeDefined();
    expect(names.length).toBeGreaterThan(10);
    expect(ROOTS.flatMap(sourceFiles).length).toBeGreaterThan(20);
  });

  it('every text colour used with a background meets 4.5:1', () => {
    expect(failures()).toEqual([]);
  });

  it('no source uses bare text-teal or text-gold; words use the -ink tokens', () => {
    const offences: string[] = [];
    for (const root of ROOTS) {
      for (const file of sourceFiles(root)) {
        const found = readFileSync(file, 'utf8').match(BARE_BRAND_TEXT);
        if (found) offences.push(`${relative(REPO, file)}: ${found.join(', ')}`);
      }
    }
    expect(offences).toEqual([]);
  });

  it('allowlist entries each carry a reason', () => {
    for (const a of ALLOWLIST) expect(a.reason.length).toBeGreaterThan(10);
  });

  it('the theme has no dark variant, so the light-only audit is complete', () => {
    expect(css).not.toMatch(/prefers-color-scheme:\s*dark|\.dark\b|\[data-theme/);
  });

  describe('the checker can actually fail', () => {
    it('flags the L-209 case: a teal tint under teal text, from the original tokens', () => {
      const original = new Map(tokens);
      original.set('teal', [0x0e, 0x9f, 0x6e]);
      const [pair] = findPairs("const c = 'bg-teal/10 px-3 text-teal';", names);
      expect(pair).toBeDefined();
      expect(worstRatio(pair!, original)).toBeLessThan(AA_TEXT);
    });

    it('composites alpha rather than using the raw token', () => {
      const [pair] = findPairs("'bg-gold/10 text-ink'", names);
      const raw = contrast(tokens.get('ink')!, tokens.get('gold')!);
      expect(worstRatio(pair!, tokens)).toBeGreaterThan(raw);
    });

    it('does not confuse text-ink with text-ink-muted or text-xs', () => {
      const pairs = findPairs("'text-ink-muted text-xs bg-card'", names);
      expect(pairs.map((p) => p.text.name)).toEqual(['ink-muted']);
    });

    it('sees variant-prefixed tokens and judges a failing pair', () => {
      const weak = new Map(tokens);
      weak.set('ink-faint', [0x9a, 0xa5, 0xb5]);
      const pairs = findPairs("'placeholder:text-ink-faint bg-sunken'", names);
      expect(pairs).toHaveLength(1);
      expect(worstRatio(pairs[0]!, weak)).toBeLessThan(AA_TEXT);
    });

    it('the bare-brand guard catches text-teal and variants, not the -ink tokens', () => {
      const hits = "'text-teal hover:text-gold text-teal-ink text-gold-ink'".match(BARE_BRAND_TEXT);
      expect(hits).toEqual(['text-teal', 'hover:text-gold']);
    });

    it('pairs and judges a group-hover: variant', () => {
      const weak = new Map(tokens);
      weak.set('ink-faint', [0x9a, 0xa5, 0xb5]);
      const pairs = findPairs("'bg-card group-hover:text-ink-faint'", names);
      expect(pairs.map((p) => p.text.state)).toContain('group-hover');
      expect(pairs.every((p) => worstRatio(p, weak) < AA_TEXT)).toBe(true);
    });

    it('a placeholder: text colour is judged against the surrounding background', () => {
      const [pair] = findPairs("'bg-sunken placeholder:text-ink-faint'", names);
      expect(pair!.text.state).toBe('placeholder');
      expect(pair!.bg?.name).toBe('sunken');
      expect(worstRatio(pair!, tokens)).toBeGreaterThanOrEqual(AA_TEXT);
    });

    it('boundary: black on white is 21:1, the same colour is 1:1', () => {
      expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
      expect(contrast([9, 9, 9], [9, 9, 9])).toBeCloseTo(1, 5);
    });

    it('negative: a string with no text colour yields no pairs', () => {
      expect(findPairs("'bg-sunken px-3'", names)).toEqual([]);
    });
  });
});
