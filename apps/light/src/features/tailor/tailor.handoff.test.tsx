// @vitest-environment jsdom
/**
 * The Tailor screen receiving a job from Analysis or the tracker (L-190).
 *
 * A handoff is a SUGGESTION: the CV, the job and the option are each checked
 * against what this screen has loaded, and anything it does not have — a CV
 * since deleted, a job not on the board, the basic match, which cannot write a
 * paragraph — falls back to the screen's own default instead of leaving a
 * select pointing at nothing. The handoff is applied once, and the shell is
 * told so it is not applied again.
 *
 * The strongest assertion is the last step of the flow: tailor, then save to
 * the application — which only works if the handed-over job was selected and
 * its application with it.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ok, type Application, type Cv, type Job, type Result } from '@cviper/core-types';
import {
  type ChatTransport,
  type ProviderError,
  type ProviderHttpResponse,
} from '@cviper/ai-providers';

import type { TailorHandoff } from '../flow/handoff';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));

const { Tailor } = await import('./Tailor');
const { createFakeTailorPort } = await import('./test/fakePort');
const { createFakeConsentPort } = await import('../analysis/test/fakeConsentPort');
const { createFakeFilePort } = await import('../../platform/test/fakeFilePort');

type FakeTailorPort = ReturnType<typeof createFakeTailorPort>;

const NOW = new Date('2026-09-29T09:00:00.000Z');

const CV_TEXT = `Steve Brady
Senior Credit Risk Analyst, Lloyds Banking Group, London, Jan 2020 – Present
- Built IFRS 9 impairment models in Python, cutting run time by 40%.
BSc Mathematics, University of Leeds, 2016`;

function cv(id: string, name: string): Cv {
  return {
    id,
    name,
    file_path: null,
    extracted_text: CV_TEXT,
    json_resume: null,
    created_at: '2026-08-01T09:00:00.000Z',
  };
}

const JOB: Job = {
  id: 'job-1',
  source: 'reed',
  external_id: '1',
  title: 'Credit Risk Analyst',
  company: 'Lloyds',
  agency: null,
  location: 'London',
  salary_min: null,
  salary_max: null,
  salary_currency: null,
  salary_period: null,
  description: 'You will build SQL models and report on IFRS 9 impairment. Python essential.',
  url: null,
  posted_date: null,
  created_at: '2026-08-01T09:00:00.000Z',
};

const APPLICATION: Application = {
  id: 'app-1',
  job_id: 'job-1',
  status: 'saved',
  applied_date: null,
  notes: null,
  next_action: null,
  next_action_date: null,
  updated_at: '2026-09-29T09:00:00.000Z',
};

/** Two models pulled, so a handed-over choice is distinguishable from the default. */
const TAGS = JSON.stringify({
  models: ['llama3.2:3b', 'qwen2.5:7b'].map((model) => ({
    model,
    name: model,
    capabilities: ['completion'],
    details: { parameter_size: '3B' },
  })),
});

const FAITHFUL = {
  summary: 'Credit risk analyst who cut IFRS 9 model run time by 40% at Lloyds Banking Group.',
  key_skills: ['Python', 'IFRS 9'],
  experience: [
    {
      title: 'Senior Credit Risk Analyst',
      company: 'Lloyds Banking Group',
      location: 'London',
      dates: 'Jan 2020 – Present',
      bullets: ['Built IFRS 9 impairment models in Python, cutting run time by 40%.'],
    },
  ],
  education: ['BSc Mathematics, University of Leeds, 2016'],
  certifications: [],
};

