import { Component, type ErrorInfo, type ReactNode } from 'react';

import { PRIMARY_BUTTON, SECONDARY_BUTTON } from './buttons';

/**
 * The crash safety net around the whole app (L-226).
 *
 * Without it, one exception thrown while rendering unmounts the entire tree and
 * leaves a blank window: nothing to press, and nothing to say the job hunt is
 * still on disk. A render error cannot touch the database — every write goes
 * through the data layer, not through rendering — so the honest thing to say is
 * that the data is safe, and to offer a way back.
 *
 * The error's MESSAGE is never shown. It can carry whatever text was being
 * rendered — a line of a CV, an advert — and a screenshot of this screen is
 * exactly what gets pasted into a public issue. It goes to the console, which
 * stays on this machine.
 *
 * A class component because React still has no hook for catching render
 * errors.
 */

interface ErrorBoundaryProps {
  readonly children: ReactNode;
  /** Reloads the window. A prop so a test can observe it without reloading jsdom. */
  readonly onReload?: () => void;
}

interface ErrorBoundaryState {
  readonly failed: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('CViper Light caught a render error', error, info.componentStack);
  }

  private readonly tryAgain = (): void => {
    this.setState({ failed: false });
  };

  private readonly reload = (): void => {
    (this.props.onReload ?? (() => window.location.reload()))();
  };

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;

    return (
      <main className="flex min-h-screen items-center justify-center bg-canvas p-6">
        <section
          role="alert"
          className="max-w-md rounded-card border border-line bg-card p-6 shadow-raised"
        >
          <h1 className="text-lg font-semibold text-ink">Something went wrong</h1>
          <p className="mt-2 text-ink-muted">
            Part of the app stopped working. Your data is safe: your CVs, jobs and applications are
            stored on this computer and nothing was lost.
          </p>
          <p className="mt-2 text-ink-muted">
            Try again, or reload the app. If it keeps happening, use Settings, then Report a
            problem.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className={PRIMARY_BUTTON} data-primary onClick={this.tryAgain}>
              Try again
            </button>
            <button type="button" className={SECONDARY_BUTTON} onClick={this.reload}>
              Reload the app
            </button>
          </div>
        </section>
      </main>
    );
  }
}
