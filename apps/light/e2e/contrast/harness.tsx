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
 * The page reads five switches from the address:
 *   - `?seen=1` skips the first-run welcome, as a returning user sees the app;
 *   - `?entries=1` puts three applications on the board;
 *   - `?results=1` says a job-board key is saved, and answers Search with a long
 *     list of adverts from the fake port (L-342: what results do to the layout).
 *   - `?trackerLoadError=<text>` and `?profileLoadError=<text>` make the
 *     Tracker board or the profile fail to load with that message, so the
 *     real screen draws its real error strip (L-374: how an error lays out).
 *   - `?marks=1` draws, instead of the app, the three components that put a
 *     drawn mark beside words (L-370: is any row taller for its mark).
 *
 * And it puts one helper on `window`: `__mountErrorBox`, which draws the app's
 * own `ErrorBox` into an element the spec has placed. The panel `box` shape has
 * no screen that draws it yet (L-368 moved only the strips), so this is how the
 * spec lays one out inside a real panel (L-374).
 *
 * This file is never part of the app's own build: `vite.config.ts` builds
 * `index.html` at the app root, and this page has its own config.
 */
import './harness.css';

import { err, type Application, type Job } from '@cviper/core-types';
import React from 'react';
import ReactDOM from 'react-dom/client';

const params = new URLSearchParams(window.location.search);

(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
  invoke: (command: string): Promise<unknown> => {
    if (command === 'ollama_probe') return Promise.resolve(null);
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

if (params.get('seen') === '1') markWelcomeSeen();

const entries =
  params.get('entries') === '1'
    ? [application('a', 'saved'), application('b', 'applied'), application('c', 'interviewing')]
    : [];

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
        tailorPort={createFakeTailorPort()}
        {...(searchPort === undefined ? {} : { searchPort })}
        now={NOW}
      />
    )}
  </React.StrictMode>,
);
