/**
 * Provider payload -> `Job`, against RECORDED fixtures.
 *
 * No test here opens a socket. `adzuna-search.json` and `reed-search.json` are
 * trimmed, scrubbed captures of real responses, so what is asserted is the
 * shape both APIs actually send rather than the shape we wish they sent.
 */
import { describe, expect, it } from 'vitest';

import adzunaFixture from './fixtures/adzuna-search.json';
import reedFixture from './fixtures/reed-search.json';
import { normaliseAdzunaResponse, normaliseReedResponse } from './normalise';

const ADZUNA_BODY = JSON.stringify(adzunaFixture);
const REED_BODY = JSON.stringify(reedFixture);

/** A deterministic id source, so an assertion never depends on randomness. */
function context() {
  let next = 0;
  return {
    createdAt: '2026-08-19T09:00:00.000Z',
    newId: () => `id-${++next}`,
  };
}

function adzuna(body: string = ADZUNA_BODY) {
  return normaliseAdzunaResponse(body, context());
}

function reed(body: string = REED_BODY) {
  return normaliseReedResponse(body, context());
}

describe('normaliseAdzunaResponse — the recorded payload', () => {
  it('reads every result in the page', () => {
    const result = adzuna();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(3);
  });

  it('maps the first advert onto the shared Job type', () => {
    const result = adzuna();
    if (!result.ok) throw new Error('expected a successful normalisation');

    const first = result.value[0];
    expect(first).toBeDefined();
    expect(first?.job).toMatchObject({
      id: 'id-1',
      source: 'adzuna',
      external_id: '1000000001',
      title: 'Credit Risk Analyst',
      company: 'Example Bank plc',
      location: 'City of London, London',
      salary_min: 65000,
      salary_max: 85000,
      salary_currency: 'GBP',
      salary_period: 'year',
      posted_date: '2026-08-14',
      created_at: '2026-08-19T09:00:00.000Z',
    });
  });

  it('takes the apply link from redirect_url', () => {
    const result = adzuna();
    if (!result.ok) throw new Error('expected a successful normalisation');

    expect(result.value[0]?.job.url).toBe(
      'https://www.adzuna.co.uk/jobs/land/ad/1000000001?se=SCRUBBED&utm_medium=api',
    );
  });

  it('adds NO affiliate or campaign tracking of its own to the outbound link', () => {
    // A deliberate omission. The web app appends utm_source/utm_medium/
    // utm_campaign to every apply link; CViper Light does not, because the
    // product promise is that nothing leaves the machine, and a tagged link
    // announces the user to a third party the moment they click it.
    const result = adzuna();
    if (!result.ok) throw new Error('expected a successful normalisation');

    for (const entry of result.value) {
      expect(entry.job.url ?? '').not.toContain('utm_source=cviper');
      expect(entry.job.url ?? '').not.toContain('utm_campaign=');
    }
  });

  it('decodes entities in the description', () => {
    const result = adzuna();
    if (!result.ok) throw new Error('expected a successful normalisation');

    expect(result.value[1]?.job.description).toContain('& strong Excel skills');
    expect(result.value[1]?.job.description).not.toContain('&amp;');
  });

  it('classifies the employment type from the contract fields', () => {
    const result = adzuna();
    if (!result.ok) throw new Error('expected a successful normalisation');

    expect(result.value[0]?.contractType).toBe('Permanent');
    expect(result.value[1]?.contractType).toBe('Contract');
    expect(result.value[2]?.contractType).toBe('Part-time');
  });

  it('boundary: an advert with no salary carries no currency and no period', () => {
    // A currency with no figure beside it is noise, and a period claimed for
    // figures that do not exist is a guess.
    const result = adzuna();
    if (!result.ok) throw new Error('expected a successful normalisation');

    expect(result.value[2]?.job).toMatchObject({
      salary_min: null,
      salary_max: null,
      salary_currency: null,
      salary_period: null,
    });
  });

  it('boundary: an advert with only a minimum still gets a period', () => {
    const result = adzuna();
    if (!result.ok) throw new Error('expected a successful normalisation');

    expect(result.value[1]?.job).toMatchObject({
      salary_min: 90000,
      salary_max: null,
      salary_period: 'year',
    });
  });

  it('trims a padded title and falls back for a missing company', () => {
    const result = adzuna();
    if (!result.ok) throw new Error('expected a successful normalisation');

    expect(result.value[2]?.job.title).toBe('Junior Operations Analyst');
    expect(result.value[2]?.job.company).toBe('Unknown');
  });

  it('builds a location from the area array when there is no display name', () => {
    const result = adzuna();
    if (!result.ok) throw new Error('expected a successful normalisation');

    expect(result.value[2]?.job.location).toBe('London, UK');
  });
});

