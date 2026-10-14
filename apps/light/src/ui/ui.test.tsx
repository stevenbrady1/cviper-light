// @vitest-environment jsdom
/**
 * The shared building blocks every screen is drawn with: Card, IconTile,
 * StatusPill and PageHeader.
 *
 * Classes are asserted here — unusually for this app — because these four
 * components ARE the styling language. What a pill means is which of the five
 * colours it wears, and that is a fact about its class string. jsdom resolves
 * no stylesheet, so this is the only place that meaning can be pinned.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Card } from './Card';
import { Icon, ICON_NAMES } from './Icon';
import { IconTile } from './IconTile';
import { PageHeader } from './PageHeader';
import { PILL_TONES, StatusPill, type PillTone } from './StatusPill';

afterEach(() => {
  cleanup();
});

describe('StatusPill — the colour grammar, and only the colour grammar', () => {
  it('ready is teal: something is here and works now', () => {
    render(<StatusPill tone="ready">Ready now</StatusPill>);
    const pill = screen.getByText('Ready now');
    expect(pill.className).toContain('bg-teal/10');
    expect(pill.className).toContain('text-teal-ink');
    expect(pill.dataset['tone']).toBe('ready');
  });

  it('attention is gold: something needs the user', () => {
    render(<StatusPill tone="attention">Gone quiet</StatusPill>);
    const pill = screen.getByText('Gone quiet');
    expect(pill.className).toContain('bg-gold/10');
    expect(pill.className).toContain('text-gold-ink');
  });

  it('danger is red, and is the only tone that is', () => {
    render(<StatusPill tone="danger">Rejected</StatusPill>);
    expect(screen.getByText('Rejected').className).toContain('text-danger');

    for (const tone of PILL_TONES.filter((t) => t !== 'danger')) {
      cleanup();
      render(<StatusPill tone={tone}>x</StatusPill>);
      expect(screen.getByText('x').className, tone).not.toMatch(/danger/);
    }
  });

  it('neutral wears no brand colour at all', () => {
    render(<StatusPill tone="neutral">Saved</StatusPill>);
    const pill = screen.getByText('Saved');
    expect(pill.className).toContain('bg-sunken');
    expect(pill.className).not.toMatch(/teal|gold|blue|danger/);
  });

  it('offers exactly the four tones the grammar allows — no blue, no navy', () => {
    // Blue is action and navy is structure; neither is a status. A fifth tone
    // would be a colour taking a second meaning.
    expect([...PILL_TONES].sort()).toEqual(['attention', 'danger', 'neutral', 'ready']);
  });

  it('negative: an unknown tone (from untyped data) falls back to neutral, never to a colour', () => {
    render(<StatusPill tone={'celebrate' as PillTone}>Odd</StatusPill>);
    const pill = screen.getByText('Odd');
    expect(pill.dataset['tone']).toBe('neutral');
    expect(pill.className).toContain('bg-sunken');
  });

  it('boundary: renders an empty pill without throwing', () => {
    const { container } = render(<StatusPill tone="ready">{''}</StatusPill>);
    expect(container.querySelector('[data-tone="ready"]')).toBeTruthy();
  });
});

describe('IconTile', () => {
  it('is decorative: hidden from assistive tech, the words beside it carry the meaning', () => {
    const { container } = render(<IconTile icon="tracker" />);
    const tile = container.firstElementChild as HTMLElement;
    expect(tile.getAttribute('aria-hidden')).toBe('true');
    expect(tile.querySelector('svg')).toBeTruthy();
  });

  it('defaults to navy, structure', () => {
    const { container } = render(<IconTile icon="search" />);
    expect((container.firstElementChild as HTMLElement).className).toContain('bg-navy/10');
  });

  it('takes the action tone for the one featured thing', () => {
    const { container } = render(<IconTile icon="analysis" tone="blue" />);
    expect((container.firstElementChild as HTMLElement).className).toContain('bg-blue/10');
  });

  it('every icon name draws something', () => {
    for (const name of ICON_NAMES) {
      cleanup();
      const { container } = render(<Icon name={name} />);
      expect(container.querySelector('svg')?.childElementCount, name).toBeGreaterThan(0);
    }
  });

  it('every icon is hidden from assistive tech and never takes focus', () => {
    for (const name of ICON_NAMES) {
      cleanup();
      const { container } = render(<Icon name={name} />);
      const svg = container.querySelector('svg');
      expect(svg?.getAttribute('aria-hidden'), name).toBe('true');
      expect(svg?.getAttribute('focusable'), name).toBe('false');
    }
  });
});

describe('Card', () => {
  it('uses the card radius, the line border and the raised elevation', () => {
    render(<Card data-testid="c">Body</Card>);
    const card = screen.getByTestId('c');
    expect(card.className).toContain('rounded-card');
    expect(card.className).toContain('border-line');
    expect(card.className).toContain('shadow-raised');
  });

  it('featured swaps the line border for the action colour, and says so in data', () => {
    render(
      <Card featured data-testid="c">
        Body
      </Card>,
    );
    const card = screen.getByTestId('c');
    expect(card.className).toContain('border-blue');
    expect(card.className).not.toContain('border-line');
    expect(card.dataset['featured']).toBe('true');
  });

  it('renders as the element it is asked to be', () => {
    render(
      <Card as="article" data-testid="c">
        Body
      </Card>,
    );
    expect(screen.getByTestId('c').tagName).toBe('ARTICLE');
  });

  it('boundary: padding "none" leaves the padding to the caller', () => {
    render(
      <Card padding="none" data-testid="c">
        Body
      </Card>,
    );
    expect(screen.getByTestId('c').className).not.toMatch(/\bp-\d/);
  });
});

describe('PageHeader', () => {
  it('renders the title as the heading and the subtitle in muted ink', () => {
    render(<PageHeader title="Tracker" subtitle="Every application." />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Tracker');
    expect(screen.getByText('Every application.').className).toContain('text-ink-muted');
  });

  it('puts the actions in the header when given', () => {
    render(
      <PageHeader
        title="Settings"
        subtitle="Keys."
        actions={<button type="button">Export my data</button>}
      />,
    );
    expect(screen.getByRole('button', { name: 'Export my data' })).toBeTruthy();
  });

  it('negative: no actions renders no empty actions box', () => {
    const { container } = render(<PageHeader title="Profile" subtitle="Who you are." />);
    expect(container.querySelector('[data-slot="actions"]')).toBeNull();
  });

  it('shows an icon tile when given one', () => {
    const { container } = render(
      <PageHeader title="Search" subtitle="Find roles." icon="search" />,
    );
    expect(container.querySelector('svg')).toBeTruthy();
  });
});
