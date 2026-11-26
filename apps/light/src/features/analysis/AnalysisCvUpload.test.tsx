// @vitest-environment jsdom
/**
 * The end of Analysis's line, and the note under the box (L-463).
 *
 * 6a: the "…" ("More for this CV", holding "Save as JSON Resume") used to sit
 * inside the sentence, "Check [CV] … using [AI]". It now ends the line, after
 * "Upload a CV", in one group with it, so it never starts a line of its own.
 *
 * 6b: the note read "JSON Resume ⓘ (.json). The file …". It now reads
 * "JSON Resume (.json). ⓘ The file …": the full stop comes before the ⓘ, so it
 * never floats after the icon's padding. The words are the same.
 */
import { type Cv } from '@cviper/core-types';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AnalysisCvNote, AnalysisCvPicker, AnalysisCvUpload } from './AnalysisCvPicker';

const SAVE_WORDS = 'Only a CV that arrived as a JSON Resume can be saved as one.';
const NOTE =
  'PDF, Word (.docx) or JSON Resume (.json). The file is read on this computer. Its text only goes to an AI you choose, and only when you ask it to read your CV.';

function cv(id: string, jsonResume: string | null, name = `${id}.pdf`): Cv {
  return {
    id,
    name,
    file_path: `C:\\cvs\\${id}`,
    extracted_text: 'text',
    created_at: '2026-09-01T09:00:00.000Z',
    json_resume: jsonResume,
  };
}

const PDF_CV = cv('cv-pdf', null);
const JSON_CV = cv('cv-json', '{"basics":{}}');

function renderUpload(
  selectedCv: Cv | null,
  { exporting = false, onSaveJsonResume = vi.fn(), onUpload = vi.fn() } = {},
) {
  render(
    <AnalysisCvUpload
      selectedCv={selectedCv}
      exporting={exporting}
      onUpload={onUpload}
      onSaveJsonResume={onSaveJsonResume}
    />,
  );
  return { onSaveJsonResume, onUpload };
}

const more = () => screen.getByTestId('analysis-cv-more');
const upload = () => screen.getByTestId('analysis-upload');
const save = () => screen.getByTestId<HTMLButtonElement>('analysis-save-json');

function saveInfo(): HTMLElement | undefined {
  return screen
    .queryAllByRole('button', { name: 'What this means' })
    .find(
      (button) =>
        document.getElementById(button.getAttribute('aria-describedby') ?? '')?.textContent ===
        SAVE_WORDS,
    );
}

afterEach(cleanup);

