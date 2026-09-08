// @vitest-environment jsdom
/**
 * ============================================================================
 * THE PROMISE: A CV CAN BE CHECKED WITH NOTHING CONFIGURED.
 * ============================================================================
 * No Anthropic key, no OpenAI key, no Ollama, no network. That is not an edge
 * case — it is EVERY user's first launch, and for most of them it is every
 * launch after that too. "Works with no account and no API key" is the claim on
 * the box, and the analysis screen is where it is either kept or broken.
 *
 * A claim like that decays quietly. Nobody sets out to make CV analysis need a
 * key: somebody adds a "rewrite this bullet" button, or an enrichment call when
 * a CV is uploaded, or a model warm-up when the view opens, and it works
 * perfectly on their machine because their machine has keys. This file is what
 * turns that from something people remember into something the build refuses.
 *
 * So it does two things, and the second is the load-bearing one:
 *
 *   1. Drives the WHOLE analysis loop — upload a CV, paste an advert, run it,
 *      read a score — with `secret_status` answering false for every key and
 *      `ollama_probe` answering nothing.
 *   2. Asserts that NO PROVIDER TRANSPORT WAS INVOKED. Not `provider_chat`, not
 *      `provider_list_models`. If a future change makes this screen reach for a
 *      model, this fails, and it names the command it saw.
 *
 * The whole APP is rendered, not the view alone: the rail is part of what a
 * user sees, and an error banner up there would break the same promise just as
 * thoroughly.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ok } from '@cviper/core-types';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
}));

const parsing = vi.hoisted(() => ({ extractText: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));
vi.mock('@cviper/cv-parsing', () => ({ extractText: parsing.extractText }));

const { default: App } = await import('../../app/App');
const { markWelcomeSeen } = await import('../onboarding/store');
const { createFakeAnalysisPort } = await import('./test/fakePort');
const { createFakeTrackerPort } = await import('../tracker/test/fakePort');
const { createFakeFilePort } = await import('../../platform/test/fakeFilePort');

/** Commands that mean a provider was contacted. See `src/ai/transport.ts`. */
const PROVIDER_COMMANDS = ['provider_chat', 'provider_list_models'];

const NOW = new Date('2026-08-19T09:00:00.000Z');

const CV_TEXT =
  'Credit risk analyst, eight years in London banking. SQL, Python, Basel III, ' +
  'stress testing, IFRS 9 impairment models, stakeholder reporting to the CRO.';

const ADVERT =
  'Credit Risk Analyst, Lloyds. You will build SQL models, run stress tests and ' +
  'report on IFRS 9 impairment to the CRO. Python experience essential.';

function invokedProviderCommands(): string[] {
  return tauri.invoke.mock.calls
    .map(([command]) => command)
    .filter((command) => PROVIDER_COMMANDS.includes(command));
}

beforeEach(() => {
  localStorage.clear();
  // Past the first-run introduction, which is what every assertion in this file
  // is about — see `onboarding/firstRun.test.tsx` for the introduction itself.
  // Without this the app opens on the welcome screen and the shell is not drawn.
  markWelcomeSeen();
  tauri.invoke.mockReset();
  parsing.extractText.mockReset();
  tauri.invoke.mockImplementation(async (command) => {
    // A machine with nothing set up: no daemon, and not one saved credential.
    if (command === 'ollama_probe') return null;
    if (command === 'secret_status') return false;
    // Anything else reaching Rust is a failure of the promise, and it fails
    // loudly rather than resolving to something the UI can paper over.
    throw new Error(`unexpected command: ${command}`);
  });
});

afterEach(() => {
  cleanup();
});

