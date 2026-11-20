// @vitest-environment jsdom
/**
 * Tidy-ups after the screen work (L-447).
 *
 * 1. Tailor: no empty gap above the advert box. The composer's notices slot
 *    is one of its `gap-3` rows; with the CV text folded and nothing to say,
 *    an empty-looking slot still took a row and added 12px between the line
 *    of choices and the box. The folded CV text stays mounted (Show CV's
 *    `aria-controls` names it), so the slot cannot simply go: every child it
 *    holds is `hidden`, and the composer hides a slot like that. jsdom resolves
 *    no stylesheet, so the pixels are measured in WebKit
 *    (`e2e/contrast-webkit.spec.ts`); here the DOM the rule acts on is pinned.
 *
 * 2. One empty state everywhere. Analysis, Tailor and the empty Tracker board
 *    move from the dashed box with a tinted icon tile onto the shared
 *    `EmptyState` (L-434). The words, test ids and buttons are the same.
 */
import { type Cv } from '@cviper/core-types';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));

const { Tailor } = await import('../features/tailor/Tailor');
const { createFakeTailorPort } = await import('../features/tailor/test/fakePort');
const { Analysis } = await import('../features/analysis/Analysis');
const { createFakeAnalysisPort } = await import('../features/analysis/test/fakePort');
const { createFakeConsentPort } = await import('../features/analysis/test/fakeConsentPort');
const { Tracker } = await import('../features/tracker/Tracker');
const { createFakeTrackerPort } = await import('../features/tracker/test/fakePort');
const { createFakeFilePort } = await import('../platform/test/fakeFilePort');

const NOW = new Date('2026-08-19T09:00:00.000Z');

function cv(text: string | null): Cv {
  return {
    id: 'cv-1',
    name: 'CV.docx',
    file_path: null,
    extracted_text: text,
    json_resume: null,
    created_at: '2026-08-01T09:00:00.000Z',
  };
}

const CV_TEXT = 'Jamie Lewis\nCredit Risk Analyst, Lloyds, London.\n- Built SQL models.';

beforeEach(() => {
  tauri.invoke.mockReset();
  tauri.invoke.mockImplementation(async (command) => {
    if (command === 'ollama_probe') return null;
    if (command === 'secret_status') return false;
    throw new Error(`unexpected command: ${command}`);
  });
});

afterEach(() => {
  cleanup();
});

async function renderTailor(cvs: readonly Cv[]) {
  const filePort = createFakeFilePort();
  render(
    <Tailor
      port={createFakeTailorPort({ cvs })}
      filePort={filePort}
      consentPort={createFakeConsentPort()}
      now={NOW}
    />,
  );
  await screen.findByTestId('view-tailor');
  if (cvs.length > 0) await screen.findByDisplayValue('CV.docx');
  return { filePort, user: userEvent.setup() };
}

const notices = () => document.querySelector<HTMLElement>('[data-slot="notices"]');

/** No notices row, or one whose every child is hidden, so it takes no row and no gap. */
function noticesTakeNoRow(): boolean {
  const slot = notices();
  return slot === null || [...slot.children].every((child) => (child as HTMLElement).hidden);
}

