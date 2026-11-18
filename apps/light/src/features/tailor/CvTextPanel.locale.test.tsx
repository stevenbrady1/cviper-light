// @vitest-environment jsdom
/**
 * The CV text box counts in this computer's number format (L-423).
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type Cv } from '@cviper/core-types';

const CV: Cv = {
  id: 'cv-1',
  name: 'CV.pdf',
  file_path: null,
  extracted_text: 'Analyst\nSQL, Python',
  created_at: '2026-08-01T09:00:00.000Z',
  json_resume: null,
};

const real = Number.prototype.toLocaleString;

/**
 * The panel as a computer set to `locale` loads it. Loaded afresh, because one
 * of its messages is worded once, when the file is first read.
 */
async function panelOnAComputerSetTo(locale: string) {
  vi.resetModules();
  vi.spyOn(Number.prototype, 'toLocaleString').mockImplementation(function (
    this: number,
    locales?: Intl.LocalesArgument,
    options?: Intl.NumberFormatOptions,
  ) {
    return real.call(this, locales ?? locale, options);
  });
  const { CvTextPanel } = await import('./CvTextPanel');
  const { MAX_CV_TEXT_CHARS } = await import('./cvCorrection');
  render(<CvTextPanel cv={CV} disabled={false} onSave={async () => null} />);
  fireEvent.click(screen.getByTestId('tailor-cv-correct'));
  return { MAX_CV_TEXT_CHARS };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the CV text box follows the computer’s number format (L-423)', () => {
  it('happy: a computer set to German counts up to 100.000', async () => {
    await panelOnAComputerSetTo('de-DE');
    expect(screen.getByTestId('tailor-cv-edit-count').textContent).toBe(
      `${CV.extracted_text?.length} / 100.000 characters`,
    );
  });

  it('negative: text over the limit is refused, with the limit in that format too', async () => {
    const { MAX_CV_TEXT_CHARS } = await panelOnAComputerSetTo('de-DE');
    fireEvent.change(screen.getByLabelText('Correct your CV text'), {
      target: { value: 'a'.repeat(MAX_CV_TEXT_CHARS + 1) },
    });
    fireEvent.click(screen.getByTestId('tailor-cv-edit-save'));
    const problem = (await screen.findByTestId('tailor-cv-edit-problem')).textContent ?? '';
    expect(problem).toContain('at most 100.000 characters');
    expect(screen.getByTestId('tailor-cv-edit-count').textContent).toBe(
      '100.001 / 100.000 characters',
    );
  });

  it('boundary: a computer set to British English still counts up to 100,000', async () => {
    await panelOnAComputerSetTo('en-GB');
    expect(screen.getByTestId('tailor-cv-edit-count').textContent).toContain(
      '/ 100,000 characters',
    );
  });
});
