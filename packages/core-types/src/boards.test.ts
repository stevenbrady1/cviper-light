import { describe, expect, it } from 'vitest';

import {
  BOARD_ENCODINGS,
  BoardTemplateSchema,
  KEYWORD_PLACEHOLDER,
  LOCATION_PLACEHOLDER,
  type BoardTemplate,
} from './boards';

const A_BOARD: BoardTemplate = {
  id: 'reed',
  label: 'Reed',
  urlTemplate: 'https://www.reed.co.uk/jobs/{keyword}-jobs-in-{location}',
  encoding: 'hyphen',
};

describe('BoardTemplate', () => {
  it('accepts a board of the shape the shipped config uses', () => {
    const parsed = BoardTemplateSchema.safeParse(A_BOARD);

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toEqual(A_BOARD);
  });

  it('knows exactly two encodings, and no third', () => {
    // The builder switches on this. A third value added here without a branch
    // there would silently fall through to one of the two.
    expect([...BOARD_ENCODINGS]).toEqual(['hyphen', 'plus']);
  });

  it('names the placeholders once, so the builder and the validator agree', () => {
    expect(KEYWORD_PLACEHOLDER).toBe('{keyword}');
    expect(LOCATION_PLACEHOLDER).toBe('{location}');
    expect(A_BOARD.urlTemplate).toContain(KEYWORD_PLACEHOLDER);
  });

  it('negative: refuses an encoding nobody implements', () => {
    const parsed = BoardTemplateSchema.safeParse({ ...A_BOARD, encoding: 'underscore' });

    expect(parsed.success).toBe(false);
  });

  it('negative: refuses a board with no id, label or template', () => {
    for (const field of ['id', 'label', 'urlTemplate'] as const) {
      const parsed = BoardTemplateSchema.safeParse({ ...A_BOARD, [field]: '' });
      expect(parsed.success, field).toBe(false);
    }
  });

  it('negative: refuses a board that is not an object at all', () => {
    for (const raw of [null, 'reed', 42, []]) {
      expect(BoardTemplateSchema.safeParse(raw).success).toBe(false);
    }
  });

  it('boundary: an extra key is dropped rather than carried into the app', () => {
    // A hand-edited store file must not smuggle a field the app never checks
    // into the object the URL builder is handed.
    const parsed = BoardTemplateSchema.safeParse({ ...A_BOARD, onClick: 'alert(1)' });

    expect(parsed.success).toBe(true);
    expect(parsed.success && Object.keys(parsed.data).sort()).toEqual([
      'encoding',
      'id',
      'label',
      'urlTemplate',
    ]);
  });
});