describe('6a: the "…" ends the line, after Upload a CV (L-463)', () => {
  it('happy: Upload a CV, then "…", in one group pushed to the line end', () => {
    renderUpload(JSON_CV);

    const group = upload().parentElement;
    expect(group).not.toBeNull();
    expect(group!.contains(more())).toBe(true);
    expect(group!.classList.contains('ml-auto')).toBe(true);
    expect(group!.classList.contains('flex')).toBe(true);
    // Upload a CV no longer pushes itself: the group does.
    expect(upload().classList.contains('ml-auto')).toBe(false);
    expect(
      upload().compareDocumentPosition(more()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'More for this CV' })).toBe(more());
    expect(upload().textContent).toBe('Upload a CV');
  });

  it('negative: the CV part of the line holds no "…" any more', () => {
    render(
      <AnalysisCvPicker
        cvs={[PDF_CV, JSON_CV]}
        cvsLoaded
        selectedCvId={JSON_CV.id}
        selectedCv={JSON_CV}
        onPick={() => undefined}
        onUpload={() => undefined}
        onSaveJsonResume={() => undefined}
        exporting={false}
        exportMessage={null}
        uploadProblem={null}
        warnings={[]}
      />,
    );
    expect(screen.getByTestId('analysis-cv')).toBeTruthy();
    expect(screen.queryByTestId('analysis-cv-more')).toBeNull();
    expect(screen.queryByRole('button', { name: 'More for this CV' })).toBeNull();
  });

  it('negative: for a PDF CV the item is disabled, never missing, and its "i" says why', async () => {
    const user = userEvent.setup();
    const { onSaveJsonResume } = renderUpload(PDF_CV);

    await user.click(more());
    expect(save().disabled).toBe(true);
    expect(save().textContent).toBe('Save as JSON Resume');
    expect(saveInfo()).toBeDefined();
    await user.click(save());
    expect(onSaveJsonResume).not.toHaveBeenCalled();
  });

  it('boundary: no CV chosen, the item is disabled with no "i"; while saving it says "Saving…"', async () => {
    const user = userEvent.setup();
    renderUpload(null);
    await user.click(more());
    expect(save().disabled).toBe(true);
    expect(saveInfo()).toBeUndefined();
    cleanup();

    renderUpload(JSON_CV, { exporting: true });
    await user.click(more());
    expect(save().disabled).toBe(true);
    expect(save().textContent).toBe('Saving…');
  });

  it('interaction: open "…", press Save, the handler runs once and focus returns to "…"', async () => {
    const user = userEvent.setup();
    const { onSaveJsonResume, onUpload } = renderUpload(JSON_CV);

    expect(more().getAttribute('aria-expanded')).toBe('false');
    await user.click(more());
    expect(more().getAttribute('aria-expanded')).toBe('true');
    expect(within(more().parentElement!).getByTestId('analysis-save-json')).toBe(save());

    await user.click(save());
    expect(onSaveJsonResume).toHaveBeenCalledTimes(1);
    expect(onUpload).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(more());
    expect(screen.queryByTestId('analysis-save-json')).toBeNull();
  });

  it('interaction: Upload a CV still calls its own handler', async () => {
    const user = userEvent.setup();
    const { onSaveJsonResume, onUpload } = renderUpload(JSON_CV);
    await user.click(upload());
    expect(onUpload).toHaveBeenCalledTimes(1);
    expect(onSaveJsonResume).not.toHaveBeenCalled();
  });
});

describe('6b: "(.json)." then the ⓘ (L-463)', () => {
  /** The note's text nodes, in page order. */
  function texts(note: HTMLElement): Text[] {
    const walker = document.createTreeWalker(note, NodeFilter.SHOW_TEXT);
    const found: Text[] = [];
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      found.push(node as Text);
    }
    return found;
  }

  function info(): HTMLElement {
    const infos = within(screen.getByTestId('analysis-cv-note')).getAllByRole('button', {
      name: 'What this means',
    });
    expect(infos).toHaveLength(1);
    return infos[0]!;
  }

  /** All the note's text before the ⓘ, and all after it. */
  function split(): { before: string; after: string } {
    const icon = info();
    const parts = texts(screen.getByTestId('analysis-cv-note'));
    const isBefore = (node: Text) =>
      (node.compareDocumentPosition(icon) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    return {
      before: parts
        .filter(isBefore)
        .map((node) => node.data)
        .join(''),
      after: parts
        .filter((node) => !isBefore(node))
        .map((node) => node.data)
        .join(''),
    };
  }

  it('happy: "(.json)" and its full stop come before the ⓘ, then one space and "The file"', () => {
    render(<AnalysisCvNote />);
    const { before, after } = split();
    expect(before.endsWith('JSON Resume (.json).')).toBe(true);
    expect(after.startsWith(' The file is read on this computer.')).toBe(true);
  });

  it('negative: no full stop after the ⓘ, and never a space before a full stop', () => {
    render(<AnalysisCvNote />);
    const { after } = split();
    expect(after.trimStart().startsWith('.')).toBe(false);
    expect(after.startsWith('  ')).toBe(false);
    expect(screen.getByTestId('analysis-cv-note').textContent).not.toMatch(/\s\./);
  });

  it('negative: the marked words are still exactly "JSON Resume", before the ⓘ', () => {
    render(<AnalysisCvNote />);
    const mark = screen.getByTestId('json-resume-hint');
    expect(mark.textContent).toBe('JSON Resume');
    const info = within(screen.getByTestId('analysis-cv-note')).getByRole('button', {
      name: 'What this means',
    });
    expect(mark.compareDocumentPosition(info) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('boundary: the words, privacy sentence included, are unchanged', () => {
    render(<AnalysisCvNote />);
    expect(screen.getByTestId('analysis-cv-note').textContent).toBe(NOTE);
  });
});
