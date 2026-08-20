import { type BoardTemplate } from '@cviper/core-types';
import { describe, expect, it } from 'vitest';

import {
  NO_PREFERENCES,
  addCustomBoard,
  customBoardFrom,
  mergeBoards,
  moveBoard,
  parseBoardPreferences,
  removeCustomBoard,
  setBoardEnabled,
  validateCustomBoard,
  type BoardPreferences,
} from './model';

const SHIPPED: readonly BoardTemplate[] = [
  {
    id: 'linkedin',
    label: 'LinkedIn',
    urlTemplate: 'https://a.invalid/{keyword}',
    encoding: 'plus',
  },
  { id: 'indeed', label: 'Indeed', urlTemplate: 'https://b.invalid/{keyword}', encoding: 'plus' },
  { id: 'reed', label: 'Reed', urlTemplate: 'https://c.invalid/{keyword}', encoding: 'hyphen' },
];

const A_CUSTOM: BoardTemplate = {
  id: 'custom-efinancialcareers',
  label: 'eFinancialCareers',
  urlTemplate: 'https://d.invalid/{keyword}',
  encoding: 'plus',
};

function ids(boards: readonly { id: string }[]): string[] {
  return boards.map((board) => board.id);
}

describe('mergeBoards — shipped defaults are the base, the user is the overlay', () => {
  it('is the shipped list, all enabled, when the user has changed nothing', () => {
    const merged = mergeBoards(SHIPPED, NO_PREFERENCES);

    expect(ids(merged)).toEqual(['linkedin', 'indeed', 'reed']);
    expect(merged.every((board) => board.enabled)).toBe(true);
    expect(merged.every((board) => !board.userAdded)).toBe(true);
  });

  it('marks a disabled board disabled, and keeps it in the list', () => {
    // Never removed. A board the user switched off has to stay visible in
    // Settings or they cannot switch it back on.
    const merged = mergeBoards(SHIPPED, { ...NO_PREFERENCES, disabled: ['indeed'] });

    expect(ids(merged)).toEqual(['linkedin', 'indeed', 'reed']);
    expect(merged.map((board) => board.enabled)).toEqual([true, false, true]);
  });

  it('follows the user order, then appends anything they have never seen', () => {
    const merged = mergeBoards(SHIPPED, { ...NO_PREFERENCES, order: ['reed', 'linkedin'] });

    expect(ids(merged)).toEqual(['reed', 'linkedin', 'indeed']);
  });

  it('A NEW SHIPPED BOARD APPEARS even for somebody who has disabled others', () => {
    // The whole reason `disabled` is a list of what is OFF rather than a list
    // of what is ON. An allow-list would silently hide every board added after
    // the user last touched this screen.
    const user: BoardPreferences = {
      disabled: ['indeed'],
      order: ['reed', 'linkedin', 'indeed'],
      custom: [],
    };

    const withNewBoard = mergeBoards([...SHIPPED, { ...A_CUSTOM, id: 'adzuna' }], user);

    expect(ids(withNewBoard)).toEqual(['reed', 'linkedin', 'indeed', 'adzuna']);
    expect(withNewBoard.find((board) => board.id === 'adzuna')?.enabled).toBe(true);
  });

  it('A DISABLED BOARD IS NOT RESURRECTED when the shipped list grows', () => {
    const user: BoardPreferences = { disabled: ['indeed'], order: [], custom: [] };
    const withNewBoard = mergeBoards([...SHIPPED, { ...A_CUSTOM, id: 'adzuna' }], user);

    expect(withNewBoard.find((board) => board.id === 'indeed')?.enabled).toBe(false);
  });

  it('carries the user own boards, flagged as theirs', () => {
    const merged = mergeBoards(SHIPPED, { ...NO_PREFERENCES, custom: [A_CUSTOM] });

    expect(ids(merged)).toEqual(['linkedin', 'indeed', 'reed', A_CUSTOM.id]);
    expect(merged.at(-1)?.userAdded).toBe(true);
  });

  it('negative: a custom board that steals a shipped id never shadows it', () => {
    // Only reachable by hand-editing the store file. The shipped template wins.
    const merged = mergeBoards(SHIPPED, {
      ...NO_PREFERENCES,
      custom: [{ ...A_CUSTOM, id: 'reed', urlTemplate: 'https://evil.invalid/{keyword}' }],
    });

    expect(ids(merged)).toEqual(['linkedin', 'indeed', 'reed']);
    expect(merged.find((board) => board.id === 'reed')?.urlTemplate).toBe(
      'https://c.invalid/{keyword}',
    );
  });

  it('negative: an order naming a board that no longer ships is ignored', () => {
    const merged = mergeBoards(SHIPPED, {
      ...NO_PREFERENCES,
      order: ['gone', 'reed', 'also-gone'],
    });

    expect(ids(merged)).toEqual(['reed', 'linkedin', 'indeed']);
  });

  it('boundary: no shipped boards and no custom boards is an empty list, not a crash', () => {
    expect(mergeBoards([], NO_PREFERENCES)).toEqual([]);
  });
});

