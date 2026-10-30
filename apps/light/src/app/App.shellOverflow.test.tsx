// @vitest-environment jsdom
/**
 * L-334: nothing hidden hangs out of the window, so nothing can scroll the app.
 *
 * The L-216 bug class again, from the other end. In the built app, going from
 * Search to Settings left the whole shell shifted up ~55px: the rail's logo
 * and the page header cut off at the top, a blank strip at the bottom.
 *
 * The page cannot be scrolled by hand (`body { overflow: hidden }`), but it can
 * still be scrolled by code — anything that brings an element into view, a
 * driver's click, a screen reader's cursor. And it had somewhere to go. A
 * visually hidden box (`sr-only`, e.g. every `LiveStatus`) is absolutely
 * positioned; with no positioned box above it, it is placed against the WINDOW,
 * at the spot where it would have sat in its screen's content. On a screen
 * whose content runs past the bottom of the window, that is below the window —
 * and the page grows by that much, out of sight. L-329 put a ~50px row above
 * Search's results status, and the overhang went from ~5px to ~55px: exactly
 * the shift in the screenshots.
 *
 * A screen's own scroll area clipping its content is not enough: an absolute
 * box escapes any box that is not positioned. So the rule, checked on every
 * screen, both layouts and the first-run introduction:
 *
 *   NO absolutely positioned box is placed against anything outside the app's
 *   frame, or against anything that is not clipped by the frame or inside it.
 *
 * jsdom has no layout, so this reads the classes the browser would — the same
 * classes the browser lays out. A fixed box is exempt: it is placed against the
 * window's visible area and never makes the page longer.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

const NO_KEYS: Record<JobProviderId, 'missing'> = { adzuna: 'missing', reed: 'missing' };
const VIEWS = ['profile', 'search', 'tracker', 'analysis', 'tailor', 'settings'] as const;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
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

function renderApp() {
  const user = userEvent.setup();
  let counter = 0;
  const { container } = render(
    <App
      trackerPort={createFakeTrackerPort()}
      profilePort={createFakeProfilePort()}
      analysisPort={createFakeAnalysisPort({ cvs: [], jobs: [] })}
      tailorPort={createFakeTailorPort({ cvs: [], jobs: [], applications: [] })}
      searchPort={createFakeSearchPort([])}
      boardsPort={createFakeBoardPort()}
      browser={createFakeBrowserPort()}
      readKeyStates={async () => NO_KEYS}
      filePort={createFakeFilePort()}
      openedCv={createFakeOpenedCvPort()}
      backupPort={createFakeBackupPort()}
      erasePort={createFakeErasePort()}
      workflowPort={null}
      newId={() => `generated-${(counter += 1)}`}
      now={new Date('2026-10-06T09:00:00.000Z')}
    />,
  );
  return { user, container };
}

// ── The rule ────────────────────────────────────────────────────────────────

const POSITIONED = new Set(['relative', 'absolute', 'fixed', 'sticky']);
const CLIPS = /^overflow(?:-[xy])?-(?:clip|hidden|auto|scroll)$/;

const tokens = (element: Element): string[] =>
  (element.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);

const isAbsolute = (element: Element): boolean =>
  tokens(element).some((token) => token === 'absolute' || token === 'sr-only');

const describeBox = (element: Element): string =>
  `<${element.tagName.toLowerCase()} class="${element.getAttribute('class') ?? ''}"` +
  `${element.getAttribute('data-testid') === null ? '' : ` data-testid="${element.getAttribute('data-testid')}"`}>`;

/**
 * Every absolutely positioned box under `frame` that can hang out of it: its
 * containing block (the nearest positioned ancestor) is outside the frame, or
 * nothing from that block up to the frame clips it. Fixed subtrees are exempt.
 */
function boxesThatEscape(frame: Element): string[] {
  const escaped: string[] = [];
  for (const element of frame.querySelectorAll('*')) {
    if (!isAbsolute(element)) continue;
    let block: Element | null = element.parentElement;
    let inFixed = false;
    while (block !== null && block !== frame.parentElement) {
      const own = tokens(block);
      if (own.includes('fixed')) inFixed = true;
      if (own.some((token) => POSITIONED.has(token))) break;
      block = block.parentElement;
    }
    if (inFixed) continue;
    if (block === null || block === frame.parentElement) {
      escaped.push(`${describeBox(element)} is placed against the window`);
      continue;
    }
    let clipper: Element | null = block;
    let clipped = false;
    while (clipper !== null && clipper !== frame.parentElement) {
      if (tokens(clipper).some((token) => CLIPS.test(token))) {
        clipped = true;
        break;
      }
      clipper = clipper.parentElement;
    }
    if (!clipped) escaped.push(`${describeBox(element)} is clipped by nothing`);
  }
  return escaped;
}

