/**
 * The currency stamped on a salary follows the country searched (L-415).
 *
 * Adzuna's API description says its salary figures are "given in the local
 * currency" and sends no currency field, so the stamp is decided here from the
 * country the search was for. Before L-415 every advert was stamped pounds.
 */
import { describe, expect, it } from 'vitest';

import { ADZUNA_COUNTRIES, currencyFor } from './countries';
import adzunaFixture from './fixtures/adzuna-search.json';
import reedFixture from './fixtures/reed-search.json';
import { normaliseAdzunaResponse, normaliseReedResponse } from './normalise';

const ADZUNA_BODY = JSON.stringify(adzunaFixture);
const REED_BODY = JSON.stringify(reedFixture);

function context() {
  let next = 0;
  return {
    createdAt: '2026-08-19T09:00:00.000Z',
    newId: () => `id-${++next}`,
  };
}

type Normalised = ReturnType<typeof normaliseAdzunaResponse>;

/** The currency on the first advert that states a salary. */
function stamped(result: Normalised): string | null | undefined {
  if (!result.ok) throw new Error('expected a successful normalisation');
  return result.value.find((entry) => entry.job.salary_min !== null)?.job.salary_currency;
}

describe('Adzuna — the currency of the country searched', () => {
  it('a search that names no country is still stamped pounds, as before', () => {
    expect(stamped(normaliseAdzunaResponse(ADZUNA_BODY, context()))).toBe('GBP');
    expect(stamped(normaliseAdzunaResponse(ADZUNA_BODY, { ...context(), country: 'gb' }))).toBe(
      'GBP',
    );
  });

  it.each([...ADZUNA_COUNTRIES])('a search of %s is stamped that country’s money', (country) => {
    const result = normaliseAdzunaResponse(ADZUNA_BODY, { ...context(), country });

    expect(stamped(result)).toBe(currencyFor(country));
    expect(stamped(result)).toMatch(/^[A-Z]{3}$/);
  });

  it('happy: a US search is dollars and a German one is euros', () => {
    expect(stamped(normaliseAdzunaResponse(ADZUNA_BODY, { ...context(), country: 'us' }))).toBe(
      'USD',
    );
    expect(stamped(normaliseAdzunaResponse(ADZUNA_BODY, { ...context(), country: 'de' }))).toBe(
      'EUR',
    );
  });

  it('only the currency changes: the figures and the period are what Adzuna sent', () => {
    const uk = normaliseAdzunaResponse(ADZUNA_BODY, context());
    const us = normaliseAdzunaResponse(ADZUNA_BODY, { ...context(), country: 'us' });
    if (!uk.ok || !us.ok) throw new Error('expected a successful normalisation');

    const withoutCurrency = (result: typeof uk.value) =>
      result.map((entry) => ({ ...entry, job: { ...entry.job, salary_currency: null } }));
    expect(withoutCurrency(us.value)).toEqual(withoutCurrency(uk.value));
  });

  it('boundary: an advert with no salary gets no currency in any country', () => {
    const body = JSON.stringify({ results: [{ id: '1', title: 'Analyst' }] });

    for (const country of ADZUNA_COUNTRIES) {
      const result = normaliseAdzunaResponse(body, { ...context(), country });
      if (!result.ok) throw new Error('expected a successful normalisation');

      expect(result.value[0]?.job.salary_currency).toBeNull();
    }
  });

  it('negative: a country off the list stamps NO currency, never a guessed one', () => {
    for (const hostile of ['xx', 'GB', '', '../us', 'constructor']) {
      const result = normaliseAdzunaResponse(ADZUNA_BODY, {
        ...context(),
        country: hostile as never,
      });
      if (!result.ok) throw new Error('expected a successful normalisation');

      const paid = result.value.find((entry) => entry.job.salary_min !== null);
      // The figure survives; only the claim about whose money it is is dropped.
      expect(paid?.job.salary_min).toBe(65000);
      expect(paid?.job.salary_currency).toBeNull();
    }
  });
});

describe('Reed — always pounds', () => {
  it('lists UK jobs only, so its stamp ignores the country in the context', () => {
    for (const country of ['gb', 'us', 'de'] as const) {
      const result = normaliseReedResponse(REED_BODY, { ...context(), country });
      if (!result.ok) throw new Error('expected a successful normalisation');

      const currencies = new Set(
        result.value
          .filter((entry) => entry.job.salary_min !== null)
          .map((entry) => entry.job.salary_currency),
      );
      expect([...currencies]).toEqual(['GBP']);
    }
  });
});
