// @vitest-environment jsdom
/**
 * The shared text-box styles, as a box on screen actually wears them (L-365).
 *
 * `fields.contract.test.ts` pins the constants and forbids copies. This file
 * checks the other half: a box that uses them still renders its invalid look
 * when it is invalid, and keeps its own layout classes on top of the shared
 * style. Read from the New application form, whose boxes use both, and (L-376)
 * from the Analysis and Tailor boxes: the save-to-tracker form, the compact
 * job and application pickers, the contact dialog and the CV correction box,
 * and (L-379) from Search, the AI key card and Profile.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { emptyProfile, type Application, type Cv, type Job } from '@cviper/core-types';

import { AnalysisAdvert } from '../features/analysis/AnalysisAdvert';
import { AnalysisSaveToTracker } from '../features/analysis/AnalysisSaveToTracker';
import { ProfileForm } from '../features/profile/ProfileForm';
import { EMPTY_FORM } from '../features/search/model';
import { SearchFields } from '../features/search/SearchFields';
import { SearchSaved } from '../features/search/SearchSaved';
import { AiKeySetup } from '../features/settings/keys/AiKeySetup';
import { createFakeAiKeyPort } from '../features/settings/keys/test/fakeAiKeyPort';
import { CvTextPanel } from '../features/tailor/CvTextPanel';
import { TailorContactDialog } from '../features/tailor/TailorContactDialog';
import { TailorSaveApplication } from '../features/tailor/TailorSaveApplication';
import { NewApplicationForm } from '../features/tracker/NewApplicationForm';
import { createFakeBrowserPort } from '../platform/test/fakeBrowserPort';

import { FIELD, FIELD_COMPACT, FIELD_INVALID } from './fields';

afterEach(cleanup);

function classesOf(style: string): string[] {
  return style.split(/\s+/).filter((name) => name !== '');
}

function renderForm() {
  render(<NewApplicationForm onCreate={() => undefined} onCancel={() => undefined} />);
  return userEvent.setup();
}

describe('a text box on the shared style (L-365)', () => {
  it('happy path: a box at rest wears every class of FIELD and no danger edge', () => {
    renderForm();
    const title = screen.getByLabelText('Job title');
    expect([...title.classList]).toEqual(expect.arrayContaining(classesOf(FIELD)));
    expect(title.classList.contains('border-danger')).toBe(false);
  });

  it('negative: an invalid box wears every class of FIELD_INVALID and loses the resting edge', async () => {
    const user = renderForm();
    await user.click(screen.getByRole('button', { name: 'Save application' }));

    const title = screen.getByLabelText('Job title');
    expect(title.getAttribute('aria-invalid')).toBe('true');
    expect([...title.classList]).toEqual(expect.arrayContaining(classesOf(FIELD_INVALID)));
    expect(title.classList.contains('border-field-line')).toBe(false);
  });

  it('boundary: a box with its own layout classes renders them and the shared style', () => {
    renderForm();
    const salary = screen.getByLabelText(/Salary from/);
    expect([...salary.classList].sort()).toEqual(
      [...classesOf(FIELD), 'mt-1', 'w-full', 'font-mono', 'tabular-nums'].sort(),
    );
  });

  it('boundary: an invalid box keeps its layout classes too', async () => {
    const user = renderForm();
    await user.click(screen.getByRole('button', { name: 'Save application' }));
    const title = screen.getByLabelText('Job title');
    expect([...title.classList].sort()).toEqual(
      [...classesOf(FIELD_INVALID), 'mt-1', 'w-full'].sort(),
    );
  });
});

const JOB: Job = {
  id: 'job-1',
  source: 'manual',
  external_id: null,
  title: 'Platform Engineer',
  company: 'Acme',
  agency: null,
  location: null,
  salary_min: null,
  salary_max: null,
  salary_currency: null,
  salary_period: null,
  description: 'Run the platform.',
  url: null,
  posted_date: null,
  created_at: '2026-11-01T09:00:00.000Z',
};

const APPLICATION: Application = {
  id: 'app-1',
  job_id: 'job-1',
  status: 'saved',
  applied_date: null,
  notes: null,
  next_action: null,
  next_action_date: null,
  updated_at: '2026-11-01T09:00:00.000Z',
};

function exactly(element: HTMLElement): string[] {
  return [...element.classList].sort();
}

function renderSaveToTracker() {
  render(
    <AnalysisSaveToTracker
      checkedAdvert="A pasted advert for a platform engineer."
      jobId={null}
      jobs={[]}
      record={null}
      addToTracker={() => Promise.resolve({ ok: true, value: undefined })}
      saveAnalysis={() => Promise.resolve({ ok: true, value: undefined })}
      now={undefined}
      onLinked={() => undefined}
    />,
  );
  return userEvent.setup();
}

describe('the Analysis and Tailor boxes on the shared style (L-376)', () => {
  it('happy path: the save-to-tracker title box at rest wears exactly FIELD and its layout', async () => {
    const user = renderSaveToTracker();
    await user.click(screen.getByTestId('analysis-save-to-tracker'));
    expect(exactly(screen.getByTestId('analysis-tracker-title'))).toEqual(
      [...classesOf(FIELD), 'mt-1', 'w-full'].sort(),
    );
  });

  it('negative: an invalid save-to-tracker box wears FIELD_INVALID and loses the resting edge', async () => {
    const user = renderSaveToTracker();
    await user.click(screen.getByTestId('analysis-save-to-tracker'));
    await user.click(screen.getByTestId('analysis-tracker-save'));

    const title = screen.getByTestId('analysis-tracker-title');
    expect(title.getAttribute('aria-invalid')).toBe('true');
    expect(exactly(title)).toEqual([...classesOf(FIELD_INVALID), 'mt-1', 'w-full'].sort());
    expect(title.classList.contains('border-field-line')).toBe(false);
  });

  it('boundary: the compact job picker wears exactly FIELD_COMPACT and its row layout, no standard padding', () => {
    render(
      <AnalysisAdvert
        jobNote={null}
        jobText=""
        onJobTextChange={() => undefined}
        jobs={[JOB]}
        onPickJob={() => undefined}
      />,
    );
    const picker = screen.getByTestId('analysis-job-pick');
    expect(exactly(picker)).toEqual([...classesOf(FIELD_COMPACT), 'min-w-0', 'flex-1'].sort());
    expect(picker.classList.contains('py-1.5')).toBe(false);
    expect(exactly(screen.getByTestId('analysis-job-text'))).toEqual(
      [...classesOf(FIELD), 'mt-1', 'w-full'].sort(),
    );
  });

  it('boundary: the application picker wears exactly FIELD_COMPACT and min-w-0', () => {
    render(
      <TailorSaveApplication
        applications={[APPLICATION]}
        selectedApplicationId="app-1"
        onSelectApplication={() => undefined}
        selectedJobId="job-1"
        applicationsFor="job-1"
        busy={false}
        saving={false}
        onSave={() => undefined}
      />,
    );
    expect(exactly(screen.getByTestId('tailor-application'))).toEqual(
      [...classesOf(FIELD_COMPACT), 'min-w-0'].sort(),
    );
  });

  it('boundary: a contact box wears exactly FIELD and its layout, from the renamed local style', () => {
    const empty = { name: '', email: '', phone: '' };
    render(
      <TailorContactDialog
        question={{ initial: empty, found: empty, format: 'docx', then: null }}
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(exactly(screen.getByTestId('tailor-contact-email'))).toEqual(
      [...classesOf(FIELD), 'mt-1', 'w-full'].sort(),
    );
  });

  it('boundary: the CV correction box keeps its own font class on top of FIELD', async () => {
    const cv: Cv = {
      id: 'cv-1',
      name: 'CV.pdf',
      file_path: null,
      extracted_text: 'A CV.',
      json_resume: null,
      created_at: '2026-11-01T09:00:00.000Z',
    };
    render(<CvTextPanel cv={cv} disabled={false} onSave={() => Promise.resolve(null)} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('tailor-cv-correct'));
    expect(exactly(screen.getByTestId('tailor-cv-edit-text'))).toEqual(
      [...classesOf(FIELD), 'mt-1', 'w-full', 'font-sans'].sort(),
    );
  });
});

function renderAiKeyCard() {
  render(
    <AiKeySetup ports={{ openai: createFakeAiKeyPort() }} browser={createFakeBrowserPort()} />,
  );
  return userEvent.setup();
}

describe('the Search, Settings key and Profile boxes on the shared style (L-379)', () => {
  it('happy path: an AI key box at rest wears exactly FIELD and its layout', async () => {
    renderAiKeyCard();
    await screen.findByTestId('ai-key-card-openai');
    expect(exactly(screen.getByTestId('ai-key-input-openai'))).toEqual(
      [...classesOf(FIELD), 'mt-1', 'w-full'].sort(),
    );
  });

  it('negative: an AI key box with an error wears FIELD_INVALID and loses the resting edge', async () => {
    const user = renderAiKeyCard();
    await screen.findByTestId('ai-key-card-openai');
    // Testing an empty box is refused before anything is sent.
    await user.click(screen.getByTestId('ai-key-test-openai'));
    await screen.findByTestId('ai-key-error-openai');

    const input = screen.getByTestId('ai-key-input-openai');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(exactly(input)).toEqual([...classesOf(FIELD_INVALID), 'mt-1', 'w-full'].sort());
    expect(input.classList.contains('border-field-line')).toBe(false);
  });

  it('boundary: the Search boxes keep their own layout: full width, or none for the contract picker', () => {
    render(<SearchFields form={EMPTY_FORM} errors={{}} onField={() => undefined} />);
    expect(exactly(screen.getByTestId('search-keywords'))).toEqual(
      [...classesOf(FIELD), 'mt-1', 'w-full'].sort(),
    );
    expect(exactly(screen.getByTestId('search-contract'))).toEqual(
      [...classesOf(FIELD), 'mt-1'].sort(),
    );
  });

  it('boundary: the saved-search name box keeps its fixed width on top of FIELD', async () => {
    render(
      <SearchSaved
        saved={[]}
        suggestedName="Analyst in Leeds"
        disabled={false}
        note={null}
        onSave={() => null}
        onRun={() => undefined}
        onDelete={() => undefined}
      />,
    );
    await userEvent.setup().click(screen.getByTestId('saved-search-open'));
    expect(exactly(screen.getByTestId('saved-search-name'))).toEqual(
      [...classesOf(FIELD), 'mt-1', 'w-64', 'max-w-full'].sort(),
    );
  });

  it('boundary: a Profile box wears exactly FIELD and its layout, from the renamed local style', () => {
    render(
      <ProfileForm
        loaded={{
          profile: emptyProfile('2026-11-01T09:00:00.000Z'),
          languageKeys: [],
          starKeys: [],
        }}
        onEdit={() => undefined}
        onAddLanguage={() => undefined}
        onLanguageChange={() => undefined}
        onRemoveLanguage={() => undefined}
        onAddStar={() => undefined}
        onStarChange={() => undefined}
        onRemoveStar={() => undefined}
      />,
    );
    for (const id of ['profile-headline', 'profile-writing-style']) {
      expect(exactly(screen.getByTestId(id)), id).toEqual(
        [...classesOf(FIELD), 'mt-1', 'w-full'].sort(),
      );
    }
  });
});
