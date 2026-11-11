import { SECONDARY_BUTTON } from '../../app/buttons';

/**
 * The two error strips under the header: the board could not be read or a
 * change could not be saved, and the interview stages could not be read. Each
 * is drawn only while it has something to say.
 */
export interface TrackerAlertsProps {
  readonly error: string | null;
  readonly loadFailed: boolean;
  readonly loading: boolean;
  readonly loadEntries: () => Promise<void>;
  readonly substagesFailed: string | null;
  readonly loadSubstages: () => Promise<void>;
}

export function TrackerAlerts({
  error,
  loadFailed,
  loading,
  loadEntries,
  substagesFailed,
  loadSubstages,
}: TrackerAlertsProps) {
  return (
    <>
      {error === null ? null : (
        <div
          role="alert"
          data-testid="tracker-error"
          className="flex items-center justify-between gap-3 border-b border-danger/30 bg-danger/5 px-4 py-2 text-danger md:px-6"
        >
          <span>{error}</span>
          {!loadFailed ? null : (
            <button
              type="button"
              className={SECONDARY_BUTTON}
              disabled={loading}
              onClick={() => void loadEntries()}
            >
              {loading ? 'Retrying…' : 'Retry'}
            </button>
          )}
        </div>
      )}

      {substagesFailed === null ? null : (
        <div
          role="alert"
          data-testid="tracker-substages-error"
          className="flex items-center justify-between gap-3 border-b border-danger/30 bg-danger/5 px-4 py-2 text-danger md:px-6"
        >
          <span>
            {`Your interview stages could not be read: ${substagesFailed} The board is shown without them.`}
          </span>
          <button type="button" className={SECONDARY_BUTTON} onClick={() => void loadSubstages()}>
            Retry
          </button>
        </div>
      )}
    </>
  );
}
