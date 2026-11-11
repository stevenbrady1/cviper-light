/**
 * One made-up job that has been STARTED — analysed and tailored — for the app
 * screenshots (L-363).
 *
 * The five pictures `demoBackup.ts` feeds show no started job, so the tracker
 * card's progress dots, the step bar and the ATS Score table were on none of
 * them, and two changes to exactly those (L-360, L-362) left every picture
 * byte for byte the same. This is the job those three get photographed on.
 *
 * ============================================================================
 * NO AI CALL, NO NETWORK: STORED RESULTS, IN THE SHAPES THE APP STORES
 * ============================================================================
 * A started job is three things in the database, and each goes in the way the
 * app itself would have put it there:
 *
 *   1. the job, its application, the CV and the analysis — through the backup
 *      import, the same test-only switch `demoBackup.ts` uses. The analysis is
 *      a "Basic match" one (`provider: 'keyword'`), which the app works out on
 *      this machine without any model.
 *   2. the tailored draft — a `job_workflow` row (L-199), which Tailor reads
 *      back at launch. That table is never in a backup, by design (see
 *      `0007_job_workflow.sql`), so the smoke job writes the row with the app's
 *      own `db_execute` command and the exact statement the app's own
 *      write-through uses (`JOB_WORKFLOW_UPSERT`), then restarts the app.
 *
 * Nothing here is a new storage shape. `src/lib/demo-started-job.test.ts`
 * holds every part to the app's own code: the backup to `importBackup`, the
 * statement to `upsertInto('job_workflow')`, the row to `fromRow` / `toRow`,
 * the fabrication report to `checkFabrication`, and the screen's numbers to
 * `compareAts`.
 *
 * Every company here is invented, no person is named, and there is no email
 * address or phone number anywhere — which is also why "Contact details" reads
 * "Check" on both sides of the ATS table. Every id starts with
 * `DEMO_ID_PREFIX`, so the smoke job can delete exactly these afterwards.
 *
 * Plain objects and strings, like `demoBackup.ts`: this file runs under plain
 * Node in the smoke job, which cannot load the workspace packages.
 */

import { DEMO_ID_PREFIX } from './demoBackup.ts';

export const STARTED_JOB_ID = `${DEMO_ID_PREFIX}job-started-insight`;
export const STARTED_APPLICATION_ID = `${DEMO_ID_PREFIX}app-started-insight`;
export const STARTED_CV_ID = `${DEMO_ID_PREFIX}cv-started-insight`;
export const STARTED_ANALYSIS_ID = `${DEMO_ID_PREFIX}analysis-started-insight`;

export const STARTED_JOB_TITLE = 'Insight Analyst';
const COMPANY = 'Larkspur Water Services';
const LOCATION = 'Sheffield';

/**
 * The statement the app writes a job's Tailor work with (`upsertInto` in
 * `src/db/statements.ts`). Only statements on the approved list run, so this
 * must be that text exactly; the unit test fails if the two ever differ.
 */
export const JOB_WORKFLOW_UPSERT =
  'INSERT INTO job_workflow (id, step, cv_id, ai_option, advert, draft_json, updated_at) ' +
  'VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO UPDATE SET step = excluded.step, ' +
  'cv_id = excluded.cv_id, ai_option = excluded.ai_option, advert = excluded.advert, ' +
  'draft_json = excluded.draft_json, updated_at = excluded.updated_at';

/**
 * The approved statement that removes one CV (`deleteCv` in `src/db/cvs.ts`).
 * The app has no button for it, and the made-up CV must not outlive the run.
 * Its analysis goes with it (`analyses.cv_id` is `ON DELETE CASCADE`).
 */
export const CV_DELETE = 'DELETE FROM cvs WHERE id = $1';

/**
 * Where the app counts the requests it sends to an AI or a job site
 * (`REQUEST_LOG_STORAGE_KEY` in `src/status/requestLog.ts`). The smoke job
 * reads it before and after the started job's pictures: it must not move.
 */
export const REQUEST_COUNT_KEY = 'cviper.light.requests';

