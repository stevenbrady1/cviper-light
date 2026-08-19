import { useCallback, useMemo, useState } from 'react';

import {
  BACKUP_SCHEMA_VERSION,
  exportBackup,
  importBackup,
  type BackupPayload,
} from '@cviper/core-types';

import { PRIMARY_BUTTON, SECONDARY_BUTTON } from '../../app/buttons';
import { ViewHeader } from '../../app/ViewHeader';
import { viewById } from '../../app/views';
import { createTauriFilePort, type FilePort } from '../../platform/files';

import {
  APP_NAME,
  APP_VERSION,
  createDbBackupPort,
  defaultBackupFilename,
  describeBackupError,
  describeCounts,
  type BackupCounts,
  type BackupPort,
  type BackupProblem,
} from './backup';

/**
 * Settings — for now, the one thing that matters most: getting your data out.
 *
 * ============================================================================
 * IMPORT STATES THE COUNTS BEFORE IT WRITES ANYTHING.
 * ============================================================================
 * A backup file is months of work and there is no undo. `importBackup` has
 * already validated the whole file by the time this screen has anything to say,
 * so showing what is in it costs nothing and turns "I hope this is the right
 * file" into "43 jobs, 12 applications, 2 CVs — yes, that is the one".
 *
 * The confirmation also says what import does NOT do. `writeAll` MERGES: every
 * row is an upsert keyed on id, and nothing is ever deleted. People expect
 * "restore" to mean "replace", and finding out afterwards that it did not is a
 * bad surprise in one direction; finding out that it DID would be a disaster in
 * the other. So it is stated up front, before the button.
 *
 * ============================================================================
 * NOTHING HERE TOUCHES THE NETWORK
 * ============================================================================
 * Reading the database, serialising it and writing a file the user named. That
 * is the whole operation, and the copy says so — because "export" is exactly
 * the word that makes people wonder where their CV just went.
 */

/** What the screen is doing. */
type Stage =
  | { readonly kind: 'idle' }
  | { readonly kind: 'busy'; readonly what: 'export' | 'import' }
  | { readonly kind: 'confirm'; readonly payload: BackupPayload; readonly from: string };

export interface SettingsProps {
  /** Injected by tests. Defaults to the real SQLite-backed port. */
  readonly port?: BackupPort | undefined;
  /** Injected by tests. Defaults to the OS dialog plus the Rust file commands. */
  readonly filePort?: FilePort | undefined;
  /** Injected by tests so the suggested filename is deterministic. */
  readonly now?: Date | undefined;
}

/**
 * Count what is in a snapshot or a payload.
 *
 * Structural rather than typed to either, because `DbSnapshot` and
 * `BackupPayload` carry the same four collections and both sides of this screen
 * need the same sentence out of them.
 */
function countsOf(source: {
  readonly jobs: readonly unknown[];
  readonly applications: readonly unknown[];
  readonly cvs: readonly unknown[];
  readonly analyses: readonly unknown[];
}): BackupCounts {
  return {
    jobs: source.jobs.length,
    applications: source.applications.length,
    cvs: source.cvs.length,
    analyses: source.analyses.length,
  };
}

