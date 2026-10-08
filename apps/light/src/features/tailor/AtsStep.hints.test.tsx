// @vitest-environment jsdom
/**
 * L-215: every mark in the ATS Score section says what it means — ✓ ⚠ ✗,
 * ▲ ▼, the dash, the band word, each row, each column, the heading's "ATS"
 * and the fabrication line — on hover, on focus and to a screen reader.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  ATS_BAND_HINT,
  ATS_CHECK_HINT,
  ATS_HINT,
  ATS_STATUS_HINT,
  changeHint,
} from '../../app/hints';

import { AtsStep } from './AtsStep';
import { type AtsComparison } from './atsComparison';

const BASE: AtsComparison = {
  keyword: { before: 50, after: 47, delta: -3, beforeReason: null, afterReason: null },
  bullets: { before: 0, after: 30, delta: 30, totalBefore: 0, totalAfter: 5 },
  checks: [
    {
      id: 'section_headers',
      label: 'Structure & sections',
      before: 'pass',
      after: 'warn',
      afterMessage: 'Missing section(s): Education.',
    },
    {
      id: 'contact_info',
      label: 'Contact details',
      before: 'pass',
      after: 'fail',
      afterMessage: 'Missing: email address, phone number.',
    },
    {
      id: 'cv_length',
      label: 'Length',
      before: 'warn',
      after: 'pass',
      afterMessage: '640 words.',
    },
  ],
  stillMissing: ['pega'],
  wordsAfter: 640,
};

afterEach(cleanup);

function describedBy(element: Element): string | null {
  const id = element.getAttribute('aria-describedby');
  return id === null ? null : (document.getElementById(id)?.textContent ?? null);
}

function hintOn(text: string, within_: HTMLElement = document.body): string | null {
  return describedBy(within(within_).getByText(text));
}

describe('ATS Score hints (L-215)', () => {
  it('the heading explains what ATS stands for', () => {
    render(<AtsStep comparison={BASE} fabrication={{ clean: true, flagged: 0 }} />);
    expect(hintOn('ATS score')).toBe(ATS_HINT.heading);
  });

  it('each column and each row says what it measures', () => {
    render(<AtsStep comparison={BASE} fabrication={{ clean: true, flagged: 0 }} />);
    expect(hintOn('Before')).toBe(ATS_HINT.before);
    expect(hintOn('After')).toBe(ATS_HINT.after);
    expect(hintOn('Keyword coverage')).toBe(ATS_HINT.keyword);
    expect(hintOn('Bullet strength')).toBe(ATS_HINT.bullets);
    expect(hintOn('Structure & sections')).toBe(ATS_CHECK_HINT.section_headers);
    expect(hintOn('Contact details')).toBe(ATS_CHECK_HINT.contact_info);
    expect(hintOn('Length')).toBe(ATS_CHECK_HINT.cv_length);
  });

  it('happy: ✓, ⚠ and ✗ each say what they mean', () => {
    render(<AtsStep comparison={BASE} fabrication={{ clean: true, flagged: 0 }} />);
    expect(hintOn('✓ OK', screen.getByTestId('tailor-ats-check-section_headers'))).toBe(
      ATS_STATUS_HINT.pass,
    );
    expect(hintOn('⚠ Check', screen.getByTestId('tailor-ats-check-section_headers'))).toBe(
      ATS_STATUS_HINT.warn,
    );
    expect(hintOn('✗ Missing', screen.getByTestId('tailor-ats-check-contact_info'))).toBe(
      ATS_STATUS_HINT.fail,
    );
  });

  it('▼ and ▲ say which way and by how much, and the band word gives its range', () => {
    render(<AtsStep comparison={BASE} fabrication={{ clean: true, flagged: 0 }} />);
    expect(hintOn('▼ -3')).toBe(changeHint(-3));
    expect(hintOn('Needs work')).toBe(ATS_BAND_HINT.low);
  });

  it('boundary: the dash for "no score" and "no change" are explained too', () => {
    const flat = { ...BASE, keyword: { ...BASE.keyword, after: 50, delta: 0 } };
    render(<AtsStep comparison={flat} fabrication={{ clean: true, flagged: 0 }} />);
    expect(hintOn('no change')).toBe(ATS_HINT.noChange);
    const bullets = screen.getByTestId('tailor-ats-bullets');
    expect(describedBy(within(bullets).getAllByText('—')[0]!)).toBe(ATS_HINT.noScore);
  });

  it('the fabrication check and the still-missing words are explained', () => {
    render(<AtsStep comparison={BASE} fabrication={{ clean: false, flagged: 1 }} />);
    expect(hintOn('Fabrication check:')).toBe(ATS_HINT.fabrication);
    expect(hintOn('Still missing from the advert:')).toBe(ATS_HINT.stillMissing);
  });

  it('hovering a mark shows its explanation on screen', () => {
    render(<AtsStep comparison={BASE} fabrication={{ clean: true, flagged: 0 }} />);
    const mark = within(screen.getByTestId('tailor-ats-check-contact_info')).getByText('✗ Missing');
    fireEvent.mouseEnter(mark);
    const visible = screen.getAllByRole('tooltip').filter((tip) => !tip.hidden);
    expect(visible.map((tip) => tip.textContent)).toEqual([ATS_STATUS_HINT.fail]);
  });
});
