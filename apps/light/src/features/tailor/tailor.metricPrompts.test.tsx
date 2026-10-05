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

/**
 * Answers each chat with the next of `drafts` (the last one repeats), and keeps
 * every prompt it was sent.
 */
let gate: Promise<void> | null = null;

function recording(...drafts: readonly unknown[]) {
  const queue = drafts.length === 0 ? [FAITHFUL] : drafts;
  const prompts: string[] = [];
  const transport: ChatTransport = {
    chat: async (_provider, body) => {
      const parsed = JSON.parse(body) as { messages: { content: string }[] };
      prompts.push(parsed.messages.map((message) => message.content).join('\n'));
      const draft = queue[Math.min(prompts.length - 1, queue.length - 1)];
      const reply: Result<ProviderHttpResponse, ProviderError> = ok({
        status: 200,
        body: JSON.stringify({
          message: { role: 'assistant', content: JSON.stringify(draft) },
          done_reason: 'stop',
        }),
      });
      if (gate !== null) await gate;
      return reply;
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
  gate = null;
  autoExpand = true;
});

/** Most tests want the boxes open; the collapsed-state tests turn this off. */
let autoExpand = true;

const HANDOFF: TailorHandoff = {
  jobId: null,
  jobText: ADVERT,
  cvId: 'cv-2',
  optionKey: null,
  keywordGaps: { cvId: 'cv-2', advert: ADVERT, gaps: ['Power BI', 'stakeholders'] },
};

function screenFor(
  transport: ChatTransport,
  handoff: TailorHandoff | null,
  onHandoffHandled: () => void,
) {
  return (
    <Tailor
      port={createFakeTailorPort({ cvs: [cv('cv-1', 'CV.docx'), cv('cv-2', 'Banking CV.docx')] })}
      filePort={createFakeFilePort()}
      createTransport={() => transport}
      consentPort={createFakeConsentPort()}
      now={new Date('2026-09-29T09:00:00.000Z')}
      handoff={handoff}
      onHandoffHandled={onHandoffHandled}
    />
  );
}

async function renderWith(handoff: TailorHandoff | null, ...drafts: readonly unknown[]) {
  const { prompts, transport } = recording(...drafts);
  const onHandoffHandled = vi.fn();
  const user = userEvent.setup();
  const view = render(screenFor(transport, handoff, onHandoffHandled));
  await screen.findByTestId('view-tailor');
  if (handoff !== null) await vi.waitFor(() => expect(onHandoffHandled).toHaveBeenCalled());
  if (autoExpand) await expandAll(user);
  const rerenderWith = (next: TailorHandoff | null) => {
    view.rerender(screenFor(transport, next, onHandoffHandled));
  };
  return { prompts, user, rerenderWith };
}

/** Open the list and every box, as a user who wants to type would. */
async function expandAll(user: ReturnType<typeof userEvent.setup>) {
  const details = screen.queryByTestId('tailor-metric-prompts')?.querySelector('details');
  if (details === null || details === undefined) return;
  details.open = true;
  for (const button of screen.queryAllByRole('button', { name: /^Add a metric/ })) {
    await user.click(button);
  }
}

async function tailor(user: ReturnType<typeof userEvent.setup>, prompts: string[]) {
  await user.click(screen.getByTestId('tailor-run'));
  await screen.findByTestId('tailor-result');
  expect(prompts).toHaveLength(1);
  return prompts[0]!;
}

/** The box for one skill. */
function box(skill: string): HTMLElement {
  const found = screen
    .getAllByTestId('tailor-metric-prompt')
    .find((element) => element.getAttribute('data-skill') === skill);
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
    expect(addButton('Power BI').getAttribute('aria-disabled')).toBe('true');
    await user.type(input('Power BI'), '   ');
    expect(addButton('Power BI').getAttribute('aria-disabled')).toBe('true');
    await user.click(addButton('Power BI'));
    expect(box('Power BI').getAttribute('data-status')).toBe('editing');
    expect((await tailor(user, prompts)).includes(HEADING)).toBe(false);
  });

  it('keyboard: the input and the button are reachable by Tab and Enter approves', async () => {
    const { prompts, user } = await renderWith(HANDOFF);
    input('Power BI').focus();
    await user.keyboard('Saved 3 hours a week');
    await user.tab();
    expect(document.activeElement).toBe(addButton('Power BI'));
    await user.keyboard('{Enter}');

    expect(within(box('Power BI')).getByText(/we.ll use this in your next rewrite/i)).toBeTruthy();
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

  describe('the letter and the review get the same approved facts (C4)', () => {
    const NUMBER_CV = { ...FAITHFUL, summary: 'Cut month-end reporting from 5 days to 2.' };
    const LETTER = {
      greeting: 'Dear Hiring Manager,',
      paragraphs: ['I cut month-end reporting from 5 days to 2.'],
      sign_off: 'Yours sincerely,',
    };
    const REVIEW = { verdict: 'ready', issues: [] };
    const TYPED = 'Cut month-end reporting from 5 days to 2';

    async function approvedThenTailored(...replies: readonly unknown[]) {
      const ctx = await renderWith(HANDOFF, NUMBER_CV, ...replies);
      await ctx.user.type(input('Power BI'), TYPED);
      await ctx.user.click(addButton('Power BI'));
      await tailor(ctx.user, ctx.prompts);
      return ctx;
    }

    it('the cover letter prompt carries the marked section and its own figure check passes', async () => {
      const { prompts, user } = await approvedThenTailored(LETTER);
      await user.click(screen.getByTestId('tailor-letter-run'));
      await screen.findByTestId('tailor-letter');

      expect(prompts).toHaveLength(2);
      expect(prompts[1]).toContain(HEADING);
      expect(prompts[1]).toContain(`- [Power BI] ${TYPED}`);
      expect(screen.queryByTestId('tailor-letter-claims')).toBeNull();
    });

    it('the review prompt carries the marked section too', async () => {
      const { prompts, user } = await approvedThenTailored(REVIEW);
      await user.click(screen.getByTestId('tailor-review-run'));
      await screen.findByTestId('tailor-review');

      expect(prompts[1]).toContain(HEADING);
      expect(prompts[1]).toContain(`- [Power BI] ${TYPED}`);
    });

    it('uses what the CV was written with, even if the user later removes the entry', async () => {
      const { prompts, user } = await approvedThenTailored(LETTER);
      await user.click(within(box('Power BI')).getByRole('button', { name: /remove/i }));
      await user.click(screen.getByTestId('tailor-letter-run'));
      await screen.findByTestId('tailor-letter');

      expect(prompts[1]).toContain(`- [Power BI] ${TYPED}`);
    });

    it('negative: with nothing approved, neither the letter nor the review prompt has a section', async () => {
      const { prompts, user } = await renderWith(HANDOFF, FAITHFUL, LETTER, REVIEW);
      await tailor(user, prompts);
      await user.click(screen.getByTestId('tailor-letter-run'));
      await screen.findByTestId('tailor-letter');
      await user.click(screen.getByTestId('tailor-review-run'));
      await screen.findByTestId('tailor-review');

      expect(prompts).toHaveLength(3);
      expect(prompts[1]).not.toContain('CANDIDATE-SUPPLIED');
      expect(prompts[2]).not.toContain('CANDIDATE-SUPPLIED');
    });
  });
});

