/**
 * The real app, mountable in a plain browser, for the rendered contrast check
 * (L-300). See `apps/light/e2e/contrast-webkit.spec.ts`.
 *
 * ============================================================================
 * WHAT IS STUBBED, AND WHY THAT IS HONEST FOR A COLOUR CHECK
 * ============================================================================
 *   - The Tauri IPC bridge (`window.__TAURI_INTERNALS__`) answers the two
 *     questions every screen asks on open — is Ollama running, is a key saved —
 *     with "no", and refuses everything else. That is the state of every first
 *     launch, and it is the same answer `App.test.tsx` gives.
 *   - The tracker, profile and tailor stores are the in-memory fakes the unit
 *     tests use, because SQLite lives behind the bridge.
 *
 * Neither changes a single class name or colour. What the spec measures —
 * which text colour lands on which painted background — is the app's own.
 *
 * The page reads eight switches from the address:
 *   - `?seen=1` skips the first-run welcome, as a returning user sees the app;
 *   - `?entries=1` puts three applications on the board, and gives Tailor
 *     their jobs, so a card's "Tailor" opens the real screen with its step
 *     bar (L-386); `?entries=long` instead puts three cards that stretch a
 *     card: a 200-letter title, a long company, an undated next action, an
 *     overdue one and one due soon (L-393);
 *   - `?results=1` says a job-board key is saved, and answers Search with a long
 *     list of adverts from the fake port (L-342: what results do to the layout).
 *   - `?trackerLoadError=<text>` and `?profileLoadError=<text>` make the
 *     Tracker board or the profile fail to load with that message, so the
 *     real screen draws its real error strip (L-374: how an error lays out).
 *   - `?cv=long` or `?cv=short` gives Tailor one CV of one line more than, or
 *     exactly, the lines its CV text shows before "Show all" (L-322: no box
 *     that scrolls inside the page);
 *   - `?marks=1` draws, instead of the app, the three components that put a
 *     drawn mark beside words (L-370: is any row taller for its mark).
 *   - `?draft=1` opens Tailor's job on a finished tailored CV, and
 *     `?draft=contact` with confirmed details on top (L-400: the CV as a page).
 *
 * And it puts five helpers on `window`, each drawing real app components into
 * an element the spec has placed:
 *   - `__mountErrorBox` draws the app's own `ErrorBox`. The panel `box` shape
 *     has no screen that draws it yet (L-368 moved only the strips), so this is
 *     how the spec lays one out inside a real panel (L-374);
 *   - `__mountBlockErrorBox` draws the `box` shape in its `div` form, holding
 *     more than one block (L-377);
 *   - `__mountPrioritySuggestions` draws `AnalysisResult` with one suggestion
 *     of each priority and long section names (L-378);
 *   - `__mountSearchFailures` and `__mountFollowUpPanel` draw the real
 *     `SearchResults` and `FollowUpPanel` showing their error boxes (L-380).
 *
 * This file is never part of the app's own build: `vite.config.ts` builds
 * `index.html` at the app root, and this page has its own config.
 */
import './harness.css';

import { err, type Application, type Job } from '@cviper/core-types';
import React from 'react';
import ReactDOM from 'react-dom/client';

const params = new URLSearchParams(window.location.search);

/** `?draft=` (below): a local model is running, as it was when the draft was written. */
const DRAFT_MODELS = JSON.stringify({
  models: [{ model: 'llama3.2:3b', name: 'llama3.2:3b', details: { parameter_size: '3.2B' } }],
});

/**
 * `?ollama=ready|empty|long` (L-406): what the probe answers, for the three
 * states of Settings' "On this PC" box. `long` is a name with nowhere to break.
 */
const LONG_MODEL = `${'verylongmodelname'.repeat(8)}:latest`;
const OLLAMA_ANSWERS: Readonly<Record<string, string>> = {
  ready: DRAFT_MODELS,
  empty: JSON.stringify({ models: [] }),
  long: JSON.stringify({
    models: [{ model: LONG_MODEL, name: LONG_MODEL, details: { parameter_size: '7B' } }],
  }),
};