function answering(content: unknown): ChatTransport {
  const reply: Result<ProviderHttpResponse, ProviderError> = ok({
    status: 200,
    body: JSON.stringify({
      message: { role: 'assistant', content: JSON.stringify(content) },
      done_reason: 'stop',
    }),
  });
  return {
    chat: () => Promise.resolve(reply),
    listModels: () => Promise.resolve(ok({ status: 200, body: TAGS })),
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

afterEach(() => {
  cleanup();
});

const HANDOFF: TailorHandoff = {
  jobId: 'job-1',
  jobText: 'Credit Risk Analyst\nLloyds\nLondon\n\nThe full advert, pasted over the preview.',
  cvId: 'cv-2',
  optionKey: 'ollama:qwen2.5:7b',
};

async function renderWith(
  handoff: TailorHandoff | null,
  options: { port?: FakeTailorPort; onHandoffHandled?: () => void } = {},
) {
  const port =
    options.port ??
    createFakeTailorPort({
      cvs: [cv('cv-1', 'CV.docx'), cv('cv-2', 'Banking CV.docx')],
      jobs: [JOB],
      applications: [APPLICATION],
    });
  const onHandoffHandled = options.onHandoffHandled ?? vi.fn();
  const user = userEvent.setup();

  const view = render(
    <Tailor
      port={port}
      filePort={createFakeFilePort()}
      createTransport={() => answering(FAITHFUL)}
      consentPort={createFakeConsentPort()}
      now={NOW}
      handoff={handoff}
      onHandoffHandled={onHandoffHandled}
    />,
  );
  await screen.findByTestId('view-tailor');
  return { port, user, onHandoffHandled, view };
}

const pick = (id: string) => screen.getByTestId<HTMLSelectElement>(id);
const advert = () => screen.getByTestId<HTMLTextAreaElement>('tailor-job-text');

describe('a handoff that fits', () => {
  it('selects the CV, the job, the advert and the option, then says it is handled', async () => {
    const { onHandoffHandled } = await renderWith(HANDOFF);

    await vi.waitFor(() => expect(onHandoffHandled).toHaveBeenCalledTimes(1));
    expect(pick('tailor-cv-pick').value).toBe('cv-2');
    expect(pick('tailor-job-pick').value).toBe('job-1');
    expect(advert().value).toBe(HANDOFF.jobText);
    // Not overwritten by the screen's default when the options land.
    expect(pick('tailor-provider').value).toBe('ollama:qwen2.5:7b');
  });

  it('says "handled" only once the screen already shows the handoff (ordering)', async () => {
    // Read the pickers AT THE MOMENT the shell is told. Before the fix this
    // callback ran inside the effect that queued the updates, so the screen
    // could still show the defaults — a race that surfaced as a rare flake.
    const seen: string[] = [];
    const onHandoffHandled = vi.fn(() => {
      seen.push(pick('tailor-cv-pick').value, pick('tailor-job-pick').value, advert().value);
    });
    await renderWith(HANDOFF, { onHandoffHandled });

    await vi.waitFor(() => expect(onHandoffHandled).toHaveBeenCalledTimes(1));
    expect(seen).toEqual(['cv-2', 'job-1', HANDOFF.jobText]);
  });

  it('selects the job’s application, so the tailored CV saves straight into it', async () => {
    const { port, user } = await renderWith(HANDOFF);
    await vi.waitFor(() => expect(pick('tailor-job-pick').value).toBe('job-1'));

    await user.click(screen.getByTestId('tailor-run'));
    await screen.findByTestId('tailor-result');
    expect(pick('tailor-application').value).toBe('app-1');
    await user.click(screen.getByTestId('tailor-save-application'));

    await vi.waitFor(() => expect(port.storedDocuments()).toHaveLength(1));
    expect(port.storedDocuments()[0]).toMatchObject({ application_id: 'app-1', kind: 'cv' });
  });

  it('is applied once: an edit afterwards is not put back', async () => {
    // No shell here to clear it — the screen itself must not re-apply it.
    const { user, onHandoffHandled } = await renderWith(HANDOFF);
    await vi.waitFor(() => expect(onHandoffHandled).toHaveBeenCalledTimes(1));

    await user.selectOptions(pick('tailor-cv-pick'), 'cv-1');
    await user.type(advert(), ' More.');

    expect(pick('tailor-cv-pick').value).toBe('cv-1');
    expect(advert().value).toBe(`${HANDOFF.jobText} More.`);
    expect(onHandoffHandled).toHaveBeenCalledTimes(1);
  });
});

describe('a handoff that does not fit, falling back safely', () => {
  it('negative: a job that is not on the board keeps the advert, selects no job, offers no application', async () => {
    const { onHandoffHandled } = await renderWith({ ...HANDOFF, jobId: 'job-deleted' });

    await vi.waitFor(() => expect(onHandoffHandled).toHaveBeenCalledTimes(1));
    expect(advert().value).toBe(HANDOFF.jobText);
    expect(pick('tailor-job-pick').value).toBe('');
  });

  it('negative: the basic match is never offered here, so the default model is used', async () => {
    const { onHandoffHandled } = await renderWith({ ...HANDOFF, optionKey: 'keyword' });

    await vi.waitFor(() => expect(onHandoffHandled).toHaveBeenCalledTimes(1));
    expect(pick('tailor-provider').value).toBe('ollama:llama3.2:3b');
  });

  it('negative: a CV that is gone leaves the default CV selected', async () => {
    const { onHandoffHandled } = await renderWith({ ...HANDOFF, cvId: 'cv-deleted' });

    await vi.waitFor(() => expect(onHandoffHandled).toHaveBeenCalledTimes(1));
    expect(pick('tailor-cv-pick').value).toBe('cv-1');
  });

  it('boundary: no CV and no option in the handoff leaves both at their defaults', async () => {
    const { onHandoffHandled } = await renderWith({ ...HANDOFF, cvId: null, optionKey: null });

    await vi.waitFor(() => expect(onHandoffHandled).toHaveBeenCalledTimes(1));
    expect(pick('tailor-cv-pick').value).toBe('cv-1');
    expect(pick('tailor-provider').value).toBe('ollama:llama3.2:3b');
    expect(pick('tailor-job-pick').value).toBe('job-1');
  });

  it('negative: a job list that could not be read still takes the advert', async () => {
    const port = createFakeTailorPort({ cvs: [cv('cv-1', 'CV.docx')], jobs: [JOB] });
    port.failNext('loadJobs');

    const { onHandoffHandled } = await renderWith(HANDOFF, { port });

    await vi.waitFor(() => expect(onHandoffHandled).toHaveBeenCalledTimes(1));
    expect(advert().value).toBe(HANDOFF.jobText);
  });

  it('boundary: no handoff changes nothing and tells nobody', async () => {
    const { onHandoffHandled } = await renderWith(null);

    await screen.findByDisplayValue('CV.docx');
    await vi.waitFor(() => expect(pick('tailor-provider').value).toBe('ollama:llama3.2:3b'));
    expect(advert().value).toBe('');
    expect(onHandoffHandled).not.toHaveBeenCalled();
  });
});
