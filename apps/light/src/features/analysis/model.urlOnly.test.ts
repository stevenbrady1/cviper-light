/**
 * L-348 — a bare link in the advert box disables the run button on Analysis AND
 * Tailor, with a reason, before the "paste more" length check can speak.
 *
 * Both screens' `runDisabledReason` are covered here, side by side, because the
 * rule is one rule: the tracker's `urlOnlyPaste`, reused as it is. If the two
 * screens ever disagree about what a link is, this file is where it shows.
 *
 * The screens themselves, and the backstop in `runAnalysis` / `runTailor`, are
 * in `analysis.urlOnlyGuard.test.tsx` and `tailor.urlOnlyGuard.test.tsx`.
 */
import { describe, expect, it } from 'vitest';

import { type Cv, type Job } from '@cviper/core-types';

import { URL_ONLY_RUN_REASON } from '../tracker/pastedUrl';
import { runDisabledReason as tailorReason, type TailorRunState } from '../tailor/model';

import { jobAdvertText, runDisabledReason as analysisReason, type RunState } from './model';
import { type ProviderOption } from './providers';

const CV: Cv = {
  id: 'cv-1',
  name: 'CV.docx',
  file_path: null,
  extracted_text: 'Credit risk analyst, eight years in London banking. SQL, Python, IFRS 9.',
  json_resume: null,
  created_at: '2026-08-01T09:00:00.000Z',
};

const KEYWORD: ProviderOption = {
  key: 'keyword',
  kind: 'keyword',
  label: 'Basic match',
  note: '',
  model: null,
  local: true,
  needsKey: false,
};

const OLLAMA: ProviderOption = {
  key: 'ollama:llama3.2',
  kind: 'ollama',
  label: 'Ollama · llama3.2',
  note: '',
  model: 'llama3.2',
  local: true,
  needsKey: false,
};

const ADVERT = 'Credit Risk Analyst. SQL models, IFRS 9 impairment, Python essential.';
const LINK = 'https://jobs.example.com/advert/credit-risk-analyst';

function analysis(jobText: string, option: ProviderOption = OLLAMA): string | null {
  const state: RunState = { cv: CV, jobText, option, running: false };
  return analysisReason(state);
}

function tailor(jobText: string): string | null {
  const state: TailorRunState = {
    cv: CV,
    jobText,
    option: OLLAMA,
    aiAvailable: true,
    running: false,
  };
  return tailorReason(state);
}

/** Both screens, so every case below is asserted twice. */
const SCREENS = [
  ['Analysis', (text: string) => analysis(text)],
  ['Tailor', tailor],
] as const;

describe('the reason itself', () => {
  it('is the owner-approved sentence, word for word', () => {
    expect(URL_ONLY_RUN_REASON).toBe(
      "That's a link, not the advert. CViper can't open links here, so open the page, " +
        'copy the advert text and paste it in.',
    );
  });
});

describe.each(SCREENS)('%s: runDisabledReason with a link', (_name, reason) => {
  it('happy: a real advert still runs', () => {
    expect(reason(ADVERT)).toBeNull();
  });

  it('negative: a bare https link is refused with the link reason', () => {
    expect(reason(LINK)).toBe(URL_ONLY_RUN_REASON);
  });

  it('negative: a bare http link is refused too', () => {
    expect(reason('http://jobs.example.com/advert/1')).toBe(URL_ONLY_RUN_REASON);
  });

  it('boundary: a link under the length bar gets the link reason, not "paste more"', () => {
    const short = 'https://a.co/x';
    expect(short.length).toBeLessThan(20);
    expect(reason(short)).toBe(URL_ONLY_RUN_REASON);
  });

  it('boundary: a link with newlines and spaces around it is still guarded', () => {
    expect(reason(`\n\n   ${LINK}  \n`)).toBe(URL_ONLY_RUN_REASON);
  });

  it('boundary: a link plus one word is a normal paste', () => {
    expect(reason(`${LINK} analyst`)).toBeNull();
  });

  it('boundary: www.example.com/x with no scheme is NOT guarded, as on the tracker', () => {
    expect(reason('www.example.com/x')).not.toBe(URL_ONLY_RUN_REASON);
  });

  it('edge: an ftp: address is not guarded', () => {
    expect(reason('ftp://files.example.com/advert.txt')).not.toBe(URL_ONLY_RUN_REASON);
  });

  it('edge: a blocked site (one that needs a sign-in) is guarded with the same reason', () => {
    expect(reason('https://uk.indeed.com/viewjob?jk=abc123')).toBe(URL_ONLY_RUN_REASON);
  });

  it('edge: an empty box still asks for the advert, not about links', () => {
    const said = reason('   ');
    expect(said).not.toBeNull();
    expect(said).not.toBe(URL_ONLY_RUN_REASON);
  });
});

describe('Analysis: the keyword (no-AI) option', () => {
  it('edge: is guarded too, because scoring a link is meaningless', () => {
    expect(analysis(LINK, KEYWORD)).toBe(URL_ONLY_RUN_REASON);
  });

  it('happy: still runs on a real advert', () => {
    expect(analysis(ADVERT, KEYWORD)).toBeNull();
  });
});

describe('a tracked job', () => {
  const job: Job = {
    id: 'job-1',
    source: 'manual',
    external_id: null,
    title: 'Credit Risk Analyst',
    company: 'Lloyds',
    agency: null,
    location: null,
    salary_min: null,
    salary_max: null,
    salary_currency: null,
    salary_period: null,
    // The worst case: the only "description" saved is the link itself.
    description: LINK,
    url: LINK,
    posted_date: null,
    created_at: '2026-08-01T09:00:00.000Z',
  };

  it('edge: its text is never link-only, because the title and company come first', () => {
    const text = jobAdvertText(job);
    expect(analysis(text)).not.toBe(URL_ONLY_RUN_REASON);
    expect(tailor(text)).not.toBe(URL_ONLY_RUN_REASON);
  });
});
