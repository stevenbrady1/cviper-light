// @vitest-environment jsdom
/**
 * L-400 — the tailored CV drawn as a page, from the SAME block list the PDF and
 * Word files are built from (`cvBlocks`), so the screen and the saved file show
 * the same sections, in the same order, with the same words.
 *
 * Name and contact line: only the details the user confirmed, through the same
 * helper the save code uses (`cvHeader`). No confirmed details, no name.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { type TailoredCv } from '@cviper/core-types';

import { cvHeader, type CvContact } from './cvContact';
import { CvPage } from './CvPage';
import { cvBlocks, type ExportBlock } from './exportBlocks';

afterEach(cleanup);

const CV: TailoredCv = {
  summary: 'Credit risk analyst who cut IFRS 9 model run time by 40% at Lloyds Banking Group.',
  key_skills: ['Python', 'IFRS 9', 'Stress testing'],
  experience: [
    {
      title: 'Senior Credit Risk Analyst',
      company: 'Lloyds Banking Group',
      location: 'London',
      dates: 'Jan 2020 – Present',
      bullets: [
        'Built IFRS 9 impairment models in Python, cutting run time by 40%.',
        'Presented the results to the credit committee.',
      ],
    },
    {
      title: 'Analyst',
      company: 'Barclays',
      location: '',
      dates: '2016 – 2019',
      bullets: ['Ran stress tests.'],
    },
  ],
  education: ['BSc Mathematics, University of Leeds, 2016'],
  certifications: ['CFA Level I'],
};

const JANE: CvContact = { name: '  Jane Smith ', email: 'jane@x.com', phone: ' 07700 900 123' };

const sheet = () => screen.getByTestId('tailor-cv');

/** What the page draws, block by block, in order: the same shape as `cvBlocks`. */
function shown(): { kind: string; text: string; bold?: true }[] {
  return [...sheet().querySelectorAll('[data-block]')].map((element) => ({
    kind: element.getAttribute('data-block') ?? '',
    text: element.textContent ?? '',
    ...(element.hasAttribute('data-bold') ? { bold: true as const } : {}),
  }));
}

function expected(blocks: readonly ExportBlock[]) {
  return blocks.map((block) => ({
    kind: block.kind,
    text: block.text,
    ...('bold' in block && block.bold === true ? { bold: true as const } : {}),
  }));
}

describe('the page draws the export blocks (L-400)', () => {
  it('happy: draws exactly cvBlocks()’s headings, lines and bullets, in order', () => {
    render(<CvPage cv={CV} contact={null} />);
    expect(shown()).toEqual(expected(cvBlocks(CV, null, null)));
    // Bullets are a real list, one item per bullet.
    const items = sheet().querySelectorAll('ul > li');
    expect([...items].map((item) => item.textContent)).toEqual([
      'Built IFRS 9 impairment models in Python, cutting run time by 40%.',
      'Presented the results to the credit committee.',
      'Ran stress tests.',
    ]);
  });

  it('happy: with confirmed details, the name and contact line are at the top, the same as the PDF builder gets', () => {
    render(<CvPage cv={CV} contact={JANE} />);
    const { name, line } = cvHeader(JANE);
    // `buildCvPdf(cv, name, line)` draws `cvBlocks(cv, name, line)`.
    expect(shown()).toEqual(expected(cvBlocks(CV, name, line)));
    expect(shown().slice(0, 2)).toEqual([
      { kind: 'name', text: 'Jane Smith' },
      { kind: 'line', text: 'jane@x.com | 07700 900 123' },
    ]);
  });

  it('is named "Your tailored CV" for a screen reader', () => {
    render(<CvPage cv={CV} contact={null} />);
    expect(screen.getByRole('article', { name: 'Your tailored CV' })).toBe(sheet());
  });

  it('the name is the sans face, semibold — never the display serif', () => {
    render(<CvPage cv={CV} contact={JANE} />);
    const name = sheet().querySelector('[data-block="name"]');
    expect(name?.className).toContain('font-semibold');
    expect(sheet().outerHTML).not.toContain('font-display');
  });

  // NEGATIVE — nothing the user has not confirmed reaches the page.
  it('negative: with no confirmed details, no name and no contact line', () => {
    render(<CvPage cv={CV} contact={null} />);
    expect(sheet().querySelector('[data-block="name"]')).toBeNull();
    expect(shown()[0]).toEqual({ kind: 'heading', text: 'PROFESSIONAL SUMMARY' });
  });

  it('negative: confirmed but every field blank — no name and no contact line', () => {
    render(<CvPage cv={CV} contact={{ name: ' ', email: '', phone: '  ' }} />);
    expect(shown()[0]).toEqual({ kind: 'heading', text: 'PROFESSIONAL SUMMARY' });
  });

  it('negative: an empty section draws no heading', () => {
    render(<CvPage cv={{ ...CV, key_skills: [], certifications: [] }} contact={null} />);
    const headings = shown().filter((block) => block.kind === 'heading');
    expect(headings.map((block) => block.text)).toEqual([
      'PROFESSIONAL SUMMARY',
      'PROFESSIONAL EXPERIENCE',
      'EDUCATION',
    ]);
  });

  it('boundary: a CV with only a summary', () => {
    const only: TailoredCv = {
      summary: 'Analyst.',
      key_skills: [],
      experience: [],
      education: [],
      certifications: [],
    };
    render(<CvPage cv={only} contact={null} />);
    expect(shown()).toEqual([
      { kind: 'heading', text: 'PROFESSIONAL SUMMARY' },
      { kind: 'line', text: 'Analyst.' },
    ]);
    expect(sheet().querySelector('ul')).toBeNull();
  });

  // jsdom does no layout, so this pins the classes that wrap; the WebKit spec
  // measures the real sheet.
  it('edge: a 200-character unbroken word wraps inside the sheet', () => {
    const word = 'Data'.repeat(50);
    render(<CvPage cv={{ ...CV, summary: word }} contact={null} />);
    expect(sheet().className).toContain('break-words');
    expect(sheet().className).toContain('min-w-0');
    expect(sheet().textContent).toContain(word);
  });

  it('edge: letters the PDF fonts cannot draw (Cyrillic) still show on screen', () => {
    render(
      <CvPage
        cv={{ ...CV, summary: 'Аналитик кредитного риска.' }}
        contact={{ name: 'Иван Петров', email: '', phone: '' }}
      />,
    );
    expect(shown()[0]).toEqual({ kind: 'name', text: 'Иван Петров' });
    expect(sheet().textContent).toContain('Аналитик кредитного риска.');
  });
});
