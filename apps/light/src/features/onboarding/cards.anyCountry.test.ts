/**
 * The welcome cards are read before a country is chosen, so they name none (L-423).
 *
 * A brand-new install is asked which country to search only once it reaches
 * Search (L-417). The three cards come first, and "Search UK jobs" told
 * someone in Toronto the app was not for them.
 */
import { describe, expect, it } from 'vitest';

import { ONBOARDING_CARDS } from './cards';

const search = ONBOARDING_CARDS.find((card) => card.id === 'search');

describe('the welcome cards work for any country (L-423)', () => {
  it('the search card says the owner-approved words', () => {
    expect(search?.hook).toBe('Search jobs in one place.');
    expect(search?.body).toBe('Search job boards. Save the good ones straight to your board.');
  });

  it('negative: no card says UK, Britain, British or London, in any of its words', () => {
    for (const card of ONBOARDING_CARDS) {
      const words = [card.title, card.hook, card.status, card.body, card.actionLabel].join(' ');
      expect(words, card.id).not.toMatch(/\bUK\b|\bU\.K\.|United Kingdom|Britain|British|London/i);
    }
  });

  it('boundary: the search card still promises nothing a new install cannot do', () => {
    // "and a free feed" stays out: the feed starts unticked for a UK place.
    expect(search?.body.toLowerCase()).not.toContain('free feed');
    expect(search?.body.toLowerCase()).toContain('your board');
  });
});