describe('normaliseReedResponse — the recorded payload', () => {
  it('maps the first advert onto the shared Job type', () => {
    const result = reed();
    if (!result.ok) throw new Error('expected a successful normalisation');

    expect(result.value[0]?.job).toMatchObject({
      source: 'reed',
      external_id: '55000001',
      title: 'Credit Risk Analyst',
      company: 'Example Recruitment Ltd',
      location: 'London',
      salary_currency: 'GBP',
      url: 'https://www.reed.co.uk/jobs/credit-risk-analyst/55000001',
    });
  });

  it('REGRESSION: a day-rate advert keeps its unit and is never inflated', () => {
    // THE PORTED BUG. Reed sends 457-550 with no period. The original encoded
    // the period into prose, the prose was lost downstream, 457 was read as an
    // annual salary and the "looks-like-thousands" guard inflated it to
    // GBP 457k. The figures below must survive UNCHANGED, with the unit beside
    // them as data.
    const result = reed();
    if (!result.ok) throw new Error('expected a successful normalisation');

    const dayRate = result.value[1]?.job;
    expect(dayRate).toMatchObject({
      title: 'Java Developer',
      salary_min: 457,
      salary_max: 550,
      salary_period: 'day',
    });
    // Nothing anywhere near an inflated annual figure.
    expect(dayRate?.salary_min).toBeLessThan(1000);
    expect(dayRate?.salary_max).toBeLessThan(1000);
  });

  it('an annual advert is marked as annual', () => {
    const result = reed();
    if (!result.ok) throw new Error('expected a successful normalisation');

    expect(result.value[0]?.job.salary_period).toBe('year');
  });

  it('REGRESSION: a "permanent contract" advert stays Permanent', () => {
    const result = reed();
    if (!result.ok) throw new Error('expected a successful normalisation');

    expect(result.value[2]?.contractType).toBe('Permanent');
  });

  it('classifies the day-rate advert as a contract from its IR35 wording', () => {
    const result = reed();
    if (!result.ok) throw new Error('expected a successful normalisation');

    expect(result.value[1]?.contractType).toBe('Contract');
  });

  it('unwraps the entity-escaped HTML Reed sends', () => {
    const result = reed();
    if (!result.ok) throw new Error('expected a successful normalisation');

    const description = result.value[0]?.job.description ?? '';
    expect(description).toContain('Our client, a leading investment bank');
    expect(description).not.toContain('&lt;');
    expect(description).not.toContain('<p>');
  });

  it('REGRESSION: does not eat a salary range written with angle brackets', () => {
    const result = reed();
    if (!result.ok) throw new Error('expected a successful normalisation');

    expect(result.value[2]?.job.description).toContain('<100k but >60k');
  });

  it('reads the dd/MM/yyyy date Reed actually sends', () => {
    // Reed publishes `date` as dd/MM/yyyy. The Python original parsed it with
    // `%Y-%m-%d`, silently failed, and stamped every Reed advert with today.
    const result = reed();
    if (!result.ok) throw new Error('expected a successful normalisation');

    expect(result.value[0]?.job.posted_date).toBe('2026-08-14');
    expect(result.value[1]?.job.posted_date).toBe('2026-08-11');
  });

  it('also reads the ISO form, in case Reed changes its mind', () => {
    const result = reed();
    if (!result.ok) throw new Error('expected a successful normalisation');

    expect(result.value[2]?.job.posted_date).toBe('2026-08-05');
  });

  it('boundary: an advert with no salary figures claims no period', () => {
    const result = reed();
    if (!result.ok) throw new Error('expected a successful normalisation');

    expect(result.value[2]?.job).toMatchObject({
      salary_min: null,
      salary_max: null,
      salary_period: null,
      salary_currency: null,
    });
  });
});

