import { describe, expect, it } from 'vitest';

import { lineDiff } from './diff';

describe('lineDiff', () => {
  it('marks kept, added and removed lines, in order', () => {
    const original = 'Steve Brady\nAnalyst, Barclays\n- Ran stress tests.\nBSc Mathematics';
    const revised =
      'Steve Brady\nAnalyst, Barclays\n- Ran stress tests for 12 portfolios.\nBSc Mathematics';
    expect(lineDiff(original, revised)).toEqual([
      { kind: 'same', text: 'Steve Brady' },
      { kind: 'same', text: 'Analyst, Barclays' },
      { kind: 'removed', text: '- Ran stress tests.' },
      { kind: 'added', text: '- Ran stress tests for 12 portfolios.' },
      { kind: 'same', text: 'BSc Mathematics' },
    ]);
  });

  it('shows a dropped role as removed lines where it used to be', () => {
    const original = 'A\nB\nC';
    const revised = 'A\nC';
    expect(lineDiff(original, revised)).toEqual([
      { kind: 'same', text: 'A' },
      { kind: 'removed', text: 'B' },
      { kind: 'same', text: 'C' },
    ]);
  });

  it('ignores blank lines and surrounding whitespace, so a re-flow is not a change', () => {
    expect(lineDiff('A\n\n  B  \n', 'A\nB')).toEqual([
      { kind: 'same', text: 'A' },
      { kind: 'same', text: 'B' },
    ]);
  });

  it('boundary: two empty texts diff to nothing', () => {
    expect(lineDiff('', '')).toEqual([]);
    expect(lineDiff('\n\n', '   ')).toEqual([]);
  });

  it('boundary: an empty original is all additions; an empty revision is all removals', () => {
    expect(lineDiff('', 'A\nB')).toEqual([
      { kind: 'added', text: 'A' },
      { kind: 'added', text: 'B' },
    ]);
    expect(lineDiff('A', '')).toEqual([{ kind: 'removed', text: 'A' }]);
  });

  it('negative: nothing in common means every line changes', () => {
    expect(lineDiff('A\nB', 'C\nD').map((line) => line.kind)).toEqual([
      'removed',
      'removed',
      'added',
      'added',
    ]);
  });

  it('finds the longest common subsequence, not the first match', () => {
    // Greedy matching of the first "A" would lose the "B C" run.
    expect(lineDiff('A\nB\nC\nA', 'B\nC\nA')).toEqual([
      { kind: 'removed', text: 'A' },
      { kind: 'same', text: 'B' },
      { kind: 'same', text: 'C' },
      { kind: 'same', text: 'A' },
    ]);
  });

  it('boundary: past the cell budget it still answers, as everything out and everything in', () => {
    const many = Array.from({ length: 2100 }, (_, index) => `line ${index}`).join('\n');
    const result = lineDiff(many, many);
    expect(result).toHaveLength(4200);
    expect(result[0]?.kind).toBe('removed');
    expect(result[4199]?.kind).toBe('added');
  });
});
