/**
 * Reordering one country's boards must not forget another country's order
 * (L-422). Before there were countries, the list on screen was every board
 * there was, so writing its order out lost nothing.
 */
import { type BoardTemplate } from '@cviper/core-types';
import { describe, expect, it } from 'vitest';

import { mergeBoards, moveBoard, NO_PREFERENCES, type BoardPreferences } from './model';

const board = (id: string): BoardTemplate => ({
  id,
  label: id,
  urlTemplate: 'https://a.invalid/{keyword}',
  encoding: 'plus',
});

const UK = [board('linkedin'), board('indeed'), board('reed')];
const GERMANY = [board('linkedin'), board('indeed-de'), board('adzuna-de')];

describe('moveBoard, with boards that are not on this list', () => {
  it('keeps the order of the boards that are not shown, after the ones that are', () => {
    const uk: BoardPreferences = { ...NO_PREFERENCES, order: ['reed', 'indeed', 'linkedin'] };

    const moved = moveBoard(uk, mergeBoards(GERMANY, uk), 'adzuna-de', 'up');

    expect(moved.order).toEqual(['linkedin', 'adzuna-de', 'indeed-de', 'reed', 'indeed']);
    // Back in the United Kingdom, Reed is still above Indeed.
    const back = mergeBoards(UK, moved).map((entry) => entry.id);
    expect(back.indexOf('reed')).toBeLessThan(back.indexOf('indeed'));
  });

  it('never names a board twice', () => {
    const start: BoardPreferences = { ...NO_PREFERENCES, order: ['reed', 'linkedin', 'indeed'] };
    const once = moveBoard(start, mergeBoards(GERMANY, start), 'indeed-de', 'up');
    const twice = moveBoard(once, mergeBoards(UK, once), 'indeed', 'up');

    expect(new Set(twice.order).size).toBe(twice.order.length);
  });

  it('boundary: with nothing off the list, the order is the list, as it always was', () => {
    const moved = moveBoard(NO_PREFERENCES, mergeBoards(UK, NO_PREFERENCES), 'reed', 'up');
    expect(moved.order).toEqual(['linkedin', 'reed', 'indeed']);
  });
});
