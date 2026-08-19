import { describe, expect, it } from 'vitest';

import { type CvAnalysis } from './analysis';
import {
  BACKUP_SCHEMA_VERSION,
  exportBackup,
  importBackup,
  type BackupError,
  type BackupPayload,
} from './backup';
import {
  AnalysisSchema,
  ApplicationSchema,
  CvSchema,
  JobSchema,
  type ExtraFields,
  type Job,
} from './entities';
import { type Result } from './result';

// --- Fixture ----------------------------------------------------------------

/**
 * Deliberately hostile CV text: a pound sign, a real newline, an em dash,
 * accented Latin, CJK, a non-breaking space and a bullet. Any of these can be
 * mangled by a naive encode/decode step, and a user would not notice until
 * their CV text came back wrong months later.
 */
const CV_TEXT = [
  'SENIOR CREDIT RISK ANALYST \u2014 \u00a385,000 (\u00a3457/day contract)',
  'Bas\u00e9 \u00e0 Paris; \u65e5\u672c\u8a9e conversational. Na\u00efve Bayes, 50\u00a0% coverage.',
  '\u2022 delivered IFRS 9 staging logic',
].join('\n');

function makeCvAnalysis(): CvAnalysis {
  return {
    match_score: 82,
    verdict: 'strong',
    summary: 'Strong overlap on credit risk and Python; light on regulatory reporting.',
    matched_skills: ['Python', 'Credit Risk', 'SQL'],
    missing_skills: ['IFRS 9', 'Murex'],
    keyword_gaps: ['stress testing', 'IRB'],
    matched_keywords: ['counterparty', 'VaR'],
    suggestions: [
      {
        section: 'Summary',
        issue: 'No mention of regulatory reporting.',
        recommendation: 'Add a line naming COREP/FINREP experience.',
        priority: 'high',
      },
      {
        section: 'Skills',
        issue: 'Murex is absent.',
        recommendation: 'Name the vendor systems you have actually used.',
        priority: 'medium',
      },
    ],
    ats_notes: ['Two-column layout may not parse cleanly.'],
  };
}

function makeFixture(): BackupPayload {
  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: '2026-08-19T09:00:00.000Z',
    app: { name: 'cviper-light', version: '0.1.0' },
    jobs: [
      {
        // Adzuna, every salary field populated. `salary_period: 'day'` is the
        // entire reason that field exists: 457-550 is a good day rate and an
        // insulting annual salary, and the boards do not always say which.
        id: 'job-001',
        source: 'adzuna',
        external_id: 'adz-99881',
        title: 'Credit Risk Analyst',
        company: 'Barclays',
        location: 'London, EC2',
        salary_min: 457,
        salary_max: 550,
        salary_currency: 'GBP',
        salary_period: 'day',
        description: 'Day-rate contract, inside IR35.',
        url: 'https://example.invalid/jobs/adz-99881',
        posted_date: '2026-08-11',
        created_at: '2026-08-12T08:30:00.000Z',
      },
      {
        // Manual entry with every nullable field actually null.
        id: 'job-002',
        source: 'manual',
        external_id: null,
        title: 'Quantitative Developer',
        company: 'Man Group',
        location: null,
        salary_min: null,
        salary_max: null,
        salary_currency: null,
        salary_period: null,
        description: null,
        url: null,
        posted_date: null,
        created_at: '2026-08-13T11:00:00.000Z',
      },
    ],
    applications: [
      {
        id: 'app-001',
        job_id: 'job-001',
        status: 'interviewing',
        applied_date: '2026-08-12',
        notes: 'Second round booked.',
        next_action: 'Prepare STAR answers on risk governance',
        next_action_date: '2026-08-21',
        updated_at: '2026-08-14T16:45:00.000Z',
      },
      {
        id: 'app-002',
        job_id: 'job-002',
        status: 'saved',
        applied_date: null,
        notes: null,
        next_action: null,
        next_action_date: null,
        updated_at: '2026-08-13T11:05:00.000Z',
      },
    ],
    cvs: [
      {
        id: 'cv-001',
        name: 'Risk CV.pdf',
        // Backslashes must survive JSON escaping intact on Windows.
        file_path: 'C:\\Users\\steve\\Documents\\Risk CV.pdf',
        extracted_text: CV_TEXT,
        created_at: '2026-08-10T07:15:00.000Z',
      },
    ],
    analyses: [
      {
        id: 'analysis-001',
        cv_id: 'cv-001',
        job_id: 'job-001',
        provider: 'ollama',
        model: 'llama3.2:3b',
        match_score: 82,
        result_json: makeCvAnalysis(),
        created_at: '2026-08-14T17:02:00.000Z',
      },
    ],
  };
}

