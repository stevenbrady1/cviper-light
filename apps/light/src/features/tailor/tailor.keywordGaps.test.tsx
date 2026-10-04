// @vitest-environment jsdom
/**
 * L-202 on the Tailor screen: the Analysis result's keyword gaps reach the
 * prompt while the screen is still tailoring the CV and advert they were found
 * for — and are left out the moment either changes.
 *
 * Asserted on the request body the transport is handed, which is what would
 * reach the model.
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

import type { TailorHandoff } from '../flow/handoff';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));

const { Tailor } = await import('./Tailor');
const { createFakeTailorPort } = await import('./test/fakePort');
const { createFakeConsentPort } = await import('../analysis/test/fakeConsentPort');
const { createFakeFilePort } = await import('../../platform/test/fakeFilePort');

const CV_TEXT = `Steve Brady
Senior Credit Risk Analyst, Lloyds Banking Group, London, Jan 2020 – Present
- Built IFRS 9 impairment dashboards in Python for the credit committee.
BSc Mathematics, University of Leeds, 2016`;

const ADVERT =
  'Credit Risk Analyst, Lloyds, London. You will build Power BI reporting on IFRS 9 ' +
  'impairment and present to stakeholders. Python essential.';

const HEADING = '=== ADVERT WORDS THE BASE CV DOES NOT USE';

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

/** Answers every chat with a faithful draft, and keeps every prompt it was sent. */
function recording() {
  const prompts: string[] = [];
  const reply: Result<ProviderHttpResponse, ProviderError> = ok({
    status: 200,
    body: JSON.stringify({
      message: { role: 'assistant', content: JSON.stringify(FAITHFUL) },
      done_reason: 'stop',
    }),
  });
  const transport: ChatTransport = {
    chat: (_provider, body) => {
      const parsed = JSON.parse(body) as { messages: { content: string }[] };
      prompts.push(parsed.messages.map((message) => message.content).join('\n'));
      return Promise.resolve(reply);
    },
    listModels: () => Promise.resolve(ok({ status: 200, body: TAGS })),
  };
  return { prompts, transport };
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
  jobId: null,
  jobText: ADVERT,
  cvId: 'cv-2',
  optionKey: null,
  keywordGaps: { cvId: 'cv-2', advert: ADVERT, gaps: ['Power BI', 'stakeholders'] },
};

async function renderWith(handoff: TailorHandoff | null) {
  const { prompts, transport } = recording();
  const onHandoffHandled = vi.fn();
  const user = userEvent.setup();
  render(
    <Tailor
      port={createFakeTailorPort({ cvs: [cv('cv-1', 'CV.docx'), cv('cv-2', 'Banking CV.docx')] })}
      filePort={createFakeFilePort()}
      createTransport={() => transport}
      consentPort={createFakeConsentPort()}
      now={new Date('2026-09-29T09:00:00.000Z')}
      handoff={handoff}
      onHandoffHandled={onHandoffHandled}
    />,
  );
  await screen.findByTestId('view-tailor');
  if (handoff !== null) await vi.waitFor(() => expect(onHandoffHandled).toHaveBeenCalled());
  return { prompts, user };
}

const advert = () => screen.getByTestId<HTMLTextAreaElement>('tailor-job-text');

async function tailor(user: ReturnType<typeof userEvent.setup>, prompts: string[]) {
  await user.click(screen.getByTestId('tailor-run'));
  await screen.findByTestId('tailor-result');
  expect(prompts).toHaveLength(1);
  return prompts[0]!;
}

describe('keyword gaps from the analysis (L-202)', () => {
  it('happy: the same CV and advert — the gaps reach the prompt, and the screen says so', async () => {
    const { prompts, user } = await renderWith(HANDOFF);

    const note = screen.getByTestId('tailor-keyword-gaps-note');
    expect(note.textContent).toContain('2 words');
    expect(note.textContent).toContain('only where your CV already shows');

    const sent = await tailor(user, prompts);
    expect(sent).toContain(HEADING);
    expect(sent).toContain('\n- Power BI\n');
    expect(sent).toContain('\n- stakeholders\n');
  });

  it('negative: no analysis — no section in the prompt, and no note', async () => {
    const { prompts, user } = await renderWith({ ...HANDOFF, keywordGaps: null });
    expect(screen.queryByTestId('tailor-keyword-gaps-note')).toBeNull();
    expect(await tailor(user, prompts)).not.toContain(HEADING);
  });

  it('negative: an edited advert is not the one analysed — the gaps are dropped', async () => {
    const { prompts, user } = await renderWith(HANDOFF);
    await user.type(advert(), ' Tableau too.');

    expect(screen.queryByTestId('tailor-keyword-gaps-note')).toBeNull();
    expect(await tailor(user, prompts)).not.toContain(HEADING);
  });

  it('negative: another CV is not the one analysed — the gaps are dropped', async () => {
    const { prompts, user } = await renderWith(HANDOFF);
    await user.selectOptions(screen.getByTestId('tailor-cv-pick'), 'cv-1');

    expect(screen.queryByTestId('tailor-keyword-gaps-note')).toBeNull();
    expect(await tailor(user, prompts)).not.toContain(HEADING);
  });

  it('edge: going back to the analysed CV brings the gaps back', async () => {
    const { prompts, user } = await renderWith(HANDOFF);
    await user.selectOptions(screen.getByTestId('tailor-cv-pick'), 'cv-1');
    await user.selectOptions(screen.getByTestId('tailor-cv-pick'), 'cv-2');

    expect(screen.getByTestId('tailor-keyword-gaps-note')).toBeTruthy();
    expect(await tailor(user, prompts)).toContain('\n- Power BI\n');
  });

  it('edge: the note counts the words the prompt will carry — a repeat is one word', async () => {
    const { prompts, user } = await renderWith({
      ...HANDOFF,
      keywordGaps: { cvId: 'cv-2', advert: ADVERT, gaps: ['Power BI', 'power bi', 'stakeholders'] },
    });
    expect(screen.getByTestId('tailor-keyword-gaps-note').textContent).toContain('2 words');
    expect((await tailor(user, prompts)).split('- Power BI\n')).toHaveLength(2);
  });

  it('negative: gaps that clean down to nothing show no note and add no section', async () => {
    const { prompts, user } = await renderWith({
      ...HANDOFF,
      keywordGaps: { cvId: 'cv-2', advert: ADVERT, gaps: ['===', '   '] },
    });
    expect(screen.queryByTestId('tailor-keyword-gaps-note')).toBeNull();
    expect(await tailor(user, prompts)).not.toContain(HEADING);
  });

  it('boundary: one gap says "1 word", not "1 words"', async () => {
    await renderWith({
      ...HANDOFF,
      keywordGaps: { cvId: 'cv-2', advert: ADVERT, gaps: ['Power BI'] },
    });
    expect(screen.getByTestId('tailor-keyword-gaps-note').textContent).toContain('1 word ');
  });
});
