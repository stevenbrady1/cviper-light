// @vitest-environment jsdom
/**
 * L-375 — a smoke picture is taken only once the screen has stopped changing
 * (`e2e/smokeSettle.ts`).
 *
 * The same code gave two different pictures on CI: the screen was still moving,
 * or was left in a state that depended on timing, when the picture was taken.
 * `waitForStill` is what now stands between a step and its picture, so it is
 * held here to its four promises: it waits while anything animates, it waits
 * for fonts, it returns only a frame it has seen twice in a row, and a screen
 * that never settles FAILS with a sentence naming what kept changing — no
 * picture is returned to save.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  HOVERED_INTERACTIVE,
  POINTER_PARK,
  SETTLE_PROBE,
  moveOsPointerArgs,
  parkOsPointer,
  pointerParking,
  waitForStill,
  type StillProbe,
} from '../../e2e/smokeSettle.ts';

/** A fake clock: sleeping advances time, so no test waits for real. */
function fakeClock(): { now: () => number; sleep: (ms: number) => Promise<void> } {
  let t = 0;
  return {
    now: () => t,
    sleep: (ms) => {
      t += ms;
      return Promise.resolve();
    },
  };
}

const QUIET: StillProbe = { running: [], fonts: 'loaded', layout: [] };

/** Hand out the given values in order, then keep repeating the last one. */
function sequence<T>(values: readonly T[]): () => Promise<T> {
  let i = 0;
  return () => {
    const value = values[Math.min(i, values.length - 1)] as T;
    i += 1;
    return Promise.resolve(value);
  };
}

describe('waitForStill', () => {
  it('waits while an animation runs, then returns the frame it saw twice in a row', async () => {
    const fade: StillProbe = { ...QUIET, running: ['transition opacity on div[hint]'] };
    const frames: string[] = [];
    const result = await waitForStill({
      probe: sequence([fade, fade, fade, QUIET]),
      frame: () => {
        frames.push('settled');
        return Promise.resolve('settled');
      },
      timeoutMs: 10_000,
      intervalMs: 100,
      ...fakeClock(),
    });
    expect(result.png).toBe('settled');
    // No frame is even taken while the fade is running.
    expect(frames).toHaveLength(2);
    expect(result.waitedMs).toBeGreaterThanOrEqual(300);
  });

  it('keeps looking until two frames in a row are identical', async () => {
    let taken = 0;
    const result = await waitForStill({
      probe: sequence([QUIET]),
      frame: sequence(['a', 'b', 'c', 'c']),
      timeoutMs: 10_000,
      intervalMs: 100,
      ...fakeClock(),
      onFrame: () => {
        taken += 1;
      },
    });
    expect(result.png).toBe('c');
    expect(result.frames).toBe(4);
    expect(taken).toBe(4);
  });

  it('does not accept two equal frames if the layout moved between them', async () => {
    const moved: StillProbe = { ...QUIET, layout: ['tracker-card-1 10,20,100,40'] };
    const back: StillProbe = { ...QUIET, layout: ['tracker-card-1 10,24,100,40'] };
    const result = await waitForStill({
      probe: sequence([moved, back, back]),
      frame: sequence(['x']),
      timeoutMs: 10_000,
      intervalMs: 100,
      ...fakeClock(),
    });
    expect(result.frames).toBe(3);
  });

  it('waits for fonts that are still loading', async () => {
    const loading: StillProbe = { ...QUIET, fonts: 'loading' };
    const result = await waitForStill({
      probe: sequence([loading, loading, QUIET]),
      frame: sequence(['f']),
      timeoutMs: 10_000,
      intervalMs: 100,
      ...fakeClock(),
    });
    expect(result.png).toBe('f');
    expect(result.waitedMs).toBeGreaterThanOrEqual(200);
  });

  // ── Negative: a screen that never settles fails, naming what moved ────────

  it('fails, naming the animation, when one never stops', async () => {
    const spinner: StillProbe = { ...QUIET, running: ['animation cviper-spin on svg[spinner]'] };
    await expect(
      waitForStill({
        probe: sequence([spinner]),
        frame: sequence(['never-used']),
        timeoutMs: 2_000,
        intervalMs: 100,
        ...fakeClock(),
      }),
    ).rejects.toThrow(/never stood still within 2000ms.*animation cviper-spin on svg\[spinner\]/s);
  });

  it('fails, naming what moved, when the layout never stops changing', async () => {
    let y = 0;
    await expect(
      waitForStill({
        probe: () => {
          y += 1;
          return Promise.resolve({ ...QUIET, layout: [`tailor-ats 0,${String(y)},500,300`] });
        },
        frame: sequence(['same']),
        timeoutMs: 2_000,
        intervalMs: 100,
        ...fakeClock(),
      }),
    ).rejects.toThrow(/never stood still.*tailor-ats/s);
  });

  it('fails, saying the picture itself kept changing, when nothing else explains it', async () => {
    let n = 0;
    await expect(
      waitForStill({
        probe: sequence([QUIET]),
        frame: () => {
          n += 1;
          return Promise.resolve(`frame-${String(n)}`);
        },
        timeoutMs: 2_000,
        intervalMs: 100,
        ...fakeClock(),
      }),
    ).rejects.toThrow(
      /never stood still.*picture kept changing.*no animation, font load or layout move/s,
    );
  });

  it('fails, naming the fonts, when they never finish loading', async () => {
    await expect(
      waitForStill({
        probe: sequence([{ ...QUIET, fonts: 'loading' }]),
        frame: sequence(['f']),
        timeoutMs: 1_000,
        intervalMs: 100,
        ...fakeClock(),
      }),
    ).rejects.toThrow(/fonts are still loading/);
  });

  // ── Boundary ──────────────────────────────────────────────────────────────

  it('a screen already still costs exactly two frames and no sleeping beyond one interval', async () => {
    const result = await waitForStill({
      probe: sequence([QUIET]),
      frame: sequence(['p']),
      timeoutMs: 10_000,
      intervalMs: 100,
      ...fakeClock(),
    });
    expect(result.frames).toBe(2);
    expect(result.waitedMs).toBe(100);
  });

  it('a frame equal to the one before it but taken during an animation does not count', async () => {
    const fade: StillProbe = { ...QUIET, running: ['transition opacity on span[hint]'] };
    const result = await waitForStill({
      probe: sequence([QUIET, fade, QUIET, QUIET]),
      frame: sequence(['p']),
      timeoutMs: 10_000,
      intervalMs: 100,
      ...fakeClock(),
    });
    // quiet frame, then a fade breaks the pair, then two quiet frames.
    expect(result.frames).toBe(3);
  });

  it('refuses a timeout that leaves no room for two frames', async () => {
    await expect(
      waitForStill({
        probe: sequence([QUIET]),
        frame: sequence(['p']),
        timeoutMs: 50,
        intervalMs: 100,
        ...fakeClock(),
      }),
    ).rejects.toThrow(/timeout.*interval/);
  });
});

