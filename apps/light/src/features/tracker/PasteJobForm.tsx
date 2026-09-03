import { useCallback, useEffect, useMemo, useState } from 'react';

import { type ChatTransport } from '@cviper/ai-providers';

import { PRIMARY_BUTTON, QUIET_BUTTON, SECONDARY_BUTTON } from '../../app/buttons';

import { readAvailability as readRealAvailability } from '../analysis/availability';
import { optionByKey, type Availability, type ProviderOption } from '../analysis/providers';

import {
  NO_PROVIDER_NOTE,
  draftFromOutcome,
  draftWithPastedText,
  extractionOptions,
  extractionProgressNote,
} from './extraction';
import { type PageFetchTransport } from './pageFetch';
import { urlOnlyNote, urlOnlyPaste } from './pastedUrl';
import { FETCH_DISCLOSURE, FETCH_SUCCESS_NOTE, runFetch } from './runFetch';
import { runExtraction } from './runExtraction';
import { type ApplicationDraft } from './model';

/**
 * Paste a job advert; a model reads it; YOU check it before anything is saved.
 *
 * ============================================================================
 * THIS COMPONENT CANNOT SAVE ANYTHING. IT HAS NO PORT AND NO WRITE.
 * ============================================================================
 * It hands a filled-in `ApplicationDraft` upwards and stops. The only thing in
 * the tracker that creates a row is `NewApplicationForm`'s submit handler, so
 * an unreviewed extraction has nowhere to go even if somebody wanted it to —
 * there is no code path from here to storage to accidentally take.
 *
 * ============================================================================
 * NO REGEX FALLBACK. DELIBERATELY.
 * ============================================================================
 * With no AI configured this offers a sentence and two ways forward, not a
 * pattern-matched guess. A "title" scraped off the first line of an email is
 * wrong often enough to be worse than an empty box, and it would be wrong
 * INVISIBLY: the review form has no way to mark which fields were guessed, so
 * the user would be checking a form that looks equally confident about all of
 * it. See `extraction.ts`.
 *
 * ============================================================================
 * THE WAIT IS EXPLAINED WHILE IT HAPPENS
 * ============================================================================
 * A local model that is not already resident spends 5-30 seconds loading
 * several gigabytes into memory before it emits a single token. Thirty seconds
 * of a still screen is indistinguishable from a crash, so the wait says what is
 * happening, says why it is slow, and counts. Fetching a page is slower still
 * on a bad connection, and says the same kind of thing for the same reason.
 *
 * ============================================================================
 * THE LINK BOX FILLS THE ADVERT BOX. IT DOES NOT SKIP IT.
 * ============================================================================
 * Fetching and extracting are TWO presses, deliberately. The one-press version
 * would spend thirty seconds of model time before the user had any chance to
 * see that the page came back as "Sign in to continue" — and would put an
 * advert they had never read into a review form. Landing the text in the box
 * they can read and edit costs one click and makes the whole thing inspectable,
 * which is the same argument as the review form itself.
 *
 * It also means the existing paste path is not touched at all: by the time
 * anything is extracted, this component is in exactly the state a paste would
 * have put it in.
 *
 * ============================================================================
 * A LINK IN THE ADVERT BOX IS ANSWERED HERE, NOT BY THE MODEL
 * ============================================================================
 * Pasting the address instead of the advert is the single most likely way to
 * use this screen wrongly — the link box is one field up, and the two boxes
 * look alike. Sent a bare URL a model does not fail; it invents a title from
 * the words in the address and the review form fills with confident fiction.
 *
 * So `urlOnlyPaste` is checked BEFORE the transport factory is touched, the
 * address is lifted into the link box where it belongs, and no request is made
 * to anything. See `pastedUrl.ts` for why the rule is deliberately narrow.
 *
 * ============================================================================
 * FETCHING IS DISCLOSED BEFORE IT CAN BE PRESSED
 * ============================================================================
 * This app tells people everything stays on their machine. Fetching a page is a
 * genuine outbound request to somebody else's server, so `FETCH_DISCLOSURE`
 * sits next to the button, on screen, in ordinary body text — not in a tooltip,
 * not behind a link, not in a settings page. See its comment in `runFetch.ts`.
 */

/** How often the elapsed counter ticks while a model is reading. */
const TICK_MS = 1000;