function makeEmptyFixture(): BackupPayload {
  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: '2026-08-19T09:00:00.000Z',
    app: { name: 'cviper-light', version: '0.1.0' },
    jobs: [],
    applications: [],
    cvs: [],
    analyses: [],
  };
}

// --- Helpers ----------------------------------------------------------------

/** Index an array without a non-null assertion (`noUncheckedIndexedAccess`). */
function at<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new Error('no element at index ' + String(index));
  return value;
}

function unwrap(result: Result<BackupPayload, BackupError>): BackupPayload {
  if (!result.ok) {
    throw new Error('expected ok, got ' + result.error.code + ': ' + result.error.message);
  }
  return result.value;
}

function expectError(result: Result<BackupPayload, BackupError>): BackupError {
  if (result.ok) throw new Error('expected an error, got a successful import');
  return result.error;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('expected an object, got ' + JSON.stringify(value));
  }
  return value as Record<string, unknown>;
}

function asRecordArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) throw new Error('expected an array');
  return value.map(asRecord);
}

function parseDocument(raw: string): Record<string, unknown> {
  return asRecord(JSON.parse(raw));
}

/** Every key appearing anywhere in the document, at any depth. */
function allKeys(value: unknown, found: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) allKeys(item, found);
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      found.add(key);
      allKeys(child, found);
    }
  }
  return found;
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

function withExtra(job: Job, extra: ExtraFields): Job {
  return { ...job, __extra: extra };
}

// --- The eight required cases ----------------------------------------------