// ── The in-page probe, run as WebDriver runs it ─────────────────────────────

function runProbe(): StillProbe {
  const probe = new Function(SETTLE_PROBE) as () => unknown;
  return probe() as StillProbe;
}

interface FakeAnimation {
  playState: string;
  pending?: boolean;
  animationName?: string;
  transitionProperty?: string;
  effect: { target: Element | null };
}

function stubAnimations(animations: FakeAnimation[]): void {
  Object.defineProperty(document, 'getAnimations', {
    configurable: true,
    value: () => animations,
  });
}

function stubFonts(status: string): void {
  Object.defineProperty(document, 'fonts', { configurable: true, value: { status } });
}

describe('SETTLE_PROBE', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('names a running transition and a running animation by what they move', () => {
    document.body.innerHTML = '<div data-testid="hint"></div><svg data-testid="spinner"></svg>';
    stubFonts('loaded');
    stubAnimations([
      {
        playState: 'running',
        transitionProperty: 'opacity',
        effect: { target: document.querySelector('[data-testid="hint"]') },
      },
      {
        playState: 'running',
        animationName: 'cviper-card-settle',
        effect: { target: document.querySelector('[data-testid="spinner"]') },
      },
    ]);
    const probe = runProbe();
    expect(probe.running).toEqual([
      'transition opacity on div[hint]',
      'animation cviper-card-settle on svg[spinner]',
    ]);
  });

  it('ignores animations that have finished or are paused', () => {
    stubFonts('loaded');
    stubAnimations([
      { playState: 'finished', animationName: 'cviper-tick-in', effect: { target: null } },
      { playState: 'paused', animationName: 'x', effect: { target: null } },
    ]);
    expect(runProbe().running).toEqual([]);
  });

  it('counts an animation that is about to start (pending) as running', () => {
    stubFonts('loaded');
    stubAnimations([
      { playState: 'paused', pending: true, animationName: 'y', effect: { target: null } },
    ]);
    expect(runProbe().running).toEqual(['animation y on (no element)']);
  });

  it('reports the fonts status as the page has it', () => {
    stubAnimations([]);
    stubFonts('loading');
    expect(runProbe().fonts).toBe('loading');
    stubFonts('loaded');
    expect(runProbe().fonts).toBe('loaded');
  });

  it('describes every test id’s box, so a move between two frames can be named', () => {
    stubAnimations([]);
    stubFonts('loaded');
    document.body.innerHTML = '<div data-testid="a"></div><div data-testid="b"></div>';
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 2,
      left: 1,
      width: 30.5,
      height: 40,
      bottom: 42,
      right: 31.5,
      x: 1,
      y: 2,
      toJSON: () => ({}),
    } as DOMRect);
    expect(runProbe().layout).toEqual(['a 1,2,30.5,40', 'b 1,2,30.5,40']);
  });

  it('works on a page with no animations API and no fonts API (zero of each)', () => {
    Object.defineProperty(document, 'getAnimations', { configurable: true, value: undefined });
    Object.defineProperty(document, 'fonts', { configurable: true, value: undefined });
    const probe = runProbe();
    expect(probe.running).toEqual([]);
    expect(probe.fonts).toBe('loaded');
  });
});

