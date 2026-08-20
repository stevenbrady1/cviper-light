import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

import {
  JOB_PROVIDER_IDS,
  PROVIDER_LABEL,
  REED_DAILY_LIMIT,
  quotaVerdict,
  utcDateOf,
  type JobProviderId,
  type JobSearchOutcome,
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
import { ProviderToggles } from './ProviderToggles';
import { ResultCard } from './ResultCard';
import { readSearchMemory, rememberSearch, writeDraft } from './memory';
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
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<JobSearchOutcome | null>(null);
  const [tracked, setTracked] = useState<ReadonlySet<string>>(new Set());
  const [trackedProblem, setTrackedProblem] = useState<string | null>(null);
  const [notes, setNotes] = useState<CardNotes>({});
  const [problems, setProblems] = useState<CardNotes>({});
  const [savingId, setSavingId] = useState<string | null>(null);
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
  const disabledReason = searchDisabledReason(usableChosen.length);

  const reedVerdict = quotaVerdict(quota, 'reed', utcDateOf(clock) ?? quota.date);

  // ── Actions ──────────────────────────────────────────────────────────────

  const onSubmit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();

      const found = validateForm(form);
      setErrors(found);
      if (!formIsValid(found)) return;
      if (usableChosen.length === 0) return;

      setRunning(true);
      setNotes({});
      setProblems({});

      const utcToday = utcDateOf(clock) ?? quota.date;
      const result = await searchPort.search({
        // Only the boards the user actually ticked. Unticking one really does
        // skip its call — see `searchJobs`, which contacts nothing it is not
        // given.
        providers: usableChosen,
        input: toSearchInput(form),
        quota: readQuota(clock),
        today: utcToday,
        createdAt: clock.toISOString(),
        newId: newId ?? (() => crypto.randomUUID()),
      });

      // Written back straight away. The count is the only warning that can
      // exist — Reed's API reports no remaining balance at all.
      writeQuota(result.quota);
      setQuota(result.quota);
      setRecent(rememberSearch(form).recent);
      setOutcome(result);
      setRunning(false);
    },
    [clock, form, newId, quota.date, searchPort, usableChosen],
  );

  const onSave = useCallback(
    async (jobId: string) => {
      const entry = outcome?.jobs.find((candidate) => candidate.job.id === jobId);
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
    [clock, newId, outcome, searchPort],
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

  // ── Rendering ────────────────────────────────────────────────────────────

  const view = viewById('search');
  const failures = (outcome?.outcomes ?? []).filter((entry) => entry.error !== null);
  const showsAdzuna = (outcome?.jobs ?? []).some((entry) => entry.job.source === 'adzuna');

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
                {running ? 'Searching…' : 'Search'}
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

          {outcome === null ? (
            <div
              data-testid="search-empty"
              className="rounded-card border border-line border-dashed bg-card px-6 py-8 text-center"
            >
              <p className="font-medium text-ink">Nothing searched yet.</p>
              <p className="mt-1 text-ink-muted">
                Type a job title and press Search, or send the same search straight to your browser
                with the buttons above — those need no key at all.
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

              {outcome.jobs.length === 0 && failures.length === 0 ? (
                <p data-testid="search-no-results" className="text-ink-muted">
                  No adverts matched that search. Try broader keywords, a wider radius, or send the
                  same search to your browser with the buttons above.
                </p>
              ) : null}

              <div className="space-y-3">
                {outcome.jobs.map((entry) => {
                  const siblings = clusterSiblings(entry.job.id, outcome.clusters);
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
