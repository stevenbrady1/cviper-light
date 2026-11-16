import { FIELD } from '../../app/fields';

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
            className={`${FIELD} mt-1 w-full`}
          >
            {locked ? <option value="">Choose a country</option> : null}
            {COUNTRY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
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
          grow
        />
        <Field
          id="search-location"
          label="Location"
          value={form.location}
          error={errors.location}
          onChange={(value) => onField('location', value)}
          placeholder="e.g. London"
          disabled={locked}
          grow
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-3">
        <Field
          id="search-distance"
          label="Within (miles)"
          value={form.distanceMiles}
          error={errors.distanceMiles}
          onChange={(value) => onField('distanceMiles', value)}
          placeholder="Any"
          disabled={locked}
        />
        <Field
          id="search-salary"
          label={unit === null ? 'Minimum salary' : `Minimum salary (${unit})`}
          value={form.salaryMin}
          error={errors.salaryMin}
          onChange={(value) => onField('salaryMin', value)}
          placeholder="Any"
          disabled={locked}
        />

        <div className={locked ? `min-w-0 ${WAITING}` : 'min-w-0'}>
          <label htmlFor="search-contract" className="block text-xs font-medium text-ink-muted">
            Contract type
          </label>
          <select
            id="search-contract"
            data-testid="search-contract"
            value={form.contractType}
            disabled={locked}
            aria-describedby={locked ? COUNTRY_REASON_ID : undefined}
            onChange={(event) =>
              onField('contractType', event.currentTarget.value as ContractChoice)
            }
            className={`${FIELD} mt-1`}
          >
            {CONTRACT_CHOICES.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
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
  readonly grow?: boolean;
}

function Field({
  id,
  label,
  value,
  error,
  placeholder,
  onChange,
  disabled,
  grow = false,
}: FieldProps) {
  return (
    <div className={`${grow ? 'min-w-0 flex-1' : 'min-w-0'}${disabled ? ` ${WAITING}` : ''}`}>
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
        className={`${FIELD} mt-1 w-full`}
      />
      {error === undefined ? null : (
        <p data-testid={`${id}-error`} className="mt-1 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
