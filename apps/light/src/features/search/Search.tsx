import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

import {
  JOB_PROVIDER_IDS,
  KEYLESS_SOURCE_IDS,
  quotaVerdict,
  utcDateOf,
  type JobProviderId,
  type JobSearchOutcome,
  type KeylessBrowseOutcome,
  type KeylessSourceId,
  type QuotaState,
} from '@cviper/job-apis';

import { PRIMARY_BUTTON } from '../../app/buttons';
import { ViewHeader } from '../../app/ViewHeader';
import { viewById } from '../../app/views';
import { SHIPPED_BOARDS } from '../boards/defaults';
import { type AnalyseHandoff } from '../flow/handoff';
import { NO_PREFERENCES, mergeBoards, type Board } from '../boards/model';
import { createTauriBoardPreferencesPort, type BoardPreferencesPort } from '../boards/port';
import { readQuota, writeQuota } from '../../jobs/quotaStore';
import { todayIsoDate } from '../../lib/dates';
import { createTauriBrowserPort, type BrowserPort } from '../../platform/browser';
import { readJobKeyStates, type KeyState } from '../../status/environment';

import {
  chooseBoards,
  openBoards,
  readBoardChoice,
  searchButtonLabel,
  tickedBoards,
  toggleBoard,
} from './boardChoice';
import { KeylessBar } from './KeylessBar';
import {
  chosenFeeds,
  isUkLocation,
  readFeedChoice,
  rememberFeedChoice,
  type FeedChoice,
} from './feedDefaults';
import { KeylessFeedToggles } from './KeylessFeedToggles';
import { ProviderToggles } from './ProviderToggles';
import { readSearchMemory, rememberSearch, writeDraft } from './memory';
import { combineResults } from './keylessModel';
import {
  EMPTY_FORM,
  formIsValid,
  hasAnyJobBoardKey,
  providerAvailability,
  searchDisabledReason,
  toSearchInput,
  boardSearchInput,
  validateForm,
  type FormErrors,
  type SearchForm,
} from './model';
import { createDbSearchPort, type SearchPort } from './port';
import {
  deleteSavedSearch,
  readSavedSearches,
  saveSearch,
  suggestedName,
  type SavedSearch,
} from './savedSearches';
import { SearchFields } from './SearchFields';
import { SearchRecent } from './SearchRecent';
import { SearchResults } from './SearchResults';
import { SearchResultsHeader } from './SearchResultsHeader';
import { SearchSaved } from './SearchSaved';
import { useSearchRanking } from './useSearchRanking';
import { useSearchSaving } from './useSearchSaving';

/**
 * The search screen.
 *
 * ============================================================================
 * A SEARCH HAPPENS BECAUSE SOMEBODY PRESSED A BUTTON. NEVER OTHERWISE.
 * ============================================================================
 * No search-as-you-type, no polling, no interval, no refetch on focus, and
 * nothing that runs on mount. Reed's free tier is 100 requests a DAY and their
 * API reports no remaining balance, so a search box that fired on every
 * keystroke would spend a third of the day's allowance typing "credit risk
 * analyst". The only thing debounced here is writing the DRAFT to
 * `localStorage`, which touches no network at all.
 *
 * Rust enforces a minimum gap between submits on top of this (see
 * `SUBMIT_MIN_INTERVAL` in `jobs.rs`), because a disabled button is a
 * suggestion and the transport is the only place that can actually refuse.
 *
 * ============================================================================
 * THE BROWSER BUTTONS ARE ALWAYS THERE
 * ============================================================================
 * `KeylessBar` is rendered unconditionally — before any key exists, after both
 * do, and while a board is down. It is the reason this screen is useful on the
 * day the app is installed, and `search.zeroKeys.test.tsx` drives it with every
 * credential absent and asserts no provider transport is touched.
 *
 * ============================================================================
 * ONE BOARD FAILING NEVER COSTS THE OTHER'S RESULTS
 * ============================================================================
 * `searchJobs` returns an outcome per provider rather than a single `Result`,
 * so Reed being down is not a reason to throw away the Adzuna adverts the user
 * was also waiting for. Each failure is rendered as its own line, above results
 * that are still there.
 *
 * ============================================================================
 * RESULTS ARE RANKED AGAINST THE CV, HERE, WITH NO KEY (L-157)
 * ============================================================================
 * The CV on file and the profile's deal-breakers are read ONCE, when the
 * screen opens, through the port — two SQLite reads, no network. After every
 * search or browse each advert gets a band from the keyword scorer (see
 * `rank.ts`) and a chip per deal-breaker it mentions, and the list is shown
 * best first unless the user unticks that. Both reads fail SILENTLY: the
 * ranking is a convenience, and a red banner over a search that worked
 * perfectly would be the larger error. `search.rank.test.tsx` builds the two
 * transport factories to throw and proves none of this touches them.
 */

