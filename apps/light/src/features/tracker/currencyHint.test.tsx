// @vitest-environment jsdom
/**
 * The Tracker's currency box suggests the chosen country's currency (L-418).
 *
 * The box is free text that takes a three-letter code, and until this slice its
 * greyed example, and the example in its error message, were always "GBP". They
 * now follow the country picked on Search (L-417).
 *
 * A UK user sees exactly what they saw before: the first describe pins the old
 * text byte for byte. With no country chosen, or "Another country", there is no
 * currency to suggest, so the example stays "GBP": it is an example of the
 * SHAPE of a code, and no new wording was invented for it.
 */
import { ADZUNA_COUNTRIES, currencyFor } from '@cviper/job-apis';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { COUNTRY_NOT_CHOSEN, COUNTRY_STORAGE_KEY, OTHER_COUNTRY } from '../search/country';

import { EMPTY_DRAFT, currencyExample, validateDraft } from './model';
import { NewApplicationForm } from './NewApplicationForm';

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  localStorage.clear();
});

const BAD_CURRENCY = { ...EMPTY_DRAFT, title: 'Analyst', company: 'Example', salaryCurrency: '£' };

function currencyBox(): HTMLInputElement {
  return screen.getByLabelText(/^Currency/) as HTMLInputElement;
}

function renderForm() {
  render(<NewApplicationForm onCreate={() => undefined} onCancel={() => undefined} />);
  return userEvent.setup();
}

describe('the United Kingdom is unchanged', () => {
  it('regression: the error is the sentence it always was when no example is given', () => {
    expect(validateDraft(BAD_CURRENCY).salaryCurrency).toBe(
      'Use the three-letter code for the currency, for example GBP.',
    );
  });

  it('regression: the box suggests GBP for a UK search', () => {
    localStorage.setItem(COUNTRY_STORAGE_KEY, 'gb');
    renderForm();
    expect(currencyBox().placeholder).toBe('GBP');
  });
});

describe('currencyExample — which code the box suggests', () => {
  it('happy path: each of the nineteen countries suggests its own currency', () => {
    for (const country of ADZUNA_COUNTRIES) {
      expect(currencyExample(country)).toBe(currencyFor(country));
    }
    expect(currencyExample('au')).toBe('AUD');
    expect(currencyExample('de')).toBe('EUR');
    expect(currencyExample('za')).toBe('ZAR');
  });

  it('negative: no country, "Another country" and rubbish all fall back to GBP', () => {
    expect(currencyExample(null)).toBe('GBP');
    expect(currencyExample(OTHER_COUNTRY)).toBe('GBP');
    expect(currencyExample('AU')).toBe('GBP');
    expect(currencyExample('constructor')).toBe('GBP');
  });
});

describe('the form follows the country chosen on Search', () => {
  it('happy path: Australia suggests AUD, in the box and in the error', async () => {
    localStorage.setItem(COUNTRY_STORAGE_KEY, 'au');
    const user = renderForm();
    expect(currencyBox().placeholder).toBe('AUD');

    await user.type(screen.getByLabelText('Job title'), 'Analyst');
    await user.type(screen.getByLabelText('Company'), 'Example');
    await user.type(currencyBox(), 'dollars');
    await user.click(document.querySelector('button[type="submit"]')!);

    expect(document.getElementById('new-salary-currency-error')?.textContent).toBe(
      'Use the three-letter code for the currency, for example AUD.',
    );
  });

  it('boundary: a new install that has not chosen a country is shown GBP', () => {
    localStorage.setItem(COUNTRY_STORAGE_KEY, COUNTRY_NOT_CHOSEN);
    renderForm();
    expect(currencyBox().placeholder).toBe('GBP');
  });

  it('boundary: "Another country" is shown GBP — there is no currency to suggest', () => {
    localStorage.setItem(COUNTRY_STORAGE_KEY, OTHER_COUNTRY);
    renderForm();
    expect(currencyBox().placeholder).toBe('GBP');
  });

  it('edge: nothing stored at all is shown GBP', () => {
    renderForm();
    expect(currencyBox().placeholder).toBe('GBP');
  });

  it('the suggestion is only a suggestion: any three-letter code is still accepted', () => {
    expect(validateDraft({ ...BAD_CURRENCY, salaryCurrency: 'USD' }, 'AUD')).toEqual({});
  });
});
