import { useEffect, useMemo, useState } from 'react';

import { SECONDARY_BUTTON } from '../../app/buttons';
import { type SecretKeyName } from '../../status/environment';

import {
  createTauriLeftoverKeysPort,
  hasCheckedLeftoverKeys,
  leftoverNames,
  markLeftoverKeysChecked,
  type LeftoverKeysPort,
} from './leftoverKeys';

/**
 * "We found keys saved by an earlier install" — asked once, on the welcome
 * (L-251). See `leftoverKeys.ts` for when, and why it asks rather than acts.
 *
 * Renders nothing at all until it has decided, and nothing afterwards unless
 * there is a question to ask. It is not an overlay: it sits in the welcome's
 * own flow, so it needs no mutual exclusion with anything, and the welcome's
 * one primary button stays the only one.
 */
export interface LeftoverKeysNoticeProps {
  /** Injected by tests. Defaults to the real credential store and database. */
  readonly port?: LeftoverKeysPort | undefined;
}

type Stage =
  | { readonly kind: 'quiet' }
  | { readonly kind: 'asking'; readonly keys: readonly SecretKeyName[]; readonly busy: boolean }
  | { readonly kind: 'removed' };

export function LeftoverKeysNotice({ port }: LeftoverKeysNoticeProps) {
  const keysPort = useMemo(() => port ?? createTauriLeftoverKeysPort(), [port]);
  const [stage, setStage] = useState<Stage>({ kind: 'quiet' });
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (hasCheckedLeftoverKeys()) return;
    let cancelled = false;

    void (async () => {
      const [keys, hasData] = await Promise.all([keysPort.found(), keysPort.hasData()]);
      if (cancelled) return;
      // Decided — whatever the answer, it is never asked again.
      markLeftoverKeysChecked();
      if (keys.length === 0 || hasData) return;
      setStage({ kind: 'asking', keys, busy: false });
    })();

    return () => {
      cancelled = true;
    };
  }, [keysPort]);

  if (stage.kind === 'quiet') return null;

  if (stage.kind === 'removed') {
    return (
      <p
        role="status"
        data-testid="leftover-keys-done"
        className="mx-auto mt-6 w-full max-w-5xl rounded-control bg-teal/10 px-3 py-2 text-teal-ink"
      >
        Done — those keys are removed from this computer.
      </p>
    );
  }

  const names = leftoverNames(stage.keys);

  const onRemove = async (): Promise<void> => {
    setProblem(null);
    setStage({ ...stage, busy: true });
    const removed = await keysPort.remove(stage.keys);
    if (!removed.ok) {
      setProblem(`Those keys could not be removed. ${removed.error.message}`);
      setStage({ ...stage, busy: false });
      return;
    }
    setStage({ kind: 'removed' });
  };

  return (
    <section
      data-testid="leftover-keys"
      aria-labelledby="leftover-keys-heading"
      className="mx-auto mt-6 w-full max-w-5xl rounded-card border border-line bg-card px-4 py-3"
    >
      <h2 id="leftover-keys-heading" className="font-medium text-ink">
        Keys from an earlier install
      </h2>
      <p className="mt-1 text-ink-muted">
        We found keys saved on this computer by an earlier CViper Light install:{' '}
        <span className="font-medium text-ink">{names.join(', ')}</span>. Keep them, or remove them
        from this computer?
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="leftover-keys-keep"
          disabled={stage.busy}
          onClick={() => setStage({ kind: 'quiet' })}
          className={SECONDARY_BUTTON}
        >
          Keep them
        </button>
        <button
          type="button"
          data-testid="leftover-keys-remove"
          disabled={stage.busy}
          onClick={() => void onRemove()}
          className={SECONDARY_BUTTON}
        >
          {stage.busy ? 'Removing…' : 'Remove them'}
        </button>
      </div>
      {problem === null ? null : (
        <p
          role="alert"
          data-testid="leftover-keys-problem"
          className="mt-3 rounded-control bg-danger/5 px-3 py-2 text-danger"
        >
          {problem}
        </p>
      )}
    </section>
  );
}