/** How long after the last keystroke the draft is written to `localStorage`. */
const DRAFT_DEBOUNCE_MS = 400;

export interface SearchProps {
  /** Injected by tests. Defaults to the real SQLite-and-transport port. */
  readonly port?: SearchPort | undefined;
  /** Injected by tests: the real one opens the user's browser. */
  readonly browser?: BrowserPort | undefined;
  /** Injected by tests: the real one reads the user's board choices off disk. */
  readonly boardsPort?: BoardPreferencesPort | undefined;
  /** Injected by tests so no credential store is read. */
  readonly readKeyStates?: (() => Promise<Record<JobProviderId, KeyState>>) | undefined;
  /** Injected by tests so timestamps and "posted N days ago" are deterministic. */
  readonly now?: Date | undefined;
  /** Injected by tests so advert ids are deterministic. */
  readonly newId?: (() => string) | undefined;
  /** Take the user to the key wizard. Owned by the shell, which owns the view. */
  readonly onOpenSettings?: (() => void) | undefined;
  /** Take the user to Settings → Job boards (L-310). Owned by the shell, likewise. */
  readonly onOpenJobBoards?: (() => void) | undefined;
  /**
   * Take a saved job to the Analysis screen (L-190). The shell owns which view
   * is showing, so the job goes back to it. Left undefined, the cards draw no
   * Analyse button.
   */
  readonly onAnalyse?: ((handoff: AnalyseHandoff) => void) | undefined;
}

