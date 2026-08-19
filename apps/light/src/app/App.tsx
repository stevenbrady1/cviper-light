import { useCallback, useEffect, useState } from 'react';

import { Analysis, type AnalysisProps } from '../features/analysis/Analysis';
import { Welcome } from '../features/onboarding/Welcome';
import { forgetWelcome, hasSeenWelcome, markWelcomeSeen } from '../features/onboarding/store';
import { Search, type SearchProps } from '../features/search/Search';
import { Settings, type SettingsProps } from '../features/settings/Settings';
import { Tracker, type TrackerProps } from '../features/tracker/Tracker';
import { readEnvironmentStatus, type EnvironmentStatus } from '../status/environment';

import { Sidebar } from './Sidebar';
import { DEFAULT_VIEW, viewForShortcut, type ViewId } from './views';

/**
 * The application shell: a fixed navy rail on the left, one view to the right.
 *
 * ============================================================================
 * WHAT THE SHELL OWNS, AND WHAT IT DOES NOT
 * ============================================================================
 * It owns exactly two things: WHICH VIEW is showing, and the environment status
 * the rail displays. It does not own selection, editing, or any view's data —
 * a shell that reaches into a feature is a shell that has to change every time
 * the feature does.
 *
 * In particular the detail pane is NOT owned here. It is a component
 * (`DetailPane`) that a view mounts beside its own content, because what is in
 * the pane and what counts as "selected" are questions only the view can
 * answer.
 *
 * ============================================================================
 * KEYBOARD
 * ============================================================================
 * `Ctrl+1/2/3` switch between the three workflow views. Bound on `document` so
 * they work wherever focus happens to be, and `preventDefault()`ed so they do
 * not also trigger a WebView2 default.
 *
 * Only digits that are actually bound are intercepted: `Ctrl+4` is left alone
 * rather than being swallowed or falling through to a default view, because
 * moving a user somewhere they did not ask to go is worse than doing nothing.
 *
 * ============================================================================
 * THE INTRODUCTION TAKES THE WINDOW, AND IS SHOWN ONCE
 * ============================================================================
 * On a machine that has never run this before, the shell is not drawn at all —
 * see the note in `onboarding/Welcome.tsx` for why it replaces the app rather
 * than floating over it. Dismissing it writes the flag, so the second launch
 * goes straight to the board, and Settings can bring it back.
 *
 * The flag is read ONCE, in a lazy initialiser. Reading it on every render
 * would make the screen a function of `localStorage` rather than of state, and
 * the overlay would reappear the moment anything else cleared that key.
 */

export interface AppProps {
  /**
   * Injected by tests. The tracker otherwise builds its own SQLite-backed port,
   * which needs a Tauri runtime that a Vitest process does not have.
   */
  readonly trackerPort?: TrackerProps['port'];
  /** Injected by tests, for the same reason as `trackerPort`. */
  readonly analysisPort?: AnalysisProps['port'];
  /** Injected by tests: the real one opens an OS dialog and calls into Rust. */
  readonly filePort?: AnalysisProps['filePort'];
  /** Injected by tests so a fake provider can answer without a socket. */
  readonly createTransport?: AnalysisProps['createTransport'];
  /** Injected by tests, for the same reason as `trackerPort`. */
  readonly backupPort?: SettingsProps['port'];
  /** Injected by tests: the real one reads and writes the OS credential store. */
  readonly keyPort?: SettingsProps['keyPort'];
  /** Injected by tests: the real one opens the user's browser. */
  readonly browser?: SettingsProps['browser'];
  /** Injected by tests: the real one talks to the updater plugin. */
  readonly updatePort?: SettingsProps['updatePort'];
  /** Injected by tests, for the same reason as `trackerPort`. */
  readonly searchPort?: SearchProps['port'];
  /** Injected by tests so no credential store is read for the provider toggles. */
  readonly readKeyStates?: SearchProps['readKeyStates'];
  /** Injected by tests so advert and application ids are deterministic. */
  readonly newId?: SearchProps['newId'];
  /** Injected by tests so every age, due date and stored timestamp is deterministic. */
  readonly now?: Date | undefined;
}

