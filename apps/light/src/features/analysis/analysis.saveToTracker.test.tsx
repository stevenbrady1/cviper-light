// @vitest-environment jsdom
/**
 * L-325 — "Save this job to the tracker", after a check on a PASTED advert.
 *
 * A paste is not a tracked job, so it had no step bar and Tailor had to be
 * given the advert again. Saving makes it one: a job and a Saved application,
 * the check re-saved against that job, the step bar shown, and the CV and
 * engine recorded for the job so they follow it into Tailor. No AI, and the
 * title and company are typed by the user — never guessed from the advert.
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { err, ok, type Cv, type Job, type Result } from '@cviper/core-types';

import type { DbError } from '../../db';
import type { TrackerEntry } from '../tracker/model';

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
const { MAX_FIELD_LENGTH } = await import('../tracker/model');

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
const CV_2: Cv = { ...CV, id: 'cv-2', name: 'Banking CV.docx' };

const ADVERT =
  'Credit Risk Analyst, Lloyds. You will build SQL models, run stress tests and ' +
  'report on IFRS 9 impairment. Python experience essential.';

const TRACKED: Job = {
  id: 'job-1',
  source: 'reed',
  external_id: '1',
  title: 'Credit Risk Analyst',
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

const FAILURE: DbError = { code: 'QUERY_FAILED', message: 'The disk is full.', table: 'jobs' };

type AddToTracker = (entry: TrackerEntry) => Promise<Result<void, DbError>>;
type Choice = { cvId?: string | null; optionKey?: string | null };

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

async function renderAnalysis(
  options: {
    jobs?: readonly Job[];
    addToTracker?: AddToTracker;
    trackedJob?: Job;
  } = {},
) {
  const session = createAnalysisSession();
  if (options.trackedJob !== undefined) {
    loadJobIntoAnalysis(session, { job: options.trackedJob, applicationId: null, note: null });
  }
  const fake = createFakeAnalysisPort({ cvs: [CV, CV_2], jobs: options.jobs ?? [] });
  const addToTracker = vi.fn<AddToTracker>(options.addToTracker ?? (async () => ok(undefined)));
  const onJobChoice = vi.fn<(job: Job, choice: Choice) => void>();
  const createTransport = vi.fn(() => {
    throw new Error('no AI transport may be built to save a job');
  });
  const user = userEvent.setup();
  render(
    <Analysis
      port={{ ...fake, addToTracker }}
      filePort={createFakeFilePort()}
      consentPort={createFakeConsentPort()}
      profilePort={createFakeProfilePort()}
      createTransport={createTransport}
      now={new Date('2026-11-09T09:00:00.000Z')}
      session={session}
      onJobChoice={onJobChoice}
      onTailor={() => undefined}
    />,
  );
  await vi.waitFor(() =>
    expect(screen.getByTestId<HTMLSelectElement>('analysis-cv').disabled).toBe(false),
  );
  return { session, fake, addToTracker, onJobChoice, createTransport, user };
}

/** Paste the advert (unless a job brought one) and run the basic match. */
async function check(user: ReturnType<typeof userEvent.setup>, advert: string | null = ADVERT) {
  if (advert !== null) {
    await user.click(screen.getByTestId('analysis-job-text'));
    await user.paste(advert);
  }
  await user.click(screen.getByTestId('analysis-run'));
  await screen.findByTestId('analysis-result');
}

async function fillAndSave(
  user: ReturnType<typeof userEvent.setup>,
  fields: { title: string; company: string },
) {
  await user.click(screen.getByTestId('analysis-save-to-tracker'));
  if (fields.title !== '') {
    await user.click(screen.getByTestId('analysis-tracker-title'));
    await user.paste(fields.title);
  }
  if (fields.company !== '') {
    await user.click(screen.getByTestId('analysis-tracker-company'));
    await user.paste(fields.company);
  }
  await user.click(screen.getByTestId('analysis-tracker-save'));
}

