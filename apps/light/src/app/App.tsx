import { useCallback, useEffect, useMemo, useState } from 'react';

import { type Result } from '@cviper/core-types';

import { Analysis, type AnalysisProps } from '../features/analysis/Analysis';
import { Welcome } from '../features/onboarding/Welcome';
import { forgetWelcome, hasSeenWelcome, markWelcomeSeen } from '../features/onboarding/store';
import { Search, type SearchProps } from '../features/search/Search';
import { Settings, type SettingsProps } from '../features/settings/Settings';
import { Tracker, type TrackerProps } from '../features/tracker/Tracker';
import {
  createTauriOpenedCvPort,
  type FileError,
  type OpenedCvPort,
  type PickedCv,
} from '../platform/files';
import { UpdateBanner } from '../features/settings/updates/UpdateBanner';
import { updateCheckOnLaunchEnabled } from '../features/settings/updates/launchCheck';
import { nextStateAfterCheck } from '../features/settings/updates/model';
import { createTauriUpdatePort } from '../features/settings/updates/port';
import { detectMobileOs } from '../platform/os';
import { readEnvironmentStatus, type EnvironmentStatus } from '../status/environment';

import { BottomNav } from './BottomNav';
import { Sidebar } from './Sidebar';
import { useViewportClass } from './viewport';
import { DEFAULT_VIEW, viewForShortcut, type ViewId } from './views';