(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
  invoke: (command: string): Promise<unknown> => {
    if (command === 'ollama_probe')
      return Promise.resolve(
        OLLAMA_ANSWERS[params.get('ollama') ?? ''] ?? (params.has('draft') ? DRAFT_MODELS : null),
      );
    if (command === 'secret_status') return Promise.resolve(params.get('results') === '1');
    return Promise.reject(new Error(`not available in the contrast harness: ${command}`));
  },
  transformCallback: (): number => 0,
  metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
};

const NOW = new Date(2026, 7, 19, 9, 0, 0);

function application(
  id: string,
  status: Application['status'],
): {
  job: Job;
  application: Application;
} {
  const job: Job = {
    id: `job-${id}`,
    source: 'manual',
    external_id: null,
    title: `Data Analyst ${id}`,
    company: 'Acme',
    agency: null,
    location: 'London',
    salary_min: null,
    salary_max: null,
    salary_currency: null,
    salary_period: null,
    description: null,
    url: null,
    posted_date: null,
    created_at: NOW.toISOString(),
  };
  return {
    job,
    application: {
      id,
      job_id: job.id,
      status,
      applied_date: status === 'saved' ? null : NOW.toISOString(),
      notes: null,
      next_action: null,
      next_action_date: null,
      updated_at: NOW.toISOString(),
    },
  };
}

// Imported after the bridge exists, so nothing that reads it at load time
// finds it missing.
const { default: App } = await import('../../src/app/App');
const { markWelcomeSeen } = await import('../../src/features/onboarding/store');
const { createFakeTrackerPort } = await import('../../src/features/tracker/test/fakePort');
const { createFakeProfilePort } = await import('../../src/features/profile/test/fakePort');
const { createFakeTailorPort } = await import('../../src/features/tailor/test/fakePort');
const { createFakeSearchPort, outcomeOf } =
  await import('../../src/features/search/test/fakeSearchPort');
const { entry } = await import('../../src/features/search/test/fixtures');
const { emptyQuota } = await import('@cviper/job-apis');
const { ErrorBox } = await import('../../src/ui');
const { SECONDARY_BUTTON } = await import('../../src/app/buttons');
const { COLLAPSED_LINES } = await import('../../src/features/tailor/CvTextPanel');

if (params.get('seen') === '1') markWelcomeSeen();

/** L-393: an application with its job's words and next action replaced. */
function stretched(
  id: string,
  status: Application['status'],
  job: Pick<Job, 'title' | 'company' | 'location'>,
  nextAction: string,
  nextActionDate: string | null,
): { job: Job; application: Application } {
  const base = application(id, status);
  return {
    job: { ...base.job, ...job },
    application: {
      ...base.application,
      next_action: nextAction,
      next_action_date: nextActionDate,
    },
  };
}

const entries =
  params.get('entries') === '1'
    ? [application('a', 'saved'), application('b', 'applied'), application('c', 'interviewing')]
    : params.get('entries') === 'long'
      ? [
          stretched(
            'long',
            'saved',
            {
              // One 200-letter word: nowhere a browser may break it unless told to.
              title: 'Data'.repeat(50),
              company: 'Harbour & Vale Insurance and Reinsurance Holdings International',
              location: 'Manchester, Greater Manchester, England',
            },
            'Chase the recruiter about the second-round interview date',
            null,
          ),
          stretched(
            'late',
            'applied',
            {
              title: 'Customer Insight Analyst',
              company: 'Bramble Retail Group',
              location: 'London',
            },
            'Chase the recruiter about the salary band and the start date',
            '2026-08-17',
          ),
          stretched(
            'soon',
            'interviewing',
            {
              title: 'Senior Data Analyst',
              company: 'Kestrel Health Partners',
              location: 'Bristol',
            },
            'Reply by Friday',
            '2026-08-21',
          ),
        ]
      : [];

const cvLines =
  params.get('cv') === 'long'
    ? COLLAPSED_LINES + 1
    : params.get('cv') === 'short'
      ? COLLAPSED_LINES
      : 0;
