/**
 * Running one analysis — the single place the two paths meet.
 *
 * ============================================================================
 * THE KEYWORD PATH NEVER BUILDS A TRANSPORT.
 * ============================================================================
 * Not "does not use one" — never constructs one. The transport is a parameter
 * with a default, so the basic match returns before the factory is ever
 * touched, and `runAnalysis.test.ts` asserts the factory was not called at all.
 * That is a stronger guarantee than watching for an outbound request: it says
 * the code could not have made one.
 *
 * ============================================================================
 * A CLOUD PATH WITHOUT CONSENT NEVER BUILDS A TRANSPORT EITHER (Apple 5.1.2(i))
 * ============================================================================
 * Apple's App Review Guideline 5.1.2(i), effective 13 Nov 2025, requires
 * explicit, revocable, per-provider consent before a CV — personal data —
 * reaches a named third-party AI. So `anthropic` and `openai` get the SAME
 * guarantee the keyword path gets: `hasConsent` is checked, and the transport
 * factory is provably never called, before the answer comes back `true`. See
 * `runAnalysis.consent.test.ts` for the structural guard that keeps this order
 * from drifting.
 *
 * `ollama` is a LOCAL kind — `ConsentProviderKind` is `Exclude<ProviderId,
 * 'ollama'>`, so there is no branch here for it to fall into. `hasConsent` is
 * never even called for it: 127.0.0.1 is exactly what 5.1.2(i) does not
 * reach, and this file makes that structural rather than a rule to remember.
 *
 * ============================================================================
 * BOTH PATHS PRODUCE THE SAME `CvAnalysis`
 * ============================================================================
 * `scoreByKeywords` was written to return exactly the shape `analyzeCv`
 * returns, field for field, so everything above this file renders one component
 * either way. The ONLY difference the user should see is the label saying which
 * one ran — and that label is not optional. A keyword scan presented as an AI
 * reading would be the app's one genuinely dishonest moment.
 */
import {
  analyzeCv,
  createAnthropicProvider,
  createOllamaProvider,
  createOpenAiProvider,
  type AiProvider,
  type ChatTransport,
} from '@cviper/ai-providers';
import { err, ok, type CvAnalysis, type Result } from '@cviper/core-types';
import { KEYWORD_SCORING_VERSION, scoreByKeywords } from '@cviper/keyword-scoring';

import { createTauriTransport } from '../../ai/transport';

import { createTauriConsentPort, type ConsentProviderKind } from './consent';
import { providerLabel } from './model';
import { type ProviderKind, type ProviderOption } from './providers';

export interface RunRequest {
  readonly option: ProviderOption;
  readonly cvText: string;
  readonly jobText: string;
}

export interface RunSuccess {
  readonly analysis: CvAnalysis;
  /** Stored on the analysis row: `keyword`, `ollama`, `anthropic`, `openai`. */
  readonly provider: string;
  /** Stored on the analysis row: the model id, or the scorer's version. */
  readonly model: string;
  /** True when the model's first answer was unusable and the repair turn saved it. */
  readonly retried: boolean;
}

export interface RunFailure {
  /** Legible enough to put in front of a user with no further translation. */
  readonly message: string;
}

/**
 * The scorer's identity, recorded where a model id would go.
 *
 * Versioned because the scoring rules can change: two runs of the same CV
 * against the same advert that produced different numbers would otherwise look
 * like the app contradicting itself, when in fact the engine moved.
 */
const KEYWORD_MODEL = `keyword-v${KEYWORD_SCORING_VERSION}`;

/** The two kinds that need the user's consent before a CV can reach them. */
function isCloudKind(kind: ProviderKind): kind is ConsentProviderKind {
  return kind === 'anthropic' || kind === 'openai';
}

/**
 * The default consent check: reads the real store, fresh, on every call.
 *
 * Fails CLOSED like the port itself — see `consent.ts` — so a store that
 * cannot be read is "not granted", never "granted".
 */
