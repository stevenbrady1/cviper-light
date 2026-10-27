// @vitest-environment jsdom
/**
 * L-297 (from L-237, GitHub issue 246) — an automated accessibility pass over every
 * top-level screen.
 *
 * axe-core is the engine browsers' own accessibility tools use. Each screen is
 * drawn the way a first-time user sees it (no AI, no keys, nothing saved) and
 * axe checks it against WCAG 2.1 A and AA. Bugs like L-235 (an unlabelled
 * control) were found by hand in the launch audit; this finds that class on
 * every PR.
 *
 * ============================================================================
 * WHAT IT CANNOT SEE — HONEST LIMITS
 * ============================================================================
 *   - Colour contrast. jsdom does no layout or painting, so axe cannot
 *     compute colours here; the rule is reported "incomplete", never passed.
 *     Contrast is held by the design tokens and checked on the landing site.
 *   - Anything only drawn after a user action (a dialog, a result). This is
 *     the screen as first opened; the component tests own the rest.
 *   - Whether the words make sense to a person. No tool does.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { type Application, type Job } from '@cviper/core-types';
import axe from 'axe-core';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type TrackerEntry } from '../features/tracker/model';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));

const { default: App } = await import('./App');
const { markWelcomeSeen } = await import('../features/onboarding/store');
const { createFakeTrackerPort } = await import('../features/tracker/test/fakePort');
const { createFakeProfilePort } = await import('../features/profile/test/fakePort');
const { createFakeTailorPort } = await import('../features/tailor/test/fakePort');
const { ConsentGate } = await import('../features/analysis/ConsentGate');

const NOW = new Date(2026, 7, 19, 9, 0, 0);

/**
 * WCAG 2.0, 2.1 and 2.2 at A and AA — the bar CViper is held to — plus axe's
 * best-practice rules (landmarks, heading order, one main region), which
 * every screen also passes today and so can be held to from here on.
 */
const RUN_ONLY: axe.RunOnly = {
  type: 'tag',
  values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'],
};

export const AXE_OPTIONS: axe.RunOptions = { runOnly: RUN_ONLY, resultTypes: ['violations'] };

/**
 * The whole document, minus the hint tooltip.
 *
 * `Hint` portals its `role="tooltip"` bubble to <body>, so it can float over
 * any edge; the trigger points at it with aria-describedby, which is how a
 * screen reader reaches it — the WAI-ARIA tooltip pattern. axe's best-practice
 * "region" rule wants every element inside a landmark and so flags the bubble
 * (seen on the tracker, where the nav button keeps focus and its hint shows).
 * The bubble's own semantics are pinned in `Hint.test.tsx`.
 */
export const WHOLE_SCREEN: axe.ElementContext = { exclude: ['[data-testid="hint"]'] };

/** One line per failing element, so a red run says what and where. */
export function describeViolations(violations: readonly axe.Result[]): string[] {
  return violations.flatMap((v) =>
    v.nodes.map((node) => `${v.id} (${v.impact ?? 'n/a'}): ${node.target.join(' ')} — ${v.help}`),
  );
}

async function violationsIn(context: axe.ElementContext): Promise<string[]> {
  const result = await axe.run(context, AXE_OPTIONS);
  return describeViolations(result.violations);
}

/**
 * How many WCAG rules found something to check and passed. A screen that
 * failed to draw passes every rule vacuously, so a clean result is only
 * believed when enough rules had something to look at.
 */
async function rulesThatApplied(context: axe.ElementContext): Promise<number> {
  const result = await axe.run(context, { runOnly: RUN_ONLY });
  return result.passes.length + result.violations.length;
}

/**
 * jsdom starts every test with a bare <html>: no lang, no <title>. The app's
 * real page sets both in `index.html`, so they are read from THAT file and put
 * on the test document — a lang or title deleted from index.html then fails
 * here, rather than being supplied by the test and never missed.
 */
const INDEX_HTML = readFileSync(join(import.meta.dirname, '..', '..', 'index.html'), 'utf8');
const PAGE_LANG = /<html[^>]*\slang="([^"]+)"/.exec(INDEX_HTML)?.[1] ?? '';
const PAGE_TITLE = /<title>([^<]*)<\/title>/.exec(INDEX_HTML)?.[1] ?? '';

/** Every screen applies more than this today (fewest: the welcome screen). */
const MIN_RULES_APPLIED = 10;

beforeEach(() => {
  document.documentElement.lang = PAGE_LANG;
  document.title = PAGE_TITLE;
  localStorage.clear();
  tauri.invoke.mockReset();
  tauri.invoke.mockImplementation(async (command) => {
    if (command === 'ollama_probe') return null;
    if (command === 'secret_status') return false;
    throw new Error(`unexpected command ${command}`);
  });
});

