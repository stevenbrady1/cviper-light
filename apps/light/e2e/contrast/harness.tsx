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
 * The page reads two switches from the address:
 *   - `?seen=1` skips the first-run welcome, as a returning user sees the app;
 *   - `?entries=1` puts three applications on the board.
 *
 * This file is never part of the app's own build: `vite.config.ts` builds
 * `index.html` at the app root, and this page has its own config.
 */
import './harness.css';

import { type Application, type Job } from '@cviper/core-types';
import React from 'react';
import ReactDOM from 'react-dom/client';

const params = new URLSearchParams(window.location.search);

(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
  invoke: (command: string): Promise<unknown> => {
    if (command === 'ollama_probe') return Promise.resolve(null);
    if (command === 'secret_status') return Promise.resolve(false);
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

if (params.get('seen') === '1') markWelcomeSeen();

const entries =
  params.get('entries') === '1'
    ? [application('a', 'saved'), application('b', 'applied'), application('c', 'interviewing')]
    : [];

const root = document.getElementById('root');
if (root === null) throw new Error('#root missing from the contrast harness');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App
      trackerPort={createFakeTrackerPort(entries)}
      profilePort={createFakeProfilePort()}
      tailorPort={createFakeTailorPort()}
      now={NOW}
    />
  </React.StrictMode>,
);
