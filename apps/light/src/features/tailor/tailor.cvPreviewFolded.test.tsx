// @vitest-environment jsdom
/**
 * The chosen CV starts folded on the Tailor screen (L-340).
 *
 * Open, the CV text pushed "The job advert" below the fold at 1500×810. So
 * the preview starts folded to one line — the heading, the file name, the
 * word count and the toggle — and the user opens it if they want to read it.
 *
 * Two rules from L-192 still hold: the user's open/fold choice is not reset
 * when the CV changes, and no CV draws nothing. One is new: a CV with no text
 * always shows the panel, so "Type or paste your CV text" is never hidden
 * behind a toggle. That is derived from the CV, not a reset of the choice —
 * so it has no toggle of its own (a toggle that cannot fold it would lie),
 * and a normal CV picked next is back to whatever the user chose.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type Cv } from '@cviper/core-types';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));

const { Tailor } = await import('./Tailor');
const { createFakeTailorPort } = await import('./test/fakePort');
const { createFakeConsentPort } = await import('../analysis/test/fakeConsentPort');
const { createFakeFilePort } = await import('../../platform/test/fakeFilePort');

// 27 words, as the L-192 tests count them.
const RISK_TEXT = `Jamie Lewis
Senior Credit Risk Analyst, Lloyds Banking Group, London, Jan 2020 – Present
- Built IFRS 9 impairment models in Python, cutting run time by 40%.`;

const DATA_TEXT = `Jamie Lewis
Data Engineer, Monzo, London, 2021 – Present
- Moved the nightly batch to streaming, cutting report lag from a day to minutes.`;

function cv(id: string, name: string, text: string | null): Cv {
  return {
    id,
    name,
    file_path: null,
    extracted_text: text,
    json_resume: null,
    created_at: '2026-08-01T09:00:00.000Z',
  };
}

const TAGS = JSON.stringify({
  models: [
    {
      model: 'llama3.2:3b',
      name: 'llama3.2:3b',
      capabilities: ['completion'],
      details: { parameter_size: '3.2B' },
    },
  ],
});

beforeEach(() => {
  tauri.invoke.mockReset();
  tauri.invoke.mockImplementation(async (command) => {
    if (command === 'ollama_probe') return TAGS;
    if (command === 'secret_status') return false;
    throw new Error(`unexpected command: ${command}`);
  });
});

afterEach(() => {
  cleanup();
});

async function renderWith(cvs: readonly Cv[]): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  render(
    <Tailor
      port={createFakeTailorPort({ cvs })}
      filePort={createFakeFilePort()}
      consentPort={createFakeConsentPort()}
      handoff={null}
      onHandoffHandled={vi.fn()}
    />,
  );
  await screen.findByTestId('view-tailor');
  // Wait for everything the screen reads, so no state lands after a test ends.
  await vi.waitFor(() =>
    expect(screen.getByTestId<HTMLSelectElement>('tailor-provider').value).toBe(
      'ollama:llama3.2:3b',
    ),
  );
  return user;
}

const panel = () => screen.getByTestId('tailor-cv-preview');
const toggle = () => screen.getByTestId('tailor-cv-preview-toggle');
const summary = () => screen.queryByTestId('tailor-cv-preview-summary');
const pick = () => screen.getByTestId('tailor-cv-pick');

describe('folded on a fresh mount', () => {
  it('happy: one line — heading, file name, word count and the toggle; the text is hidden', async () => {
    await renderWith([cv('cv-1', 'Risk CV.docx', RISK_TEXT), cv('cv-2', 'Data CV.pdf', DATA_TEXT)]);
    await vi.waitFor(() => expect(summary()).not.toBeNull());

    expect(panel().hidden).toBe(true);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(toggle().getAttribute('aria-controls')).toBe(panel().id);
    expect(toggle().textContent).toBe('Show CV');

    const line = toggle().parentElement?.textContent ?? '';
    expect(line).toContain('Your CV as the rewrite reads it');
    expect(summary()?.textContent).toBe(': Risk CV.docx · 27 words');
    // The CV text itself is folded away, inside the hidden section.
    expect(panel().contains(screen.getByTestId('tailor-cv-preview-text'))).toBe(true);
  });

  it('keeps exactly one primary button when folded; the toggle is not one', async () => {
    await renderWith([cv('cv-1', 'Risk CV.docx', RISK_TEXT)]);
    await vi.waitFor(() => expect(summary()).not.toBeNull());

    expect(document.querySelectorAll('[data-primary="true"]')).toHaveLength(1);
    expect(toggle().hasAttribute('data-primary')).toBe(false);
  });

  it('boundary: a one-word CV counts as it does in the open panel', async () => {
    await renderWith([cv('cv-1', 'One.txt', 'Jamie')]);
    await vi.waitFor(() => expect(summary()).not.toBeNull());

    // The same `wordCount` the open panel's meta line uses, and its wording.
    const meta = screen.getByTestId('tailor-cv-preview-meta').textContent ?? '';
    expect(meta).toContain('1 words');
    expect(summary()?.textContent).toBe(': One.txt · 1 words');
  });
});

describe('the toggle', () => {
  it('interaction: opens the text, then folds it again', async () => {
    const user = await renderWith([cv('cv-1', 'Risk CV.docx', RISK_TEXT)]);
    await vi.waitFor(() => expect(summary()).not.toBeNull());

    await user.click(toggle());
    expect(panel().hidden).toBe(false);
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(toggle().textContent).toBe('Hide CV');
    expect(screen.getByTestId('tailor-cv-preview-text').textContent).toBe(RISK_TEXT);
    // Open, the panel's own meta line carries the name and count: no repeat.
    expect(summary()).toBeNull();

    await user.click(toggle());
    expect(panel().hidden).toBe(true);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(summary()?.textContent).toBe(': Risk CV.docx · 27 words');
  });
});

describe('the choice survives a change of CV (L-192)', () => {
  it('negative: opened, then another CV → still open, showing that CV', async () => {
    const user = await renderWith([
      cv('cv-1', 'Risk CV.docx', RISK_TEXT),
      cv('cv-2', 'Data CV.pdf', DATA_TEXT),
    ]);
    await vi.waitFor(() => expect(summary()).not.toBeNull());
    await user.click(toggle());

    await user.selectOptions(pick(), 'cv-2');

    expect(panel().hidden).toBe(false);
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('tailor-cv-preview-text').textContent).toBe(DATA_TEXT);
  });

  it('negative: folded, then another CV → still folded, summarising that CV', async () => {
    const user = await renderWith([
      cv('cv-1', 'Risk CV.docx', RISK_TEXT),
      cv('cv-2', 'Data CV.pdf', DATA_TEXT),
    ]);
    await vi.waitFor(() => expect(summary()).not.toBeNull());

    await user.selectOptions(pick(), 'cv-2');

    expect(panel().hidden).toBe(true);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(summary()?.textContent).toContain('Data CV.pdf');
  });
});

describe('when there is nothing to fold', () => {
  it('boundary: no CV → nothing drawn', async () => {
    await renderWith([]);

    expect(screen.queryByTestId('tailor-cv-preview')).toBeNull();
    expect(screen.queryByTestId('tailor-cv-preview-toggle')).toBeNull();
    expect(summary()).toBeNull();
  });

  it('boundary: a CV with no text shows the panel on a fresh mount, with no toggle', async () => {
    await renderWith([cv('cv-1', 'Scan.pdf', null)]);
    await screen.findByTestId('tailor-cv-preview-empty');

    expect(panel().hidden).toBe(false);
    expect(screen.getByTestId('tailor-cv-correct').textContent).toBe('Type or paste your CV text');
    // It cannot be folded, so no toggle offers to.
    expect(screen.queryByTestId('tailor-cv-preview-toggle')).toBeNull();
    expect(summary()).toBeNull();
  });

  it('boundary: whitespace-only text counts as no text', async () => {
    await renderWith([cv('cv-1', 'Blank.docx', '  \n\t \n')]);
    await screen.findByTestId('tailor-cv-preview-empty');

    expect(panel().hidden).toBe(false);
    expect(screen.getByTestId('tailor-cv-correct').textContent).toBe('Type or paste your CV text');
    expect(screen.queryByTestId('tailor-cv-preview-toggle')).toBeNull();
  });

  it('boundary: from a no-text CV to a normal one → back to the user’s choice (folded)', async () => {
    const user = await renderWith([
      cv('cv-1', 'Scan.pdf', null),
      cv('cv-2', 'Data CV.pdf', DATA_TEXT),
    ]);
    await screen.findByTestId('tailor-cv-preview-empty');
    expect(panel().hidden).toBe(false);

    await user.selectOptions(pick(), 'cv-2');

    expect(panel().hidden).toBe(true);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(summary()?.textContent).toBe(': Data CV.pdf · 24 words');
  });
});
