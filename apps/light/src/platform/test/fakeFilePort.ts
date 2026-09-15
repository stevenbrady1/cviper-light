import { err, ok } from '@cviper/core-types';

import { type FilePort, type PickedBackup, type PickedCv, type WorkspaceFiles } from '../files';

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
  /** Everything `saveCvJson` was asked to write, in order (L-20b). */
  readonly writtenCvJson: () => readonly { path: string; contents: string }[];
  /** Everything `saveText` was asked to write, in order (L-160). */
  readonly writtenText: () => readonly { path: string; contents: string; extension: string }[];
  /**
   * Everything `saveBytes` was asked to write, in order (L-165). The
   * suggested name is recorded too: the Word export is the one save whose
   * name carries an extension the test cares about.
   */
  readonly writtenBytes: () => readonly {
    path: string;
    bytes: Uint8Array;
    suggestedName: string;
    extension: string;
  }[];
  /** The next `pickProfileWorkspace` answers with these files (L-167). `null` is a cancel. */
  readonly nextWorkspace: (files: WorkspaceFiles | null) => void;
  /** The next `pickProfileWorkspace` fails with this message. */
  readonly failWorkspace: (message: string) => void;
  /** How many times each method was called. */
  readonly calls: Record<
    | 'pickCv'
    | 'pickBackup'
    | 'saveBackup'
    | 'saveCvJson'
    | 'saveText'
    | 'pickProfileWorkspace'
    | 'saveBytes',
    number
  >;
}

export function createFakeFilePort(): FakeFilePort {
  let cv: PickedCv | null = null;
  let cvFailure: string | null = null;
  let backup: PickedBackup | null = null;
  let backupFailure: string | null = null;
  let savePath: string | null = 'C:\\Users\\steve\\Documents\\cviper-backup.json';
  let saveFailure: string | null = null;
  const written: { path: string; contents: string }[] = [];
  const writtenCvJson: { path: string; contents: string }[] = [];
  const writtenText: { path: string; contents: string; extension: string }[] = [];
  let workspace: WorkspaceFiles | null = null;
  let workspaceFailure: string | null = null;
  const writtenBytes: {
    path: string;
    bytes: Uint8Array;
    suggestedName: string;
    extension: string;
  }[] = [];
  const calls = {
    pickCv: 0,
    pickBackup: 0,
    saveBackup: 0,
    saveCvJson: 0,
    saveText: 0,
    pickProfileWorkspace: 0,
    saveBytes: 0,
  };

  return {
    calls,
    written: () => written,
    writtenCvJson: () => writtenCvJson,
    writtenText: () => writtenText,
    writtenBytes: () => writtenBytes,
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
    nextWorkspace: (next) => {
      workspace = next;
      workspaceFailure = null;
    },
    failWorkspace: (message) => {
      workspaceFailure = message;
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

    // The same save-dialog fakes (`nextSavePath`, `failSave`) drive this one:
    // a test that wants a cancel or a failure sets them exactly as for a backup.
    async saveCvJson(contents) {
      calls.saveCvJson += 1;
      if (saveFailure !== null) return err({ message: saveFailure });
      if (savePath === null) return ok(null);
      writtenCvJson.push({ path: savePath, contents });
      return ok(savePath);
    },

    // And the same fakes again for the text export (L-160).
    async saveText(contents, _suggestedName, extension) {
      calls.saveText += 1;
      if (saveFailure !== null) return err({ message: saveFailure });
      if (savePath === null) return ok(null);
      writtenText.push({ path: savePath, contents, extension });
      return ok(savePath);
    },

    // The folder picker (L-167): a workspace, a cancel, or a refusal.
    async pickProfileWorkspace() {
      calls.pickProfileWorkspace += 1;
      if (workspaceFailure !== null) return err({ message: workspaceFailure });
      return ok(workspace);
    },

    // And once more for the Word export (L-165).
    async saveBytes(bytes, suggestedName, extension) {
      calls.saveBytes += 1;
      if (saveFailure !== null) return err({ message: saveFailure });
      if (savePath === null) return ok(null);
      writtenBytes.push({ path: savePath, bytes, suggestedName, extension });
      return ok(savePath);
    },
  };
}