describe('changing the preferences', () => {
  it('switches a board off and back on', () => {
    const off = setBoardEnabled(NO_PREFERENCES, 'indeed', false);
    expect(off.disabled).toEqual(['indeed']);

    const on = setBoardEnabled(off, 'indeed', true);
    expect(on.disabled).toEqual([]);
  });

  it('boundary: switching off twice records it once', () => {
    const twice = setBoardEnabled(
      setBoardEnabled(NO_PREFERENCES, 'indeed', false),
      'indeed',
      false,
    );
    expect(twice.disabled).toEqual(['indeed']);
  });

  it('moves a board up and down, writing the whole order out', () => {
    const boards = mergeBoards(SHIPPED, NO_PREFERENCES);

    expect(moveBoard(NO_PREFERENCES, boards, 'reed', 'up').order).toEqual([
      'linkedin',
      'reed',
      'indeed',
    ]);
    expect(moveBoard(NO_PREFERENCES, boards, 'linkedin', 'down').order).toEqual([
      'indeed',
      'linkedin',
      'reed',
    ]);
  });

  it('boundary: the first board cannot move up and the last cannot move down', () => {
    const boards = mergeBoards(SHIPPED, NO_PREFERENCES);

    expect(moveBoard(NO_PREFERENCES, boards, 'linkedin', 'up')).toEqual(NO_PREFERENCES);
    expect(moveBoard(NO_PREFERENCES, boards, 'reed', 'down')).toEqual(NO_PREFERENCES);
  });

  it('negative: moving a board that is not there changes nothing', () => {
    const boards = mergeBoards(SHIPPED, NO_PREFERENCES);
    expect(moveBoard(NO_PREFERENCES, boards, 'nope', 'up')).toEqual(NO_PREFERENCES);
  });

  it('adds and removes a custom board', () => {
    const added = addCustomBoard(NO_PREFERENCES, A_CUSTOM);
    expect(added.custom).toEqual([A_CUSTOM]);

    const removed = removeCustomBoard(added, A_CUSTOM.id);
    expect(removed.custom).toEqual([]);
  });

  it('forgets a removed board disabled flag and its place in the order', () => {
    // Otherwise re-adding a board with the same name brings back a preference
    // the user set for something they deleted.
    const added = addCustomBoard(NO_PREFERENCES, A_CUSTOM);
    const off = setBoardEnabled(added, A_CUSTOM.id, false);
    const ordered = moveBoard(off, mergeBoards(SHIPPED, off), A_CUSTOM.id, 'up');

    const removed = removeCustomBoard(ordered, A_CUSTOM.id);

    expect(removed.disabled).not.toContain(A_CUSTOM.id);
    expect(removed.order).not.toContain(A_CUSTOM.id);
  });
});

