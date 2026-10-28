import { type Analysis as AnalysisRow } from '@cviper/core-types';

import { DetailPane } from '../../app/DetailPane';

import { providerLabel } from './model';

export interface AnalysisHistoryProps {
  /** The CV's name, under the pane's title. */
  readonly cvName: string;
  readonly history: readonly AnalysisRow[];
  readonly onClose: () => void;
}

/** "Past checks" for the chosen CV, newest first, in the side pane. */
export function AnalysisHistory({ cvName, history, onClose }: AnalysisHistoryProps) {
  return (
    <DetailPane title="Past checks" subtitle={cvName} onClose={onClose}>
      {history.length === 0 ? (
        <p data-testid="analysis-history-empty" className="text-ink-muted">
          This CV has not been checked against anything yet.
        </p>
      ) : (
        <ul data-testid="analysis-history" className="space-y-2">
          {history.map((row) => (
            <li
              key={row.id}
              data-testid="analysis-history-row"
              className="flex items-baseline justify-between gap-2 rounded-card border border-line px-3 py-2"
            >
              <span className="min-w-0">
                <span className="block font-medium text-ink">{providerLabel(row.provider)}</span>
                <span className="block font-mono text-xs tabular-nums text-ink-faint">
                  {row.created_at.slice(0, 10)}
                </span>
              </span>
              <span className="font-mono text-lg tabular-nums text-ink">{row.match_score}</span>
            </li>
          ))}
        </ul>
      )}
    </DetailPane>
  );
}
