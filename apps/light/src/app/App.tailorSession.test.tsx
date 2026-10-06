// @vitest-environment jsdom
/**
 * L-199, through the whole shell: the Tailor screen's work belongs to the
 * shell, not to the view. Leave Tailor for the tracker and come back, and the
 * draft is still there; "Delete everything" takes it with the rest.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ok, type Cv, type Result } from '@cviper/core-types';
import {
  type ChatTransport,
  type ProviderError,
  type ProviderHttpResponse,
} from '@cviper/ai-providers';
import { type JobProviderId } from '@cviper/job-apis';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));

const { default: App } = await import('./App');
const { markWelcomeSeen } = await import('../features/onboarding/store');
const { createFakeTrackerPort } = await import('../features/tracker/test/fakePort');
const { createFakeProfilePort } = await import('../features/profile/test/fakePort');
const { createFakeAnalysisPort } = await import('../features/analysis/test/fakePort');
const { createFakeTailorPort } = await import('../features/tailor/test/fakePort');
const { createFakeSearchPort } = await import('../features/search/test/fakeSearchPort');
const { createFakeBoardPort } = await import('../features/boards/test/fakeBoardPort');
const { createFakeBackupPort } = await import('../features/settings/test/fakePort');
const { createFakeErasePort } = await import('../features/settings/erase/test/fakeErasePort');
const { createFakeFilePort } = await import('../platform/test/fakeFilePort');
const { createFakeOpenedCvPort } = await import('../platform/test/fakeOpenedCvPort');
const { createFakeBrowserPort } = await import('../platform/test/fakeBrowserPort');

const BOTH_KEYS: Record<JobProviderId, 'configured'> = { adzuna: 'configured', reed: 'configured' };

const CV_TEXT = `Steve Brady
Senior Credit Risk Analyst, Lloyds Banking Group, London, Jan 2020 – Present
- Built IFRS 9 impairment dashboards in Python for the credit committee.
BSc Mathematics, University of Leeds, 2016`;

const ADVERT =
  'Credit Risk Analyst, London. You will build reporting on IFRS 9 impairment and ' +
  'present it to stakeholders. Python essential.';

const CVS: Cv[] = [
  {
    id: 'cv-1',
    name: 'CV.docx',
    file_path: null,
    extracted_text: CV_TEXT,
    json_resume: null,
    created_at: '2026-08-01T09:00:00.000Z',
  },
];

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

const DRAFT = {
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

const ANSWER: Result<ProviderHttpResponse, ProviderError> = ok({
  status: 200,
  body: JSON.stringify({
    message: { role: 'assistant', content: JSON.stringify(DRAFT) },
    done_reason: 'stop',
  }),
});

const chat: ChatTransport = {
  chat: () => Promise.resolve(ANSWER),
  listModels: () => Promise.resolve(ok({ status: 200, body: TAGS })),
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  markWelcomeSeen();
  tauri.invoke.mockReset();
  tauri.invoke.mockImplementation(async (command) => {
    if (command === 'ollama_probe') return TAGS;
    if (command === 'secret_status') return false;
    throw new Error(`unexpected command ${command}`);
  });
});

afterEach(() => {
  cleanup();
});

async function renderApp() {
  const user = userEvent.setup();
  let counter = 0;
  render(
    <App
      trackerPort={createFakeTrackerPort([])}
      profilePort={createFakeProfilePort()}
      analysisPort={createFakeAnalysisPort({ cvs: CVS })}
      tailorPort={createFakeTailorPort({ cvs: CVS })}
      searchPort={createFakeSearchPort([])}
      boardsPort={createFakeBoardPort()}
      browser={createFakeBrowserPort()}
      readKeyStates={async () => BOTH_KEYS}
      filePort={createFakeFilePort()}
      openedCv={createFakeOpenedCvPort()}
      backupPort={createFakeBackupPort()}
      erasePort={createFakeErasePort()}
      createTransport={() => chat}
      newId={() => `generated-${(counter += 1)}`}
      now={new Date('2026-10-06T09:00:00.000Z')}
    />,
  );
  await screen.findByTestId('shell');
  return { user };
}

type User = ReturnType<typeof userEvent.setup>;

async function openTailor(user: User) {
  await user.click(screen.getByTestId('nav-tailor'));
  await screen.findByTestId('view-tailor');
  await vi.waitFor(() =>
    expect(screen.getByTestId<HTMLSelectElement>('tailor-provider').value).toBe(
      'ollama:llama3.2:3b',
    ),
  );
}

async function tailorAPaste(user: User) {
  await openTailor(user);
  await user.click(screen.getByTestId('tailor-job-text'));
  await user.paste(ADVERT);
  await user.click(screen.getByTestId('tailor-run'));
  await screen.findByTestId('tailor-result');
}

describe('Tailor keeps its work above the view switch (L-199)', () => {
  it('happy: a draft survives a trip to the tracker and back', async () => {
    const { user } = await renderApp();
    await tailorAPaste(user);

    await user.click(screen.getByTestId('nav-tracker'));
    await screen.findByTestId('view-tracker');
    await openTailor(user);

    expect(screen.getByTestId<HTMLTextAreaElement>('tailor-job-text').value).toBe(ADVERT);
    expect(screen.getByTestId('tailor-cv').textContent).toContain('IFRS 9 impairment dashboards');
  });

  it('negative: "Delete everything" takes the draft with it', async () => {
    const { user } = await renderApp();
    await tailorAPaste(user);

    await user.click(screen.getByTestId('nav-settings'));
    await user.click(await screen.findByTestId('settings-erase'));
    await user.click(await screen.findByTestId('settings-erase-confirm'));
    await user.click(await screen.findByTestId('welcome-skip'));
    await screen.findByTestId('shell');
    await openTailor(user);

    expect(screen.getByTestId<HTMLTextAreaElement>('tailor-job-text').value).toBe('');
    expect(screen.queryByTestId('tailor-result')).toBeNull();
  });
});
