import { type BrowserPort } from '../../platform/browser';
import { type EnvironmentStatus } from '../../status/environment';
import { cardClasses, StatusPill } from '../../ui';

import { OllamaDownloadLink } from '../analysis/OllamaDownloadLink';
import { LOOKING_FOR_LOCAL_AI, localModelLine } from '../onboarding/cards';

/**
 * Settings → "On this PC" (L-406): whether the AI on the user's own computer
 * is ready, above the list of companies a CV could be sent to instead.
 *
 * It says it in the welcome card's sentences (`localModelLine`), so the two
 * screens cannot disagree and the "nothing you check will leave your PC" claim
 * has one source.
 *
 * ============================================================================
 * IT ASKS NOTHING ITSELF
 * ============================================================================
 * The shell already asks this computer about Ollama when the app opens and on
 * every change of screen, for the rail. That answer is handed down, so the box
 * knows what to say the first time it is drawn. A box that asked for itself
 * would grow a moment later — and Settings opened at Job boards has already
 * scrolled by then, so the section would slide down the screen (L-364).
 *
 * There is no "In use" here. Which AI reads a CV is chosen on each check, so
 * this box only says what the computer has.
 */
export type LocalAi = Pick<EnvironmentStatus, 'ollama' | 'ollamaModels'>;

export interface OnThisPcProps {
  readonly browser: BrowserPort;
  /** What the shell's check found. `null` or absent until it has answered. */
  readonly localAi: LocalAi | null | undefined;
}

export function OnThisPc({ browser, localAi }: OnThisPcProps) {
  const answered = localAi !== null && localAi !== undefined;
  const running = answered && localAi.ollama === 'running';
  const models = (answered ? localAi.ollamaModels : undefined) ?? [];
  const needsModel = running && models.length === 0;
  const line = !answered
    ? LOOKING_FOR_LOCAL_AI
    : running
      ? // Only its two Ollama sentences are reached, and neither reads a key.
        localModelLine({
          ollamaRunning: true,
          ollamaModels: models,
          anthropicKey: false,
          openaiKey: false,
        })
      : 'No AI is running on this PC. The basic CV match works without one.';

  return (
    <section data-testid="settings-on-this-pc" className={cardClasses()}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium text-ink">On this PC</h2>
        {running ? (
          <StatusPill tone={needsModel ? 'attention' : 'ready'} data-testid="on-this-pc-status">
            {needsModel ? 'Needs a chat model' : 'Ready'}
          </StatusPill>
        ) : null}
      </div>

      <p data-testid="on-this-pc-line" className="mt-1 break-words text-ink-muted">
        {line}
      </p>

      {/* Kept when nothing is found, on purpose: the owner chose it so people learn the private option exists (bends L-191). */}
      {answered && (!running || needsModel) ? (
        <p className="text-ink-muted">
          <OllamaDownloadLink idPrefix="settings" browser={browser} />
        </p>
      ) : null}
    </section>
  );
}
