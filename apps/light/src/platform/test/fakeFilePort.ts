import { err, ok } from '@cviper/core-types';

import { type FilePort, type PickedBackup, type PickedCv } from '../files';

/**
 * An in-memory `FilePort`, for driving the upload and backup flows in a test.
 *
 * The real one opens an OS dialog and calls into Rust, neither of which exists
 * in a Vitest process. This satisfies the same interface, so a change to the
 * real port's shape stops this compiling.
 *
 * Every outcome a user can actually reach is expressible: a file chosen, a
 * dialog cancelled (`null`, which is NOT an error and must not be rendered as
 * one), and a refusal from Rust.
 */

export interface FakeFilePort extends FilePort {
  /** The next `pickCv` answers with this file. */
  readonly nextCv: (cv: PickedCv | null) => void;
  /** The next `pickCv` fails with this message. */
  readonly failCv: (message: string) => void;
  /** The next `pickBackup` answers with this file. */
  readonly nextBackup: (backup: PickedBackup | null) => void;
  /** The next `pickBackup` fails with this message. */
  readonly failBackup: (message: string) => void;
  /** Where the next `saveBackup` says it saved to. `null` means cancelled. */
  readonly nextSavePath: (path: string | null) => void;
  /** The next `saveBackup` fails with this message. */
  readonly failSave: (message: string) => void;
  /** Everything `saveBackup` was asked to write, in order. */
  readonly written: () => readonly { path: string; contents: string }[];
  /** How many times each method was called. */
  readonly calls: Record<'pickCv' | 'pickBackup' | 'saveBackup', number>;
}

export function createFakeFilePort(): FakeFilePort {
  let cv: PickedCv | null = null;
  let cvFailure: string | null = null;
  let backup: PickedBackup | null = null;
  let backupFailure: string | null = null;
  let savePath: string | null = 'C:\\Users\\steve\\Documents\\cviper-backup.json';
  let saveFailure: string | null = null;
  const written: { path: string; contents: string }[] = [];
  const calls = { pickCv: 0, pickBackup: 0, saveBackup: 0 };

  return {
    calls,
    written: () => written,
    nextCv: (next) => {
      cv = next;
      cvFailure = null;
    },
    failCv: (message) => {
      cvFailure = message;
    },
    nextBackup: (next) => {
      backup = next;
      backupFailure = null;
    },
    failBackup: (message) => {
      backupFailure = message;
    },
    nextSavePath: (path) => {
      savePath = path;
      saveFailure = null;
    },
    failSave: (message) => {
      saveFailure = message;
    },

    async pickCv() {
      calls.pickCv += 1;
      if (cvFailure !== null) return err({ message: cvFailure });
      return ok(cv);
    },

    async pickBackup() {
      calls.pickBackup += 1;
      if (backupFailure !== null) return err({ message: backupFailure });
      return ok(backup);
    },

    async saveBackup(contents) {
      calls.saveBackup += 1;
      if (saveFailure !== null) return err({ message: saveFailure });
      // Cancelled: nothing is written, exactly as the real port behaves.
      if (savePath === null) return ok(null);
      written.push({ path: savePath, contents });
      return ok(savePath);
    },
  };
}
