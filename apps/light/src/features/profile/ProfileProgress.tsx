import { PRIMARY_BUTTON } from '../../app/buttons';
import { Hint } from '../../app/Hint';
import { STEP_HINT } from '../../app/hints';
import { cardClasses, SectionHeading, StateMark, StatusPill } from '../../ui';

import { PART_TITLE, PROFILE_PART_IDS, type ProfilePart, type ProfilePartId } from './progress';

/**
 * The checklist at the top of Profile (L-413): how many of the six parts are
 * filled in, which, and the one button that takes the user to the next.
 *
 * ============================================================================
 * IT SAYS ONLY WHAT IT KNOWS
 * ============================================================================
 * The count comes from two separate reads, the profile and the CV list. Until
 * both have answered there is no count: the card is drawn at its full size with
 * nothing in it to see or hear, so the form below does not jump when the answer
 * lands (L-364). If either read fails the page leaves this card out altogether,
 * and that read's own error says why.
 *
 * ============================================================================
 * A PILL FOR EACH PART, AND NOT GOLD
 * ============================================================================
 * Teal with the drawn tick when filled in, plain grey with the ring when not.
 * Grey, not gold: gold means "needs you" in this app, and every part of the
 * profile is optional. The mark's meaning is in words too, for a screen reader
 * and on hover, in the step bar's own two sentences.
 */

/** Before the answer: the six titles, so the card is the size it will be. */
const WAITING: readonly ProfilePart[] = PROFILE_PART_IDS.map((id) => ({
  id,
  title: PART_TITLE[id],
  done: false,
}));

/**
 * The "Next:" line. Below `md` it takes the whole row, so the button always
 * sits under it and the waiting card is the height the answered one will be.
 */
// shortcut: on a phone the waiting card is one line out when "Next:" wraps (the
// longest title) or is absent (all six filled in); reserve per state if that jump ever matters.
const NEXT_LINE = 'min-w-0 basis-full md:basis-auto';

/** A line that takes a line's room and says nothing. */
const BLANK = ' ';

export interface ProfileProgressProps {
  /** The six parts, or `null` until both the profile and the CV list have been read. */
  readonly parts: readonly ProfilePart[] | null;
  /** True while another blue button is on this screen: the import review's "Add to my profile". */
  readonly blocked: boolean;
  readonly onFillIn: (part: ProfilePartId) => void;
}

export function ProfileProgress({ parts, blocked, onFillIn }: ProfileProgressProps) {
  const waiting = parts === null;
  const shown = parts ?? WAITING;
  const filled = shown.filter((part) => part.done).length;
  const next = shown.find((part) => !part.done) ?? null;
  // Only when the import is the ONE thing in the way (L-416): at six of six the
  // button stays greyed out after the import too, so the line would promise it.
  const awaitingImport = !waiting && blocked && next !== null;

  return (
    <section
      data-testid="profile-progress"
      data-waiting={waiting ? 'true' : undefined}
      aria-labelledby={waiting ? undefined : 'profile-progress-count'}
      className={`mb-5 ${cardClasses()}`}
    >
      <div aria-hidden={waiting ? 'true' : undefined} className={waiting ? 'invisible' : undefined}>
        <SectionHeading
          id="profile-progress-count"
          title={
            waiting ? (
              BLANK
            ) : (
              <span data-testid="profile-progress-count">
                {next === null
                  ? `All ${shown.length} parts filled in.`
                  : `${filled} of ${shown.length} parts filled in`}
              </span>
            )
          }
        />

        <ul className="mt-3 flex flex-wrap gap-2">
          {shown.map((part) => {
            const meaning = part.done ? STEP_HINT.done : STEP_HINT.todo;
            return (
              <li key={part.id}>
                <StatusPill
                  tone={part.done ? 'ready' : 'neutral'}
                  data-testid={`profile-progress-part-${part.id}`}
                >
                  <Hint text={meaning} focusable={false} className="inline-flex items-center gap-1">
                    <StateMark name={part.done ? 'tick' : 'ring'} />
                    {part.title}
                  </Hint>
                  <span className="sr-only"> {meaning}</span>
                </StatusPill>
              </li>
            );
          })}
        </ul>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          {waiting ? (
            <p className={NEXT_LINE}>{BLANK}</p>
          ) : next === null ? null : (
            <p data-testid="profile-progress-next" className={`${NEXT_LINE} text-ink-muted`}>
              Next: <span className="font-medium text-ink">{next.title}</span>
            </p>
          )}
          {/* Disabled, never hidden: with nothing left to fill in, and while the
              import review has the screen's blue button. */}
          <button
            type="button"
            data-testid="profile-progress-fill"
            data-primary="true"
            disabled={waiting || next === null || blocked}
            aria-describedby={awaitingImport ? 'profile-progress-reason' : undefined}
            onClick={() => {
              if (next !== null) onFillIn(next.id);
            }}
            className={PRIMARY_BUTTON}
          >
            Fill it in
          </button>
          {/* shortcut: the line adds one 32px row to the card when a review opens (the browser keeps the import panel still: measured in WebKit); reserve the row if a jump is ever reported. */}
          {awaitingImport ? (
            <p
              id="profile-progress-reason"
              data-testid="profile-progress-reason"
              className="basis-full text-ink-muted md:text-right"
            >
              Finish the import below first.
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
