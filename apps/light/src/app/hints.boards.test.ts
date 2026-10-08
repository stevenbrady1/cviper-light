/** L-219: the sentence beside a job-board button. */
import { describe, expect, it } from 'vitest';

import { boardHint } from './hints';

const ALL = { location: true, radius: true, salaryMin: true, contract: true };

describe('boardHint', () => {
  it('happy: a board that takes everything says so, with nothing to set on the site', () => {
    expect(boardHint('Reed', ALL)).toBe(
      'Opens Reed in your browser with your job title, location, distance, minimum salary and contract type.',
    );
  });

  it('names what the link cannot take, and that it is set on the site', () => {
    expect(boardHint('Indeed', { ...ALL, salaryMin: false, contract: false })).toBe(
      'Opens Indeed in your browser with your job title, location and distance. Its link cannot take your minimum salary and contract type, so set those on the site.',
    );
  });

  it('boundary: one thing missing reads as "that"', () => {
    expect(boardHint('X', { ...ALL, salaryMin: false })).toContain('so set that on the site');
  });

  it('boundary: only the job title', () => {
    expect(
      boardHint('Guardian Jobs', {
        location: false,
        radius: false,
        salaryMin: false,
        contract: false,
      }),
    ).toBe(
      'Opens Guardian Jobs in your browser with your job title. Its link cannot take your location, distance, minimum salary and contract type, so set those on the site.',
    );
  });

  it('a board with only a Contract filter says it has no Permanent one', () => {
    expect(boardHint('LinkedIn', ALL, { contract: { contract: 'C' } })).toContain(
      'It can filter for Contract roles, but has no Permanent filter.',
    );
  });
});