describe('collapsible, accessible boxes (D1-D7)', () => {
  beforeEach(() => {
    autoExpand = false;
  });

  const list = () => screen.getByTestId('tailor-metric-prompts');
  const details = () => list().querySelector('details') as HTMLDetailsElement;
  const open = (skill: string) =>
    within(box(skill)).getByRole('button', { name: `Add a metric, ${skill}` });

  it('D5: one closed details with a count, an intro line, and every gap collapsed', async () => {
    await renderWith(HANDOFF);
    expect(details().open).toBe(false);
    expect(within(list()).getByText(/Add a number or result for your gaps/).textContent).toBe(
      'Add a number or result for your gaps (optional, 0 of 2 added)',
    );
    expect(
      within(list()).getByText(
        'Optional: if you have a real number or result for any of these, add it. Skip the rest.',
      ),
    ).toBeTruthy();
    expect(list().querySelector('textarea')).toBeNull();
    expect(box('Power BI').textContent).toContain('Power BI');
    expect(box('Power BI').textContent).not.toContain('We found a keyword/skill gap');
  });

  it('D5: expanding shows the exact sentence; approving updates the count; skipping collapses to a line', async () => {
    const { user } = await renderWith(HANDOFF);
    details().open = true;
    await user.click(open('Power BI'));
    expect(box('Power BI').textContent).toContain(QUESTION('Power BI'));
    await user.type(input('Power BI'), 'Saved 3 hours');
    await user.click(addButton('Power BI'));
    expect(within(list()).getByText(/optional, 1 of 2 added/)).toBeTruthy();

    await user.click(open('stakeholders'));
    await user.click(within(box('stakeholders')).getByRole('button', { name: /^Not now/ }));
    expect(box('stakeholders').textContent).toContain('skipped');
    expect(box('stakeholders').querySelector('textarea')).toBeNull();
  });

  it('D7: a list of groups, each named by its question when open and its skill when collapsed', async () => {
    const { user } = await renderWith(HANDOFF);
    details().open = true;
    expect(list().querySelectorAll('ul > li')).toHaveLength(2);
    expect(within(list()).getByRole('group', { name: 'Power BI' })).toBeTruthy();
    await user.click(open('Power BI'));
    expect(within(list()).getByRole('group', { name: QUESTION('Power BI') })).toBeTruthy();
  });

  it('D7: button names start with their visible text and name the skill', async () => {
    const { user } = await renderWith(HANDOFF);
    details().open = true;
    await user.click(open('Power BI'));
    const b = within(box('Power BI'));
    expect(b.getByRole('button', { name: 'Add to rewrite, Power BI' }).textContent).toBe(
      'Add to rewrite',
    );
    expect(b.getByRole('button', { name: 'Not now, Power BI' }).textContent).toBe('Not now');
    await user.type(input('Power BI'), 'Saved 3 hours');
    await user.click(addButton('Power BI'));
    expect(b.getByRole('button', { name: 'Change, Power BI' }).textContent).toBe('Change');
    const remove = b.getByRole('button', { name: 'Remove from rewrite, Power BI' });
    expect(remove.textContent).toBe('Remove');
    expect(remove.parentElement?.className).toContain('flex-wrap');
  });

  it('D1: focus follows the user through every state change', async () => {
    const { user } = await renderWith(HANDOFF);
    details().open = true;
    await user.click(open('Power BI'));
    expect(document.activeElement).toBe(input('Power BI'));

    await user.type(input('Power BI'), 'Saved 3 hours');
    await user.click(addButton('Power BI'));
    const change = within(box('Power BI')).getByRole('button', { name: /^Change/ });
    expect(document.activeElement).toBe(change);

    await user.click(change);
    expect(document.activeElement).toBe(input('Power BI'));

    await user.click(within(box('Power BI')).getByRole('button', { name: /^Not now/ }));
    expect(document.activeElement).toBe(open('Power BI'));

    await user.click(open('Power BI'));
    await user.click(addButton('Power BI'));
    await user.click(within(box('Power BI')).getByRole('button', { name: /^Remove/ }));
    expect(document.activeElement).toBe(open('Power BI'));
  });

  it('D2: one polite status announces additions, skips and removals', async () => {
    const { user } = await renderWith(HANDOFF);
    details().open = true;
    const status = within(list()).getByRole('status');
    expect(status.className).toContain('sr-only');

    await user.click(open('Power BI'));
    await user.type(input('Power BI'), 'Saved 3 hours');
    await user.click(addButton('Power BI'));
    expect(status.textContent).toBe('Added to rewrite for Power BI');

    await user.click(open('stakeholders'));
    await user.click(within(box('stakeholders')).getByRole('button', { name: /^Not now/ }));
    expect(status.textContent).toBe('stakeholders skipped');
  });

  it('D3: the limit is enforced by the field and shown as a live counter', async () => {
    const { user } = await renderWith(HANDOFF);
    details().open = true;
    await user.click(open('Power BI'));
    expect(input('Power BI').maxLength).toBe(300);
    expect(box('Power BI').textContent).toContain('0 / 300');
    await user.type(input('Power BI'), 'abc');
    expect(box('Power BI').textContent).toContain('3 / 300');
  });

  it('D4: the approved line is text-success with an icon, and the hint is not faint', async () => {
    const { user } = await renderWith(HANDOFF);
    details().open = true;
    await user.click(open('Power BI'));
    expect(box('Power BI').querySelector('.text-ink-faint')).toBeNull();
    await user.type(input('Power BI'), 'Saved 3 hours');
    await user.click(addButton('Power BI'));
    const line = within(box('Power BI')).getByText(/We.ll use this in your next rewrite/);
    expect(line.className).toContain('text-success');
    expect(line.querySelector('svg')).not.toBeNull();
    expect(line.textContent).toContain('Added.');
  });

  it('D6: an empty Add button stays focusable, says why, and does nothing when pressed', async () => {
    const { user } = await renderWith(HANDOFF);
    details().open = true;
    await user.click(open('Power BI'));
    const add = addButton('Power BI');
    expect(add.getAttribute('aria-disabled')).toBe('true');
    expect(add.hasAttribute('disabled')).toBe(false);
    const hint = document.getElementById(add.getAttribute('aria-describedby') ?? '');
    expect(hint?.textContent).toBe('Type something first');
    await user.click(add);
    expect(box('Power BI').getAttribute('data-status')).toBe('editing');
    await user.type(input('Power BI'), 'x');
    expect(addButton('Power BI').getAttribute('aria-disabled')).toBe('false');
  });

  it('boundary: a gap named constructor is an ordinary box', async () => {
    const { user, prompts } = await renderWith({
      ...HANDOFF,
      keywordGaps: { cvId: 'cv-2', advert: ADVERT, gaps: ['constructor'] },
    });
    details().open = true;
    await user.click(open('constructor'));
    await user.type(input('constructor'), 'Saved 3 hours');
    await user.click(addButton('constructor'));
    expect(await tailor(user, prompts)).toContain('- [constructor] Saved 3 hours');
  });
});