describe('the analysis view on a machine with no keys and no Ollama', () => {
  it('runs the whole loop — upload, paste, check, read a score — and needs nothing', async () => {
    const user = userEvent.setup();
    const port = createFakeAnalysisPort();
    const filePort = createFakeFilePort();

    render(
      <App
        trackerPort={createFakeTrackerPort()}
        analysisPort={port}
        filePort={filePort}
        now={NOW}
      />,
    );

    // --- Get to the screen -------------------------------------------------
    await screen.findByTestId('status-strip');
    await user.click(screen.getByTestId('nav-analysis'));
    await screen.findByTestId('view-analysis');

    // --- The picker offers the one thing that always works -----------------
    const picker = (await screen.findByTestId('analysis-provider')) as HTMLSelectElement;
    expect(picker.value).toBe('keyword');
    // What the user can read, not one element of it: the label carries "no key
    // needed" and the note carries "works with nothing set up", and it is the
    // pair on screen together that keeps the promise.
    const pickerText = `${picker.textContent} ${screen.getByTestId('analysis-provider-note').textContent}`;
    expect(pickerText).toContain('no key needed');
    expect(pickerText).toContain('nothing set up');

    // --- Upload ------------------------------------------------------------
    filePort.nextCv({
      name: 'Steven Brady CV.docx',
      path: 'C:\\Users\\steve\\Documents\\CV.docx',
      bytes: new Uint8Array([80, 75, 3, 4]),
    });
    parsing.extractText.mockResolvedValue(ok({ text: CV_TEXT, pageCount: null, warnings: [] }));

    await user.click(screen.getByTestId('analysis-upload'));
    await screen.findByDisplayValue('Steven Brady CV.docx');
    expect(port.storedCvs()).toHaveLength(1);

    // --- Paste the advert --------------------------------------------------
    await user.type(screen.getByTestId('analysis-job-text'), ADVERT);
    expect(screen.getByTestId('analysis-run')).toHaveProperty('disabled', false);

    // --- Check it ----------------------------------------------------------
    await user.click(screen.getByTestId('analysis-run'));
    await screen.findByTestId('analysis-result');

    const score = Number(screen.getByTestId('band-scale-score').textContent);
    expect(Number.isNaN(score)).toBe(false);
    expect(score).toBeGreaterThan(0);

    // --- It says what produced the number ----------------------------------
    expect(screen.getByTestId('analysis-provenance').textContent).toContain(
      'Basic match — add an AI key for a full analysis.',
    );

    // --- It was written down -----------------------------------------------
    await vi.waitFor(() => expect(port.storedAnalyses()).toHaveLength(1));
    expect(port.storedAnalyses()[0]?.provider).toBe('keyword');

    // --- The two things this file exists to prove --------------------------
    expect(invokedProviderCommands()).toEqual([]);
    expect(screen.queryAllByRole('alert')).toEqual([]);
    expect(screen.queryByTestId('analysis-error')).toBeNull();
  });

  it('leaves the request counter at zero, because nothing was requested', async () => {
    // The counter is wired into the transport. A number above zero here would
    // mean something on this screen called a provider.
    const user = userEvent.setup();
    const port = createFakeAnalysisPort({
      cvs: [
        {
          id: 'cv-1',
          name: 'CV.docx',
          file_path: null,
          extracted_text: CV_TEXT,
          json_resume: null,
          created_at: '2026-08-01T09:00:00.000Z',
        },
      ],
    });

    render(
      <App
        trackerPort={createFakeTrackerPort()}
        analysisPort={port}
        filePort={createFakeFilePort()}
        now={NOW}
      />,
    );

    await screen.findByTestId('status-strip');
    await user.click(screen.getByTestId('nav-analysis'));
    await screen.findByDisplayValue('CV.docx');
    await user.type(screen.getByTestId('analysis-job-text'), ADVERT);
    await user.click(screen.getByTestId('analysis-run'));
    await screen.findByTestId('analysis-result');

    expect(screen.getByTestId('status-requests').textContent).toContain('0');
    expect(localStorage.getItem('cviper.light.requests')).toBeNull();
    expect(invokedProviderCommands()).toEqual([]);
  });

  it('offers no provider the machine cannot actually run', async () => {
    const user = userEvent.setup();

    render(
      <App
        trackerPort={createFakeTrackerPort()}
        analysisPort={createFakeAnalysisPort()}
        filePort={createFakeFilePort()}
        now={NOW}
      />,
    );

    await screen.findByTestId('status-strip');
    await user.click(screen.getByTestId('nav-analysis'));

    const picker = (await screen.findByTestId('analysis-provider')) as HTMLSelectElement;
    // Exactly one option, and it is the keyless one. A greyed-out "Ollama (not
    // installed)" row would be an advertisement, shown on every launch, for
    // software the user has never heard of.
    expect([...picker.options].map((option) => option.value)).toEqual(['keyword']);
    expect(invokedProviderCommands()).toEqual([]);
  });
});

describe('the guard itself', () => {
  it('would notice a provider call — proved, not assumed', async () => {
    // A guard that cannot fail is worse than no guard. This calls the real
    // transport directly, exactly as a future "rewrite this bullet" button
    // would, and shows that `invokedProviderCommands` sees it.
    const { createTauriTransport } = await import('../../ai/transport');
    tauri.invoke.mockResolvedValue(JSON.stringify({ status: 200, body: '{}' }));

    await createTauriTransport().chat('ollama', '{}');

    expect(invokedProviderCommands()).toEqual(['provider_chat']);
  });
});