const cvs =
  cvLines === 0
    ? []
    : [
        {
          id: 'cv-harness',
          name: 'CV.docx',
          file_path: null,
          extracted_text: Array.from(
            { length: cvLines },
            (_, index) => `Line ${String(index + 1)} of the CV`,
          ).join('\n'),
          json_resume: null,
          created_at: NOW.toISOString(),
        },
      ];

/**
 * `?draft=1` (L-400): Tailor opens on a finished draft — a job, its CV, a local
 * model, and the tailored CV the last run left, brought back the way a restart
 * brings it (`workflowPort`). `?draft=contact` also has the user's confirmed
 * name and contact details, so the page has them on top.
 */
const draft = params.get('draft');
async function draftWork() {
  if (draft === null) return null;
  const { renderTailoredCv, ok } = await import('@cviper/core-types');
  const { EMPTY_TAILOR_JOB } = await import('../../src/features/tailor/jobSessions');
  const { toRow } = await import('../../src/features/tailor/persistence');
  const job: Job = {
    ...application('draft', 'saved').job,
    title: 'Insight Analyst',
    company: 'Larkspur Water Services',
    description: 'Build SQL and Python reporting on customer data. Present findings to leaders.',
  };
  const role = (title: string, company: string, dates: string, bullets: string[]) => ({
    title,
    company,
    location: 'Sheffield',
    dates,
    bullets,
  });
  const cv = {
    summary:
      'Data analyst with six years turning customer and operational data into decisions, ' +
      'in SQL, Python and Power BI, for utilities and retail.',
    key_skills: ['SQL', 'Python', 'Power BI', 'Stakeholder reporting', 'A/B testing'],
    experience: [
      role('Senior Data Analyst', 'Bramble Retail Group', 'Mar 2022 – Present', [
        'Built the weekly trading dashboard in Power BI used by 40 store managers.',
        'Rewrote the churn model in Python, cutting its run from 3 hours to 20 minutes.',
        'Presented monthly findings to the board.',
      ]),
      role('Data Analyst', 'Kestrel Health Partners', 'Jun 2019 – Feb 2022', [
        'Wrote the SQL behind the patient-wait reports.',
        'Ran A/B tests on appointment reminders.',
      ]),
    ],
    education: ['BSc Mathematics, University of Sheffield, 2019'],
    certifications: ['Microsoft Certified: Power BI Data Analyst Associate'],
  };
  const extracted = renderTailoredCv(cv, null);
  const state = {
    ...EMPTY_TAILOR_JOB,
    cvId: 'cv-draft',
    optionKey: 'ollama:llama3.2:3b',
    advert: job.description ?? '',
    result: {
      cv,
      cvId: 'cv-draft',
      text: extracted,
      report: { clean: true, flagged: [] },
      provider: 'ollama' as const,
      model: 'llama3.2:3b',
      retried: false,
      userMetrics: [],
    },
    contact:
      draft === 'contact'
        ? { 'cv-draft': { name: 'Sam Taylor', email: 'sam@example.com', phone: '07700 900 123' } }
        : {},
  };
  const row = toRow(job.id, state, NOW.toISOString());
  return {
    job,
    cv: {
      id: 'cv-draft',
      name: 'CV.docx',
      file_path: null,
      extracted_text: `Sam Taylor\n${extracted}`,
      json_resume: null,
      created_at: NOW.toISOString(),
    },
    workflowPort: {
      load: () => Promise.resolve(ok([row])),
      save: () => Promise.resolve(ok(undefined)),
      readLastJob: () => Promise.resolve(job.id),
      writeLastJob: () => Promise.resolve(),
    },
  };
}
const drafted = await draftWork();

/** A load that fails the way the database does, with the message from the address. */
function failsToLoad(message: string | null) {
  return message === null
    ? undefined
    : () => Promise.resolve(err({ code: 'QUERY_FAILED' as const, message, table: 'harness' }));
}