describe('Tailor: no empty notices row above the advert box (L-447)', () => {
  it('happy: with the CV text folded and nothing to say, the notices take no row', async () => {
    await renderTailor([cv(CV_TEXT)]);
    expect(screen.getByTestId('tailor-cv-preview').hidden).toBe(true);
    expect(noticesTakeNoRow()).toBe(true);
  });

  it('happy: the folded CV text stays mounted, so Show CV still names it', async () => {
    await renderTailor([cv(CV_TEXT)]);
    const toggle = screen.getByTestId('tailor-cv-preview-toggle');
    const target = document.getElementById(toggle.getAttribute('aria-controls') ?? '');
    expect(target).toBe(screen.getByTestId('tailor-cv-preview'));
  });

  it('boundary: no CV at all, nothing to say, the notices take no row', async () => {
    await renderTailor([]);
    expect(noticesTakeNoRow()).toBe(true);
  });

  it('negative: an upload problem shows in the notices, between the line and the box', async () => {
    const { filePort, user } = await renderTailor([cv(CV_TEXT)]);
    filePort.failCv('CViper cannot read that kind of file. Pick a PDF or a Word (.docx) CV.');
    await user.click(screen.getByTestId('tailor-upload'));

    const problem = await screen.findByTestId('tailor-upload-problem');
    expect(notices()?.contains(problem)).toBe(true);
    expect(noticesTakeNoRow()).toBe(false);
    const sentence = document.querySelector('[data-slot="sentence"]');
    const box = document.querySelector('[data-slot="box"]');
    expect(sentence?.compareDocumentPosition(problem)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(box?.compareDocumentPosition(problem)).toBe(Node.DOCUMENT_POSITION_PRECEDING);
  });

  it('boundary: Show CV opens the CV text, and the notices take a row again', async () => {
    const { user } = await renderTailor([cv(CV_TEXT)]);
    await user.click(screen.getByTestId('tailor-cv-preview-toggle'));
    expect(noticesTakeNoRow()).toBe(false);
  });

  it('boundary: a CV with no text always shows its panel, so the notices take a row', async () => {
    await renderTailor([cv(null)]);
    expect(screen.getByTestId('tailor-cv-preview').hidden).toBe(false);
    expect(noticesTakeNoRow()).toBe(false);
  });
});

/** The shared empty state's frame: no dashed box anywhere, and its icon is not in a tinted tile. */
function expectSharedFrame(empty: HTMLElement): void {
  expect(document.querySelector('.border-dashed')).toBeNull();
  expect(empty.className).not.toMatch(/\b(border\S*|bg-\S+|rounded-\S+)\b/);
  const holder = empty.querySelector('svg')?.parentElement;
  expect(holder?.getAttribute('aria-hidden')).toBe('true');
  expect(holder?.className).toContain('text-ink-muted');
  expect(holder?.className).not.toMatch(/\b(bg-\S+|rounded-\S+)\b/);
}

/** The title and the sentence, word for word, in that order. */
function words(empty: HTMLElement): string[] {
  return [...empty.querySelectorAll(':scope > p')].map((p) => p.textContent ?? '');
}

describe('one shared empty state (L-447)', () => {
  it('Analysis: the shared frame, the same words, and the sample stays a white button', async () => {
    render(<Analysis port={createFakeAnalysisPort()} filePort={createFakeFilePort()} now={NOW} />);
    const sample = await screen.findByTestId('analysis-try-sample');
    const empty = screen.getByTestId('analysis-empty');
    expectSharedFrame(empty);
    expect(words(empty)).toEqual([
      'Nothing checked yet.',
      'Pick a CV, paste an advert, and press the button. The basic match needs no account and no set-up, and nothing leaves this machine.',
    ]);
    expect(empty.contains(sample)).toBe(true);
    expect(sample.getAttribute('data-primary')).toBeNull();
  });

  it('Analysis boundary: with a CV there is no sample, and nothing drawn in its place', async () => {
    render(
      <Analysis
        port={createFakeAnalysisPort({ cvs: [cv(CV_TEXT)] })}
        filePort={createFakeFilePort()}
        now={NOW}
      />,
    );
    await screen.findByDisplayValue('CV.docx');
    const empty = screen.getByTestId('analysis-empty');
    expect(screen.queryByTestId('analysis-try-sample')).toBeNull();
    // Title and sentence only: no empty row left where the button was.
    expect([...empty.children].map((child) => child.tagName)).toEqual(['SPAN', 'P', 'P']);
  });

  it('Tailor: the shared frame and the same words', async () => {
    await renderTailor([cv(CV_TEXT)]);
    const empty = screen.getByTestId('tailor-empty');
    expectSharedFrame(empty);
    expect(words(empty)).toEqual([
      'Nothing tailored yet.',
      'Pick a CV and an advert, then press the button. Every employer, date, figure and certification in the result is checked against your original CV before you see it.',
    ]);
  });

  it('Tracker: the shared frame, the same words, and both buttons, one of them blue', async () => {
    render(<Tracker port={createFakeTrackerPort([])} now={NOW} />);
    const empty = await screen.findByTestId('tracker-empty');
    expectSharedFrame(empty);
    expect(words(empty)).toEqual([
      'Start with the last job you applied to.',
      'The board keeps every application in one place and shows you which ones have gone quiet. It needs no account and no set-up.',
    ]);
    const add = screen.getByTestId('tracker-empty-add');
    const paste = screen.getByTestId('tracker-empty-paste');
    expect(empty.contains(add) && empty.contains(paste)).toBe(true);
    expect(add.getAttribute('data-primary')).toBe('true');
    expect(paste.getAttribute('data-primary')).toBeNull();
    expect(document.querySelectorAll('[data-primary="true"]')).toHaveLength(1);
  });
});