/**
 * The application shell: a fixed navy rail on the left, one view to the right
 * — or, on a phone, the view on top and a navigation bar along the bottom.
 *
 * ============================================================================
 * WHAT THE SHELL OWNS, AND WHAT IT DOES NOT
 * ============================================================================
 * It owns exactly three things: WHICH VIEW is showing, the environment status
 * the rail displays, and which of the two navigations is mounted (L-81: the
 * rail above Tailwind's `md`, the bottom bar below it — never both, because
 * they share `data-testid`s). It does not own selection, editing, or any view's data —
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
  /**
   * Injected by tests: the real one listens for the file the OS asked this
   * app to open (the iPhone share sheet, L-83). A file arriving switches to
   * Analysis and is handed to it, whatever was on screen — including the
   * first-run introduction, which a person who has just tapped "Open in
   * CViper Light" has answered by doing so.
   */
  readonly openedCv?: OpenedCvPort;
  /** Injected by tests so a fake provider can answer without a socket. */
  readonly createTransport?: AnalysisProps['createTransport'];
  /** Injected by tests, for the same reason as `trackerPort`. */
  readonly backupPort?: SettingsProps['port'];
  /** Injected by tests: the real one reads and writes the OS credential store. */
  readonly keyPort?: SettingsProps['keyPort'];
  /** Injected by tests: the real one opens the user's browser. */
  readonly browser?: SettingsProps['browser'];
  /**
   * Injected by tests: the real one reads and writes the board-choices file.
   *
   * The SAME port reaches both views on purpose. Settings writes it, the search
   * screen reads it back when it is next mounted, and a test can watch one
   * change travel between them.
   */
  readonly boardsPort?: SettingsProps['boardsPort'];
  /** Injected by tests: the real one talks to the updater plugin. */
  readonly updatePort?: SettingsProps['updatePort'];
  /**
   * Injected by tests ONLY to prove the ORDER of the read and the request.
   *
   * The real answer comes from `launchCheck.ts`. A check that fires and
   * consults the preference afterwards has already made the request the user
   * switched off, and nothing but the order can show that.
   */
  readonly readUpdateCheckOnLaunch?: () => boolean;
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
  openedCv,
  createTransport,
  backupPort,
  keyPort,
  browser,
  boardsPort,
  updatePort,
  readUpdateCheckOnLaunch,
  searchPort,
  readKeyStates,
  newId,
  now,
}: AppProps = {}) {
  const [activeView, setActiveView] = useState<ViewId>(DEFAULT_VIEW);
  const [status, setStatus] = useState<EnvironmentStatus | null>(null);
  const [welcomeOpen, setWelcomeOpen] = useState(() => !hasSeenWelcome());
  const [incomingCv, setIncomingCv] = useState<Result<PickedCv, FileError> | null>(null);
  const viewport = useViewportClass();

  /**
   * The update offered by the check on launch, or `null` for the usual case.
   *
   * ============================================================================
   * ONE PORT, SHARED WITH SETTINGS
   * ============================================================================
   * `install` can only install the update the last `check` found, and that
   * handle lives inside the port. A second port here would leave the banner's
   * Install button with nothing to install.
   */
  const updatePortInstance = useMemo(() => updatePort ?? createTauriUpdatePort(), [updatePort]);
  const [offeredUpdate, setOfferedUpdate] = useState<{
    readonly version: string;
    readonly notes: string | null;
  } | null>(null);
  const [installPhase, setInstallPhase] = useState<'idle' | 'installing' | 'installed'>('idle');

  /**
   * Look for a newer version once, at startup, unless the user said not to.
   *
   * ============================================================================
   * THE PREFERENCE IS READ BEFORE ANYTHING IS REQUESTED
   * ============================================================================
   * That ordering is the whole promise. Reading it afterwards would mean the
   * request the user switched off had already been made, and no amount of
   * "we only use the result if..." undoes a packet that has left.
   *
   * It is SILENT about failure. Nobody asked for this check, so a banner saying
   * GitHub could not be reached would be an error message for an action the
   * user did not take. The button in Settings is where a failure is worth
   * reporting, because somebody is waiting for that answer.
   *
   * Once, on mount, and deliberately not on view changes: "check when the user
   * opens a screen" is still a request they did not ask for.
   */
  useEffect(() => {
    const readToggle = readUpdateCheckOnLaunch ?? updateCheckOnLaunchEnabled;
    if (!readToggle()) return;

    // Not on a phone. The store delivers updates there and the updater plugin
    // is not compiled into those builds at all (L-80).
    if (detectMobileOs() !== null) return;

    let cancelled = false;
    void updatePortInstance.check().then((result) => {
      if (cancelled) return;
      const next = nextStateAfterCheck(result);
      if (next.kind === 'available') {
        setOfferedUpdate({ version: next.version, notes: next.notes });
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const onInstallUpdate = useCallback(async () => {
    setInstallPhase('installing');

    const installed = await updatePortInstance.install();
    // Never swallowed. A failed install must not leave the strip looking like
    // it worked; it goes back to offering, and Settings is where the reason
    // can be read in full.
    setInstallPhase(installed.ok ? 'installed' : 'idle');
  }, [updatePortInstance]);

  useEffect(() => {
    const port = openedCv ?? createTauriOpenedCvPort();
    return port.watch((opened) => {
      setIncomingCv(opened);
      setActiveView('analysis');
      // Opening a file IS the first thing this person wants to do; the
      // introduction would only stand between them and it.
      markWelcomeSeen();
      setWelcomeOpen(false);
    });
  }, [openedCv]);

  const onIncomingCvHandled = useCallback(() => setIncomingCv(null), []);

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

  /**
   * Everything was deleted. Back to the first run: the introduction, the
   * default view, and a rail that re-reads a store which is now empty. The
   * welcome flag itself went with the preferences, so it is not forgotten
   * here a second time.
   */
  const onErased = useCallback(() => {
    setActiveView(DEFAULT_VIEW);
    setStatus(null);
    setWelcomeOpen(true);
  }, []);

  const narrow = viewport === 'narrow';
  // The phone's insets — notch, corners, home indicator — kept off the content
  // once, here, so no view has to know it is on a phone. Zero everywhere else.
  const insets = narrow ? 'pt-safe pb-safe pl-safe pr-safe' : '';

  if (welcomeOpen) {
    return (
      <div className={`flex h-full min-h-0 bg-canvas text-ink ${insets}`}>
        <Welcome onDismiss={onDismissWelcome} />
      </div>
    );
  }

  return (
    <div
      data-testid="shell"
      data-viewport={viewport}
      className={[
        'flex h-full min-h-0 bg-canvas text-ink',
        // Phone: a column, the view above the bar. The bottom inset is the
        // bar's own (`BottomNav`), so it is navy under the home indicator.
        narrow ? 'flex-col pt-safe pl-safe pr-safe' : '',
      ].join(' ')}
    >
      {narrow ? null : <Sidebar activeView={activeView} onSelect={onSelect} status={status} />}

      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/*
          A strip above the view, never a modal over it. The app stays usable
          behind it and "Not now" installs nothing — see `UpdateBanner`.
        */}
        {offeredUpdate === null ? null : (
          <UpdateBanner
            version={offeredUpdate.version}
            notes={offeredUpdate.notes}
            installing={installPhase === 'installing'}
            installed={installPhase === 'installed'}
            onInstall={() => void onInstallUpdate()}
            onDismiss={() => setOfferedUpdate(null)}
          />
        )}

        {renderView(activeView, {
          search: {
            port: searchPort,
            browser,
            boardsPort,
            readKeyStates,
            newId,
            now,
            // The search screen cannot navigate: the shell owns which view is
            // showing, so "no Adzuna key — open Settings" has to come back here
            // to be acted on.
            onOpenSettings: () => setActiveView('settings'),
          },
          tracker: {
            port: trackerPort,
            now,
            createTransport,
            browser,
            // Same arrangement as the search screen: the shell owns which view
            // is showing, so "no AI provider — open Settings" comes back here.
            onOpenSettings: () => setActiveView('settings'),
          },
          analysis: {
            port: analysisPort,
            filePort,
            createTransport,
            now,
            incomingCv,
            onIncomingCvHandled,
            browser,
          },
          settings: {
            port: backupPort,
            filePort,
            keyPort,
            browser,
            boardsPort,
            updatePort: updatePortInstance,
            onShowWelcome,
            onErased,
            now,
          },
        })}
      </main>

      {narrow ? <BottomNav activeView={activeView} onSelect={onSelect} /> : null}
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
