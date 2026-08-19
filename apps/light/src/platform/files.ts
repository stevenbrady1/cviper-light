/**
 * The file boundary: the OS dialog, and the three narrow Rust commands behind
 * it.
 *
 * ============================================================================
 * THIS FILE IS THE ONLY THING IN THE APP THAT KNOWS FILES EXIST.
 * ============================================================================
 * `@cviper/cv-parsing` is a pure function over bytes. `@cviper/core-types`
 * turns a payload into a string and back. Neither of them can open a file, and
 * that is on purpose — it is why both can be tested exhaustively without a
 * filesystem. This module supplies the bytes and takes the string away again.
 *
 * The commands it calls are deliberately incapable of touching an arbitrary
 * file: `read_cv_file` opens a PDF or a Word document and nothing else,
 * `read_backup_file` and `write_backup_file` touch `.json` and nothing else,
 * and all three check the size from the directory entry before reading. See the
 * module comment in `src-tauri/src/files.rs`.
 *
 * ============================================================================
 * CANCELLING IS NOT AN ERROR
 * ============================================================================
 * Every entry point returns `Result<T | null, FileError>`, where `null` means
 * "the user closed the dialog". That is the single most common outcome of
 * opening a file picker and it is not a failure — showing a red message because
 * somebody changed their mind is the sort of thing that teaches people to
 * distrust every other message the app shows them.
 */
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';

import { err, ok, type Result } from '@cviper/core-types';

/** Extensions the CV dialog offers, matching `CV_EXTENSIONS` in `files.rs`. */
const CV_EXTENSIONS = ['pdf', 'docx', 'doc'];

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
 * The one path the dialog chose, or `null`.
 *
 * `open` is typed as `string | string[] | null` because its return shape
 * depends on the options object, and TypeScript cannot narrow that from a
 * runtime flag. Handled here rather than cast, so a future options change
 * cannot turn into `undefined` reaching `invoke` as a path.
 */
function singlePath(chosen: unknown): string | null {
  if (typeof chosen === 'string') return chosen;
  if (Array.isArray(chosen)) {
    const first: unknown = chosen[0];
    return typeof first === 'string' ? first : null;
  }
  return null;
}

/** The file's own name, from a Windows or POSIX path. */
function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}

/**
 * The text of something `invoke` or the dialog rejected with.
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

export function createTauriFilePort(): FilePort {
  return {
    async pickCv() {
      let chosen: unknown;
      try {
        chosen = await open({
          multiple: false,
          directory: false,
          title: 'Choose a CV',
          filters: [{ name: 'CV', extensions: CV_EXTENSIONS }],
        });
      } catch (thrown) {
        return err({
          message: rejectionMessage(thrown, 'The file picker would not open. Try again.'),
        });
      }

      const path = singlePath(chosen);
      // Cancelled. Nothing is read, and nothing is said. See the header.
      if (path === null) return ok(null);

      let reply: unknown;
      try {
        reply = await invoke('read_cv_file', { path });
      } catch (thrown) {
        return err({
          message: rejectionMessage(thrown, 'That file could not be read. Try a different copy.'),
        });
      }

      const name = readString(reply, 'name');
      const encoded = readString(reply, 'bytes_base64');
      const bytes = encoded === null ? null : decodeBase64(encoded);

      // A reply we cannot read becomes an error, NEVER an empty document.
      // Empty text would be analysed and reported as "no skills found", which
      // looks like an answer — the exact failure `ExtractedDocument.warnings`
      // exists to prevent.
      if (name === null || bytes === null) {
        return err({
          message:
            'CViper read that file but could not make sense of what came back. ' +
            'Try a different copy of the CV.',
        });
      }

      return ok({ name, path, bytes });
    },

    async pickBackup() {
      let chosen: unknown;
      try {
        chosen = await open({
          multiple: false,
          directory: false,
          title: 'Choose a CViper backup',
          filters: [{ name: 'CViper backup', extensions: ['json'] }],
        });
      } catch (thrown) {
        return err({
          message: rejectionMessage(thrown, 'The file picker would not open. Try again.'),
        });
      }

      const path = singlePath(chosen);
      if (path === null) return ok(null);

      try {
        const text = await invoke('read_backup_file', { path });
        if (typeof text !== 'string') {
          return err({ message: 'That backup could not be read. Try exporting it again.' });
        }
        return ok({ name: basename(path), path, text });
      } catch (thrown) {
        return err({
          message: rejectionMessage(thrown, 'That backup could not be read.'),
        });
      }
    },

    async saveBackup(contents, suggestedName) {
      let chosen: unknown;
      try {
        chosen = await save({
          title: 'Save your CViper backup',
          defaultPath: suggestedName,
          filters: [{ name: 'CViper backup', extensions: ['json'] }],
        });
      } catch (thrown) {
        return err({
          message: rejectionMessage(thrown, 'The save dialog would not open. Try again.'),
        });
      }

      const path = singlePath(chosen);
      if (path === null) return ok(null);

      try {
        await invoke('write_backup_file', { path, contents });
        return ok(path);
      } catch (thrown) {
        return err({
          message: rejectionMessage(thrown, 'The backup could not be written.'),
        });
      }
    },
  };
}
