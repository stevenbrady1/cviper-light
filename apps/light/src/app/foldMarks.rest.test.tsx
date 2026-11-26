// @vitest-environment jsdom
/**
 * The six remaining folds draw the shared mark (L-466), as Settings and Search
 * already do (L-462): "Show where your CV says this" (Analysis), "What was
 * read, and what was not" (Profile), "What you changed", "Add a number or
 * result for your gaps" and "What changed against your original" (Tailor), and
 * "Last saved pack" (Tracker).
 *
 * Each title switches the browser's mark off and puts `<FoldMark />` first.
 * jsdom loads no Tailwind, so the turn is checked by asking the DOM which marks
 * the class's own selector picks. The real turn, and whole-pixel title heights,
 * are measured in WebKit (`e2e/contrast-webkit.spec.ts`).
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { type CvAnalysis, type Cv, type Document, type TailoredCv } from '@cviper/core-types';

import { AnalysisResult } from '../features/analysis/AnalysisResult';
import { type Availability } from '../features/analysis/providers';
import { ImportAiJobSearch } from '../features/profile/ImportAiJobSearchPanel';
import { FILLED } from '../features/profile/test/aiJobSearchFixtures';
import { CvTextPanel } from '../features/tailor/CvTextPanel';
import { type TailorResult } from '../features/tailor/jobSessions';
import { EMPTY_METRIC_STATE, type MetricPrompt } from '../features/tailor/metricPrompts';
import { MetricPromptBoxes } from '../features/tailor/MetricPromptBoxes';
import { TailorDraft } from '../features/tailor/TailorDraft';
import { InterviewPanel } from '../features/tracker/InterviewPanel';
import { createEntry, EMPTY_DRAFT } from '../features/tracker/model';
import { createFakeTrackerPort } from '../features/tracker/test/fakePort';
import { createFakeFilePort } from '../platform/test/fakeFilePort';

afterEach(cleanup);

const TURN = '[details[open]>summary>&]:rotate-90';

/** Whether the turn's own selector picks this mark, as the built CSS would. */
function turned(mark: Element): boolean {
  const variant = /^\[(.+)\]:rotate-90$/.exec(TURN)?.[1] ?? '';
  return mark.matches(variant.replaceAll('&', '*'));
}

function summaryOf(fold: HTMLDetailsElement): HTMLElement {
  const summary = fold.querySelector<HTMLElement>(':scope > summary');
  if (summary === null) throw new Error('the fold has no title');
  return summary;
}

function foldAround(testId: string): HTMLDetailsElement {
  const fold = screen.getByTestId(testId).closest('details');
  if (fold === null) throw new Error(`${testId} is not in a fold`);
  return fold;
}

// ---- F1: Analysis, "Show where your CV says this" --------------------------

const ANALYSIS: CvAnalysis = {
  match_score: 62,
  verdict: 'possible',
  summary: 'Keyword match only.',
  matched_skills: ['Sql', 'Python'],
  missing_skills: ['Aws'],
  keyword_gaps: [],
  matched_keywords: [],
  suggestions: [],
  ats_notes: [],
};

function renderProof(): HTMLDetailsElement {
  render(
    <AnalysisResult
      analysis={ANALYSIS}
      provider="keyword"
      model="keyword-v3"
      aiAvailable
      cvText={'- Daily SQL reporting.\n- Python scripts.'}
    />,
  );
  return screen.getByTestId('analysis-proof') as HTMLDetailsElement;
}

// ---- F2: Profile, "What was read, and what was not" -------------------------

async function renderImportNotes(): Promise<HTMLDetailsElement> {
  const files = createFakeFilePort();
  files.nextWorkspace(FILLED);
  render(<ImportAiJobSearch filePort={files} onApply={() => undefined} />);
  fireEvent.click(screen.getByTestId('profile-import-ajs'));
  await screen.findByTestId('profile-import-review');
  return foldAround('profile-import-notes');
}

// ---- F3: Tailor, "What you changed" -----------------------------------------

