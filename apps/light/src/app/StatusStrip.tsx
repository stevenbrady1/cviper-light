import {
  AI_STATUS_PROVIDERS,
  type EnvironmentStatus,
  type KeyState,
  NO_AI_KEYS,
  type OllamaState,
} from '../status/environment';

/**
 * The permanent answer to "what is set up on this machine".
 *
 * ============================================================================
 * IT LISTS WHAT IS THERE, NOT WHAT IS NOT (L-191)
 * ============================================================================
 * This strip used to draw every row whatever its state — a machine with
 * nothing configured showed three quiet grey dots, on the argument that "not
 * set up" is the normal state and deserves to be seen as such. The owner
 * reversed that: a list of absences is clutter, and the rail answers faster
 * when it names only what is present.
 *
 * Two things still show although nothing works yet, because they need the
 * user rather than describe an absence: a half-entered Adzuna (incomplete) and
 * a key the credential store will not read (unreadable). Both are gold.
 * Hiding them would hide a fault the user can fix.
 *
 * And the list is never left empty. With nothing to show, one quiet line says
 * so and offers the way to Settings — a new user sees a route, not a blank.
 *
 * It is still DELIBERATELY NOT AN ALERT. Nothing configured is a fine way to
 * use this app, so that line is plain text, and nothing here is ever red.
 */

/** Teal = present. Gold = needs you. Faint = simply not set up, which is fine. */
const DOT_BY_KEY_STATE: Record<KeyState, string> = {
  configured: 'bg-teal',
  incomplete: 'bg-gold',
  unreadable: 'bg-gold',
  missing: 'bg-ink-inverse-muted/40',
};

const DESCRIPTION_BY_KEY_STATE: Record<KeyState, string> = {
  configured: 'key saved',
  incomplete: 'needs its second credential',
  unreadable: 'saved key could not be read',
  missing: 'no key saved',
};

const DOT_BY_OLLAMA_STATE: Record<OllamaState, string> = {
  running: 'bg-teal',
  absent: 'bg-ink-inverse-muted/40',
};

const DESCRIPTION_BY_OLLAMA_STATE: Record<OllamaState, string> = {
  running: 'running on this machine',
  absent: 'not running',
};

interface DotProps {
  readonly testId: string;
  readonly label: string;
  readonly state: string;
  readonly tone: string;
  readonly description: string;
}

function Dot({ testId, label, state, tone, description }: DotProps) {
  return (
    <span className="inline-flex items-center gap-1.5" data-testid={testId} data-state={state}>
      {/*
        The dot carries no information a screen reader can use, so it is hidden
        from the accessibility tree and the same fact is given as real text
        instead. A coloured circle is never the only telling of a state here.
      */}
      <span aria-hidden="true" className={`size-2 shrink-0 rounded-pill ${tone}`} />
      <span>{label}</span>
      <span className="sr-only">{`: ${description}`}</span>
    </span>
  );
}

interface StatusStripProps {
  /** `null` while the first read is still in flight. */
  readonly status: EnvironmentStatus | null;
  /** Opens Settings from the "Nothing set up yet" line. Absent: no link drawn. */
  readonly onOpenSettings?: (() => void) | undefined;
}

/** A key state worth a row: present, or needing the user. `missing` is neither. */
function shows(state: KeyState): boolean {
  return state !== 'missing';
}

export function StatusStrip({ status, onOpenSettings }: StatusStripProps) {
  // Before the first answer arrives nothing is drawn but the counter: the read
  // is a few local calls and finishes in milliseconds, and flashing "Nothing
  // set up yet" at a machine that has everything set up would be a lie.
  const ollama: OllamaState = status?.ollama ?? 'absent';
  const adzuna: KeyState = status?.adzuna ?? 'missing';
  const reed: KeyState = status?.reed ?? 'missing';
  const ai = status?.ai ?? NO_AI_KEYS;
  const requests = status?.requestsToday ?? 0;

  const showOllama = ollama === 'running';
  const showAdzuna = shows(adzuna);
  const showReed = shows(reed);
  const aiShown = AI_STATUS_PROVIDERS.filter((provider) => shows(ai[provider.id]));
  const nothingSetUp =
    status !== null && !showOllama && !showAdzuna && !showReed && aiShown.length === 0;

  return (
    <section
      aria-label="What is set up"
      className="border-t border-canvas/10 px-4 py-3 text-xs text-ink-inverse-muted"
      data-testid="status-strip"
    >
      <h2 className="mb-2 font-mono text-[10px] font-medium tracking-[0.14em] uppercase">Set up</h2>

      <ul className="space-y-1.5">
        {showOllama ? (
          <li>
            <Dot
              testId="status-ollama"
              label="Ollama"
              state={ollama}
              tone={DOT_BY_OLLAMA_STATE[ollama]}
              description={DESCRIPTION_BY_OLLAMA_STATE[ollama]}
            />
          </li>
        ) : null}

        {showAdzuna || showReed ? (
          <li className="flex items-center gap-2">
            {showAdzuna ? (
              <Dot
                testId="status-adzuna"
                label="Adzuna"
                state={adzuna}
                tone={DOT_BY_KEY_STATE[adzuna]}
                description={DESCRIPTION_BY_KEY_STATE[adzuna]}
              />
            ) : null}
            {/* The separator only between two names, never beside one. */}
            {showAdzuna && showReed ? <span aria-hidden="true">·</span> : null}
            {showReed ? (
              <Dot
                testId="status-reed"
                label="Reed"
                state={reed}
                tone={DOT_BY_KEY_STATE[reed]}
                description={DESCRIPTION_BY_KEY_STATE[reed]}
              />
            ) : null}
          </li>
        ) : null}

        {/* The AI row (L-182): only providers with a key saved, or one unreadable. */}
        {aiShown.length > 0 ? (
          <li className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {aiShown.map((provider) => (
              <Dot
                key={provider.id}
                testId={`status-ai-${provider.id}`}
                label={provider.label}
                state={ai[provider.id]}
                tone={DOT_BY_KEY_STATE[ai[provider.id]]}
                description={DESCRIPTION_BY_KEY_STATE[ai[provider.id]]}
              />
            ))}
          </li>
        ) : null}

        {nothingSetUp ? (
          <li data-testid="status-none">
            Nothing set up yet
            {onOpenSettings === undefined ? null : (
              <>
                {' · '}
                <button
                  type="button"
                  data-testid="status-none-settings"
                  onClick={onOpenSettings}
                  className="underline underline-offset-2 hover:text-ink-inverse"
                >
                  Settings
                </button>
              </>
            )}
          </li>
        ) : null}

        <li className="flex items-center justify-between" data-testid="status-requests">
          <span>Requests today</span>
          {/*
            Mono and tabular, like every other number in this app, so it does
            not shuffle the row's width as it ticks from 9 to 10.

            A bare count, with no "/ 250" after it: Adzuna's free-tier limit
            depends on the plan the user signed up for, Reed publishes none, and
            the AI providers meter money rather than calls. A made-up
            denominator would be a confident wrong number on screen for ever.
          */}
          <span className="font-mono tabular-nums text-ink-inverse">{requests}</span>
        </li>
      </ul>
    </section>
  );
}
