/**
 * A search result's advert, made whole before it is analysed (L-190).
 *
 * Adzuna, Reed and the Guardian hand a search a PREVIEW of the advert — a few
 * hundred characters, or in the Guardian's case only the salary and location —
 * and a score computed against a preview is a score against the first
 * paragraph. These tests pin when the full page is read, when it is not, and
 * what the user is told when it cannot be.
 *
 * The page transport is injected, so "no request was made" is an assertion: a
 * factory that throws fails the test if it is ever called.
 */
import { describe, expect, it } from 'vitest';

import { err, ok, type Job, type Result } from '@cviper/core-types';
import { DESCRIPTION_MAX_CHARS } from '@cviper/job-apis';

import type { FetchedPage, PageFetchError, PageFetchTransport } from '../tracker/pageFetch';

import {
  FULL_ADVERT_MIN_CHARS,
  PREVIEW_ONLY_NOTE,
  PREVIEW_SITE_BLOCKS_NOTE,
  fetchFullAdvert,
  isPreviewAdvert,
} from './advert';

const NOW = '2026-09-29T09:00:00.000Z';

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    source: 'arbeitnow',
    external_id: 'ext-1',
    title: 'Credit Risk Analyst',
    company: 'Lloyds',
    agency: null,
    location: 'London',
    salary_min: null,
    salary_max: null,
    salary_currency: null,
    salary_period: null,
    description: 'x'.repeat(FULL_ADVERT_MIN_CHARS),
    url: 'https://jobs.example.com/advert/1',
    posted_date: null,
    created_at: NOW,
    ...overrides,
  };
}

const PREVIEW = 'You will review limit applications for the wholesale book…';

/** A readable advert page, well past the preview in length. */
const FULL_TEXT =
  'You will sit in second-line credit risk for the wholesale book, reviewing limit ' +
  'applications from the corporate and institutional coverage teams and challenging the ' +
  'assumptions behind them. Experience of corporate credit analysis in a bank or a rating ' +
  'agency is essential, along with the confidence to say no to a relationship manager. ' +
  'Study support for ACCA or CFA is available, and the team sits three days a week in the ' +
  'City office with the rest of the week worked from home.';
const FULL_PAGE = `<html><body><main><h1>Credit Risk Analyst</h1><p>${FULL_TEXT}</p></main></body></html>`;

function answering(
  reply: Result<FetchedPage, PageFetchError>,
): (() => PageFetchTransport) & { calls: string[] } {
  const calls: string[] = [];
  const factory = () => ({
    fetchPage(url: string) {
      calls.push(url);
      return Promise.resolve(reply);
    },
  });
  return Object.assign(factory, { calls });
}

function forbidden(): PageFetchTransport {
  throw new Error('the network was reached on a path that must never reach it');
}

describe('which adverts are only a preview', () => {
  it('Adzuna, Reed and the Guardian always are, however long the text', () => {
    for (const source of ['adzuna', 'reed', 'guardian'] as const) {
      expect(isPreviewAdvert(job({ source, description: 'x'.repeat(5000) })), source).toBe(true);
    }
  });

  it('a full-length advert from anywhere else is not', () => {
    for (const source of ['arbeitnow', 'manual', 'linkedin', 'indeed'] as const) {
      expect(isPreviewAdvert(job({ source })), source).toBe(false);
    }
  });

  it('boundary: one character under the threshold is a preview, the threshold itself is not', () => {
    expect(isPreviewAdvert(job({ description: 'x'.repeat(FULL_ADVERT_MIN_CHARS - 1) }))).toBe(true);
    expect(isPreviewAdvert(job({ description: 'x'.repeat(FULL_ADVERT_MIN_CHARS) }))).toBe(false);
  });

  it('boundary: whitespace is not length', () => {
    const padded = `${'x'.repeat(FULL_ADVERT_MIN_CHARS - 1)}${' '.repeat(50)}`;

    expect(isPreviewAdvert(job({ description: padded }))).toBe(true);
  });

  it('negative: no description at all is a preview', () => {
    expect(isPreviewAdvert(job({ description: null }))).toBe(true);
    expect(isPreviewAdvert(job({ description: '' }))).toBe(true);
  });
});