const CORRECTED: Cv = {
  id: 'cv-1',
  name: 'CV.pdf',
  file_path: null,
  extracted_text: 'Analyst, Barclays\n2019 – 2023',
  original_text: 'Analyst, Barclays\n2019 2023',
  created_at: '2026-08-01T09:00:00.000Z',
  json_resume: null,
};

function renderCvChanges(): HTMLDetailsElement {
  render(<CvTextPanel cv={CORRECTED} disabled={false} onSave={async () => null} />);
  return screen.getByTestId('tailor-cv-changes') as HTMLDetailsElement;
}

// ---- F4: Tailor, "Add a number or result for your gaps" ---------------------

function prompts(count: number): MetricPrompt[] {
  return Array.from({ length: count }, (_, index) => ({
    key: `skill ${String(index)}`,
    skill: `Skill ${String(index)}`,
    question: `A question about skill ${String(index)}?`,
  }));
}

function renderMetricPrompts(count = 2): HTMLDetailsElement {
  render(
    <MetricPromptBoxes
      prompts={prompts(count)}
      state={EMPTY_METRIC_STATE}
      onChange={() => undefined}
    />,
  );
  const fold = screen.getByTestId('tailor-metric-prompts').querySelector('details');
  if (fold === null) throw new Error('no gaps fold');
  return fold;
}

// ---- F5: Tailor, "What changed against your original" -----------------------

const TAILORED: TailoredCv = {
  summary: 'Credit risk analyst.',
  key_skills: ['Python'],
  experience: [
    {
      title: 'Analyst',
      company: 'Lloyds Banking Group',
      location: 'London',
      dates: '2020 – Present',
      bullets: ['Built models.'],
    },
  ],
  education: ['BSc Mathematics'],
  certifications: [],
};

const RESULT: TailorResult = {
  cv: TAILORED,
  text: 'PROFESSIONAL SUMMARY\nCredit risk analyst.',
  report: { clean: true, flagged: [] },
  provider: 'ollama',
  model: 'llama3.1:8b',
  retried: false,
  userMetrics: [],
};

function renderDraftDiff(): HTMLDetailsElement {
  render(<TailorDraft result={RESULT} cvText="Analyst." contact={null} />);
  return foldAround('tailor-diff');
}

// ---- F6: Tracker, "Last saved pack" -----------------------------------------

const ENTRY = createEntry(
  { ...EMPTY_DRAFT, title: 'Credit Risk Analyst', company: 'Lloyds Banking Group' },
  { jobId: 'job-1', applicationId: 'app-1' },
  '2026-09-01T09:00:00.000Z',
);

const LOCAL_ONLY: Availability = {
  ollamaRunning: true,
  ollamaModels: [{ id: 'llama3.2:latest', label: 'llama3.2' }],
  anthropicKey: false,
  openaiKey: false,
};

function pack(title: string): Document {
  return {
    id: 'pack-0',
    application_id: 'app-1',
    kind: 'interview_pack',
    title,
    text: 'LIKELY QUESTIONS\n\n1. An older question?\n',
    created_at: '2026-09-01T10:00:00.000Z',
  };
}

async function renderSavedPack(title = 'Interview pack — 2026-09-01'): Promise<HTMLDetailsElement> {
  const port = createFakeTrackerPort([ENTRY], { documents: [pack(title)] });
  render(
    <InterviewPanel
      entry={ENTRY}
      port={port}
      availability={LOCAL_ONLY}
      now={new Date(2026, 8, 14, 9, 0, 0)}
    />,
  );
  return (await screen.findByTestId('detail-interview-saved')) as HTMLDetailsElement;
}

// ---- The six, each with the title the user reads ----------------------------

const FOLDS: readonly {
  readonly name: string;
  readonly title: string;
  readonly open: () => HTMLDetailsElement | Promise<HTMLDetailsElement>;
}[] = [
  { name: 'F1 analysis proof', title: 'Show where your CV says this', open: renderProof },
  {
    name: 'F2 profile import notes',
    title: 'What was read, and what was not',
    open: renderImportNotes,
  },
  { name: 'F3 tailor CV changes', title: 'What you changed', open: renderCvChanges },
  {
    name: 'F4 tailor gaps',
    title: 'Add a number or result for your gaps (optional, 0 of 2 added)',
    open: () => renderMetricPrompts(),
  },
  {
    name: 'F5 tailor draft diff',
    title: 'What changed against your original',
    open: renderDraftDiff,
  },
  {
    name: 'F6 tracker saved pack',
    title: 'Last saved pack · Interview pack — 2026-09-01',
    open: () => renderSavedPack(),
  },
];

