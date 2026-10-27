import { Component, type ErrorInfo, type ReactNode } from 'react';

import { PRIMARY_BUTTON, SECONDARY_BUTTON } from './buttons';
import { cardClasses } from '../ui';

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
  /**
   * `app` (the default) is the last-resort net round the whole tree and fills
   * the window. `view` sits round ONE screen inside the shell: it draws in the
   * view's place, so the rail and the other screens stay usable, and App keys
   * it by the view so moving to another screen starts clean.
   */
  readonly scope?: 'app' | 'view';
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

    if (this.props.scope === 'view') {
      return (
        <div className="flex min-h-0 flex-1 items-start justify-center p-6">
          <section role="alert" className={`max-w-md ${cardClasses({ padding: 'none' })} p-6`}>
            <h1 className="text-lg font-semibold text-ink">This screen stopped working</h1>
            <p className="mt-2 text-ink-muted">
              Your data is safe: your CVs, jobs and applications are stored on this computer and
              nothing was lost. The other screens still work.
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
        </div>
      );
    }

    return (
      <main className="flex min-h-screen items-center justify-center bg-canvas p-6">
        <section role="alert" className={`max-w-md ${cardClasses({ padding: 'none' })} p-6`}>
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
