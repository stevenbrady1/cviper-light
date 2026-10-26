/**
 * L-288 — a skill's name reads the same in a list and in a sentence.
 *
 * The skill LISTS went through the app's display map; the SUGGESTION
 * SENTENCES did not, so the same screen said "SQL" in the gap list and "The
 * advert asks for Sql" a few lines below. Reproduced by scoring a shop CV
 * against a data advert: the suggestions read "Sql", "Aws" and "Power Bi".
 */
import { describe, expect, it } from 'vitest';

import { displayTerm } from './display-names';
import { scoreByKeywords } from './score';

const ADVERT =
  'Data Analyst\n\nEssential:\n- SQL\n- Power BI\n- AWS\n- Literacy and numeracy\n' +
  '- Learning and development';
const CV =
  'Shop assistant. Customer service, stock and merchandising for five years in a busy store. ' +
  'Reliable and punctual.';

function result() {
  const scored = scoreByKeywords(CV, ADVERT);
  if (!scored.ok) throw new Error('refused');
  return scored.value;
}

describe('the scorer names skills the way the screen should show them (L-288)', () => {
  it('in the suggestion sentences', () => {
    const issues = result()
      .suggestions.map((s) => s.issue)
      .join('\n');
    expect(issues).toContain('The advert asks for SQL ');
    expect(issues).toContain('The advert asks for AWS ');
    expect(issues).toContain('The advert asks for Power BI ');
    // NEGATIVE — the wrong spellings are gone from every sentence.
    expect(issues).not.toMatch(/\bSql\b|\bAws\b|Power Bi\b/);
  });

  it('in the missing-skills list', () => {
    expect(result().missing_skills).toEqual(
      expect.arrayContaining([
        'SQL',
        'AWS',
        'Power BI',
        'Literacy and Numeracy',
        'Learning and Development',
      ]),
    );
  });
});

describe('small joining words stay lower-case', () => {
  it.each([
    ['Literacy And Numeracy', 'Literacy and Numeracy'],
    ['End Of Life Care', 'End of Life Care'],
    ['Moving And Handling', 'Moving and Handling'],
    ['GCSE English And Maths', 'GCSE English and Maths'],
  ])('%j -> %j', (raw, shown) => {
    expect(displayTerm(raw)).toBe(shown);
  });

  // NEGATIVE — only the whole words "and" and "of"; never part of a word.
  it.each(['Andover Depot', 'Offshore Wind', 'Brand Management', 'Office 365'])(
    'leaves %j alone',
    (term) => {
      expect(displayTerm(term)).toBe(term);
    },
  );

  // BOUNDARY — applying it twice changes nothing, so the app's own pass over an
  // already-displayed name is harmless.
  it('is idempotent', () => {
    for (const raw of ['Sql', 'Power Bi', 'Literacy And Numeracy', 'Risk']) {
      expect(displayTerm(displayTerm(raw))).toBe(displayTerm(raw));
    }
  });
});