export interface PasteJobFormProps {
  /**
   * Hand the review form its starting point.
   *
   * `notice` is non-null when the extraction did not work, and the draft still
   * carries the paste — see `draftFromOutcome`. Both cases go through the same
   * callback because both lead to the same screen.
   */
  readonly onExtracted: (draft: ApplicationDraft, notice: string | null) => void;
  readonly onCancel: () => void;
  /** The shell owns which view is showing, so "open Settings" comes back up. */
  readonly onOpenSettings?: (() => void) | undefined;
  /** Injected by tests so a fake provider can answer without a socket. */
  readonly createTransport?: (() => ChatTransport) | undefined;
  /**
   * Injected by tests so a fake page can answer without a socket.
   *
   * Left undefined in the app, where `runFetch` builds the real Tauri
   * transport — and never builds one at all for an empty box, an address in a
   * scheme we do not open, or a domain on the blocklist.
   */
  readonly createPageTransport?: (() => PageFetchTransport) | undefined;
  /** Injected by tests so the machine's real credentials are never consulted. */
  readonly readAvailability?: (() => Promise<Availability>) | undefined;
}

export function PasteJobForm({
  onExtracted,
  onCancel,
  onOpenSettings,
  createTransport,
  createPageTransport,
  readAvailability,
}: PasteJobFormProps) {
  const probe = useMemo(() => readAvailability ?? readRealAvailability, [readAvailability]);

  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [options, setOptions] = useState<readonly ProviderOption[]>([]);
  /** False until the probe answers. Without it the note flashes on every open. */
  const [probed, setProbed] = useState(false);
  const [optionKey, setOptionKey] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [fetching, setFetching] = useState(false);
  /** What the last fetch had to say, or `null`. One slot for both outcomes. */
  const [fetchNote, setFetchNote] = useState<string | null>(null);
  /** Set when the advert box was holding a link. Cleared by the effect below. */
  const [urlNote, setUrlNote] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  /**
   * The link note cannot outlive the paste it was about.
   *
   * An effect rather than a `setUrlNote(null)` in each of the three places that
   * write `text` — the textarea, a successful fetch, and any future fourth one.
   * Clearing it structurally means a new way to change the box cannot forget,
   * and a stale "that is a link" over a real advert would be the guard telling
   * the user something untrue about what is in front of them.
   *
   * It does not fire when the guard itself runs: that sets the note without
   * touching `text`, so this effect's dependency has not changed.
   */
  useEffect(() => {
    setUrlNote(null);
  }, [text]);

  useEffect(() => {
    let cancelled = false;

    void probe().then((availability) => {
      if (cancelled) return;
      const usable = extractionOptions(availability);
      setOptions(usable);
      // Local before cloud, which is the order `providerOptions` already
      // returns: free, private, and it does not spend the user's money.
      setOptionKey(usable[0]?.key ?? null);
      setProbed(true);
    });

    return () => {
      cancelled = true;
    };
  }, [probe]);

  const selected = optionKey === null ? null : optionByKey(options, optionKey);

  /**
   * One counter, shared by both waits.
   *
   * Fetching and extracting cannot happen at once — every control is disabled
   * for the duration of either — so a single elapsed count is unambiguous, and
   * two counters would be two places to forget to reset.
   */
  const busy = running || fetching;

  useEffect(() => {
    if (!busy) return;
    setElapsed(0);
    const timer = window.setInterval(() => setElapsed((seconds) => seconds + 1), TICK_MS);
    return () => window.clearInterval(timer);
  }, [busy]);

  const onExtract = useCallback(async () => {
    if (selected === null || text.trim() === '') return;

    // The advert box is holding a link, not an advert. Checked BEFORE the
    // transport factory is touched, so "no request was made" is provable rather
    // than intended — `urlOnlyPaste.test.tsx` counts transports built and
    // asserts zero. Same arrangement as the blocklist check in `runFetch`.
    const link = urlOnlyPaste(text);
    if (link !== null) {
      // Lift it into the box it belongs in, so the route forward is one press.
      // Only when that box is EMPTY: pre-filling a blank is a convenience,
      // overwriting an address the user typed is taking something away.
      setUrl((current) => (current.trim() === '' ? link.url : current));
      setUrlNote(urlOnlyNote(link));
      return;
    }

    setRunning(true);
    const outcome = await runExtraction({ option: selected, text }, createTransport);
    setRunning(false);

    // Straight to the review form on BOTH paths. A failure is not a dead end:
    // it is the blank form with everything the user pasted still in it — and,
    // now, with whatever address is in the link box, which is a fact the user
    // supplied rather than anything guessed. See `draftFromExtraction`.
    onExtracted(draftFromOutcome(outcome, text, url), outcome.available ? null : outcome.reason);
  }, [createTransport, onExtracted, selected, text, url]);

  /**
   * Go and get the page, and put its text in the box.
   *
   * Everything that could go wrong comes back as one sentence from `runFetch`,
   * so there is no branching on failure here and nothing to forget: a blocked
   * domain, a timeout, a 404 and a login wall all land in the same `else`.
   *
   * The advert box is only written on SUCCESS. Somebody who pasted an advert
   * and then also tried the link must not lose the paste when the link fails.
   */
  const onFetch = useCallback(async () => {
    // Read into a local first: `url` is state, but the guard and the request
    // must be looking at the same string.
    const address = url.trim();
    if (address === '') return;

    setFetching(true);
    setFetchNote(null);
    const outcome = await runFetch(address, createPageTransport);
    setFetching(false);

    if (outcome.available) {
      setText(outcome.text);
      setFetchNote(FETCH_SUCCESS_NOTE);
      return;
    }
    setFetchNote(outcome.reason);
  }, [createPageTransport, url]);

  const nothingConfigured = probed && options.length === 0;
  const emptyPaste = text.trim() === '';

  /** Why the button will not go, or `null`. Always on screen when it applies. */
  const disabledReason = busy
    ? null
    : nothingConfigured
      ? NO_PROVIDER_NOTE
      : emptyPaste
        ? 'Paste the advert above first — the title, the company and the description.'
        : null;

  return (
    <div className="space-y-3" data-testid="paste-job-form">
      {/*
        The link box goes FIRST because it is the shorter road: somebody looking
        at an advert in their browser has the address before they have the text.
        It fills the box below rather than replacing it — see the header.
      */}
      <div>
        <label htmlFor="paste-job-url" className="block text-xs font-medium text-ink-muted">
          Link to the advert
        </label>
        <div className="mt-1 flex items-center gap-2">
          <input
            id="paste-job-url"
            data-testid="paste-job-url"
            type="url"
            inputMode="url"
            value={url}
            disabled={busy}
            placeholder="https://…"
            onChange={(event) => {
              // Read the value NOW — React nulls `currentTarget` the moment
              // this handler returns.
              const next = event.currentTarget.value;
              setUrl(next);
            }}
            className="min-w-0 flex-1 rounded-control border border-line bg-card px-2.5 py-1.5 text-ink"
          />
          {/*
            SECONDARY, not primary. The blue button on this screen is the one
            that reads the advert; fetching is how the advert gets here, not
            what the screen is for.
          */}
          <button
            type="button"
            data-testid="paste-job-fetch"
            disabled={busy || url.trim() === ''}
            onClick={() => void onFetch()}
            className={SECONDARY_BUTTON}
          >
            {fetching ? 'Fetching…' : 'Fetch'}
          </button>
        </div>
        {/*
          On screen, next to the control, before it can be pressed. Not a
          tooltip: a promise about where your data goes is not a hover state.
        */}
        <p data-testid="paste-job-fetch-disclosure" className="mt-1 text-xs text-ink-faint">
          {FETCH_DISCLOSURE}
        </p>
      </div>

      {/*
        One slot for both halves of the wait: what is happening while it
        happens, and what happened afterwards. A fetch on a bad connection is
        fifteen seconds of nothing otherwise, which reads as a crash.
      */}
      {fetching ? (
        <p
          data-testid="paste-job-fetch-progress"
          role="status"
          className="rounded-control bg-sunken px-3 py-2 text-ink-muted"
        >
          Opening that page and reading the advert text out of it.{' '}
          <span className="font-mono tabular-nums">{elapsed}s</span>
        </p>
      ) : fetchNote === null ? null : (
        <p
          data-testid="paste-job-fetch-note"
          role="status"
          className="rounded-control bg-sunken px-3 py-2 text-ink-muted"
        >
          {fetchNote}
        </p>
      )}

      <div>
        <label htmlFor="paste-job-text" className="block text-xs font-medium text-ink-muted">
          The advert
        </label>
        <textarea
          id="paste-job-text"
          data-testid="paste-job-text"
          rows={12}
          value={text}
          disabled={busy}
          placeholder="Paste the whole advert or recruiter email here."
          onChange={(event) => setText(event.currentTarget.value)}
          className="mt-1 w-full rounded-control border border-line bg-card px-2.5 py-1.5 text-ink"
        />
        <p className="mt-1 text-xs text-ink-faint">
          Nothing is saved until you have checked every field on the next screen.
        </p>
      </div>

      {/*
        Sits under the box it is about and above the button that was pressed, so
        the sentence and the thing it refers to are on screen together. A
        STATUS, not an alert: nothing is broken, nobody did anything wrong, and
        the address has already been moved somewhere useful.
      */}
      {urlNote === null ? null : (
        <p
          data-testid="paste-job-url-only-note"
          role="status"
          className="rounded-control bg-sunken px-3 py-2 text-ink-muted"
        >
          {urlNote}
        </p>
      )}

      {/*
        The picker only appears when there is a choice to make. One installed
        model is not a decision, and a dropdown with one entry is a control that
        asks the user to confirm something they cannot change.
      */}
      {options.length > 1 ? (
        <div>
          <label htmlFor="paste-job-provider" className="block text-xs font-medium text-ink-muted">
            Read it with
          </label>
          <select
            id="paste-job-provider"
            data-testid="paste-job-provider"
            value={optionKey ?? ''}
            disabled={busy}
            onChange={(event) => {
              // Read the value NOW — React nulls `currentTarget` the moment
              // this handler returns.
              const key = event.currentTarget.value;
              setOptionKey(key);
            }}
            className="mt-1 w-full rounded-control border border-line bg-card px-2.5 py-1.5 text-ink"
          >
            {options.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      ) : selected === null ? null : (
        <p data-testid="paste-job-provider-note" className="text-xs text-ink-faint">
          Read with {selected.label}.
        </p>
      )}

      <div className="flex items-center gap-2">
        {/*
          The view's ONE blue button while this pane is open — the header's
          "Add application" is disabled for exactly as long as it is. DISABLED
          rather than hidden: a control that comes and goes is a control the
          user cannot learn.
        */}
        <button
          type="button"
          data-testid="paste-job-extract"
          data-primary="true"
          disabled={busy || nothingConfigured || emptyPaste}
          onClick={() => void onExtract()}
          className={PRIMARY_BUTTON}
        >
          {running ? 'Reading the advert…' : 'Read the advert'}
        </button>

        {/*
          Always available, and never framed as giving up. Adding a job by hand
          is a first-class way to use this app — and this button is the one that
          rescues the paste when there is no AI at all to read it.
        */}
        <button
          type="button"
          data-testid="paste-job-manual"
          disabled={busy}
          onClick={() => onExtracted(draftWithPastedText(text, url), null)}
          className={SECONDARY_BUTTON}
        >
          Fill it in myself
        </button>

        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-control px-3 py-1.5 text-ink-muted hover:bg-sunken hover:text-ink"
        >
          Cancel
        </button>
      </div>

      {disabledReason === null ? null : (
        <div className="flex flex-wrap items-center gap-2">
          {/*
            Not an alert. A machine with no AI on it is the default state of a
            freshly installed app, and everything else on this screen works.
          */}
          <p data-testid="paste-job-reason" className="text-xs text-ink-faint">
            {disabledReason}
          </p>
          {nothingConfigured && onOpenSettings !== undefined ? (
            <button
              type="button"
              data-testid="paste-job-settings"
              onClick={onOpenSettings}
              className={`${QUIET_BUTTON} px-0 text-xs text-blue hover:bg-card hover:text-navy`}
            >
              Open Settings →
            </button>
          ) : null}
        </div>
      )}

      {running && selected !== null ? (
        <p
          data-testid="paste-job-progress"
          role="status"
          className="rounded-control bg-sunken px-3 py-2 text-ink-muted"
        >
          {extractionProgressNote(selected)}{' '}
          <span className="font-mono tabular-nums">{elapsed}s</span>
        </p>
      ) : null}
    </div>
  );
}