/**
 * The app's own commands that reach the network, by name (`generate_handler!`
 * in `src-tauri/src/lib.rs`). None of them may run while the started job is
 * photographed. A forbid-list of what showing a job could set off: an AI
 * call, a model list, a job search, a page fetch.
 *
 * Two things that do run are NOT here, on purpose, because neither is about
 * the job and both happen on every launch of every copy of the app:
 *
 * - `ollama_probe`. Opening Tailor asks a model server on THIS machine
 *   (loopback) whether it is switched on, for every job and for none; it
 *   sends no CV, no advert and no prompt, and the app itself does not count
 *   it as a request (`probeOllama` in `src/ai/transport.ts`).
 * - `plugin:updater|check`. The app looks for an update a moment after it
 *   starts; the restart that makes Tailor read the draft is a start. It reads
 *   one fixed file from the project's releases (`tauri.conf.json`,
 *   `plugins.updater.endpoints`) and sends nothing of the user's. The first CI run of L-363 saw
 *   it in the recorder's list, so it is named here rather than left implied.
 */
export const NETWORK_COMMANDS: readonly string[] = [
  'provider_chat',
  'provider_list_models',
  'provider_test_key',
  'custom_provider_chat',
  'custom_provider_models',
  'custom_provider_test',
  'job_search',
  'job_test_credentials',
  'keyless_fetch',
];

const ADVERT_BODY = [
  'Larkspur Water Services is looking for an Insight Analyst to join its customer insight',
  'team in Sheffield. You will turn billing, metering and customer contact data into clear',
  'reporting for operations managers.',
  '',
  'What you will do:',
  '- Build and maintain Power BI dashboards for customer service and field operations',
  '- Write SQL to extract and join data from the billing and metering systems',
  '- Analyse customer complaints and call volumes to find root causes',
  '- Present findings to non-technical stakeholders',
  '- Run data quality checks and keep the documentation up to date',
  '',
  'What we are looking for:',
  '- Strong SQL and Power BI skills',
  '- Excel and Python for data analysis',
  '- Clear communication and stakeholder management',
  '- Time in a regulated industry such as utilities is a plus',
  '- A degree in a numerate subject',
  '',
  "A made-up advert for the app's screenshots.",
].join('\n');

/**
 * The CV as it was uploaded. Its headings are not the standard ones ("Roles
 * held", "Training"), which is the cross on the ATS table's first row.
 */
export const STARTED_CV_TEXT = [
  'Data Analyst',
  '',
  'Profile',
  'Data analyst with six years of reporting work in retail and logistics. Comfortable turning',
  'messy operational data into weekly reporting for managers.',
  '',
  'Roles held',
  '',
  'Data Analyst',
  'Fernhill Logistics, Birmingham, 2021 - 2026',
  '- Built a weekly depot performance report in Excel, reducing manual preparation by 6 hours a week',
  '- Automated stock reconciliation with SQL queries, cutting reporting errors by 30%',
  '- Delivered monthly dashboards to 12 regional managers, improving on-time dispatch tracking',
  '',
  'Reporting Assistant',
  'Bramble Retail Group, London, 2019 - 2021',
  '- Produced daily sales summaries for 40 stores, enabling faster pricing decisions',
  '- Reduced duplicate customer records by 15% through a monthly cleansing routine',
  '- Managed the shared reporting inbox for the commercial team',
  '',
  'Training',
  'BSc Mathematics, University of Northmoor, 2015 - 2018',
  'Microsoft Power BI Data Analyst certificate, 2022',
  '',
  'Skills',
  'SQL, Excel, Power BI, data cleansing, reporting, stakeholder updates',
].join('\n');

/**
 * The tailored CV, as a model hands it back (`TailoredCv`). It uses more of the
 * advert's words than the original, and its bullets lost their figures — the
 * up arrow and the down arrow on the ATS table.
 */
