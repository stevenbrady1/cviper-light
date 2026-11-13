import { useEffect, useState } from 'react';

import { type BrowserPort } from '../../platform/browser';
import { cardClasses, StatusPill } from '../../ui';

import { readAvailability } from '../analysis/availability';
import { OllamaDownloadLink } from '../analysis/OllamaDownloadLink';
import { ollamaNeedsChatModel, type Availability } from '../analysis/providers';
import { LOOKING_FOR_LOCAL_AI, localModelLine } from '../onboarding/cards';

/**
 * Settings → "On this PC" (L-406): whether the AI on the user's own computer
 * is ready, above the list of companies a CV could be sent to instead.
 *
 * It reads the probe the welcome card reads and says it in the welcome card's
 * sentences (`localModelLine`), so the two screens cannot disagree and the
 * "nothing you check will leave your PC" claim has one source.
 *
 * There is no "In use" here. Which AI reads a CV is chosen on each check, so
 * this box only says what the computer has.
 */
export interface OnThisPcProps {
  readonly browser: BrowserPort;
  /** Injected by tests. Defaults to the same probe Welcome and Analysis make. */
  readonly detect?: (() => Promise<Availability>) | undefined;
}

/** What Ollama answered, or `null` until it has. `false` is "nothing found". */
type Found = Availability | false | null;

export function OnThisPc({ browser, detect }: OnThisPcProps) {
  const [found, setFound] = useState<Found>(null);

  useEffect(() => {
    let cancelled = false;
    (detect ?? readAvailability)()
      .then((availability) => {
        if (cancelled) return;
        setFound(
          availability.ollamaRunning || availability.ollamaModels.length > 0 ? availability : false,
        );
      })
      .catch(() => {
        // A probe that failed and a PC with no Ollama get the same honest line.
        if (!cancelled) setFound(false);
      });
    return () => {
      cancelled = true;
    };
  }, [detect]);

  const needsModel = found !== null && found !== false && ollamaNeedsChatModel(found);

  return (
    <section data-testid="settings-on-this-pc" className={cardClasses()}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium text-ink">On this PC</h2>
        {found === null || found === false ? null : (
          <StatusPill tone={needsModel ? 'attention' : 'ready'} data-testid="on-this-pc-status">
            {needsModel ? 'Needs a chat model' : 'Ready'}
          </StatusPill>
        )}
      </div>

      <p data-testid="on-this-pc-line" className="mt-1 break-words text-ink-muted">
        {found === null
          ? LOOKING_FOR_LOCAL_AI
          : found === false
            ? 'No AI is running on this PC. The basic CV match works without one.'
            : localModelLine(found)}
      </p>

      {/* Kept when nothing is found, on purpose: the owner chose it so people learn the private option exists (bends L-191). */}
      {found === false || needsModel ? (
        <p className="text-ink-muted">
          <OllamaDownloadLink idPrefix="settings" browser={browser} />
        </p>
      ) : null}
    </section>
  );
}
