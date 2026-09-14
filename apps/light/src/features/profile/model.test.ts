import { describe, expect, it } from 'vitest';

import { emptyProfile } from '@cviper/core-types';

import {
  EMPTY_LANGUAGE,
  EMPTY_STAR_EXAMPLE,
  addLanguage,
  addStarExample,
  linesToList,
  listToLines,
  removeLanguage,
  removeStarExample,
  textOrNull,
  withLanguage,
  withStarExample,
} from './model';

const NOW = '2026-09-14T09:00:00.000Z';

describe('linesToList', () => {
  it('splits one item per line', () => {
    expect(linesToList('Fully on-site\nBelow GBP 70k')).toEqual(['Fully on-site', 'Below GBP 70k']);
  });

  it('trims each line and drops the empty ones', () => {
    expect(linesToList('  a  \n\n   \nb\n')).toEqual(['a', 'b']);
  });

  it('accepts Windows line endings, which a pasted list often carries', () => {
    expect(linesToList('a\r\nb\r\n')).toEqual(['a', 'b']);
  });

  it('boundary: an empty box is an empty list, not a list of one empty string', () => {
    expect(linesToList('')).toEqual([]);
  });

  it('boundary: a box of nothing but blank lines is an empty list', () => {
    expect(linesToList('\n\n  \n')).toEqual([]);
  });

  it('boundary: a single line with no newline is a list of one', () => {
    expect(linesToList('just this')).toEqual(['just this']);
  });

  it('keeps spaces INSIDE an item', () => {
    expect(linesToList('hedge funds and banks')).toEqual(['hedge funds and banks']);
  });
});

describe('listToLines', () => {
  it('round-trips through linesToList', () => {
    const items = ['Banking', 'Hedge funds', 'Fintech'];
    expect(linesToList(listToLines(items))).toEqual(items);
  });

  it('boundary: an empty list is an empty box', () => {
    expect(listToLines([])).toBe('');
  });
});

describe('textOrNull', () => {
  it('keeps text, trimmed', () => {
    expect(textOrNull('  UK citizen ')).toBe('UK citizen');
  });

  it('negative: whitespace alone is nothing', () => {
    expect(textOrNull('   ')).toBeNull();
    expect(textOrNull('')).toBeNull();
  });
});

describe('language rows', () => {
  const base = emptyProfile(NOW);

  it('adds an empty row at the end, and never shares it between profiles', () => {
    const one = addLanguage(base);
    const two = addLanguage(one);
    expect(two.languages).toEqual([EMPTY_LANGUAGE, EMPTY_LANGUAGE]);
    expect(two.languages[0]).not.toBe(two.languages[1]);
    expect(base.languages).toEqual([]);
  });

  it('edits only the row named, trimming what was typed', () => {
    const edited = withLanguage(addLanguage(addLanguage(base)), 1, { name: ' French ' });
    expect(edited.languages).toEqual([EMPTY_LANGUAGE, { name: 'French', level: '' }]);
  });

  it('removes only the row named', () => {
    const withTwo = withLanguage(
      withLanguage(addLanguage(addLanguage(base)), 0, { name: 'a' }),
      1,
      {
        name: 'b',
      },
    );
    expect(removeLanguage(withTwo, 0).languages).toEqual([{ name: 'b', level: '' }]);
  });

  it('negative: an index that names no row changes nothing', () => {
    const one = addLanguage(base);
    expect(withLanguage(one, 5, { name: 'x' })).toBe(one);
    expect(removeLanguage(one, -1)).toBe(one);
    expect(removeLanguage(one, 1)).toBe(one);
  });
});

describe('STAR examples', () => {
  const base = emptyProfile(NOW);

  it('adds an empty example with all five parts', () => {
    expect(addStarExample(base).star_examples).toEqual([EMPTY_STAR_EXAMPLE]);
    expect(Object.keys(EMPTY_STAR_EXAMPLE)).toEqual([
      'title',
      'situation',
      'task',
      'action',
      'result',
    ]);
  });

  it('edits one part of one example and leaves the rest', () => {
    const edited = withStarExample(addStarExample(base), 0, { result: ' Passed. ' });
    expect(edited.star_examples[0]).toEqual({ ...EMPTY_STAR_EXAMPLE, result: 'Passed.' });
  });

  it('removes the example named', () => {
    const two = addStarExample(addStarExample(base));
    expect(removeStarExample(two, 1).star_examples).toHaveLength(1);
  });

  it('negative: an index that names no example changes nothing', () => {
    expect(withStarExample(base, 0, { title: 'x' })).toBe(base);
    expect(removeStarExample(base, 0)).toBe(base);
  });
});
