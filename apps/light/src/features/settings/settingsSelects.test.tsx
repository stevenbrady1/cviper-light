// @vitest-environment jsdom
/**
 * The Settings, job-board and Tailor drop-downs draw the same arrow as Search
 * (L-468): "A space in the search becomes", "AI model", "Choose a model from
 * the service’s list" and "Application to save into". Each wears FIELD_SELECT
 * (the browser's arrow off) in a `relative` wrapper with the shared
 * SelectChevron after it; Tailor's small picker wears FIELD_SELECT_COMPACT.
 * They stay real `<select>`s, so the keyboard and screen readers work as before.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ok, type Application } from '@cviper/core-types';

import { FIELD_SELECT, FIELD_SELECT_COMPACT } from '../../app/fields';
import { createFakeBrowserPort } from '../../platform/test/fakeBrowserPort';
import { AI_MODEL_CHOICES, chosenModel, defaultModelFor } from '../analysis/modelChoice';
import { readCustomModel } from '../analysis/customModel';
import { BoardSettings } from '../boards/BoardSettings';
import { createFakeBoardPort } from '../boards/test/fakeBoardPort';
import { COUNTRY_STORAGE_KEY } from '../search/country';
import { TailorSaveApplication } from '../tailor/TailorSaveApplication';

import { AiKeySetup } from './keys/AiKeySetup';
import type { AiKeyProviderId } from './keys/aiKeyModel';
import { AI_KEY_PROVIDER_IDS } from './keys/aiKeyProviders';
import { CustomServiceCard } from './keys/CustomServiceCard';
import { type CustomServicePort } from './keys/customServicePort';
import { createFakeAiKeyPort, type FakeAiKeyPort } from './keys/test/fakeAiKeyPort';

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(COUNTRY_STORAGE_KEY, 'gb');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

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

/** The job boards, with "Add a board" open so the encoding picker is drawn. */
async function openBoardForm() {
  const user = userEvent.setup();
  render(<BoardSettings port={createFakeBoardPort()} />);
  await user.click(await screen.findByTestId('boards-add-open'));
  return { user, select: screen.getByTestId('boards-new-encoding') as HTMLSelectElement };
}

function renderKeys() {
  const ports = Object.fromEntries(
    AI_KEY_PROVIDER_IDS.map((id) => [id, createFakeAiKeyPort()]),
  ) as Record<AiKeyProviderId, FakeAiKeyPort>;
  render(<AiKeySetup ports={ports} browser={createFakeBrowserPort()} />);
  return userEvent.setup();
}

function modelSelect(id: AiKeyProviderId): HTMLSelectElement {
  return screen.getByTestId(`ai-model-${id}`) as HTMLSelectElement;
}

/** A saved service whose list holds two models. */
function savedService(): CustomServicePort {
  return {
    status: () =>
      Promise.resolve(
        ok({ address: 'https://api.example.com/v1', ownNetwork: false, hasKey: true }),
      ),
    save: () => Promise.resolve(ok(undefined)),
    remove: () => Promise.resolve(ok(undefined)),
    listModels: () =>
      Promise.resolve(
        ok([
          { id: 'qwen2.5-7b-instruct', label: 'qwen2.5-7b-instruct' },
          { id: 'mistral-small', label: 'mistral-small' },
        ]),
      ),
  };
}

async function openServiceList() {
  const user = userEvent.setup();
  render(<CustomServiceCard port={savedService()} />);
  const select = (await screen.findByTestId('custom-service-model-select')) as HTMLSelectElement;
  await waitFor(() => expect(select.options.length).toBe(3));
  return { user, select };
}

function application(id: string, applied: string | null): Application {
  return {
    id,
    job_id: 'job-1',
    status: 'interviewing',
    applied_date: applied,
    notes: null,
    next_action: null,
    next_action_date: null,
    updated_at: '2026-11-26T09:00:00.000Z',
  };
}

function renderPicker(onSelectApplication: (id: string | null) => void = () => undefined) {
  render(
    <TailorSaveApplication
      applications={[application('app-1', '2026-11-26'), application('app-2', null)]}
      selectedApplicationId="app-1"
      onSelectApplication={onSelectApplication}
      selectedJobId="job-1"
      applicationsFor="job-1"
      busy={false}
      saving={false}
      onSave={() => undefined}
    />,
  );
  return screen.getByTestId('tailor-application') as HTMLSelectElement;
}