const trackerPort = createFakeTrackerPort(entries);
const trackerLoad = failsToLoad(params.get('trackerLoadError'));
const profilePort = createFakeProfilePort();
const profileLoad = failsToLoad(params.get('profileLoadError'));

/** What the spec asks `__mountErrorBox` to draw. */
interface MountedErrorBox {
  readonly variant: 'strip' | 'box';
  readonly layout?: 'text' | 'row';
  readonly gapAbove?: 'mt-2' | 'mt-3';
  readonly testId: string;
  readonly message: string;
}

(
  window as unknown as { __mountErrorBox: (into: Element, box: MountedErrorBox) => void }
).__mountErrorBox = (into, { variant, layout, gapAbove, testId, message }) => {
  // A row strip holds its message in a `min-w-0` span, then Retry, as Tracker's do.
  const element =
    variant === 'box' ? (
      <ErrorBox variant="box" testId={testId} {...(gapAbove === undefined ? {} : { gapAbove })}>
        {message}
      </ErrorBox>
    ) : layout === 'row' ? (
      <ErrorBox variant="strip" layout="row" testId={testId}>
        <span className="min-w-0">{message}</span>
        <button type="button" className={SECONDARY_BUTTON}>
          Retry
        </button>
      </ErrorBox>
    ) : (
      <ErrorBox variant="strip" testId={testId}>
        {message}
      </ErrorBox>
    );
  ReactDOM.createRoot(into).render(element);
};

/**
 * L-377: `__mountBlockErrorBox` draws the `box` shape in its `div` form, with
 * the blocks the two real ones hold: a paragraph and a list (Erase everything's
 * failure, `mt-3`) or two paragraphs (Settings' notice, no space above). With
 * `reference`, it also draws the HAND-BUILT box `main` drew, class for class,
 * straight after it: not an alert, test id `<id>-reference`. Same place, same
 * fonts, so "it looks as it did" is a comparison, not a pixel count.
 */
interface MountedBlockErrorBox {
  readonly holds: 'list' | 'paragraphs';
  readonly testId: string;
  readonly heading: string;
  readonly lines: readonly string[];
  readonly reference: boolean;
}

(
  window as unknown as {
    __mountBlockErrorBox: (into: Element, box: MountedBlockErrorBox) => void;
  }
).__mountBlockErrorBox = (into, { holds, testId, heading, lines, reference }) => {
  const blocks =
    holds === 'list' ? (
      <>
        <p className="font-medium">{heading}</p>
        <ul className="mt-1 list-disc pl-5 text-ink-muted">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </>
    ) : (
      <>
        <p className="font-medium">{heading}</p>
        <p className="mt-1 whitespace-pre-line text-ink-muted">{lines.join('\n')}</p>
      </>
    );
  // What `main` drew by hand before L-377 (EraseEverything.tsx, Settings.tsx).
  const handBuilt =
    holds === 'list'
      ? 'mt-3 rounded-control bg-danger/5 px-3 py-2 text-danger'
      : 'rounded-control bg-danger/5 px-3 py-2 text-danger';
  ReactDOM.createRoot(into).render(
    <>
      {holds === 'list' ? (
        <ErrorBox variant="box" as="div" gapAbove="mt-3" testId={testId}>
          {blocks}
        </ErrorBox>
      ) : (
        <ErrorBox variant="box" as="div" testId={testId}>
          {blocks}
        </ErrorBox>
      )}
      {reference ? (
        <div data-testid={`${testId}-reference`} className={handBuilt}>
          {blocks}
        </div>
      ) : null}
    </>,
  );
};

/**
 * L-380: the last hand-built boxes, drawn by the app's OWN screens' code, so
 * the spec measures what the user sees — on `main` the hand-built box, on the
 * branch the shared one — not a copy of either.
 *   - `__mountSearchFailures` draws the real `SearchResults` after a search in
 *     which one job board and one free feed failed, each with the message.
 *   - `__mountFollowUpPanel` draws the real `FollowUpPanel` for an application
 *     whose follow-up is due, with a local model to draft it, and an archive
 *     that cannot be read: pressing "Draft a follow-up" shows its red box.
 * Self-contained: nothing above is changed, and the helpers import what they
 * need when called.
 */
