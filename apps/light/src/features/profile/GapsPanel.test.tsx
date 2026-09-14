// @vitest-environment jsdom
/**
 * The skills-gap panel, driven through a fake port: every state it can be in,
 * and what each one puts on screen. The counting itself is pinned in
 * `gaps.test.ts`; here the assertions are about rows, widths and the words.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { err, ok, type Job, type Result } from '@cviper/core-types';

import { type DbError } from '../../db';

import { GapsPanel } from './GapsPanel';
import { type GapsPort, type GapsSource } from './gapsPort';

const NOW = '2026-09-14T09:00:00.000Z';

function job(id: string, description: string | null): Job {
  return {
    id,
    source: 'manual',
    external_id: null,
    title: `Job ${id}`,
    company: 'Acme',
    location: null,
    salary_min: null,
    salary_max: null,
    salary_currency: null,
    salary_period: null,
    description,
    url: null,
    posted_date: null,
    created_at: NOW,
  };
}

/** A port that answers once with whatever it was given. */
function portWith(result: Result<GapsSource, DbError>): GapsPort {
  return { load: async () => result };
}

const FAILURE: DbError = {
  code: 'QUERY_FAILED',
  message: 'The database is locked by another copy of CViper.',
  table: 'jobs',
};

afterEach(cleanup);

async function renderPanel(port: GapsPort) {
  render(<GapsPanel port={port} />);
  return screen.findByTestId('profile-gaps');
}

describe('rows', () => {
  it('lists the gaps with a count and a bar sized by share, most wanted first', async () => {
    await renderPanel(
      portWith(
        ok({
          cvText: 'Python every day',
          jobs: [
            job('a', 'Python, Kubernetes and SQL please'),
            job('b', 'Kubernetes please'),
            job('c', 'Kubernetes and SQL please'),
          ],
        }),
      ),
    );

    await screen.findAllByTestId('profile-gap-row');

    expect(screen.getByText('Across your applications')).toBeTruthy();
    expect(screen.getByTestId('profile-gaps-summary').textContent).toBe(
      '2 skills these 3 adverts ask for that your CV does not mention.',
    );

    const rows = screen.getAllByTestId('profile-gap-row');
    expect(rows).toHaveLength(2);

    expect(within(rows[0]!).getByTestId('profile-gap-skill').textContent).toBe('kubernetes');
    expect(within(rows[0]!).getByTestId('profile-gap-count').textContent).toBe('3 of 3 adverts');
    expect(within(rows[0]!).getByTestId('profile-gap-bar').style.width).toBe('100%');

    // Cased for display the way the Analysis chips are: `sql` is SQL.
    expect(within(rows[1]!).getByTestId('profile-gap-skill').textContent).toBe('SQL');
    expect(within(rows[1]!).getByTestId('profile-gap-count').textContent).toBe('2 of 3 adverts');
    expect(within(rows[1]!).getByTestId('profile-gap-bar').style.width).toBe('67%');
  });

  it('boundary: one advert is "1 of 1 advert", not "adverts"', async () => {
    await renderPanel(
      portWith(ok({ cvText: 'Nothing relevant', jobs: [job('a', 'React please')] })),
    );

    const row = await screen.findByTestId('profile-gap-row');
    expect(within(row).getByTestId('profile-gap-count').textContent).toBe('1 of 1 advert');
    expect(screen.getByTestId('profile-gaps-summary').textContent).toBe(
      '1 skill this advert asks for that your CV does not mention.',
    );
  });

  it('boundary: a CV that covers everything shows the summary and no rows', async () => {
    await renderPanel(
      portWith(ok({ cvText: 'React and Python', jobs: [job('a', 'React please')] })),
    );

    expect((await screen.findByTestId('profile-gaps-summary')).textContent).toBe(
      'Your CV mentions every skill this advert names.',
    );
    expect(screen.queryAllByTestId('profile-gap-row')).toHaveLength(0);
  });
});

describe('empty states', () => {
  it('nothing on the tracker: says what to do, and shows no rows', async () => {
    await renderPanel(portWith(ok({ cvText: 'Python', jobs: [] })));

    expect((await screen.findByTestId('profile-gaps-empty')).textContent).toBe(
      'Save a few adverts to the tracker and this fills in.',
    );
    expect(screen.queryAllByTestId('profile-gap-row')).toHaveLength(0);
    expect(screen.queryByTestId('profile-gaps-summary')).toBeNull();
  });

  it('no CV: says where to add one, and shows no rows even though every skill is a gap', async () => {
    await renderPanel(portWith(ok({ cvText: null, jobs: [job('a', 'Kubernetes please')] })));

    expect((await screen.findByTestId('profile-gaps-empty')).textContent).toBe(
      'Upload a CV on the Analysis screen to see what these adverts ask for that it does not mention.',
    );
    expect(screen.queryAllByTestId('profile-gap-row')).toHaveLength(0);
  });

  it('boundary: no CV and nothing on the tracker asks for the adverts first', async () => {
    await renderPanel(portWith(ok({ cvText: null, jobs: [] })));

    expect((await screen.findByTestId('profile-gaps-empty')).textContent).toContain(
      'Save a few adverts',
    );
  });

  it('boundary: adverts saved without a description say so rather than showing nothing', async () => {
    await renderPanel(portWith(ok({ cvText: 'Python', jobs: [job('a', null), job('b', '  ')] })));

    expect((await screen.findByTestId('profile-gaps-summary')).textContent).toBe(
      'None of the adverts on your tracker has a description.',
    );
    expect(screen.queryAllByTestId('profile-gap-row')).toHaveLength(0);
  });
});

describe('loading and failure', () => {
  it('says it is reading until the port answers', async () => {
    const never: GapsPort = { load: () => new Promise(() => undefined) };
    await renderPanel(never);

    expect(screen.getByTestId('profile-gaps-loading')).toBeTruthy();
    expect(screen.queryByTestId('profile-gaps-summary')).toBeNull();
  });

  it('negative: says so when the data cannot be read, and shows no rows', async () => {
    await renderPanel(portWith(err(FAILURE)));

    const alert = await screen.findByRole('alert');
    expect(alert.getAttribute('data-testid')).toBe('profile-gaps-error');
    expect(alert.textContent).toContain('The database is locked');
    expect(screen.queryByTestId('profile-gaps-loading')).toBeNull();
    expect(screen.queryAllByTestId('profile-gap-row')).toHaveLength(0);
  });
});
