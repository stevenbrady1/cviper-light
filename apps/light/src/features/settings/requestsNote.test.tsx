// @vitest-environment jsdom
/**
 * The list of requests the app makes, under Settings → Privacy (L-181), has to
 * match the build it is shown in.
 *
 * The Microsoft Store build told its users the app makes "an update check —
 * when you press the button, and once at startup". That build has no updater
 * compiled in and no button to press; the Updates section two headings above
 * says so. A privacy statement that claims a request the app cannot make is
 * wrong in the one place a careful reader checks, and it is in front of a Store
 * reviewer. Phones have no updater either, so they get the same sentence.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));

const { Settings } = await import('./Settings');
const { createFakeUpdatePort } = await import('./updates/test/fakeUpdatePort');
const { createFakeBackupPort } = await import('./test/fakePort');
const { MICROSOFT_STORE } = await import('../../platform/distribution');

beforeEach(() => {
  localStorage.clear();
  tauri.invoke.mockReset();
  tauri.invoke.mockImplementation(async (command) => {
    if (command === 'secret_status') return false;
    throw new Error(`unexpected command: ${command}`);
  });
});

afterEach(() => {
  cleanup();
});

function requestsNote(props: {
  distribution?: 'microsoft-store' | 'direct';
  mobileOs?: 'ios' | 'android' | null;
}): string {
  render(
    <Settings
      port={createFakeBackupPort()}
      updatePort={createFakeUpdatePort()}
      mobileOs={props.mobileOs ?? null}
      {...(props.distribution === undefined ? {} : { distribution: props.distribution })}
    />,
  );
  return screen.getByTestId('settings-requests-note').textContent ?? '';
}

describe('the requests the app makes, as Settings → Privacy lists them', () => {
  it('a direct download lists the update check it really makes', () => {
    const note = requestsNote({ distribution: 'direct' });
    expect(note).toMatch(/an update check/);
    expect(note).toMatch(/once at startup unless you switch that off under Updates/);
  });

  it('negative: a Microsoft Store build never claims an update check', () => {
    const note = requestsNote({ distribution: MICROSOFT_STORE });
    expect(note).not.toMatch(/update check/);
    expect(note).not.toMatch(/at startup/);
    expect(note).toMatch(/never checks for updates itself/);
  });

  it('negative: a phone never claims an update check either', () => {
    const note = requestsNote({ mobileOs: 'ios' });
    expect(note).not.toMatch(/update check/);
    expect(note).toMatch(/never checks for updates itself/);
  });

  it('every build still lists the three requests it does make', () => {
    for (const note of [
      requestsNote({ distribution: 'direct' }),
      (cleanup(), requestsNote({ distribution: MICROSOFT_STORE })),
      (cleanup(), requestsNote({ mobileOs: 'android' })),
    ]) {
      expect(note).toMatch(/a job search/);
      expect(note).toMatch(/a CV check against a provider you chose/);
      expect(note).toMatch(/a job advert you ask it to fetch/);
    }
  });
});