(
  window as unknown as {
    __mountSearchFailures: (into: Element, props: { message: string }) => Promise<void>;
  }
).__mountSearchFailures = async (into, { message }) => {
  const { SearchResults } = await import('../../src/features/search/SearchResults');
  const { combineResults } = await import('../../src/features/search/keylessModel');
  const { EMPTY_FORM } = await import('../../src/features/search/model');
  const { ok } = await import('@cviper/core-types');
  const outcome = {
    outcomes: [
      {
        provider: 'reed' as const,
        jobs: [],
        error: { provider: 'reed' as const, kind: 'server' as const, message },
      },
    ],
    jobs: [],
    clusters: [],
    quota: emptyQuota('2026-08-19'),
  };
  const keylessOutcome = {
    outcomes: [
      {
        source: 'arbeitnow' as const,
        fetched: 0,
        jobs: [],
        error: { source: 'arbeitnow' as const, kind: 'server' as const, message },
      },
    ],
    jobs: [],
  };
  const results = combineResults(outcome, keylessOutcome);
  const nothing = (): void => undefined;
  ReactDOM.createRoot(into).render(
    <SearchResults
      outcome={outcome}
      keylessOutcome={keylessOutcome}
      results={results}
      ordered={results.jobs}
      running={false}
      form={EMPTY_FORM}
      jobBoards={[]}
      browser={{ open: () => Promise.resolve(ok(undefined)) }}
      today="2026-08-19"
      tracked={new Set()}
      savingId={null}
      notes={{}}
      problems={{}}
      bands={new Map()}
      dealBreakers={[]}
      onSave={nothing}
      onOpen={nothing}
      onAnalyse={undefined}
      searchBlocked={false}
      noFreeFeedHere={false}
    />,
  );
};

(
  window as unknown as {
    __mountFollowUpPanel: (into: Element, props: { message: string }) => Promise<void>;
  }
).__mountFollowUpPanel = async (into, { message }) => {
  const { FollowUpPanel } = await import('../../src/features/tracker/FollowUpPanel');
  // Applied 13 days before `today`: quiet long enough for a follow-up to be due.
  const applied = application('followup', 'applied');
  const entry = { ...applied, application: { ...applied.application, applied_date: '2026-08-19' } };
  const port = createFakeTrackerPort([entry]);
  ReactDOM.createRoot(into).render(
    <FollowUpPanel
      entry={entry}
      today="2026-09-01"
      port={{
        ...port,
        documentsFor: () =>
          Promise.resolve(err({ code: 'QUERY_FAILED' as const, message, table: 'documents' })),
      }}
      readAvailability={() =>
        Promise.resolve({
          ollamaRunning: true,
          ollamaModels: [{ id: 'llama3.2:latest', label: 'llama3.2 (3.2B)' }],
          anthropicKey: false,
          openaiKey: false,
        })
      }
      onEdit={() => undefined}
    />,
  );
};

const searchPort = params.get('results') === '1' ? createFakeSearchPort() : undefined;
searchPort?.nextOutcome(
  outcomeOf(
    Array.from({ length: 12 }, (_, index) =>
      entry({
        id: `job-${String(index)}`,
        external_id: `reed-${String(index)}`,
        title: `Project Coordinator ${String(index)}`,
        company: `Company ${String(index)}`,
        description: null,
      }),
    ),
    emptyQuota('2026-08-19'),
  ),
);

/**
 * L-378: `__mountPrioritySuggestions` draws the app's own `AnalysisResult`
 * into an element the spec has placed, with one suggestion of each priority
 * and section names long enough to squeeze the label's row on a phone. The
 * spec checks that each priority label stays on one line, inside its card.
 */