async function readStoredConsent(kind: ConsentProviderKind): Promise<boolean> {
  const state = await createTauriConsentPort().read();
  return state.ok && state.value[kind];
}

/** How a chosen option becomes a provider adapter. */
function providerFor(option: ProviderOption, transport: ChatTransport): AiProvider | null {
  switch (option.kind) {
    case 'ollama':
      return createOllamaProvider(transport);
    case 'anthropic':
      return createAnthropicProvider(transport);
    case 'openai':
      return createOpenAiProvider(transport);
    case 'keyword':
      // Unreachable: the keyword path returns before this is called. Answered
      // with `null` rather than a throw so a future option added to the union
      // fails as a message rather than as a blank screen.
      return null;
  }
}

/**
 * Run one analysis.
 *
 * `createTransport` is injected so the keyword path can be PROVED not to build
 * one. In the app it defaults to the real Tauri transport, which is the only
 * thing in the process that knows a provider call leaves the machine.
 *
 * `hasConsent` is injected for the same reason: in the app it defaults to
 * reading the real consent store, and in tests it can be forced either way so
 * the gate can be proved rather than assumed. It is asked about a SINGLE
 * provider at a time — see `ConsentProviderKind` — never "AI in general".
 */
export async function runAnalysis(
  request: RunRequest,
  createTransport: () => ChatTransport = createTauriTransport,
  hasConsent: (kind: ConsentProviderKind) => Promise<boolean> = readStoredConsent,
): Promise<Result<RunSuccess, RunFailure>> {
  // ── The keyword path, and everything's input guard ───────────────────────
  // `scoreByKeywords` is pure, synchronous and free, and it refuses input there
  // is nothing to measure with better wording than anything this file could
  // write. So it runs FIRST on every path: on the basic match it is the answer,
  // and on the AI paths it is the cheapest possible way to find out that a
  // 30-second model call was never going to work.
  const scored = scoreByKeywords(request.cvText, request.jobText);

  if (request.option.kind === 'keyword') {
    return scored.ok
      ? ok({
          analysis: scored.value,
          provider: 'keyword',
          model: KEYWORD_MODEL,
          retried: false,
        })
      : err({ message: scored.error.message });
  }

  if (!scored.ok) {
    // The same refusal, before a single token is generated or a single request
    // is billed. See above.
    return err({ message: scored.error.message });
  }

  // ── The consent gate (Apple 5.1.2(i)) ────────────────────────────────────
  // Only the two cloud kinds reach this branch at all — `isCloudKind` narrows
  // to `ConsentProviderKind`, which structurally excludes 'ollama'. Checked,
  // and refused, BEFORE `createTransport()` is ever called: see the file
  // header and `runAnalysis.consent.test.ts`.
  if (isCloudKind(request.option.kind)) {
    const consented = await hasConsent(request.option.kind);
    if (!consented) {
      return err({
        message:
          `${providerLabel(request.option.kind)} needs your permission before your CV and the ` +
          'advert can be sent to it. Choose to allow it, or pick another way to run this.',
      });
    }
  }

  // ── The AI paths ─────────────────────────────────────────────────────────
  const provider = providerFor(request.option, createTransport());
  const model = request.option.model;

  if (provider === null || model === null) {
    return err({
      message:
        'That way of running the analysis is not available in this build. ' +
        'Choose another option.',
    });
  }

  const analysed = await analyzeCv({
    provider,
    model,
    cvText: request.cvText,
    jobText: request.jobText,
  });

  if (!analysed.ok) {
    // Passed through verbatim. Every message that reaches here was written for
    // a user — by the Rust transport for a stopped daemon, by the adapter for a
    // rejected key, by `extract-json` for a truncated answer — and rewording
    // them here would replace advice with a shrug.
    return err({ message: analysed.error.message });
  }

  return ok({
    analysis: analysed.value.analysis,
    provider: request.option.kind,
    model,
    retried: analysed.value.meta.retryCount > 0,
  });
}
