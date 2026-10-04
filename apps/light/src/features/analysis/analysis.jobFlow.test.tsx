// @vitest-environment jsdom
/**
 * The Analysis screen's half of Find Job → Analyse → Tailor CV (L-190).
 *
 * A job arrives in the session (from Search or the tracker) with its advert,
 * its id and sometimes a note; the screen shows the note, keeps the job's id
 * through edits that are still that job, saves the check against it, and hands
 * the job, the CV and the option on to Tailor. Each test presses or types
 * something and asserts what it changed — the session, the stored history, or
 * the handoff.
 *
 * The basic match runs on every machine with no transport at all, so the runs
 * below need no fake provider.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type Cv, type Job } from '@cviper/core-types';

import type { TailorHandoff } from '../flow/handoff';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));

const { Analysis } = await import('./Analysis');
const { createAnalysisSession } = await import('./session');
const { createFakeAnalysisPort } = await import('./test/fakePort');
const { createFakeFilePort } = await import('../../platform/test/fakeFilePort');
const { createFakeConsentPort } = await import('./test/fakeConsentPort');
const { createFakeProfilePort } = await import('../profile/test/fakePort');
const { loadJobIntoAnalysis } = await import('../flow/handoff');

const NOW = new Date('2026-09-29T09:00:00.000Z');

const CV: Cv = {
  id: 'cv-1',
  name: 'CV.docx',
  file_path: null,
  extracted_text:
    'Credit risk analyst, eight years in London banking. SQL, Python, Basel III, ' +
    'stress testing, IFRS 9 impairment models, stakeholder reporting.',
  json_resume: null,
  created_at: '2026-08-01T09:00:00.000Z',
};

function job(id: string, title: string): Job {
  return {
    id,
    source: 'reed',
    external_id: id,
    title,
    company: 'Barclays',
    agency: null,
    location: 'London',
    salary_min: null,
    salary_max: null,
    salary_currency: null,
    salary_period: null,
    description: 'You will build SQL models in Python and report on IFRS 9 impairment.',
    url: null,
    posted_date: null,
    created_at: '2026-09-01T09:00:00.000Z',
  };
}

const HANDED = job('job-handed', 'Credit Risk Analyst');
const OTHER = job('job-other', 'Market Risk Analyst');
const NOTE = 'Only a preview of the advert came with this result.';

beforeEach(() => {
  tauri.invoke.mockReset();
  tauri.invoke.mockImplementation(async (command) => {
    if (command === 'ollama_probe') return null;
    if (command === 'secret_status') return false;
    throw new Error(`unexpected command: ${command}`);
  });
});

afterEach(() => {
  cleanup();
});

async function renderWithJob(
  options: { note?: string | null; onTailor?: (handoff: TailorHandoff) => void } = {},
) {
  const session = createAnalysisSession();
  loadJobIntoAnalysis(session, { job: HANDED, applicationId: 'app-1', note: options.note ?? null });
  const port = createFakeAnalysisPort({ cvs: [CV], jobs: [HANDED, OTHER] });
  const user = userEvent.setup();

  render(
    <Analysis
      port={port}
      filePort={createFakeFilePort()}
      consentPort={createFakeConsentPort()}
      profilePort={createFakeProfilePort()}
      now={NOW}
      session={session}
      {...(options.onTailor === undefined ? {} : { onTailor: options.onTailor })}
    />,
  );
  await screen.findByDisplayValue('CV.docx');
  await screen.findByTestId('analysis-job-pick');
  return { session, port, user };
}

function advert(): HTMLTextAreaElement {
  return screen.getByTestId<HTMLTextAreaElement>('analysis-job-text');
}

describe('a job that arrives with a note', () => {
  it('shows the note above the advert, as a status', async () => {
    await renderWithJob({ note: NOTE });

    const note = screen.getByTestId('analysis-job-note');
    expect(note.getAttribute('role')).toBe('status');
    expect(note.textContent).toBe(NOTE);
    expect(advert().value).toContain('Credit Risk Analyst');
    // Above the box, where it is read before the advert is.
    expect(note.compareDocumentPosition(advert()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('negative: no note, no box', async () => {
    await renderWithJob();

    expect(screen.queryByTestId('analysis-job-note')).toBeNull();
  });
});

describe('which job the advert belongs to', () => {
  it('picking a saved job makes it the job, and clears a note about the last one', async () => {
    const { session, user } = await renderWithJob({ note: NOTE });

    await user.selectOptions(screen.getByTestId('analysis-job-pick'), 'job-other');

    expect(session.get().jobId).toBe('job-other');
    expect(session.get().jobNote).toBeNull();
    expect(advert().value).toContain('Market Risk Analyst');
    expect(screen.queryByTestId('analysis-job-note')).toBeNull();
  });

  it('editing the advert — pasting the full one over a preview — keeps it that job', async () => {
    const { session, user } = await renderWithJob({ note: NOTE });

    await user.type(advert(), ' Stress testing experience.');

    expect(session.get().jobId).toBe('job-handed');
  });

  it('boundary: emptying the box leaves no job and no note', async () => {
    const { session, user } = await renderWithJob({ note: NOTE });

    await user.clear(advert());

    expect(session.get()).toMatchObject({ jobText: '', jobId: null, jobNote: null });
    expect(screen.queryByTestId('analysis-job-note')).toBeNull();
  });

  it('boundary: one character left is still that job', async () => {
    const { session } = await renderWithJob();

    fireEvent.change(advert(), { target: { value: 'x' } });

    expect(session.get().jobId).toBe('job-handed');
  });
});

describe('the check is saved against the job', () => {
  it('writes the job’s id into the history row', async () => {
    const { port, user } = await renderWithJob();

    await user.click(screen.getByTestId('analysis-run'));
    await screen.findByTestId('analysis-result');

    await vi.waitFor(() => expect(port.storedAnalyses()).toHaveLength(1));
    expect(port.storedAnalyses()[0]?.job_id).toBe('job-handed');
  });

  it('regression: a pasted advert with no job is still saved with no job', async () => {
    const { port, user } = await renderWithJob();
    await user.clear(advert());
    await user.type(advert(), 'Credit Risk Analyst. SQL and Python essential. IFRS 9.');

    await user.click(screen.getByTestId('analysis-run'));
    await screen.findByTestId('analysis-result');

    await vi.waitFor(() => expect(port.storedAnalyses()).toHaveLength(1));
    expect(port.storedAnalyses()[0]?.job_id).toBeNull();
  });
});

describe('on to Tailor', () => {
  it('hands the job, the advert, the CV and the option on', async () => {
    const onTailor = vi.fn<(handoff: TailorHandoff) => void>();
    const { user } = await renderWithJob({ onTailor });
    await user.click(screen.getByTestId('analysis-run'));
    await screen.findByTestId('analysis-result');

    await user.click(screen.getByTestId('analysis-to-tailor'));

    expect(onTailor).toHaveBeenCalledWith({
      jobId: 'job-handed',
      jobText: advert().value,
      cvId: 'cv-1',
      optionKey: 'keyword',
      // L-202: the result's keyword gaps, tied to this CV and the advert checked.
      keywordGaps: { cvId: 'cv-1', advert: advert().value, gaps: expect.any(Array) },
    });
    expect(onTailor.mock.calls[0]?.[0].keywordGaps?.gaps.length).toBeGreaterThan(0);
  });

  it('is offered only once there is a result, and never as a second primary button', async () => {
    const { user } = await renderWithJob({ onTailor: vi.fn() });
    expect(screen.queryByTestId('analysis-to-tailor')).toBeNull();

    await user.click(screen.getByTestId('analysis-run'));
    await screen.findByTestId('analysis-to-tailor');

    expect(document.querySelectorAll('[data-primary="true"]')).toHaveLength(1);
  });

  it('negative: with nowhere to go, no button is drawn', async () => {
    const { user } = await renderWithJob();
    await user.click(screen.getByTestId('analysis-run'));
    await screen.findByTestId('analysis-result');

    expect(screen.queryByTestId('analysis-to-tailor')).toBeNull();
  });
});
