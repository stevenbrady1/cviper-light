import { useCallback, useMemo, useState } from 'react';

import { DESTRUCTIVE_BUTTON, SECONDARY_BUTTON } from '../../../app/buttons';
import { describeCounts, type BackupCounts, type BackupPort } from '../backup';
import { DATA_LOCATIONS } from '../privacy/dataLocations';

import {
  ERASE_STEPS,
  locationsErasedBy,
  runErase,
  summariseErase,
  type EraseSummary,
} from './model';
import { createTauriErasePort, type ErasePort } from './port';

/**
 * Delete everything — the local-first answer to "delete my account".
 *
 * ============================================================================
 * THE COUNTS, BEFORE THE BUTTON THAT CANNOT BE UNDONE
 * ============================================================================
 * Exactly as the import confirmation does: the database is read and counted
 * first, so the confirmation says "43 jobs, 12 applications and 2 CVs" rather
 * than "your data". A number is something the user can check against what
 * they expected; a noun is not. If the count itself fails the confirmation
 * still appears — the user asked to delete, and a database that cannot be
 * read is not a reason to keep it — but it says so.
 *
 * ============================================================================
 * TWO PRESSES, TWO DIFFERENT BUTTONS, NOTHING HIDDEN
 * ============================================================================
 * The first button opens the confirmation; the second, differently worded,
 * does the deleting. Both are always rendered — disabled while busy, never
 * removed — so nothing on this screen moves about, and neither carries
 * `data-primary`: the view's one blue button stays "Export my data", which is
 * the thing a person should do first.
 */

type Stage =
  | { readonly kind: 'idle' }
  | { readonly kind: 'counting' }
  | { readonly kind: 'confirm'; readonly counts: BackupCounts | null }
  | { readonly kind: 'erasing' };

export interface EraseEverythingProps {
  /** Injected by tests. Defaults to the real database, credential store and file port. */
  readonly port?: ErasePort | undefined;
  /** Read once, to count what is about to go. */
  readonly backupPort: BackupPort;
  /**
   * Called after everything was deleted, so the shell can return to the
   * first-run state. Not called after a partial failure: the screen stays,
   * with the problem, so the user can act on it.
   */
  readonly onErased?: (() => void) | undefined;
}

export function EraseEverything({ port, backupPort, onErased }: EraseEverythingProps) {
  const erasePort = useMemo(() => port ?? createTauriErasePort(), [port]);

  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  const [summary, setSummary] = useState<EraseSummary | null>(null);

  const onBegin = useCallback(async () => {
    setSummary(null);
    setStage({ kind: 'counting' });
    const snapshot = await backupPort.read();
    setStage({
      kind: 'confirm',
      counts: snapshot.ok
        ? {
            jobs: snapshot.value.jobs.length,
            applications: snapshot.value.applications.length,
            cvs: snapshot.value.cvs.length,
            analyses: snapshot.value.analyses.length,
          }
        : null,
    });
  }, [backupPort]);

  const onConfirm = useCallback(async () => {
    setStage({ kind: 'erasing' });
    const outcomes = await runErase(erasePort);
    const result = summariseErase(outcomes);
    setSummary(result);
    setStage({ kind: 'idle' });
    if (result.allDone) onErased?.();
  }, [erasePort, onErased]);

  const busy = stage.kind === 'counting' || stage.kind === 'erasing';
  const confirming = stage.kind === 'confirm';

  return (
    <section data-testid="settings-erase-section">
      <h2 className="font-medium text-ink">Delete everything</h2>
      <p className="mt-1 text-ink-muted">
        Removes every trace of CViper Light from this computer except the program itself: the
        database, every API key it saved, and every preference. There is no account to close because
        there is no account. There is no undo — export your data first if you might want it back.
      </p>

      <button
        type="button"
        data-testid="settings-erase"
        disabled={busy || confirming}
        onClick={() => void onBegin()}
        className={`mt-3 ${DESTRUCTIVE_BUTTON}`}
      >
        {stage.kind === 'counting'
          ? 'Counting…'
          : stage.kind === 'erasing'
            ? 'Deleting…'
            : 'Delete everything…'}
      </button>

      {stage.kind === 'confirm' ? (
        <div
          data-testid="settings-erase-confirm-panel"
          className="mt-3 rounded-card border border-danger/40 bg-card p-4 shadow-raised"
        >
          <h3 className="font-medium text-ink">Delete everything on this computer?</h3>

          <p data-testid="settings-erase-counts" className="mt-1 text-ink">
            {stage.counts === null
              ? 'The database could not be read to count what is in it. Deleting will still empty it.'
              : `This will delete ${describeCounts(stage.counts)}, every saved API key and every preference.`}
          </p>

          <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-muted">
            {ERASE_STEPS.flatMap((step) =>
              locationsErasedBy(step).map((what) => <li key={what}>{what}</li>),
            )}
          </ul>

          <p className="mt-2 text-xs text-ink-faint">
            {DATA_LOCATIONS.length} places, all on this computer. Nothing is sent anywhere to do
            this, and nothing needs to be — there is no copy of your data anywhere else to delete.
          </p>

          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              data-testid="settings-erase-confirm"
              onClick={() => void onConfirm()}
              className={DESTRUCTIVE_BUTTON}
            >
              Delete all of it
            </button>
            <button
              type="button"
              data-testid="settings-erase-cancel"
              onClick={() => setStage({ kind: 'idle' })}
              className={SECONDARY_BUTTON}
            >
              Keep my data
            </button>
          </div>
        </div>
      ) : null}

      {summary === null ? null : summary.allDone ? (
        <p
          role="status"
          data-testid="settings-erase-message"
          className="mt-3 rounded-control bg-teal/10 px-3 py-2 text-teal"
        >
          {summary.headline}
        </p>
      ) : (
        <div
          role="alert"
          data-testid="settings-erase-problem"
          className="mt-3 rounded-control bg-danger/5 px-3 py-2 text-danger"
        >
          <p className="font-medium">{summary.headline}</p>
          <ul className="mt-1 list-disc pl-5 text-ink-muted">
            {summary.failures.map((failure) => (
              <li key={failure}>{failure}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
