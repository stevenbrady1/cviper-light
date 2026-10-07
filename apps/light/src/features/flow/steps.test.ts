/**
 * L-200: the five steps of one job, and what each one says.
 *
 * Steps are NEVER locked. Jumping ahead marks the steps passed over as
 * skipped (⊘), not blocked, and a step done earlier stays done wherever the
 * user is now.
 */
import { describe, expect, it } from 'vitest';

import {
  STEPS,
  continueStep,
  isStarted,
  nextStep,
  previousStep,
  stepStates,
  type JobProgress,
} from './steps';

const NOTHING: JobProgress = { analysed: false, tailored: false, exported: false };

function states(current: Parameters<typeof stepStates>[0], progress: JobProgress = NOTHING) {
  return stepStates(current, progress).map((step) => `${step.id}:${step.state}`);
}

describe('stepStates', () => {
  it('names the five steps in order', () => {
    expect(STEPS.map((step) => step.label)).toEqual([
      'Find',
      'Analyse',
      'Tailor',
      'ATS Score',
      'Export',
    ]);
  });

  it('happy: walked in order — everything before is done, the rest is to do', () => {
    expect(states('tailor', { analysed: true, tailored: false, exported: false })).toEqual([
      'find:done',
      'analyse:done',
      'tailor:current',
      'ats:todo',
      'export:todo',
    ]);
  });

  it('skipped: straight to Tailor without analysing marks Analyse ⊘, never blocked', () => {
    expect(states('tailor')).toEqual([
      'find:done',
      'analyse:skipped',
      'tailor:current',
      'ats:todo',
      'export:todo',
    ]);
  });

  it('a step done earlier stays done when the user goes back', () => {
    expect(states('analyse', { analysed: true, tailored: true, exported: true })).toEqual([
      'find:done',
      'analyse:current',
      'tailor:done',
      'ats:done',
      'export:done',
    ]);
  });

  it('ATS Score is done once there is a draft and the user has moved past it', () => {
    const progress = { analysed: true, tailored: true, exported: false };
    expect(states('tailor', progress)).toContain('ats:todo');
    expect(states('export', progress)).toEqual([
      'find:done',
      'analyse:done',
      'tailor:done',
      'ats:done',
      'export:current',
    ]);
  });

  it('boundary: on the first step nothing is skipped; on the last, every gap is', () => {
    expect(states('find')).toEqual([
      'find:current',
      'analyse:todo',
      'tailor:todo',
      'ats:todo',
      'export:todo',
    ]);
    expect(states('export')).toEqual([
      'find:done',
      'analyse:skipped',
      'tailor:skipped',
      'ats:skipped',
      'export:current',
    ]);
  });
});

describe('previousStep / nextStep', () => {
  it('walk the five steps in order', () => {
    expect(nextStep('analyse')).toBe('tailor');
    expect(previousStep('tailor')).toBe('analyse');
  });

  it('boundary: there is nothing before Find and nothing after Export', () => {
    expect(previousStep('find')).toBeNull();
    expect(nextStep('export')).toBeNull();
  });
});

describe('continueStep / isStarted', () => {
  it('goes to the first thing still to do', () => {
    expect(continueStep({ analysed: true, tailored: false, exported: false })).toBe('tailor');
    expect(continueStep({ analysed: true, tailored: true, exported: false })).toBe('ats');
  });

  it('a draft without an analysis goes on from the draft, not back to Analyse', () => {
    expect(continueStep({ analysed: false, tailored: true, exported: false })).toBe('ats');
  });

  it('boundary: nothing done goes to Analyse; everything done opens on Export', () => {
    expect(continueStep(NOTHING)).toBe('analyse');
    expect(continueStep({ analysed: true, tailored: true, exported: true })).toBe('export');
  });

  it('a job is started once anything beyond Find has happened', () => {
    expect(isStarted(NOTHING)).toBe(false);
    expect(isStarted({ analysed: false, tailored: false, exported: true })).toBe(true);
  });
});
