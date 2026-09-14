// @vitest-environment jsdom
/**
 * The gates, wired into the analysis view (L-156).
 *
 * Same scaffold as `Analysis.test.tsx` — the parser is mocked, the scorer is
 * real — plus a fake profile port, because the gates read the PROFILE, not
 * the CV. The one assertion that matters most is the last in each case: the
 * score on screen is exactly what `scoreByKeywords` returns. A gate that
 * moved the number would be the bug this whole item exists to avoid.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { emptyProfile, type Cv, type Profile } from '@cviper/core-types';
import { scoreByKeywords } from '@cviper/keyword-scoring';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
}));

const parsing = vi.hoisted(() => ({
  extractText: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));
vi.mock('@cviper/cv-parsing', () => ({ extractText: parsing.extractText }));

const { Analysis } = await import('./Analysis');
const { createFakeAnalysisPort } = await import('./test/fakePort');
const { createFakeFilePort } = await import('../../platform/test/fakeFilePort');
const { createFakeProfilePort } = await import('../profile/test/fakePort');

const NOW = new Date('2026-09-14T09:00:00.000Z');

const CV_TEXT =
  'Credit risk analyst, eight years in London banking. SQL, Python, Basel III, ' +
  'stress testing, IFRS 9 impairment models, stakeholder reporting.';

const POLISH_ADVERT =
  'Credit Risk Analyst. You will build SQL models, run stress tests and report on ' +
  'IFRS 9 impairment to the CRO. Fluent Polish is essential. Python experience essential.';

const SILENT_ADVERT =
  'Credit Risk Analyst. You will build SQL models, run stress tests and report on ' +
  'IFRS 9 impairment to the CRO. Python experience essential.';

const CLEARANCE_ADVERT = SILENT_ADVERT + ' You must be eligible for SC clearance.';

const EXISTING_CV: Cv = {
  id: 'cv-1',
  name: 'Steven Brady CV.pdf',
  file_path: 'C:\\Users\\steve\\Documents\\CV.pdf',
  extracted_text: CV_TEXT,
  json_resume: null,
  created_at: '2026-08-01T09:00:00.000Z',
};

const PROFILE: Profile = {
  ...emptyProfile('2026-09-01T08:00:00.000Z'),
  work_rights: 'UK citizen',
  languages: [{ name: 'French', level: 'B2' }],
};

function nothingConfigured(): void {
  tauri.invoke.mockImplementation(async (command) => {
    if (command === 'ollama_probe') return null;
    if (command === 'secret_status') return false;
    throw new Error(`unexpected command: ${command}`);
  });
}

beforeEach(() => {
  tauri.invoke.mockReset();
  parsing.extractText.mockReset();
  nothingConfigured();
});

afterEach(() => {
  cleanup();
});

async function runAgainst(
  advert: string,
  profilePort: ReturnType<typeof createFakeProfilePort>,
): Promise<number> {
  const user = userEvent.setup();
  render(
    <Analysis
      port={createFakeAnalysisPort({ cvs: [EXISTING_CV] })}
      filePort={createFakeFilePort()}
      profilePort={profilePort}
      now={NOW}
    />,
  );
  await screen.findByDisplayValue('Steven Brady CV.pdf');
  await vi.waitFor(() => expect(screen.getByTestId('analysis-provider')).toBeTruthy());

  await user.type(screen.getByTestId('analysis-job-text'), advert);
  await user.click(screen.getByTestId('analysis-run'));
  await screen.findByTestId('analysis-result');

  return Number(screen.getByTestId('band-scale-score').textContent);
}

function expectedScore(advert: string): number {
  const scored = scoreByKeywords(CV_TEXT, advert);
  if (!scored.ok) throw new Error(scored.error.message);
  return scored.value.match_score;
}

describe('a language the profile does not have', () => {
  it('shows a hard stop with the advert quoted, above an unchanged score', async () => {
    const score = await runAgainst(POLISH_ADVERT, createFakeProfilePort(PROFILE));

    const row = screen.getByTestId('analysis-gate-language-0');
    expect(row.textContent).toContain('Language: Polish');
    expect(within(row).getByTestId('analysis-gate-verdict').textContent).toBe('Hard stop');
    expect(within(row).getByRole('blockquote').textContent).toBe('Fluent Polish is essential.');

    // Eligibility passed on a silent advert, and the citizen profile did not
    // turn it into anything else.
    expect(screen.getByTestId('analysis-gate-eligibility-0').textContent).toContain('Clear');

    // The gate is drawn BEFORE the result, and never in it.
    const gates = screen.getByTestId('analysis-gates');
    const result = screen.getByTestId('analysis-result');
    expect(gates.compareDocumentPosition(result) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(result).queryByTestId('analysis-gates')).toBeNull();

    expect(score).toBe(expectedScore(POLISH_ADVERT));
  });
});

describe('an advert that asks for nothing', () => {
  it('collapses to the one quiet line and leaves the score alone', async () => {
    const score = await runAgainst(SILENT_ADVERT, createFakeProfilePort(PROFILE));

    expect(screen.getByTestId('analysis-gates-clear')).toBeTruthy();
    expect(screen.queryByTestId('analysis-gates')).toBeNull();
    expect(score).toBe(expectedScore(SILENT_ADVERT));
  });
});

describe('when the profile cannot be read', () => {
  // NEGATIVE — a load failure is silent, and silence flags rather than fails.
  it('runs the gates with an empty profile: flags, never a hard stop', async () => {
    const profilePort = createFakeProfilePort(PROFILE);
    profilePort.failNext('load');

    const score = await runAgainst(POLISH_ADVERT, profilePort);

    const row = screen.getByTestId('analysis-gate-language-0');
    expect(within(row).getByTestId('analysis-gate-verdict').textContent).toBe('Check this');
    expect(screen.queryByTestId('analysis-error')).toBeNull();
    expect(score).toBe(expectedScore(POLISH_ADVERT));
  });

  // BOUNDARY — no profile row at all (a first run) is the same silence.
  it('treats a never-saved profile the same way', async () => {
    await runAgainst(CLEARANCE_ADVERT, createFakeProfilePort(null));

    const row = screen.getByTestId('analysis-gate-eligibility-0');
    expect(within(row).getByTestId('analysis-gate-verdict').textContent).toBe('Check this');
    expect(row.textContent).toContain('does not say what your work rights are');
  });
});
