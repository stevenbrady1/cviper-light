// @vitest-environment jsdom
/**
 * The Report-a-problem control, driven the way a user drives it.
 *
 * The load-bearing assertion is the negative one: rendering this section opens
 * nothing and asks Tauri for nothing. A "report" control that did something on
 * mount would be indistinguishable from telemetry.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { createFakeBrowserPort } from '../../../platform/test/fakeBrowserPort';
import { APP_VERSION } from '../backup';

import { REPORT_ISSUE_URL } from './model';
import { createTauriReportPort, type ReportPort } from './port';
import { ReportProblem } from './ReportProblem';

afterEach(cleanup);

/** A port that answers instantly and records that it was asked. */
function fakeReportPort(
  facts: { version?: string; system?: string } = {},
): ReportPort & { calls: { version: number; system: number } } {
  const calls = { version: 0, system: 0 };
  return {
    calls,
    async version() {
      calls.version += 1;
      return facts.version ?? '0.1.0';
    },
    system() {
      calls.system += 1;
      return facts.system ?? 'Windows NT 10.0; Win64; x64 · WebView2 141.0.3537.85';
    },
  };
}

describe('the Report a problem section', () => {
  it('says what goes in the report before the button is pressed', () => {
    render(<ReportProblem browser={createFakeBrowserPort()} port={fakeReportPort()} />);

    const copy = screen.getByTestId('settings-report').textContent ?? '';
    expect(copy).toContain('no log file');
    expect(copy).toContain('your own browser');
    expect(copy).toContain('nothing has been sent');
  });

  it('negative: rendering opens nothing and asks for nothing', () => {
    // A control that did anything on mount would be telemetry wearing a
    // different label.
    const browser = createFakeBrowserPort();
    const port = fakeReportPort();
    render(<ReportProblem browser={browser} port={port} />);

    expect(browser.opened()).toEqual([]);
    expect(port.calls).toEqual({ version: 0, system: 0 });
  });

  it('negative: there is no primary button here', () => {
    render(<ReportProblem browser={createFakeBrowserPort()} port={fakeReportPort()} />);
    expect(screen.getByTestId('settings-report').querySelector('[data-primary="true"]')).toBeNull();
  });

  it('happy: pressing it opens exactly one pre-filled issue URL', async () => {
    const browser = createFakeBrowserPort();
    render(<ReportProblem browser={browser} port={fakeReportPort()} />);

    fireEvent.click(screen.getByTestId('settings-report-open'));

    await waitFor(() => expect(browser.opened()).toHaveLength(1));
    const [url] = browser.opened();
    expect(url?.startsWith(`${REPORT_ISSUE_URL}?`)).toBe(true);
  });

  it('happy: the URL carries the version and the system', async () => {
    const browser = createFakeBrowserPort();
    render(
      <ReportProblem
        browser={browser}
        port={fakeReportPort({ version: '9.9.9', system: 'Windows NT 10.0 · WebView2 1.2.3' })}
      />,
    );

    fireEvent.click(screen.getByTestId('settings-report-open'));

    await waitFor(() => expect(browser.opened()).toHaveLength(1));
    const body = new URL(browser.opened()[0] ?? '').searchParams.get('body') ?? '';
    expect(body).toContain('App version: 9.9.9');
    expect(body).toContain('WebView2 1.2.3');
  });

  it('negative: a machine with no browser says so rather than doing nothing', async () => {
    const browser = createFakeBrowserPort();
    browser.failNext();
    render(<ReportProblem browser={browser} port={fakeReportPort()} />);

    fireEvent.click(screen.getByTestId('settings-report-open'));

    const alert = await screen.findByTestId('settings-report-problem');
    expect(alert.textContent).toContain('default browser');
    // And the control is usable again, rather than stuck on "Opening…".
    expect((screen.getByTestId('settings-report-open') as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('the real port', () => {
  it('falls back to the compile-time version when there is no Tauri runtime', async () => {
    // This is the catch branch running for real: there is no Tauri runtime in a
    // Vitest process, so `getVersion()` rejects. `APP_VERSION` is the same
    // number — `backup.test.ts` pins it to package.json — so the report stays
    // accurate rather than reporting "unknown".
    await expect(createTauriReportPort().version()).resolves.toBe(APP_VERSION);
  });

  it('reads the system from the web view’s own user agent', () => {
    // jsdom supplies a user agent with a platform token, so this exercises the
    // real reader rather than the empty-string fallback.
    const system = createTauriReportPort().system();
    expect(typeof system).toBe('string');
    expect(system.length).toBeGreaterThan(0);
  });
});
