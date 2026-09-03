/**
 * The advert box is holding a link, not an advert.
 *
 * The rule these tests pin down is narrow ON PURPOSE, and both directions of
 * getting it wrong are covered here rather than left to the component:
 *
 *   * too loose, and a real paste is refused with "that is a link" — the user
 *     is blocked from doing the one thing this screen is for;
 *   * too tight, and a bare URL reaches a model, which answers from the words
 *     in the address and fills the review form with confident fiction.
 *
 * The second is the bug this guard exists to stop. The first is the bug the
 * guard itself could become, so most of what is below is negative cases.
 */
import { describe, expect, it } from 'vitest';

import { type BlockedSite } from './fetchBlocklist';
import {
  URL_ONLY_BLOCKED_NOTE,
  URL_ONLY_NOTE,
  urlOnlyNote,
  urlOnlyPaste,
  type UrlOnlyPaste,
} from './pastedUrl';

/** A fixed list, so these tests do not move when the shipped file does. */
const LIST: readonly BlockedSite[] = [
  { domain: 'linkedin.com', why: 'login wall' },
  { domain: 'indeed.com', why: 'bot check' },
];

/** A real advert, of the kind that must always go the ordinary way. */
const ADVERT_TEXT = `Credit Risk Analyst
Lloyds Banking Group - City of London (hybrid, 3 days on site)
GBP 45,000 - 55,000 per annum plus bonus.

You will sit in second-line credit risk for the wholesale book, reviewing
limit applications and challenging the assumptions behind them.`;

/**
 * Narrow to a link, or fail the test where the assumption was made.
 *
 * A `throw` rather than `paste!`: the assertion operator silences the type
 * checker and then hands `urlOnlyNote` a `null` at runtime if the rule ever
 * changes, which reports as a crash inside the function under test rather than
 * as the expectation that actually failed.
 */
function mustBeALink(raw: string): UrlOnlyPaste {
  const paste = urlOnlyPaste(raw, LIST);
  if (paste === null) throw new Error(`expected ${raw} to be recognised as a link`);
  return paste;
}

describe('a box holding nothing but a link', () => {
  it('is recognised, and carries the address back for the link box', () => {
    const paste = urlOnlyPaste('https://jobs.example.com/advert/credit-risk-analyst', LIST);

    expect(paste).not.toBeNull();
    expect(paste?.url).toBe('https://jobs.example.com/advert/credit-risk-analyst');
    expect(paste?.blocked).toBe(false);
  });

  it('survives the whitespace a copy out of a browser brings with it', () => {
    for (const raw of [
      '  https://jobs.example.com/advert/1  ',
      '\nhttps://jobs.example.com/advert/1\n',
      '\t https://jobs.example.com/advert/1 \n\n',
    ]) {
      const paste = urlOnlyPaste(raw, LIST);
      expect(paste).not.toBeNull();
      // Trimmed, so it can go straight into the link box as typed.
      expect(paste?.url).toBe('https://jobs.example.com/advert/1');
    }
  });

  it('boundary: http as well as https, because plenty of small sites are still http', () => {
    expect(urlOnlyPaste('http://jobs.example.com/advert/1', LIST)?.url).toBe(
      'http://jobs.example.com/advert/1',
    );
  });

  it('boundary: a port, a query and a fragment are all part of the address', () => {
    const raw = 'https://jobs.example.com:8443/advert/1?src=email&ref=x#apply';
    expect(urlOnlyPaste(raw, LIST)?.url).toBe(raw);
  });
});

describe('a link to a site that will not answer a fetch', () => {
  it('is flagged, so the user is not sent to press a button that cannot work', () => {
    for (const raw of [
      'https://www.linkedin.com/jobs/view/4012345678/',
      'https://uk.indeed.com/viewjob?jk=abc',
      'https://www.indeed.com/viewjob?jk=abc',
      'https://gb.linkedin.com/jobs/view/1/',
      'https://careers.uk.indeed.com/viewjob?jk=abc',
    ]) {
      const paste = urlOnlyPaste(raw, LIST);
      expect(paste, raw).not.toBeNull();
      expect(paste?.blocked, raw).toBe(true);
    }
  });

  it('negative: an ordinary job site is not flagged', () => {
    for (const raw of [
      'https://www.reed.co.uk/jobs/analyst/1',
      'https://jobs.example.com/advert/1',
      // The lookalikes `includes` would get wrong. These are other people's
      // websites and neither of them is LinkedIn.
      'https://notlinkedin.com/jobs/1',
      'https://linkedin.com.phishing.test/jobs/1',
    ]) {
      expect(urlOnlyPaste(raw, LIST)?.blocked, raw).toBe(false);
    }
  });
});

