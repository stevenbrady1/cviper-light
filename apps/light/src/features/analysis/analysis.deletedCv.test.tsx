// @vitest-environment jsdom
/**
 * A CV picked on Analysis, then deleted on Profile (L-408).
 *
 * Analysis remembers its picked CV for as long as the app runs (L-187), in a
 * session that outlives the screen. Until a CV could be deleted, a remembered
 * id was always still in the list. Now it may not be, and a screen that kept
 * it would open with no CV chosen and "Check" switched off while a perfectly
 * good CV sat in the list.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type Cv } from '@cviper/core-types';

import { type RunResult } from './session';

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
const { createFakeProgressPort } = await import('../flow/test/fakeProgressPort');

const NEWEST: Cv = {
  id: 'cv-2',
  name: 'Banking CV.docx',
  file_path: null,
  extracted_text: 'Credit risk analyst. SQL, Python, IFRS 9.',
  json_resume: null,
  created_at: '2026-09-01T09:00:00.000Z',
};
const OLDER: Cv = {
  ...NEWEST,
  id: 'cv-1',
  name: 'CV.docx',
  created_at: '2026-08-01T09:00:00.000Z',
};

/** A finished check, as the result card holds it. */
const RESULT: RunResult = {
  analysis: {
    match_score: 61,
    verdict: 'possible',
    summary: 'Reasonable overlap.',
    matched_skills: ['IFRS 9'],
    missing_skills: ['Python'],
    keyword_gaps: [],
    matched_keywords: ['credit risk'],
    suggestions: [],
    ats_notes: [],
  },
  provider: 'keyword',
  model: 'keyword-v3',
  retried: false,
};

beforeEach(() => {
  tauri.invoke.mockReset();
  tauri.invoke.mockImplementation(async (command) => {
    if (command === 'ollama_probe') return null;
    if (command === 'secret_status') return false;
    throw new Error(`unexpected command: ${command}`);
  });
});

afterEach(() => cleanup());

/** Analysis opened again, remembering `picked`, with only `cvs` left in the store. */
async function reopen(picked: string | null, cvs: readonly Cv[]) {
  const session = createAnalysisSession();
  session.update({ selectedCvId: picked });
  render(
    <Analysis
      port={createFakeAnalysisPort({ cvs })}
      filePort={createFakeFilePort()}
      consentPort={createFakeConsentPort()}
      profilePort={createFakeProfilePort()}
      now={new Date('2026-10-07T09:00:00.000Z')}
      session={session}
      progressPort={createFakeProgressPort({})}
    />,
  );
  const picker = screen.getByTestId<HTMLSelectElement>('analysis-cv');
  return { session, picker };
}

describe('a remembered CV that has been deleted (L-408)', () => {
  it('is not offered, and Analysis starts on the newest CV that is left', async () => {
    const { session, picker } = await reopen('cv-deleted', [NEWEST, OLDER]);

    await vi.waitFor(() => expect(picker.value).toBe('cv-2'));
    expect([...picker.options].map((option) => option.value)).not.toContain('cv-deleted');
    expect(session.get().selectedCvId).toBe('cv-2');
  });

  it('drops the result that was on screen: it was the deleted CV’s, not the new one’s', async () => {
    const session = createAnalysisSession();
    session.update({ selectedCvId: 'cv-deleted', result: RESULT, runError: 'An old problem.' });
    render(
      <Analysis
        port={createFakeAnalysisPort({ cvs: [NEWEST] })}
        filePort={createFakeFilePort()}
        consentPort={createFakeConsentPort()}
        profilePort={createFakeProfilePort()}
        now={new Date('2026-10-07T09:00:00.000Z')}
        session={session}
        progressPort={createFakeProgressPort({})}
      />,
    );

    await vi.waitFor(() => expect(session.get().selectedCvId).toBe('cv-2'));
    expect(session.get().result).toBeNull();
    expect(session.get().runError).toBeNull();
  });

  it('negative: a remembered CV that is still there is kept, even though it is not the newest', async () => {
    const { session, picker } = await reopen('cv-1', [NEWEST, OLDER]);

    await vi.waitFor(() => expect(picker.disabled).toBe(false));
    expect(picker.value).toBe('cv-1');
    expect(session.get().selectedCvId).toBe('cv-1');
  });

  it('boundary: when the deleted CV was the last one, nothing is selected', async () => {
    const { session } = await reopen('cv-deleted', []);

    await vi.waitFor(() => expect(screen.getByTestId('analysis-upload')).toBeTruthy());
    await vi.waitFor(() => expect(session.get().selectedCvId).toBeNull());
  });
});
