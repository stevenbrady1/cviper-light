import { useEffect, useState } from 'react';

import { PRIMARY_BUTTON, QUIET_BUTTON, SECONDARY_BUTTON } from '../../app/buttons';
import { type ViewId } from '../../app/views';
import { readAvailability } from '../analysis/availability';
import { type Availability } from '../analysis/providers';

import { ONBOARDING_CARDS, localModelLine } from './cards';

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
 * THE FIRST CARD IS NEVER WAITING ON ANYTHING.
 * ============================================================================
 * Card one needs no key, no model and no network, and its button is enabled
 * from the first paint — before the Ollama probe has answered, and whatever it
 * answers. A zero-setup product whose welcome screen makes you wait has already
 * broken its promise on the first screen.
 *
 * The detection line on card two is the opposite case: it is a fact about THIS
 * machine, so it is read live rather than described. "Install Ollama for a
 * better analysis" is a leaflet; "llama3.2:3b found on this machine" is an
 * answer.
 */

export interface WelcomeProps {
  /**
   * Close it. A `ViewId` means the user chose that card and wants to go there;
   * `null` means they skipped.
   */
  readonly onDismiss: (view: ViewId | null) => void;
  /**
   * Injected by tests. Defaults to the same probe the analysis view uses — one
   * detection in the app, not two that can disagree on screen.
   */
  readonly detect?: (() => Promise<Availability>) | undefined;
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
      className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-canvas px-4 py-6 md:px-8 md:py-8"
    >
      <header className="mx-auto w-full max-w-5xl">
        <p className="font-mono text-xs font-medium tracking-[0.14em] text-ink-faint uppercase">
          CViper Light
        </p>
        <h1 className="mt-1 text-2xl font-bold text-ink">Three things this does.</h1>
        <p className="mt-1 max-w-2xl text-ink-muted">
          Your data stays on this computer. There is no account and nothing to sign up for. Two of
          these work better with a free key, and the page says which — you can start without one.
        </p>
      </header>

      <div className="mx-auto mt-6 grid w-full max-w-5xl gap-4 lg:grid-cols-3">
        {ONBOARDING_CARDS.map((card, index) => (
          <article
            key={card.id}
            data-testid={`welcome-card-${card.id}`}
            className="flex flex-col rounded-card border border-line bg-card p-5 shadow-raised"
          >
            <h2 className="font-semibold text-ink">{card.title}</h2>

            {/*
              The cost, up front, in its own element. Teal on the card that
              needs nothing and gold on the two that want something — the app's
              colour grammar, applied to the one fact a new user most needs.
            */}
            <p
              data-testid={`welcome-requirement-${card.id}`}
              className={
                card.id === 'tracker'
                  ? 'mt-1 rounded-pill bg-teal/10 px-2 py-0.5 text-xs font-medium text-teal'
                  : 'mt-1 rounded-pill bg-gold/10 px-2 py-0.5 text-xs font-medium text-gold'
              }
            >
              {card.requirement}
            </p>

            <p className="mt-2 flex-1 text-ink-muted">{card.body}</p>

            {card.id === 'analysis' ? (
              <p
                data-testid="welcome-local-model"
                className="mt-2 rounded-control bg-sunken px-3 py-2 text-xs text-ink-muted"
              >
                {availability === null
                  ? 'Looking for a local model on this machine…'
                  : localModelLine(availability)}
              </p>
            ) : null}

            <button
              type="button"
              data-testid={`welcome-action-${card.id}`}
              {...(index === 0 ? { 'data-primary': 'true' } : {})}
              onClick={() => onDismiss(card.view)}
              className={`mt-4 ${index === 0 ? PRIMARY_BUTTON : SECONDARY_BUTTON}`}
            >
              {card.actionLabel}
            </button>
          </article>
        ))}
      </div>

      <footer className="mx-auto mt-6 flex w-full max-w-5xl flex-wrap items-center gap-3">
        <button
          type="button"
          data-testid="welcome-skip"
          onClick={() => onDismiss(null)}
          className={QUIET_BUTTON}
        >
          Skip
          <span className="sr-only"> this introduction (Escape)</span>
        </button>
        <span className="text-xs text-ink-faint">
          You can open this again from Settings at any time.
        </span>
      </footer>
    </section>
  );
}