describe('state across edits and runs (C8)', () => {
  it('Change, edit, then run without re-approving: nothing is sent for that gap', async () => {
    const { prompts, user } = await renderWith(HANDOFF);
    await user.type(input('Power BI'), 'Saved 3 hours');
    await user.click(addButton('Power BI'));
    await user.click(within(box('Power BI')).getByRole('button', { name: /^Change/ }));
    await user.type(input('Power BI'), ' and then some');

    const sent = await tailor(user, prompts);
    expect(sent).not.toContain('Saved 3 hours');
    expect(sent).not.toContain(HEADING);
  });

  it('a new handoff starts from a clean slate', async () => {
    const { user, rerenderWith } = await renderWith(HANDOFF);
    await user.type(input('Power BI'), 'Saved 3 hours');
    await user.click(addButton('Power BI'));
    expect(box('Power BI').getAttribute('data-status')).toBe('approved');

    rerenderWith({
      ...HANDOFF,
      keywordGaps: { cvId: 'cv-2', advert: ADVERT, gaps: ['Power BI', 'stakeholders'] },
    });
    await vi.waitFor(() => {
      expect(box('Power BI').getAttribute('data-status')).toBe('idle');
    });
  });

  it('the boxes cannot be changed while a run is in progress', async () => {
    const { prompts, user } = await renderWith(HANDOFF);
    await user.type(input('Power BI'), 'Saved 3 hours');
    let release: () => void = () => undefined;
    gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    await user.click(screen.getByTestId('tailor-run'));
    await vi.waitFor(() => {
      expect(input('Power BI').disabled).toBe(true);
    });
    expect(
      within(box('stakeholders')).getByRole<HTMLButtonElement>('button', { name: /^Not now/ })
        .disabled,
    ).toBe(true);

    release();
    await screen.findByTestId('tailor-result');
    expect(prompts).toHaveLength(1);
    expect(input('Power BI').disabled).toBe(false);
  });
});
