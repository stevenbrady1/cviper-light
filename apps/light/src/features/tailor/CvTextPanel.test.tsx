// @vitest-environment jsdom
/**
 * L-218: the CV text the AI works from — read-only by look until the user
 * chooses to correct it, then a real text box; the correction is kept on the
 * CV, with what changed against the file and a way to put the file's text back.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type Cv } from '@cviper/core-types';

import { COLLAPSED_LINES, CvTextPanel } from './CvTextPanel';
import { MAX_CV_TEXT_CHARS } from './cvCorrection';

const CV: Cv = {
  id: 'cv-1',
  name: 'CV.pdf',
  file_path: null,
  extracted_text: 'Analyst, Barclays\n2019 2023\nSQL, Python',
  created_at: '2026-08-01T09:00:00.000Z',
  json_resume: null,
};

afterEach(cleanup);

function setUp(cv: Cv = CV, options: { disabled?: boolean; fail?: string } = {}) {
  const saved: Cv[] = [];
  const onSave = vi.fn(async (next: Cv) => {
    if (options.fail !== undefined) return options.fail;
    saved.push(next);
    return null;
  });
  const view = render(<CvTextPanel cv={cv} disabled={options.disabled ?? false} onSave={onSave} />);
  return { user: userEvent.setup(), onSave, saved, view };
}

const text = () => screen.getByTestId('tailor-cv-preview-text');

describe('reading (L-218)', () => {
  it('looks read-only: a grey panel, no input border, no text box — and says where the text came from', () => {
    setUp();
    const classes = text().className.split(/\s+/);
    expect(classes).toContain('bg-sunken');
    expect(classes).not.toContain('bg-card');
    expect(classes).not.toContain('border');
    expect(document.querySelector('textarea')).toBeNull();
    expect(screen.getByTestId('tailor-cv-source').textContent).toBe(
      'Read from CV.pdf. The AI works from exactly this text.',
    );
    expect(screen.queryByTestId('tailor-cv-restore')).toBeNull();
    expect(screen.queryByTestId('tailor-cv-changes')).toBeNull();
  });

  it('the way in to correcting is a clear button, never the text itself', () => {
    setUp();
    const correct = screen.getByTestId('tailor-cv-correct');
    expect(correct.tagName).toBe('BUTTON');
    expect(correct.textContent).toBe('Correct the text');
    expect(text().hasAttribute('contenteditable')).toBe(false);
  });
});

describe('correcting (L-218)', () => {
  it('happy: edit, save — the CV is stored with the correction and the file’s text beside it', async () => {
    const { user, onSave, saved } = setUp();
    await user.click(screen.getByTestId('tailor-cv-correct'));
    const box = screen.getByLabelText<HTMLTextAreaElement>('Correct your CV text');
    expect(box.value).toBe(CV.extracted_text);
    expect(document.activeElement).toBe(box);

    await user.clear(box);
    await user.type(box, 'Analyst, Barclays{Enter}2019 – 2023{Enter}SQL, Python');
    await user.click(screen.getByTestId('tailor-cv-edit-save'));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(saved[0]).toEqual({
      ...CV,
      extracted_text: 'Analyst, Barclays\n2019 – 2023\nSQL, Python',
      original_text: CV.extracted_text,
    });
    expect(screen.queryByLabelText('Correct your CV text')).toBeNull();
  });

  it('Cancel leaves everything as it was and saves nothing', async () => {
    const { user, onSave } = setUp();
    await user.click(screen.getByTestId('tailor-cv-correct'));
    await user.type(screen.getByLabelText('Correct your CV text'), ' extra');
    await user.click(screen.getByTestId('tailor-cv-edit-cancel'));
    expect(onSave).not.toHaveBeenCalled();
    expect(text().textContent).toBe(CV.extracted_text);
  });

  it('negative: empty text is refused with a reason, and nothing is saved', async () => {
    const { user, onSave } = setUp();
    await user.click(screen.getByTestId('tailor-cv-correct'));
    await user.clear(screen.getByLabelText('Correct your CV text'));
    await user.click(screen.getByTestId('tailor-cv-edit-save'));
    expect(onSave).not.toHaveBeenCalled();
    const problem = screen.getByTestId('tailor-cv-edit-problem');
    expect(problem.getAttribute('role')).toBe('alert');
    expect(problem.textContent).toContain('cannot be empty');
    // Still editing: the user fixes it in place.
    expect(screen.getByLabelText('Correct your CV text')).toBeTruthy();
  });

  it('negative: a refused save is reported and the edit is kept', async () => {
    const { user } = setUp(CV, { fail: 'The database is locked by another copy of CViper.' });
    await user.click(screen.getByTestId('tailor-cv-correct'));
    await user.type(screen.getByLabelText('Correct your CV text'), ' extra');
    await user.click(screen.getByTestId('tailor-cv-edit-save'));
    expect(screen.getByTestId('tailor-cv-edit-problem').textContent).toContain('locked');
    expect(screen.getByLabelText<HTMLTextAreaElement>('Correct your CV text').value).toContain(
      'extra',
    );
  });

  it('boundary: the box holds at most the limit, and shows how much is used', async () => {
    const { user } = setUp();
    await user.click(screen.getByTestId('tailor-cv-correct'));
    const box = screen.getByLabelText<HTMLTextAreaElement>('Correct your CV text');
    expect(box.maxLength).toBe(MAX_CV_TEXT_CHARS);
    expect(screen.getByTestId('tailor-cv-edit-count').textContent).toBe(
      `${CV.extracted_text?.length} / 100,000 characters`,
    );
  });

  it('while the AI is working, the text cannot be changed', () => {
    setUp(CV, { disabled: true });
    expect(screen.getByTestId('tailor-cv-correct')).toHaveProperty('disabled', true);
  });

  it('edge: a CV the file gave no text for can be typed in', async () => {
    const { user, saved } = setUp({ ...CV, extracted_text: null });
    expect(screen.getByTestId('tailor-cv-preview-empty')).toBeTruthy();
    await user.click(screen.getByTestId('tailor-cv-correct'));
    await user.type(screen.getByLabelText('Correct your CV text'), 'Typed by hand.');
    await user.click(screen.getByTestId('tailor-cv-edit-save'));
    expect(saved[0]?.extracted_text).toBe('Typed by hand.');
    expect(saved[0]?.original_text).toBe('');
  });
});

describe('a corrected CV (L-218)', () => {
  const FIXED: Cv = {
    ...CV,
    extracted_text: 'Analyst, Barclays\n2019 – 2023\nSQL, Python',
    original_text: CV.extracted_text,
  };

  it('says it was corrected, and shows what changed against the file', async () => {
    const { user } = setUp(FIXED);
    expect(screen.getByTestId('tailor-cv-source').textContent).toBe(
      'Read from CV.pdf, then corrected by you. The AI works from exactly this text.',
    );
    const changes = screen.getByTestId('tailor-cv-changes');
    await user.click(within(changes).getByText('What you changed'));
    const lines = [...changes.querySelectorAll('[data-diff]')].map((line) => [
      line.getAttribute('data-diff'),
      line.textContent,
    ]);
    expect(lines).toContainEqual(['removed', '2019 2023']);
    expect(lines).toContainEqual(['added', '2019 – 2023']);
  });

  it('Restore asks first; "Keep my corrections" changes nothing', async () => {
    const { user, onSave } = setUp(FIXED);
    await user.click(screen.getByTestId('tailor-cv-restore'));
    expect(screen.getByTestId('tailor-cv-restore-confirm').textContent).toContain(
      'Your corrections will be lost',
    );
    await user.click(screen.getByTestId('tailor-cv-restore-keep'));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.queryByTestId('tailor-cv-restore-confirm')).toBeNull();
  });

  it('happy: Restore puts the file’s text back and forgets the correction', async () => {
    const { user, saved } = setUp(FIXED);
    await user.click(screen.getByTestId('tailor-cv-restore'));
    await user.click(screen.getByTestId('tailor-cv-restore-yes'));
    expect(saved[0]).toEqual({ ...CV, original_text: null });
  });

  it('a further correction is shown against the FILE, not the last correction', async () => {
    const { user, saved } = setUp(FIXED);
    await user.click(screen.getByTestId('tailor-cv-correct'));
    await user.type(screen.getByLabelText('Correct your CV text'), ', Excel');
    await user.click(screen.getByTestId('tailor-cv-edit-save'));
    expect(saved[0]?.original_text).toBe(CV.extracted_text);
  });
});

describe('a long CV: no box that scrolls inside the page (L-322)', () => {
  /** `count` short lines, so only the line count decides "long". */
  const lines = (count: number) =>
    Array.from({ length: count }, (_, index) => `Line ${String(index + 1)}`).join('\n');
  const withText = (extracted_text: string): Cv => ({ ...CV, extracted_text });
  const showAll = () => screen.getByTestId('tailor-cv-show-all');
  const SCROLLING = ['overflow-y-auto', 'overflow-auto', 'overflow-scroll', 'overflow-y-scroll'];

  it('the collapsed height holds 11 lines: 288px (max-h-72) less 24px padding, at 24px a line', () => {
    expect(COLLAPSED_LINES).toBe(11);
  });

  it.each([
    ['a short CV', 3],
    ['a long CV', 200],
  ])('%s: the text has no scrolling overflow class', (_label, count) => {
    setUp(withText(lines(count)));
    const classes = text().className.split(/\s+/);
    for (const scrolling of SCROLLING) expect(classes).not.toContain(scrolling);
    // Nothing scrolls, so nothing needs to be a tab stop.
    expect(text().hasAttribute('tabindex')).toBe(false);
  });

  it('boundary: exactly 11 lines shows in full, unclipped, with no "Show all"', () => {
    setUp(withText(lines(COLLAPSED_LINES)));
    expect(text().textContent).toBe(lines(COLLAPSED_LINES));
    expect(text().className).not.toContain('max-h-72');
    expect(text().className).not.toContain('overflow-hidden');
    expect(screen.queryByTestId('tailor-cv-show-all')).toBeNull();
  });

  it('boundary: trailing blank lines do not count, so 11 lines and a final newline is still short', () => {
    setUp(withText(`${lines(COLLAPSED_LINES)}\n\n`));
    expect(screen.queryByTestId('tailor-cv-show-all')).toBeNull();
  });

  it('12 lines starts collapsed: clipped, never scrolled, with "Show all" controlling it', () => {
    setUp(withText(lines(COLLAPSED_LINES + 1)));
    // The whole text is in the page; only its height is capped.
    expect(text().textContent).toBe(lines(COLLAPSED_LINES + 1));
    const classes = text().className.split(/\s+/);
    expect(classes).toContain('max-h-72');
    expect(classes).toContain('overflow-hidden');
    expect(showAll().tagName).toBe('BUTTON');
    expect(showAll().textContent).toBe('Show all');
    expect(showAll().getAttribute('aria-expanded')).toBe('false');
    expect(showAll().getAttribute('aria-controls')).toBe(text().id);
    expect(text().id).not.toBe('');
  });

  it('interaction: pressing it expands in place, reads "Show less", and focus stays on it', async () => {
    const { user } = setUp(withText(lines(40)));
    const button = showAll();
    await user.click(button);
    expect(showAll()).toBe(button);
    expect(button.textContent).toBe('Show less');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(button);
    expect(text().className).not.toContain('max-h-72');
    expect(text().className).not.toContain('overflow-hidden');
  });

  it('interaction: from the keyboard too, and pressing again collapses it', async () => {
    const { user } = setUp(withText(lines(40)));
    showAll().focus();
    await user.keyboard('{Enter}');
    expect(showAll().getAttribute('aria-expanded')).toBe('true');
    await user.keyboard(' ');
    expect(showAll().textContent).toBe('Show all');
    expect(showAll().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(showAll());
    expect(text().className).toContain('max-h-72');
  });

  it('edge: text that grows from short to long gains the button, collapsed', () => {
    const { view, onSave } = setUp(withText(lines(3)));
    expect(screen.queryByTestId('tailor-cv-show-all')).toBeNull();
    view.rerender(<CvTextPanel cv={withText(lines(30))} disabled={false} onSave={onSave} />);
    expect(showAll().textContent).toBe('Show all');
    expect(text().className).toContain('max-h-72');
  });

  it('edge: while the AI is working the text cannot change, but it can still be read in full', async () => {
    const { user } = setUp(withText(lines(40)), { disabled: true });
    expect(showAll()).toHaveProperty('disabled', false);
    await user.click(showAll());
    expect(showAll().textContent).toBe('Show less');
  });

  it('correcting: no "Show all" while the text box is open; Cancel brings back the view as it was', async () => {
    const { user } = setUp(withText(lines(40)));
    await user.click(showAll());
    await user.click(screen.getByTestId('tailor-cv-correct'));
    expect(screen.queryByTestId('tailor-cv-show-all')).toBeNull();
    await user.click(screen.getByTestId('tailor-cv-edit-cancel'));
    expect(showAll().textContent).toBe('Show less');
    expect(text().className).not.toContain('max-h-72');
  });
});
