import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

import {
  ARBEITNOW_ATTRIBUTION,
  JOB_PROVIDER_IDS,
  KEYLESS_SOURCE_IDS,
  PROVIDER_LABEL,
  REED_DAILY_LIMIT,
  quotaVerdict,
  utcDateOf,
  type JobProviderId,
  type JobSearchOutcome,
  type KeylessBrowseOutcome,
  type KeylessSourceId,
  type QuotaState,
} from '@cviper/job-apis';

import { PRIMARY_BUTTON, QUIET_BUTTON } from '../../app/buttons';
import { ViewHeader } from '../../app/ViewHeader';
import { viewById } from '../../app/views';
import { SHIPPED_BOARDS } from '../boards/defaults';
import { NO_PREFERENCES, mergeBoards, type Board } from '../boards/model';
import { createTauriBoardPreferencesPort, type BoardPreferencesPort } from '../boards/port';
import { readQuota, writeQuota } from '../../jobs/quotaStore';
import { todayIsoDate } from '../../lib/dates';
import { createTauriBrowserPort, type BrowserPort } from '../../platform/browser';
import { readJobKeyStates, type KeyState } from '../../status/environment';

import { KeylessBar } from './KeylessBar';
import { KeylessFeedToggles } from './KeylessFeedToggles';
import { ProviderToggles } from './ProviderToggles';
import { ResultCard } from './ResultCard';
import { readSearchMemory, rememberSearch, writeDraft } from './memory';
import { combineResults, nothingMatchedNote, submitLabel } from './keylessModel';
import { dealBreakersIn, isScorable, rankResult, sortByBand, type RankBand } from './rank';
import {
  CONTRACT_CHOICES,
  EMPTY_FORM,
  clusterSiblings,
  externalKey,
  formIsValid,
  providerAvailability,
  searchDisabledReason,
  toSearchInput,
  validateForm,
  type ContractChoice,
  type FormErrors,
  type SearchForm,
} from './model';
import { createDbSearchPort, type SearchPort } from './port';

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

/** What happened the last time Save was pressed, per advert. */
type CardNotes = Readonly<Record<string, string>>;

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
}