describe('the six remaining folds draw the shared mark (L-466)', () => {
  it.each(FOLDS)(
    'happy: $name puts one hidden mark first and switches the browser’s off',
    async ({ open }) => {
      const fold = await open();
      const summary = summaryOf(fold);
      expect(summary.className.split(' ')).toEqual(
        expect.arrayContaining(['list-none', '[&::-webkit-details-marker]:hidden']),
      );
      const mark = summary.firstElementChild as HTMLElement;
      expect(mark.tagName).toBe('SPAN');
      expect(mark.getAttribute('aria-hidden')).toBe('true');
      expect(mark.className.split(' ')).toContain(TURN);
      expect(mark.querySelectorAll('svg')).toHaveLength(1);
      expect(summary.querySelectorAll('svg')).toHaveLength(1);
    },
  );

  it.each(FOLDS)(
    'negative: $name keeps its exact words, and nothing turns with an outer group',
    async ({ open, title }) => {
      const fold = await open();
      expect(summaryOf(fold).textContent?.trim()).toBe(title);
      expect(fold.outerHTML).not.toContain('group-open:');
      expect(fold.classList.contains('group')).toBe(false);
    },
  );

  it.each(FOLDS)(
    'interaction: a click on $name opens it and turns its mark; a second click closes it',
    async ({ open }) => {
      const user = userEvent.setup();
      const fold = await open();
      const summary = summaryOf(fold);
      const mark = summary.firstElementChild!;
      expect(fold.open).toBe(false);
      expect(turned(mark)).toBe(false);

      await user.click(summary);
      expect(fold.open).toBe(true);
      expect(turned(mark)).toBe(true);

      await user.click(summary);
      expect(fold.open).toBe(false);
      expect(turned(mark)).toBe(false);
    },
  );

  it('boundary: fifteen gaps still draw one mark, and the count reads "0 of 15 added"', () => {
    const summary = summaryOf(renderMetricPrompts(15));
    expect(summary.textContent?.trim()).toBe(
      'Add a number or result for your gaps (optional, 0 of 15 added)',
    );
    expect(summary.querySelectorAll('svg')).toHaveLength(1);
    expect(summary.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
  });

  it('boundary: a 120-character pack title keeps one mark, first', async () => {
    const long = 'Interview pack — '.padEnd(120, 'x');
    const summary = summaryOf(await renderSavedPack(long));
    expect(long).toHaveLength(120);
    expect(summary.textContent?.trim()).toBe(`Last saved pack · ${long}`);
    expect(summary.querySelectorAll('svg')).toHaveLength(1);
    expect(summary.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
  });

  it('interaction: the mark follows its own fold only, not one opened next to it', async () => {
    const user = userEvent.setup();
    const proof = renderProof();
    const changes = renderCvChanges();
    await user.click(summaryOf(proof));
    expect(proof.open).toBe(true);
    expect(changes.open).toBe(false);
    expect(turned(summaryOf(proof).firstElementChild!)).toBe(true);
    expect(turned(summaryOf(changes).firstElementChild!)).toBe(false);
  });

  it('boundary: a closed fold inside an open one keeps its own mark unturned', async () => {
    const user = userEvent.setup();
    render(
      <details data-testid="outer">
        <summary>Outer</summary>
        <CvTextPanel cv={CORRECTED} disabled={false} onSave={async () => null} />
      </details>,
    );
    await user.click(screen.getByText('Outer'));
    const inner = screen.getByTestId('tailor-cv-changes') as HTMLDetailsElement;
    expect((screen.getByTestId('outer') as HTMLDetailsElement).open).toBe(true);
    expect(inner.open).toBe(false);
    expect(turned(summaryOf(inner).firstElementChild!)).toBe(false);
  });
});