describe('HOVERED_INTERACTIVE', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  /** jsdom never hovers anything, so `:hover` is answered with these. */
  function hovering(...selectors: string[]): void {
    const real = document.querySelectorAll.bind(document);
    vi.spyOn(document, 'querySelectorAll').mockImplementation(((query: string) =>
      query === ':hover'
        ? selectors.map((s) => document.querySelector(s))
        : real(query)) as typeof document.querySelectorAll);
  }

  function runHovered(): string {
    return (new Function(HOVERED_INTERACTIVE) as () => string)();
  }

  const PAGE =
    '<nav data-testid="sidebar"><ul id="rail"><li><button data-testid="nav-search">Search</button></li></ul></nav>' +
    '<main><button data-testid="tracker-card-bi"><p id="company">Fernhill</p></button>' +
    '<span id="mark" aria-describedby="hint-1" class="cursor-help">?</span></main>';

  it('is empty when the cursor rests on the rail’s empty space', () => {
    document.body.innerHTML = PAGE;
    hovering('html', 'body', 'nav', '#rail');
    expect(runHovered()).toBe('');
  });

  it('is empty when nothing is hovered at all (the web view has not seen the cursor)', () => {
    document.body.innerHTML = PAGE;
    hovering();
    expect(runHovered()).toBe('');
  });

  it('names a tracker card hovered through its text', () => {
    document.body.innerHTML = PAGE;
    hovering('html', 'body', 'main', '[data-testid="tracker-card-bi"]', '#company');
    expect(runHovered()).toBe('button[tracker-card-bi]');
  });

  it('names a hint mark', () => {
    document.body.innerHTML = PAGE;
    hovering('html', 'body', 'main', '#mark');
    expect(runHovered()).toMatch(/^span/);
  });

  it('names a rail button', () => {
    document.body.innerHTML = PAGE;
    hovering('html', 'body', 'nav', '#rail', 'li', '[data-testid="nav-search"]');
    expect(runHovered()).toBe('button[nav-search]');
  });
});

describe('moveOsPointerArgs', () => {
  it('builds a PowerShell command that moves the Windows cursor to the point', () => {
    const args = moveOsPointerArgs(POINTER_PARK.x, POINTER_PARK.y);
    expect(args.slice(0, 2)).toEqual(['-NoProfile', '-Command']);
    expect(args[2]).toContain(`Point(${String(POINTER_PARK.x)}, ${String(POINTER_PARK.y)})`);
  });

  it('nudges one pixel right first, so the web view sees a real move, and ends on the point', () => {
    const command = moveOsPointerArgs(30, 40)[2] ?? '';
    const nudge = command.indexOf('Point(31, 40)');
    const park = command.indexOf('Point(30, 40)');
    expect(nudge).toBeGreaterThan(-1);
    expect(park).toBeGreaterThan(nudge);
  });

  it('refuses a point that is not a whole, non-negative pixel', () => {
    expect(() => moveOsPointerArgs(-1, 10)).toThrow(/pointer/);
    expect(() => moveOsPointerArgs(10.5, 10)).toThrow(/pointer/);
    expect(() => moveOsPointerArgs(Number.NaN, 10)).toThrow(/pointer/);
  });

  it('accepts the screen origin (0, 0)', () => {
    expect(moveOsPointerArgs(0, 0)[2]).toContain('Point(0, 0)');
  });
});

// ── Whose cursor may be moved (L-375) ───────────────────────────────────────
//
// On a CI runner nobody is using the mouse. On a person's own PC, a test that
// grabs the cursor while they work is exactly what must never happen silently,
// so it moves only on CI or when the person asks for it.

