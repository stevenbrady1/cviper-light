// @vitest-environment jsdom
/**
 * The Tracker's drop-downs draw the same arrow as Search (L-467): "Interview
 * stage", "Draft it with", "Prepare with", "Status", "Pay period" and "Read it
 * with". Each wears FIELD_SELECT (the browser's arrow off) in a `relative`
 * wrapper with the shared SelectChevron after it; "Pay period" wears
 * FIELD_SELECT_INVALID when its choice will not save. They stay real
 * `<select>`s, so the keyboard and screen readers work as before.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ok } from '@cviper/core-types';
import {
  type ChatTransport,
  type ProviderHttpResponse,
  type ProviderId,
} from '@cviper/ai-providers';

import { FIELD_SELECT, FIELD_SELECT_INVALID } from '../../app/fields';
import { type Availability } from '../analysis/providers';
import { createFakeConsentPort } from '../analysis/test/fakeConsentPort';

import { ApplicationDetail } from './ApplicationDetail';
import { FollowUpPanel } from './FollowUpPanel';
import { InterviewPanel } from './InterviewPanel';
import { createEntry, EMPTY_DRAFT, type ApplicationDraft, type TrackerEntry } from './model';
import { NewApplicationForm } from './NewApplicationForm';
import { PasteJobForm } from './PasteJobForm';
import { createFakeTrackerPort } from './test/fakePort';

afterEach(cleanup);

const NOW = new Date(2026, 8, 14, 9, 0, 0);

/** Ollama and an OpenAI key: two options, so every AI panel shows its picker. */
const TWO_OPTIONS: Availability = {
  ollamaRunning: true,
  ollamaModels: [{ id: 'llama3.2:latest', label: 'llama3.2' }],
  anthropicKey: false,
  openaiKey: true,
};

function entry(status: TrackerEntry['application']['status'] = 'applied'): TrackerEntry {
  const base = createEntry(
    {
      ...EMPTY_DRAFT,
      title: 'Credit Risk Analyst',
      company: 'Lloyds Banking Group',
      status,
      description: 'Second-line credit risk for the wholesale book.',
    },
    { jobId: 'job-1', applicationId: 'app-1' },
    '2026-09-01T09:00:00.000Z',
  );
  return { ...base, application: { ...base.application, applied_date: '2026-09-01' } };
}

/** A transport that never answers, so a run stays busy; it records who was asked. */
function hangingTransport(asked: ProviderId[] = []): () => ChatTransport {
  return () => ({
    chat: (provider) => {
      asked.push(provider);
      return new Promise<never>(() => {});
    },
    listModels: () => Promise.resolve(ok<ProviderHttpResponse>({ status: 200, body: '{}' })),
  });
}

function classesOf(element: Element): string[] {
  return element.className.split(/\s+/).filter((name) => name !== '');
}

/** The select's wrapper, its one hidden arrow, and the select itself. */
function drawn(select: HTMLElement): void {
  expect(select.tagName).toBe('SELECT');
  const wrapper = select.parentElement!;
  expect(classesOf(wrapper)).toContain('relative');
  expect(wrapper.querySelectorAll('svg')).toHaveLength(1);
  const mark = wrapper.querySelector('svg')!.closest('span')!;
  expect(mark.getAttribute('aria-hidden')).toBe('true');
  expect(mark.previousElementSibling).toBe(select);
  expect(mark.textContent).toBe('');
  expect(classesOf(mark)).toContain('pointer-events-none');
}

function wears(select: HTMLElement, constant: string): void {
  expect(classesOf(select)).toEqual(expect.arrayContaining(constant.split(' ')));
  expect(classesOf(select)).toContain('appearance-none');
}

function renderDetail(onSubstageChange = vi.fn()) {
  render(
    <ApplicationDetail
      entry={entry('interviewing')}
      today="2026-09-14"
      now={NOW}
      browser={{ open: () => Promise.resolve(ok(undefined)) }}
      onEdit={() => {}}
      onStatusChange={() => {}}
      substages={[
        { id: 'sub-a', name: 'HR Screen', position: 0 },
        { id: 'sub-b', name: 'Panel Round', position: 1 },
      ]}
      onSubstageChange={onSubstageChange}
      onEditSubstages={() => {}}
      onDelete={() => {}}
    />,
  );
  return onSubstageChange;
}

