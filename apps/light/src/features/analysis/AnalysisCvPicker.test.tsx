// @vitest-environment jsdom
/**
 * Why "Save as JSON Resume" is greyed out, said where keyboard and touch can
 * reach it (L-387). It used to be a hover-only `title` on the disabled button,
 * and a disabled button takes no focus and no tap, so the "i" beside it is the
 * way in.
 */
import { type Cv } from '@cviper/core-types';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { AnalysisCvPicker } from './AnalysisCvPicker';

const WORDS = 'Only a CV that arrived as a JSON Resume can be saved as one.';

function cv(id: string, jsonResume: string | null): Cv {
  return {
    id,
    name: `${id}.pdf`,
    file_path: `C:\\cvs\\${id}`,
    extracted_text: 'text',
    created_at: '2026-09-01T09:00:00.000Z',
    json_resume: jsonResume,
  };
}

const PDF_CV = cv('cv-pdf', null);
const JSON_CV = cv('cv-json', '{"basics":{}}');

function renderPicker(selected: Cv | null) {
  const cvs = [PDF_CV, JSON_CV];
  render(
    <AnalysisCvPicker
      cvs={cvs}
      cvsLoaded
      selectedCvId={selected?.id ?? null}
      selectedCv={selected}
      onPick={() => undefined}
      onUpload={() => undefined}
      onSaveJsonResume={() => undefined}
      exporting={false}
      exportMessage={null}
      uploadProblem={null}
      warnings={[]}
    />,
  );
}

const saveButton = () => screen.getByTestId('analysis-save-json');

/** The "i" whose tip carries the save explanation, or null. */
function saveInfo(): HTMLElement | null {
  return (
    screen
      .queryAllByRole('button', { name: 'What this means' })
      .find(
        (button) =>
          document.getElementById(button.getAttribute('aria-describedby') ?? '')?.textContent ===
          WORDS,
      ) ?? null
  );
}

function saveTip(): HTMLElement {
  const tip = document.getElementById(saveInfo()?.getAttribute('aria-describedby') ?? '');
  if (tip === null) throw new Error('no save explanation');
  return tip;
}

afterEach(cleanup);

describe('why Save as JSON Resume is greyed out (L-387)', () => {
  it('happy: Tab reaches the "i", it is named, and the explanation shows', async () => {
    const user = userEvent.setup();
    renderPicker(PDF_CV);
    const info = saveInfo();
    expect(info).not.toBeNull();

    for (let step = 0; step < 10 && document.activeElement !== info; step += 1) {
      await user.tab();
    }
    expect(document.activeElement).toBe(info);
    expect(info?.getAttribute('aria-label')).toBe('What this means');
    expect(saveTip().hidden).toBe(false);
  });

  it('happy: a tap on the "i" opens the explanation and a second tap closes it', () => {
    renderPicker(PDF_CV);

    expect(saveTip().hidden).toBe(true);
    fireEvent.click(saveInfo()!);
    expect(saveTip().hidden).toBe(false);
    fireEvent.click(saveInfo()!);
    expect(saveTip().hidden).toBe(true);
  });

  it('regression: the words are unchanged', () => {
    renderPicker(PDF_CV);
    expect(saveTip().textContent).toBe(WORDS);
  });

  it('negative: the button no longer carries a hover-only title', () => {
    for (const selected of [PDF_CV, JSON_CV, null]) {
      renderPicker(selected);
      expect(saveButton().hasAttribute('title'), selected?.id ?? 'no CV').toBe(false);
      cleanup();
    }
  });

  it('boundary: no "i" when there is nothing to explain — a JSON Resume CV, or no CV', () => {
    renderPicker(JSON_CV);
    expect((saveButton() as HTMLButtonElement).disabled).toBe(false);
    expect(saveInfo()).toBeNull();
    cleanup();

    renderPicker(null);
    expect(saveInfo()).toBeNull();
  });
});
