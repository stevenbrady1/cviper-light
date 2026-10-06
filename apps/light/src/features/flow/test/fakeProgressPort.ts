import { NO_SAVED_PROGRESS, type JobProgressPort, type SavedProgress } from '../progress';

/** A `JobProgressPort` that answers from a table, and records which jobs were asked about. */
export function createFakeProgressPort(
  byJob: Readonly<Record<string, Partial<SavedProgress>>> = {},
): JobProgressPort & { readonly asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    async load(jobId) {
      asked.push(jobId);
      return { ...NO_SAVED_PROGRESS, ...byJob[jobId] };
    },
  };
}