const frameOf = (container: HTMLElement): Element => {
  const frame = container.firstElementChild;
  if (frame === null) throw new Error('the app rendered nothing');
  return frame;
};

// ── The rule finds what it is for ───────────────────────────────────────────

describe('the rule itself (L-334)', () => {
  it('negative: a hidden status with no positioned box above it is reported', () => {
    const frame = document.createElement('div');
    frame.className = 'flex h-full';
    frame.innerHTML =
      '<div class="min-h-0 flex-1 overflow-y-auto"><p class="sr-only" data-testid="x"></p></div>';
    expect(boxesThatEscape(frame)).toEqual([
      '<p class="sr-only" data-testid="x"> is placed against the window',
    ]);
  });

  it('negative: a positioned box that nothing clips is reported', () => {
    const frame = document.createElement('div');
    frame.className = 'relative flex h-full';
    frame.innerHTML = '<span class="absolute -bottom-20"></span>';
    expect(boxesThatEscape(frame)).toEqual([
      '<span class="absolute -bottom-20"> is clipped by nothing',
    ]);
  });

  it('boundary: a frame that is positioned AND clips holds everything; fixed is exempt', () => {
    const frame = document.createElement('div');
    frame.className = 'relative flex h-full overflow-clip';
    frame.innerHTML =
      '<div class="overflow-y-auto"><p class="sr-only"></p><span class="absolute"></span></div>' +
      '<div class="fixed inset-0"><span class="sr-only"></span></div>';
    expect(boxesThatEscape(frame)).toEqual([]);
  });
});

// ── The app ─────────────────────────────────────────────────────────────────

describe('nothing hidden hangs out of the window (L-334)', () => {
  it('happy: on every screen, at desktop width, no hidden box escapes the shell', async () => {
    installMatchMedia(1280);
    markWelcomeSeen();
    const { user, container } = renderApp();
    await screen.findByTestId('shell');

    for (const view of VIEWS) {
      await user.click(screen.getByTestId(`nav-${view}`));
      await screen.findByTestId('shell');
      expect(boxesThatEscape(frameOf(container)), view).toEqual([]);
    }
  });

  it('regression: Search, then Settings — the exact path the Smoke screenshots caught', async () => {
    installMatchMedia(1280);
    markWelcomeSeen();
    const { user, container } = renderApp();
    await screen.findByTestId('shell');

    await user.click(screen.getByTestId('nav-search'));
    await screen.findByTestId('search-open-boards');
    expect(boxesThatEscape(frameOf(container)), 'search').toEqual([]);

    await user.click(screen.getByTestId('nav-settings'));
    await screen.findByTestId('settings-export');
    expect(boxesThatEscape(frameOf(container)), 'settings').toEqual([]);
  });

  it('boundary: Search with the "Also open" reason shown, and with a board ticked so it is not', async () => {
    installMatchMedia(1280);
    markWelcomeSeen();
    const { user, container } = renderApp();
    await screen.findByTestId('shell');
    await user.click(screen.getByTestId('nav-search'));

    expect(await screen.findByTestId('search-open-boards-reason')).toBeTruthy();
    expect(boxesThatEscape(frameOf(container)), 'reason shown').toEqual([]);

    await user.click(await screen.findByTestId('keyless-linkedin'));
    await vi.waitFor(() => expect(screen.queryByTestId('search-open-boards-reason')).toBeNull());
    expect(boxesThatEscape(frameOf(container)), 'reason gone').toEqual([]);
  });

  it('edge: on every screen at phone width (375px), with the bottom bar', async () => {
    installMatchMedia(375);
    markWelcomeSeen();
    const { user, container } = renderApp();
    await screen.findByTestId('bottom-nav');

    for (const view of VIEWS) {
      const item = screen.queryByTestId(`nav-${view}`);
      if (item === null) continue;
      await user.click(item);
      expect(boxesThatEscape(frameOf(container)), `375px ${view}`).toEqual([]);
    }
  });

  it('edge: the first-run introduction, which has its own frame', async () => {
    installMatchMedia(1280);
    const { container } = renderApp();
    await screen.findByTestId('welcome');
    expect(boxesThatEscape(frameOf(container))).toEqual([]);
  });
});
