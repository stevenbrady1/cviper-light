/**
 * The file boundary: three narrow Rust commands, each of which runs its own
 * dialog.
 *
 * ============================================================================
 * THIS FILE IS THE ONLY THING IN THE APP THAT KNOWS FILES EXIST.
 * ============================================================================
 * `@cviper/cv-parsing` is a pure function over bytes. `@cviper/core-types`
 * turns a payload into a string and back. Neither of them can open a file, and
 * that is on purpose — it is why both can be tested exhaustively without a
 * filesystem. This module supplies the bytes and takes the string away again.
 *
 * ============================================================================
 * NOTHING HERE CAN NAME A FILE, AND THERE IS NO DIALOG ON THIS SIDE.
 * ============================================================================
 * These commands used to take a path: the dialog ran here, in JavaScript, and
 * handed its answer to Rust to open. Rust checked the extension, the size and
 * the file type, so the worst outcome was reading somebody's documents rather
 * than their credentials — but the path itself was still whatever the caller
 * said, and this app feeds attacker-written job adverts into a language model
 * all day.
 *
 * The dialog now lives in `src-tauri/src/files.rs`. `pick_and_read_cv` takes no
 * arguments at all; `pick_and_write_backup` takes the bytes to write and a
 * suggested file NAME, which Rust replaces outright if it looks like anything
 * other than a bare name. So there is nothing left in this file for injected
 * script to point somewhere interesting. Same principle as `secret_get`, which
 * is deliberately not a command at all.
 *
 * Paths come back OUT — the CV row records where it came from and the export
 * message says where the backup went — because that is a report of what the
 * user just did in a dialog they were looking at.
 *
 * ============================================================================
 * CANCELLING IS NOT AN ERROR
 * ============================================================================
 * Every entry point returns `Result<T | null, FileError>`, where `null` means
 * "the user closed the dialog". That is the single most common outcome of
 * opening a file picker and it is not a failure — showing a red message because
 * somebody changed their mind is the sort of thing that teaches people to
 * distrust every other message the app shows them. Rust says the same thing the
 * same way: `Ok(None)`, which arrives here as `null`.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

import { err, ok, type Result } from '@cviper/core-types';

/** A CV, read off the disk. */
export interface PickedCv {
  /** The file's own name, e.g. `Steven Brady CV.pdf`. Used to label the CV. */
  readonly name: string;
  /** The full path, kept so the CV row can record where it came from. */
  readonly path: string;
  readonly bytes: Uint8Array;
}

/** A backup file, read off the disk. */
export interface PickedBackup {
  readonly name: string;
  readonly path: string;
  readonly text: string;
}

export interface FileError {
  /** Legible enough to put in front of a user with no further translation. */
  readonly message: string;
}

export interface FilePort {
  /** Ask for a CV and read it. `null` means the user cancelled. */
  pickCv(): Promise<Result<PickedCv | null, FileError>>;
  /** Ask for a backup and read it as text. `null` means the user cancelled. */
  pickBackup(): Promise<Result<PickedBackup | null, FileError>>;
  /** Ask where to save, then write. Resolves with the path, or `null`. */
  saveBackup(contents: string, suggestedName: string): Promise<Result<string | null, FileError>>;
}

/**
 * A CV the operating system asked this app to open — the iPhone share
 * sheet's "Open in CViper Light" from Files, Mail or Safari (L-83).
 *
 * The other direction from `FilePort`: nothing is asked for, the file simply
 * arrives. Rust receives the URL from the OS, reads it under the picker's
 * guards, and emits either the `CvFile` or a sentence; this port turns those
 * two events into one `Result`, the same shape `pickCv` answers with. The
 * path still never passes through JavaScript on its way IN.
 */
export interface OpenedCvPort {
  /** Start listening. The returned function stops. */
  watch(listener: (opened: Result<PickedCv, FileError>) => void): () => void;
}

/** The two events `files::on_opened` in Rust emits. Same strings, both sides. */
export const CV_OPENED_EVENT = 'cv-opened';
export const CV_OPEN_FAILED_EVENT = 'cv-open-failed';

/**
 * Decode standard base64 into bytes. `null` when the input is not base64.
 *
 * `atob` gives one character per byte, each in 0-255, so the copy below is
 * exact — no `TextEncoder`, which would re-encode anything above 0x7F as two
 * UTF-8 bytes and silently corrupt every PDF.
 *
 * The `null` path is only reachable through a bug in our own Rust, and it is
 * still a value rather than an exception: a throw here would surface as an
 * unhandled rejection inside a click handler, with nothing on screen.
 */
