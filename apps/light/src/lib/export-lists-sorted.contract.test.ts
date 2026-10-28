/**
 * L-307 — the names in an `index.ts` export list keep the house order:
 * values first, then types, each sorted.
 *
 * The merge-conflict retrospective (L-303) found barrels where two pull
 * requests each added a name to the same `export { … } from` list, both at
 * the end, and git could not merge the two insertions at one spot. In a
 * sorted list, two different names land in two different places.
 *
 * The order is the one most lists already followed: value exports in code-unit
 * order (so `UPPER_CASE` constants before `camelCase` functions), then every
 * `type` export in the same order. Sorted by the EXPORTED name — `a as b`
 * sorts as `a`, the name the source module gives it.
 *
 * Deliberately NOT checked: the order of the `export … from` STATEMENTS. Each
 * barrel groups its modules by topic under comments that explain them, and
 * alphabetical would scramble those for the 2 conflicts in 27 pull requests
 * that came from statement order.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT, displayPath, walk } from './repo-scan.ts';

const LIST = /^export (type )?\{([^}]*)\} from '([^']+)';/gmu;

function byName(a: string, b: string): number {
  const left = a.split(' as ')[0] ?? a;
  const right = b.split(' as ')[0] ?? b;
  return left < right ? -1 : left > right ? 1 : 0;
}

/** The house order for one list's names. */
export function houseOrder(names: readonly string[]): string[] {
  const values = names.filter((name) => !name.startsWith('type ')).sort(byName);
  const types = names
    .filter((name) => name.startsWith('type '))
    .map((name) => name.slice('type '.length))
    .sort(byName)
    .map((name) => `type ${name}`);
  return [...values, ...types];
}

/** Every export list in `source` whose names are not in the house order. */
export function unsortedLists(source: string): string[] {
  const out: string[] = [];
  for (const match of source.matchAll(LIST)) {
    const names = (match[2] ?? '')
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name !== '');
    if (names.join(',') !== houseOrder(names).join(',')) out.push(match[3] ?? '?');
  }
  return out;
}

describe('names in index.ts export lists keep the house order (L-307)', () => {
  it('every barrel in the repo', () => {
    const barrels = [
      ...walk(`${REPO_ROOT}/apps/light/src`, { extensions: ['index.ts'] }),
      ...walk(`${REPO_ROOT}/packages`, { extensions: ['index.ts'] }),
    ];
    expect(barrels.length).toBeGreaterThan(8);
    const offences = barrels.flatMap((file) =>
      unsortedLists(readFileSync(file, 'utf8')).map((module) => `${displayPath(file)}: ${module}`),
    );
    expect(offences).toEqual([]);
  });
});

describe('the guard itself', () => {
  it('passes values then types, each in code-unit order', () => {
    expect(
      unsortedLists("export { MAX_X, alpha, beta, type Alpha, type beta } from './a';"),
    ).toEqual([]);
    expect(unsortedLists("export type { A, B, C } from './t';")).toEqual([]);
  });

  it('negative: a name added at the end, and a type before a value', () => {
    expect(unsortedLists("export { alpha, gamma, beta } from './a';")).toEqual(['./a']);
    expect(unsortedLists("export { type Alpha, alpha } from './b';")).toEqual(['./b']);
  });

  it('boundary: a renamed export sorts by its source name; one name is always sorted', () => {
    expect(unsortedLists("export { alpha as zed, beta } from './a';")).toEqual([]);
    expect(unsortedLists("export { only } from './a';")).toEqual([]);
    expect(unsortedLists("export {\n  beta,\n  alpha,\n} from './multi';")).toEqual(['./multi']);
  });
});