(
  window as unknown as { __mountPrioritySuggestions: (into: Element) => Promise<void> }
).__mountPrioritySuggestions = async (into) => {
  const { AnalysisResult } = await import('../../src/features/analysis/AnalysisResult');
  const suggestion = (priority: 'high' | 'medium' | 'low', section: string) => ({
    section,
    issue: 'The advert asks for something your CV does not say.',
    recommendation: 'Say it where you did the work.',
    priority,
  });
  ReactDOM.createRoot(into).render(
    <AnalysisResult
      analysis={{
        match_score: 62,
        verdict: 'possible',
        summary: 'A summary.',
        matched_skills: [],
        missing_skills: [],
        keyword_gaps: [],
        matched_keywords: [],
        suggestions: [
          suggestion('high', 'Professional experience and achievements'),
          suggestion('medium', 'Education, training and professional qualifications'),
          suggestion('low', 'Interests, hobbies and volunteering'),
        ],
        ats_notes: [],
      }}
      provider="keyword"
      model="keyword-v3"
      aiAvailable={false}
    />,
  );
};

const root = document.getElementById('root');
if (root === null) throw new Error('#root missing from the contrast harness');

/**
 * `?marks=1` (L-370): the three places a drawn mark sits beside words — the
 * ATS Score table, a job's step bar and a tracker card's dots — on their own,
 * so a row's height can be measured with and without its mark. The real
 * components, fed the states that show every mark: OK, Check and Missing, a
 * rise and a fall; done, skipped, current and to do, and back to the tracker;
 * three dots and two rings.
 */
async function marksSheet(): Promise<React.ReactElement> {
  const { AtsStep } = await import('../../src/features/tailor/AtsStep');
  const { JobStepBar } = await import('../../src/features/flow/JobStepBar');
  const { CardProgress } = await import('../../src/features/flow/CardProgress');
  const nothing = (): void => undefined;
  return (
    <main data-testid="marks-sheet" className="space-y-4 p-4 md:p-5">
      <AtsStep
        comparison={{
          keyword: { before: 16, after: 43, delta: 27, beforeReason: null, afterReason: null },
          bullets: { before: 84, after: 81, delta: -3, totalBefore: 6, totalAfter: 6 },
          checks: [
            {
              id: 'section_headers',
              label: 'Structure & sections',
              before: 'fail',
              after: 'pass',
              afterMessage: 'Your CV has the sections a scanner looks for.',
            },
            {
              id: 'contact_info',
              label: 'Contact details',
              before: 'warn',
              after: 'warn',
              afterMessage: 'Add a phone number.',
            },
            {
              id: 'cv_length',
              label: 'Length',
              before: 'fail',
              after: 'pass',
              afterMessage: 'A good length.',
            },
          ],
          stillMissing: [],
          wordsAfter: 500,
        }}
        fabrication={{ clean: true, flagged: 0 }}
      />
      <JobStepBar
        title="Insight Analyst"
        company="Larkspur Water Services"
        location="Sheffield"
        current="ats"
        progress={{ analysed: false, tailored: true, exported: false }}
        onStep={nothing}
        onTracker={nothing}
      />
      <div className="w-44 rounded-card border border-line bg-card pb-2">
        <CardProgress
          applicationId="marks"
          progress={{ analysed: true, tailored: true, exported: false }}
          onContinue={nothing}
        />
      </div>
    </main>
  );
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    {params.get('marks') === '1' ? (
      await marksSheet()
    ) : (
      <App
        trackerPort={
          trackerLoad === undefined ? trackerPort : { ...trackerPort, load: trackerLoad }
        }
        profilePort={
          profileLoad === undefined ? profilePort : { ...profilePort, load: profileLoad }
        }
        tailorPort={createFakeTailorPort({
          cvs: drafted === null ? cvs : [...cvs, drafted.cv],
          jobs: [
            ...entries.map((tracked) => tracked.job),
            ...(drafted === null ? [] : [drafted.job]),
          ],
          applications: entries.map((tracked) => tracked.application),
        })}
        {...(drafted === null ? {} : { workflowPort: drafted.workflowPort })}
        {...(searchPort === undefined ? {} : { searchPort })}
        now={NOW}
      />
    )}
  </React.StrictMode>,
);
