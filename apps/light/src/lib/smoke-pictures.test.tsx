// @vitest-environment jsdom
/**
 * L-363 — the smoke job's pictures, and the in-page checks that stop a picture
 * of the wrong screen being saved (`e2e/smokePictures.ts`).
 *
 * The checks are strings WebDriver runs inside the real app. Here the same
 * strings run against the real components — the tracker card's progress row,
 * the step bar and the ATS Score table, fed the started job's own seeded data —
 * so a check that could never pass, or never fail, is caught before CI spends
 * a Windows build finding out.
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CHECK_ATS_TABLE,
  CHECK_CARD_PROGRESS,
  CHECK_STEP_BAR,
  SMOKE_PICTURES,
} from '../../e2e/smokePictures.ts';
import {
  STARTED_APPLICATION_ID,
  STARTED_CV_TEXT,
  STARTED_JOB_TITLE,
  startedJobWorkflowValues,
} from '../../e2e/demoStartedJob.ts';
import { CardProgress } from '../features/flow/CardProgress';
import { JobStepBar } from '../features/flow/JobStepBar';
import { isStarted, type JobProgress, type StepId } from '../features/flow/steps';
import { AtsStep } from '../features/tailor/AtsStep';
import { compareAts, type AtsComparison } from '../features/tailor/atsComparison';
import { fromRow } from '../features/tailor/persistence';

const APP_ID = STARTED_APPLICATION_ID;
const STARTED: JobProgress = { analysed: true, tailored: true, exported: false };

/** Run a check the way WebDriver's executeScript does: a function body, with `arguments`. */
function runCheck(script: string, ...args: unknown[]): string {
  // The exact string WebDriver runs, as a function body.
  const check = new Function(script) as (...values: unknown[]) => unknown;
  const answer = check(...args);
  if (typeof answer !== 'string') throw new Error(`a check returned ${String(answer)}`);
  return answer;
}

interface Box {
  readonly top: number;
  readonly left: number;
  readonly bottom: number;
  readonly right: number;
}

/** jsdom lays nothing out, so every element is given this box. */
function everythingAt(box: Box): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    ...box,
    x: box.left,
    y: box.top,
    width: box.right - box.left,
    height: box.bottom - box.top,
    toJSON: () => box,
  } as DOMRect);
}

const INSIDE: Box = { top: 120, left: 40, bottom: 480, right: 900 };

/** The started job's draft, read back the way Tailor reads it at launch. */
function startedComparison(): AtsComparison {
  const [id, step, cvId, aiOption, advert, draftJson, updatedAt] = startedJobWorkflowValues(
    new Date('2026-11-11T12:00:00.000Z'),
  );
  const session = fromRow({
    id: id ?? '',
    step: step ?? '',
    cv_id: cvId ?? null,
    ai_option: aiOption ?? null,
    advert: advert ?? '',
    draft_json: draftJson ?? null,
    updated_at: updatedAt ?? '',
  });
  if (session.result === null) throw new Error('the seeded draft did not read back');
  return compareAts({
    originalCv: STARTED_CV_TEXT,
    tailoredCv: session.result.text,
    jobText: session.advert,
  });
}

/**
 * A card as the tracker column draws it: the card, and the progress row under
 * it only for a job that has been started (`TrackerColumn`, `isStarted`).
 */
function renderCard(progress: JobProgress = STARTED) {
  render(
    <ul>
      <li>
        <button type="button" data-testid={`tracker-card-${APP_ID}`}>
          {STARTED_JOB_TITLE}
        </button>
        {isStarted(progress) ? (
          <CardProgress applicationId={APP_ID} progress={progress} onContinue={() => undefined} />
        ) : null}
      </li>
    </ul>,
  );
}

function renderBar(current: StepId, title = STARTED_JOB_TITLE) {
  render(
    <JobStepBar
      title={title}
      company="Larkspur Water Services"
      location="Sheffield"
      current={current}
      progress={STARTED}
      onStep={() => undefined}
    />,
  );
}

function renderAts(current: StepId, comparison: AtsComparison) {
  renderBar(current);
  render(<AtsStep comparison={comparison} fabrication={{ clean: true, flagged: 0 }} />);
}

beforeEach(() => {
  everythingAt(INSIDE);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the smoke pictures (L-363)', () => {
  it('saves the five L-244 pictures under their old names, then the three of a started job', () => {
    expect(SMOKE_PICTURES).toEqual([
      '1-tracker',
      '2-tracker-application',
      '3-analysis',
      '4-search',
      '5-settings',
      '6-tracker-card-progress',
      '7-step-bar',
      '8-ats-table',
    ]);
  });

  it('every name is unique, numbered in order, and safe as a file name', () => {
    expect(new Set(SMOKE_PICTURES).size).toBe(SMOKE_PICTURES.length);
    SMOKE_PICTURES.forEach((name, index) => {
      expect(name).toMatch(/^[1-9]-[a-z]+(-[a-z]+)*$/);
      expect(name.startsWith(`${String(index + 1)}-`)).toBe(true);
    });
  });
});

