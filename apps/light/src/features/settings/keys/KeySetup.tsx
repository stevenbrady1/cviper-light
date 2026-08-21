import { useCallback, useEffect, useMemo, useState } from 'react';

import { QUIET_BUTTON, SECONDARY_BUTTON } from '../../../app/buttons';
import { createTauriBrowserPort, type BrowserPort } from '../../../platform/browser';
import { type KeyState, type SecretKeyName } from '../../../status/environment';

import {
  KEY_PROVIDERS,
  KEY_STATE_LABEL,
  KEY_STATE_TONE,
  TEST_FAILURE_HEADLINE,
  describeMissingCredentials,
  describeTestPass,
  providerKeyState,
  validateCandidate,
  type CandidateErrors,
  type CredentialAnswers,
  type KeyProvider,
} from './model';
import { createTauriKeyPort, type KeyPort } from './port';

/**
 * Setting up a job-board key: one card per board, and no key saved until it has
 * been proved to work.
 *
 * ============================================================================
 * TEST FIRST. THE ORDER IS THE FEATURE, NOT A NICETY.
 * ============================================================================
 * Pressing the button runs a REAL one-result search with the credentials in the
 * boxes, and only writes them to the credential store if the board answers. The
 * failure that prevents is the expensive one: a mistyped key sitting in the
 * store looking configured, a teal dot in the rail agreeing with it, and the
 * user finding out three days later when a search quietly returns nothing.
 *
 * It also means a save can never clobber a working key with a broken one — the
 * old key is still in place for the whole time the new one is being checked.
 *
 * ============================================================================
 * EVERYTHING ON SCREEN COMES FROM `secret_status`
 * ============================================================================
 * There is no reveal affordance, and there could not be one: `secret_get` is a
 * Rust-only function that `generate_handler!` deliberately does not register,
 * so nothing in JavaScript can read a saved key back. Every state here is
 * derived from a bool per credential.
 *
 * That has a consequence for the user, so the card says it out loud rather than
 * leaving them to discover it: a forgotten key is re-pasted, not looked up.
 *
 * ============================================================================
 * NO PRIMARY BUTTON HERE
 * ============================================================================
 * Blue means "this is the thing this screen is for", exactly once per view.
 * Settings already spends it on Export, and there are two boards on this
 * screen — so two blue buttons would leave neither of them primary. Both cards
 * use the secondary treatment and `KeySetup.test.tsx` asserts the count is zero.
 */

/** What a card is doing, and what it has to say about the last thing it did. */
interface CardOutcome {
  /** A confirmation. Rendered as a `status`, never an alert. */
  readonly passed: string | null;
  /** A failure, in the wizard's own words — and only ever those. */
  readonly problem: string | null;
}

const NOTHING: CardOutcome = { passed: null, problem: null };

export interface KeySetupProps {
  /** Injected by tests. Defaults to the real keyring-and-transport port. */
  readonly port?: KeyPort | undefined;
  /** Injected by tests: the real one opens the user's browser. */
  readonly browser?: BrowserPort | undefined;
}

export function KeySetup({ port, browser }: KeySetupProps = {}) {
  // Built once. A new port object every render would restart every card's
  // status effect on every keystroke.
  const keyPort = useMemo(() => port ?? createTauriKeyPort(), [port]);
  const browserPort = useMemo(() => browser ?? createTauriBrowserPort(), [browser]);

  return (
    <section data-testid="key-setup">
      <h2 className="font-medium text-ink">API keys</h2>
      <p className="mt-1 text-ink-muted">
        CViper Light works without any of these. The tracker is entirely offline, the analysis
        screen has a keyword match that needs no account, and the search screen can always hand a
        search to your browser. A key adds one thing: results from that job board inside the app,
        where you can save them to the tracker in one click. Both keys are free.
      </p>

      <div className="mt-4 space-y-4">
        {KEY_PROVIDERS.map((provider) => (
          <KeyCard key={provider.id} provider={provider} port={keyPort} browser={browserPort} />
        ))}
      </div>
    </section>
  );
}

