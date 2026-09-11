import { useCallback, useEffect, useMemo, useState } from 'react';

import { QUIET_BUTTON, SECONDARY_BUTTON } from '../../../app/buttons';
import { combineKeyState, type KeyState } from '../../../status/environment';

import {
  AI_KEY_PASS,
  AI_KEY_REMOVED,
  AI_KEY_SAVE_REFUSED,
  OPENAI_KEY_PROVIDER,
  normaliseAiKey,
  validateAiKey,
} from './aiKeyModel';
import { createTauriAiKeyPort, type AiKeyPort } from './aiKeyPort';
import { KEY_STATE_LABEL, KEY_STATE_TONE } from './model';

/**
 * Setting up the OpenAI key: one card, and no key saved until OpenAI has
 * accepted it.
 *
 * ============================================================================
 * TEST FIRST. THE ORDER IS THE FEATURE, NOT A NICETY.
 * ============================================================================
 * Pressing the button sends the key in the box to OpenAI — a single cheap
 * metadata request — and only writes it to the credential store if OpenAI
 * answers. The failure that prevents is the expensive one: a mistyped key
 * sitting in the store looking configured, the analysis screen offering
 * "OpenAI" on the strength of it, and the user finding out after a thirty-second
 * wait that the answer is a 401.
 *
 * It also means a save can never clobber a working key with a broken one — the
 * old key is still in place for the whole time the new one is being checked.
 *
 * ============================================================================
 * WHAT COMES BACK OUT, AND WHAT DOES NOT
 * ============================================================================
 * The key itself never returns to JavaScript: `secret_get` is Rust-only and
 * `generate_handler!` does not register it. What this card shows is
 * `secret_hint` — bullets and at most the last four characters, computed in
 * Rust — so somebody with two OpenAI keys can tell which one is in the store
 * without the app ever holding the value.
 *
 * ============================================================================
 * NO PRIMARY BUTTON HERE
 * ============================================================================
 * Blue means "this is the thing this screen is for", exactly once per view, and
 * Settings already spends it on Export. `Settings.test.tsx` counts the enabled
 * primaries and expects exactly one.
 */

/** What the card is doing, and what it has to say about the last thing it did. */
interface CardOutcome {
  /** A confirmation. Rendered as a `status`, never an alert. */
  readonly passed: string | null;
  /** A failure, in the sentence Rust chose — and only ever that. */
  readonly problem: string | null;
}

const NOTHING: CardOutcome = { passed: null, problem: null };

export interface AiKeySetupProps {
  /** Injected by tests. Defaults to the real keyring-and-transport port. */
  readonly port?: AiKeyPort | undefined;
}

