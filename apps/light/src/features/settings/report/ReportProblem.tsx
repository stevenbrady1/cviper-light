import { useCallback, useMemo, useState } from 'react';

import { SECONDARY_BUTTON } from '../../../app/buttons';
import { createTauriBrowserPort, type BrowserPort } from '../../../platform/browser';

import { reportUrl } from './model';
import { createTauriReportPort, type ReportPort } from './port';

/**
 * Report a problem — a pre-filled issue form, opened in the user's browser.
 *
 * ============================================================================
 * THE SCREEN SAYS WHAT IS IN IT BEFORE THE BUTTON IS PRESSED.
 * ============================================================================
 * "Report a problem" is the one button in a privacy-first app that a suspicious
 * user would assume uploads something. So the copy lists the two facts it adds
 * and says plainly that there is no log file, BEFORE the press — and then the
 * user reads the whole thing again in their own browser, in GitHub's form, and
 * decides whether to submit it. Nothing is sent by this app at any point.
 *
 * ============================================================================
 * NO PRIMARY BUTTON HERE
 * ============================================================================
 * Settings spends its one blue button on Export (`app/buttons.ts`), and
 * `Settings.test.tsx` counts the enabled primaries and expects exactly one.
 */

export interface ReportProblemProps {
  /** Injected by tests: the real one opens the user's browser. */
  readonly browser?: BrowserPort | undefined;
  /** Injected by tests: the real one asks Tauri for the version. */
  readonly port?: ReportPort | undefined;
}

export function ReportProblem({ browser, port }: ReportProblemProps = {}) {
  const browserPort = useMemo(() => browser ?? createTauriBrowserPort(), [browser]);
  const reportPort = useMemo(() => port ?? createTauriReportPort(), [port]);

  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onReport = useCallback(async () => {
    setProblem(null);
    setBusy(true);

    // Read BEFORE the URL is built, so the address is assembled from two plain
    // strings and nothing else can reach it.
    const version = await reportPort.version();
    const system = reportPort.system();

    const opened = await browserPort.open(reportUrl({ version, system }));
    setBusy(false);

    // Never swallowed. A button that silently does nothing is a dead end, and
    // this one is the dead end somebody hits when they are already annoyed.
    if (!opened.ok) setProblem(opened.error.message);
  }, [browserPort, reportPort]);

  return (
    <section data-testid="settings-report">
      <h2 className="font-medium text-ink">Report a problem</h2>
      <p className="mt-1 text-ink-muted">
        Opens a new issue on this app’s public GitHub page, in your own browser, with the box
        already headed. You write what happened and press submit — or close the tab, and nothing has
        been sent.
      </p>
      <p className="mt-1 text-xs text-ink-faint">
        Two facts are filled in for you: which version you are on, and which Windows and WebView2
        you are running. That is all of it. There is no log file in this app to attach, nothing is
        uploaded in the background, and no part of your CVs, your saved jobs or your keys goes into
        the report.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="settings-report-open"
          disabled={busy}
          onClick={() => void onReport()}
          className={SECONDARY_BUTTON}
        >
          {busy ? 'Opening…' : 'Report a problem'}
        </button>
        <span className="text-xs text-ink-faint">Opens in your browser.</span>
      </div>

      {problem === null ? null : (
        <p
          role="alert"
          data-testid="settings-report-problem"
          className="mt-3 rounded-control bg-danger/5 px-3 py-2 text-danger"
        >
          {problem}
        </p>
      )}
    </section>
  );
}
