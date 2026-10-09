import { useCallback, useEffect, useMemo, useState } from 'react';

import { type ModelInfo } from '@cviper/ai-providers';

import { QUIET_BUTTON, SECONDARY_BUTTON } from '../../../app/buttons';
import { type KeyState } from '../../../status/environment';
import {
  chooseCustomModel,
  forgetCustomModel,
  normaliseCustomModel,
  readCustomModel,
} from '../../analysis/customModel';

import {
  createTauriCustomServicePort,
  type CustomServicePort,
  type CustomServiceStatus,
} from './customServicePort';
import { KEY_STATE_TONE } from './model';

/**
 * Any OpenAI-compatible AI service, at an address the user types (L-150).
 *
 * ============================================================================
 * THE ADDRESS AND THE KEY ARE TESTED AND SAVED TOGETHER
 * ============================================================================
 * One button. Rust tests the pair with a real request and saves it only if it
 * works, as ONE entry, so the key can only ever go to the address it was saved
 * with (`custom_provider.rs`). Nothing is written when the test fails, and
 * what was typed stays in the boxes so it can be fixed.
 *
 * ============================================================================
 * THE TICK BOX IS THE ONLY WAY TO THE USER'S OWN NETWORK
 * ============================================================================
 * Without it, an address must be https and on the internet. With it, it must
 * be on this computer or the user's own network, may be plain http, and may
 * need no key. Rust enforces both on every call; this card only says so.
 *
 * ============================================================================
 * THE KEY IS NEVER DRAWN
 * ============================================================================
 * The saved line comes from `custom_provider_status`: the address, the tick
 * and a bool. The key box is a password field and is cleared once saved.
 *
 * Secondary and quiet buttons only: Settings spends its one primary on Export.
 */

/** Rust's limit on the address, in bytes after parsing. The box stops typing there. */
const MAX_ADDRESS_CHARS = 300;

const SAVED_MESSAGE =
  'That service answered, and its address and key are saved. Choose a model below.';
const REMOVED_MESSAGE = 'The service has been removed from this computer.';

const STATE_LABEL: Record<KeyState, string> = {
  configured: 'Saved',
  incomplete: 'Saved',
  missing: 'Not set up',
  unreadable: 'Could not be read',
};

export interface CustomServiceCardProps {
  /** Injected by tests. Defaults to the real Rust commands. */
  readonly port?: CustomServicePort | undefined;
}

