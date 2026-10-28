import { CONTRACT_CHOICES, type ContractChoice, type FormErrors, type SearchForm } from './model';

/**
 * The five search boxes: what, where, how far, how much, what kind of contract.
 *
 * Presentational. Search owns the form and its errors; every change goes back
 * through `onField`, which also clears that field's error.
 */
export interface SearchFieldsProps {
  readonly form: SearchForm;
  readonly errors: FormErrors;
  readonly onField: (field: keyof SearchForm, value: string) => void;
}

export function SearchFields({ form, errors, onField }: SearchFieldsProps) {
  return (
    <>
      <div className="flex flex-wrap gap-3">
        <Field
          id="search-keywords"
          label="Job title or keywords"
          value={form.keywords}
          error={errors.keywords}
          onChange={(value) => onField('keywords', value)}
          placeholder="Credit risk analyst"
          grow
        />
        <Field
          id="search-location"
          label="Location"
          value={form.location}
          error={errors.location}
          onChange={(value) => onField('location', value)}
          placeholder="London"
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
        />
        <Field
          id="search-salary"
          label="Minimum salary (£)"
          value={form.salaryMin}
          error={errors.salaryMin}
          onChange={(value) => onField('salaryMin', value)}
          placeholder="Any"
        />

        <div className="min-w-0">
          <label htmlFor="search-contract" className="block text-xs font-medium text-ink-muted">
            Contract type
          </label>
          <select
            id="search-contract"
            data-testid="search-contract"
            value={form.contractType}
            onChange={(event) =>
              onField('contractType', event.currentTarget.value as ContractChoice)
            }
            className="mt-1 rounded-control border border-field-line bg-card px-2.5 py-1.5 text-ink"
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
  readonly grow?: boolean;
}

function Field({ id, label, value, error, placeholder, onChange, grow = false }: FieldProps) {
  return (
    <div className={grow ? 'min-w-0 flex-1' : 'min-w-0'}>
      <label htmlFor={id} className="block text-xs font-medium text-ink-muted">
        {label}
      </label>
      <input
        id={id}
        data-testid={id}
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.currentTarget.value)}
        className="mt-1 w-full rounded-control border border-field-line bg-card px-2.5 py-1.5 text-ink"
      />
      {error === undefined ? null : (
        <p data-testid={`${id}-error`} className="mt-1 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