export function Search({
  port,
  browser,
  boardsPort,
  readKeyStates,
  now,
  newId,
  onOpenSettings,
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
  */
  const [keylessChosen, setKeylessChosen] = useState<ReadonlySet<KeylessSourceId>>(
    new Set(KEYLESS_SOURCE_IDS),
  );
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<JobSearchOutcome | null>(null);
  const [keylessOutcome, setKeylessOutcome] = useState<KeylessBrowseOutcome | null>(null);
  const [tracked, setTracked] = useState<ReadonlySet<string>>(new Set());
  const [trackedProblem, setTrackedProblem] = useState<string | null>(null);
  const [notes, setNotes] = useState<CardNotes>({});
  const [problems, setProblems] = useState<CardNotes>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [quota, setQuota] = useState<QuotaState>(() => readQuota(now ?? new Date()));
  /*
    `undefined` until the port has answered, so the screen draws NEITHER the
    toggle nor the "upload a CV" hint for the half-second before it knows —
    a hint that flashes and vanishes on every open would be read as a bug.
  */
  const [cvText, setCvText] = useState<string | null | undefined>(undefined);
  const [dealBreakers, setDealBreakers] = useState<readonly string[]>([]);
  const [bestFirst, setBestFirst] = useState(true);
  /*
    Seeded with the SHIPPED list rather than an empty one, so the buttons are
    there on the first paint instead of appearing a moment later. The user's own
    list replaces it as soon as the store answers; if the store cannot be read
    the shipped list is what stays, which is the whole point of a default layer.
  */
  const [jobBoards, setJobBoards] = useState<readonly Board[]>(() =>
    mergeBoards(SHIPPED_BOARDS, NO_PREFERENCES),
  );

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

    void searchPort.loadTracked().then((loaded) => {
      if (cancelled) return;
      if (!loaded.ok) {
        // Deliberately NOT an alert. What is lost is the "already in your
        // tracker" label; saving still works and reports its own failure if it
        // hits one. A red banner over a screen that otherwise works perfectly
        // would be the larger error.
        setTrackedProblem(
          `CViper could not check which adverts are already in your tracker. ${loaded.error.message}`,
        );
        return;
      }
      setTracked(loaded.value);
    });

    return () => {
      cancelled = true;
    };
  }, [searchPort]);

  useEffect(() => {
    let cancelled = false;

    /*
      Two reads, once, and SILENT on failure. What is lost if either fails is
      the band on each card and the deal-breaker chips; the search itself is
      untouched, and a banner saying "could not read your CV" over a working
      search screen would be the larger error. `null` on failure means the
      screen shows the same quiet hint it shows when there is no CV — which is
      true enough: there is no CV it can rank against.
    */
    void searchPort.latestCvText().then((loaded) => {
      if (cancelled) return;
      setCvText(loaded.ok ? loaded.value : null);
    });
    void searchPort.dealBreakers().then((loaded) => {
      if (cancelled) return;
      setDealBreakers(loaded.ok ? loaded.value : []);
    });

    return () => {
      cancelled = true;
    };
  }, [searchPort]);

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
  const disabledReason = searchDisabledReason(usableChosen.length + keylessWanted.length);

  const reedVerdict = quotaVerdict(quota, 'reed', utcDateOf(clock) ?? quota.date);

  /*
    One list of adverts out of the two halves, with cross-posts looked for
    ACROSS them — the same role on Adzuna and on a free feed is exactly the
    pair worth flagging, and neither half can see it alone. Nothing is merged
    and nothing is removed; see `keylessModel.ts`.
  */
  const results = useMemo(() => combineResults(outcome, keylessOutcome), [outcome, keylessOutcome]);

  /*
    Is there a CV worth ranking against? A CV shorter than the scorer accepts
    counts as none: the toggle would otherwise sit there over a list with no
    bands on it, and the hint says the true thing — upload a CV.
  */
  const rankable = cvText !== undefined && isScorable(cvText);

  /*
    One band per advert, computed ONCE per list rather than once per render:
    the scorer is a few hundred regex tests per advert, and this runs over a
    whole page of results. Keyed by advert id so the sort and the cards read
    the same map. `null` entries are "no pill", never "weak" — see `rank.ts`.
  */
  const bands = useMemo(() => {
    const computed = new Map<string, RankBand | null>();
    for (const item of results.jobs) {
      computed.set(item.job.id, rankable ? rankResult(cvText, item.job) : null);
    }
    return computed;
  }, [cvText, rankable, results]);

  const ordered = useMemo(
    () => (rankable && bestFirst ? sortByBand(results.jobs, bands) : results.jobs),
    [bands, bestFirst, rankable, results],
  );

  // ── Actions ──────────────────────────────────────────────────────────────

  const onSubmit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();

      /*
        The "type something first" rule belongs to the KEYED half only. Adzuna
        and Reed are query endpoints and an empty form is a mistake to point at;
        the free feeds take no query at all, so browsing what they have just
        published with both boxes empty is the most natural thing a new user
        does. See `ValidateOptions` in model.ts.
      */
      const found = validateForm(form, { requireQuery: usableChosen.length > 0 });
      setErrors(found);
      if (!formIsValid(found)) return;
      if (usableChosen.length === 0 && keylessWanted.length === 0) return;

      setRunning(true);
      setNotes({});
      setProblems({});

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
              input: toSearchInput(form),
              quota: readQuota(clock),
              today: utcToday,
              createdAt,
              newId: nextId,
            }),
        keylessWanted.length === 0
          ? Promise.resolve(null)
          : searchPort.browseKeyless({
              sources: keylessWanted,
              // The feeds cannot filter, so this narrows what comes back, HERE,
              // on this machine. Nothing typed below ever leaves the process.
              filter: { keywords: form.keywords.trim(), location: form.location.trim() },
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
      setRecent(rememberSearch(form).recent);
      setOutcome(keyed);
      setKeylessOutcome(keyless);
      setRunning(false);
    },
    [clock, form, keylessWanted, newId, quota.date, searchPort, usableChosen],
  );

  const onSave = useCallback(
    async (jobId: string) => {
      const entry = results.jobs.find((candidate) => candidate.job.id === jobId);
      if (entry === undefined) return;

      setSavingId(jobId);
      setProblems((current) => ({ ...current, [jobId]: '' }));

      const saved = await searchPort.saveToTracker(
        entry.job,
        { applicationId: (newId ?? (() => crypto.randomUUID()))() },
        clock.toISOString(),
      );
      setSavingId(null);

      if (!saved.ok) {
        setProblems((current) => ({
          ...current,
          [jobId]: `That advert could not be saved. ${saved.error.message}`,
        }));
        return;
      }

      const key = externalKey(entry.job.source, entry.job.external_id);
      if (key !== null) setTracked((current) => new Set(current).add(key));

      setNotes((current) => ({
        ...current,
        [jobId]:
          saved.value === 'already-saved'
            ? // NOT an error. The same advert reached the user twice, which is
              // exactly what cross-posting looks like, and the database already
              // has it. Nothing is duplicated and nothing has gone wrong.
              'That advert is already in your tracker — nothing has been added twice.'
            : 'Saved to your tracker, under “Saved”.',
      }));
    },
    [clock, newId, results, searchPort],
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
    setKeylessChosen((current) => {
      const updated = new Set(current);
      if (next) updated.add(source);
      else updated.delete(source);
      return updated;
    });
  }, []);

  // ── Rendering ────────────────────────────────────────────────────────────

  const view = viewById('search');
  const failures = (outcome?.outcomes ?? []).filter((entry) => entry.error !== null);
  /*
    ============================================================================
    A FEED THAT FAILED GETS A LINE OF ITS OWN. THIS IS THE POINT OF L-110.
    ============================================================================
    Free feeds rot: they move, they change shape, they get switched off. Every
    one of those failures reaches this screen as an empty list unless it is
    rendered, and an empty list reads as "there are no jobs like that" — a
    sentence the user cannot question and cannot act on.

    So `keylessFailures` is drawn above the results, exactly like the keyed
    boards' failures, and `nothingMatched` is a SEPARATE and differently worded
    line for the case where the feed worked and the filter matched none of what
    it published. Blurring the two is the bug this feature exists to prevent.
  */
  const keylessFailures = (keylessOutcome?.outcomes ?? []).filter((entry) => entry.error !== null);
  const nothingMatched = (keylessOutcome?.outcomes ?? [])
    .map((entry) => ({ source: entry.source, note: nothingMatchedNote(entry) }))
    .filter((entry): entry is { source: KeylessSourceId; note: string } => entry.note !== null);

  const showsAdzuna = results.jobs.some((entry) => entry.job.source === 'adzuna');
  // Arbeitnow's own terms ask for a link back to the site, so their credit is
  // shown wherever their adverts are — the same treatment Adzuna's terms get.
  const showsArbeitnow = results.jobs.some((entry) => entry.job.source === 'arbeitnow');

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="view-search">
      {/*
        No `action` here. The view's one primary button belongs beside the form
        it submits, next to the sentence explaining why it cannot be pressed —
        a Search button in the corner is a button nobody connects to anything.
      */}
      <ViewHeader title={view.label} summary={view.summary} />

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="max-w-3xl space-y-5">
          <form data-testid="search-form" onSubmit={(event) => void onSubmit(event)}>
            <div className="flex flex-wrap gap-3">
              <Field
                id="search-keywords"
                label="Job title or keywords"
                value={form.keywords}
                error={errors.keywords}
                onChange={(value) => setField('keywords', value)}
                placeholder="Credit risk analyst"
                grow
              />
              <Field
                id="search-location"
                label="Location"
                value={form.location}
                error={errors.location}
                onChange={(value) => setField('location', value)}
                placeholder="London"
                grow
              />
            </div>

            <div className="mt-3 flex flex-wrap gap-3">
              <Field
                id="search-distance"
                label="Within (miles)"
                value={form.distanceMiles}
                error={errors.distanceMiles}
                onChange={(value) => setField('distanceMiles', value)}
                placeholder="Any"
              />
              <Field
                id="search-salary"
                label="Minimum salary (£)"
                value={form.salaryMin}
                error={errors.salaryMin}
                onChange={(value) => setField('salaryMin', value)}
                placeholder="Any"
              />

              <div className="min-w-0">
                <label
                  htmlFor="search-contract"
                  className="block text-xs font-medium text-ink-muted"
                >
                  Contract type
                </label>
                <select
                  id="search-contract"
                  data-testid="search-contract"
                  value={form.contractType}
                  onChange={(event) =>
                    setField('contractType', event.currentTarget.value as ContractChoice)
                  }
                  className="mt-1 rounded-control border border-line bg-card px-2.5 py-1.5 text-ink"
                >
                  {CONTRACT_CHOICES.map((choice) => (
                    <option key={choice.value} value={choice.value}>
                      {choice.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-3">
              <ProviderToggles
                keyStates={keyStates}
                chosen={chosen}
                onToggle={onToggle}
                onOpenSettings={onOpenSettings ?? (() => undefined)}
                disabled={running}
              />
            </div>

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
                {running ? 'Working…' : submitLabel(usableChosen.length, keylessWanted.length)}
              </button>

              {disabledReason === null ? null : (
                <p data-testid="search-reason" className="text-ink-muted">
                  {disabledReason}
                </p>
              )}
            </div>
          </form>

          {recent.length === 0 ? null : (
            <div data-testid="search-recent" className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-ink-faint">Recent</span>
              {recent.map((entry, index) => (
                <button
                  key={`${entry.keywords}|${entry.location}|${index}`}
                  type="button"
                  data-testid={`search-recent-${index}`}
                  /*
                    Fills the boxes and stops. It does NOT search: a click that
                    silently spent one of Reed's hundred would be the same
                    mistake as searching on startup.
                  */
                  onClick={() => setForm(entry)}
                  className={`${QUIET_BUTTON} rounded-pill border border-line px-2 py-0.5 text-xs`}
                >
                  {[entry.keywords, entry.location].filter((part) => part !== '').join(' · ')}
                </button>
              ))}
            </div>
          )}

          {/* ALWAYS here. Not a fallback, not an error state. */}
          <KeylessBar form={form} browser={browserPort} boards={jobBoards} />

          <div data-testid="search-quota" className="text-xs text-ink-faint">
            Requests today — {PROVIDER_LABEL.reed}{' '}
            <span className="font-mono tabular-nums">{quota.counts.reed}</span> of{' '}
            <span className="font-mono tabular-nums">{REED_DAILY_LIMIT}</span> ·{' '}
            {PROVIDER_LABEL.adzuna}{' '}
            <span className="font-mono tabular-nums">{quota.counts.adzuna}</span>{' '}
            {/*
              A bare count for Adzuna, with no denominator. Their allowance
              depends on the plan the user bought and cannot be queried, so any
              figure here would be a confident wrong number on screen for ever.
              Counted, shown, never enforced.
            */}
            (allowance depends on your plan)
          </div>

          {reedVerdict.message === null ? null : (
            <p
              data-testid="search-quota-notice"
              data-status={reedVerdict.status}
              className={
                reedVerdict.status === 'blocked'
                  ? 'rounded-control bg-gold/10 px-3 py-2 text-gold'
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

          {/*
            The toggle when there is a CV to rank against; one quiet line when
            there is not; NOTHING until the port has said which. The toggle is
            hidden rather than disabled because a disabled "Best match first"
            with no explanation is a promise the screen is visibly not keeping.
          */}
          {cvText === undefined ? null : rankable ? (
            <label className="flex items-center gap-2 text-ink-muted">
              <input
                type="checkbox"
                data-testid="search-sort-best"
                checked={bestFirst}
                onChange={(event) => setBestFirst(event.currentTarget.checked)}
              />
              Best match first
            </label>
          ) : (
            <p data-testid="search-rank-hint" className="text-xs text-ink-faint">
              Upload a CV on the Analysis screen and results will be ranked against it.
            </p>
          )}

          {/*
            One line per board that failed, ABOVE results that are still there.
            Losing a whole page of Adzuna adverts because Reed was down is the
            failure this shape exists to prevent.
          */}
          {failures.map((entry) => (
            <p
              key={entry.provider}
              role="alert"
              data-testid={`search-error-${entry.provider}`}
              data-kind={entry.error?.kind}
              className="rounded-control bg-danger/5 px-3 py-2 text-danger"
            >
              {entry.error?.message}
            </p>
          ))}

          {/*
            One line per FEED that failed, in exactly the same place and shape.
            A 404, a feed that changed its payload, and a feed that answered
            with no jobs at all are three different sentences and all three are
            failures — none of them may reach the user as an empty list.
          */}
          {keylessFailures.map((entry) => (
            <p
              key={entry.source}
              role="alert"
              data-testid={`keyless-error-${entry.source}`}
              data-kind={entry.error?.kind}
              className="rounded-control bg-danger/5 px-3 py-2 text-danger"
            >
              {entry.error?.message}
            </p>
          ))}

          {/*
            NOT an alert, and deliberately worded so it cannot be mistaken for
            one: the feed answered, it published N jobs, and none of them
            matched. The only thing to change is what the user typed, and this
            is the one line on the screen that says so.
          */}
          {nothingMatched.map((entry) => (
            <p
              key={entry.source}
              data-testid={`keyless-nothing-matched-${entry.source}`}
              className="rounded-control bg-sunken px-3 py-2 text-ink-muted"
            >
              {entry.note}
            </p>
          ))}

          {!results.ran ? (
            <div
              data-testid="search-empty"
              className="rounded-card border border-line border-dashed bg-card px-6 py-8 text-center"
            >
              <p className="font-medium text-ink">Nothing looked at yet.</p>
              <p className="mt-1 text-ink-muted">
                Type a job title and press the button — the two free feeds need no key at all. Or
                send the same words straight to a job site in your browser with the buttons above.
              </p>
            </div>
          ) : (
            <>
              {showsAdzuna ? (
                // Attribution, wherever Adzuna's data appears. A condition of
                // their API terms, and it belongs on screen rather than in a
                // licence file nobody opens.
                <p data-testid="adzuna-attribution" className="text-xs text-ink-faint">
                  Jobs from Adzuna
                </p>
              ) : null}

              {showsArbeitnow ? (
                // The same, for Arbeitnow, whose own `meta.terms` say "I would
                // appreciate linking back to the site". Every card also keeps
                // its link to their page for that advert.
                <p data-testid="arbeitnow-attribution" className="text-xs text-ink-faint">
                  {ARBEITNOW_ATTRIBUTION}
                </p>
              ) : null}

              {results.jobs.length === 0 &&
              failures.length === 0 &&
              keylessFailures.length === 0 &&
              nothingMatched.length === 0 ? (
                <p data-testid="search-no-results" className="text-ink-muted">
                  No adverts matched that. Try broader keywords, a wider radius, or send the same
                  words to your browser with the buttons above.
                </p>
              ) : null}

              <div className="space-y-3">
                {ordered.map((entry) => {
                  const siblings = clusterSiblings(entry.job.id, results.clusters);
                  const key = externalKey(entry.job.source, entry.job.external_id);

                  return (
                    <ResultCard
                      key={entry.job.id}
                      entry={entry}
                      today={today}
                      clusterSize={siblings === null ? null : siblings.length}
                      tracked={key !== null && tracked.has(key)}
                      busy={savingId === entry.job.id}
                      note={notes[entry.job.id] || null}
                      problem={problems[entry.job.id] || null}
                      rank={bands.get(entry.job.id) ?? null}
                      dealBreakers={dealBreakersIn(dealBreakers, entry.job)}
                      onSave={() => void onSave(entry.job.id)}
                      onOpen={() => onOpen(entry.job.url)}
                    />
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

interface FieldProps {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly error: string | undefined;
  readonly placeholder: string;
  readonly onChange: (value: string) => void;
  readonly grow?: boolean;
}

function Field({ id, label, value, error, placeholder, onChange, grow = false }: FieldProps) {
  return (
    <div className={grow ? 'min-w-0 flex-1' : 'min-w-0'}>
      <label htmlFor={id} className="block text-xs font-medium text-ink-muted">
        {label}
      </label>
      <input
        id={id}
        data-testid={id}
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.currentTarget.value)}
        className="mt-1 w-full rounded-control border border-line bg-card px-2.5 py-1.5 text-ink"
      />
      {error === undefined ? null : (
        <p data-testid={`${id}-error`} className="mt-1 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