describe('saving a pasted advert to the tracker (L-325)', () => {
  it('happy: a check then a save writes one job and one application, and the step bar appears', async () => {
    const { session, fake, addToTracker, onJobChoice, user } = await renderAnalysis();
    await check(user);
    expect(screen.queryByTestId('job-steps')).toBeNull();
    await vi.waitFor(() => expect(fake.storedAnalyses()).toHaveLength(1));

    const button = screen.getByTestId('analysis-save-to-tracker');
    expect(button.textContent).toBe('Save this job to the tracker');
    await user.click(button);
    // Changed on purpose (L-395): the boxes are labelled, so only the advert sentence is left.
    expect(screen.getByTestId('analysis-tracker-hint').textContent).toBe(
      'The advert you pasted is saved with it.',
    );
    expect(screen.getByLabelText('Job title')).toBe(screen.getByTestId('analysis-tracker-title'));
    expect(screen.getByLabelText('Company')).toBe(screen.getByTestId('analysis-tracker-company'));
    // Nothing guessed: both boxes start empty.
    expect(screen.getByTestId<HTMLInputElement>('analysis-tracker-title').value).toBe('');
    expect(screen.getByTestId<HTMLInputElement>('analysis-tracker-company').value).toBe('');

    await user.click(screen.getByTestId('analysis-tracker-title'));
    await user.paste('Credit Risk Analyst');
    await user.click(screen.getByTestId('analysis-tracker-company'));
    await user.paste('Lloyds');
    await user.click(screen.getByTestId('analysis-tracker-save'));

    const bar = await screen.findByTestId('job-steps');
    expect(bar.textContent).toContain('Credit Risk Analyst · Lloyds');

    expect(addToTracker).toHaveBeenCalledTimes(1);
    const [entry] = addToTracker.mock.calls[0]!;
    expect(entry.job).toMatchObject({
      source: 'manual',
      title: 'Credit Risk Analyst',
      company: 'Lloyds',
      description: ADVERT,
    });
    expect(entry.application).toMatchObject({ job_id: entry.job.id, status: 'saved' });

    // The check is re-saved against the new job — the same record, not a second one.
    await vi.waitFor(() => expect(fake.storedAnalyses()[0]?.job_id).toBe(entry.job.id));
    expect(fake.storedAnalyses()).toHaveLength(1);
    expect(session.get().jobId).toBe(entry.job.id);

    // The CV and engine follow the job into Tailor.
    expect(onJobChoice).toHaveBeenCalledWith(expect.objectContaining({ id: entry.job.id }), {
      cvId: 'cv-1',
      optionKey: 'keyword',
    });

    expect(screen.getByTestId('analysis-tracker-message').textContent).toBe(
      'Saved to your tracker, under Saved.',
    );
    expect(screen.getByTestId('analysis-tracker-status').textContent).toBe(
      'Saved to your tracker, under Saved.',
    );
    // Once saved, the offer is gone.
    expect(screen.queryByTestId('analysis-save-to-tracker')).toBeNull();
  });

  it('regression: the save path builds no AI transport and calls no provider (zero keys)', async () => {
    const { createTransport, user } = await renderAnalysis();
    await check(user);
    await fillAndSave(user, { title: 'Credit Risk Analyst', company: 'Lloyds' });
    await screen.findByTestId('job-steps');

    expect(createTransport).not.toHaveBeenCalled();
    const commands = tauri.invoke.mock.calls.map(([command]) => command);
    expect(commands.filter((command) => command.startsWith('provider_'))).toEqual([]);
  });

  it('negative: two presses of Save write one job', async () => {
    let finish: (value: Result<void, DbError>) => void = () => undefined;
    const pending = new Promise<Result<void, DbError>>((resolve) => {
      finish = resolve;
    });
    const { addToTracker, user } = await renderAnalysis({ addToTracker: () => pending });
    await check(user);
    await fillAndSave(user, { title: 'Credit Risk Analyst', company: 'Lloyds' });

    const save = screen.getByTestId<HTMLButtonElement>('analysis-tracker-save');
    expect(save.disabled).toBe(true);
    await user.click(save);
    expect(addToTracker).toHaveBeenCalledTimes(1);

    await act(async () => finish(ok(undefined)));
    await screen.findByTestId('job-steps');
    expect(addToTracker).toHaveBeenCalledTimes(1);
  });

  it('negative: a blank title says what to do and writes nothing', async () => {
    const { addToTracker, fake, user } = await renderAnalysis();
    await check(user);
    await vi.waitFor(() => expect(fake.calls.saveAnalysis).toBe(1));
    await fillAndSave(user, { title: '', company: 'Lloyds' });

    expect(screen.getByTestId('analysis-tracker-title-error').textContent).toBe(
      'Add a job title so you can tell this card from the others.',
    );
    expect(addToTracker).not.toHaveBeenCalled();
    expect(fake.calls.saveAnalysis).toBe(1);
    expect(screen.queryByTestId('job-steps')).toBeNull();
  });

  it('negative: a refused write shows why and keeps the offer', async () => {
    const { session, user } = await renderAnalysis({ addToTracker: async () => err(FAILURE) });
    await check(user);
    await fillAndSave(user, { title: 'Credit Risk Analyst', company: 'Lloyds' });

    await vi.waitFor(() =>
      expect(screen.getByTestId('analysis-tracker-message').textContent).toContain(
        'The disk is full.',
      ),
    );
    expect(session.get().jobId).toBeNull();
    expect(screen.queryByTestId('job-steps')).toBeNull();
    // Still there, still pressable: the user can try again.
    expect(screen.getByTestId<HTMLButtonElement>('analysis-tracker-save').disabled).toBe(false);
    expect(screen.getByTestId<HTMLInputElement>('analysis-tracker-title').value).toBe(
      'Credit Risk Analyst',
    );
  });

  it('negative: if the check cannot be linked, the job stays saved and a note says so', async () => {
    const { fake, addToTracker, session, user } = await renderAnalysis();
    await check(user);
    await vi.waitFor(() => expect(fake.calls.saveAnalysis).toBe(1));
    fake.failNext('saveAnalysis');
    await fillAndSave(user, { title: 'Credit Risk Analyst', company: 'Lloyds' });

    await screen.findByTestId('job-steps');
    expect(addToTracker).toHaveBeenCalledTimes(1);
    expect(session.get().jobId).not.toBeNull();
    const message = screen.getByTestId('analysis-tracker-message').textContent ?? '';
    expect(message).toContain('Saved to your tracker, under Saved.');
    expect(message).toContain('The database is locked by another copy of CViper.');
  });

  it('negative: if the check itself was never saved, the job is saved and a note says the check is not on it', async () => {
    const { fake, addToTracker, session, user } = await renderAnalysis();
    // The check's own history write fails, so there is no row to re-save.
    fake.failNext('saveAnalysis');
    await check(user);
    await vi.waitFor(() => expect(fake.calls.saveAnalysis).toBe(1));
    expect(fake.storedAnalyses()).toHaveLength(0);

    await fillAndSave(user, { title: 'Credit Risk Analyst', company: 'Lloyds' });

    await screen.findByTestId('job-steps');
    expect(addToTracker).toHaveBeenCalledTimes(1);
    expect(session.get().jobId).not.toBeNull();
    const note =
      'Saved to your tracker, under Saved. ' +
      'This check could not be added to the job: the check itself was not saved.';
    expect(screen.getByTestId('analysis-tracker-message').textContent).toBe(note);
    expect(screen.getByTestId('analysis-tracker-status').textContent).toBe(note);
    // Nothing is written back in its place: still the one failed attempt.
    expect(fake.calls.saveAnalysis).toBe(1);
  });

  it('boundary: a check whose row was saved links with no note', async () => {
    const { fake, user } = await renderAnalysis();
    await check(user);
    await vi.waitFor(() => expect(fake.storedAnalyses()).toHaveLength(1));

    await fillAndSave(user, { title: 'Credit Risk Analyst', company: 'Lloyds' });

    await screen.findByTestId('job-steps');
    await vi.waitFor(() => expect(fake.storedAnalyses()[0]?.job_id).not.toBeNull());
    expect(screen.getByTestId('analysis-tracker-message').textContent).toBe(
      'Saved to your tracker, under Saved.',
    );
    expect(screen.getByTestId('analysis-tracker-message').className).not.toContain('text-danger');
  });

  it('boundary: an empty or whitespace advert is not offered', async () => {
    const { session, user } = await renderAnalysis();
    await check(user);
    expect(screen.getByTestId('analysis-save-to-tracker')).toBeTruthy();

    act(() => session.update({ checkedAdvert: '   \n\t  ' }));
    expect(screen.queryByTestId('analysis-save-to-tracker')).toBeNull();
    act(() => session.update({ checkedAdvert: '' }));
    expect(screen.queryByTestId('analysis-save-to-tracker')).toBeNull();
  });

  it(`boundary: a ${MAX_FIELD_LENGTH}-character title is saved; ${MAX_FIELD_LENGTH + 1} is refused`, async () => {
    const first = await renderAnalysis();
    await check(first.user);
    await fillAndSave(first.user, { title: 'a'.repeat(MAX_FIELD_LENGTH + 1), company: 'Lloyds' });
    expect(screen.getByTestId('analysis-tracker-title-error').textContent).toBe(
      `Job title is too long. Keep it to ${MAX_FIELD_LENGTH} characters or fewer.`,
    );
    expect(first.addToTracker).not.toHaveBeenCalled();
    cleanup();

    const second = await renderAnalysis();
    await check(second.user);
    await fillAndSave(second.user, { title: 'a'.repeat(MAX_FIELD_LENGTH), company: 'Lloyds' });
    await screen.findByTestId('job-steps');
    expect(second.addToTracker).toHaveBeenCalledTimes(1);
  });

  it('boundary: an advert over the description cap shows the cap and writes nothing', async () => {
    const { session, addToTracker, user } = await renderAnalysis();
    await check(user);
    act(() => session.update({ checkedAdvert: 'x'.repeat(50_001) }));
    await fillAndSave(user, { title: 'Analyst', company: 'Lloyds' });

    expect(screen.getByTestId('analysis-tracker-description-error').textContent).toContain(
      'longer than 50,000 characters',
    );
    expect(addToTracker).not.toHaveBeenCalled();
  });

  it('edge: an advert already tracked word for word links to that job and writes no job', async () => {
    const already: Job = { ...TRACKED, description: ADVERT };
    const { session, fake, addToTracker, onJobChoice, user } = await renderAnalysis({
      jobs: [already],
    });
    await check(user);
    await vi.waitFor(() => expect(fake.storedAnalyses()).toHaveLength(1));

    expect(screen.queryByTestId('analysis-save-to-tracker')).toBeNull();
    expect(screen.getByTestId('analysis-tracker-duplicate').textContent).toContain(
      'You’re already tracking this advert.',
    );
    const use = screen.getByTestId('analysis-tracker-use-job');
    expect(use.textContent).toBe('Use that job');
    await user.click(use);

    const bar = await screen.findByTestId('job-steps');
    expect(bar.textContent).toContain('Credit Risk Analyst · Barclays');
    expect(addToTracker).not.toHaveBeenCalled();
    expect(session.get().jobId).toBe('job-1');
    await vi.waitFor(() => expect(fake.storedAnalyses()[0]?.job_id).toBe('job-1'));
    expect(fake.storedAnalyses()).toHaveLength(1);
    expect(onJobChoice).toHaveBeenCalledWith(expect.objectContaining({ id: 'job-1' }), {
      cvId: 'cv-1',
      optionKey: 'keyword',
    });
  });

  it('edge: a tracked job gets no offer', async () => {
    const { user } = await renderAnalysis({ jobs: [TRACKED], trackedJob: TRACKED });
    await screen.findByTestId('job-steps');
    await check(user, null);

    expect(screen.queryByTestId('analysis-save-to-tracker')).toBeNull();
    expect(screen.queryByTestId('analysis-tracker-duplicate')).toBeNull();
  });

  it('edge: switching CV clears the form', async () => {
    const { user } = await renderAnalysis();
    await check(user);
    await user.click(screen.getByTestId('analysis-save-to-tracker'));
    await user.click(screen.getByTestId('analysis-tracker-title'));
    await user.paste('Credit Risk Analyst');

    await user.selectOptions(screen.getByTestId('analysis-cv'), 'cv-2');
    expect(screen.queryByTestId('analysis-tracker-title')).toBeNull();

    await check(user, null);
    expect(screen.queryByTestId('analysis-tracker-title')).toBeNull();
    await user.click(screen.getByTestId('analysis-save-to-tracker'));
    expect(screen.getByTestId<HTMLInputElement>('analysis-tracker-title').value).toBe('');
  });

  it('edge: "Delete everything" resets it', async () => {
    const { session, user } = await renderAnalysis();
    await check(user);
    await user.click(screen.getByTestId('analysis-save-to-tracker'));
    await user.click(screen.getByTestId('analysis-tracker-title'));
    await user.paste('Credit Risk Analyst');

    act(() => session.reset());

    expect(screen.queryByTestId('analysis-save-to-tracker')).toBeNull();
    expect(screen.queryByTestId('analysis-tracker-title')).toBeNull();
    expect(session.get().checkedRecord).toBeNull();
  });
});
