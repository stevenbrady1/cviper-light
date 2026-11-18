// @vitest-environment jsdom
/**
 * The grey examples on Profile fit someone in any country (L-423).
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ok } from '@cviper/core-types';

import { Profile } from './Profile';
import { type GapsPort } from './gapsPort';
import { createFakeProfilePort } from './test/fakePort';

const GAPS: GapsPort = { load: async () => ok({ cvText: null, jobs: [] }) };

afterEach(cleanup);

async function renderProfile(): Promise<void> {
  render(
    <Profile
      port={createFakeProfilePort(null)}
      now={new Date('2026-11-17T09:00:00.000Z')}
      gapsPort={GAPS}
    />,
  );
  await screen.findByTestId('profile-headline');
}

const example = (box: string): string => screen.getByTestId(box).getAttribute('placeholder') ?? '';

describe('the Profile examples work for any country (L-423)', () => {
  it('the three examples say the owner-approved words', async () => {
    await renderProfile();
    expect(example('profile-work-rights')).toBe('e.g. Citizen, no sponsorship needed');
    expect(example('profile-writing-style')).toBe('e.g. Plain, short sentences. No buzzwords.');
    expect(example('profile-deal-breakers')).toBe('e.g. Fully on-site\nBelow 70k');
  });

  it('negative: no example on the screen names the UK, British spelling, pounds or GBP', async () => {
    await renderProfile();
    const examples = [...document.querySelectorAll('[placeholder]')].map(
      (box) => box.getAttribute('placeholder') ?? '',
    );
    // The screen really has examples to judge.
    expect(examples.filter((text) => text.trim() !== '').length).toBeGreaterThanOrEqual(5);
    for (const text of examples) {
      expect(text).not.toMatch(/\bUK\b|Britain|British|London|pounds?\b|£|\bGBP\b/i);
    }
  });
});
