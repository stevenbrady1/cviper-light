// @vitest-environment jsdom
/**
 * A file the OS asked the app to open (L-83): whatever is on screen, the
 * shell switches to Analysis and the file goes through the same path as an
 * upload — read, stored, selected — or its refusal is shown where an upload
 * problem is shown.
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { err, ok } from '@cviper/core-types';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
}));

const parsing = vi.hoisted(() => ({
  extractText: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));
vi.mock('@cviper/cv-parsing', () => ({ extractText: parsing.extractText }));

const { default: App } = await import('./App');
const { markWelcomeSeen } = await import('../features/onboarding/store');
const { createFakeTrackerPort } = await import('../features/tracker/test/fakePort');
const { createFakeAnalysisPort } = await import('../features/analysis/test/fakePort');
const { createFakeFilePort } = await import('../platform/test/fakeFilePort');
const { createFakeOpenedCvPort } = await import('../platform/test/fakeOpenedCvPort');

const NOW = new Date(2026, 8, 7, 9, 0, 0);
const CV_TEXT = 'Credit risk analyst. SQL, Python, IFRS 9.';
const BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

beforeEach(() => {
  localStorage.clear();
  markWelcomeSeen();
  tauri.invoke.mockReset();
  tauri.invoke.mockImplementation(async (command) => {
    if (command === 'ollama_probe') return null;
    if (command === 'secret_status') return false;
    throw new Error(`unexpected command ${command}`);
  });
  parsing.extractText.mockReset();
  parsing.extractText.mockResolvedValue(ok({ text: CV_TEXT, pageCount: 1, warnings: [] }));
});

afterEach(() => {
  cleanup();
});

async function renderApp() {
  const analysisPort = createFakeAnalysisPort();
  const openedCv = createFakeOpenedCvPort();
  const result = render(
    <App
      trackerPort={createFakeTrackerPort()}
      analysisPort={analysisPort}
      filePort={createFakeFilePort()}
      openedCv={openedCv}
      now={NOW}
    />,
  );
  await screen.findByTestId('shell');
  return { ...result, analysisPort, openedCv };
}

describe('a CV opened from the share sheet', () => {
  it('switches to Analysis and goes through the upload path: read, stored, selected', async () => {
    const { analysisPort, openedCv } = await renderApp();
    expect(screen.getByTestId('view-tracker')).toBeTruthy();

    act(() => {
      openedCv.open(
        ok({ name: 'Jane CV.pdf', path: '/Documents/Inbox/Jane CV.pdf', bytes: BYTES }),
      );
    });

    expect(await screen.findByTestId('view-analysis')).toBeTruthy();
    await vi.waitFor(() => expect(parsing.extractText).toHaveBeenCalledWith('Jane CV.pdf', BYTES));
    await vi.waitFor(() => expect(analysisPort.storedCvs()).toHaveLength(1));
    expect(analysisPort.storedCvs()[0]?.name).toBe('Jane CV.pdf');
    expect(analysisPort.storedCvs()[0]?.extracted_text).toBe(CV_TEXT);
    expect(analysisPort.storedCvs()[0]?.file_path).toBe('/Documents/Inbox/Jane CV.pdf');
    expect(await screen.findByDisplayValue('Jane CV.pdf')).toBeTruthy();
  });

  it('shows Rust’s refusal where an upload problem is shown, and stores nothing', async () => {
    const { analysisPort, openedCv } = await renderApp();

    act(() => {
      openedCv.open(err({ message: 'CViper cannot read that kind of file. Pick a PDF.' }));
    });

    const problem = await screen.findByTestId('analysis-upload-problem');
    expect(problem.textContent).toContain('CViper cannot read that kind of file');
    expect(parsing.extractText).not.toHaveBeenCalled();
    expect(analysisPort.storedCvs()).toHaveLength(0);
  });

  it('ingests the same file once, not once per render', async () => {
    const { analysisPort, openedCv } = await renderApp();

    act(() => {
      openedCv.open(ok({ name: 'Once.pdf', path: '/Inbox/Once.pdf', bytes: BYTES }));
    });
    await vi.waitFor(() => expect(analysisPort.storedCvs()).toHaveLength(1));

    // Something else re-renders the shell: the file must not come round again.
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: '3', ctrlKey: true }));
    });
    await Promise.resolve();

    expect(parsing.extractText).toHaveBeenCalledTimes(1);
    expect(analysisPort.storedCvs()).toHaveLength(1);
  });

  it('arriving on the first-run introduction dismisses it and opens Analysis', async () => {
    localStorage.clear();
    const openedCv = createFakeOpenedCvPort();
    render(
      <App
        trackerPort={createFakeTrackerPort()}
        analysisPort={createFakeAnalysisPort()}
        filePort={createFakeFilePort()}
        openedCv={openedCv}
        now={NOW}
      />,
    );
    expect(await screen.findByTestId('welcome')).toBeTruthy();

    act(() => {
      openedCv.open(ok({ name: 'First.pdf', path: '/Inbox/First.pdf', bytes: BYTES }));
    });

    expect(await screen.findByTestId('view-analysis')).toBeTruthy();
    expect(screen.queryByTestId('welcome')).toBeNull();
    await vi.waitFor(() => expect(parsing.extractText).toHaveBeenCalledWith('First.pdf', BYTES));
  });

  it('stops listening when the shell unmounts', async () => {
    const { openedCv, unmount } = await renderApp();
    expect(openedCv.listening()).toBe(1);

    unmount();

    expect(openedCv.listening()).toBe(0);
  });
});