describe('the Settings, job-board and Tailor drop-downs draw Search’s arrow (L-468)', () => {
  it('happy: each sits in a relative wrapper with one hidden arrow after it, on the select style', async () => {
    const { select: encoding } = await openBoardForm();
    drawn(encoding);
    wears(encoding, FIELD_SELECT);
    cleanup();

    renderKeys();
    for (const id of AI_KEY_PROVIDER_IDS) {
      drawn(modelSelect(id));
      wears(modelSelect(id), FIELD_SELECT);
    }
    cleanup();

    const { select: service } = await openServiceList();
    drawn(service);
    wears(service, FIELD_SELECT);
    cleanup();

    const picker = renderPicker();
    drawn(picker);
    wears(picker, FIELD_SELECT_COMPACT);
  });

  it('negative: every name is unchanged, and the arrow adds no words', async () => {
    await openBoardForm();
    expect(screen.getByRole('combobox', { name: 'A space in the search becomes' })).toBe(
      screen.getByTestId('boards-new-encoding'),
    );
    cleanup();

    renderKeys();
    expect(screen.getByLabelText('AI model', { selector: '#ai-model-google' })).toBe(
      modelSelect('google'),
    );
    cleanup();

    const { select } = await openServiceList();
    expect(screen.getByRole('combobox', { name: 'Choose a model from the service’s list' })).toBe(
      select,
    );
    expect(select.parentElement!.textContent).toBe(select.textContent);
    cleanup();

    const picker = renderPicker();
    expect(screen.getByRole('combobox', { name: 'Application to save into' })).toBe(picker);
  });

  it('negative: the small picker is not the standard select, nor the standard select the small one', () => {
    const picker = renderPicker();
    expect(classesOf(picker)).toContain('py-1');
    expect(classesOf(picker)).not.toContain('py-1.5');
    expect(classesOf(picker)).not.toContain('px-2.5');
  });

  it('boundary: "A space in the search becomes" keeps its natural width', async () => {
    const { select } = await openBoardForm();
    expect(classesOf(select)).not.toContain('w-full');
    expect(classesOf(select.parentElement!)).not.toContain('w-full');
    expect(classesOf(select.parentElement!)).toContain('inline-flex');
  });

  it('boundary: the service list keeps its disabled placeholder while no model is chosen', async () => {
    const { select } = await openServiceList();
    expect(select.value).toBe('');
    const placeholder = select.options[0]!;
    expect(placeholder.value).toBe('');
    expect(placeholder.disabled).toBe(true);
    expect(placeholder.textContent).toBe('Choose a model from the service’s list');
  });

  it('boundary: the small picker shrinks rather than pushes, and keeps a long option whole', () => {
    const picker = renderPicker();
    expect(classesOf(picker)).toEqual(expect.arrayContaining(['min-w-0', 'max-w-full']));
    expect(classesOf(picker.parentElement!)).toEqual(
      expect.arrayContaining(['inline-flex', 'max-w-full', 'min-w-0']),
    );
    expect(picker.options[0]?.textContent).toBe('interviewing · applied 2026-11-26');
  });
});

describe('the drop-downs still do their jobs (L-468)', () => {
  it('choosing an encoding shows it', async () => {
    const { user, select } = await openBoardForm();
    await user.selectOptions(select, 'hyphen');
    expect(select.value).toBe('hyphen');
  });

  it('choosing an AI model keeps it, and the select shows it', async () => {
    const user = renderKeys();
    const pick = AI_MODEL_CHOICES.google[1]?.id ?? '';
    await user.selectOptions(modelSelect('google'), pick);
    expect(modelSelect('google').value).toBe(pick);
    expect(chosenModel('google')).toBe(pick);
  });

  it('negative: a model the store will not keep is not shown as chosen', async () => {
    const user = renderKeys();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    await user.selectOptions(modelSelect('google'), AI_MODEL_CHOICES.google[1]?.id ?? '');
    expect(modelSelect('google').value).toBe(defaultModelFor('google'));
  });

  it('choosing from the service list remembers that model', async () => {
    const { user, select } = await openServiceList();
    await user.selectOptions(select, 'mistral-small');
    expect(readCustomModel()).toBe('mistral-small');
  });

  it('choosing an application calls onSelectApplication with its id', async () => {
    const onSelectApplication = vi.fn();
    const picker = renderPicker(onSelectApplication);
    await userEvent.setup().selectOptions(picker, 'app-2');
    expect(onSelectApplication).toHaveBeenCalledWith('app-2');
  });
});
