// @vitest-environment jsdom
/**
 * The chosen CV, shown on the Tailor screen (L-192).
 *
 * The rewrite works from the CV's stored `extracted_text`, not from the file
 * the user remembers uploading — so that text is what the screen shows, under
 * the picker, the moment a CV is chosen. It is read-only, collapsible, starts
 * open, and follows the picker (and an L-190 handoff) without a click.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type Cv } from '@cviper/core-types';

import type { TailorHandoff } from '../flow/handoff';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));

const { Tailor } = await import('./Tailor');
const { createFakeTailorPort } = await import('./test/fakePort');
const { createFakeConsentPort } = await import('../analysis/test/fakeConsentPort');
const { createFakeFilePort } = await import('../../platform/test/fakeFilePort');

const RISK_TEXT = `Steve Brady
Senior Credit Risk Analyst, Lloyds Banking Group, London, Jan 2020 – Present
- Built IFRS 9 impairment models in Python, cutting run time by 40%.`;

const DATA_TEXT = `Steve Brady
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

async function renderWith(
  cvs: readonly Cv[],
  handoff: TailorHandoff | null = null,
): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  render(
    <Tailor
      port={createFakeTailorPort({ cvs })}
      filePort={createFakeFilePort()}
      consentPort={createFakeConsentPort()}
      handoff={handoff}
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

const previewText = () => screen.getByTestId('tailor-cv-preview-text');
const toggle = () => screen.getByTestId('tailor-cv-preview-toggle');

describe('the chosen CV, shown under the picker', () => {
  it('happy: shows the default (first) CV’s stored text on load, open', async () => {
    await renderWith([cv('cv-1', 'Risk CV.docx', RISK_TEXT), cv('cv-2', 'Data CV.pdf', DATA_TEXT)]);

    await vi.waitFor(() => expect(previewText().textContent).toBe(RISK_TEXT));
    const panel = screen.getByTestId('tailor-cv-preview');
    expect(panel.hidden).toBe(false);
    expect(panel.getAttribute('aria-labelledby')).not.toBeNull();
    const heading = document.getElementById(panel.getAttribute('aria-labelledby') ?? '');
    expect(heading?.textContent).toBe('Your CV as the rewrite reads it');
    // Name and size, from what is already on the record — nothing invented.
    const meta = screen.getByTestId('tailor-cv-preview-meta').textContent;
    expect(meta).toContain('Risk CV.docx');
    expect(meta).toContain('27 words');
  });

  it('sits directly under the picker, before the advert', async () => {
    await renderWith([cv('cv-1', 'Risk CV.docx', RISK_TEXT)]);
    await vi.waitFor(() => expect(previewText()).toBeTruthy());

    const picker = screen.getByTestId('tailor-cv-pick');
    const panel = screen.getByTestId('tailor-cv-preview');
    const advert = screen.getByTestId('tailor-job-text');
    expect(picker.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(panel.compareDocumentPosition(advert) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('interaction: choosing another CV shows that CV’s text straight away', async () => {
    const user = await renderWith([
      cv('cv-1', 'Risk CV.docx', RISK_TEXT),
      cv('cv-2', 'Data CV.pdf', DATA_TEXT),
    ]);
    await vi.waitFor(() => expect(previewText().textContent).toBe(RISK_TEXT));

    await user.selectOptions(screen.getByTestId('tailor-cv-pick'), 'cv-2');

    expect(previewText().textContent).toBe(DATA_TEXT);
    expect(screen.getByTestId('tailor-cv-preview-meta').textContent).toContain('Data CV.pdf');
  });

  it('interaction: the toggle hides and shows the panel, and aria-expanded follows', async () => {
    const user = await renderWith([
      cv('cv-1', 'Risk CV.docx', RISK_TEXT),
      cv('cv-2', 'Data CV.pdf', DATA_TEXT),
    ]);
    await vi.waitFor(() => expect(previewText()).toBeTruthy());

    const panel = screen.getByTestId('tailor-cv-preview');
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(toggle().getAttribute('aria-controls')).toBe(panel.id);
    expect(toggle().textContent).toBe('Hide CV');

    await user.click(toggle());
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(toggle().textContent).toBe('Show CV');
    expect(screen.getByTestId('tailor-cv-preview').hidden).toBe(true);

    // The choice is kept while the user stays: changing CV does not reopen it.
    await user.selectOptions(screen.getByTestId('tailor-cv-pick'), 'cv-2');
    expect(screen.getByTestId('tailor-cv-preview').hidden).toBe(true);

    await user.click(toggle());
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('tailor-cv-preview').hidden).toBe(false);
    expect(previewText().textContent).toBe(DATA_TEXT);
  });

  it('keeps exactly one primary button; the toggle is not one', async () => {
    await renderWith([cv('cv-1', 'Risk CV.docx', RISK_TEXT)]);
    await vi.waitFor(() => expect(previewText()).toBeTruthy());

    expect(document.querySelectorAll('[data-primary="true"]')).toHaveLength(1);
    expect(toggle().hasAttribute('data-primary')).toBe(false);
    expect(toggle().getAttribute('type')).toBe('button');
  });

  it('is read-only: no textarea, no contenteditable', async () => {
    await renderWith([cv('cv-1', 'Risk CV.docx', RISK_TEXT)]);
    await vi.waitFor(() => expect(previewText()).toBeTruthy());

    const panel = screen.getByTestId('tailor-cv-preview');
    expect(panel.querySelector('textarea, input, [contenteditable]')).toBeNull();
    expect(previewText().hasAttribute('contenteditable')).toBe(false);
    // Selectable, so the user can copy a line out of it.
    expect(previewText().className).not.toContain('select-none');
  });
});

describe('when there is nothing to show', () => {
  it('negative: no CVs → no preview at all (the picker already says so)', async () => {
    await renderWith([]);

    expect(screen.getByTestId<HTMLSelectElement>('tailor-cv-pick').textContent).toContain(
      'No CV uploaded yet',
    );
    expect(screen.queryByTestId('tailor-cv-preview')).toBeNull();
    expect(screen.queryByTestId('tailor-cv-preview-toggle')).toBeNull();
  });

  it('negative: a CV with no stored text gets one quiet line, not a blank box', async () => {
    await renderWith([cv('cv-1', 'Scan.pdf', null)]);

    const empty = await screen.findByTestId('tailor-cv-preview-empty');
    expect(empty.textContent).toContain('No text');
    expect(empty.className).toContain('text-ink-faint');
    expect(screen.queryByTestId('tailor-cv-preview-text')).toBeNull();
  });

  it('boundary: whitespace-only text counts as empty', async () => {
    await renderWith([cv('cv-1', 'Blank.docx', '  \n\t \n')]);

    await screen.findByTestId('tailor-cv-preview-empty');
    expect(screen.queryByTestId('tailor-cv-preview-text')).toBeNull();
  });
});

describe('a very long CV', () => {
  it('boundary: renders whole, inside a height-capped, scrollable, wrapping block', async () => {
    const long = Array.from(
      { length: 2000 },
      (_, index) => `Line ${index + 1}: ${'word '.repeat(20)}`,
    ).join('\n');
    await renderWith([cv('cv-1', 'Long CV.docx', long)]);

    await vi.waitFor(() => expect(previewText().textContent).toBe(long));
    const classes = previewText().className.split(/\s+/);
    expect(classes).toContain('max-h-72');
    expect(classes).toContain('overflow-y-auto');
    expect(classes).toContain('whitespace-pre-wrap');
    // A scroll box a keyboard cannot reach is one only a mouse can read.
    expect(previewText().tabIndex).toBe(0);
  });
});

describe('an L-190 handoff', () => {
  it('shows the CV the handoff selected, not the default', async () => {
    await renderWith(
      [cv('cv-1', 'Risk CV.docx', RISK_TEXT), cv('cv-2', 'Data CV.pdf', DATA_TEXT)],
      { jobId: null, jobText: 'An advert.', cvId: 'cv-2', optionKey: null },
    );

    await vi.waitFor(() =>
      expect(screen.getByTestId<HTMLSelectElement>('tailor-cv-pick').value).toBe('cv-2'),
    );
    expect(previewText().textContent).toBe(DATA_TEXT);
  });
});