describe('an ordinary paste, which must never be mistaken for a link', () => {
  it('a real advert goes the ordinary way', () => {
    expect(urlOnlyPaste(ADVERT_TEXT, LIST)).toBeNull();
  });

  it('an advert that quotes its own address is still an advert', () => {
    const withLink = `Credit Risk Analyst at Lloyds.
Apply here: https://jobs.example.com/advert/1
Closing 30 September.`;

    expect(urlOnlyPaste(withLink, LIST)).toBeNull();
  });

  it('negative: a link with so much as one word beside it is a paste', () => {
    for (const raw of [
      'https://jobs.example.com/advert/1 Credit Risk Analyst',
      'Apply: https://jobs.example.com/advert/1',
      // Two links is not "only a URL" — and there would be no answer to which
      // one the Fetch button was supposed to open.
      'https://jobs.example.com/1 https://jobs.example.com/2',
    ]) {
      expect(urlOnlyPaste(raw, LIST), raw).toBeNull();
    }
  });

  it('negative: an empty or whitespace-only box is not a link', () => {
    for (const raw of ['', '   ', '\n\n', '\t']) {
      expect(urlOnlyPaste(raw, LIST)).toBeNull();
    }
  });

  it('negative: a single word is a word, however dotted', () => {
    // The loose-rule bug. A guard that recognised scheme-less addresses would
    // call these links and refuse a paste the user was entitled to make.
    for (const raw of ['Analyst', 'Node.js', 'React.js', 'ACCA/CFA', 'REQ-88213', 'v2.1.0']) {
      expect(urlOnlyPaste(raw, LIST), raw).toBeNull();
    }
  });

  it('negative: a scheme-less address is left alone, because Fetch would refuse it', () => {
    // Deliberate, and documented in `pastedUrl.ts`: recognising these would
    // point the user at a button that opens `http`/`https` and nothing else.
    for (const raw of ['www.example.com', 'www.example.com/jobs/1', 'example.com/jobs/1']) {
      expect(urlOnlyPaste(raw, LIST), raw).toBeNull();
    }
  });

  it('negative: a scheme we would never open is not offered to the Fetch button', () => {
    for (const raw of [
      'file:///C:/Users/me/advert.html',
      'mailto:recruiter@example.com',
      'javascript:alert(1)',
      'data:text/html,<h1>hi</h1>',
      'ftp://files.example.com/advert.txt',
    ]) {
      expect(urlOnlyPaste(raw, LIST), raw).toBeNull();
    }
  });
});

describe('what the user is told', () => {
  it('an open site is pointed at the Fetch button', () => {
    const paste = mustBeALink('https://jobs.example.com/advert/1');
    expect(urlOnlyNote(paste)).toBe(URL_ONLY_NOTE);
    expect(URL_ONLY_NOTE).toMatch(/Fetch/);
  });

  it('a blocked site is pointed at the browser instead, never at Fetch', () => {
    const paste = mustBeALink('https://uk.indeed.com/viewjob?jk=abc');
    expect(urlOnlyNote(paste)).toBe(URL_ONLY_BLOCKED_NOTE);
    // The whole point of the second message: it must not send someone to press
    // a button that is going to come back empty.
    expect(URL_ONLY_BLOCKED_NOTE).not.toMatch(/press Fetch/);
    expect(URL_ONLY_BLOCKED_NOTE).toMatch(/browser/);
  });

  it('neither message blames the user or shows anything machine-shaped', () => {
    for (const note of [URL_ONLY_NOTE, URL_ONLY_BLOCKED_NOTE]) {
      expect(note).not.toMatch(/error|invalid|failed|unable|cannot parse/i);
      expect(note).not.toMatch(/http[s]?:\/\//);
      // Says what to do, in a sentence, rather than naming a condition.
      expect(note).toMatch(/paste|press/i);
    }
  });
});