interface KeyCardProps {
  readonly provider: KeyProvider;
  readonly port: KeyPort;
  readonly browser: BrowserPort;
}

function KeyCard({ provider, port, browser }: KeyCardProps) {
  const [answers, setAnswers] = useState<CredentialAnswers>({});
  const [values, setValues] = useState<Partial<Record<SecretKeyName, string>>>({});
  const [errors, setErrors] = useState<CandidateErrors>({});
  const [outcome, setOutcome] = useState<CardOutcome>(NOTHING);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setAnswers(await port.status(provider.id));
  }, [port, provider.id]);

  useEffect(() => {
    let cancelled = false;

    void port.status(provider.id).then((next) => {
      if (!cancelled) setAnswers(next);
    });

    return () => {
      cancelled = true;
    };
  }, [port, provider.id]);

  const state: KeyState = providerKeyState(provider.id, answers);
  const missing = describeMissingCredentials(provider.id, answers);
  const anySaved = provider.fields.some((field) => answers[field.key] === true);

  const onTest = useCallback(async () => {
    setOutcome(NOTHING);

    // Checked here first, so a half-filled form never costs one of Reed's
    // hundred daily requests to find out it was half filled in.
    const found = validateCandidate(provider.id, values);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    const tested = await port.test(provider.id, values);

    if (!tested.ok) {
      setBusy(false);
      // NOTHING is written. The message names what kind of failure it was —
      // a refused key, a connection problem and a rate limit have three
      // different fixes — and that headline is the WHOLE message.
      //
      // `tested.error.message` is dropped, not appended. It is worded for a
      // SEARCH that failed on an already-saved key, so on this card it argues
      // with the screen it is sitting on: it says "the saved key" when
      // test-before-save means nothing was saved, and sends the user to
      // Settings while they are in Settings with the box in front of them.
      // Every arm also repeats advice the headline has just given, in a second
      // wording. That copy is right where it lives
      // (`packages/job-apis/src/errors.ts`) and is not ours to borrow — the
      // card's own heading already names the board, so nothing is lost.
      setOutcome({
        passed: null,
        problem: TEST_FAILURE_HEADLINE[tested.error.kind],
      });
      return;
    }

    // Only now. One credential at a time, and the first refusal stops the rest:
    // a store that refused the App ID will refuse the App Key too, and two
    // identical messages are no more useful than one.
    for (const field of provider.fields) {
      const value = values[field.key] ?? '';
      const written = await port.save(field.key, value);
      if (!written.ok) {
        setBusy(false);
        setOutcome({
          passed: null,
          problem:
            `The key worked, but this computer's credential store would not keep it. ` +
            `${written.error.message} Unlock the store and test again — the label at the top of ` +
            'this card shows what is saved right now.',
        });
        await refresh();
        return;
      }
    }

    // Cleared once it is safely in the store. There is no reason for the value
    // to stay in the DOM afterwards, and one good reason for it not to.
    setValues({});
    setBusy(false);
    setOutcome({ passed: describeTestPass(provider.id, tested.value), problem: null });
    await refresh();
  }, [port, provider, refresh, values]);

  const onRemove = useCallback(async () => {
    setOutcome(NOTHING);
    setBusy(true);

    const removed = await port.remove(provider.id);
    setBusy(false);

    if (!removed.ok) {
      setOutcome({
        passed: null,
        problem: `That key could not be removed. ${removed.error.message}`,
      });
      return;
    }

    setOutcome({
      passed: `Your ${provider.label} key has been removed from this computer's credential store.`,
      problem: null,
    });
    await refresh();
  }, [port, provider.id, provider.label, refresh]);

  return (
    <article
      data-testid={`key-card-${provider.id}`}
      className="rounded-card border border-line bg-card p-4 shadow-raised"
    >
      <header className="flex items-baseline justify-between gap-3">
        <h3 className="font-medium text-ink">{provider.label}</h3>
        {/*
          The state, in words. The dot in the rail is the same fact in colour;
          neither is ever the only telling of it.
        */}
        <span
          data-testid={`key-state-${provider.id}`}
          data-state={state}
          className={`shrink-0 rounded-pill px-2 py-0.5 text-[11px] font-medium ${KEY_STATE_TONE[state]}`}
        >
          {KEY_STATE_LABEL[state]}
        </span>
      </header>

      <p className="mt-1 text-ink-muted">{provider.unlocks}</p>
      <p className="mt-1 text-xs text-ink-faint">{provider.allowance}</p>

      <div className="mt-2">
        <button
          type="button"
          data-testid={`key-signup-${provider.id}`}
          onClick={() => void browser.open(provider.signupUrl)}
          className={`${QUIET_BUTTON} px-0 text-blue hover:bg-card hover:text-navy`}
        >
          {provider.signupLabel} →
        </button>
        <span className="ml-2 text-xs text-ink-faint">Opens in your browser.</span>
      </div>

      {missing === null ? null : (
        // NOT an alert. Half set up is a state to finish, not a fault, and the
        // user is very likely mid-way through doing exactly that.
        <p
          data-testid={`key-missing-${provider.id}`}
          className="mt-3 rounded-control bg-gold/10 px-3 py-2 text-gold"
        >
          {missing}
        </p>
      )}

      <div className="mt-3 space-y-3">
        {provider.fields.map((field) => (
          <div key={field.key}>
            <label
              htmlFor={`key-input-${field.key}`}
              className="block text-xs font-medium text-ink-muted"
            >
              {field.label}
            </label>
            <input
              id={`key-input-${field.key}`}
              data-testid={`key-input-${field.key}`}
              /*
                A password field, with no reveal toggle. The value is a
                credential, this window is the sort of thing people screenshot
                when asking for help, and the Test button answers the question
                a reveal toggle would be for — "did that paste correctly?" —
                far better than reading it back character by character.
              */
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={values[field.key] ?? ''}
              disabled={busy}
              onChange={(event) => {
                const next = event.currentTarget.value;
                setValues((current) => ({ ...current, [field.key]: next }));
                // The error belonged to the old value. Keeping it while the
                // user fixes the thing it complained about is just noise.
                setErrors((current) => ({ ...current, [field.key]: undefined }));
              }}
              className="mt-1 w-full rounded-control border border-line bg-card px-2.5 py-1.5 text-ink"
            />
            <p className="mt-1 text-xs text-ink-faint">{field.hint}</p>

            {errors[field.key] === undefined ? null : (
              <p data-testid={`key-error-${field.key}`} className="mt-1 text-xs text-danger">
                {errors[field.key]}
              </p>
            )}
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          data-testid={`key-test-${provider.id}`}
          disabled={busy}
          onClick={() => void onTest()}
          className={SECONDARY_BUTTON}
        >
          {busy ? 'Checking…' : 'Test and save this key'}
        </button>

        <button
          type="button"
          data-testid={`key-remove-${provider.id}`}
          /*
            Disabled, never hidden. A control that appears and disappears is a
            control the user cannot learn — and "is there a way to remove this?"
            is a question the screen should answer whether or not there is
            anything to remove right now.
          */
          disabled={busy || !anySaved}
          onClick={() => void onRemove()}
          className={QUIET_BUTTON}
        >
          Remove saved key
        </button>
      </div>

      {outcome.passed === null ? null : (
        <p
          role="status"
          data-testid={`key-result-${provider.id}`}
          className="mt-3 rounded-control bg-teal/10 px-3 py-2 text-teal"
        >
          {outcome.passed}
        </p>
      )}

      {outcome.problem === null ? null : (
        <p
          role="alert"
          data-testid={`key-problem-${provider.id}`}
          className="mt-3 rounded-control bg-danger/5 px-3 py-2 text-danger"
        >
          {outcome.problem}
        </p>
      )}

      <p className="mt-3 text-xs text-ink-faint">{provider.privacyNote}</p>
    </article>
  );
}
