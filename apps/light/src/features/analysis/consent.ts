/**
 * Whether the user has agreed to send their CV and the job advert to a named
 * third-party AI provider — one decision per provider, and revocable.
 *
 * ============================================================================
 * WHY THIS EXISTS: APPLE 5.1.2(i), EFFECTIVE 13 NOV 2025
 * ============================================================================
 * Apple's App Review Guideline 5.1.2(i) requires an app to disclose IN THE
 * APP, name the provider, and get explicit, revocable consent before personal
 * data is shared with a third-party AI. A CV is personal data, and this repo
 * already ships an iOS target (L-80) — so this is owed on the next App Store
 * submission, not a future nice-to-have.
 *
 * ============================================================================
 * PER PROVIDER, NEVER GLOBAL
 * ============================================================================
 * Agreeing to send a CV to OpenAI says nothing about Anthropic — they are
 * different companies with different terms, and a single "I agree to AI"
 * switch would be consent to a sentence the user never actually read.
 * `ConsentState` is a flag per provider, never one flag for "AI" — see
 * `runAnalysis.consent.test.ts` for the boundary that proves it.
 *
 * ============================================================================
 * OLLAMA IS NOT A KEY IN THIS FILE, AND THAT IS STRUCTURAL, NOT AN OVERSIGHT
 * ============================================================================
 * `ConsentProviderKind` is `Exclude<ProviderId, 'ollama'>`, not a hand-written
 * union. There is no branch here to add for Ollama, so a future change cannot
 * accidentally start prompting for consent to run a model on the user's own
 * PC — the compiler has nowhere to put it. Local inference on 127.0.0.1 is
 * exactly what 5.1.2(i) does not reach, and `runAnalysis.ts` never even calls
 * into this file on that path.
 *
 * ============================================================================
 * PERSISTENCE: `tauri-plugin-store`, MATCHING `boards/port.ts`
 * ============================================================================
 * A consent decision is exactly the kind of thing that file describes:
 * something the user DID, not the state of a text box. It goes in the same
 * mechanism as the board list — a named file in the app's own data directory,
 * written explicitly (`autoSave: false`) — and deliberately not SQLite: it is
 * a preference, not a record with a place in the export file.
 *
 * A store that cannot be read FAILS CLOSED. Anything other than the literal
 * value `true` reads as "not granted" — see `parseConsentState`. The failure
 * mode of losing a consent record is "ask again", never "treat silence as
 * yes".
 */
import { err, ok, type Result } from '@cviper/core-types';
import { type ProviderId } from '@cviper/ai-providers';

import { type ProviderKind } from './providers';

/** The only two kinds a CV can actually be sent to. Ollama has no key here. */
export type ConsentProviderKind = Exclude<ProviderId, 'ollama'>;

export interface ConsentState {
  readonly anthropic: boolean;
  readonly openai: boolean;
}

/** The state of a machine that has never been asked. */
export const NO_CONSENT: ConsentState = { anthropic: false, openai: false };

/** The file, in the app's own data directory. Exported so tests name the real one. */
export const CONSENT_STORE_FILE = 'ai-provider-consent.json';

/** The single key inside it. */
export const CONSENT_STORE_KEY = 'consent';

export interface ConsentProblem {
  /** Legible enough to show a user without further translation. */
  readonly message: string;
}

export interface ConsentPort {
  read(): Promise<Result<ConsentState, ConsentProblem>>;
  grant(kind: ConsentProviderKind): Promise<Result<ConsentState, ConsentProblem>>;
  revoke(kind: ConsentProviderKind): Promise<Result<ConsentState, ConsentProblem>>;
}

/**
 * Read whatever is in the store defensively.
 *
 * A hand-edited or half-written file must FAIL CLOSED: anything that is not
 * exactly `true` is read as "not granted", never as "granted". Consent is the
 * one preference in this app where the safe default and the honest default
 * are the same value.
 */
export function parseConsentState(raw: unknown): ConsentState {
  if (typeof raw !== 'object' || raw === null) return NO_CONSENT;
  const record = raw as Record<string, unknown>;
  return {
    anthropic: record['anthropic'] === true,
    openai: record['openai'] === true,
  };
}

/** The text of an unknown thrown value, without assuming it is an `Error`. */
function describeThrown(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === 'string' && cause.trim() !== '') return cause;
  return 'The file could not be read or written.';
}