function renderFollowUp() {
  const current = entry();
  render(
    <FollowUpPanel
      entry={current}
      today="2026-09-13"
      port={createFakeTrackerPort([current])}
      readAvailability={() => Promise.resolve(TWO_OPTIONS)}
      createTransport={hangingTransport()}
      consentPort={createFakeConsentPort()}
      onEdit={() => {}}
    />,
  );
}

function renderInterview() {
  const current = entry('interviewing');
  render(
    <InterviewPanel
      entry={current}
      port={createFakeTrackerPort([current], { cvText: 'Jane Doe. SQL.' })}
      availability={TWO_OPTIONS}
      createTransport={hangingTransport()}
      consentPort={createFakeConsentPort()}
      now={NOW}
    />,
  );
}

function renderPaste(asked: ProviderId[] = []) {
  render(
    <PasteJobForm
      onExtracted={() => {}}
      onCancel={() => {}}
      createTransport={hangingTransport(asked)}
      readAvailability={() => Promise.resolve(TWO_OPTIONS)}
      consentPort={createFakeConsentPort({ openai: true })}
    />,
  );
}

function renderNew(initial?: ApplicationDraft) {
  const onCreate = vi.fn<(draft: ApplicationDraft) => void>();
  render(<NewApplicationForm onCreate={onCreate} onCancel={() => {}} initial={initial} />);
  return onCreate;
}

/** A draft whose salary has no period: "Pay period" will not save. */
const NO_PERIOD: ApplicationDraft = {
  ...EMPTY_DRAFT,
  title: 'Credit Risk Analyst',
  company: 'Lloyds Banking Group',
  salaryMin: '45000',
  salaryPeriod: '',
};

