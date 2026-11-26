import { distanceUnitFor } from '@cviper/job-apis';

import { SelectChevron } from '../../app/Chevrons';
import { FIELD, FIELD_SELECT } from '../../app/fields';

import {
  CHOOSE_COUNTRY_REASON,
  COUNTRY_OPTIONS,
  parseCountry,
  salaryUnit,
  type CountryChoice,
} from './country';
import { CONTRACT_CHOICES, type ContractChoice, type FormErrors, type SearchForm } from './model';

/**
 * The country, then the five search boxes: what, where, how far, how much,
 * what kind of contract.
 *
 * Presentational. Search owns the form and its errors; every change goes back
 * through `onField`, which also clears that field's error.
 *
 * ============================================================================
 * THE COUNTRY COMES FIRST, AND UNTIL IT IS CHOSEN THE REST WAITS (L-417)
 * ============================================================================
 * A new install is asked which country to search before anything can be sent;
 * the app never guesses (owner decision, 13 Nov 2026). The boxes stay on
 * screen, disabled, with one line under the picker saying why. It is the same
 * control that changes the country later, so there is one thing to learn. Once
 * a country is chosen, "Choose a country" can no longer be picked.
 */
export interface SearchFieldsProps {
  readonly form: SearchForm;
  readonly errors: FormErrors;
  readonly onField: (field: keyof SearchForm, value: string) => void;
  /** The country searched, or `null` while the person has not chosen one. */
  readonly country: CountryChoice | null;
  readonly onCountry: (country: CountryChoice) => void;
}

/** The reason line's id, so the boxes it explains can point at it. */
const COUNTRY_REASON_ID = 'search-country-reason';

/**
 * How a box that is waiting for a country looks: dimmed, label and all. A
 * disabled text box is otherwise drawn exactly like a live one, and a person
 * would click it and wonder why nothing happened.
 */
const WAITING = 'opacity-60';

/*
  Every box on Search carries `h-11 md:h-9.5` (L-437), so all six are one
  height: 44px on a phone, a whole touch target like the buttons, and 38px
  (the text box's own height) from `md` up. A drop-down is drawn on the font's
  own line, not the page's, so with only FIELD's padding it comes out a
  different height from a text box. Layout, so it sits at each box, after
  FIELD (see `app/fields.ts`).
*/

/** Row one: the keywords and the place take what the country leaves. */
const GROW = 'min-w-0 flex-1';

/** Row two: three equal shares from `md` up; they wrap on a phone (L-437). */
const SHARE = 'min-w-0 flex-1 basis-40';

export function SearchFields({ form, errors, onField, country, onCountry }: SearchFieldsProps) {
  const locked = country === null;
  const unit = salaryUnit(country);

  return (
    <>
      <div className="flex flex-wrap gap-3">
        {/* Full width on a phone, so the two boxes after it keep their row. */}
        <div className="min-w-0 basis-full md:basis-auto">
          <label htmlFor="search-country" className="block text-xs font-medium text-ink-muted">
            Country
          </label>
          {/* `mt-1` is on the wrapper, so the drawn arrow centres on the box (L-461). */}
          <span className="relative mt-1 block">
            <select
              id="search-country"
              data-testid="search-country"
              required
              value={country ?? ''}
              aria-describedby={locked ? COUNTRY_REASON_ID : undefined}
              onChange={(event) => {
                const chosen = parseCountry(event.currentTarget.value);
                if (chosen !== null) onCountry(chosen);
              }}
              className={`${FIELD_SELECT} h-11 w-full md:h-9.5`}
            >
              {locked ? <option value="">Choose a country</option> : null}
              {COUNTRY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <SelectChevron />
          </span>
          {locked ? (
            <p
              id={COUNTRY_REASON_ID}
              data-testid="search-country-reason"
              className="mt-1 text-xs text-ink-muted"
            >
              {CHOOSE_COUNTRY_REASON}
            </p>
          ) : null}
        </div>
        <Field
          id="search-keywords"
          label="Job title or keywords"
          value={form.keywords}
          error={errors.keywords}
          onChange={(value) => onField('keywords', value)}
          placeholder="e.g. Credit risk analyst"
          disabled={locked}
          layout={GROW}
        />
        <Field
          id="search-location"
          label="Location"
          value={form.location}
          error={errors.location}
          onChange={(value) => onField('location', value)}
          // "London" is an example only a United Kingdom search should be shown (L-423).
          placeholder={country === 'gb' ? 'e.g. London' : 'City or town'}
          disabled={locked}
          layout={GROW}
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-3">
        <Field
          id="search-distance"
          label={`Within (${distanceUnitFor(country)})`}
          value={form.distanceMiles}
          error={errors.distanceMiles}
          onChange={(value) => onField('distanceMiles', value)}
          placeholder="Any"
          disabled={locked}
          layout={SHARE}
        />
        <Field
          id="search-salary"
          label={unit === null ? 'Minimum salary' : `Minimum salary (${unit})`}
          value={form.salaryMin}
          error={errors.salaryMin}
          onChange={(value) => onField('salaryMin', value)}
          placeholder="Any"
          disabled={locked}
          layout={SHARE}
        />

        <div className={locked ? `${SHARE} ${WAITING}` : SHARE}>
          <label htmlFor="search-contract" className="block text-xs font-medium text-ink-muted">
            Contract type
          </label>
          <span className="relative mt-1 block">
            <select
              id="search-contract"
              data-testid="search-contract"
              value={form.contractType}
              disabled={locked}
              aria-describedby={locked ? COUNTRY_REASON_ID : undefined}
              onChange={(event) =>
                onField('contractType', event.currentTarget.value as ContractChoice)
              }
              className={`${FIELD_SELECT} h-11 w-full md:h-9.5`}
            >
              {CONTRACT_CHOICES.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </select>
            <SelectChevron />
          </span>
        </div>
      </div>
    </>
  );
}

interface FieldProps {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly error: string | undefined;
  readonly placeholder: string;
  readonly onChange: (value: string) => void;
  /** Waiting for a country (L-417). Still on screen; the reason is under the picker. */
  readonly disabled: boolean;
  /** The wrapper's share of its row: GROW or SHARE. */
  readonly layout: string;
}

function Field({ id, label, value, error, placeholder, onChange, disabled, layout }: FieldProps) {
  return (
    <div className={disabled ? `${layout} ${WAITING}` : layout}>
      <label htmlFor={id} className="block text-xs font-medium text-ink-muted">
        {label}
      </label>
      <input
        id={id}
        data-testid={id}
        type="text"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        aria-describedby={disabled ? COUNTRY_REASON_ID : undefined}
        onChange={(event) => onChange(event.currentTarget.value)}
        className={`${FIELD} mt-1 h-11 w-full md:h-9.5`}
      />
      {error === undefined ? null : (
        <p data-testid={`${id}-error`} className="mt-1 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