/**
 * The kinds that need the user's agreement before anything is sent to them.
 *
 * Lives HERE, next to `ConsentProviderKind`, rather than in the one feature
 * that happened to need it first. It was private to `runAnalysis.ts` until
 * L-115, which is how the tracker's extraction path came to build the same
 * transport with no gate at all: a second call site could not reuse a check it
 * could not see. The narrowing is the point — everything downstream of a `true`
 * from here is typed as a provider this file actually has a flag for, so
 * 'ollama' has nowhere to go.
 *
 * ============================================================================
 * WRITTEN AS AN EXCLUSION, NEVER AS A LIST OF CLOUD PROVIDERS
 * ============================================================================
 * `kind === 'anthropic' || kind === 'openai'` reads the same today and fails
 * the wrong way tomorrow: a provider added to `ProviderKind` — Mistral, Groq,
 * whoever — would be absent from that list and would therefore skip the gate at
 * BOTH call sites, silently, while every guard stayed green. The exclusion is
 * the safe default: something new is treated as cloud until somebody
 * deliberately writes it down here as local, and the only two things that are
 * local are the two named below. 'keyword' never leaves the process at all and
 * 'ollama' is 127.0.0.1, which is exactly what 5.1.2(i) does not reach.
 *
 * The cost of getting the exclusion wrong is a consent prompt nobody needed.
 * The cost of getting a list wrong is somebody's CV leaving the machine.
 */
export function isCloudKind(kind: ProviderKind): kind is ConsentProviderKind {
  return kind !== 'keyword' && kind !== 'ollama';
}

export function createTauriConsentPort(): ConsentPort {
  /*
   * Imported inside the call, the same way `boards/port.ts` does it: merely
   * rendering a screen should not pull a Tauri plugin into the module graph,
   * and in a Vitest run there is no Tauri runtime to pull it into.
   */
  async function open() {
    const { load } = await import('@tauri-apps/plugin-store');
    // `autoSave: false`: this is written when the user answers the consent
    // prompt or presses withdraw, and at no other moment.
    return load(CONSENT_STORE_FILE, { autoSave: false });
  }

  async function readState(): Promise<Result<ConsentState, ConsentProblem>> {
    try {
      const store = await open();
      return ok(parseConsentState(await store.get(CONSENT_STORE_KEY)));
    } catch (cause) {
      // FAILS CLOSED. An unreadable consent file must never be treated as
      // consent granted — see the header.
      return err({
        message:
          'Your AI consent choices could not be read, so nothing will be sent to a cloud ' +
          `provider until you choose again. ${describeThrown(cause)}`,
      });
    }
  }

  async function writeState(next: ConsentState): Promise<Result<ConsentState, ConsentProblem>> {
    try {
      const store = await open();
      await store.set(CONSENT_STORE_KEY, next);
      // Explicit, because `autoSave` is off. Without this the change is in
      // memory only and is gone at the next launch — which for a REVOCATION
      // would mean the app quietly resuming something the user just switched
      // off.
      await store.save();
      return ok(next);
    } catch (cause) {
      return err({
        message: `That choice could not be saved, so it will be asked again. ${describeThrown(cause)}`,
      });
    }
  }

  async function setKind(
    kind: ConsentProviderKind,
    value: boolean,
  ): Promise<Result<ConsentState, ConsentProblem>> {
    const current = await readState();
    const base = current.ok ? current.value : NO_CONSENT;
    return writeState({ ...base, [kind]: value });
  }

  return {
    read: readState,
    grant: (kind) => setKind(kind, true),
    revoke: (kind) => setKind(kind, false),
  };
}

/**
 * The default consent check every call site gets: the real store, read fresh.
 *
 * Fresh on every call rather than from a snapshot, so a consent withdrawn a
 * second ago is honoured by a run started now. Fails CLOSED like the port
 * itself — an unreadable store is `false`, never `true`.
 *
 * Shared by `runAnalysis` and `runExtraction` (L-115). Two copies of this would
 * be two places to get the `state.ok &&` wrong, and one of them would be the
 * copy nobody read.
 */
export async function readStoredConsent(kind: ConsentProviderKind): Promise<boolean> {
  const state = await createTauriConsentPort().read();
  return state.ok && state.value[kind];
}
