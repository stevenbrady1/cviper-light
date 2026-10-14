import { useEffect, useState, type ReactNode } from 'react';

import { CViperMark } from '../../app/CViperMark';
import { PRIMARY_BUTTON, QUIET_BUTTON, SECONDARY_BUTTON } from '../../app/buttons';
import { type ViewId } from '../../app/views';
import { Card, Icon, IconTile, PageHeader, StatusPill, type IconName } from '../../ui';
import { readAvailability } from '../analysis/availability';
import { type Availability } from '../analysis/providers';

import { ONBOARDING_CARDS, localModelLine, type OnboardingCard } from './cards';

/**
 * The first screen, and the only one that ever explains the whole product.
 *
 * ============================================================================
 * IT REPLACES THE APP RATHER THAN FLOATING OVER IT.
 * ============================================================================
 * Not a modal. A modal over the tracker would put two enabled blue buttons on
 * screen — the card's action and the board's "Add application" — and blue would
 * stop meaning "the thing this screen is for" (see `app/buttons.ts`). It would
 * also show a user their first board underneath a sheet explaining what a board
 * is.
 *
 * On first run there is nothing behind this worth seeing, so it takes the
 * window. Reopened from Settings it does the same and returns to Settings, and
 * the rule about one primary action holds without a special case.
 *
 * ============================================================================
 * THREE CARDS OF EQUAL WEIGHT, ONE OF THEM MARKED "START HERE".
 * ============================================================================
 * Every card is built in the same order — icon tile, title and hook, status
 * pill, a small example, one sentence, a button pinned to the bottom — so the
 * eye compares like with like. The CV card carries the screen's one blue
 * button and the action-coloured border: it is the quickest way to get
 * something useful back. The other two buttons are secondary.
 *
 * ============================================================================
 * THE EXAMPLES ARE EXAMPLES.
 * ============================================================================
 * "Acme Ltd · 2 days" and "72%" are illustrations, not the user's data. Each
 * preview is `aria-hidden` (a screen reader skips it; the sentence under it
 * says the same thing in words) and carries a visible "Example" caption, so
 * nobody sighted takes a made-up score for a real one.
 *
 * ============================================================================
 * THE FIRST CARD IS NEVER WAITING ON ANYTHING.
 * ============================================================================
 * No button here waits on the Ollama probe. The detection is a fact about THIS
 * machine, so it is read live rather than described: the CV card's pill says
 * "local AI found" only when a model that can actually chat is there, and the
 * line under the body (`localModelLine`) gives the honest fallback otherwise.
 */

export interface WelcomeProps {
  /**
   * Close it. A `ViewId` means the user chose that card and wants to go there;
   * `null` means they chose to look around themselves.
   */
  readonly onDismiss: (view: ViewId | null) => void;
  /**
   * Injected by tests. Defaults to the same probe the analysis view uses — one
   * detection in the app, not two that can disagree on screen.
   */
  readonly detect?: (() => Promise<Availability>) | undefined;
}

const CARD_ICON: Record<OnboardingCard['id'], IconName> = {
  tracker: 'tracker',
  analysis: 'analysis',
  search: 'search',
};

const TRUST: ReadonlyArray<{ readonly icon: IconName; readonly label: string }> = [
  { icon: 'computer', label: 'Stays on your PC' },
  { icon: 'noAccount', label: 'No account' },
  { icon: 'free', label: 'Free to start' },
];

/** True only when a model that can hold a conversation was found. */
function localAiFound(availability: Availability | null): boolean {
  return availability !== null && availability.ollamaModels.length > 0;
}

