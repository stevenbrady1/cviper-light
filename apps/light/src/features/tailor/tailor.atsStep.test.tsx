// @vitest-environment jsdom
/**
 * The ATS Score step on the real Tailor screen (L-198).
 *
 * The fixtures and the render helper are the ones `Tailor.test.tsx` uses, so
 * this runs the same tailoring a user would. The transport answers exactly as
 * many chats as the test queues and throws on one more — which is how
 * "re-scoring makes no AI call" is proved rather than assumed.
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

const tauri = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));

const { Tailor } = await import('./Tailor');
const { createFakeTailorPort } = await import('./test/fakePort');
const { createFakeConsentPort } = await import('../analysis/test/fakeConsentPort');
const { createFakeFilePort } = await import('../../platform/test/fakeFilePort');

const NOW = new Date('2026-08-19T09:00:00.000Z');

const CV_TEXT = `Steve Brady
Senior Credit Risk Analyst, Lloyds Banking Group, London, Jan 2020 – Present
- Built IFRS 9 impairment models in Python, cutting run time by 40%.
Analyst, Barclays, 2016 – 2019
- Ran stress tests.
BSc Mathematics, University of Leeds, 2016`;

const CV: Cv = {
  id: 'cv-1',
  name: 'CV.docx',
  file_path: null,
  extracted_text: CV_TEXT,
  json_resume: null,
  created_at: '2026-08-01T09:00:00.000Z',
};

const JOB: Job = {
  id: 'job-1',
  source: 'manual',
  external_id: null,
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
  status: 'applied',
  applied_date: '2026-08-10',
  notes: null,
  next_action: null,
  next_action_date: null,
  updated_at: '2026-08-10T09:00:00.000Z',
};

/** A daemon with one chat model pulled. */
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

/** A faithful tailored CV. */
const FAITHFUL = {
  summary: 'Credit risk analyst who cut IFRS 9 model run time by 40% at Lloyds Banking Group.',
  key_skills: ['Python', 'IFRS 9', 'Stress testing'],
  experience: [
    {
      title: 'Senior Credit Risk Analyst',
      company: 'Lloyds Banking Group',
      location: 'London',
      dates: 'Jan 2020 – Present',
      bullets: ['Built IFRS 9 impairment models in Python, cutting run time by 40%.'],
    },
    {
      title: 'Analyst',
      company: 'Barclays',
      location: '',
      dates: '2016 – 2019',
      bullets: ['Ran stress tests.'],
    },
  ],
  education: ['BSc Mathematics, University of Leeds, 2016'],
  certifications: [],
};

/** The same CV with an employer the original never had. */
const INVENTED = {
  ...FAITHFUL,
  experience: [
    ...FAITHFUL.experience,
    {
      title: 'Consultant',
      company: 'Goldman Sachs',
      location: 'London',
      dates: '2014 – 2016',
      bullets: ['Advised on credit models.'],
    },
  ],
};

function ollamaEnvelope(content: unknown): ProviderHttpResponse {
  return {
    status: 200,
    body: JSON.stringify({
      message: { role: 'assistant', content: JSON.stringify(content) },
      done_reason: 'stop',
    }),
  };
}

/** A transport that answers each chat from a queue, in order. */
function queuedTransport(replies: readonly unknown[]): ChatTransport {
  const queue = [...replies];
  return {
    chat(): Promise<Result<ProviderHttpResponse, ProviderError>> {
      const next = queue.shift();
      if (next === undefined) throw new Error('the transport was asked more than the test allows');
      return Promise.resolve(ok(ollamaEnvelope(next)));
    },
    listModels: () => Promise.resolve(ok({ status: 200, body: TAGS })),
  };
}

beforeEach(() => {
  tauri.invoke.mockReset();
  tauri.invoke.mockImplementation(async (command) => {
    // Ollama running, no cloud keys — the setup a privacy-minded user has.
    if (command === 'ollama_probe') return TAGS;
    if (command === 'secret_status') return false;
    throw new Error(`unexpected command: ${command}`);
  });
});

afterEach(() => {
  cleanup();
});

async function renderReady(replies: readonly unknown[]) {
  const port = createFakeTailorPort({ cvs: [CV], jobs: [JOB], applications: [APPLICATION] });
  const filePort = createFakeFilePort();
  const user = userEvent.setup();

  render(
    <Tailor
      port={port}
      filePort={filePort}
      createTransport={() => queuedTransport(replies)}
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
  return { port, filePort, user };
}

describe('the ATS Score step', () => {
  it('appears once a draft exists, between the draft and the save buttons', async () => {
    const { user } = await renderReady([FAITHFUL]);
    expect(screen.queryByTestId('tailor-ats')).toBeNull();

    await user.type(screen.getByTestId('tailor-job-text'), JOB.description ?? '');
    await user.click(screen.getByTestId('tailor-run'));

    const step = await screen.findByTestId('tailor-ats');
    const diff = screen.getByTestId('tailor-diff').closest('details');
    const firstSaveButton = screen.getByTestId('tailor-review-run');
    expect(diff).not.toBeNull();
    // DOCUMENT_POSITION_FOLLOWING (4): the step comes after the diff, and the
    // buttons come after the step.
    expect(diff!.compareDocumentPosition(step) & 4).toBe(4);
    expect(step.compareDocumentPosition(firstSaveButton) & 4).toBe(4);
  });

  it('shows the keyword score before and after, measured against the advert on screen', async () => {
    const { user } = await renderReady([FAITHFUL]);
    await user.type(screen.getByTestId('tailor-job-text'), JOB.description ?? '');
    await user.click(screen.getByTestId('tailor-run'));

    const row = await screen.findByTestId('tailor-ats-keyword');
    const cells = [...row.querySelectorAll('td')].map((cell) => cell.textContent ?? '');
    expect(cells[0]).toMatch(/^\d+$/);
    expect(cells[1]).toMatch(/^\d+/);
    expect(screen.getByTestId('tailor-ats-keyword-delta').textContent).not.toBe('—');
  });

  it('makes no AI call: one queued reply was enough for the draft AND the step', async () => {
    // `queuedTransport` throws if asked a second time. Rendering the step
    // after the draft would surface that throw as a failed run.
    const { user } = await renderReady([FAITHFUL]);
    await user.type(screen.getByTestId('tailor-job-text'), JOB.description ?? '');
    await user.click(screen.getByTestId('tailor-run'));
    await screen.findByTestId('tailor-ats');
    expect(screen.queryByTestId('tailor-error')).toBeNull();
  });

  it('repeats an unclean fabrication result on the step', async () => {
    const { user } = await renderReady([INVENTED]);
    await user.type(screen.getByTestId('tailor-job-text'), JOB.description ?? '');
    await user.click(screen.getByTestId('tailor-run'));

    const line = await screen.findByTestId('tailor-ats-fabrication');
    expect(line.getAttribute('data-clean')).toBe('false');
    expect(line.textContent).toContain('to check');
  });
});
