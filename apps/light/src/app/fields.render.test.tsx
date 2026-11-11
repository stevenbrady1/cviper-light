// @vitest-environment jsdom
/**
 * The shared text-box styles, as a box on screen actually wears them (L-365).
 *
 * `fields.contract.test.ts` pins the constants and forbids copies. This file
 * checks the other half: a box that uses them still renders its invalid look
 * when it is invalid, and keeps its own layout classes on top of the shared
 * style. Read from the New application form, whose boxes use both.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { NewApplicationForm } from '../features/tracker/NewApplicationForm';

import { FIELD, FIELD_INVALID } from './fields';

afterEach(cleanup);

function classesOf(style: string): string[] {
  return style.split(/\s+/).filter((name) => name !== '');
}

function renderForm() {
  render(<NewApplicationForm onCreate={() => undefined} onCancel={() => undefined} />);
  return userEvent.setup();
}

describe('a text box on the shared style (L-365)', () => {
  it('happy path: a box at rest wears every class of FIELD and no danger edge', () => {
    renderForm();
    const title = screen.getByLabelText('Job title');
    expect([...title.classList]).toEqual(expect.arrayContaining(classesOf(FIELD)));
    expect(title.classList.contains('border-danger')).toBe(false);
  });

  it('negative: an invalid box wears every class of FIELD_INVALID and loses the resting edge', async () => {
    const user = renderForm();
    await user.click(screen.getByRole('button', { name: 'Save application' }));

    const title = screen.getByLabelText('Job title');
    expect(title.getAttribute('aria-invalid')).toBe('true');
    expect([...title.classList]).toEqual(expect.arrayContaining(classesOf(FIELD_INVALID)));
    expect(title.classList.contains('border-field-line')).toBe(false);
  });

  it('boundary: a box with its own layout classes renders them and the shared style', () => {
    renderForm();
    const salary = screen.getByLabelText(/Salary from/);
    expect([...salary.classList].sort()).toEqual(
      [...classesOf(FIELD), 'mt-1', 'w-full', 'font-mono', 'tabular-nums'].sort(),
    );
  });

  it('boundary: an invalid box keeps its layout classes too', async () => {
    const user = renderForm();
    await user.click(screen.getByRole('button', { name: 'Save application' }));
    const title = screen.getByLabelText('Job title');
    expect([...title.classList].sort()).toEqual(
      [...classesOf(FIELD_INVALID), 'mt-1', 'w-full'].sort(),
    );
  });
});