export function AiKeySetup({ port }: AiKeySetupProps = {}) {
  // Built once. A new port object every render would restart the status effect
  // on every keystroke.
  const keyPort = useMemo(() => port ?? createTauriAiKeyPort(), [port]);

  const provider = OPENAI_KEY_PROVIDER;

  const [answer, setAnswer] = useState<boolean | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<CardOutcome>(NOTHING);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    // Concurrently: the hint is a convenience and must not delay the state the
    // card actually renders from.
    const [saved, masked] = await Promise.all([keyPort.status(), keyPort.hint()]);
    setAnswer(saved);
    setHint(masked);
  }, [keyPort]);

  useEffect(() => {
    let cancelled = false;

    void Promise.all([keyPort.status(), keyPort.hint()]).then(([saved, masked]) => {
      if (cancelled) return;
      setAnswer(saved);
      setHint(masked);
    });

    return () => {
      cancelled = true;
    };
  }, [keyPort]);

  // A credential nobody has asked about yet reads as `null` — unreadable — not
  // as `false`. The card would otherwise claim "not set up" for the half-second
  // before the first answer arrives, which is the one moment a user is most
  // likely to be looking at it.
  const state: KeyState = combineKeyState([answer]);

  const onTest = useCallback(async () => {
    setOutcome(NOTHING);

    // Checked here first, so a blank box never costs a round trip to OpenAI to
    // find out it was blank.
    const problem = validateAiKey(value);
    setFieldError(problem);
    if (problem !== null) return;

    // Trimmed ONCE, here, so the value that was tested is byte-identical to the
    // value that gets saved. A pasted key very often carries a trailing
    // newline, which cannot go in an HTTP header at all.
    const key = normaliseAiKey(value);

    setBusy(true);
    const tested = await keyPort.test(key);

    if (!tested.ok) {
      setBusy(false);
      // NOTHING is written. The message is the one Rust chose — a refused key,
      // a connection problem and a rate limit have three different fixes, and
      // it is the transport that knows which happened.
      setOutcome({ passed: null, problem: tested.error.message });
      return;
    }

    const written = await keyPort.save(key);
    if (!written.ok) {
      setBusy(false);
      setOutcome({
        passed: null,
        problem: `${AI_KEY_SAVE_REFUSED} ${written.error.message}`,
      });
      await refresh();
      return;
    }

    // Cleared once it is safely in the store. There is no reason for the value
    // to stay in the DOM afterwards, and one good reason for it not to.
    setValue('');
    setBusy(false);
    setOutcome({ passed: AI_KEY_PASS, problem: null });
    await refresh();
  }, [keyPort, refresh, value]);

  const onRemove = useCallback(async () => {
    setOutcome(NOTHING);
    setBusy(true);

    const removed = await keyPort.remove();
    setBusy(false);

    if (!removed.ok) {
      setOutcome({
        passed: null,
        problem: `That key could not be removed. ${removed.error.message}`,
      });
      return;
    }

    setOutcome({ passed: AI_KEY_REMOVED, problem: null });
    await refresh();
  }, [keyPort, refresh]);

  return (
    <section data-testid="ai-key-setup">
      <h2 className="font-medium text-ink">OpenAI key</h2>
      <p className="mt-1 text-ink-muted">
        Optional. The analysis screen already has a keyword match that needs no account, and the
        tracker is entirely offline. A key adds one thing: a full reading of your CV against an
        advert by a model that understands both.
      </p>

      <article
        data-testid="ai-key-card-openai"
        className="mt-4 rounded-card border border-line bg-card p-4 shadow-raised"
      >
        <header className="flex items-baseline justify-between gap-3">
          <h3 className="font-medium text-ink">{provider.label}</h3>
          <span
            data-testid="ai-key-state-openai"
            data-state={state}
            className={`shrink-0 rounded-pill px-2 py-0.5 text-[11px] font-medium ${KEY_STATE_TONE[state]}`}
          >
            {KEY_STATE_LABEL[state]}
          </span>
        </header>

        <p className="mt-1 text-ink-muted">{provider.unlocks}</p>
        <p className="mt-1 text-xs text-ink-faint">{provider.billing}</p>

        {/*
          The masked hint. Bullets and at most four characters, computed in Rust
          — enough to tell two keys apart, and not enough to be one.
        */}
        {hint === null ? null : (
          <p data-testid="ai-key-hint-openai" className="mt-2 text-xs text-ink-muted">
            Saved <span className="font-mono tabular-nums">{hint}</span>
          </p>
        )}

        <div className="mt-3">
          <label htmlFor="ai-key-input-openai" className="block text-xs font-medium text-ink-muted">
            {provider.fieldLabel}
          </label>
          <input
            id="ai-key-input-openai"
            data-testid="ai-key-input-openai"
            /*
              A password field, with no reveal toggle. The value is a credential,
              this window is the sort of thing people screenshot when asking for
              help, and the Test button answers the question a reveal toggle
              would be for — "did that paste correctly?" — far better than
              reading it back character by character.
            */
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={value}
            disabled={busy}
            onChange={(event) => {
              setValue(event.currentTarget.value);
              // The error belonged to the old value. Keeping it while the user
              // fixes the thing it complained about is just noise.
              setFieldError(null);
            }}
            className="mt-1 w-full rounded-control border border-line bg-card px-2.5 py-1.5 text-ink"
          />
          <p className="mt-1 text-xs text-ink-faint">{provider.fieldHint}</p>
          <p className="mt-1 text-xs text-ink-faint">{provider.whereFrom}</p>

          {fieldError === null ? null : (
            <p data-testid="ai-key-error-openai" className="mt-1 text-xs text-danger">
              {fieldError}
            </p>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="ai-key-test-openai"
            disabled={busy}
            onClick={() => void onTest()}
            className={SECONDARY_BUTTON}
          >
            {busy ? 'Checking…' : 'Test and save this key'}
          </button>

          <button
            type="button"
            data-testid="ai-key-remove-openai"
            /*
              Disabled, never hidden. A control that appears and disappears is a
              control the user cannot learn.
            */
            disabled={busy || answer !== true}
            onClick={() => void onRemove()}
            className={QUIET_BUTTON}
          >
            Remove saved key
          </button>
        </div>

        {outcome.passed === null ? null : (
          <p
            role="status"
            data-testid="ai-key-result-openai"
            className="mt-3 rounded-control bg-teal/10 px-3 py-2 text-teal"
          >
            {outcome.passed}
          </p>
        )}

        {outcome.problem === null ? null : (
          <p
            role="alert"
            data-testid="ai-key-problem-openai"
            className="mt-3 rounded-control bg-danger/5 px-3 py-2 text-danger"
          >
            {outcome.problem}
          </p>
        )}

        <p className="mt-3 text-xs text-ink-faint">{provider.privacyNote}</p>
      </article>
    </section>
  );
}
