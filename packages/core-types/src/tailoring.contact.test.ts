/**
 * L-346 — `renderTailoredCv`'s optional contact line: an ordinary line under
 * the name, and NOTHING changes for a caller that does not pass one.
 */
import { describe, expect, it } from 'vitest';

import { oneFinalNewline, renderTailoredCv, type TailoredCv } from './tailoring';

const CV: TailoredCv = {
  summary: 'Credit risk analyst with eight years in London banking.',
  key_skills: ['SQL', 'Python'],
  experience: [
    {
      title: 'Senior Credit Risk Analyst',
      company: 'Lloyds Banking Group',
      location: 'London',
      dates: '2019 – present',
      bullets: ['Cut IFRS 9 model run time by 40%.'],
    },
  ],
  education: ['BSc Mathematics, University of Manchester, 2016'],
  certifications: [],
};

/** What the renderer printed before L-346, for a CV with no name. */
const WITHOUT_NAME = `PROFESSIONAL SUMMARY
Credit risk analyst with eight years in London banking.

KEY SKILLS
SQL, Python

PROFESSIONAL EXPERIENCE

Senior Credit Risk Analyst
Lloyds Banking Group | London | 2019 – present
- Cut IFRS 9 model run time by 40%.

EDUCATION
BSc Mathematics, University of Manchester, 2016
`;

describe('renderTailoredCv with a contact line (L-346)', () => {
  it('regression: (cv, null) and (cv, null, null) are byte-for-byte what they always were', () => {
    expect(renderTailoredCv(CV, null)).toBe(WITHOUT_NAME);
    expect(renderTailoredCv(CV, null, null)).toBe(WITHOUT_NAME);
    expect(renderTailoredCv(CV, 'Jamie Lewis', null)).toBe(`Jamie Lewis\n\n${WITHOUT_NAME}`);
    expect(renderTailoredCv(CV, 'Jamie Lewis')).toBe(`Jamie Lewis\n\n${WITHOUT_NAME}`);
  });

  it('happy: the line goes straight under the name, then the usual gap', () => {
    expect(renderTailoredCv(CV, 'Jamie Lewis', 'jamie@example.com | 07700 900123')).toBe(
      `Jamie Lewis\njamie@example.com | 07700 900123\n\n${WITHOUT_NAME}`,
    );
  });

  it('edge: a line with no name is still at the top', () => {
    expect(renderTailoredCv(CV, null, 'jamie@example.com')).toBe(
      `jamie@example.com\n\n${WITHOUT_NAME}`,
    );
  });

  it('boundary: a blank line is no line', () => {
    expect(renderTailoredCv(CV, null, '   ')).toBe(WITHOUT_NAME);
    expect(renderTailoredCv(CV, ' ', '')).toBe(WITHOUT_NAME);
  });
});

/**
 * CodeQL js/polynomial-redos on #509: the final `/\n+$/` ran on text that now
 * carries a line the user typed. A long run of newlines followed by anything
 * else made it try every start in the run, each scanning to the end.
 */
describe('the final newline, in linear time (L-346, CodeQL)', () => {
  const RUN = 100_000;

  function timed(render: () => string): { text: string; ms: number } {
    const started = performance.now();
    const text = render();
    return { text, ms: performance.now() - started };
  }

  it('a contact line with ~100,000 newlines before a letter renders well under a second', () => {
    const line = `a${'\n'.repeat(RUN)}b`;
    const { text, ms } = timed(() => renderTailoredCv(CV, 'Jamie Lewis', line));
    expect(ms).toBeLessThan(1_000);
    expect(text).toBe(`Jamie Lewis\n${line}\n\n${WITHOUT_NAME}`);
  });

  it('a bullet with ~100,000 newlines before a letter renders well under a second', () => {
    const bullet = `Cut run time.${'\n'.repeat(RUN)}x`;
    const cv: TailoredCv = { ...CV, education: [], experience: [{ ...role(), bullets: [bullet] }] };
    const { text, ms } = timed(() => renderTailoredCv(cv, null));
    expect(ms).toBeLessThan(1_000);
    expect(text.endsWith(`- ${bullet}\n`)).toBe(true);
  });
});

function role() {
  const first = CV.experience[0];
  if (first === undefined) throw new Error('fixture has a role');
  return first;
}

describe('parity: the output is what the regex produced, byte for byte', () => {
  const EMPTY: TailoredCv = {
    summary: '',
    key_skills: [],
    experience: [],
    education: [],
    certifications: [],
  };

  it.each([
    ['an all-blank CV', EMPTY, null, null, 'PROFESSIONAL SUMMARY\n'],
    [
      'an all-blank CV with a name',
      EMPTY,
      'Jamie Lewis',
      null,
      'Jamie Lewis\n\nPROFESSIONAL SUMMARY\n',
    ],
    [
      'empty sections are left out, certifications last',
      { ...EMPTY, summary: 'S.', certifications: ['FRM'] },
      null,
      null,
      'PROFESSIONAL SUMMARY\nS.\n\nCERTIFICATIONS\nFRM\n',
    ],
    [
      'experience last: its closing gap is the one final newline',
      { ...EMPTY, summary: 'S.', experience: [{ ...role(), bullets: ['B.'] }] },
      null,
      null,
      'PROFESSIONAL SUMMARY\nS.\n\nPROFESSIONAL EXPERIENCE\n\nSenior Credit Risk Analyst\n' +
        'Lloyds Banking Group | London | 2019 – present\n- B.\n',
    ],
    [
      'a role with no bullets and no header line',
      {
        ...EMPTY,
        summary: 'S.',
        experience: [{ title: 'T', company: '', location: '', dates: '', bullets: [] }],
      },
      null,
      null,
      'PROFESSIONAL SUMMARY\nS.\n\nPROFESSIONAL EXPERIENCE\n\nT\n',
    ],
    [
      'newlines inside a contact line are kept as they are',
      EMPTY,
      'N',
      'a\n\n\nb',
      'N\na\n\n\nb\n\nPROFESSIONAL SUMMARY\n',
    ],
  ])('%s', (_label, cv, name, line, expected) => {
    expect(renderTailoredCv(cv, name, line)).toBe(expected);
  });

  /** The pattern this replaced — safe here, on short inputs only. */
  const legacy = (text: string) => text.replace(/\n+$/, '\n');

  it.each([
    '',
    'a',
    'a\n',
    'a\n\n\n',
    '\n',
    '\n\n\n',
    'a\nb',
    'a\n\nb\n\n',
    'a\r\n',
    'a\n\r',
    'a\r\n\n\n',
    ' \n ',
    '\n x',
    'a\n\n\n ',
  ])('oneFinalNewline(%j) matches the regex it replaced', (text) => {
    expect(oneFinalNewline(text)).toBe(legacy(text));
  });

  it('text with no trailing newline gets none added', () => {
    expect(oneFinalNewline('PROFESSIONAL SUMMARY')).toBe('PROFESSIONAL SUMMARY');
    expect(oneFinalNewline('')).toBe('');
  });
});