export function Welcome({ onDismiss, detect }: WelcomeProps) {
  const [availability, setAvailability] = useState<Availability | null>(null);

  useEffect(() => {
    let cancelled = false;
    const probe = detect ?? readAvailability;

    probe()
      .then((next) => {
        if (!cancelled) setAvailability(next);
      })
      .catch(() => {
        // Never swallowed into a blank line. A probe that failed and a machine
        // with nothing installed lead to the same honest sentence, and the
        // other two cards are unaffected either way.
        if (!cancelled) {
          setAvailability({
            ollamaRunning: false,
            ollamaModels: [],
            anthropicKey: false,
            openaiKey: false,
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [detect]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      onDismiss(null);
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onDismiss]);

  return (
    <section
      aria-label="Welcome to CViper Light"
      data-testid="welcome"
      className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-canvas px-4 py-6 md:px-8 md:py-10"
    >
      <div className="mx-auto w-full max-w-5xl">
        <PageHeader
          variant="hero"
          eyebrow={
            <div data-testid="welcome-brand" className="flex items-center gap-2">
              <span className="inline-flex size-8 items-center justify-center rounded-control bg-navy/10">
                <CViperMark size={22} />
              </span>
              <span className="font-semibold text-ink">CViper Light</span>
            </div>
          }
          title="Your job hunt, organised."
          subtitle="Pick where to start. You can try all three today."
        />

        {/*
          The trust row replaces the old privacy paragraph. "Stays on your PC"
          is scoped to the user's data for a screen reader — the absolute claim
          ("everything stays") is what `privacy-promise.contract.test.ts`
          forbids, and the launch update check below is the reason.
        */}
        <ul
          data-testid="welcome-trust"
          className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-ink-muted"
        >
          {TRUST.map((item) => (
            <li key={item.label} className="flex items-center gap-1.5">
              <span className="text-teal-ink">
                <Icon name={item.icon} size={16} />
              </span>
              {item.label}
            </li>
          ))}
        </ul>
      </div>

      <div className="mx-auto mt-8 grid w-full max-w-5xl items-stretch gap-4 lg:grid-cols-3">
        {ONBOARDING_CARDS.map((card) => (
          <WelcomeCard
            key={card.id}
            card={card}
            availability={availability}
            onDismiss={onDismiss}
          />
        ))}
      </div>

      <footer className="mx-auto mt-8 flex w-full max-w-5xl flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <button
          type="button"
          data-testid="welcome-skip"
          onClick={() => onDismiss(null)}
          className={`${QUIET_BUTTON} self-start`}
        >
          I&apos;ll look around myself →
          <span className="sr-only"> (closes this introduction; Escape also works)</span>
        </button>

        {/*
          The one request this reader has not been told about (L-108).

          `App.tsx` runs the update check in a mount effect and `launchCheck.ts`
          resolves an unconfigured machine to ON, so on a first run the app asks
          github.com for a version number while this screen is still the only
          thing anybody has read. A promise that is only kept somewhere the
          reader has not been is not kept.

          Shortened for the welcome refresh, but every fact
          `launchCheckDisclosure.contract.test.tsx` requires is still in it:
          who is asked (GitHub), when (start-up), what for (a version number),
          what it carries (nothing about you) and where it is switched off
          (Settings). That contract was not touched to make this fit.
        */}
        <p data-testid="welcome-update-check" className="text-xs text-ink-faint md:text-right">
          Checks GitHub for a newer version number at start-up, sending nothing about you. Turn off
          in Settings.
        </p>
      </footer>
    </section>
  );
}

interface WelcomeCardProps {
  readonly card: OnboardingCard;
  readonly availability: Availability | null;
  readonly onDismiss: (view: ViewId | null) => void;
}

function WelcomeCard({ card, availability, onDismiss }: WelcomeCardProps) {
  const featured = card.id === 'analysis';
  const status =
    card.id === 'analysis' && localAiFound(availability)
      ? `${card.status} · local AI found`
      : card.status;

  return (
    <Card
      as="article"
      featured={featured}
      interactive
      padding="roomy"
      data-testid={`welcome-card-${card.id}`}
      className="relative flex h-full flex-col"
    >
      {featured ? (
        <span
          data-testid="welcome-start-here"
          className="absolute -top-3 left-5 rounded-pill bg-blue px-2.5 py-0.5 text-xs font-semibold text-ink-inverse"
        >
          Start here
        </span>
      ) : null}

      <IconTile icon={CARD_ICON[card.id]} tone={featured ? 'blue' : 'navy'} />

      <h2 className="mt-4 text-base font-semibold text-ink">{card.title}</h2>
      <p className="text-ink-muted">{card.hook}</p>

      <div className="mt-3">
        <StatusPill tone="ready" data-testid={`welcome-status-${card.id}`}>
          {status}
        </StatusPill>
      </div>

      <Preview id={card.id} />

      <p className="mt-4 text-ink">{card.body}</p>

      {card.id === 'analysis' ? (
        <p data-testid="welcome-local-model" className="mt-2 text-xs text-ink-muted">
          {availability === null
            ? 'Looking for a local model on this machine…'
            : localModelLine(availability)}
        </p>
      ) : null}

      {/* `mt-auto` pins the button to the bottom so all three line up. */}
      <div className="mt-auto pt-5">
        <button
          type="button"
          data-testid={`welcome-action-${card.id}`}
          {...(featured ? { 'data-primary': 'true' } : {})}
          onClick={() => onDismiss(card.view)}
          className={`w-full ${featured ? PRIMARY_BUTTON : SECONDARY_BUTTON}`}
        >
          {card.actionLabel}
        </button>

        {/*
          The way to a sharper answer, deliberately small and BELOW the button:
          the keyword match works with nothing, and a reader who already has
          Ollama never needs this. It routes into the app — never out to a
          browser, never to one provider's signup page (C1) — to Settings → AI
          provider keys, where the provider is chosen and, since the refresh,
          where the cost of a typical check is stated (`AiKeySetup`).
          A link, not a button: the screen's one blue button is above it.
        */}
        {featured ? (
          <button
            type="button"
            data-testid="welcome-key-link"
            onClick={() => onDismiss('settings')}
            className="mt-2 w-full text-center text-xs font-medium text-blue hover:text-navy hover:underline"
          >
            Want sharper AI? Add a key →
          </button>
        ) : null}
      </div>
    </Card>
  );
}

/** The small illustration on each card. Decorative, captioned, never real data. */
function Preview({ id }: { readonly id: OnboardingCard['id'] }) {
  let body: ReactNode;

  if (id === 'tracker') {
    body = (
      <ul className="space-y-1.5">
        <PreviewRow edge="border-l-teal" text="Acme Ltd" meta="2 days" />
        <PreviewRow edge="border-l-gold" text="Northwind" meta="12 days" />
      </ul>
    );
  } else if (id === 'analysis') {
    body = (
      <div className="flex items-baseline gap-2 px-1">
        <span
          data-testid="welcome-preview-score"
          className="font-display text-3xl leading-none font-normal text-ink lining-nums tabular-nums"
        >
          72%
        </span>
        <span className="text-xs text-ink-muted">match · 4 key words missing</span>
      </div>
    );
  } else {
    body = (
      <ul className="space-y-1.5">
        <PreviewRow edge="border-l-line" text="Data analyst" meta="Leeds" />
        <PreviewRow edge="border-l-line" text="BI developer" meta="Remote" />
      </ul>
    );
  }

  return (
    <div
      data-testid={`welcome-preview-${id}`}
      aria-hidden="true"
      className="mt-4 rounded-control bg-sunken p-2.5"
    >
      {body}
      <p className="mt-2 text-right text-[11px] text-ink-faint">Example</p>
    </div>
  );
}

function PreviewRow({
  edge,
  text,
  meta,
}: {
  readonly edge: string;
  readonly text: string;
  readonly meta: string;
}) {
  return (
    <li
      className={`flex items-center justify-between rounded-control border-l-2 bg-card px-2.5 py-1.5 text-xs ${edge}`}
    >
      <span className="font-medium text-ink">{text}</span>
      <span className="text-ink-muted tabular-nums">{meta}</span>
    </li>
  );
}
