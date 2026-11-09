/**
 * L-346 — the name, email and phone offered for the top of a saved CV.
 *
 * Every value `detectCvContact` returns is a suggestion the user confirms, so
 * the rule under test is the one that matters when it is wrong: when unsure,
 * leave the field BLANK. A blank field costs the user one line of typing; a
 * wrong name at the top of a CV costs them the application.
 */
import { describe, expect, it } from 'vitest';

import { renderTailoredCv, type Cv, type TailoredCv } from '@cviper/core-types';

import {
  NO_CONTACT,
  contactLine,
  contactSummary,
  detectCvContact,
  savedCvText,
  type CvContact,
} from './cvContact';

function cv(text: string, jsonResume: unknown = null): Pick<Cv, 'extracted_text' | 'json_resume'> {
  return {
    extracted_text: text,
    json_resume: jsonResume === null ? null : JSON.stringify(jsonResume),
  };
}

const BODY = `PROFESSIONAL SUMMARY
Credit risk analyst with eight years in London banking.
EXPERIENCE
Senior Credit Risk Analyst, Lloyds Banking Group, 2020 – Present`;

const TAILORED: TailoredCv = {
  summary: 'Credit risk analyst.',
  key_skills: ['SQL'],
  experience: [],
  education: [],
  certifications: [],
};

