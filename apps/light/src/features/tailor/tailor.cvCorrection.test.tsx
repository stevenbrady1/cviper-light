// @vitest-environment jsdom
/**
 * L-218 through the Tailor screen: a correction is stored on the CV, shown at
 * once, and is the text the AI is sent on the next run.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ok, type Cv } from '@cviper/core-types';
import { type ChatTransport } from '@cviper/ai-providers';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));

const { Tailor } = await import('./Tailor');
const { createFakeTailorPort } = await import('./test/fakePort');
const { createFakeConsentPort } = await import('../analysis/test/fakeConsentPort');
const { createFakeFilePort } = await import('../../platform/test/fakeFilePort');

const MISREAD = 'Steve Brady\nCredit Risk Analyst Lloyds 20202024\nPython SQL';
const FIXED = 'Steve Brady\nCredit Risk Analyst, Lloyds, 2020 – 2024\nPython, SQL';

function cv(id: string, name: string, text: string): Cv {
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

/** Records what the AI is sent, and answers with an error: the request is the point. */
function recordingTransport(sent: string[]): ChatTransport {
  return {
    chat: async (_provider, body) => {
      sent.push(body);
      return ok({ status: 500, body: '{}' });
    },
    listModels: async () => ok({ status: 200, body: TAGS }),
  };
}

beforeEach(() => {
  tauri.invoke.mockReset();
  tauri.invoke.mockImplementation(async (command) => {
    if (command === 'ollama_probe') return TAGS;
    if (command === 'secret_status') return false;
    throw new Error(`unexpected command: ${command}`);
  });
});

afterEach(cleanup);

async function renderWith(cvs: readonly Cv[]) {
  const user = userEvent.setup();
  const port = createFakeTailorPort({ cvs });
  const sent: string[] = [];
  render(
    <Tailor
      port={port}
      filePort={createFakeFilePort()}
      consentPort={createFakeConsentPort()}
      createTransport={() => recordingTransport(sent)}
    />,
  );
  await screen.findByTestId('tailor-cv-preview-text');
  await vi.waitFor(() =>
    expect(screen.getByTestId<HTMLSelectElement>('tailor-provider').value).toBe(
      'ollama:llama3.2:3b',
    ),
  );
  return { user, port, sent };
}

async function correctTo(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.click(screen.getByTestId('tailor-cv-correct'));
  const box = screen.getByLabelText('Correct your CV text');
  await user.clear(box);
  await user.click(box);
  await user.paste(text);
  await user.click(screen.getByTestId('tailor-cv-edit-save'));
}

describe('correcting the CV on Tailor (L-218)', () => {
  it('happy: stored on the CV, shown at once, and the AI is sent the corrected text', async () => {
    const { user, port, sent } = await renderWith([cv('cv-1', 'CV.pdf', MISREAD)]);

    await correctTo(user, FIXED);

    expect(port.storedCvs()[0]).toMatchObject({ extracted_text: FIXED, original_text: MISREAD });
    expect(screen.getByTestId('tailor-cv-preview-text').textContent).toBe(FIXED);
    expect(screen.getByTestId('tailor-cv-source').textContent).toContain('corrected by you');

    await user.type(screen.getByTestId('tailor-job-text'), 'Credit risk analyst. Python, SQL.');
    await user.click(screen.getByTestId('tailor-run'));
    await vi.waitFor(() => expect(sent.length).toBeGreaterThan(0));
    const request = sent.join('\n');
    expect(request).toContain('2020 – 2024');
    expect(request).not.toContain('20202024');
  });

  it('Restore puts the file’s text back on the CV, and the AI is sent that', async () => {
    const corrected: Cv = { ...cv('cv-1', 'CV.pdf', FIXED), original_text: MISREAD };
    const { user, port } = await renderWith([corrected]);

    await user.click(screen.getByTestId('tailor-cv-restore'));
    await user.click(screen.getByTestId('tailor-cv-restore-yes'));

    expect(port.storedCvs()[0]).toEqual({ ...cv('cv-1', 'CV.pdf', MISREAD), original_text: null });
    expect(screen.getByTestId('tailor-cv-preview-text').textContent).toBe(MISREAD);
  });

  it('negative: a refused save is said, and the stored CV is unchanged', async () => {
    const { user, port } = await renderWith([cv('cv-1', 'CV.pdf', MISREAD)]);
    port.failNext('saveCv');

    await correctTo(user, FIXED);

    expect(screen.getByTestId('tailor-cv-edit-problem').textContent).toContain(
      'could not be saved',
    );
    expect(port.storedCvs()[0]?.extracted_text).toBe(MISREAD);
  });

  it('boundary: picking another CV mid-edit drops the edit; nothing is saved', async () => {
    const { user, port } = await renderWith([
      cv('cv-1', 'CV.pdf', MISREAD),
      cv('cv-2', 'Other.docx', 'Other text.'),
    ]);
    await user.click(screen.getByTestId('tailor-cv-correct'));
    await user.type(screen.getByLabelText('Correct your CV text'), ' half-typed');

    await user.selectOptions(screen.getByTestId('tailor-cv-pick'), 'cv-2');

    expect(screen.queryByLabelText('Correct your CV text')).toBeNull();
    expect(screen.getByTestId('tailor-cv-preview-text').textContent).toBe('Other text.');
    expect(port.calls.saveCv).toBe(0);
  });
});