const TAILORED_CV = {
  summary:
    'Data analyst with six years of reporting work in retail and logistics, using SQL, Excel ' +
    'and Power BI for data analysis and clear reporting to operations managers and ' +
    'non-technical stakeholders.',
  key_skills: [
    'SQL',
    'Power BI dashboards',
    'Excel',
    'Data analysis',
    'Data quality checks',
    'Stakeholder management',
    'Reporting',
  ],
  experience: [
    {
      title: 'Data Analyst',
      company: 'Fernhill Logistics',
      location: 'Birmingham',
      dates: '2021 - 2026',
      bullets: [
        'Delivered monthly Power BI dashboards to 12 regional managers, improving on-time dispatch tracking',
        'Wrote SQL queries to join stock and dispatch data for reporting',
        'Worked with managers on data quality checks and documentation',
      ],
    },
    {
      title: 'Reporting Assistant',
      company: 'Bramble Retail Group',
      location: 'London',
      dates: '2019 - 2021',
      bullets: [
        'Produced daily sales summaries for store managers',
        'Cleansed customer records to support data quality',
      ],
    },
  ],
  education: ['BSc Mathematics, University of Northmoor, 2015 - 2018'],
  certifications: ['Microsoft Power BI Data Analyst certificate, 2022'],
};

const DAY_MS = 24 * 60 * 60 * 1000;

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** `jobAdvertText` for this job: what Tailor's advert box holds for it. */
export function startedJobAdvert(): string {
  return `${STARTED_JOB_TITLE}\n${COMPANY}\n${LOCATION}\n\n${ADVERT_BODY}`;
}

/** The tailored CV as text, exactly as `renderTailoredCv(cv, null)` writes it. */
function renderedTailoredCv(): string {
  const lines: string[] = [];
  lines.push('PROFESSIONAL SUMMARY', TAILORED_CV.summary, '');
  lines.push('KEY SKILLS', TAILORED_CV.key_skills.join(', '), '');
  lines.push('PROFESSIONAL EXPERIENCE');
  for (const role of TAILORED_CV.experience) {
    lines.push('', role.title);
    lines.push(`${role.company} | ${role.location} | ${role.dates}`);
    for (const bullet of role.bullets) lines.push(`- ${bullet}`);
  }
  lines.push('');
  lines.push('EDUCATION', ...TAILORED_CV.education, '');
  lines.push('CERTIFICATIONS', ...TAILORED_CV.certifications, '');
  return `${lines.join('\n')}`;
}

/**
 * The "Basic match" result for this CV and advert, as `runAnalysis` returned it
 * for the keyword option (`provider: 'keyword'`, model `keyword-v3`) when this
 * file was written. Worked out on the machine by the keyword scorer: no model,
 * no network. Not on any picture — it is here so the card and the step bar can
 * say, truthfully, that the job has been analysed.
 */
const STARTED_ANALYSIS = {
  match_score: 39,
  verdict: 'weak',
  summary:
    'Keyword match only — this compared the words on your CV with the words in the advert, and nothing more. Your CV shows 3 of the 7 things this advert asks for, and uses 16% of the wording an applicant tracking system would scan for. Rarer skills count for more than ones every advert asks for, so a specialist gap costs more than a missing buzzword.',
  matched_skills: ['SQL', 'Power BI', 'Excel'],
  missing_skills: ['Python', 'Data Analysis', 'Stakeholder Management', 'Customer Service'],
  keyword_gaps: [
    'python',
    'customer service',
    'insight',
    'field',
    'stakeholder management',
    'larkspur',
    'water',
    'services',
    'sheffield',
    'join',
    'billing',
    'metering',
    'clear',
    'operations',
    'find',
  ],
  matched_keywords: [
    'sql',
    'data analysis',
    'power bi',
    'excel',
    'analyst',
    'reporting',
    'managers',
    'dashboards',
    'stakeholders',
    'skills',
  ],
  suggestions: [
    {
      section: 'Skills',
      issue: 'The advert asks for Python and your CV does not mention it.',
      recommendation:
        'If you have used Python, name it in your skills list and in the bullet point where you used it. If you have not, this is a genuine gap rather than a wording problem.',
      priority: 'high',
    },
    {
      section: 'Skills',
      issue: 'The advert asks for Data Analysis and your CV does not mention it.',
      recommendation:
        'If you have used Data Analysis, name it in your skills list and in the bullet point where you used it. If you have not, this is a genuine gap rather than a wording problem.',
      priority: 'high',
    },
    {
      section: 'Skills',
      issue: 'The advert asks for Stakeholder Management and your CV does not mention it.',
      recommendation:
        'If you have used Stakeholder Management, name it in your skills list and in the bullet point where you used it. If you have not, this is a genuine gap rather than a wording problem.',
      priority: 'high',
    },
    {
      section: 'Wording',
      issue:
        'The advert uses Python, Customer Service, Insight, Field, Stakeholder Management and your CV does not.',
      recommendation:
        "These are words a screening system looks for. Where you have done the work, use the advert's word for it rather than your own.",
      priority: 'high',
    },
    {
      section: 'Job title',
      issue: 'The job titles on your CV only partly line up with the one in the advert.',
      recommendation:
        "Where it is honest to do so, use the advert's own job title in your personal statement or as a bracketed alternative next to your current title.",
      priority: 'medium',
    },
  ],
  ats_notes: [
    "Applicant tracking system keyword score: 16 out of 100. That is the share of the advert's wording, weighted by how distinctive each term is, that appears somewhere on your CV.",
    'Add more keywords from the job description to your CV',
    'Ensure section headers match standard ATS formats (Experience, Education, Skills)',
    'Use the exact job title from the posting in your CV summary',
  ],
};