describe('detectCvContact: from the text', () => {
  it('happy: the name on line 1, and one email and one phone in the header', () => {
    const text = `Jane Smith\njane.smith@example.com\n07700 900123\n${BODY}`;
    expect(detectCvContact(cv(text))).toEqual({
      name: 'Jane Smith',
      email: 'jane.smith@example.com',
      phone: '07700 900123',
    });
  });

  it('edge: everything on one line, cut at the bars', () => {
    const text = `Jane Smith | jane@x.com | 07700 900123\n${BODY}`;
    expect(detectCvContact(cv(text))).toEqual({
      name: 'Jane Smith',
      email: 'jane@x.com',
      phone: '07700 900123',
    });
  });

  it('happy: a name after a "Curriculum Vitae" title line, cut at a bullet', () => {
    const text = `Curriculum Vitae\nJamie Lewis • London\n${BODY}`;
    expect(detectCvContact(cv(text)).name).toBe('Jamie Lewis');
    expect(detectCvContact(cv(`CV\nJamie Lewis\n${BODY}`)).name).toBe('Jamie Lewis');
  });

  it('happy: a labelled phone that does not start with + 0 or (', () => {
    const text = `Jane Smith\nTel: 7700 900 123\n${BODY}`;
    expect(detectCvContact(cv(text)).phone).toBe('7700 900 123');
  });

  it('happy: an international and a bracketed number', () => {
    expect(detectCvContact(cv(`Jane Smith\n+44 7700 900123\n${BODY}`)).phone).toBe(
      '+44 7700 900123',
    );
    expect(detectCvContact(cv(`Jane Smith\n(020) 7946 0958\n${BODY}`)).phone).toBe(
      '(020) 7946 0958',
    );
  });

  it('negative: an 8-digit ID is not a phone number', () => {
    expect(detectCvContact(cv(`Jane Smith\nEmployee ID 01234567\n${BODY}`)).phone).toBe('');
  });

  it('negative: an unlabelled run of digits is not a phone number', () => {
    expect(detectCvContact(cv(`Jane Smith\nRef 7700900123\n${BODY}`)).phone).toBe('');
  });

  it('negative: two different emails in the header leave the email blank', () => {
    const text = `Jane Smith\njane@home.example.com | jane@work.example.com\n${BODY}`;
    expect(detectCvContact(cv(text)).email).toBe('');
  });

  it('negative: two different phones in the header leave the phone blank', () => {
    const text = `Jane Smith\n07700 900123 / 0161 496 0000\n${BODY}`;
    expect(detectCvContact(cv(text)).phone).toBe('');
  });

  it('happy: the same email twice is still one candidate', () => {
    const text = `Jane Smith\njane@x.com\nEmail: JANE@x.com\n${BODY}`;
    expect(detectCvContact(cv(text)).email).toBe('jane@x.com');
  });

  it('negative: a referee email after a heading is never the candidate’s', () => {
    const text = `Jane Smith\n${BODY}\nREFERENCES\nDr Alan Grey, alan.grey@uni.example.ac.uk, 0113 496 0000`;
    expect(detectCvContact(cv(text))).toEqual({ name: 'Jane Smith', email: '', phone: '' });
  });

  it('negative: a job title on line 1 is not a name', () => {
    expect(detectCvContact(cv(`Senior Software Engineer\njane@x.com\n${BODY}`)).name).toBe('');
    expect(detectCvContact(cv(`Credit Risk Analyst\n${BODY}`)).name).toBe('');
  });

  it('negative: a heading on line 1 is not a name, and nothing before it is read', () => {
    expect(detectCvContact(cv(`${BODY}\njane@x.com`))).toEqual(NO_CONTACT);
  });

  it('negative: digits, an @ or a colon on line 1 mean it is not a name', () => {
    expect(detectCvContact(cv(`Jane Smith 2024\n${BODY}`)).name).toBe('');
    expect(detectCvContact(cv(`jane@x.com\n${BODY}`)).name).toBe('');
    expect(detectCvContact(cv(`Name: Jane Smith\n${BODY}`)).name).toBe('');
  });

  it('boundary: a name of 1, 2, 4 and 5 words', () => {
    expect(detectCvContact(cv(`Jane\n${BODY}`)).name).toBe('');
    expect(detectCvContact(cv(`Jane Smith\n${BODY}`)).name).toBe('Jane Smith');
    expect(detectCvContact(cv(`Jane Mary Anne Smith\n${BODY}`)).name).toBe('Jane Mary Anne Smith');
    expect(detectCvContact(cv(`Jane Mary Anne Smith Jones\n${BODY}`)).name).toBe('');
  });

  it('boundary: a phone of 8, 9, 15 and 16 digits', () => {
    const phone = (number: string) => detectCvContact(cv(`Jane Smith\n${number}\n${BODY}`)).phone;
    expect(phone('0123 4567')).toBe('');
    expect(phone('0123 45678')).toBe('0123 45678');
    expect(phone('+44 1234 5678 90123')).toBe('+44 1234 5678 90123');
    expect(phone('+44 1234 5678 901234')).toBe('');
  });

  it('boundary: an email on non-blank line 15 is read, on line 16 it is not', () => {
    const filler = (count: number) =>
      Array.from({ length: count }, (_, index) => `London line ${index}`).join('\n\n');
    expect(detectCvContact(cv(`Jane Smith\n${filler(13)}\njane@x.com\n${BODY}`)).email).toBe(
      'jane@x.com',
    );
    expect(detectCvContact(cv(`Jane Smith\n${filler(14)}\njane@x.com\n${BODY}`)).email).toBe('');
  });

  it('edge: Cyrillic, Vietnamese and an all-caps name are kept exactly as written', () => {
    expect(detectCvContact(cv(`Иван Петров\n${BODY}`)).name).toBe('Иван Петров');
    expect(detectCvContact(cv(`Nguyễn Văn An\n${BODY}`)).name).toBe('Nguyễn Văn An');
    expect(detectCvContact(cv(`JANE SMITH\n${BODY}`)).name).toBe('JANE SMITH');
  });

  it('edge: one word is a name only in a script with no capitals', () => {
    expect(detectCvContact(cv(`王伟\n${BODY}`)).name).toBe('王伟');
    expect(detectCvContact(cv(`Smith\n${BODY}`)).name).toBe('');
  });

  it('negative: no text at all gives nothing', () => {
    expect(detectCvContact(cv(''))).toEqual(NO_CONTACT);
    expect(detectCvContact({ extracted_text: null, json_resume: null })).toEqual(NO_CONTACT);
    expect(detectCvContact(null)).toEqual(NO_CONTACT);
  });
});

