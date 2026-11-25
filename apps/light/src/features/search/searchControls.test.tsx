// @vitest-environment jsdom
/**
 * Search's two drop-downs, Country and Contract type, draw the chips' arrow
 * (L-461) instead of the one the browser draws. They stay real `<select>`s, so
 * the keyboard, screen readers and Windows High Contrast work as before.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FIELD_SELECT } from '../../app/fields';

import { EMPTY_FORM } from './model';
import { SearchFields } from './SearchFields';
import type { CountryChoice } from './country';

afterEach(cleanup);

function fields(country: CountryChoice | null = 'gb') {
  const onField = vi.fn();
  const onCountry = vi.fn();
  render(
    <SearchFields
      form={EMPTY_FORM}
      errors={{}}
      onField={onField}
      country={country}
      onCountry={onCountry}
    />,
  );
  return { onField, onCountry };
}

function classesOf(element: Element): string[] {
  return element.className.split(/\s+/).filter((name) => name !== '');
}

const SELECTS = ['search-country', 'search-contract'] as const;

describe('Search drop-downs draw the chips’ arrow (L-461)', () => {
  it('happy: each sits in a relative wrapper with one hidden svg, and wears FIELD_SELECT', () => {
    fields();
    for (const id of SELECTS) {
      const select = screen.getByTestId(id);
      expect(select.tagName).toBe('SELECT');
      expect(classesOf(select)).toEqual(expect.arrayContaining(FIELD_SELECT.split(' ')));
      expect(classesOf(select)).toContain('appearance-none');
      const wrapper = select.parentElement!;
      expect(classesOf(wrapper)).toContain('relative');
      expect(wrapper.querySelectorAll('svg')).toHaveLength(1);
      const mark = wrapper.querySelector('svg')!.closest('span')!;
      expect(mark.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('negative: the arrow adds no words, cannot be pressed, and takes no Tab stop', async () => {
    const user = userEvent.setup();
    fields();
    expect(screen.getByRole('combobox', { name: 'Country' })).toBe(
      screen.getByTestId('search-country'),
    );
    expect(screen.getByRole('combobox', { name: 'Contract type' })).toBe(
      screen.getByTestId('search-contract'),
    );
    for (const id of SELECTS) {
      const mark = screen.getByTestId(id).parentElement!.querySelector('span[aria-hidden="true"]')!;
      expect(mark.textContent).toBe('');
      expect(classesOf(mark)).toContain('pointer-events-none');
    }
    // Tab goes Country, then the keyword box: nothing in between.
    await user.tab();
    expect(document.activeElement).toBe(screen.getByTestId('search-country'));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByTestId('search-keywords'));
  });

  it('boundary: with no country chosen, Contract type is disabled but still drawn, arrow and all', () => {
    fields(null);
    const contract = screen.getByTestId<HTMLSelectElement>('search-contract');
    expect(contract.disabled).toBe(true);
    expect(contract.parentElement!.querySelectorAll('svg')).toHaveLength(1);
    expect(
      screen.getByTestId('search-country').parentElement!.querySelectorAll('svg'),
    ).toHaveLength(1);
  });

  it('interaction: choosing still calls the handlers', async () => {
    const user = userEvent.setup();
    const { onField, onCountry } = fields();
    await user.selectOptions(screen.getByTestId('search-country'), 'de');
    expect(onCountry).toHaveBeenCalledWith('de');
    await user.selectOptions(screen.getByTestId('search-contract'), 'Permanent');
    expect(onField).toHaveBeenCalledWith('contractType', 'Permanent');
  });
});
