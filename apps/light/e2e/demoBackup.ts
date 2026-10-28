/**
 * Made-up applications for the app screenshots (L-244).
 *
 * The smoke job imports this through the test-only backup switch (L-242), then
 * photographs the main screens of the REAL built app, so the landing page and
 * the store listings can show it in use without anybody's own data in it.
 *
 * Every company here is invented, and no person is named. Every id starts
 * with `DEMO_ID_PREFIX`, so the smoke job can delete exactly these afterwards
 * and leave a developer's machine as it found it.
 *
 * Plain objects, not the app's `exportBackup`: this file runs under plain
 * Node in the smoke job, which cannot load the core-types package (its
 * imports have no file extensions). `src/lib/demo-backup.test.ts` holds it to
 * the format instead, by importing it with the app's own `importBackup`.
 */

export const DEMO_ID_PREFIX = 'demo-';

interface DemoRole {
  readonly key: string;
  readonly title: string;
  readonly company: string;
  readonly location: string;
  readonly salaryMin: number | null;
  readonly salaryMax: number | null;
  readonly status: 'saved' | 'applied' | 'interviewing' | 'offer';
  /** How many days ago it last moved. */
  readonly daysAgo: number;
  readonly nextAction: string | null;
}

const ROLES: readonly DemoRole[] = [
  {
    key: 'data-analyst',
    title: 'Data Analyst',
    company: 'Northwind Analytics',
    location: 'Leeds',
    salaryMin: 34000,
    salaryMax: 40000,
    status: 'saved',
    daysAgo: 1,
    nextAction: 'Tailor CV',
  },
  {
    key: 'reporting-analyst',
    title: 'Reporting Analyst',
    company: 'Harbour & Vale Insurance',
    location: 'Manchester',
    salaryMin: 38000,
    salaryMax: 45000,
    status: 'applied',
    daysAgo: 4,
    nextAction: null,
  },
  {
    key: 'bi-developer',
    title: 'BI Developer',
    company: 'Fernhill Logistics',
    location: 'Birmingham',
    salaryMin: 45000,
    salaryMax: 52000,
    status: 'applied',
    daysAgo: 12,
    nextAction: 'Chase the recruiter',
  },
  {
    key: 'insight-analyst',
    title: 'Customer Insight Analyst',
    company: 'Bramble Retail Group',
    location: 'London',
    salaryMin: 42000,
    salaryMax: 48000,
    status: 'interviewing',
    daysAgo: 2,
    nextAction: 'Prepare STAR examples',
  },
  {
    key: 'senior-analyst',
    title: 'Senior Data Analyst',
    company: 'Kestrel Health Partners',
    location: 'Bristol',
    salaryMin: 50000,
    salaryMax: 58000,
    status: 'interviewing',
    daysAgo: 6,
    nextAction: null,
  },
  {
    key: 'analytics-lead',
    title: 'Analytics Lead',
    company: 'Oakmere Energy',
    location: 'Remote (UK)',
    salaryMin: 60000,
    salaryMax: 68000,
    status: 'offer',
    daysAgo: 1,
    nextAction: 'Reply by Friday',
  },
];

const DAY_MS = 24 * 60 * 60 * 1000;

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The application ids, in the order the file lists them. */
export function demoApplicationIds(): string[] {
  return ROLES.map((role) => `${DEMO_ID_PREFIX}app-${role.key}`);
}

/** A backup file's text, dated from `now`, holding the made-up applications above. */
export function demoBackup(now: Date): string {
  const jobs = ROLES.map((role) => {
    const created = new Date(now.getTime() - (role.daysAgo + 3) * DAY_MS);
    return {
      id: `${DEMO_ID_PREFIX}job-${role.key}`,
      source: 'manual',
      external_id: null,
      title: role.title,
      company: role.company,
      agency: null,
      location: role.location,
      salary_min: role.salaryMin,
      salary_max: role.salaryMax,
      salary_currency: role.salaryMin === null ? null : 'GBP',
      salary_period: role.salaryMin === null ? null : 'year',
      description: `${role.title} at ${role.company}, ${role.location}. A made-up advert for the app's screenshots.`,
      url: null,
      posted_date: isoDate(created),
      created_at: created.toISOString(),
    };
  });

  const applications = ROLES.map((role) => {
    const updated = new Date(now.getTime() - role.daysAgo * DAY_MS);
    return {
      id: `${DEMO_ID_PREFIX}app-${role.key}`,
      job_id: `${DEMO_ID_PREFIX}job-${role.key}`,
      status: role.status,
      applied_date: role.status === 'saved' ? null : isoDate(updated),
      notes: null,
      next_action: role.nextAction,
      next_action_date: null,
      updated_at: updated.toISOString(),
      interview_substage_id: null,
    };
  });

  return JSON.stringify(
    {
      schemaVersion: 1,
      exportedAt: now.toISOString(),
      app: { name: 'cviper-light', version: 'screenshot-demo' },
      profile: null,
      jobs,
      applications,
      interview_substages: [],
      documents: [],
      cvs: [],
      analyses: [],
    },
    null,
    2,
  );
}