export function Settings({ port, filePort, now }: SettingsProps = {}) {
  const backupPort = useMemo(() => port ?? createDbBackupPort(), [port]);
  const files = useMemo(() => filePort ?? createTauriFilePort(), [filePort]);

  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  const [message, setMessage] = useState<string | null>(null);
  const [problem, setProblem] = useState<BackupProblem | null>(null);

  const onExport = useCallback(async () => {
    setMessage(null);
    setProblem(null);
    setStage({ kind: 'busy', what: 'export' });

    const snapshot = await backupPort.read();
    if (!snapshot.ok) {
      setStage({ kind: 'idle' });
      setProblem({
        headline: 'Your data could not be read, so nothing was exported.',
        detail: `${snapshot.error.message} Everything is still on this machine — nothing has been lost.`,
      });
      return;
    }

    const clock = now ?? new Date();
    const text = exportBackup({
      schemaVersion: BACKUP_SCHEMA_VERSION,
      // Taken from the clock ONCE, here. `exportBackup` deliberately does not
      // read a clock of its own, so the same data always produces the same
      // bytes — see the note on determinism in `core-types/backup.ts`.
      exportedAt: clock.toISOString(),
      app: { name: APP_NAME, version: APP_VERSION },
      ...snapshot.value,
    });

    const saved = await files.saveBackup(text, defaultBackupFilename(clock));
    setStage({ kind: 'idle' });

    if (!saved.ok) {
      setProblem({ headline: 'The backup could not be saved.', detail: saved.error.message });
      return;
    }
    // Cancelled. Nothing happened, and nothing is said about it.
    if (saved.value === null) return;

    setMessage(
      `Saved to ${saved.value}. It holds ${describeCounts(countsOf(snapshot.value))}, ` +
        'and it never left this machine.',
    );
  }, [backupPort, files, now]);

  const onChooseImport = useCallback(async () => {
    setMessage(null);
    setProblem(null);
    setStage({ kind: 'busy', what: 'import' });

    const picked = await files.pickBackup();
    if (!picked.ok) {
      setStage({ kind: 'idle' });
      setProblem({ headline: 'That file could not be opened.', detail: picked.error.message });
      return;
    }
    if (picked.value === null) {
      setStage({ kind: 'idle' });
      return;
    }

    // Validated in full BEFORE anything is written, and before the user is
    // asked to confirm. There is no point asking somebody to approve an import
    // that was never going to work.
    const payload = importBackup(picked.value.text);
    if (!payload.ok) {
      setStage({ kind: 'idle' });
      setProblem(describeBackupError(payload.error));
      return;
    }

    setStage({ kind: 'confirm', payload: payload.value, from: picked.value.name });
  }, [files]);

  const onConfirmImport = useCallback(async () => {
    if (stage.kind !== 'confirm') return;
    const { payload, from } = stage;

    setStage({ kind: 'busy', what: 'import' });

    const written = await backupPort.write({
      jobs: payload.jobs,
      applications: payload.applications,
      cvs: payload.cvs,
      analyses: payload.analyses,
    });

    setStage({ kind: 'idle' });

    if (!written.ok) {
      setProblem({
        headline: 'The import could not be written, so nothing was changed.',
        detail: `${written.error.message} An import is one transaction: it either all lands or none of it does.`,
      });
      return;
    }

    setMessage(`Imported ${describeCounts(countsOf(payload))} from ${from}.`);
  }, [backupPort, stage]);

  const busy = stage.kind === 'busy';
  const confirming = stage.kind === 'confirm';
  const view = viewById('settings');

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="view-settings">
      <ViewHeader
        title={view.label}
        summary={view.summary}
        /*
         * The view's ONE blue button — except while the import confirmation is
         * up, when it is disabled and the confirm button takes over. Disabled
         * rather than hidden, so the control does not move about, and so there
         * is never more than one enabled primary on screen.
         */
        action={
          <button
            type="button"
            data-testid="settings-export"
            data-primary="true"
            disabled={busy || confirming}
            onClick={() => void onExport()}
            className={PRIMARY_BUTTON}
          >
            {stage.kind === 'busy' && stage.what === 'export' ? 'Exporting…' : 'Export my data'}
          </button>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="max-w-2xl space-y-6">
          <section>
            <h2 className="font-medium text-ink">Your data</h2>
            <p className="mt-1 text-ink-muted">
              Everything CViper Light knows lives in one file on this computer: the jobs you have
              saved, the applications you are chasing, the text of your CVs and every check you have
              run. Exporting writes all of it into a single <code>.json</code> file that you choose
              the location of. Nothing is uploaded, and nothing is sent anywhere — the file goes
              exactly where you put it and nowhere else.
            </p>

            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                data-testid="settings-import"
                disabled={busy || confirming}
                onClick={() => void onChooseImport()}
                className={SECONDARY_BUTTON}
              >
                Import a backup
              </button>
              <span className="text-xs text-ink-faint">
                Adds what is in the file to what is already here. Nothing is deleted.
              </span>
            </div>
          </section>

          {message === null ? null : (
            <p
              role="status"
              data-testid="settings-message"
              className="rounded-control bg-teal/10 px-3 py-2 break-all text-teal"
            >
              {message}
            </p>
          )}

          {problem === null ? null : (
            <div
              role="alert"
              data-testid="settings-problem"
              className="rounded-control bg-danger/5 px-3 py-2 text-danger"
            >
              <p className="font-medium">{problem.headline}</p>
              <p className="mt-1 whitespace-pre-line text-ink-muted">{problem.detail}</p>
            </div>
          )}

          {stage.kind === 'confirm' ? (
            <div
              data-testid="settings-confirm"
              className="rounded-card border border-line bg-card p-4 shadow-raised"
            >
              <h3 className="font-medium text-ink">Import from {stage.from}?</h3>

              {/*
                The counts, before a single row is written. This is the whole
                point of the confirmation step: it turns "I hope this is the
                right file" into a fact the user can check.
              */}
              <p data-testid="settings-counts" className="mt-1 text-ink">
                This will add or update {describeCounts(countsOf(stage.payload))}.
              </p>
              <p className="mt-1 text-ink-muted">
                Anything already on this machine is kept. Records with the same id are updated;
                nothing is deleted. It happens as one transaction, so it either all lands or none of
                it does.
              </p>

              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  data-testid="settings-confirm-import"
                  data-primary="true"
                  onClick={() => void onConfirmImport()}
                  className={PRIMARY_BUTTON}
                >
                  Import these records
                </button>
                <button
                  type="button"
                  data-testid="settings-cancel-import"
                  onClick={() => setStage({ kind: 'idle' })}
                  className={SECONDARY_BUTTON}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          <section>
            <h2 className="font-medium text-ink">API keys</h2>
            <p className="mt-1 text-ink-muted">
              Key entry is not built yet. Until it is, the app works without one: the tracker is
              entirely offline, and the analysis screen offers a basic keyword match that needs no
              account and no key. The rail on the left already shows what this machine has saved.
            </p>
          </section>
        </div>
      </div>
    </section>
  );
}