describe('pointerParking', () => {
  it('moves the cursor on CI (GitHub Actions) on Windows', () => {
    expect(pointerParking({ GITHUB_ACTIONS: 'true' }, 'win32')).toEqual({ move: true, why: 'ci' });
  });

  it('moves the cursor on a person’s PC only when they opt in', () => {
    expect(pointerParking({ SMOKE_PARK_POINTER: '1' }, 'win32')).toEqual({
      move: true,
      why: 'opted in',
    });
    expect(pointerParking({ SMOKE_PARK_POINTER: 'true' }, 'win32').move).toBe(true);
  });

  it('does not move the cursor when neither is set', () => {
    expect(pointerParking({}, 'win32').move).toBe(false);
  });

  it('treats an opt-in of "0", "" or "false", and GITHUB_ACTIONS other than "true", as no', () => {
    for (const value of ['0', '', 'false', 'no']) {
      expect(pointerParking({ SMOKE_PARK_POINTER: value }, 'win32').move).toBe(false);
    }
    expect(pointerParking({ GITHUB_ACTIONS: 'false' }, 'win32').move).toBe(false);
    expect(pointerParking({ GITHUB_ACTIONS: '' }, 'win32').move).toBe(false);
  });

  it('never moves it off Windows, even on CI or opted in (PowerShell moves a Windows cursor)', () => {
    expect(pointerParking({ GITHUB_ACTIONS: 'true' }, 'linux').move).toBe(false);
    expect(pointerParking({ SMOKE_PARK_POINTER: '1' }, 'darwin').move).toBe(false);
  });
});

describe('parkOsPointer', () => {
  const at = { x: 120, y: 500 };

  it('on CI, runs the move once and reports where the cursor ended up', () => {
    const run = vi.fn((_args: readonly string[]) => '120,500\r\n');
    const result = parkOsPointer({
      env: { GITHUB_ACTIONS: 'true' },
      platform: 'win32',
      ...at,
      run,
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(moveOsPointerArgs(120, 500));
    expect(result).toEqual({ moved: true, at: '120,500' });
  });

  it('opted in, runs the move', () => {
    const run = vi.fn((_args: readonly string[]) => '120,500');
    const result = parkOsPointer({
      env: { SMOKE_PARK_POINTER: '1' },
      platform: 'win32',
      ...at,
      run,
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(result.moved).toBe(true);
  });

  it('on a person’s PC with no opt-in, never calls PowerShell and says why the pictures differ', () => {
    const run = vi.fn((_args: readonly string[]) => '');
    const result = parkOsPointer({ env: {}, platform: 'win32', ...at, run });
    expect(run).not.toHaveBeenCalled();
    expect(result.moved).toBe(false);
    if (result.moved) return;
    expect(result.notice).toMatch(/not comparable with CI/);
    expect(result.notice).toMatch(/SMOKE_PARK_POINTER=1/);
  });

  it('with the opt-in set to "0" or "", never calls PowerShell', () => {
    for (const value of ['0', '']) {
      const run = vi.fn((_args: readonly string[]) => '');
      expect(
        parkOsPointer({ env: { SMOKE_PARK_POINTER: value }, platform: 'win32', ...at, run }).moved,
      ).toBe(false);
      expect(run).not.toHaveBeenCalled();
    }
  });

  it('off Windows, never calls PowerShell and does not throw, even on CI', () => {
    const run = vi.fn((_args: readonly string[]) => {
      throw new Error('powershell: command not found');
    });
    const result = parkOsPointer({
      env: { GITHUB_ACTIONS: 'true' },
      platform: 'linux',
      ...at,
      run,
    });
    expect(run).not.toHaveBeenCalled();
    expect(result.moved).toBe(false);
  });
});

describe('the cursor move only sets the cursor position', () => {
  // Forbid-list: nothing in the command may click, type, or bring a window to the front.
  const FORBIDDEN = [
    /mouse_event/i,
    /SendInput/i,
    /SendKeys/i,
    /SendWait/i,
    /keybd_event/i,
    /SetForegroundWindow/i,
    /AppActivate/i,
    /BringToFront/i,
    /Activate\(/i,
    /Click/i,
    /DllImport/i,
    /user32/i,
    /wscript/i,
  ];

  it('touches nothing but [System.Windows.Forms.Cursor]::Position', () => {
    const command = moveOsPointerArgs(120, 500)[2] ?? '';
    for (const pattern of FORBIDDEN) expect(command).not.toMatch(pattern);
    const assignments = command.match(/\[[^\]]+\]::\w+\s*=/g) ?? [];
    expect(assignments.length).toBeGreaterThan(0);
    for (const assignment of assignments) {
      expect(assignment).toMatch(/^\[System\.Windows\.Forms\.Cursor\]::Position\s*=$/);
    }
  });
});