describe('detectCvContact: from a stored JSON Resume', () => {
  const TEXT = `Jane Smith\nLondon\njane@x.com\n+44 7700 900123\n${BODY}`;

  it('happy: basics are used when each is literally in the CV text', () => {
    const resume = {
      basics: { name: 'Jane Smith', email: 'jane@x.com', phone: '+44 7700 900123' },
    };
    expect(detectCvContact(cv(TEXT, resume))).toEqual({
      name: 'Jane Smith',
      email: 'jane@x.com',
      phone: '+44 7700 900123',
    });
  });

  it('happy: a basics name the text rules would refuse is still taken, because it is in the text', () => {
    const text = `Dr Jane Smith-Jones, PhD\n${BODY}`;
    const resume = { basics: { name: 'Jane Smith-Jones' } };
    expect(detectCvContact(cv(text, resume)).name).toBe('Jane Smith-Jones');
  });

  it('negative: a basics value removed by a correction is dropped', () => {
    const corrected = TEXT.replace('jane@x.com', 'j.smith@example.org');
    const resume = { basics: { name: 'Jane Smith', email: 'jane@x.com' } };
    expect(detectCvContact(cv(corrected, resume)).email).toBe('j.smith@example.org');
    const noEmail = TEXT.replace('jane@x.com\n', '');
    expect(detectCvContact(cv(noEmail, resume)).email).toBe('');
  });

  it('negative: only basics is read — a reference’s email elsewhere in the resume is not', () => {
    const text = `Jane Smith\n${BODY}\nREFERENCES\nalan@uni.example.ac.uk`;
    const resume = {
      basics: { name: 'Jane Smith' },
      references: [{ name: 'Alan Grey', reference: 'alan@uni.example.ac.uk' }],
    };
    expect(detectCvContact(cv(text, resume))).toEqual({
      name: 'Jane Smith',
      email: '',
      phone: '',
    });
  });

  it('negative: unreadable JSON falls back to the text', () => {
    expect(detectCvContact({ extracted_text: TEXT, json_resume: '{not json' }).email).toBe(
      'jane@x.com',
    );
    expect(detectCvContact(cv(TEXT, { basics: { name: 42 } })).name).toBe('Jane Smith');
  });
});

describe('regression: every detected value is literally in the CV', () => {
  const FIXTURES = [
    `Jane Smith | jane@x.com | 07700 900123\n${BODY}`,
    `  Jane   Smith  \r\n  jane@x.com  \r\nMob. 07700-900-123\r\n${BODY}`,
    `CURRICULUM VITAE\nNguyễn Văn An • Hà Nội\nan.nguyen@example.vn\n+84 24 3825 2345\n${BODY}`,
    `Иван Петров\nivan@example.ru\n+7 495 123-45-67\n${BODY}`,
    `王伟\nwang.wei@example.cn\n+86 10 1234 5678\n${BODY}`,
  ];

  it('name, email and phone are each a substring of the extracted text', () => {
    for (const text of FIXTURES) {
      const found = detectCvContact(cv(text));
      for (const value of [found.name, found.email, found.phone]) {
        if (value !== '') expect(text).toContain(value);
      }
      expect(found.name).not.toBe('');
      expect(found.email).not.toBe('');
      expect(found.phone).not.toBe('');
    }
  });
});

describe('contactLine and contactSummary', () => {
  const ALL: CvContact = { name: 'Jane Smith', email: 'jane@x.com', phone: '07700 900123' };

  it('happy: email and phone under the name, joined by a bar', () => {
    expect(contactLine(ALL)).toBe('jane@x.com | 07700 900123');
    expect(contactSummary(ALL)).toBe('Jane Smith | jane@x.com | 07700 900123');
  });

  it('edge: a cleared field leaves no stray bar', () => {
    expect(contactLine({ ...ALL, email: '  ' })).toBe('07700 900123');
    expect(contactLine({ ...ALL, phone: '' })).toBe('jane@x.com');
    expect(contactSummary({ ...ALL, email: '' })).toBe('Jane Smith | 07700 900123');
  });

  it('boundary: all blank is no line at all', () => {
    expect(contactLine(NO_CONTACT)).toBeNull();
    expect(contactSummary(NO_CONTACT)).toBe('');
  });
});

describe('savedCvText', () => {
  const text = renderTailoredCv(TAILORED, null);
  const result = { cv: TAILORED, text };

  it('regression: no details confirmed, or all blank, is exactly the draft text', () => {
    expect(savedCvText(result, null)).toBe(text);
    expect(savedCvText(result, NO_CONTACT)).toBe(text);
    expect(savedCvText(result, { name: ' ', email: '', phone: '\t' })).toBe(text);
  });

  it('happy: the confirmed details go on top', () => {
    const saved = savedCvText(result, {
      name: 'Jane Smith',
      email: 'jane@x.com',
      phone: '07700 900123',
    });
    expect(saved.split('\n').slice(0, 3)).toEqual(['Jane Smith', 'jane@x.com | 07700 900123', '']);
  });
});

