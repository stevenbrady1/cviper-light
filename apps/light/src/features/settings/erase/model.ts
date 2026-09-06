/**
 * The pure half of "delete everything": which steps run, in what order, and
 * how the outcome is told to the user.
 */
import { type Result } from '@cviper/core-types';

import { DATA_LOCATIONS, type EraseStep } from '../privacy/dataLocations';

import { type EraseProblem, type ErasePort } from './port';

/**
 * Database first. If the credential store then refuses, the user's CV text is
 * already gone, which is the outcome they asked for; a key left behind is the
 * lesser leftover and is named in the message.
 */
export const ERASE_STEPS: readonly EraseStep[] = ['database', 'keys', 'preferences'];

export const STEP_LABELS: Readonly<Record<EraseStep, string>> = {
  database: 'your jobs, applications, CVs and analyses',
  keys: 'your API keys',
  preferences: 'your preferences',
};

export interface EraseOutcome {
  readonly step: EraseStep;
  readonly result: Result<void, EraseProblem>;
}

/**
 * Run every step, whatever happens to the others.
 *
 * Sequential, in `ERASE_STEPS` order, and never short-circuited: the whole
 * point of splitting the operation is that one refusal does not silently
 * cancel the rest. The caller gets one outcome per step and says which failed.
 */
export async function runErase(port: ErasePort): Promise<readonly EraseOutcome[]> {
  const run: Readonly<Record<EraseStep, () => Promise<Result<void, EraseProblem>>>> = {
    database: () => port.wipeDatabase(),
    keys: () => port.forgetKeys(),
    preferences: () => port.forgetPreferences(),
  };

  const outcomes: EraseOutcome[] = [];
  for (const step of ERASE_STEPS) {
    outcomes.push({ step, result: await run[step]() });
  }
  return outcomes;
}

export interface EraseSummary {
  readonly allDone: boolean;
  /** One sentence for the status line or the alert headline. */
  readonly headline: string;
  /** One line per step that refused, naming it and why. Empty when all done. */
  readonly failures: readonly string[];
}

export function summariseErase(outcomes: readonly EraseOutcome[]): EraseSummary {
  const failed = outcomes.filter((outcome) => !outcome.result.ok);
  const done = outcomes.filter((outcome) => outcome.result.ok);

  if (failed.length === 0) {
    return {
      allDone: true,
      headline:
        'Everything has been deleted from this computer. CViper Light is back to the way it was when you first installed it.',
      failures: [],
    };
  }

  const kept = failed.map((outcome) => STEP_LABELS[outcome.step]).join(' and ');
  const gone = done.map((outcome) => STEP_LABELS[outcome.step]).join(' and ');
  return {
    allDone: false,
    headline:
      done.length === 0
        ? `Nothing was deleted: ${kept} could not be removed.`
        : `Deleted ${gone}, but ${kept} could not be removed.`,
    failures: failed.map((outcome) =>
      outcome.result.ok ? '' : `${STEP_LABELS[outcome.step]}: ${outcome.result.error.message}`,
    ),
  };
}

/** Every location a step erases, for the confirmation's "this will remove" list. */
export function locationsErasedBy(step: EraseStep): readonly string[] {
  return DATA_LOCATIONS.filter((location) => location.erasedBy === step).map(
    (location) => location.what,
  );
}
