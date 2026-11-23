// @vitest-environment jsdom
/**
 * One white panel inside the navy frame (L-454).
 *
 * From `md:` up the shell is navy, and every screen sits in ONE white panel —
 * the shell's `<main>` — with 12px corners and 8px of navy above, right and
 * below it. No gap on the rail's side: the rail is navy already, and a gap
 * there would leave the Tracker board 0px spare at the 1000px window. No
 * shadow: white on navy makes the edge, and shadows are for things that float.
 * On a phone there is no panel: the view is white, edge to edge.
 *
 * jsdom does no layout, so this pins the classes; `e2e/contrast-webkit.spec.ts`
 * measures the panel in a real browser.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));

const { default: App } = await import('./App');
const { WIDE_QUERY } = await import('./viewport');
const { markWelcomeSeen } = await import('../features/onboarding/store');
const { createFakeTrackerPort } = await import('../features/tracker/test/fakePort');
const { createFakeBackupPort } = await import('../features/settings/test/fakePort');
const { createFakeUpdatePort, AN_UPDATE } =
  await import('../features/settings/updates/test/fakeUpdatePort');

const PANEL = ['bg-card', 'md:rounded-card', 'md:my-2', 'md:mr-2', 'md:overflow-clip'];

function installMatchMedia(widthPx: number) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: () => ({
      matches: widthPx >= 768,
      media: WIDE_QUERY,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
}

beforeEach(() => {
  localStorage.clear();
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

async function renderApp(updatePort = createFakeUpdatePort()) {
  render(
    <App
      trackerPort={createFakeTrackerPort()}
      backupPort={createFakeBackupPort()}
      updatePort={updatePort}
    />,
  );
  await screen.findByTestId('view-tracker');
  return {
    shell: screen.getByTestId('shell').className.split(' '),
    main: screen.getByRole('main').className.split(' '),
  };
}

describe('one white panel inside the navy frame (L-454)', () => {
  it('happy: at desktop width <main> is the white panel and the frame is navy', async () => {
    installMatchMedia(1280);
    const { shell, main } = await renderApp();
    for (const name of PANEL) expect(main, name).toContain(name);
    expect(shell).toContain('md:bg-navy');
    // The phone's surface stays under it.
    expect(shell).toContain('bg-canvas');
  });

  it('negative: the panel has no elevation and no gap on the rail’s side', async () => {
    installMatchMedia(1280);
    const { main } = await renderApp();
    expect(main.filter((name) => /\bshadow/.test(name))).toEqual([]);
    // A left gap (or one on every side) leaves the Tracker board 0px at 1000px.
    expect(main.filter((name) => /(^|:)-?(ml|mx|m|pl|px)-/.test(name))).toEqual([]);
  });

  it('boundary: on a phone only the white fill is unconditional — no corners, no gap, no navy', async () => {
    installMatchMedia(375);
    const { shell, main } = await renderApp();
    expect(main).toContain('bg-card');
    const unprefixed = main.filter((name) => !name.startsWith('md:'));
    expect(unprefixed.filter((name) => /\brounded|^-?m[trblxy]?-|^overflow-/.test(name))).toEqual(
      [],
    );
    expect(shell).not.toContain('bg-navy');
    expect(shell).toContain('bg-canvas');
    expect(shell).toContain('pt-safe');
  });

  it('interaction: every screen shares the one panel, and an update offer sits inside it', async () => {
    installMatchMedia(1280);
    const user = userEvent.setup();
    const updatePort = createFakeUpdatePort();
    updatePort.nextCheck({ ok: true, value: AN_UPDATE });
    await renderApp(updatePort);
    const panel = screen.getByRole('main');

    for (const view of ['search', 'settings', 'tracker']) {
      await user.click(screen.getByTestId(`nav-${view}`));
      await screen.findByTestId(`view-${view}`);
      expect(screen.getByRole('main'), view).toBe(panel);
      expect(panel.contains(screen.getByTestId(`view-${view}`)), view).toBe(true);
    }
    expect(panel.contains(await screen.findByTestId('update-banner'))).toBe(true);
  });
});