describe('6-tracker-card-progress: the check before the picture', () => {
  const DOTS = ['dot', 'dot', 'dot', 'ring', 'ring'];

  it('happy: passes on the started job card, ●●●○○, wholly on screen', () => {
    renderCard();
    expect(runCheck(CHECK_CARD_PROGRESS, APP_ID, DOTS)).toBe('');
  });

  it('negative: fails on a card with no progress row — a job nobody started', () => {
    renderCard({ analysed: false, tailored: false, exported: false });
    expect(runCheck(CHECK_CARD_PROGRESS, APP_ID, DOTS)).toMatch(/no progress row/);
  });

  it('negative: fails when the dots are not the started job’s', () => {
    renderCard({ analysed: true, tailored: false, exported: false });
    expect(runCheck(CHECK_CARD_PROGRESS, APP_ID, DOTS)).toMatch(/draws dot, dot, ring/);
  });

  it('negative: fails when the card is not on screen at all', () => {
    renderCard();
    expect(runCheck(CHECK_CARD_PROGRESS, 'demo-app-somebody-else', DOTS)).toMatch(
      /no tracker card/,
    );
  });

  it('boundary: fails when the card runs off the bottom of the window', () => {
    renderCard();
    everythingAt({ ...INSIDE, bottom: window.innerHeight + 1 });
    expect(runCheck(CHECK_CARD_PROGRESS, APP_ID, DOTS)).toMatch(/not wholly inside the window/);
  });

  it('boundary: passes when the card ends exactly at the window’s edge', () => {
    renderCard();
    everythingAt({ ...INSIDE, bottom: window.innerHeight, right: window.innerWidth });
    expect(runCheck(CHECK_CARD_PROGRESS, APP_ID, DOTS)).toBe('');
  });

  it('boundary: fails when the card takes up no space (hidden, or not laid out)', () => {
    renderCard();
    everythingAt({ top: 0, left: 0, bottom: 0, right: 0 });
    expect(runCheck(CHECK_CARD_PROGRESS, APP_ID, DOTS)).toMatch(/takes up no space/);
  });
});

describe('7-step-bar: the check before the picture', () => {
  it('happy: passes on the step bar for the started job, on the Tailor step', () => {
    renderBar('tailor');
    expect(runCheck(CHECK_STEP_BAR, STARTED_JOB_TITLE, 'tailor')).toBe('');
  });

  it('negative: fails on a screen with no step bar', () => {
    render(<p>Tracker</p>);
    expect(runCheck(CHECK_STEP_BAR, STARTED_JOB_TITLE, 'tailor')).toMatch(/no step bar/);
  });

  it('negative: fails when the bar is for another job', () => {
    renderBar('tailor', 'Data Analyst');
    expect(runCheck(CHECK_STEP_BAR, STARTED_JOB_TITLE, 'tailor')).toMatch(
      /not for Insight Analyst/,
    );
  });

  it('negative: fails when the bar is on another step', () => {
    renderBar('ats');
    expect(runCheck(CHECK_STEP_BAR, STARTED_JOB_TITLE, 'tailor')).toMatch(/not on tailor/);
  });

  it('negative: fails when the bar draws no tick — a job with nothing done', () => {
    render(
      <JobStepBar
        title={STARTED_JOB_TITLE}
        company="Larkspur Water Services"
        location="Sheffield"
        current="find"
        progress={{ analysed: false, tailored: false, exported: false }}
        onStep={() => undefined}
      />,
    );
    expect(runCheck(CHECK_STEP_BAR, STARTED_JOB_TITLE, 'find')).toMatch(/draws no tick/);
  });

  it('boundary: fails when the bar is pushed above the top of the window', () => {
    renderBar('tailor');
    everythingAt({ ...INSIDE, top: -1 });
    expect(runCheck(CHECK_STEP_BAR, STARTED_JOB_TITLE, 'tailor')).toMatch(/not wholly inside/);
  });
});

describe('8-ats-table: the check before the picture', () => {
  it('the started job’s own draft scores up, down, tick, warning and cross', () => {
    const comparison = startedComparison();
    expect(comparison.keyword.delta ?? 0).toBeGreaterThan(0);
    expect(comparison.bullets.delta).toBeLessThan(0);
    const statuses = new Set(comparison.checks.flatMap((check) => [check.before, check.after]));
    expect([...statuses].sort()).toEqual(['fail', 'pass', 'warn']);
  });

  it('happy: passes on the started job’s ATS table, on the ATS Score step', () => {
    renderAts('ats', startedComparison());
    expect(runCheck(CHECK_ATS_TABLE, STARTED_JOB_TITLE)).toBe('');
  });

  it('negative: fails when the step bar is on Tailor, not ATS Score', () => {
    renderAts('tailor', startedComparison());
    expect(runCheck(CHECK_ATS_TABLE, STARTED_JOB_TITLE)).toMatch(/not on ATS Score/);
  });

  it('negative: fails on a screen with no ATS table — a job with no draft', () => {
    renderBar('ats');
    expect(runCheck(CHECK_ATS_TABLE, STARTED_JOB_TITLE)).toMatch(/no ATS Score section/);
  });

  it('negative: fails when a mark is missing — every row OK and nothing changed', () => {
    const flat = startedComparison();
    renderAts('ats', {
      ...flat,
      keyword: { ...flat.keyword, delta: 0 },
      bullets: { ...flat.bullets, delta: 0 },
      checks: flat.checks.map((check) => ({ ...check, before: 'pass', after: 'pass' })),
    });
    expect(runCheck(CHECK_ATS_TABLE, STARTED_JOB_TITLE)).toMatch(
      /draws no warning, cross, up, down mark/,
    );
  });

  it('boundary: fails when the table is cut off by the bottom of the window', () => {
    renderAts('ats', startedComparison());
    everythingAt({ ...INSIDE, bottom: window.innerHeight + 40 });
    expect(runCheck(CHECK_ATS_TABLE, STARTED_JOB_TITLE)).toMatch(/not wholly inside the window/);
  });
});