/** A backup file's text, dated from `now`: the job, its application, the CV and the analysis. */
export function startedJobBackup(now: Date): string {
  const created = new Date(now.getTime() - 3 * DAY_MS);
  const analysed = new Date(now.getTime() - 2 * DAY_MS);
  return JSON.stringify(
    {
      schemaVersion: 1,
      exportedAt: now.toISOString(),
      app: { name: 'cviper-light', version: 'screenshot-demo' },
      profile: null,
      jobs: [
        {
          id: STARTED_JOB_ID,
          source: 'manual',
          external_id: null,
          title: STARTED_JOB_TITLE,
          company: COMPANY,
          agency: null,
          location: LOCATION,
          salary_min: 39000,
          salary_max: 44000,
          salary_currency: 'GBP',
          salary_period: 'year',
          description: ADVERT_BODY,
          url: null,
          posted_date: isoDate(created),
          created_at: created.toISOString(),
        },
      ],
      applications: [
        {
          id: STARTED_APPLICATION_ID,
          job_id: STARTED_JOB_ID,
          status: 'saved',
          applied_date: null,
          notes: null,
          next_action: 'Check the ATS score',
          next_action_date: null,
          updated_at: now.toISOString(),
          interview_substage_id: null,
        },
      ],
      interview_substages: [],
      documents: [],
      cvs: [
        {
          id: STARTED_CV_ID,
          name: 'Data Analyst CV (sample)',
          file_path: null,
          extracted_text: STARTED_CV_TEXT,
          created_at: created.toISOString(),
          json_resume: null,
        },
      ],
      analyses: [
        {
          id: STARTED_ANALYSIS_ID,
          cv_id: STARTED_CV_ID,
          job_id: STARTED_JOB_ID,
          provider: 'keyword',
          model: 'keyword-v3',
          match_score: STARTED_ANALYSIS.match_score,
          result_json: STARTED_ANALYSIS,
          created_at: analysed.toISOString(),
        },
      ],
    },
    null,
    2,
  );
}

/**
 * The job's `job_workflow` row, as the values `JOB_WORKFLOW_UPSERT` takes, in
 * its column order: id, step, cv_id, ai_option, advert, draft_json, updated_at.
 *
 * `draft_json` is what `toRow` writes for a session holding this draft: the
 * tailored CV with its text, fabrication report and the model that wrote it,
 * and no review, letter, handed-over gaps or confirmed contact details.
 * `ai_option` is `null` — "the screen's default" — so nothing on the runner
 * has to offer the model named in the draft.
 */
export function startedJobWorkflowValues(now: Date): (string | null)[] {
  const draft = {
    result: {
      cv: TAILORED_CV,
      cvId: STARTED_CV_ID,
      text: renderedTailoredCv(),
      report: { clean: true, flagged: [] },
      provider: 'ollama',
      model: 'llama3.2:3b',
      retried: false,
      userMetrics: [],
    },
    review: null,
    letter: null,
    handedGaps: null,
    contact: {},
  };
  return [
    STARTED_JOB_ID,
    'tailor',
    STARTED_CV_ID,
    null,
    startedJobAdvert(),
    JSON.stringify(draft),
    now.toISOString(),
  ];
}
