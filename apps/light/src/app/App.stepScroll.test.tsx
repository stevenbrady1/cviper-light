// @vitest-environment jsdom
/**
 * L-216: moving around never moves the app itself.
 *
 * On Tailor, a step link scrolled to its step with `scrollIntoView`, which
 * scrolls EVERY box between the step and the window — the shell and the page
 * included. The whole window slid up: the rail cut off at the top, the bottom
 * half blank. The fix scrolls only the screen's own scroll area.
 *
 * This walks every way of moving — each step link and Back/Next on Tailor and
 * on Analysis, each rail item, each Ctrl+number shortcut, a tracker card's
 * Continue, and the same at phone width — and after each one checks two things:
 *
 *   1. nothing outside a screen's own scroll area was scrolled (the page, the
 *      window, the shell, the main column), and `scrollIntoView` was never
 *      used at all;
 *   2. the screen is the one it should be: the right view, the job still
 *      chosen, the right step marked, and the rail (or the phone's bottom
 *      bar) still there.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ok, type Cv } from '@cviper/core-types';
import { type ChatTransport } from '@cviper/ai-providers';
import { type JobProviderId } from '@cviper/job-apis';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));

const { default: App } = await import('./App');
const { markWelcomeSeen } = await import('../features/onboarding/store');
const { createFakeTrackerPort } = await import('../features/tracker/test/fakePort');
const { createFakeProfilePort } = await import('../features/profile/test/fakePort');
const { createFakeAnalysisPort } = await import('../features/analysis/test/fakePort');
const { createFakeTailorPort } = await import('../features/tailor/test/fakePort');
const { createFakeSearchPort } = await import('../features/search/test/fakeSearchPort');
const { createFakeBoardPort } = await import('../features/boards/test/fakeBoardPort');
const { createFakeBackupPort } = await import('../features/settings/test/fakePort');
const { createFakeErasePort } = await import('../features/settings/erase/test/fakeErasePort');
const { createFakeFilePort } = await import('../platform/test/fakeFilePort');
const { createFakeOpenedCvPort } = await import('../platform/test/fakeOpenedCvPort');
const { createFakeBrowserPort } = await import('../platform/test/fakeBrowserPort');
const { WIDE_QUERY } = await import('./viewport');

import type { TrackerEntry } from '../features/tracker/model';

const BOTH_KEYS: Record<JobProviderId, 'configured'> = { adzuna: 'configured', reed: 'configured' };

const CVS: Cv[] = [
  {
    id: 'cv-1',
    name: 'CV.docx',
    file_path: null,
    extracted_text:
      'Credit risk analyst, eight years in London banking. SQL, Python, Basel III, ' +
      'stress testing, IFRS 9 impairment models, stakeholder reporting.',
    json_resume: null,
    created_at: '2026-08-01T09:00:00.000Z',
  },
];

const TRACKED: TrackerEntry = {
  job: {
    id: 'job-tracked',
    source: 'manual',
    external_id: null,
    title: 'Market Risk Analyst',
    company: 'Barclays',
    agency: null,
    location: 'London',
    salary_min: null,
    salary_max: null,
    salary_currency: null,
    salary_period: null,
    description: 'SQL and Python for market risk reporting. IFRS 9 a plus.',
    url: null,
    posted_date: null,
    created_at: '2026-09-01T09:00:00.000Z',
  },
  application: {
    id: 'app-tracked',
    job_id: 'job-tracked',
    status: 'saved',
    applied_date: null,
    notes: null,
    next_action: null,
    next_action_date: null,
    updated_at: '2026-09-29T09:00:00.000Z',
  },
};

let chats = 0;
const chat: ChatTransport = {
  chat: () => {
    chats += 1;
    return Promise.reject(new Error('the step bar must never call a model'));
  },
  listModels: () => Promise.resolve(ok({ status: 200, body: JSON.stringify({ models: [] }) })),
};

beforeEach(() => {
  chats = 0;
  localStorage.clear();
  sessionStorage.clear();
  markWelcomeSeen();
  tauri.invoke.mockReset();
  tauri.invoke.mockImplementation(async (command) => {
    if (command === 'ollama_probe') return null;
    if (command === 'secret_status') return false;
    throw new Error(`unexpected command ${command}`);
  });
});

afterEach(() => {
  cleanup();
  delete (window as { matchMedia?: unknown }).matchMedia;
});

function installMatchMedia(widthPx: number) {
  const list = {
    matches: widthPx >= 768,
    media: WIDE_QUERY,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: () => list,
  });
}

async function renderApp(
  saved: Record<string, { analysed?: boolean; exported?: boolean }> = {},
  cvs: Cv[] = CVS,
) {
  const user = userEvent.setup();
  let counter = 0;
  render(
    <App
      trackerPort={createFakeTrackerPort([TRACKED])}
      profilePort={createFakeProfilePort()}
      analysisPort={createFakeAnalysisPort({ cvs, jobs: [TRACKED.job] })}
      tailorPort={createFakeTailorPort({
        cvs,
        jobs: [TRACKED.job],
        applications: [TRACKED.application],
      })}
      searchPort={createFakeSearchPort([])}
      boardsPort={createFakeBoardPort()}
      browser={createFakeBrowserPort()}
      readKeyStates={async () => BOTH_KEYS}
      filePort={createFakeFilePort()}
      openedCv={createFakeOpenedCvPort()}
      backupPort={createFakeBackupPort()}
      erasePort={createFakeErasePort()}
      createTransport={() => chat}
      workflowPort={null}
      boardProgressPort={{
        loadAll: async () =>
          new Map(
            Object.entries(saved).map(([jobId, progress]) => [
              jobId,
              { analysed: false, exported: false, ...progress },
            ]),
          ),
      }}
      newId={() => `generated-${(counter += 1)}`}
      now={new Date('2026-10-06T09:00:00.000Z')}
    />,
  );
  await screen.findByTestId('shell');
  return { user };
}

type User = ReturnType<typeof userEvent.setup>;

const current = () =>
  document.querySelector('[aria-current="step"]')?.getAttribute('data-testid') ?? null;

/** What scrolled, recorded by stand-ins: jsdom has neither scroll call. */
let scrolled: Element[] = [];
let intoView = 0;
let windowScrolls = 0;