describe('Tracker drop-downs draw the same arrow as Search (L-467)', () => {
  it('happy: each sits in a relative wrapper with one hidden arrow, and wears FIELD_SELECT', async () => {
    renderDetail();
    drawn(screen.getByTestId('detail-substage'));
    wears(screen.getByTestId('detail-substage'), FIELD_SELECT);
    cleanup();

    renderFollowUp();
    const followUp = await screen.findByTestId('detail-followup-provider');
    drawn(followUp);
    wears(followUp, FIELD_SELECT);
    cleanup();

    renderInterview();
    drawn(screen.getByTestId('detail-interview-provider'));
    wears(screen.getByTestId('detail-interview-provider'), FIELD_SELECT);
    cleanup();

    renderPaste();
    const paste = await screen.findByTestId('paste-job-provider');
    drawn(paste);
    wears(paste, FIELD_SELECT);
    cleanup();

    renderNew();
    for (const name of ['Status', 'Pay period']) {
      const select = screen.getByRole('combobox', { name });
      drawn(select);
      wears(select, FIELD_SELECT);
      expect(classesOf(select)).not.toContain('border-danger');
    }
  });

  it('negative: the names are unchanged, and the arrow takes no Tab stop', async () => {
    const user = userEvent.setup();
    renderDetail();
    expect(screen.getByRole('combobox', { name: 'Interview stage' })).toBe(
      screen.getByTestId('detail-substage'),
    );
    // Tab goes from the stage straight to "Edit stages": nothing in between.
    screen.getByTestId('detail-substage').focus();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByTestId('detail-edit-substages'));
    cleanup();

    renderFollowUp();
    expect(await screen.findByRole('combobox', { name: 'Draft it with' })).toBe(
      screen.getByTestId('detail-followup-provider'),
    );
    cleanup();

    renderInterview();
    expect(screen.getByRole('combobox', { name: 'Prepare with' })).toBe(
      screen.getByTestId('detail-interview-provider'),
    );
    cleanup();

    renderPaste();
    expect(await screen.findByRole('combobox', { name: 'Read it with' })).toBe(
      screen.getByTestId('paste-job-provider'),
    );
    cleanup();

    renderNew();
    expect((screen.getByRole('combobox', { name: 'Status' }) as HTMLSelectElement).id).toBe(
      'new-status',
    );
    expect((screen.getByRole('combobox', { name: 'Pay period' }) as HTMLSelectElement).id).toBe(
      'new-salary-period',
    );
  });

  it('boundary: "Pay period" with an error wears the red edge and keeps its error wiring', async () => {
    const user = userEvent.setup();
    const onCreate = renderNew(NO_PERIOD);
    const period = screen.getByRole('combobox', { name: 'Pay period' });
    expect(classesOf(period)).not.toContain('border-danger');

    await user.click(screen.getByRole('button', { name: 'Save application' }));

    expect(onCreate).not.toHaveBeenCalled();
    wears(period, FIELD_SELECT_INVALID);
    expect(classesOf(period)).toContain('border-danger');
    expect(classesOf(period)).not.toContain('border-field-line');
    expect(period.getAttribute('aria-invalid')).toBe('true');
    expect(period.getAttribute('aria-describedby')).toBe('new-salary-period-error');
    expect(document.getElementById('new-salary-period-error')?.textContent).toBe(
      'Choose the period for these salary figures.',
    );
    drawn(period);

    // Choosing a period takes the red edge away again.
    await user.selectOptions(period, 'year');
    expect(classesOf(period)).not.toContain('border-danger');
    wears(period, FIELD_SELECT);
  });

  it('boundary: while busy, the AI pickers are disabled but still drawn, arrow and all', async () => {
    const user = userEvent.setup();

    renderFollowUp();
    const followUp = await screen.findByTestId<HTMLSelectElement>('detail-followup-provider');
    await waitFor(() =>
      expect(screen.getByTestId<HTMLButtonElement>('detail-followup-draft').disabled).toBe(false),
    );
    await user.click(screen.getByTestId('detail-followup-draft'));
    await waitFor(() => expect(followUp.disabled).toBe(true));
    drawn(followUp);
    cleanup();

    renderInterview();
    const interview = screen.getByTestId<HTMLSelectElement>('detail-interview-provider');
    await user.click(screen.getByTestId('detail-interview-prepare'));
    await waitFor(() => expect(interview.disabled).toBe(true));
    drawn(interview);
    cleanup();

    renderPaste();
    const paste = await screen.findByTestId<HTMLSelectElement>('paste-job-provider');
    await user.type(screen.getByTestId('paste-job-text'), 'Credit Risk Analyst at Lloyds.');
    await user.click(screen.getByTestId('paste-job-extract'));
    await waitFor(() => expect(paste.disabled).toBe(true));
    drawn(paste);
  });

  it('interaction: choosing a stage calls the handler with its id, and "No stage" with null', async () => {
    const user = userEvent.setup();
    const onSubstageChange = renderDetail();
    await user.selectOptions(screen.getByTestId('detail-substage'), 'Panel Round');
    expect(onSubstageChange).toHaveBeenLastCalledWith('sub-b');
    await user.selectOptions(screen.getByTestId('detail-substage'), 'No stage');
    expect(onSubstageChange).toHaveBeenLastCalledWith(null);
  });

  it('interaction: the chosen Status is the one saved', async () => {
    const user = userEvent.setup();
    const onCreate = renderNew({ ...EMPTY_DRAFT, title: 'Analyst', company: 'Acme' });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'Interviewing');
    await user.click(screen.getByRole('button', { name: 'Save application' }));
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreate.mock.calls[0]![0].status).toBe('interviewing');
  });

  it('interaction: the option chosen in "Read it with" is the one asked', async () => {
    const user = userEvent.setup();
    const asked: ProviderId[] = [];
    renderPaste(asked);
    const paste = await screen.findByTestId<HTMLSelectElement>('paste-job-provider');
    await user.selectOptions(paste, 'openai');
    expect(paste.value).toBe('openai');
    await user.type(screen.getByTestId('paste-job-text'), 'Credit Risk Analyst at Lloyds.');
    await user.click(screen.getByTestId('paste-job-extract'));
    await waitFor(() => expect(asked).toEqual(['openai']));
  });
});