afterEach(() => {
  cleanup();
});

function application(id: string, status: Application['status']): TrackerEntry {
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

function renderApp(entries: readonly TrackerEntry[] = []) {
  return render(
    <App
      trackerPort={createFakeTrackerPort(entries)}
      profilePort={createFakeProfilePort()}
      tailorPort={createFakeTailorPort()}
      now={NOW}
    />,
  );
}

describe('every top-level screen passes axe (WCAG 2.1 A + AA)', () => {
  it('the welcome screen a first-time user opens on', async () => {
    renderApp();
    await screen.findByTestId('welcome');
    expect(await violationsIn(WHOLE_SCREEN)).toEqual([]);
    expect(await rulesThatApplied(WHOLE_SCREEN)).toBeGreaterThanOrEqual(MIN_RULES_APPLIED);
  });

  it.each(['profile', 'search', 'tracker', 'analysis', 'tailor', 'settings'])(
    'the %s screen',
    async (id) => {
      markWelcomeSeen();
      const user = userEvent.setup();
      renderApp();
      await screen.findByTestId('status-strip');
      await user.click(screen.getByTestId(`nav-${id}`));
      await vi.waitFor(() =>
        expect(screen.getByTestId(`nav-${id}`).getAttribute('aria-current')).toBe('page'),
      );
      expect(await violationsIn(WHOLE_SCREEN)).toEqual([]);
      expect(await rulesThatApplied(WHOLE_SCREEN)).toBeGreaterThanOrEqual(MIN_RULES_APPLIED);
    },
  );
});

/**
 * The states a user reaches in their first minute, beyond the screen as
 * opened: a full result (the one-click sample), a board with applications on
 * it, and the box that asks before a CV leaves the machine.
 */
describe('the first minute of use passes axe too', () => {
  it('the sample result on the CV check', async () => {
    markWelcomeSeen();
    const user = userEvent.setup();
    renderApp();
    await screen.findByTestId('status-strip');
    await user.click(screen.getByTestId('nav-analysis'));
    await user.click(await screen.findByTestId('analysis-try-sample'));
    await screen.findByTestId('analysis-sample');
    expect(await violationsIn(WHOLE_SCREEN)).toEqual([]);
  });

  it('a board with applications in three columns', async () => {
    markWelcomeSeen();
    const user = userEvent.setup();
    renderApp([
      application('a', 'saved'),
      application('b', 'applied'),
      application('c', 'interviewing'),
    ]);
    await screen.findByTestId('status-strip');
    await user.click(screen.getByTestId('nav-tracker'));
    await screen.findByTestId('tracker-column-saved');
    expect(screen.getAllByText(/Data Analyst/).length).toBeGreaterThanOrEqual(3);
    expect(await violationsIn(WHOLE_SCREEN)).toEqual([]);
  });

  it('an application opened in the detail pane, at interview stage', async () => {
    markWelcomeSeen();
    const user = userEvent.setup();
    renderApp([application('c', 'interviewing')]);
    await screen.findByTestId('status-strip');
    await user.click(screen.getByTestId('nav-tracker'));
    await user.click(await screen.findByTestId('tracker-card-c'));
    await screen.findByTestId('detail-pane');
    expect(await violationsIn(WHOLE_SCREEN)).toEqual([]);
  });

  it('the box that asks before a CV is sent', async () => {
    render(<ConsentGate kind="openai" onAccept={vi.fn()} onDecline={vi.fn()} />);
    await screen.findByTestId('analysis-consent-gate');
    expect(await violationsIn(WHOLE_SCREEN)).toEqual([]);
  });
});

describe('the check itself', () => {
  it('the real page names its language and has a title', () => {
    expect(PAGE_LANG).toMatch(/^en\b/);
    expect(PAGE_TITLE.trim()).not.toBe('');
  });

  // NEGATIVE — a guard that cannot fail is not a guard.
  it('negative: an unlabelled text box and an image with no alt text are caught', async () => {
    const { container } = render(
      <main>
        <input type="text" />
        <img src="data:," />
      </main>,
    );
    const found = await violationsIn(container);
    expect(found.some((line) => line.startsWith('label'))).toBe(true);
    expect(found.some((line) => line.startsWith('image-alt'))).toBe(true);
  });

  // BOUNDARY — the same markup, labelled, is clean.
  it('boundary: the same controls, labelled, pass', async () => {
    const { container } = render(
      <main>
        <label>
          Name
          <input type="text" />
        </label>
        <img src="data:," alt="" />
      </main>,
    );
    expect(await violationsIn(container)).toEqual([]);
  });
});