beforeEach(() => {
  scrolled = [];
  intoView = 0;
  windowScrolls = 0;
  Element.prototype.scrollIntoView = function scrollIntoView() {
    intoView += 1;
  };
  Element.prototype.scrollTo = function scrollTo(this: Element) {
    scrolled.push(this);
  } as Element['scrollTo'];
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {
    windowScrolls += 1;
  });
});

afterEach(() => {
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  delete (Element.prototype as { scrollTo?: unknown }).scrollTo;
  vi.restoreAllMocks();
});

/** The screens' own scroll areas: the only things allowed to scroll. */
const OWN_SCROLL_AREAS = new Set(['tailor-scroll']);

/** Nothing but a screen's own scroll area has moved, and the frame is intact. */
function expectFrameUntouched(narrow = false) {
  expect(intoView, 'scrollIntoView scrolls the shell and the page too').toBe(0);
  expect(windowScrolls).toBe(0);
  const outside = scrolled.filter(
    (element) => !OWN_SCROLL_AREAS.has(element.getAttribute('data-testid') ?? ''),
  );
  expect(outside.map((element) => element.outerHTML.slice(0, 80))).toEqual([]);
  const shell = screen.getByTestId('shell');
  const main = shell.querySelector('main');
  for (const element of [document.documentElement, document.body, shell, main]) {
    expect(element?.scrollTop ?? 0).toBe(0);
    expect(element?.scrollLeft ?? 0).toBe(0);
  }
  expect(chats, 'moving around never runs a model').toBe(0);
  if (narrow) expect(screen.getByTestId('bottom-nav')).toBeTruthy();
  else expect(screen.getByTestId('nav-tailor')).toBeTruthy();
}

async function tailorWithJob(user: User) {
  await user.click(screen.getByTestId('nav-tracker'));
  await user.click(await screen.findByTestId('tracker-card-app-tracked'));
  await user.click(await screen.findByTestId('detail-analyse'));
  await screen.findByTestId('view-analysis');
  await user.click(await screen.findByTestId('job-steps-next'));
  await screen.findByTestId('view-tailor');
  await vi.waitFor(() =>
    expect(screen.getByTestId<HTMLSelectElement>('tailor-job-pick').value).toBe('job-tracked'),
  );
}

function expectOnTailorWithJob(step: string) {
  expect(screen.getByTestId('view-tailor')).toBeTruthy();
  expect(screen.getByTestId<HTMLSelectElement>('tailor-job-pick').value).toBe('job-tracked');
  expect(screen.getByTestId('job-steps-job').textContent).toContain('Market Risk Analyst');
  expect(current()).toBe(step);
}

