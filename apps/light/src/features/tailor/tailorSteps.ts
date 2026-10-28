import { type StepId } from '../flow/steps';

/** The three steps that are the Tailor screen's own (L-200). */
export type TailorStep = 'tailor' | 'ats' | 'export';

/** Where each of the screen's steps is on the page, to scroll to. */
export const STEP_ANCHOR: Readonly<Record<TailorStep, string>> = {
  tailor: 'tailor-step-tailor',
  ats: 'tailor-step-ats',
  export: 'tailor-step-export',
};

export function isTailorStep(step: StepId): step is TailorStep {
  return step === 'tailor' || step === 'ats' || step === 'export';
}

/** What the consent gate is waiting to run, once the user has answered. */
export type PendingAction = 'tailor' | 'review' | 'letter';
