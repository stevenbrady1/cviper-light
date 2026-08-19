import { type EnvironmentStatus, type KeyState, type OllamaState } from '../status/environment';

/**
 * The permanent answer to "what is set up on this machine".
 *
 * ============================================================================
 * WHY THIS IS ALWAYS ON SCREEN
 * ============================================================================
 * This app works with nothing configured, which is a real promise and also a
 * real risk: a user who has not entered any keys cannot otherwise tell whether
 * a feature is missing, broken, or simply switched off. Three small rows in the
 * rail make that permanently answerable without anybody going looking.
 *
 * It is DELIBERATELY NOT AN ALERT. A machine with no keys and no Ollama is the
 * default state, not a fault, so the empty case is three quiet grey dots and
 * not a row of warnings. Gold appears only where something genuinely needs the
 * user: a half-entered Adzuna, or a credential store that would not answer.
 *
 * The dots follow the app's colour grammar exactly — teal is present, gold is
 * attention, and nothing here is ever red, because none of these states is
 * destructive or a rejection.
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
}

export function StatusStrip({ status }: StatusStripProps) {
  // Before the first answer arrives, show the shape of the strip with
  // everything faint rather than a spinner. The read is three local IPC calls
  // and finishes in milliseconds; a spinner would flash and be gone.
  const ollama: OllamaState = status?.ollama ?? 'absent';
  const adzuna: KeyState = status?.adzuna ?? 'missing';
  const reed: KeyState = status?.reed ?? 'missing';
  const requests = status?.requestsToday ?? 0;

  return (
    <section
      aria-label="What is set up"
      className="border-t border-canvas/10 px-4 py-3 text-xs text-ink-inverse-muted"
      data-testid="status-strip"
    >
      <h2 className="mb-2 font-mono text-[10px] font-medium tracking-[0.14em] uppercase">Set up</h2>

      <ul className="space-y-1.5">
        <li>
          <Dot
            testId="status-ollama"
            label="Ollama"
            state={ollama}
            tone={DOT_BY_OLLAMA_STATE[ollama]}
            description={DESCRIPTION_BY_OLLAMA_STATE[ollama]}
          />
        </li>

        <li className="flex items-center gap-2">
          <Dot
            testId="status-adzuna"
            label="Adzuna"
            state={adzuna}
            tone={DOT_BY_KEY_STATE[adzuna]}
            description={DESCRIPTION_BY_KEY_STATE[adzuna]}
          />
          <span aria-hidden="true">·</span>
          <Dot
            testId="status-reed"
            label="Reed"
            state={reed}
            tone={DOT_BY_KEY_STATE[reed]}
            description={DESCRIPTION_BY_KEY_STATE[reed]}
          />
        </li>

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
