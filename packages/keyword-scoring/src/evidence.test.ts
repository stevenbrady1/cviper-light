/**
 * L-290 — the CV line behind a matched skill.
 *
 * The result screen shows it beside each matched skill, so a user can check
 * the match instead of trusting it. It must follow the SAME rules the score
 * used: a line the score would not credit is never shown as proof.
 */
import { describe, expect, it } from 'vitest';

import { EVIDENCE_MAX_CHARS, evidenceLine } from './evidence';

const CV = [
  'SAM PATEL',
  'Data analyst, Bristol',
  '',
  'No SQL at my first job, where everything was in spreadsheets.',
  '- Daily SQL reporting for the trading team, 2022 to now.',
  '- Built Power BI dashboards used by the finance director.',
  'Qualifications: Level 2 Diploma in Health and Social Care (2019)',
].join('\n');

describe('evidenceLine (L-290)', () => {
  it('finds the line for a skill, whatever case the screen shows it in', () => {
    expect(evidenceLine('SQL', CV)).toBe('Daily SQL reporting for the trading team, 2022 to now.');
    expect(evidenceLine('Power BI', CV)).toBe(
      'Built Power BI dashboards used by the finance director.',
    );
  });

  it('finds a UK term through the wording the CV actually used', () => {
    expect(evidenceLine('NVQ Level 2', CV)).toBe(
      'Qualifications: Level 2 Diploma in Health and Social Care (2019)',
    );
  });

  // NEGATIVE — "No SQL at my first job" is the line that says they lacked it.
  it('never offers a negated line as proof', () => {
    expect(evidenceLine('SQL', CV)).not.toMatch(/^No SQL/);
  });

  // NEGATIVE — a skill the CV does not name has no proof, rather than a guess.
  it.each(['Tableau', 'Kubernetes', 'Stakeholder management experience'])(
    'returns null for %j',
    (skill) => {
      expect(evidenceLine(skill, CV)).toBeNull();
    },
  );

  // NEGATIVE — "go" is not Go (L-286 rules apply here too).
  it('does not quote an English-word false match', () => {
    expect(evidenceLine('Go', 'I go to the gym.\nTeam player.')).toBeNull();
  });

  // BOUNDARY
  it.each([
    ['', CV],
    ['SQL', ''],
    ['   ', CV],
  ])('returns null for skill %j in a CV of %j characters', (skill, cv) => {
    expect(evidenceLine(skill, cv)).toBeNull();
  });

  it('cuts a long line around the match, and says it was cut', () => {
    const long = `${'Worked across many teams and projects. '.repeat(6)}Then wrote SQL every day. ${'More detail about the role and the people. '.repeat(6)}`;
    const quote = evidenceLine('SQL', long) ?? '';
    expect(quote).toContain('SQL');
    expect(quote.length).toBeLessThanOrEqual(EVIDENCE_MAX_CHARS + 2);
    expect(quote.startsWith('…')).toBe(true);
    expect(quote.endsWith('…')).toBe(true);
  });

  it('strips a bullet but keeps the words', () => {
    expect(evidenceLine('SQL', '• SQL and Excel daily')).toBe('SQL and Excel daily');
  });
});
