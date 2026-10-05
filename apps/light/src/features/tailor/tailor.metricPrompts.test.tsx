// @vitest-environment jsdom
/**
 * L-205 on the Tailor screen: a gentle question per keyword gap, and nothing
 * the user types reaches the model unless they press "Add to rewrite".
 *
 * Asserted on the request body the transport is handed, which is what would
 * reach the model.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
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

const HEADING = '=== CANDIDATE-SUPPLIED ACHIEVEMENTS';

const QUESTION = (skill: string) =>
  `We found a keyword/skill gap for ${skill}. Do you have a quantifiable achievement or metric to add?`;

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

/** Answers every chat with `draft`, and keeps every prompt it was sent. */
function recording(draft: unknown = FAITHFUL) {
  const prompts: string[] = [];
  const reply: Result<ProviderHttpResponse, ProviderError> = ok({
    status: 200,
    body: JSON.stringify({
      message: { role: 'assistant', content: JSON.stringify(draft) },
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

async function renderWith(handoff: TailorHandoff | null, draft: unknown = FAITHFUL) {
  const { prompts, transport } = recording(draft);
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

async function tailor(user: ReturnType<typeof userEvent.setup>, prompts: string[]) {
  await user.click(screen.getByTestId('tailor-run'));
  await screen.findByTestId('tailor-result');
  expect(prompts).toHaveLength(1);
  return prompts[0]!;
}

/** The box for one skill, found by its question. */
function box(skill: string): HTMLElement {
  const found = screen
    .getAllByTestId('tailor-metric-prompt')
    .find((element) => element.textContent?.includes(QUESTION(skill)));
  if (found === undefined) throw new Error(`no box for ${skill}`);
  return found;
}

const input = (skill: string) =>
  within(box(skill)).getByRole<HTMLTextAreaElement>('textbox', {
    name: `Achievement or metric for ${skill}`,
  });
const addButton = (skill: string) =>
  within(box(skill)).getByRole<HTMLButtonElement>('button', { name: /add to rewrite/i });

describe('metric prompts on the Tailor screen (L-205)', () => {
  it('happy: one box per gap, with the exact sentence and a labelled input', async () => {
    await renderWith(HANDOFF);
    expect(screen.getAllByTestId('tailor-metric-prompt')).toHaveLength(2);
    expect(box('Power BI').textContent).toContain(QUESTION('Power BI'));
    expect(box('stakeholders').textContent).toContain(QUESTION('stakeholders'));
    expect(input('Power BI').value).toBe('');
  });

  it('negative: no gaps, no boxes', async () => {
    await renderWith({ ...HANDOFF, keywordGaps: null });
    expect(screen.queryByTestId('tailor-metric-prompt')).toBeNull();
  });

  it('negative: another CV is not the one analysed — the boxes go away', async () => {
    const { user } = await renderWith(HANDOFF);
    await user.selectOptions(screen.getByTestId('tailor-cv-pick'), 'cv-1');
    expect(screen.queryByTestId('tailor-metric-prompt')).toBeNull();
  });

  it('happy: typed and approved text reaches the prompt, marked as user-supplied', async () => {
    const { prompts, user } = await renderWith(HANDOFF);
    await user.type(input('Power BI'), 'Cut month-end reporting from 5 days to 2');
    await user.click(addButton('Power BI'));

    const sent = await tailor(user, prompts);
    expect(sent).toContain(HEADING);
    expect(sent).toContain('USER-SUPPLIED');
    expect(sent).toContain('- [Power BI] Cut month-end reporting from 5 days to 2');
  });

  it('negative: typed but never approved text is NOT sent', async () => {
    const { prompts, user } = await renderWith(HANDOFF);
    await user.type(input('Power BI'), 'Secret unapproved 99% claim');

    const sent = await tailor(user, prompts);
    expect(sent).not.toContain('Secret unapproved');
    expect(sent).not.toContain(HEADING);
  });

  it('negative: dismissed text is NOT sent, even if it was approved first', async () => {
    const { prompts, user } = await renderWith(HANDOFF);
    await user.type(input('Power BI'), 'Saved 3 hours a week');
    await user.click(addButton('Power BI'));
    await user.click(within(box('Power BI')).getByRole('button', { name: /remove/i }));

    const sent = await tailor(user, prompts);
    expect(sent).not.toContain('Saved 3 hours');
    expect(sent).not.toContain(HEADING);
  });

  it('negative: "Not now" on typed text drops it', async () => {
    const { prompts, user } = await renderWith(HANDOFF);
    await user.type(input('Power BI'), 'Saved 3 hours a week');
    await user.click(within(box('Power BI')).getByRole('button', { name: /not now/i }));

    const sent = await tailor(user, prompts);
    expect(sent).not.toContain('Saved 3 hours');
    expect(sent).not.toContain(HEADING);
  });

  it('negative: whitespace-only input cannot be approved', async () => {
    const { prompts, user } = await renderWith(HANDOFF);
    expect(addButton('Power BI').disabled).toBe(true);
    await user.type(input('Power BI'), '   ');
    expect(addButton('Power BI').disabled).toBe(true);
    expect((await tailor(user, prompts)).includes(HEADING)).toBe(false);
  });

  it('keyboard: the input and the button are reachable by Tab and Enter approves', async () => {
    const { prompts, user } = await renderWith(HANDOFF);
    input('Power BI').focus();
    await user.keyboard('Saved 3 hours a week');
    await user.tab();
    expect(document.activeElement).toBe(addButton('Power BI'));
    await user.keyboard('{Enter}');

    expect(within(box('Power BI')).getByText(/added to your rewrite/i)).toBeTruthy();
    expect(await tailor(user, prompts)).toContain('- [Power BI] Saved 3 hours a week');
  });

  it('boundary: a very long entry is capped in the box and in the prompt', async () => {
    const { prompts, user } = await renderWith(HANDOFF);
    await user.click(input('Power BI'));
    await user.paste('y'.repeat(5000));
    await user.click(addButton('Power BI'));

    const sent = await tailor(user, prompts);
    expect(sent).toContain(`- [Power BI] ${'y'.repeat(300)}\n`);
    expect(sent).not.toContain('y'.repeat(301));
  });

  it('boundary: the same gap twice in the analysis is one box', async () => {
    await renderWith({
      ...HANDOFF,
      keywordGaps: { cvId: 'cv-2', advert: ADVERT, gaps: ['Power BI', 'power bi'] },
    });
    expect(screen.getAllByTestId('tailor-metric-prompt')).toHaveLength(1);
  });

  it('anti-hallucination: an approved number is not flagged, an invented one still is', async () => {
    const withNumber = { ...FAITHFUL, summary: 'Cut month-end reporting from 5 days to 2.' };
    const first = await renderWith(HANDOFF, withNumber);
    await first.user.type(input('Power BI'), 'Cut month-end reporting from 5 days to 2');
    await first.user.click(addButton('Power BI'));
    await tailor(first.user, first.prompts);
    expect(screen.getByTestId('tailor-fabrication').textContent).not.toMatch(/\b5\b/);
    cleanup();

    // Not approved: the same draft's numbers are inventions again.
    const second = await renderWith(HANDOFF, withNumber);
    await second.user.type(input('Power BI'), 'Cut month-end reporting from 5 days to 2');
    await tailor(second.user, second.prompts);
    expect(screen.getByTestId('tailor-fabrication').textContent).toMatch(/5/);

    // Employers are still checked against the CV alone.
    cleanup();
    const forged = {
      ...FAITHFUL,
      experience: [{ ...FAITHFUL.experience[0]!, company: 'Goldman Sachs' }],
    };
    const third = await renderWith(HANDOFF, forged);
    await third.user.type(input('Power BI'), 'Worked at Goldman Sachs');
    await third.user.click(addButton('Power BI'));
    await tailor(third.user, third.prompts);
    expect(screen.getByTestId('tailor-fabrication').textContent).toMatch(/Goldman Sachs/);
  });
});
