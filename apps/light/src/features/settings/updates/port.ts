/**
 * The ONLY module in this app that imports the updater plugin.
 *
 * ============================================================================
 * ONE IMPORT SITE, SO THE PROMISE IS AUDITABLE BY GREP.
 * ============================================================================
 * "There is no automatic update check" is a claim about the whole application,
 * and a claim like that is worth exactly as much as the search that verifies
 * it. With every call funnelled through this file, verifying it means reading
 * one short module rather than trusting a convention — and `noAutoCheck.test.ts`
 * asserts the funnel is intact by scanning the source for a second import.
 *
 * Nothing here runs on mount. Both methods are called from a click handler, and
 * from nowhere else.
 */
import { err, ok, type Result } from '@cviper/core-types';

export interface UpdateInfo {
  /** The version on offer, e.g. `0.2.0`. */
  readonly version: string;
  /** Release notes, or `null` when the release carried none. */
  readonly notes: string | null;
  /** Publication date as the feed gave it, or `null`. */
  readonly date: string | null;
}

export interface UpdateProblem {
  /** Legible enough to show a user without further translation. */
  readonly message: string;
}

export interface UpdatePort {
  /** Ask once. `null` means "nothing newer". Never throws. */
  check(): Promise<Result<UpdateInfo | null, UpdateProblem>>;
  /** Download and install the update the last `check` found. Never throws. */
  install(): Promise<Result<void, UpdateProblem>>;
}

/**
 * Whatever the plugin threw, as a sentence.
 *
 * The four cases worth naming are the four that actually happen: nothing
 * published yet, no network, a manifest that will not parse, and a signature
 * that will not verify — the last being what a build whose baked-in pubkey does
 * not match the key the release was signed with produces. The key in
 * `tauri.conf.json` is real (minisign id 7029FCBC6B4F158F) and its private half
 * is in this repository's Actions secrets, so a correctly signed release
 * verifies; a mismatch is still worth a sentence the user can act on.
 *
 * ============================================================================
 * THE ORDER MATTERS, AND ONE CASE IS COUNTER-INTUITIVE
 * ============================================================================
 * "Nothing is published yet" does NOT arrive as a 404. Read out of
 * tauri-plugin-updater 2.10.1 rather than assumed: a non-success status is
 * logged WITHOUT setting `last_error` (`updater.rs`, the `else` at the end of
 * the response match), so the endpoint loop ends with no release and no error,
 * and `check()` returns `Error::ReleaseNotFound` — whose `#[error(...)]` text
 * in `error.rs` is "Could not fetch a valid release JSON from the remote".
 *
 * That sentence contains the word JSON and NEITHER "404" NOR "not found", so it
 * has to be matched BEFORE the parse branch below. Matched after, the user is
 * told their release information is unreadable when the truth is that nothing
 * has been published — blaming the download for the absence of one.
 *
 * It is not a corner case: until the permanent `updater` release exists every
 * check lands here, so this is the message every user sees on first launch.
 *
 * The parse case is still reachable and still worth naming: a serde failure
 * DOES set `last_error`, so its own text ("expected value at line 1 column 1")
 * is what arrives, and a half-finished upload of `latest.json` is a state a
 * fixed URL can genuinely be in (L-92).
 */
export function describeUpdateFailure(thrown: unknown): UpdateProblem {
  const raw = thrown instanceof Error ? thrown.message : String(thrown);
  const lower = raw.toLowerCase();

  if (lower.includes('signature') || lower.includes('pubkey') || lower.includes('public key')) {
    return {
      message:
        'The update could not be verified as genuine, so nothing was ' +
        'downloaded. This build may have been made without a signing key — ' +
        'download the new version from the releases page instead.',
    };
  }

  // BEFORE the parse branch, deliberately — see the note above. The plugin's
  // own words for "nothing is published" contain "JSON" and would otherwise
  // fall through it. `404`/`not found` are kept for transport-level errors that
  // do carry a status.
  if (
    lower.includes('release json') ||
    lower.includes('releasenotfound') ||
    lower.includes('404') ||
    lower.includes('not found')
  ) {
    return {
      message:
        'There are no published releases to compare against yet. Nothing is ' +
        'wrong with your copy.',
    };
  }

  if (
    lower.includes('expected value') ||
    lower.includes('deserializ') ||
    lower.includes('unexpected token') ||
    lower.includes('invalid type') ||
    lower.includes('eof while parsing') ||
    lower.includes('json')
  ) {
    return {
      message:
        'The release information could not be read, so this check could not ' +
        'finish and nothing was downloaded. Your copy of CViper Light is fine — ' +
        'try again shortly.',
    };
  }

  if (
    lower.includes('network') ||
    lower.includes('connect') ||
    lower.includes('dns') ||
    lower.includes('timed out')
  ) {
    return { message: 'GitHub could not be reached. Check your connection and try again.' };
  }

  return { message: `The update check did not finish: ${raw}` };
}

/** The shape of the plugin's `Update` object that this port actually uses. */
interface PendingUpdate {
  downloadAndInstall(): Promise<void>;
}

export function createTauriUpdatePort(): UpdatePort {
  /*
   * A handle to the update the last `check` found.
   *
   * `install` deliberately cannot re-check. Doing so would be a second network
   * request the user did not ask for, and it could install a DIFFERENT version
   * from the one whose release notes they just read.
   */
  let pending: PendingUpdate | null = null;

  return {
    async check() {
      try {
        /*
         * Imported here rather than at the top of the file, so that merely
         * rendering Settings does not pull the plugin into the module graph.
         * The import is side-effect-free either way; keeping it inside the call
         * makes "nothing happens until the button" true of the loader too.
         */
        const { check } = await import('@tauri-apps/plugin-updater');
        const update = await check();

        pending = update;
        if (update === null) return ok(null);

        return ok({
          version: update.version,
          notes: update.body ?? null,
          date: update.date ?? null,
        });
      } catch (thrown) {
        pending = null;
        return err(describeUpdateFailure(thrown));
      }
    },

    async install() {
      if (pending === null) {
        return err({ message: 'Check for an update first — there is nothing to install.' });
      }

      try {
        await pending.downloadAndInstall();
        return ok(undefined);
      } catch (thrown) {
        return err(describeUpdateFailure(thrown));
      }
    },
  };
}