describe('backup round-trip', () => {
  it('1. round-trips a fully populated backup with no loss', () => {
    const original = makeFixture();

    const imported = unwrap(importBackup(exportBackup(original)));

    expect(imported).toEqual(original);

    // Called out explicitly so a failure names the thing that broke instead of
    // dumping a whole-object diff.
    const cv = at(imported.cvs, 0);
    expect(cv.extracted_text).toBe(CV_TEXT);
    expect(cv.extracted_text).toContain('\u00a3');
    expect(cv.extracted_text).toContain('\n');
    expect(cv.extracted_text).toContain('\u65e5\u672c\u8a9e');
    expect(cv.file_path).toBe('C:\\Users\\steve\\Documents\\Risk CV.pdf');

    const adzunaJob = at(imported.jobs, 0);
    expect(adzunaJob.salary_period).toBe('day');
    expect(adzunaJob.salary_min).toBe(457);

    const manualJob = at(imported.jobs, 1);
    expect(manualJob.salary_period).toBeNull();
    expect(manualJob.external_id).toBeNull();

    expect(at(imported.applications, 0).next_action_date).toBe('2026-08-21');
    expect(at(imported.applications, 1).next_action_date).toBeNull();
    expect(at(imported.analyses, 0).result_json).toEqual(makeCvAnalysis());
  });

  it('2. round-trips an empty backup', () => {
    const original = makeEmptyFixture();

    const imported = unwrap(importBackup(exportBackup(original)));

    expect(imported).toEqual(original);
    expect(imported.jobs).toEqual([]);
    expect(imported.applications).toEqual([]);
    expect(imported.cvs).toEqual([]);
    expect(imported.analyses).toEqual([]);
  });

  it('3. rejects a newer schemaVersion without throwing, and imports nothing', () => {
    const document = parseDocument(exportBackup(makeFixture()));
    document['schemaVersion'] = 2;

    expect(() => importBackup(document)).not.toThrow();

    const result = importBackup(document);
    const error = expectError(result);
    expect(error.code).toBe('SCHEMA_VERSION_TOO_NEW');
    expect(error.message).toContain('2');
    // Nothing at all came back: there is no partial payload to import.
    expect('value' in result).toBe(false);
  });

  it('4. preserves unknown extra fields through import then export', () => {
    // THE FUNNEL TEST. A user moves a file between CViper Light and the cloud
    // app; whichever of the two is smaller must not eat the other's fields.
    const document = parseDocument(exportBackup(makeFixture()));
    const jobs = asRecordArray(document['jobs']);
    at(jobs, 0)['cloudTags'] = ['a'];
    at(jobs, 0)['enrichment'] = { score: 7 };
    at(asRecordArray(document['applications']), 0)['sourceBoardColumn'] = 'in_progress';
    at(asRecordArray(document['cvs']), 0)['embeddingModel'] = 'text-embedding-3-small';
    at(asRecordArray(document['analyses']), 0)['costUsd'] = 0;
    asRecord(document['app'])['buildSha'] = 'deadbeef';
    document['coverLetters'] = [{ id: 'cl-001' }];

    const imported = unwrap(importBackup(document));
    const roundTripped = parseDocument(exportBackup(imported));

    const job = at(asRecordArray(roundTripped['jobs']), 0);
    expect(job['cloudTags']).toEqual(['a']);
    expect(job['enrichment']).toEqual({ score: 7 });
    // The known fields are untouched by the extras mechanism.
    expect(job['id']).toBe('job-001');
    expect(job['salary_period']).toBe('day');

    expect(at(asRecordArray(roundTripped['applications']), 0)['sourceBoardColumn']).toBe(
      'in_progress',
    );
    expect(at(asRecordArray(roundTripped['cvs']), 0)['embeddingModel']).toBe(
      'text-embedding-3-small',
    );
    expect(at(asRecordArray(roundTripped['analyses']), 0)['costUsd']).toBe(0);
    expect(asRecord(roundTripped['app'])['buildSha']).toBe('deadbeef');
    expect(roundTripped['coverLetters']).toEqual([{ id: 'cl-001' }]);

    // The carrier bag is an implementation detail and must never reach a file.
    expect(allKeys(roundTripped).has('__extra')).toBe(false);
  });

  it('5. rejects a missing schemaVersion, and malformed JSON with a legible error', () => {
    const document = parseDocument(exportBackup(makeFixture()));
    delete document['schemaVersion'];

    const missing = expectError(importBackup(document));
    expect(missing.code).toBe('SCHEMA_VERSION_MISSING');
    expect(missing.message.length).toBeGreaterThan(0);

    const malformed = expectError(importBackup('{"schemaVersion": 1, "jobs": ['));
    expect(malformed.code).toBe('MALFORMED_JSON');
    // Legible: a human reading this must learn that the file is not valid JSON.
    expect(malformed.message.toLowerCase()).toContain('json');
  });

  it('6. writes schemaVersion as the first key of the file', () => {
    const out = exportBackup(makeFixture());
    expect(Object.keys(JSON.parse(out))[0]).toBe('schemaVersion');
  });

  it('7. is atomic: one bad record imports zero records', () => {
    const document = parseDocument(exportBackup(makeFixture()));
    const applications = asRecordArray(document['applications']);
    // Three valid records plus one carrying a status that is not one of the
    // five allowed values.
    document['applications'] = [
      at(applications, 0),
      { ...at(applications, 1), id: 'app-003' },
      { ...at(applications, 1), id: 'app-004' },
      { ...at(applications, 1), id: 'app-005', status: 'ghosted' },
    ];
    expect(asRecordArray(document['jobs'])).toHaveLength(2);

    const result = importBackup(document);
    const error = expectError(result);

    expect(error.code).toBe('INVALID_RECORD');
    expect(error.path).toContain('applications');
    // Not one record survived: not the three good applications, and not the
    // two perfectly valid jobs sitting in the same file.
    expect('value' in result).toBe(false);
  });

  it('8. is deterministic: identical data exports byte-identically', () => {
    const first = makeFixture();
    const second = makeFixture();

    // The same data, presented differently: reversed collections, and extras
    // whose keys were inserted in the opposite order.
    first.jobs = first.jobs.map((job) =>
      job.id === 'job-001' ? withExtra(job, { zeta: 1, alpha: 2 }) : job,
    );
    second.jobs = [...second.jobs]
      .reverse()
      .map((job) => (job.id === 'job-001' ? withExtra(job, { alpha: 2, zeta: 1 }) : job));
    second.applications = [...second.applications].reverse();
    second.cvs = [...second.cvs].reverse();
    second.analyses = [...second.analyses].reverse();

    const reordered: BackupPayload = {
      // A different literal key order must not change a single byte either.
      analyses: second.analyses,
      cvs: second.cvs,
      applications: second.applications,
      jobs: second.jobs,
      app: second.app,
      exportedAt: second.exportedAt,
      schemaVersion: second.schemaVersion,
    };

    expect(exportBackup(reordered)).toBe(exportBackup(first));
  });
});

