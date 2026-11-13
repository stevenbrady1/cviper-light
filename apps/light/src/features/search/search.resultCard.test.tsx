// @vitest-environment jsdom
/**
 * L-392 — one clear action on each result card, the rest in a small "…" menu.
 *
 * A page of 20 results used to show 40 look-alike bordered buttons: "Save to
 * tracker" and "Analyse this job" on every card. Now "Save to tracker" is the
 * card's one bordered button, and "Analyse this job" and "Open original →" sit
 * in the menu, their words unchanged ("Analyse this job" is quoted by the
 * published privacy page).
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type SearchResultJob } from '@cviper/job-apis';

import { SECONDARY_BUTTON } from '../../app/buttons';

import { ResultCard } from './ResultCard';
import { REED_DAY_RATE, entry } from './test/fixtures';

const TODAY = '2026-09-29';
const ID = 'job-day-rate';

afterEach(cleanup);

interface CardOptions {
  readonly advert?: SearchResultJob;
  readonly tracked?: boolean;
  readonly onAnalyse?: (() => void) | undefined;
  readonly onOpen?: () => void;
}

function card({
  advert = REED_DAY_RATE,
  tracked = false,
  onOpen = vi.fn(),
  ...rest
}: CardOptions = {}) {
  const onAnalyse = 'onAnalyse' in rest ? rest.onAnalyse : vi.fn();
  return (
    <ResultCard
      key={advert.job.id}
      entry={advert}
      today={TODAY}
      clusterSize={null}
      tracked={tracked}
      busy={false}
      note={null}
      problem={null}
      rank={null}
      dealBreakers={[]}
      onSave={vi.fn()}
      onOpen={onOpen}
      {...(onAnalyse === undefined ? {} : { onAnalyse })}
    />
  );
}

function borderedButtons(root: HTMLElement): HTMLButtonElement[] {
  return [...root.querySelectorAll('button')].filter(
    (button) => button.className === SECONDARY_BUTTON,
  );
}

describe('a result card', () => {
  it('has exactly one bordered button, and it is Save', () => {
    render(card());
    const bordered = borderedButtons(screen.getByTestId(`result-${ID}`));

    expect(bordered).toHaveLength(1);
    expect(bordered[0]?.dataset.testid).toBe(`result-save-${ID}`);
    expect(bordered[0]?.textContent).toBe('Save to tracker');
  });

  it('holds "Analyse this job" and "Open original →" in its menu, words unchanged, and each runs', async () => {
    const user = userEvent.setup();
    const onAnalyse = vi.fn();
    const onOpen = vi.fn();
    render(card({ onAnalyse, onOpen }));
    expect(screen.queryByTestId(`result-analyse-${ID}`)).toBeNull();

    await user.click(screen.getByTestId(`result-more-${ID}`));
    expect(screen.getByTestId(`result-analyse-${ID}`).textContent).toBe('Analyse this job');
    expect(screen.getByTestId(`result-open-${ID}`).textContent).toBe('Open original →');
    await user.click(screen.getByTestId(`result-analyse-${ID}`));
    expect(onAnalyse).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTestId(`result-more-${ID}`));
    await user.click(screen.getByTestId(`result-open-${ID}`));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('names "…" for a screen reader as "More actions: <title>"', () => {
    render(card());
    const more = screen.getByTestId(`result-more-${ID}`);

    expect(more.getAttribute('aria-label')).toBe('More actions: Credit Risk Contractor');
    expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByRole('button', { name: 'More actions: Credit Risk Contractor' })).toBe(more);
  });

  it('negative: with no Analyse handler the menu holds only Open original', async () => {
    const user = userEvent.setup();
    render(card({ onAnalyse: undefined }));

    await user.click(screen.getByTestId(`result-more-${ID}`));

    expect(screen.queryByTestId(`result-analyse-${ID}`)).toBeNull();
    expect(screen.getByTestId(`result-open-${ID}`)).toBeTruthy();
  });

  it('boundary: an advert with no link has Open original in the menu, disabled', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(card({ advert: entry({ id: ID, url: null }), onOpen }));

    await user.click(screen.getByTestId(`result-more-${ID}`));
    const open = screen.getByTestId<HTMLButtonElement>(`result-open-${ID}`);

    expect(open.disabled).toBe(true);
    await user.click(open);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('a tracked advert: "In your tracker" disabled, and Analyse still enabled in the menu', async () => {
    const user = userEvent.setup();
    render(card({ tracked: true }));
    const save = screen.getByTestId<HTMLButtonElement>(`result-save-${ID}`);

    expect(save.disabled).toBe(true);
    expect(save.textContent).toBe('In your tracker');
    await user.click(screen.getByTestId(`result-more-${ID}`));
    expect(screen.getByTestId<HTMLButtonElement>(`result-analyse-${ID}`).disabled).toBe(false);
  });

  it('20 results draw 20 bordered buttons, not 40', () => {
    const adverts = Array.from({ length: 20 }, (_, index) =>
      entry({ id: `job-${String(index)}`, external_id: `reed-${String(index)}` }),
    );
    const { container } = render(<>{adverts.map((advert) => card({ advert }))}</>);

    expect(borderedButtons(container)).toHaveLength(20);
    for (const advert of adverts) {
      const one = within(screen.getByTestId(`result-${advert.job.id}`));
      expect(one.getByTestId(`result-more-${advert.job.id}`)).toBeTruthy();
    }
  });
});
