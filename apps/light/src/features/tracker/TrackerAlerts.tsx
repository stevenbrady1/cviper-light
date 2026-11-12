import { SECONDARY_BUTTON } from '../../app/buttons';
import { ErrorBox } from '../../ui';

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
        <ErrorBox variant="strip" layout="row" testId="tracker-error">
          <span className="min-w-0">{error}</span>
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
        </ErrorBox>
      )}

      {substagesFailed === null ? null : (
        <ErrorBox variant="strip" layout="row" testId="tracker-substages-error">
          <span className="min-w-0">
            {`Your interview stages could not be read: ${substagesFailed} The board is shown without them.`}
          </span>
          <button type="button" className={SECONDARY_BUTTON} onClick={() => void loadSubstages()}>
            Retry
          </button>
        </ErrorBox>
      )}
    </>
  );
}
