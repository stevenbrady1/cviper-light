// @vitest-environment jsdom
/**
 * Delete everything, driven the way a user drives it: two presses, counts in
 * between, and an honest report either way.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type Application, type Cv, type Job } from '@cviper/core-types';

import { createFakeBackupPort } from '../test/fakePort';
import { DATA_LOCATIONS } from '../privacy/dataLocations';

import { EraseEverything } from './EraseEverything';
import { createFakeErasePort } from './test/fakeErasePort';

const JOB: Job = {
  id: 'job-1',
  source: 'manual',
  external_id: null,
  title: 'Credit Risk Analyst',
  company: 'Lloyds',
  location: 'London',
  salary_min: null,
  salary_max: null,
  salary_currency: null,
  salary_period: null,
  description: '',
  url: null,
  posted_date: null,
  created_at: '2026-08-01T09:00:00.000Z',
};

const APPLICATION: Application = {
  id: 'app-1',
  job_id: 'job-1',
  status: 'applied',
  applied_date: '2026-08-02',
  notes: '',
  next_action: null,
  next_action_date: null,
  updated_at: '2026-08-02T09:00:00.000Z',
};

const CV: Cv = {
  id: 'cv-1',
  name: 'CV.pdf',
  file_path: 'C:\\CV.pdf',
  extracted_text: 'Credit risk analyst.',
  json_resume: null,
  created_at: '2026-08-01T09:00:00.000Z',
};

const FULL = { jobs: [JOB], applications: [APPLICATION], cvs: [CV], analyses: [] };

afterEach(() => {
  cleanup();
});

function renderErase(options: { withData?: boolean; failBackupRead?: boolean } = {}) {
  const backupPort = createFakeBackupPort(options.withData ? FULL : undefined);
  if (options.failBackupRead) backupPort.failNext('read');
  const port = createFakeErasePort();
  const onErased = vi.fn();
  const user = userEvent.setup();
  render(<EraseEverything port={port} backupPort={backupPort} onErased={onErased} />);
  return { port, backupPort, onErased, user };
}

describe('at rest', () => {
  it('renders the button, says there is no undo, and is not the primary action', () => {
    renderErase();

    const button = screen.getByTestId<HTMLButtonElement>('settings-erase');
    expect(button.disabled).toBe(false);
    expect(button.getAttribute('data-primary')).toBeNull();
    expect(screen.getByTestId('settings-erase-section').textContent).toContain('no undo');
    expect(screen.queryByTestId('settings-erase-confirm-panel')).toBeNull();
  });
});

describe('the confirmation', () => {
  it('counts what is about to go before asking, and lists every place', async () => {
    const { user, port } = renderErase({ withData: true });

    await user.click(screen.getByTestId('settings-erase'));

    const counts = await screen.findByTestId('settings-erase-counts');
    expect(counts.textContent).toContain('1 job, 1 application and 1 CV');

    const panel = screen.getByTestId('settings-erase-confirm-panel');
    for (const location of DATA_LOCATIONS) {
      expect(panel.textContent, location.what).toContain(location.what);
    }
    // Nothing has been deleted by merely asking.
    expect(port.calls).toEqual([]);
    // The opener is disabled while the confirmation is up — never removed.
    expect(screen.getByTestId<HTMLButtonElement>('settings-erase').disabled).toBe(true);
  });

  it('still offers to delete when the database cannot be counted, and says so', async () => {
    const { user } = renderErase({ failBackupRead: true });

    await user.click(screen.getByTestId('settings-erase'));

    const counts = await screen.findByTestId('settings-erase-counts');
    expect(counts.textContent).toContain('could not be read to count');
    expect(screen.getByTestId<HTMLButtonElement>('settings-erase-confirm').disabled).toBe(false);
  });

  it('keeps everything when the user changes their mind', async () => {
    const { user, port, onErased } = renderErase({ withData: true });

    await user.click(screen.getByTestId('settings-erase'));
    await user.click(await screen.findByTestId('settings-erase-cancel'));

    expect(screen.queryByTestId('settings-erase-confirm-panel')).toBeNull();
    expect(port.calls).toEqual([]);
    expect(onErased).not.toHaveBeenCalled();
    expect(screen.getByTestId<HTMLButtonElement>('settings-erase').disabled).toBe(false);
  });
});

describe('deleting', () => {
  it('runs every step, reports success, and tells the shell', async () => {
    const { user, port, onErased } = renderErase({ withData: true });

    await user.click(screen.getByTestId('settings-erase'));
    await user.click(await screen.findByTestId('settings-erase-confirm'));

    const message = await screen.findByTestId('settings-erase-message');
    expect(message.textContent).toContain('Everything has been deleted');
    expect(port.calls).toEqual(['database', 'keys', 'preferences']);
    expect(onErased).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('settings-erase-problem')).toBeNull();
  });

  it('names the step that refused, keeps the screen, and does not tell the shell', async () => {
    const { user, port, onErased } = renderErase({ withData: true });
    port.failNext('keys');

    await user.click(screen.getByTestId('settings-erase'));
    await user.click(await screen.findByTestId('settings-erase-confirm'));

    const problem = await screen.findByTestId('settings-erase-problem');
    expect(problem.textContent).toContain('your API keys could not be removed');
    expect(problem.textContent).toContain('credential store is locked');
    // The other two steps still ran.
    expect(port.calls).toEqual(['database', 'keys', 'preferences']);
    expect(onErased).not.toHaveBeenCalled();
    expect(screen.queryByTestId('settings-erase-message')).toBeNull();
    // And the user can try again.
    expect(screen.getByTestId<HTMLButtonElement>('settings-erase').disabled).toBe(false);
  });
});
