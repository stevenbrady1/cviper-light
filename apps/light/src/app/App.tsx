import { useCallback, useEffect, useRef, useState } from 'react';

import { type Result } from '@cviper/core-types';

import { type AnalysisProps } from '../features/analysis/Analysis';
import { createAnalysisSession } from '../features/analysis/session';
import { type TailorHandoff } from '../features/flow/handoff';
import { Welcome } from '../features/onboarding/Welcome';
import { type ProfileProps } from '../features/profile/Profile';
import { forgetWelcome, hasSeenWelcome, markWelcomeSeen } from '../features/onboarding/store';
import { type SearchProps } from '../features/search/Search';
import { type SettingsProps } from '../features/settings/Settings';
import { createJobSessions } from '../features/tailor/jobSessions';
import { type WorkflowPort } from '../features/tailor/persistence';
import { ResumeBanner, resumeBannerText } from '../features/tailor/ResumeBanner';
import { type TailorProps } from '../features/tailor/Tailor';
import { type TrackerProps } from '../features/tracker/Tracker';
import { type StepId } from '../features/flow/steps';
import { type Job } from '@cviper/core-types';
import {
  createTauriOpenedCvPort,
  type FileError,
  type OpenedCvPort,
  type PickedCv,
} from '../platform/files';
import { UpdateBanner, updateBannerText } from '../features/settings/updates/UpdateBanner';
import { readEnvironmentStatus, type EnvironmentStatus } from '../status/environment';
import { BottomNav } from './BottomNav';
import { QUIET_BUTTON } from './buttons';
import { ErrorBoundary } from './ErrorBoundary';
import { renderView } from './renderView';
import { Sidebar } from './Sidebar';
import { useStartupFonts } from './startupFonts';
import { useJobFlow } from './useJobFlow';
import { useLaunchUpdate } from './useLaunchUpdate';
import { useTailorWorkRestore } from './useTailorWorkRestore';
import { useViewShortcuts } from './useViewShortcuts';
import { useViewportClass } from './viewport';
import { DEFAULT_VIEW, type ViewId } from './views';
import { LiveStatus } from './LiveStatus';

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
 * the feature does. The one exception is the analysis session (L-187), which
 * has to outlive its view. Since L-190 the shell also CARRIES a job between
 * views — Search or the tracker to Analysis, Analysis or the tracker to Tailor
 * — because only the shell outlives the switch; it does that through
 * `flow/handoff.ts` and reads the session only to pass its CV and option on.
 *
 * In particular the detail pane is NOT owned here. It is a component
 * (`DetailPane`) that a view mounts beside its own content, because what is in
 * the pane and what counts as "selected" are questions only the view can
 * answer.
 *
 * ============================================================================
 * KEYBOARD
 * ============================================================================
 * `Ctrl+1` to `Ctrl+5` switch between the five workflow views. Bound on
 * `document` so they work wherever focus happens to be, and `preventDefault()`ed
 * so they do not also trigger a WebView2 default.
 *
 * Only digits that are actually bound are intercepted: `Ctrl+6` is left alone
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
  readonly profilePort?: ProfileProps['port'];
  /** Injected by tests, for the same reason as `trackerPort`. */
  readonly analysisPort?: AnalysisProps['port'];
  /** Injected by tests, for the same reason as `trackerPort` (L-160). */
  readonly tailorPort?: TailorProps['port'];
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
  /** Injected by tests: the real one wipes the database, keychain and preferences. */
  readonly erasePort?: SettingsProps['erasePort'];
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
  /**
   * Where Tailor's work in progress is kept across a restart (L-199).
   * Undefined in the app: the real database and store file are used — unless
   * the tailor port itself was injected, in which case the shell does not
   * reach past a fake data layer to the real one. `null` turns it off.
   */
  readonly workflowPort?: WorkflowPort | null | undefined;
  /** Injected by tests: the tracker cards' saved progress (L-200). */
  readonly boardProgressPort?: TrackerProps['boardProgressPort'];
}

