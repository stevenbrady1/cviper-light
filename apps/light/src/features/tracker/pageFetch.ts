/**
 * The production page-fetch transport: a thin wrapper over `invoke()` into Rust.
 *
 * ============================================================================
 * THIS FILE IS THE ONLY THING THAT KNOWS FETCHING A PAGE LEAVES THE PROCESS.
 * ============================================================================
 * Same arrangement as `src/ai/transport.ts` and `src/jobs/transport.ts`, with
 * one honest difference: those two hand Rust a name from a closed enum, and
 * this one hands it a URL the user typed. That is the whole reason
 * `src-tauri/src/fetch_page.rs` opens with fifty lines about SSRF and carries a
 * guard for every rule in it. NOTHING in this file is a security control — the
 * address is re-checked in Rust before every connection, and a compromised
 * frontend that skipped this module entirely would get exactly the same
 * refusals.
 *
 * ============================================================================
 * DELIBERATELY NOT COUNTED BY `recordRequest`
 * ============================================================================
 * The status strip's number answers "how much am I using" — see the header of
 * `status/requestLog.ts`, which is explicit that it counts PROVIDER requests
 * because every one of them costs the user an API allowance or money. Opening a
 * job advert costs neither. Adding page fetches to that number would change
 * what the number means for everybody who already reads it, in order to say
 * something it was never asked.
 */
import { invoke } from '@tauri-apps/api/core';

import { err, ok, type Result } from '@cviper/core-types';

/** The command name registered in `generate_handler!`. */
export const PAGE_FETCH_COMMAND = 'fetch_job_page';

/**
 * Why a fetch did not produce a page.
 *
 * The first five are the `Refusal` kinds `fetch_page.rs` emits — its
 * `error_kinds_match_the_typescript_union` test is bound to this list.
 * `bad-response` is ours alone: Rust cannot send it, and it exists for a reply
 * that is not the envelope Rust promised, which means the IPC itself is wrong.
 *
 * The UI shows ONE guided sentence for every one of these (see `runFetch.ts`).
 * The kind is here so the code can tell them apart, never so a user has to.
 */
export type PageFetchErrorKind =
  'bad-url' | 'blocked' | 'network' | 'too-large' | 'unsupported' | 'bad-response';

export interface PageFetchError {
  readonly kind: PageFetchErrorKind;
  /** Safe to log. NEVER shown to a user — the UI has its own single message. */
  readonly message: string;
}

export interface FetchedPage {
  readonly status: number;
  /**
   * The page's raw HTML, capped in Rust.
   *
   * UNTRUSTED. It came from someone else's server and it goes into a prompt, so
   * it passes through `htmlToText` — which strips it to text and runs the
   * result through `sanitizeForPrompt` — before anything else touches it.
   */
  readonly body: string;
}

/**
 * Injected wherever a test needs to prove a path did or did not reach the
 * network. Same shape as `ChatTransport` and `JobSearchTransport`, for the same
 * reason: the factory is a parameter, so "this never fetched anything" is an
 * assertion rather than a hope.
 */
export interface PageFetchTransport {
  fetchPage(url: string): Promise<Result<FetchedPage, PageFetchError>>;
}

/**
 * Kinds Rust is allowed to name.
 *
 * A closed set rather than a cast: an unrecognised kind from a future Rust
 * change must degrade to something the UI can still render, not become a
 * `PageFetchErrorKind` that no switch statement handles.
 */
const RUST_ERROR_KINDS = new Set<PageFetchErrorKind>([
  'bad-url',
  'blocked',
  'network',
  'too-large',
  'unsupported',
]);

/** Used when Rust fails in a way we cannot classify at all. */
const UNCLASSIFIED_MESSAGE = 'That page could not be fetched.';

/**
 * Turn whatever `invoke` rejected with into a `PageFetchError`.
 *
 * Rust sends a JSON object `{kind, message}`. This parses it defensively: a
 * Tauri-level failure (the command not registered, a broken IPC) rejects with
 * something else entirely, and that must still produce a sensible error rather
 * than a crash inside the error handler.
 *
 * The thrown value is never rendered into the message. A rejection can carry a
 * URL, a stack or a header, and this string is the sort of thing that ends up
 * in a screenshot.
 */
function toPageFetchError(thrown: unknown): PageFetchError {
  if (typeof thrown === 'string') {
    try {
      const parsed: unknown = JSON.parse(thrown);
      if (typeof parsed === 'object' && parsed !== null) {
        const record = parsed as Record<string, unknown>;
        const kind = record['kind'];
        const message = record['message'];
        if (
          typeof kind === 'string' &&
          RUST_ERROR_KINDS.has(kind as PageFetchErrorKind) &&
          typeof message === 'string' &&
          message.length > 0
        ) {
          return { kind: kind as PageFetchErrorKind, message };
        }
      }
    } catch {
      // Not JSON. An older Rust build, or a Tauri-level rejection that happens
      // to be a string. Fall through rather than showing raw JSON.
    }
  }

  return { kind: 'network', message: UNCLASSIFIED_MESSAGE };
}

/** Read the `{status, body}` envelope Rust returns for a completed request. */
function toFetchedPage(raw: unknown): Result<FetchedPage, PageFetchError> {
  if (typeof raw !== 'object' || raw === null) {
    return err({ kind: 'bad-response', message: UNCLASSIFIED_MESSAGE });
  }

  const record = raw as Record<string, unknown>;
  const status = record['status'];
  const body = record['body'];
  if (typeof status !== 'number' || typeof body !== 'string') {
    return err({ kind: 'bad-response', message: UNCLASSIFIED_MESSAGE });
  }

  return ok({ status, body });
}

export function createTauriPageTransport(): PageFetchTransport {
  return {
    async fetchPage(url: string): Promise<Result<FetchedPage, PageFetchError>> {
      try {
        return toFetchedPage(await invoke(PAGE_FETCH_COMMAND, { url }));
      } catch (thrown) {
        // Never swallowed: every failure becomes a typed error the caller must
        // narrow on before it can reach a value.
        return err(toPageFetchError(thrown));
      }
    },
  };
}
