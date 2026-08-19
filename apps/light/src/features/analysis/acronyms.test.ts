/**
 * The acronym map, from both directions.
 *
 * ============================================================================
 * WHY THIS TEST HAS TWO HALVES AND BOTH ARE REQUIRED
 * ============================================================================
 * A map that fixes `Sql` is easy. A map that fixes `Sql` and leaves `Risk`
 * alone is the whole job — because the tempting implementation ("uppercase any
 * short word") passes the first half and turns a Credit Risk Analyst's CV into
 * shouting. So every casing assertion below is paired with a leave-alone
 * assertion, and the second list is longer than the first on purpose.
 */
import { describe, expect, it } from 'vitest';

import { displayTerm, displayTerms } from './acronyms';

describe('displayTerm — terms the scorer mis-cases', () => {
  it.each([
    ['Sql', 'SQL'],
    ['sql', 'SQL'],
    ['Aws', 'AWS'],
    ['Api', 'API'],
    ['Apis', 'APIs'],
    ['Html', 'HTML'],
    ['Css', 'CSS'],
    ['Php', 'PHP'],
    ['Rest', 'REST'],
    ['Saas', 'SaaS'],
    ['Ux', 'UX'],
    ['Ui', 'UI'],
    ['Etl', 'ETL'],
    ['Gdpr', 'GDPR'],
  ])('renders %s as %s', (input, expected) => {
    expect(displayTerm(input)).toBe(expected);
  });

  it('fixes an acronym inside a longer name and leaves the rest alone', () => {
    expect(displayTerm('Sql Server')).toBe('SQL Server');
    expect(displayTerm('Aws Lambda')).toBe('AWS Lambda');
    expect(displayTerm('Rest Apis')).toBe('REST APIs');
  });

  it('handles the terms the scorer deliberately does not touch at all', () => {
    // `displaySkill` in the scorer skips anything containing `/` or `.`, so
    // these arrive entirely lower-case rather than title-cased.
    expect(displayTerm('ci/cd')).toBe('CI/CD');
    expect(displayTerm('node.js')).toBe('Node.js');
    expect(displayTerm('.net')).toBe('.NET');
    expect(displayTerm('html/css')).toBe('HTML/CSS');
  });

  it('uses the real capitalisation of names that are not acronyms', () => {
    expect(displayTerm('Javascript')).toBe('JavaScript');
    expect(displayTerm('Mysql')).toBe('MySQL');
    expect(displayTerm('Ios')).toBe('iOS');
    expect(displayTerm('Github')).toBe('GitHub');
  });
});

describe('displayTerm — the other direction: what it must NOT do', () => {
  it.each([
    'Risk',
    'Data',
    'Net',
    'Team',
    'Audit',
    'Credit',
    'Excel',
    'Python',
    'Java',
    'Legal',
    'Tax',
    'Cash',
    'Bond',
    'Loan',
  ])('leaves %s exactly as it was', (word) => {
    expect(displayTerm(word)).toBe(word);
  });

  it('never blanket-uppercases a short word just because it is short', () => {
    expect(displayTerm('Risk Management')).toBe('Risk Management');
    expect(displayTerm('Net Revenue')).toBe('Net Revenue');
  });

  it('leaves a term it has never seen exactly as the scorer wrote it', () => {
    expect(displayTerm('Quantitative Easing')).toBe('Quantitative Easing');
    expect(displayTerm('murex')).toBe('murex');
    expect(displayTerm('Murex')).toBe('Murex');
  });

  it('does not treat "js" as an acronym on its own', () => {
    // `js` is deliberately NOT in the word map. If it were, an already
    // title-cased `Node.Js` would come out as `Node.JS`, and any unrelated
    // phrase containing the word would be shouted at.
    expect(displayTerm('Node Js')).toBe('Node Js');
    // The whole-phrase entry still canonicalises the real product name,
    // whatever casing the scorer happened to hand over.
    expect(displayTerm('Node.Js')).toBe('Node.js');
  });
});

describe('displayTerm — boundaries', () => {
  it('returns an empty or blank term untouched', () => {
    expect(displayTerm('')).toBe('');
    expect(displayTerm('   ')).toBe('   ');
  });

  it('trims surrounding whitespace off a real term', () => {
    expect(displayTerm('  Sql  ')).toBe('SQL');
  });

  it('handles a single character', () => {
    expect(displayTerm('R')).toBe('R');
    expect(displayTerm('c')).toBe('c');
  });

  it('leaves punctuation-only input alone', () => {
    expect(displayTerm('---')).toBe('---');
  });
});

describe('displayTerms', () => {
  it('maps a whole list and keeps its order', () => {
    expect(displayTerms(['Sql', 'Risk', 'ci/cd'])).toEqual(['SQL', 'Risk', 'CI/CD']);
  });

  it('returns an empty array for an empty list', () => {
    expect(displayTerms([])).toEqual([]);
  });
});