export default function App({
  trackerPort,
  profilePort,
  analysisPort,
  tailorPort,
  filePort,
  openedCv,
  createTransport,
  backupPort,
  erasePort,
  keyPort,
  browser,
  boardsPort,
  updatePort,
  readUpdateCheckOnLaunch,
  searchPort,
  readKeyStates,
  newId,
  now,
  workflowPort,
  boardProgressPort,
}: AppProps = {}) {
  const [activeView, setActiveView] = useState<ViewId>(DEFAULT_VIEW);
  useStartupFonts(); // L-364: the mono faces load before any screen needs them
  /**
   * A place for Settings to open at, set by Search's "Manage job boards"
   * (L-310) or "Get a free Reed key" (L-338) and cleared by Settings once it
   * is there, so the next ordinary visit opens at the top.
   */
  const [settingsOpenAt, setSettingsOpenAt] = useState<'job-boards' | 'reed-key' | null>(null);
  const openSettingsAt = (place: 'job-boards' | 'reed-key') => {
    setSettingsOpenAt(place);
    setActiveView('settings');
  };
  /** Tracker opens at the paste pane once, from Search's "Bring it in" (L-324). */
  const [trackerOpensPaste, setTrackerOpensPaste] = useState(false);

  // Focus follows the view (WCAG 2.4.3). Switching view unmounts whatever had
  // focus, which dropped it to <body>: a keyboard or screen-reader user heard
  // nothing and had to tab from the top to find where they were. The new
  // view's heading takes focus instead. Compared with the view last focused,
  // not "first render", so React's development double-run cannot fire it at
  // launch.
  const mainRef = useRef<HTMLElement>(null);
  const focusedView = useRef(activeView);
  useEffect(() => {
    if (focusedView.current === activeView) return;
    focusedView.current = activeView;
    // Settings opened at a section puts focus there itself (L-310). Child
    // effects run first, so taking it back here would undo that.
    if (activeView === 'settings' && settingsOpenAt !== null) return;
    if (activeView === 'tracker' && trackerOpensPaste) return; // the link box, likewise (L-324)
    const heading = mainRef.current?.querySelector('h1');
    if (!(heading instanceof HTMLElement)) return;
    if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: true });
  }, [activeView, settingsOpenAt, trackerOpensPaste]);
  const [status, setStatus] = useState<EnvironmentStatus | null>(null);
  const [welcomeOpen, setWelcomeOpen] = useState(() => !hasSeenWelcome());
  const [incomingCv, setIncomingCv] = useState<Result<PickedCv, FileError> | null>(null);
  const viewport = useViewportClass();
  /**
   * The last analysis, owned HERE because the analysis view is unmounted
   * whenever another view is showing (L-187) — see `analysis/session.ts`.
   * Memory only, for the life of the app: a CV is not written to disk unasked.
   * This is the one piece of a view's data the shell holds, and it holds it
   * opaquely: it creates it, hands it down and resets it, and never reads it.
   */
  const [analysisSession] = useState(createAnalysisSession);
  /**
   * A job on its way to the Tailor screen (L-190), or `null`. Held here until
   * Tailor has loaded what it needs to apply it and says so; memory only, and
   * cleared by "Delete everything" along with the analysis session.
   */
  const [tailorHandoff, setTailorHandoff] = useState<TailorHandoff | null>(null);
  /**
   * The Tailor screen's work, one session per job (L-199): the draft, the
   * review, the letter. Held here for the same reason as the analysis
   * session — the view unmounts on every switch — and cleared with it.
   */
  const [jobSessions] = useState(createJobSessions);
  /** The job the last run of the app was tailoring for, offered back once. */
  const [resumeOffer, setResumeOffer] = useState<{
    readonly title: string;
    readonly company: string;
  } | null>(null);
  /** A write-through that failed: said once, on a strip, never swallowed. */
  const [keepProblem, setKeepProblem] = useState<string | null>(null);

  // The hooks below are called exactly where their effects used to be (L-373).
  // React runs effects in the order they are declared, so moving a call moves
  // the start-up order with it.

  // Tailor's work across a restart (L-199): `useTailorWorkRestore.ts`.
  useTailorWorkRestore({
    activeView,
    jobSessions,
    tailorPort,
    workflowPort,
    setResumeOffer,
    setKeepProblem,
  });

  // The update check on launch (L-92): `useLaunchUpdate.ts`.
  const { updatePortInstance, offeredUpdate, setOfferedUpdate, installPhase, onInstallUpdate } =
    useLaunchUpdate({ updatePort, readUpdateCheckOnLaunch });

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

  // Ctrl+1 to Ctrl+5 (KEYBOARD, above): `useViewShortcuts.ts`.
  useViewShortcuts(setActiveView);

  // Carrying a job between screens (L-190, L-200): `useJobFlow.ts`.
  const {
    tailorEntryStep,
    setTailorEntryStep,
    onSelect,
    onAnalyseJob,
    onTailorJob,
    onTailorHandoffHandled,
    onJobStep,
    onTracker,
    jobChoice,
    onJobChoice,
    tailoredJob,
    onTrackerAnalyse,
    onTrackerTailor,
  } = useJobFlow({ analysisSession, jobSessions, setActiveView, setTailorHandoff });

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
    // The CV and advert on the analysis screen were in the database that just
    // went; the screen must not be the one place they survive. The same goes
    // for a job still on its way to Tailor (L-190), and for every tailored
    // draft still on screen (L-199).
    analysisSession.reset();
    jobSessions.reset();
    setTailorHandoff(null);
    setResumeOffer(null);
    setKeepProblem(null);
  }, [analysisSession, jobSessions]);

  const narrow = viewport === 'narrow';
  // The phone's insets — notch, corners, home indicator — kept off the content
  // once, here, so no view has to know it is on a phone. Zero everywhere else.
  const insets = narrow ? 'pt-safe pb-safe pl-safe pr-safe' : '';
  /*
    The frame holds everything positioned inside it (L-334). An `sr-only` status
    with nothing positioned above it was placed against the WINDOW, below it on
    a long screen, so the page grew and code could scroll the whole app up.
    `overflow-clip`, not `-hidden`: it clips without making the frame scrollable.
  */
  const frame = 'relative flex h-full min-h-0 overflow-clip bg-canvas text-ink';

  if (welcomeOpen) {
    return (
      <div className={`${frame} ${insets}`}>
        <Welcome onDismiss={onDismissWelcome} />
      </div>
    );
  }

  return (
    <div
      data-testid="shell"
      data-viewport={viewport}
      className={[
        frame,
        // Phone: a column, the view above the bar. The bottom inset is the
        // bar's own (`BottomNav`), so it is navy under the home indicator.
        narrow ? 'flex-col pt-safe pl-safe pr-safe' : '',
      ].join(' ')}
    >
      {narrow ? null : <Sidebar activeView={activeView} onSelect={onSelect} status={status} />}

      <main ref={mainRef} className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/*
          A strip above the view, never a modal over it. The app stays usable
          behind it and "Not now" installs nothing — see `UpdateBanner`.
        */}
        {/*
          Both strips are spoken from here, where the shell is always on the
          page (L-238): a strip arriving with its words already in it is not
          reliably announced, so the strips themselves carry no role.
        */}
        <LiveStatus
          text={
            offeredUpdate === null
              ? null
              : updateBannerText(offeredUpdate.version, installPhase === 'installed')
          }
        />
        <LiveStatus
          text={
            resumeOffer === null || activeView === 'tailor'
              ? null
              : resumeBannerText(resumeOffer.title, resumeOffer.company)
          }
        />
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

        {resumeOffer === null || activeView === 'tailor' ? null : (
          <ResumeBanner
            title={resumeOffer.title}
            company={resumeOffer.company}
            onContinue={() => {
              setResumeOffer(null);
              setActiveView('tailor');
            }}
            onDismiss={() => setResumeOffer(null)}
          />
        )}

        <LiveStatus text={keepProblem} />
        {keepProblem === null ? null : (
          <div
            data-testid="workflow-keep-problem"
            className="flex flex-wrap items-center gap-3 border-b border-line bg-sunken px-4 py-2 md:px-6"
          >
            <p className="min-w-0 flex-1 text-ink-muted">{keepProblem}</p>
            <button
              type="button"
              data-testid="workflow-keep-problem-dismiss"
              onClick={() => setKeepProblem(null)}
              className={QUIET_BUTTON}
            >
              Close
            </button>
          </div>
        )}

        {/*
          One boundary per screen, keyed by it (see ErrorBoundary's `scope`):
          a crash in one view no longer takes the rail with it, and moving to
          another view starts clean instead of re-rendering the broken one.
        */}
        <ErrorBoundary key={activeView} scope="view">
          {renderView(activeView, {
            profile: {
              port: profilePort,
              now,
            },
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
              // Settings → Job boards (L-310) or the Reed key (L-338): same hand-back.
              onOpenJobBoards: () => openSettingsAt('job-boards'),
              onOpenReedKey: () => openSettingsAt('reed-key'),
              onBringJobIn: () => {
                setTrackerOpensPaste(true);
                setActiveView('tracker');
              },
              onAnalyse: onAnalyseJob,
            },
            tracker: {
              port: trackerPort,
              now,
              createTransport,
              browser,
              // Same arrangement as the search screen: the shell owns which view
              // is showing, so "no AI provider — open Settings" comes back here.
              onOpenSettings: () => setActiveView('settings'),
              onAnalyse: onTrackerAnalyse,
              onTailor: onTrackerTailor,
              boardProgressPort,
              tailoredJob,
              // "Continue" under a started card goes where the step bar would.
              onContinue: (job: Job, step: StepId) => onJobStep(step, job),
              openPaste: trackerOpensPaste,
              onOpened: () => setTrackerOpensPaste(false),
            },
            analysis: {
              port: analysisPort,
              filePort,
              // The SAME port the profile view uses: the gates (L-156) read what
              // that view saved, and a test can watch one write reach both.
              profilePort,
              createTransport,
              now,
              incomingCv,
              onIncomingCvHandled,
              session: analysisSession,
              onTailor: (handoff: TailorHandoff) => {
                setTailorEntryStep('tailor');
                onTailorJob(handoff);
              },
              tailoredJob,
              onJobStep,
              onTracker,
              jobChoice,
              onJobChoice,
            },
            tailor: {
              port: tailorPort,
              filePort,
              createTransport,
              now,
              // Same arrangement as Search and the tracker (L-175): no model or
              // key means "set one up in Settings", and the shell does the going.
              onOpenSettings: () => setActiveView('settings'),
              handoff: tailorHandoff,
              onHandoffHandled: onTailorHandoffHandled,
              jobSessions,
              entryStep: tailorEntryStep,
              onJobStep,
              onTracker,
            },
            settings: {
              port: backupPort,
              erasePort,
              filePort,
              keyPort,
              browser,
              boardsPort,
              updatePort: updatePortInstance,
              onShowWelcome,
              onErased,
              now,
              openAt: settingsOpenAt ?? undefined,
              onOpened: () => setSettingsOpenAt(null),
            },
          })}
        </ErrorBoundary>
      </main>

      {narrow ? <BottomNav activeView={activeView} onSelect={onSelect} /> : null}
    </div>
  );
}