export function decodeBase64(encoded: string): Uint8Array | null {
  let binary: string;
  try {
    binary = atob(encoded);
  } catch {
    return null;
  }

  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/**
 * The text of something `invoke` rejected with.
 *
 * ============================================================================
 * ONLY A STRING IS PASSED THROUGH. AN `Error` IS NOT.
 * ============================================================================
 * A Rust command declared `Result<T, String>` rejects with exactly that string,
 * and every one of ours is a sentence written for a user — see
 * `describe_io_error` in files.rs. Those are worth showing verbatim and are the
 * whole reason the Rust side bothers to word them.
 *
 * An `Error` object is something else entirely: a Tauri-level failure, a
 * missing plugin permission, a dialog that could not open. Its message is
 * written for a developer ("no display", "window not found") and putting it in
 * front of someone whose CV would not upload tells them nothing they can act
 * on. Those get OUR sentence instead. Same rule as `toProviderError` in
 * `src/ai/transport.ts`.
 */
function rejectionMessage(thrown: unknown, fallback: string): string {
  if (typeof thrown === 'string' && thrown.trim().length > 0) return thrown;
  return fallback;
}

/** Read a string property off an unknown IPC reply. */
function readString(source: unknown, key: string): string | null {
  if (typeof source !== 'object' || source === null) return null;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
}

/**
 * `true` when Rust said the user cancelled.
 *
 * Checked BEFORE the reply is read for fields, so a cancellation can never be
 * mistaken for a reply we could not parse and reported as a failure.
 */
function cancelled(reply: unknown): boolean {
  return reply === null || reply === undefined;
}

/**
 * A `CvFile` from Rust — the picker's reply or the opened-file event — as a
 * `PickedCv`.
 *
 * A reply we cannot read becomes an error, NEVER an empty document. Empty
 * text would be analysed and reported as "no skills found", which looks like
 * an answer — the exact failure `ExtractedDocument.warnings` exists to prevent.
 */
export function parseCvFile(reply: unknown): Result<PickedCv, FileError> {
  const name = readString(reply, 'name');
  const path = readString(reply, 'path');
  const encoded = readString(reply, 'bytes_base64');
  const bytes = encoded === null ? null : decodeBase64(encoded);

  if (name === null || path === null || bytes === null) {
    return err({
      message:
        'CViper read that file but could not make sense of what came back. ' +
        'Try a different copy of the CV.',
    });
  }

  return ok({ name, path, bytes });
}

export function createTauriFilePort(): FilePort {
  return {
    async pickCv() {
      let reply: unknown;
      try {
        // No arguments. There is nothing to pass, which is the point.
        reply = await invoke('pick_and_read_cv');
      } catch (thrown) {
        return err({
          message: rejectionMessage(thrown, 'That CV could not be opened. Try again.'),
        });
      }

      // Cancelled. Nothing is read, and nothing is said. See the header.
      if (cancelled(reply)) return ok(null);

      return parseCvFile(reply);
    },

    async pickBackup() {
      let reply: unknown;
      try {
        reply = await invoke('pick_and_read_backup');
      } catch (thrown) {
        return err({
          message: rejectionMessage(thrown, 'That backup could not be opened. Try again.'),
        });
      }

      if (cancelled(reply)) return ok(null);

      const name = readString(reply, 'name');
      const path = readString(reply, 'path');
      const text = readString(reply, 'text');

      if (name === null || path === null || text === null) {
        return err({ message: 'That backup could not be read. Try exporting it again.' });
      }

      return ok({ name, path, text });
    },

    async saveBackup(contents, suggestedName) {
      let reply: unknown;
      try {
        // `suggestion` only pre-fills the dialog's name box, and Rust throws it
        // away entirely unless it is a bare `.json` file name. It is not, and
        // cannot become, a destination.
        //
        // The key is one word because Tauri camelCases a Rust command's
        // snake_case parameters across the boundary: a `suggested_name` there
        // would have to be `suggestedName` here, with no compile error on
        // either side if the two ever drifted apart.
        reply = await invoke('pick_and_write_backup', { contents, suggestion: suggestedName });
      } catch (thrown) {
        return err({
          message: rejectionMessage(thrown, 'The backup could not be saved. Try again.'),
        });
      }

      if (cancelled(reply)) return ok(null);

      // Written, but Rust did not say where. Reporting that as success would
      // put "Saved to undefined" on screen; the honest answer is that the save
      // is in doubt.
      if (typeof reply !== 'string') {
        return err({
          message: 'CViper saved that backup but could not report where it went.',
        });
      }

      return ok(reply);
    },
  };
}

/**
 * The real `OpenedCvPort`: two Tauri event listeners, one `Result` out.
 *
 * `listen` resolves asynchronously with its unlisten function. A watcher
 * that stops before that promise settles must still end up stopped, so
 * the resolved unlisten is called immediately if `stop` has already run. A
 * listener that fails to register (no Tauri runtime — a browser tab, a test)
 * leaves the port silent: there is nothing to open there anyway, and the rest
 * of the app is unaffected.
 */
export function createTauriOpenedCvPort(): OpenedCvPort {
  return {
    watch(listener) {
      let active = true;
      const stoppers: (() => void)[] = [];

      const keep = (registration: Promise<() => void>): void => {
        registration
          .then((unlisten) => {
            if (active) stoppers.push(unlisten);
            else unlisten();
          })
          .catch(() => undefined);
      };

      keep(
        listen<unknown>(CV_OPENED_EVENT, (event) => {
          if (active) listener(parseCvFile(event.payload));
        }),
      );
      keep(
        listen<unknown>(CV_OPEN_FAILED_EVENT, (event) => {
          if (!active) return;
          listener(
            err({
              message: rejectionMessage(event.payload, 'That file could not be opened. Try again.'),
            }),
          );
        }),
      );

      return () => {
        active = false;
        for (const stop of stoppers.splice(0)) stop();
      };
    },
  };
}