describe('the custom-board form', () => {
  const GOOD = {
    label: 'eFinancialCareers',
    urlTemplate: 'https://d.invalid/jobs?q={keyword}&loc={location}',
    encoding: 'plus' as const,
  };

  it('accepts a board with a label, a {keyword} and an https template', () => {
    expect(validateCustomBoard(GOOD)).toEqual({});
  });

  it('turns an accepted draft into a board with a namespaced id', () => {
    const made = customBoardFrom(GOOD, []);

    expect(made?.id).toBe('custom-efinancialcareers');
    expect(made?.label).toBe('eFinancialCareers');
    expect(made?.encoding).toBe('plus');
  });

  it('boundary: a second board with the same name gets its own id', () => {
    const first = customBoardFrom(GOOD, []);
    const second = customBoardFrom(GOOD, [first?.id ?? '']);

    expect(second?.id).toBe('custom-efinancialcareers-2');
  });

  it('negative: refuses a template with no {keyword}', () => {
    const errors = validateCustomBoard({ ...GOOD, urlTemplate: 'https://d.invalid/jobs' });

    expect(errors.urlTemplate).toContain('{keyword}');
    expect(customBoardFrom({ ...GOOD, urlTemplate: 'https://d.invalid/jobs' }, [])).toBeNull();
  });

  it('negative: refuses a template that is not http or https', () => {
    for (const urlTemplate of [
      'javascript:alert({keyword})',
      'file:///c:/{keyword}',
      'data:text/html,{keyword}',
      'd.invalid/{keyword}',
    ]) {
      expect(validateCustomBoard({ ...GOOD, urlTemplate }).urlTemplate, urlTemplate).toBeTypeOf(
        'string',
      );
      expect(customBoardFrom({ ...GOOD, urlTemplate }, []), urlTemplate).toBeNull();
    }
  });

  it('negative: refuses a template whose HOST is the thing the user types', () => {
    expect(
      validateCustomBoard({ ...GOOD, urlTemplate: 'https://{keyword}' }).urlTemplate,
    ).toBeTypeOf('string');
  });

  it('negative: refuses an empty label', () => {
    expect(validateCustomBoard({ ...GOOD, label: '   ' }).label).toBeTypeOf('string');
    expect(customBoardFrom({ ...GOOD, label: '   ' }, [])).toBeNull();
  });

  it('boundary: a label of nothing but punctuation still yields a usable id', () => {
    const made = customBoardFrom({ ...GOOD, label: '!!!' }, []);
    expect(made?.id).toBe('custom-board');
  });

  it('boundary: a template that is valid WITH a location but broken without one is refused', () => {
    // The state the brief calls out: it must not be saveable if it can produce
    // an invalid URL, and the empty box is the case a happy-path check misses.
    expect(
      validateCustomBoard({ ...GOOD, urlTemplate: 'https://{location}/{keyword}' }).urlTemplate,
    ).toBeTypeOf('string');
  });
});

describe('parseBoardPreferences — reading whatever is in the store', () => {
  it('reads back what was written', () => {
    const written: BoardPreferences = {
      disabled: ['indeed'],
      order: ['reed', 'linkedin'],
      custom: [A_CUSTOM],
    };

    expect(parseBoardPreferences(JSON.parse(JSON.stringify(written)))).toEqual(written);
  });

  it('negative: anything that is not an object is no preferences at all', () => {
    for (const raw of [null, undefined, 'preferences', 7, []]) {
      expect(parseBoardPreferences(raw)).toEqual(NO_PREFERENCES);
    }
  });

  it('negative: fields of the wrong type fall back one at a time', () => {
    const parsed = parseBoardPreferences({ disabled: 'indeed', order: ['reed'], custom: 3 });

    expect(parsed).toEqual({ disabled: [], order: ['reed'], custom: [] });
  });

  it('negative: one unreadable custom board loses that board, not the list', () => {
    const parsed = parseBoardPreferences({
      disabled: [],
      order: [],
      custom: [A_CUSTOM, { id: 'broken' }, { ...A_CUSTOM, id: 'custom-two', encoding: 'runes' }],
    });

    expect(parsed.custom).toEqual([A_CUSTOM]);
  });

  it('boundary: a completely empty object is the same as no preferences', () => {
    expect(parseBoardPreferences({})).toEqual(NO_PREFERENCES);
  });
});