describe('normalisation — the external id that feeds the unique index', () => {
  it('carries the provider id through, as a string, for both providers', () => {
    // `UNIQUE(source, external_id)` is the free, exact half of duplicate
    // detection. Reed sends `jobId` as a NUMBER, so it has to be stringified
    // or the same advert saves twice under two different types.
    const fromAdzuna = adzuna();
    const fromReed = reed();
    if (!fromAdzuna.ok || !fromReed.ok) throw new Error('expected successful normalisations');

    expect(fromAdzuna.value.map((entry) => entry.job.external_id)).toEqual([
      '1000000001',
      '1000000002',
      '1000000003',
    ]);
    expect(fromReed.value.map((entry) => entry.job.external_id)).toEqual([
      '55000001',
      '55000002',
      '55000003',
    ]);
  });
});

describe('normalisation — negative cases', () => {
  it('a body that is not JSON is a bad response, not a crash', () => {
    for (const bad of ['', 'not json', '<html>502 Bad Gateway</html>']) {
      expect(adzuna(bad)).toMatchObject({ ok: false, error: { kind: 'bad-response' } });
      expect(reed(bad)).toMatchObject({ ok: false, error: { kind: 'bad-response' } });
    }
  });

  it('valid JSON of the wrong shape is a bad response', () => {
    for (const bad of ['[]', '42', 'null', '"a string"', '{"results":"nope"}', '{}']) {
      expect(adzuna(bad)).toMatchObject({ ok: false, error: { kind: 'bad-response' } });
      expect(reed(bad)).toMatchObject({ ok: false, error: { kind: 'bad-response' } });
    }
  });

  it('an empty results array is an ANSWER, not a failure', () => {
    // "No jobs matched" is a normal outcome of a real search.
    const empty = '{"results":[]}';
    expect(adzuna(empty)).toEqual({ ok: true, value: [] });
    expect(reed(empty)).toEqual({ ok: true, value: [] });
  });

  it('one unusable record does not lose the rest of the page', () => {
    // A row with no title cannot be shown or applied to, so it is skipped. The
    // adverts either side of it are still real jobs the user asked for.
    const mixed = JSON.stringify({
      results: [
        { id: '1', title: 'Real Job', company: { display_name: 'A' } },
        { id: '2' },
        null,
        'not an object',
        { id: '3', title: '   ' },
        { id: '4', title: 'Another Real Job' },
      ],
    });

    const result = adzuna(mixed);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.map((entry) => entry.job.title)).toEqual([
        'Real Job',
        'Another Real Job',
      ]);
    }
  });

  it('a record with no usable id still normalises, with a null external id', () => {
    // Without an id the unique index cannot protect the row, but the advert is
    // still a real job. Dropping it would be a worse answer than saving it.
    const result = adzuna(JSON.stringify({ results: [{ title: 'Idless Role' }] }));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value[0]?.job.external_id).toBeNull();
  });

  it('a date the provider mangled becomes null rather than today', () => {
    // Stamping an unreadable date with "now" invents a fact: every advert in
    // the page looks posted today, and the user sorts by the wrong thing.
    const result = reed(
      JSON.stringify({ results: [{ jobId: 1, jobTitle: 'Role', date: 'last Tuesday' }] }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value[0]?.job.posted_date).toBeNull();
  });

  it('never throws, whatever the provider sends', () => {
    const hostile = JSON.stringify({
      results: [
        {
          id: { nested: true },
          title: 12345,
          company: 'a string, not an object',
          location: [],
          salary_min: 'lots',
          salary_max: {},
          created: {},
          description: ['an', 'array'],
          redirect_url: 99,
        },
      ],
    });

    expect(() => adzuna(hostile)).not.toThrow();
    expect(adzuna(hostile).ok).toBe(true);
  });
});
