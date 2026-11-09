// @vitest-environment jsdom
/**
 * L-348 — a bare link in the Tailor advert box never reaches a model.
 *
 * Same rig as the tracker's `urlOnlyPasteGuard.test.tsx` and Analysis's
 * `analysis.urlOnlyGuard.test.tsx`: count the chat transports BUILT, prove the
 * count stays at zero for a link, and prove the counter works by driving a real
 * advert through it and watching the count reach one.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ok, type Cv } from '@cviper/core-types';
import { type ChatTransport, type ProviderHttpResponse } from '@cviper/ai-providers';

import { type ProviderOption } from '../analysis/providers';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));

const { Tailor } = await import('./Tailor');
const { runTailor } = await import('./runTailor');
const { URL_ONLY_RUN_REASON } = await import('../tracker/pastedUrl');
const { createFakeTailorPort } = await import('./test/fakePort');
const { createFakeConsentPort } = await import('../analysis/test/fakeConsentPort');
const { createFakeFilePort } = await import('../../platform/test/fakeFilePort');

const NOW = new Date('2026-09-29T09:00:00.000Z');

const CV_TEXT = `Jamie Lewis
Senior Credit Risk Analyst, Lloyds Banking Group, London, Jan 2020 – Present
- Built IFRS 9 impairment dashboards in Python for the credit committee.
BSc Mathematics, University of Leeds, 2016`;

const ADVERT =
  'Credit Risk Analyst, Lloyds, London. You will build Power BI reporting on IFRS 9 ' +
  'impairment and present to stakeholders. Python essential.';

const LINK = 'https://jobs.example.com/advert/credit-risk-analyst';

const CV: Cv = {
  id: 'cv-1',
  name: 'CV.docx',
  file_path: null,
  extracted_text: CV_TEXT,
  json_resume: null,
  created_at: '2026-08-01T09:00:00.000Z',
};

const TAGS = JSON.stringify({
  models: [
    {
      model: 'llama3.2:3b',
      name: 'llama3.2:3b',
      capabilities: ['completion'],
      details: { parameter_size: '3B' },
    },
  ],
});

const FAITHFUL = {
  summary: 'Credit risk analyst who builds IFRS 9 impairment dashboards at Lloyds Banking Group.',
  key_skills: ['Python', 'IFRS 9'],
  experience: [
    {
      title: 'Senior Credit Risk Analyst',
      company: 'Lloyds Banking Group',
      location: 'London',
      dates: 'Jan 2020 – Present',
      bullets: ['Built IFRS 9 impairment dashboards in Python for the credit committee.'],
    },
  ],
  education: ['BSc Mathematics, University of Leeds, 2016'],
  certifications: [],
};

function envelope(): ProviderHttpResponse {
  return {
    status: 200,
    body: JSON.stringify({
      message: { role: 'assistant', content: JSON.stringify(FAITHFUL) },
      done_reason: 'stop',
    }),
  };
}

/** A transport factory that counts how many transports, and chats, it made. */
function counting() {
  const count = { built: 0, chats: 0 };
  const createTransport = (): ChatTransport => {
    count.built += 1;
    return {
      chat: () => {
        count.chats += 1;
        return Promise.resolve(ok(envelope()));
      },
      listModels: () => Promise.resolve(ok({ status: 200, body: TAGS })),
    };
  };
  return { count, createTransport };
}

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

async function renderReady(createTransport: () => ChatTransport) {
  const user = userEvent.setup();
  render(
    <Tailor
      port={createFakeTailorPort({ cvs: [CV] })}
      filePort={createFakeFilePort()}
      createTransport={createTransport}
      consentPort={createFakeConsentPort()}
      now={NOW}
    />,
  );
  await screen.findByDisplayValue('CV.docx');
  await vi.waitFor(() =>
    expect((screen.getByTestId('tailor-provider') as HTMLSelectElement).value).toBe(
      'ollama:llama3.2:3b',
    ),
  );
  return { user };
}

async function pasteAdvert(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.click(screen.getByTestId('tailor-job-text'));
  await user.paste(text);
}

describe('Tailor: a bare link instead of the advert (L-348)', () => {
  it('happy: a real advert still runs, and the counter reaches 1', async () => {
    const { count, createTransport } = counting();
    const { user } = await renderReady(createTransport);

    await pasteAdvert(user, ADVERT);
    expect(screen.getByTestId('tailor-run')).toHaveProperty('disabled', false);
    await user.click(screen.getByTestId('tailor-run'));

    await screen.findByTestId('tailor-result');
    expect(count.built).toBe(1);
    expect(count.chats).toBeGreaterThanOrEqual(1);
  });

  it('negative: a bare https link shows the reason, disables the button, builds 0 transports', async () => {
    const { count, createTransport } = counting();
    const { user } = await renderReady(createTransport);

    await pasteAdvert(user, LINK);

    const run = screen.getByTestId('tailor-run');
    expect(run).toHaveProperty('disabled', true);
    expect(screen.getByTestId('tailor-run-reason').textContent).toBe(URL_ONLY_RUN_REASON);
    await user.click(run);
    expect(count.built).toBe(0);
    expect(count.chats).toBe(0);
  });

  it('boundary: a short link with spaces around it gets the link reason, not "paste more"', async () => {
    const { count, createTransport } = counting();
    const { user } = await renderReady(createTransport);

    await pasteAdvert(user, '  https://a.co/x\n');

    expect(screen.getByTestId('tailor-run-reason').textContent).toBe(URL_ONLY_RUN_REASON);
    expect(screen.getByTestId('tailor-run')).toHaveProperty('disabled', true);
    expect(count.built).toBe(0);
  });
});

describe('runTailor: the backstop when called directly (L-348)', () => {
  const OLLAMA: ProviderOption = {
    key: 'ollama:llama3.2:3b',
    kind: 'ollama',
    label: 'Ollama · llama3.2:3b',
    note: '',
    model: 'llama3.2:3b',
    local: true,
    needsKey: false,
  };

  it('negative: a link returns the link error and builds 0 transports', async () => {
    const { count, createTransport } = counting();
    const result = await runTailor(
      { option: OLLAMA, cvText: CV_TEXT, jobText: LINK, profileNotes: null },
      createTransport,
    );
    expect(result).toEqual({ ok: false, error: { message: URL_ONLY_RUN_REASON } });
    expect(count.built).toBe(0);
  });

  it('negative: a cloud option is refused before consent is even asked', async () => {
    const { count, createTransport } = counting();
    const hasConsent = vi.fn(() => Promise.resolve(true));
    const result = await runTailor(
      {
        option: { ...OLLAMA, key: 'anthropic', kind: 'anthropic', model: 'claude', local: false },
        cvText: CV_TEXT,
        jobText: `\n${LINK} `,
        profileNotes: null,
      },
      createTransport,
      hasConsent,
    );
    expect(result).toEqual({ ok: false, error: { message: URL_ONLY_RUN_REASON } });
    expect(hasConsent).not.toHaveBeenCalled();
    expect(count.built).toBe(0);
  });

  it('happy: a real advert on the same call builds exactly 1 transport', async () => {
    const { count, createTransport } = counting();
    const result = await runTailor(
      { option: OLLAMA, cvText: CV_TEXT, jobText: ADVERT, profileNotes: null },
      createTransport,
    );
    expect(result.ok).toBe(true);
    expect(count.built).toBe(1);
  });
});