/**
 * CodeQL js/polynomial-redos on #509 found `/\n+$/` in the renderer; these
 * are the same shapes in this file, run on the user's own CV text. Each input
 * is a long run the old pattern retried from every position, then failed.
 */
describe('linear time on hostile CV text (L-346, CodeQL)', () => {
  const RUN = 50_000;

  function timedDetect(text: string) {
    const started = performance.now();
    const found = detectCvContact(cv(text));
    return { found, ms: performance.now() - started };
  }

  it('a heading check on a long run of spaces and colons (`[\\s:]+$`)', () => {
    const { found, ms } = timedDetect(`Jane Smith\n${': '.repeat(RUN)}x\n${BODY}`);
    expect(ms).toBeLessThan(1_000);
    expect(found.name).toBe('Jane Smith');
  });

  it('the "CV" title check on a long run of dots and spaces (`[\\s.:]+$`)', () => {
    const { found, ms } = timedDetect(`${'. '.repeat(RUN)}x\n${BODY}`);
    expect(ms).toBeLessThan(1_000);
    expect(found.name).toBe('');
  });

  it('a phone label check on a long run of spaces (`\\s*:?\\s*$`)', () => {
    const { found, ms } = timedDetect(`Jane Smith\nt${' '.repeat(RUN)}x 7700 900 123\n${BODY}`);
    expect(ms).toBeLessThan(1_000);
    expect(found.phone).toBe('');
  });

  it('an email search on a long run of letters with no @', () => {
    const { found, ms } = timedDetect(`Jane Smith\n${'a'.repeat(RUN)}\n${BODY}`);
    expect(ms).toBeLessThan(1_000);
    expect(found.email).toBe('');
  });

  it('an email search on a long run of letters before an @ that leads nowhere', () => {
    const { found, ms } = timedDetect(`Jane Smith\n${'a'.repeat(RUN)}@\n${BODY}`);
    expect(ms).toBeLessThan(1_000);
    expect(found.email).toBe('');
  });

  it('the phone run on a digit then a long run of spaces (already linear, held here)', () => {
    const { found, ms } = timedDetect(`Jane Smith\n1${' '.repeat(RUN)}x\n${BODY}`);
    expect(ms).toBeLessThan(1_000);
    expect(found.phone).toBe('');
  });
});

describe('parity for the rewritten checks', () => {
  it('headings with trailing colons and spaces still end the header', () => {
    expect(detectCvContact(cv(`Jane Smith\nExperience :  \njane@x.com`)).email).toBe('');
    expect(detectCvContact(cv(`Jane Smith\nEDUCATION:\njane@x.com`)).email).toBe('');
    expect(detectCvContact(cv(`Jane Smith\nEducation & Training:\njane@x.com`)).email).toBe('');
  });

  it('a title line with trailing punctuation still moves the name to line 2', () => {
    expect(detectCvContact(cv(`Curriculum Vitae.\nJamie Lewis\n${BODY}`)).name).toBe('Jamie Lewis');
    expect(detectCvContact(cv(`CV :\nJamie Lewis\n${BODY}`)).name).toBe('Jamie Lewis');
  });

  it('labels: with a dot, a spaced colon, upper case; never the tail of a longer word', () => {
    const phone = (line: string) => detectCvContact(cv(`Jane Smith\n${line}\n${BODY}`)).phone;
    expect(phone('Tel. : 7700 900 123')).toBe('7700 900 123');
    expect(phone('MOBILE 7700900123')).toBe('7700900123');
    expect(phone('Home | M: 7700 900 123')).toBe('7700 900 123');
    expect(phone('Hotel 7700 900 123')).toBe('');
    expect(phone('Item: 7700 900 123')).toBe('');
  });

  it('boundary: an email on a line of exactly 300 characters is read, 301 is not', () => {
    const at = (length: number) => {
      const email = 'jane@x.com';
      const line = `${'x '.repeat(length).slice(0, length - email.length - 1)} ${email}`;
      expect(line).toHaveLength(length);
      return detectCvContact(cv(`Jane Smith\n${line}\n${BODY}`)).email;
    };
    expect(at(300)).toBe('jane@x.com');
    expect(at(301)).toBe('');
  });
});