export default function App({
  trackerPort,
  analysisPort,
  filePort,
  createTransport,
  backupPort,
  keyPort,
  browser,
  updatePort,
  searchPort,
  readKeyStates,
  newId,
  now,
}: AppProps = {}) {
  const [activeView, setActiveView] = useState<ViewId>(DEFAULT_VIEW);
  const [status, setStatus] = useState<EnvironmentStatus | null>(null);
  const [welcomeOpen, setWelcomeOpen] = useState(() => !hasSeenWelcome());

  /**
   * Re-read the rail's status on mount and on every view change.
   *
   * Three local IPC calls, so it is cheap, and the moment that matters is a
   * user coming back from Settings having just pasted a key: the rail should
   * already agree with them rather than waiting for a restart. There is no
   * polling — nothing here changes on its own.
   */
  useEffect(() => {
    let cancelled = false;

    void readEnvironmentStatus().then((next) => {
      if (!cancelled) setStatus(next);
    });

    return () => {
      cancelled = true;
    };
  }, [activeView]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      // Ctrl, and only Ctrl. `Ctrl+Alt+2` is AltGr on a good many European
      // keyboard layouts and types a character; stealing it would make the app
      // impossible to type in.
      if (!event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;

      const digit = Number(event.key);
      if (!Number.isInteger(digit)) return;

      const target = viewForShortcut(digit);
      if (target === null) return;

      event.preventDefault();
      setActiveView(target);
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const onSelect = useCallback((id: ViewId) => setActiveView(id), []);

  /**
   * Close the introduction.
   *
   * `view` is the card the user pressed, or `null` when they skipped. Skipping
   * deliberately does NOT move them: they are wherever they were, which on a
   * first run is the board and after a reopen from Settings is Settings.
   */
  const onDismissWelcome = useCallback((view: ViewId | null) => {
    markWelcomeSeen();
    if (view !== null) setActiveView(view);
    setWelcomeOpen(false);
  }, []);

  const onShowWelcome = useCallback(() => {
    // Forgotten as well as reopened, so "show me that again" survives a
    // relaunch if the user closes the app while reading it.
    forgetWelcome();
    setWelcomeOpen(true);
  }, []);

  if (welcomeOpen) {
    return (
      <div className="flex h-full min-h-0 bg-canvas text-ink">
        <Welcome onDismiss={onDismissWelcome} />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 bg-canvas text-ink">
      <Sidebar activeView={activeView} onSelect={onSelect} status={status} />

      <main className="flex min-h-0 min-w-0 flex-1">
        {renderView(activeView, {
          search: {
            port: searchPort,
            browser,
            readKeyStates,
            newId,
            now,
            // The search screen cannot navigate: the shell owns which view is
            // showing, so "no Adzuna key — open Settings" has to come back here
            // to be acted on.
            onOpenSettings: () => setActiveView('settings'),
          },
          tracker: { port: trackerPort, now },
          analysis: { port: analysisPort, filePort, createTransport, now },
          settings: {
            port: backupPort,
            filePort,
            keyPort,
            browser,
            updatePort,
            onShowWelcome,
            now,
          },
        })}
      </main>
    </div>
  );
}

/** The props each view needs, gathered in one place the switch below reads. */
interface ViewProps {
  readonly search: SearchProps;
  readonly tracker: TrackerProps;
  readonly analysis: AnalysisProps;
  readonly settings: SettingsProps;
}

function renderView(id: ViewId, props: ViewProps) {
  switch (id) {
    case 'search':
      return <Search {...props.search} />;
    case 'tracker':
      return <Tracker {...props.tracker} />;
    case 'analysis':
      return <Analysis {...props.analysis} />;
    case 'settings':
      return <Settings {...props.settings} />;
  }
}