// --- Additional guards ------------------------------------------------------

describe('backup guards', () => {
  it('emits every field of every entity, so a new column cannot be silently dropped', () => {
    const document = parseDocument(exportBackup(makeFixture()));
    const cases: Array<[string, readonly string[]]> = [
      ['jobs', Object.keys(JobSchema.shape)],
      ['applications', Object.keys(ApplicationSchema.shape)],
      ['cvs', Object.keys(CvSchema.shape)],
      ['analyses', Object.keys(AnalysisSchema.shape)],
    ];

    for (const [collection, schemaFields] of cases) {
      const record = at(asRecordArray(document[collection]), 0);
      expect(sorted(Object.keys(record)), collection).toEqual(sorted(schemaFields));
    }
  });

  it('treats __extra in an input file as reserved and never echoes it back', () => {
    const document = parseDocument(exportBackup(makeFixture()));
    at(asRecordArray(document['jobs']), 0)['__extra'] = { smuggled: true };

    const roundTripped = parseDocument(exportBackup(unwrap(importBackup(document))));

    expect(allKeys(roundTripped).has('__extra')).toBe(false);
    expect(allKeys(roundTripped).has('smuggled')).toBe(false);
  });

  it('rejects input that is not a JSON object', () => {
    expect(expectError(importBackup(42)).code).toBe('NOT_AN_OBJECT');
    expect(expectError(importBackup(null)).code).toBe('NOT_AN_OBJECT');
    expect(expectError(importBackup([])).code).toBe('NOT_AN_OBJECT');
    expect(expectError(importBackup('[]')).code).toBe('NOT_AN_OBJECT');
  });

  it('rejects a schemaVersion that is not a usable version number', () => {
    for (const version of [0, -1, 1.5, '1', null]) {
      const document = parseDocument(exportBackup(makeEmptyFixture()));
      document['schemaVersion'] = version;
      expect(expectError(importBackup(document)).code, 'schemaVersion=' + String(version)).toBe(
        'SCHEMA_VERSION_MISSING',
      );
    }
  });

  it('rejects timestamps that are not ISO-8601 UTC strings', () => {
    const bad = ['2026-08-12', '2026-08-12T08:30:00+01:00', '12/08/2026', 1755000000];
    for (const badTimestamp of bad) {
      const document = parseDocument(exportBackup(makeFixture()));
      at(asRecordArray(document['jobs']), 0)['created_at'] = badTimestamp;
      const error = expectError(importBackup(document));
      expect(error.code, 'created_at=' + String(badTimestamp)).toBe('INVALID_RECORD');
      expect(error.path).toContain('created_at');
    }
  });

  it('rejects dates that are not YYYY-MM-DD strings', () => {
    for (const badDate of ['11/08/2026', '2026-8-11', '2026-02-30', '2026-08-11T00:00:00.000Z']) {
      const document = parseDocument(exportBackup(makeFixture()));
      at(asRecordArray(document['jobs']), 0)['posted_date'] = badDate;
      expect(expectError(importBackup(document)).code, 'posted_date=' + badDate).toBe(
        'INVALID_RECORD',
      );
    }
  });

  it('rejects a job source outside the five known providers', () => {
    const document = parseDocument(exportBackup(makeFixture()));
    at(asRecordArray(document['jobs']), 0)['source'] = 'monster';
    expect(expectError(importBackup(document)).code).toBe('INVALID_RECORD');
  });

  it('rejects an analysis whose result_json is not a valid CvAnalysis', () => {
    const document = parseDocument(exportBackup(makeFixture()));
    at(asRecordArray(document['analyses']), 0)['result_json'] = { match_score: 82 };
    const error = expectError(importBackup(document));
    expect(error.code).toBe('INVALID_RECORD');
    expect(error.path).toContain('result_json');
  });

  it('accepts a raw JSON string and an already-parsed object identically', () => {
    const raw = exportBackup(makeFixture());
    expect(unwrap(importBackup(raw))).toEqual(unwrap(importBackup(JSON.parse(raw))));
  });
});