describe('bringing in the full advert', () => {
  it('a full advert makes no request, and comes back as it was', async () => {
    const full = await fetchFullAdvert(job(), forbidden);

    expect(full).toEqual({ text: 'x'.repeat(FULL_ADVERT_MIN_CHARS), note: null });
  });

  it('a preview with a readable page comes back as the page', async () => {
    const transport = answering(ok({ status: 200, body: FULL_PAGE }));

    const full = await fetchFullAdvert(job({ source: 'reed', description: PREVIEW }), transport);

    expect(transport.calls).toEqual(['https://jobs.example.com/advert/1']);
    expect(full.note).toBeNull();
    expect(full.text).toContain('second-line credit risk');
    expect(full.text).toContain('Credit Risk Analyst');
  });

  it('a site that blocks apps keeps the preview, and says so', async () => {
    const full = await fetchFullAdvert(
      job({ source: 'adzuna', description: PREVIEW }),
      answering(ok({ status: 403, body: FULL_PAGE })),
    );

    expect(full).toEqual({ text: PREVIEW, note: PREVIEW_SITE_BLOCKS_NOTE });
  });

  it('a blocklisted site is told the same, with no request made', async () => {
    const full = await fetchFullAdvert(
      job({ description: null, url: 'https://uk.indeed.com/viewjob?jk=abc' }),
      forbidden,
    );

    expect(full).toEqual({ text: '', note: PREVIEW_SITE_BLOCKS_NOTE });
  });

  it('negative: any other failure keeps the preview, with the plain note', async () => {
    const full = await fetchFullAdvert(
      job({ source: 'reed', description: PREVIEW }),
      answering(err({ kind: 'network', message: 'unreachable' })),
    );

    expect(full).toEqual({ text: PREVIEW, note: PREVIEW_ONLY_NOTE });
  });

  it('negative: a transport that throws is a failure like any other, never an escape', async () => {
    const throwing = () => ({
      fetchPage: () => Promise.reject(new Error('IPC went away')),
    });

    const full = await fetchFullAdvert(job({ source: 'reed', description: PREVIEW }), throwing);

    expect(full).toEqual({ text: PREVIEW, note: PREVIEW_ONLY_NOTE });
  });

  it('negative: no address to read keeps the preview, with the plain note, and no request', async () => {
    const full = await fetchFullAdvert(
      job({ source: 'reed', description: PREVIEW, url: null }),
      forbidden,
    );

    expect(full).toEqual({ text: PREVIEW, note: PREVIEW_ONLY_NOTE });
  });

  it('edge: a page shorter than the preview is not used — the preview is the better text', async () => {
    const preview = `${FULL_TEXT} ${FULL_TEXT}`;
    const full = await fetchFullAdvert(
      job({ source: 'reed', description: preview }),
      answering(ok({ status: 200, body: FULL_PAGE })),
    );

    expect(full.text).toBe(preview);
    expect(full.note).toBe(PREVIEW_ONLY_NOTE);
  });

  it('edge: an advert already read in full is kept, with no warning, when a re-read fails', async () => {
    // Analysed once, so the stored text is the full page — then the site went
    // down. "Only a preview came with this result" would be untrue about it.
    const stored = 'y'.repeat(FULL_ADVERT_MIN_CHARS + 500);

    const full = await fetchFullAdvert(
      job({ source: 'reed', description: stored }),
      answering(err({ kind: 'network', message: 'unreachable' })),
    );

    expect(full).toEqual({ text: stored, note: null });
  });

  it('boundary: a page longer than the description cap is cut to the cap', async () => {
    const huge = `<html><body><main><p>${'word '.repeat(4000)}</p></main></body></html>`;

    const full = await fetchFullAdvert(
      job({ source: 'reed', description: PREVIEW }),
      answering(ok({ status: 200, body: huge })),
    );

    expect(full.text).toHaveLength(DESCRIPTION_MAX_CHARS);
    expect(full.note).toBeNull();
  });
});

describe('what the notes say', () => {
  it('say what is true and what to do, in plain words', () => {
    expect(PREVIEW_SITE_BLOCKS_NOTE).toMatch(/blocks apps from reading its pages/);
    expect(PREVIEW_SITE_BLOCKS_NOTE).toMatch(/paste it over the preview below/);
    expect(PREVIEW_ONLY_NOTE).toMatch(/could not be read/);
    expect(PREVIEW_ONLY_NOTE).toMatch(/paste the full advert over the preview below/);
  });

  it('negative: never a status code, an error kind or the word sandbox', () => {
    for (const note of [PREVIEW_SITE_BLOCKS_NOTE, PREVIEW_ONLY_NOTE]) {
      expect(note).not.toMatch(/\b\d{3}\b|network|blocked|sandbox|error/i);
    }
  });
});
