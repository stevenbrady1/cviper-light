/**
 * Ported from `backend/ai/keywords.py::_fold_spelling` (line 53) and the
 * `_US_TO_UK` table above it (line 30).
 */
import { describe, expect, it } from 'vitest';
import { US_TO_UK, foldSpelling } from './spelling';

describe('foldSpelling', () => {
  it('folds a US spelling to its UK form', () => {
    expect(foldSpelling('organize the analyze work')).toBe('organise the analyse work');
  });

  it('leaves a UK spelling untouched (idempotent)', () => {
    expect(foldSpelling('organise')).toBe('organise');
    expect(foldSpelling(foldSpelling('organize'))).toBe(foldSpelling('organize'));
  });

  it.each([
    ['organize', 'organise'],
    ['organization', 'organisation'],
    ['analyze', 'analyse'],
    ['analyzing', 'analysing'],
    ['optimization', 'optimisation'],
    ['prioritize', 'prioritise'],
    ['modeling', 'modelling'],
    ['licensed', 'licenced'],
  ])('folds %s -> %s', (us, uk) => {
    expect(foldSpelling(us)).toBe(uk);
  });

  // NEGATIVE — the curated table exists precisely so a generic -ize/-our rule
  // can never mangle these.
  it.each(['program', 'hour', 'your', 'flour', 'sour', 'prize', 'size'])(
    'never mis-folds %s',
    (word) => {
      expect(foldSpelling(word)).toBe(word);
    },
  );

  // NEGATIVE — whole-word only. "reorganize" is not in the table and the \b
  // anchors must stop a partial rewrite.
  it('only folds whole words', () => {
    expect(foldSpelling('unorganized')).toBe('unorganized');
    expect(foldSpelling('colorado')).toBe('colorado');
  });

  // BOUNDARY
  it('handles empty and whitespace-only input', () => {
    expect(foldSpelling('')).toBe('');
    expect(foldSpelling('   ')).toBe('   ');
  });

  it('is case-sensitive because callers lowercase first', () => {
    // The source folds text that is ALREADY lowercased. Documenting that
    // contract here so a caller that forgets it fails loudly in review.
    expect(foldSpelling('Organize')).toBe('Organize');
  });

  it('carries every pair from the source table', () => {
    expect(US_TO_UK['optimization']).toBe('optimisation');
    expect(US_TO_UK['program']).toBeUndefined();
    expect(Object.keys(US_TO_UK).length).toBe(54);
  });
});
