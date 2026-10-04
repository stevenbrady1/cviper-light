// @vitest-environment jsdom
/**
 * L-202, through the whole shell: Analyse → "Tailor my CV for this job" →
 * Tailor CV, and what the Tailor prompt actually contains.
 *
 * ============================================================================
 * THE PROOF THAT MISSING SKILLS NEVER REACH THE PROMPT
 * ============================================================================
 * The analysis answer below lists a skill the candidate lacks under
 * `missing_skills` — and, as a sloppy model might, under `keyword_gaps` too.
 * Its sentinel word must appear nowhere in the prompt Tailor sends: not as a
 * gap, not anywhere. The real gaps must be there, so the test cannot pass by
 * sending nothing.
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

/** Never a real skill name, so a match anywhere in the prompt can only be a leak. */
const SENTINEL = 'Zyxwvutsql';

const CV_TEXT = `Steve Brady
Senior Credit Risk Analyst, Lloyds Banking Group, London, Jan 2020 – Present
- Built IFRS 9 impairment dashboards in Python for the credit committee.
- Presented quarterly impairment results to senior risk managers.
BSc Mathematics, University of Leeds, 2016`;

const ADVERT =
  'Credit Risk Analyst, London. You will build Power BI reporting on IFRS 9 impairment ' +
  'and present it to stakeholders. Python essential. Experience of the Zyxwvutsql ' +
  'platform is a plus.';

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

const ANALYSIS = {
  matched_skills: ['python', 'ifrs 9'],
  missing_skills: [SENTINEL],
  matched_keywords: ['impairment'],
  // The sentinel is ALSO here, as a careless model might put it.
  keyword_gaps: ['Power BI', SENTINEL, 'stakeholders'],
  ats_notes: [],
  suggestions: [],
  summary: 'A close fit.',
  match_score: 78,
  verdict: 'possible',
};

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

function answer(content: unknown): Result<ProviderHttpResponse, ProviderError> {
  return ok({
    status: 200,
    body: JSON.stringify({
      message: { role: 'assistant', content: JSON.stringify(content) },
      done_reason: 'stop',
    }),
  });
}

/** Answers the analysis and the tailoring, and keeps every tailoring prompt. */
function transport() {
  const tailorPrompts: string[] = [];
  const chat: ChatTransport = {
    chat: (_provider, body) => {
      const { messages } = JSON.parse(body) as { messages: { content: string }[] };
      const prompt = messages.map((message) => message.content).join('\n');
      if (prompt.includes('CV reformatting engine')) {
        tailorPrompts.push(prompt);
        return Promise.resolve(answer(DRAFT));
      }
      return Promise.resolve(answer(ANALYSIS));
    },
    listModels: () => Promise.resolve(ok({ status: 200, body: TAGS })),
  };
  return { chat, tailorPrompts };
}

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
  const { chat, tailorPrompts } = transport();
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
      now={new Date('2026-09-29T09:00:00.000Z')}
    />,
  );
  await screen.findByTestId('shell');
  return { user, tailorPrompts };
}

const field = (id: string) => screen.getByTestId<HTMLTextAreaElement | HTMLSelectElement>(id);

async function analyseThenTailor(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('nav-analysis'));
  await screen.findByDisplayValue('CV.docx');
  await vi.waitFor(() => expect(field('analysis-provider').value).toBe('ollama:llama3.2:3b'));
  await user.click(field('analysis-job-text'));
  await user.paste(ADVERT);
  await user.click(screen.getByTestId('analysis-run'));
  await screen.findByTestId('analysis-result');

  await user.click(screen.getByTestId('analysis-to-tailor'));
  await screen.findByTestId('view-tailor');
  await vi.waitFor(() => expect(field('tailor-job-text').value).toBe(ADVERT));
}

describe('Analyse → Tailor carries the keyword gaps, and only them (L-202)', () => {
  it('the gaps reach the Tailor prompt; the missing skill appears nowhere in it', async () => {
    const { user, tailorPrompts } = await renderApp();
    await analyseThenTailor(user);

    // Two words, not three: the one also listed as missing was dropped.
    expect(screen.getByTestId('tailor-keyword-gaps-note').textContent).toContain('2 words');

    await user.click(screen.getByTestId('tailor-run'));
    await screen.findByTestId('tailor-result');

    expect(tailorPrompts).toHaveLength(1);
    const prompt = tailorPrompts[0]!;
    expect(prompt).toContain('\n- Power BI\n');
    expect(prompt).toContain('\n- stakeholders\n');
    // The advert itself mentions the sentinel, so look at the gaps section.
    const start = prompt.indexOf('=== ADVERT WORDS THE BASE CV DOES NOT USE');
    const end = prompt.indexOf('=== END ADVERT WORDS ===');
    expect(start).toBeGreaterThan(-1);
    expect(prompt.slice(start, end)).not.toContain(SENTINEL);
    // And it is never offered as a word to use anywhere else either.
    expect(prompt.split(SENTINEL)).toHaveLength(2); // once: inside the advert
  });
});