export function CustomServiceCard({ port: injected }: CustomServiceCardProps = {}) {
  const port = useMemo(() => injected ?? createTauriCustomServicePort(), [injected]);

  // `undefined` until the first answer, `null` when nothing is saved.
  const [saved, setSaved] = useState<CustomServiceStatus | null | undefined>(undefined);
  const [unreadable, setUnreadable] = useState(false);
  const [address, setAddress] = useState('');
  const [ownNetwork, setOwnNetwork] = useState(false);
  const [key, setKey] = useState('');
  const [addressError, setAddressError] = useState<string | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [passed, setPassed] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const status = await port.status();
    setUnreadable(!status.ok);
    setSaved(status.ok ? status.value : null);
  }, [port]);

  useEffect(() => {
    let cancelled = false;
    void port.status().then((status) => {
      if (cancelled) return;
      setUnreadable(!status.ok);
      setSaved(status.ok ? status.value : null);
    });
    return () => {
      cancelled = true;
    };
  }, [port]);

  const state: KeyState = unreadable
    ? 'unreadable'
    : saved === undefined || saved === null
      ? 'missing'
      : 'configured';

  const onSave = useCallback(async () => {
    setPassed(null);
    setProblem(null);

    const typedAddress = address.trim();
    const typedKey = key.trim();
    const noAddress = typedAddress === '' ? 'Type the service’s address first.' : null;
    const noKey =
      typedKey === '' && !ownNetwork
        ? 'Paste the service’s API key. If it runs on your own computer or network and needs ' +
          'no key, tick the box above instead.'
        : null;
    setAddressError(noAddress);
    setKeyError(noKey);
    if (noAddress !== null || noKey !== null) return;

    setBusy(true);
    const result = await port.save({ address: typedAddress, ownNetwork, key: typedKey });
    setBusy(false);

    if (!result.ok) {
      // Nothing was written. The sentence is Rust's: it knows which rule the
      // address broke, or what the service said about the key.
      setProblem(result.error.message);
      return;
    }

    setKey('');
    setAddress('');
    setPassed(SAVED_MESSAGE);
    await refresh();
  }, [address, key, ownNetwork, port, refresh]);

  const onRemove = useCallback(async () => {
    setPassed(null);
    setProblem(null);
    setBusy(true);
    const removed = await port.remove();
    setBusy(false);
    if (!removed.ok) {
      setProblem(`The service could not be removed. ${removed.error.message}`);
      return;
    }
    forgetCustomModel();
    setPassed(REMOVED_MESSAGE);
    await refresh();
  }, [port, refresh]);

  return (
    <article
      data-testid="custom-service-card"
      aria-labelledby="custom-service-heading"
      className="rounded-card border border-line bg-card p-4 shadow-raised"
    >
      <header className="flex items-baseline justify-between gap-3">
        <h3 id="custom-service-heading" className="font-medium text-ink">
          Your own AI service
        </h3>
        <span
          data-testid="custom-service-state"
          data-state={state}
          className={`shrink-0 rounded-pill px-2 py-0.5 text-[11px] font-medium ${KEY_STATE_TONE[state]}`}
        >
          {STATE_LABEL[state]}
        </span>
      </header>

      <p className="mt-1 text-ink-muted">
        Any service that answers like OpenAI’s chat API: LM Studio or llama.cpp on your own
        computer, a model server on your network, or a hosted service not listed above.
      </p>
      <p className="mt-1 text-xs text-ink-faint">
        Your CV and adverts go to this address only when you choose this service, and only after you
        agree.
      </p>

      {saved === undefined || saved === null ? null : (
        <p data-testid="custom-service-saved" className="mt-2 text-xs text-ink-muted">
          Saved: <span className="font-mono break-all">{saved.address}</span>
          {saved.ownNetwork ? ' · on your own computer or network' : ''}
          {saved.hasKey ? ' · key saved' : ' · no key'}
        </p>
      )}

      <div className="mt-3">
        <label
          htmlFor="custom-service-address"
          className="block text-xs font-medium text-ink-muted"
        >
          {saved ? 'Replace with a new address' : 'Address'}
        </label>
        <input
          id="custom-service-address"
          data-testid="custom-service-address"
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          maxLength={MAX_ADDRESS_CHARS}
          placeholder="https://api.example.com/v1"
          value={address}
          disabled={busy}
          aria-invalid={addressError === null ? undefined : true}
          aria-describedby={addressError === null ? undefined : 'custom-service-address-error'}
          onChange={(event) => {
            setAddress(event.currentTarget.value);
            setAddressError(null);
          }}
          className={`mt-1 w-full rounded-control border bg-card px-2.5 py-1.5 text-ink ${
            addressError === null ? 'border-field-line' : 'border-danger'
          }`}
        />
        <p className="mt-1 text-xs text-ink-faint">
          The base address its documentation gives for OpenAI-compatible use. It usually ends in
          /v1.
        </p>
        {addressError === null ? null : (
          <p
            id="custom-service-address-error"
            data-testid="custom-service-address-error"
            className="mt-1 text-xs text-danger"
          >
            {addressError}
          </p>
        )}
      </div>

      <div className="mt-3">
        <label className="flex items-start gap-2 text-ink">
          <input
            type="checkbox"
            data-testid="custom-service-own-network"
            checked={ownNetwork}
            disabled={busy}
            onChange={(event) => {
              setOwnNetwork(event.currentTarget.checked);
              setKeyError(null);
            }}
            className="mt-1"
          />
          <span>This runs on my own computer or network</span>
        </label>
        <p className="mt-1 text-xs text-ink-faint">
          Allows an address starting http:// and no key, for this computer or your home network
          only. An address on the internet always needs https://.
        </p>
      </div>

      <div className="mt-3">
        <label htmlFor="custom-service-key" className="block text-xs font-medium text-ink-muted">
          API key
        </label>
        <input
          id="custom-service-key"
          data-testid="custom-service-key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={key}
          disabled={busy}
          aria-invalid={keyError === null ? undefined : true}
          aria-describedby={keyError === null ? undefined : 'custom-service-key-error'}
          onChange={(event) => {
            setKey(event.currentTarget.value);
            setKeyError(null);
          }}
          className={`mt-1 w-full rounded-control border bg-card px-2.5 py-1.5 text-ink ${
            keyError === null ? 'border-field-line' : 'border-danger'
          }`}
        />
        <p className="mt-1 text-xs text-ink-faint">
          Kept with the address in this computer’s credential store, so it can only be sent there.
        </p>
        {keyError === null ? null : (
          <p
            id="custom-service-key-error"
            data-testid="custom-service-key-error"
            className="mt-1 text-xs text-danger"
          >
            {keyError}
          </p>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="custom-service-save"
          disabled={busy}
          onClick={() => void onSave()}
          className={SECONDARY_BUTTON}
        >
          {busy ? 'Checking…' : 'Test and save'}
        </button>
        <button
          type="button"
          data-testid="custom-service-remove"
          // Disabled, never hidden: a control that comes and goes cannot be learned.
          disabled={busy || saved === undefined || saved === null}
          onClick={() => void onRemove()}
          className={QUIET_BUTTON}
        >
          Remove this service
        </button>
      </div>

      {passed === null ? null : (
        <p
          role="status"
          data-testid="custom-service-result"
          className="mt-3 rounded-control bg-teal/10 px-3 py-2 text-teal-ink"
        >
          {passed}
        </p>
      )}
      {problem === null ? null : (
        <p
          role="alert"
          data-testid="custom-service-problem"
          className="mt-3 rounded-control bg-danger/5 px-3 py-2 text-danger"
        >
          {problem}
        </p>
      )}

      {saved === undefined || saved === null ? null : (
        <CustomModelPicker port={port} address={saved.address} />
      )}
    </article>
  );
}

/**
 * Which model to ask for. The service's own list when it gives one; a typed
 * name when it does not. Until one is chosen the pickers do not offer the
 * service, because a request with no model is one it can only refuse.
 */
function CustomModelPicker({
  port,
  address,
}: {
  readonly port: CustomServicePort;
  /** Re-lists when the saved address changes. */
  readonly address: string;
}) {
  const [model, setModel] = useState<string | null>(() => readCustomModel());
  const [models, setModels] = useState<readonly ModelInfo[]>([]);
  const [listProblem, setListProblem] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [typedError, setTypedError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void port.listModels().then((listed) => {
      if (cancelled) return;
      setModels(listed.ok ? listed.value : []);
      setListProblem(listed.ok ? null : listed.error.message);
    });
    return () => {
      cancelled = true;
    };
  }, [port, address]);

  function use(raw: string): boolean {
    if (!chooseCustomModel(raw)) return false;
    setModel(normaliseCustomModel(raw));
    return true;
  }

  return (
    <div className="mt-3">
      <p className="text-xs font-medium text-ink-muted">Model</p>
      <p data-testid="custom-service-model" className="mt-1 text-ink">
        {model === null ? (
          'None chosen yet. Choose one, and this service is offered wherever you use AI.'
        ) : (
          <>
            Using <span className="font-mono">{model}</span> for analysis, tailoring, pasted
            adverts, follow-ups and interview packs.
          </>
        )}
      </p>

      {models.length === 0 ? null : (
        <>
          <label htmlFor="custom-service-model-select" className="sr-only">
            Choose a model from the service’s list
          </label>
          <select
            id="custom-service-model-select"
            data-testid="custom-service-model-select"
            value={model !== null && models.some((entry) => entry.id === model) ? model : ''}
            onChange={(event) => void use(event.currentTarget.value)}
            className="mt-2 w-full rounded-control border border-field-line bg-card px-2.5 py-1.5 text-ink"
          >
            <option value="" disabled>
              Choose a model from the service’s list
            </option>
            {models.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
        </>
      )}

      {listProblem === null ? null : (
        <p data-testid="custom-service-models-problem" className="mt-1 text-xs text-ink-faint">
          {listProblem} You can type the model’s name instead.
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label htmlFor="custom-service-model-typed" className="sr-only">
          Model name
        </label>
        <input
          id="custom-service-model-typed"
          data-testid="custom-service-model-typed"
          type="text"
          autoComplete="off"
          spellCheck={false}
          placeholder="Or type a model name"
          value={typed}
          aria-invalid={typedError === null ? undefined : true}
          aria-describedby={typedError === null ? undefined : 'custom-service-model-error'}
          onChange={(event) => {
            setTyped(event.currentTarget.value);
            setTypedError(null);
          }}
          className="min-w-0 flex-1 rounded-control border border-field-line bg-card px-2.5 py-1.5 text-ink"
        />
        <button
          type="button"
          data-testid="custom-service-model-use"
          onClick={() => {
            if (use(typed)) {
              setTyped('');
            } else {
              setTypedError(
                'That is not a model name this service could accept. Copy it exactly, with no spaces.',
              );
            }
          }}
          className={QUIET_BUTTON}
        >
          Use this model
        </button>
      </div>
      {typedError === null ? null : (
        <p
          id="custom-service-model-error"
          data-testid="custom-service-model-error"
          className="mt-1 text-xs text-danger"
        >
          {typedError}
        </p>
      )}
    </div>
  );
}