describe('Tailor’s own step links (L-216)', () => {
  it('happy: each step link moves the step, keeps the job, and scrolls only Tailor’s own area', async () => {
    const { user } = await renderApp();
    await tailorWithJob(user);
    expectFrameUntouched();

    for (const [link, step] of [
      ['job-step-ats', 'job-step-ats'],
      ['job-step-export', 'job-step-export'],
      ['job-step-tailor', 'job-step-tailor'],
    ] as const) {
      await user.click(screen.getByTestId(link));
      await vi.waitFor(() => expect(current()).toBe(step));
      expectOnTailorWithJob(step);
      expectFrameUntouched();
    }
    // Back on the Tailor step, its own area was scrolled to it — and only that.
    expect(scrolled.map((element) => element.getAttribute('data-testid'))).toContain(
      'tailor-scroll',
    );
  });

  it('Back and Next on Tailor do the same', async () => {
    const { user } = await renderApp();
    await tailorWithJob(user);

    await user.click(screen.getByTestId('job-steps-next'));
    await vi.waitFor(() => expect(current()).toBe('job-step-ats'));
    expectOnTailorWithJob('job-step-ats');
    expectFrameUntouched();

    await user.click(screen.getByTestId('job-steps-back'));
    await vi.waitFor(() => expect(current()).toBe('job-step-tailor'));
    expectOnTailorWithJob('job-step-tailor');
    expectFrameUntouched();
  });

  it('boundary: clicking the step you are already on changes nothing', async () => {
    const { user } = await renderApp();
    await tailorWithJob(user);
    await user.click(screen.getByTestId('job-step-tailor'));
    expectOnTailorWithJob('job-step-tailor');
    expectFrameUntouched();
  });
});

describe('every other way of moving (L-216 regression sweep)', () => {
  it('Analysis’s step links to Tailor’s steps land on the step without moving the frame', async () => {
    const { user } = await renderApp();
    await tailorWithJob(user);
    for (const step of ['job-step-export', 'job-step-ats', 'job-step-tailor'] as const) {
      await user.click(screen.getByTestId('job-step-analyse'));
      await screen.findByTestId('view-analysis');
      expectFrameUntouched();
      await user.click(screen.getByTestId(step));
      await screen.findByTestId('view-tailor');
      await vi.waitFor(() => expect(current()).toBe(step));
      expectOnTailorWithJob(step);
      expectFrameUntouched();
    }
  });

  it('each rail item and each Ctrl+number shortcut opens its screen and moves nothing else', async () => {
    const { user } = await renderApp();
    await tailorWithJob(user);
    const views = ['profile', 'search', 'tracker', 'analysis', 'tailor'] as const;
    for (const [index, id] of views.entries()) {
      await user.keyboard(`{Control>}${index + 1}{/Control}`);
      await screen.findByTestId(`view-${id}`);
      expect(screen.getByTestId(`nav-${id}`).getAttribute('aria-current')).toBe('page');
      expectFrameUntouched();
    }
    for (const id of [...views, 'settings'] as const) {
      await user.click(screen.getByTestId(`nav-${id}`));
      await screen.findByTestId(`view-${id}`);
      expectFrameUntouched();
    }
  });

  it('a tracker card’s Continue opens Tailor on the job without moving the frame', async () => {
    const { user } = await renderApp({ 'job-tracked': { analysed: true } });
    await user.click(screen.getByTestId('nav-tracker'));
    await user.click(await screen.findByTestId('tracker-card-continue-app-tracked'));
    await screen.findByTestId('view-tailor');
    await vi.waitFor(() =>
      expect(screen.getByTestId<HTMLSelectElement>('tailor-job-pick').value).toBe('job-tracked'),
    );
    expectOnTailorWithJob('job-step-tailor');
    expectFrameUntouched();
  });

  it('at phone width (375px): step links and Next move nothing outside Tailor’s own area', async () => {
    installMatchMedia(375);
    const { user } = await renderApp();
    await user.click(screen.getByTestId('nav-tracker'));
    await user.click(await screen.findByTestId('tracker-card-app-tracked'));
    await user.click(await screen.findByTestId('detail-analyse'));
    await user.click(await screen.findByTestId('job-steps-next'));
    await screen.findByTestId('view-tailor');
    await vi.waitFor(() =>
      expect(screen.getByTestId<HTMLSelectElement>('tailor-job-pick').value).toBe('job-tracked'),
    );
    for (const step of ['job-step-export', 'job-step-tailor'] as const) {
      await user.click(screen.getByTestId(step));
      await vi.waitFor(() => expect(current()).toBe(step));
      expectOnTailorWithJob(step);
      expectFrameUntouched(true);
    }
  });
});

describe('the check can fail', () => {
  it('a scroll of the shell is caught', async () => {
    await renderApp();
    screen.getByTestId('shell').scrollTo({ top: 10 });
    expect(() => expectFrameUntouched()).toThrow();
  });

  it('a scrollIntoView anywhere is caught', async () => {
    await renderApp();
    screen.getByTestId('shell').scrollIntoView();
    expect(() => expectFrameUntouched()).toThrow();
  });
});
