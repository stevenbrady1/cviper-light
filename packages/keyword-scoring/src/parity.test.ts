/**
 * PORT FIDELITY — this port must agree with the Python original, case for case.
 *
 * ============================================================================
 * EVERY EXPECTATION BELOW WAS PRODUCED BY RUNNING THE PYTHON.
 * ============================================================================
 * They are not what a reasonable person would predict `termInText` does; they
 * are what `backend/ai/keywords.py::term_in_text` actually returns, measured by
 * exec'ing the constants and helpers straight out of that file. Several are
 * surprising (see the "known limitations" block), and those are the valuable
 * ones: if this port ever "fixes" one of them on its own, the same CV scores
 * differently in CViper and in CViper Light, and neither number can be trusted.
 *
 * If a case here starts failing, the port has drifted. Re-measure against the
 * Python before changing a single expectation.
 */
import { describe, expect, it } from 'vitest';
import { termInText } from './term';

/** [term, text, what the Python returns] */
const PARITY_CASES: readonly (readonly [string, string, boolean])[] = [
  // Plain tokens
  ['python', 'We use Python daily', true],
  ['python', 'Python, Java and Go', true],
  ['python', 'pythonic code', false],
  ['java', 'strong javascript background', false],
  ['go', 'an ongoing project', false],
  ['ai', 'always available here', false],

  // Symbol-bearing tokens — the reason for the custom boundaries
  ['c#', 'Stack includes c# and more', true],
  ['c#', 'wrote c code', false],
  ['c++', 'we ship c++ daily', true],
  ['.net', 'the .net platform', true],
  ['ci/cd', 'ci/cd pipelines', true],
  ['node.js', 'node.js services', true],
  ['node', 'node.js services', false],

  // Plural folding and its guards
  ['developer', 'three developers here', true],
  ['containers', 'one container only', true],
  ['ios', 'io ports', false],
  ['kubernetes', 'kubernete cluster', false],
  ['analysis', 'analysi of data', false],

  // Multi-word terms: head-noun plural, strict adjacency
  ['data pipeline', 'built data pipelines', true],
  ['market risk', 'market and credit risk', false],
  ['market risk', 'market risk team', true],
  ['stakeholder management', 'stakeholder management experience', true],
  ['stakeholder management', 'management of stakeholder groups', false],

  // US/UK folding
  ['optimisation', 'cost optimization work', true],
  ['optimization', 'cost optimisation work', true],
  ['analyse', 'we analyze data', true],
  ['organise', 'organized events', false],

  // Substring traps
  ['excel', 'excel spreadsheets', true],
  ['excel', 'excellent communication', false],
  ['risk', 'risk management', true],
  ['risk', 'risky business', false],
  ['agile', 'agile delivery', true],
  ['agile', 'fragile systems', false],

  // Domain lexicon terms
  ['patient care', 'patient care standards', true],
  ['safeguarding', 'safeguarding training', true],

  // Hyphenated terms. These live in the lexicon and every one of them threw
  // `Invalid escape` before `escapeRegExp` stopped emitting `\-` under the `u`
  // flag — a crash, not a wrong answer, on our own data.
  ['t-sql', 'strong t-sql skills', true],
  ['t-sql', 'strong tsql skills', false],
  ['front-end', 'front-end development', true],
  ['problem-solving', 'good problem-solving skills', true],

  // Ultra-short token — matches on raw text, which is exactly why `match.ts`
  // gates tokens of two characters or fewer behind the advert's posted skills.
  ['r', 'R&D team', true],

  // Empty inputs
  ['python', '', false],
  ['', 'some text', false],
];

describe('termInText parity with the Python original', () => {
  it.each(PARITY_CASES)('termInText(%j, %j) === %s', (term, text, expected) => {
    expect(termInText(term, text)).toBe(expected);
  });
});

/**
 * ============================================================================
 * KNOWN LIMITATIONS OF THE PORTED MATCHER — PINNED DELIBERATELY.
 * ============================================================================
 * `.` is inside the token character class so that `node` cannot match inside
 * `node.js`. The price is that a skill at the END OF A SENTENCE, followed by a
 * full stop, does not match either — and CVs are full of sentences that end on
 * a skill.
 *
 * This is a REAL DEFECT in the upstream scorer, reproduced here on purpose so
 * the two implementations agree. It is reported alongside this port rather
 * than fixed here: fixing it in one repository and not the other would make
 * the same CV score differently in each, which is worse than the bug.
 */
describe('known upstream limitation: a trailing full stop hides a skill', () => {
  it.each([
    ['python', 'I know Python.'],
    ['docker', 'Deployed on AWS with Docker.'],
    ['stakeholder management', 'Strong SQL and stakeholder management.'],
  ])('termInText(%j, %j) is false, matching the Python', (term, text) => {
    expect(termInText(term, text)).toBe(false);
    // ...and matches the moment the full stop is not immediately adjacent.
    expect(termInText(term, text.replace(/\.$/, ' too'))).toBe(true);
  });
});