export function Search({
  port,
  browser,
  boardsPort,
  readKeyStates,
  now,
  newId,
  onOpenSettings,
  onOpenJobBoards,
  onAnalyse,
}: SearchProps = {}) {
  // Built once. A new port every render would restart the load effects on every
  // keystroke in the search box.
  const searchPort = useMemo(() => port ?? createDbSearchPort(), [port]);
  const browserPort = useMemo(() => browser ?? createTauriBrowserPort(), [browser]);
  const boards = useMemo(() => boardsPort ?? createTauriBoardPreferencesPort(), [boardsPort]);
  const readStates = readKeyStates ?? readJobKeyStates;

  const [form, setForm] = useState<SearchForm>(EMPTY_FORM);
  const [recent, setRecent] = useState<readonly SearchForm[]>([]);
  const [errors, setErrors] = useState<FormErrors>({});
  const [keyStates, setKeyStates] = useState<Record<JobProviderId, KeyState>>({
    // Not `missing`. Until the credential store answers, the honest state is
    // "we have not been told", and claiming "no key saved" for that half-second
    // is a claim about the user's machine that may well be wrong.
    adzuna: 'unreadable',
    reed: 'unreadable',
  });
  const [chosen, setChosen] = useState<ReadonlySet<JobProviderId>>(new Set(JOB_PROVIDER_IDS));
  /*
    Both free feeds ticked from the start (L-110). They need no key, no account
    and no setup, so a machine with an empty credential store returns real
    adverts the first time the button is pressed — which is the whole point of
    the feature, and would be undone by making the user find and tick them.
    Except Arbeitnow for a location in the UK (L-219): it is mostly Europe.
    A tick or untick the user makes wins, and is remembered (`feedDefaults`).
  */
  const [feedChoice, setFeedChoice] = useState<FeedChoice>(() => readFeedChoice());
  const keylessChosen = useMemo(
    () => chosenFeeds(feedChoice, form.location),
    [feedChoice, form.location],
  );
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<JobSearchOutcome | null>(null);
  const [keylessOutcome, setKeylessOutcome] = useState<KeylessBrowseOutcome | null>(null);
  const [quota, setQuota] = useState<QuotaState>(() => readQuota(now ?? new Date()));
  /*
    Seeded with the SHIPPED list rather than an empty one, so the buttons are
    there on the first paint instead of appearing a moment later. The user's own
    list replaces it as soon as the store answers; if the store cannot be read
    the shipped list is what stays, which is the whole point of a default layer.
  */
  const [jobBoards, setJobBoards] = useState<readonly Board[]>(() =>
    mergeBoards(SHIPPED_BOARDS, NO_PREFERENCES),
  );
  /*
    The boards ticked to open with the next Search (L-219 part 4), remembered
    between visits. Ids of boards since switched off or deleted are ignored
    here and dropped on the next tick — see `boardChoice.ts`.
  */
  const [boardChoice, setBoardChoice] = useState<readonly string[]>(() => readBoardChoice());
  /** Boards that would not open on the last Search, named so the user can retry them. */
  const [boardsProblem, setBoardsProblem] = useState<readonly string[]>([]);
  /** Saved searches (L-309), newest first, and what happened to them last. */
  const [saved, setSaved] = useState<readonly SavedSearch[]>(() => readSavedSearches());
  const [savedNote, setSavedNote] = useState<string | null>(null);

  // ── Loading ──────────────────────────────────────────────────────────────

  // Runs ONCE. Restoring the draft fills the boxes and stops there — an app
  // that searched on startup because it remembered something would spend one of
  // Reed's hundred before the user had looked at the screen.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;

    const memory = readSearchMemory();
    setForm(memory.draft);
    setRecent(memory.recent);
  }, []);

  useEffect(() => {
    let cancelled = false;

    void readStates().then((next) => {
      if (!cancelled) setKeyStates(next);
    });

    return () => {
      cancelled = true;
    };
  }, [readStates]);

  useEffect(() => {
    let cancelled = false;

    void boards.read().then((loaded) => {
      if (cancelled) return;
      // A failed read is NOT surfaced here. The shipped boards are already on
      // screen and every one of them works; a red banner over a row of working
      // buttons would be the larger error. Settings, where the user would
      // otherwise see their choices silently reverted, does report it.
      setJobBoards(mergeBoards(SHIPPED_BOARDS, loaded.ok ? loaded.value : NO_PREFERENCES));
    });

    return () => {
      cancelled = true;
    };
  }, [boards]);

  // The ONLY debounce on this screen, and it touches no network: what is in the
  // boxes is written a moment after typing stops, so closing the app mid-thought
  // does not lose it.
  useEffect(() => {
    const timer = setTimeout(() => writeDraft(form), DRAFT_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [form]);

  // ── Deriving ─────────────────────────────────────────────────────────────

  const clock = now ?? new Date();
  const today = todayIsoDate(clock);

  const usableChosen = JOB_PROVIDER_IDS.filter(
    (provider) =>
      chosen.has(provider) && providerAvailability(provider, keyStates[provider]).usable,
  );
  const keylessWanted = KEYLESS_SOURCE_IDS.filter((source) => keylessChosen.has(source));
  /*
    The button is disabled only when there is NOTHING to look at. A free feed
    counts, so a machine with no keys at all can press it — the state this
    feature exists to fix.
  */
  const boardsToOpen = useMemo(
    () => tickedBoards(jobBoards, boardChoice),
    [jobBoards, boardChoice],
  );
  const ticked = useMemo(() => new Set(boardsToOpen.map((board) => board.id)), [boardsToOpen]);
  // A ticked board is something to do, so the button is enabled for boards alone.
  const disabledReason = searchDisabledReason(
    usableChosen.length + keylessWanted.length + boardsToOpen.length,
  );

  const reedVerdict = quotaVerdict(quota, 'reed', utcDateOf(clock) ?? quota.date);

  /*
    One list of adverts out of the two halves, with cross-posts looked for
    ACROSS them — the same role on Adzuna and on a free feed is exactly the
    pair worth flagging, and neither half can see it alone. Nothing is merged
    and nothing is removed; see `keylessModel.ts`.
  */
  const results = useMemo(() => combineResults(outcome, keylessOutcome), [outcome, keylessOutcome]);

  const {
    tracked,
    trackedProblem,
    notes,
    problems,
    savingId,
    onSave,
    onAnalyseJob,
    clearCardNotes,
  } = useSearchSaving(searchPort, results, clock, newId, onAnalyse);
  const ranking = useSearchRanking(searchPort, results);

  // ── Actions ──────────────────────────────────────────────────────────────

  /**
   * Run a search: the ticked boards' tabs, then the keyed boards and the free
   * feeds. Called by the Search button with what is on screen, and by a saved
   * search (L-309) with what it saved — so both run exactly the same path.
   */
  const runSearch = useCallback(
    async (
      formValue: SearchForm,
      boardsValue: readonly Board[],
      keylessValue: readonly KeylessSourceId[],
    ) => {
      /*
        The "type something first" rule belongs to the KEYED half only. Adzuna
        and Reed are query endpoints and an empty form is a mistake to point at;
        the free feeds take no query at all, so browsing what they have just
        published with both boxes empty is the most natural thing a new user
        does. See `ValidateOptions` in model.ts.
      */
      const found = validateForm(formValue, { requireQuery: usableChosen.length > 0 });
      setErrors(found);
      if (!formIsValid(found)) return;

      /*
        The ticked job boards (L-219 part 4): one tab each, in the list's
        order, opened by this press and nothing else. Like the single-board
        buttons before them they need no words in the boxes — an empty search
        is a valid search on every board — but an invalid form opens nothing.
        One that will not open is named; the rest still open.
      */
      setBoardsProblem([]);
      if (boardsValue.length > 0) {
        const failed = await openBoards(browserPort, boardsValue, boardSearchInput(formValue));
        setBoardsProblem(failed);
      }

      if (usableChosen.length === 0 && keylessValue.length === 0) return;

      setRunning(true);
      clearCardNotes();

      const utcToday = utcDateOf(clock) ?? quota.date;
      const createdAt = clock.toISOString();
      const nextId = newId ?? (() => crypto.randomUUID());

      /*
        The two halves run TOGETHER and are independent. A keyed board being
        down is not a reason to hold back the free feeds' adverts, and a dead
        feed is not a reason to lose a paid-for search — each half already
        reports per-source failures of its own, and neither can throw.

        The keyless half takes no quota and gets none: these feeds have no
        account and no daily allowance, so counting a browse against Reed's
        hundred would take real searches away from the user for nothing.
      */
      const [keyed, keyless] = await Promise.all([
        usableChosen.length === 0
          ? Promise.resolve(null)
          : searchPort.search({
              // Only the boards the user actually ticked. Unticking one really
              // does skip its call — see `searchJobs`, which contacts nothing
              // it is not given.
              providers: usableChosen,
              input: toSearchInput(formValue),
              quota: readQuota(clock),
              today: utcToday,
              createdAt,
              newId: nextId,
            }),
        keylessValue.length === 0
          ? Promise.resolve(null)
          : searchPort.browseKeyless({
              sources: keylessValue,
              // The feeds cannot filter, so this narrows what comes back, HERE,
              // on this machine. Nothing typed below ever leaves the process.
              filter: {
                keywords: formValue.keywords.trim(),
                location: formValue.location.trim(),
              },
              createdAt,
              newId: nextId,
            }),
      ]);

      if (keyed !== null) {
        // Written back straight away. The count is the only warning that can
        // exist — Reed's API reports no remaining balance at all.
        writeQuota(keyed.quota);
        setQuota(keyed.quota);
      }
      setRecent(rememberSearch(formValue).recent);
      setOutcome(keyed);
      setKeylessOutcome(keyless);
      setRunning(false);
    },
    [browserPort, clearCardNotes, clock, newId, quota.date, searchPort, usableChosen],
  );

  const onSubmit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      await runSearch(form, boardsToOpen, keylessWanted);
    },
    [boardsToOpen, form, keylessWanted, runSearch],
  );

  /**
   * Save what is in the boxes and the ticked boards under a name (L-309).
   * A form with a mistake in it is not saved: the field says what is wrong,
   * exactly as pressing Search would, and the name box stays open.
   */
  const onSaveSearch = useCallback(
    (name: string): string | null => {
      const found = validateForm(form, { requireQuery: false });
      setErrors(found);
      if (!formIsValid(found)) return 'Fix the search above, then save it.';

      const outcome = saveSearch(
        saved,
        name,
        form,
        boardsToOpen.map((board) => board.id),
        newId ?? (() => crypto.randomUUID()),
      );
      if (!outcome.ok) return outcome.problem;

      setSaved(outcome.list);
      const kept = name.trim();
      setSavedNote(outcome.replaced ? `Updated “${kept}”.` : `Saved “${kept}”.`);
      return null;
    },
    [boardsToOpen, form, newId, saved],
  );

  /**
   * One click: fill the boxes, tick its boards, and run Search. A board since
   * switched off or deleted is dropped here, as a remembered tick is.
   */
  const onRunSaved = useCallback(
    (entry: SavedSearch) => {
      setForm(entry.form);
      setErrors({});
      setSavedNote(null);
      const boardsValue = tickedBoards(jobBoards, entry.boards);
      setBoardChoice(
        chooseBoards(
          boardsValue.map((board) => board.id),
          jobBoards,
        ),
      );
      const feeds = chosenFeeds(feedChoice, entry.form.location);
      void runSearch(
        entry.form,
        boardsValue,
        KEYLESS_SOURCE_IDS.filter((source) => feeds.has(source)),
      );
    },
    [feedChoice, jobBoards, runSearch],
  );

  const onDeleteSaved = useCallback(
    (entry: SavedSearch) => {
      setSaved(deleteSavedSearch(saved, entry.id));
      setSavedNote(`Deleted “${entry.name}”.`);
    },
    [saved],
  );

  const onToggleBoard = useCallback(
    (id: string, on: boolean) => {
      setBoardChoice((current) => toggleBoard(current, id, on, jobBoards));
    },
    [jobBoards],
  );

  const onOpen = useCallback(
    (url: string | null) => {
      if (url === null) return;
      void browserPort.open(url);
    },
    [browserPort],
  );

  const setField = useCallback((field: keyof SearchForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  }, []);

  const onToggle = useCallback((provider: JobProviderId, next: boolean) => {
    setChosen((current) => {
      const updated = new Set(current);
      if (next) updated.add(provider);
      else updated.delete(provider);
      return updated;
    });
  }, []);

  const onToggleKeyless = useCallback((source: KeylessSourceId, next: boolean) => {
    setFeedChoice((current) => rememberFeedChoice(current, source, next));
  }, []);

  // ── Rendering ────────────────────────────────────────────────────────────

  const view = viewById('search');

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="view-search">
      {/*
        No `action` here. The view's one primary button belongs beside the form
        it submits, next to the sentence explaining why it cannot be pressed —
        a Search button in the corner is a button nobody connects to anything.
      */}
      <ViewHeader view={view.id} title={view.label} summary={view.summary} />

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="max-w-3xl space-y-5">
          <form data-testid="search-form" onSubmit={(event) => void onSubmit(event)}>
            <SearchFields form={form} errors={errors} onField={setField} />

            {/*
              Only once a job-board key exists (L-276). With none, the free
              feeds and the board buttons are the whole search, and the keys
              are one fold down in Settings rather than a row of greyed boxes
              on the first screen. The row's own rule — a board with no key is
              disabled and says why — still holds whenever the row is shown.
            */}
            {hasAnyJobBoardKey(keyStates) ? (
              <div className="mt-3">
                <ProviderToggles
                  keyStates={keyStates}
                  chosen={chosen}
                  onToggle={onToggle}
                  onOpenSettings={onOpenSettings ?? (() => undefined)}
                  disabled={running}
                />
              </div>
            ) : null}

            {/*
              Under the keyed boards, not instead of them. The two are different
              things and the screen says which is which: a search of a job board
              with the user's own free key, and a browse of what two public
              feeds have just published. Neither is presented as a fallback for
              the other.
            */}
            <div className="mt-3">
              <KeylessFeedToggles
                chosen={keylessChosen}
                onToggle={onToggleKeyless}
                arbeitnowOffForUk={
                  feedChoice.arbeitnow === undefined && isUkLocation(form.location)
                }
                disabled={running}
              />
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-3">
              {/*
                The view's ONE blue button. Disabled, never hidden, and the
                reason sits beside it — because a grey button that says nothing
                is where a user's session ends.
              */}
              <button
                type="submit"
                data-testid="search-submit"
                data-primary="true"
                disabled={running || disabledReason !== null}
                className={PRIMARY_BUTTON}
              >
                {/*
                  "Search" (L-219, owner decision 2026-10-08): one action, one
                  name. With boards ticked it says how many tabs it will open
                  (part 4), so pressing it never surprises anybody.
                */}
                {running ? 'Working…' : searchButtonLabel(boardsToOpen.length)}
              </button>

              {disabledReason === null ? null : (
                <p data-testid="search-reason" className="text-ink-muted">
                  {disabledReason}
                </p>
              )}
            </div>

            {boardsProblem.length === 0 ? null : (
              <p
                role="alert"
                data-testid="search-boards-problem"
                className="mt-2 rounded-control bg-danger/5 px-3 py-2 text-danger"
              >
                {`${boardsProblem.join(', ')} did not open in your browser. Check that a default browser is set, then press Search again.`}
              </p>
            )}
          </form>

          {/*
            ALWAYS here, and right under the form (L-219): the same search on
            the whole of a job board is one click away, before anything else.
          */}
          <KeylessBar
            boards={jobBoards}
            ticked={ticked}
            onToggle={onToggleBoard}
            disabled={running}
            onManageBoards={onOpenJobBoards}
          />

          <SearchSaved
            saved={saved}
            suggestedName={suggestedName(form)}
            disabled={running}
            note={savedNote}
            onSave={onSaveSearch}
            onRun={onRunSaved}
            onDelete={onDeleteSaved}
          />

          <SearchRecent recent={recent} onPick={setForm} />

          {reedVerdict.message === null ? null : (
            <p
              data-testid="search-quota-notice"
              data-status={reedVerdict.status}
              className={
                reedVerdict.status === 'blocked'
                  ? 'rounded-control bg-gold/10 px-3 py-2 text-gold-ink'
                  : 'rounded-control bg-sunken px-3 py-2 text-ink-muted'
              }
            >
              {reedVerdict.message}
            </p>
          )}

          {trackedProblem === null ? null : (
            <p data-testid="search-tracked-problem" className="text-xs text-ink-muted">
              {trackedProblem} Saving still works.
            </p>
          )}

          <SearchResultsHeader
            cvText={ranking.cvText}
            rankable={ranking.rankable}
            bestFirst={ranking.bestFirst}
            onBestFirst={ranking.setBestFirst}
            quota={quota}
          />

          <SearchResults
            outcome={outcome}
            keylessOutcome={keylessOutcome}
            results={results}
            ordered={ranking.ordered}
            running={running}
            form={form}
            jobBoards={jobBoards}
            browser={browserPort}
            today={today}
            tracked={tracked}
            savingId={savingId}
            notes={notes}
            problems={problems}
            bands={ranking.bands}
            dealBreakers={ranking.dealBreakers}
            onSave={(jobId) => void onSave(jobId)}
            onOpen={onOpen}
            onAnalyse={onAnalyse === undefined ? undefined : (jobId) => void onAnalyseJob(jobId)}
          />
        </div>
      </div>
    </section>
  );
}
