import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { ErrorBox, SectionHeading } from '../../ui';

import { ConsentStatus } from '../analysis/ConsentGate';
import {
  CONSENT_KINDS,
  createTauriConsentPort,
  type ConsentPort,
  type ConsentProviderKind,
  type ConsentState,
} from '../analysis/consent';

/**
 * Settings → "What I have agreed to" (L-410): every AI provider the user has
 * agreed to send a CV to, each with Withdraw.
 *
 * The same store, the same list (`CONSENT_KINDS`) and the same rows
 * (`ConsentStatus`) as Analysis and Tailor, so the sentence and the withdrawal
 * have one source. The rows stay on those two screens as well: consent is
 * given there, so taking it back there still makes sense.
 *
 * ============================================================================
 * ALWAYS DRAWN, AND NEVER GUESSING
 * ============================================================================
 * On Analysis an empty list is left out, because it would be noise on every
 * visit. Here it is the answer to the question the heading asks, so "nothing"
 * is said. It is said only once the store has answered: a file that cannot be
 * read is an error, never "Nothing yet" — the store fails closed and so does
 * this.
 *
 * ============================================================================
 * THE EMPTY LINE HOLDS ITS PLACE BEFORE IT IS SAID
 * ============================================================================
 * The store answers a moment after the screen has drawn, and this list sits
 * above Job boards, which Settings may already have scrolled to. A line that
 * appeared then would push that section down the screen (L-364). So until the
 * answer the line is there unseen and unspoken — `invisible`, and hidden from
 * a screen reader — taking exactly the room it will take for almost everyone.
 * Rows or an error are a different height; `onDrawn` is how Settings learns
 * of that.
 */
const NOTHING_YET = 'Nothing yet. A company appears here after you agree to send it your CV.';

export interface AgreedListProps {
  /** Injected by tests. Defaults to the real `tauri-plugin-store`-backed port. */
  readonly port?: ConsentPort | undefined;
  /**
   * Told once, when the first answer has been drawn. The list sits above
   * Settings' later sections and learns its rows from a file, so the screen
   * needs to know when it stops moving them (L-364).
   */
  readonly onDrawn?: (() => void) | undefined;
}

export function AgreedList({ port, onDrawn }: AgreedListProps = {}) {
  const store = useMemo(() => port ?? createTauriConsentPort(), [port]);
  // `null` until the store has answered: neither rows nor "Nothing yet".
  const [consent, setConsent] = useState<ConsentState | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void store.read().then((result) => {
      if (cancelled) return;
      if (result.ok) setConsent(result.value);
      else setProblem(result.error.message);
    });
    return () => {
      cancelled = true;
    };
  }, [store]);

  const answered = consent !== null || problem !== null;
  const told = useRef(false);
  // Before paint, so a screen that scrolls again does it in the same frame.
  useLayoutEffect(() => {
    if (!answered || told.current) return;
    told.current = true;
    onDrawn?.();
  }, [answered, onDrawn]);

  const onWithdraw = useCallback(
    async (kind: ConsentProviderKind) => {
      const revoked = await store.revoke(kind);
      if (revoked.ok) {
        setConsent(revoked.value);
        setProblem(null);
      } else {
        // Still agreed, so the row stays: the store's own words say why.
        setProblem(revoked.error.message);
      }
    },
    [store],
  );

  const granted = consent === null ? [] : CONSENT_KINDS.filter((kind) => consent[kind]);
  const waiting = !answered;

  return (
    <section data-testid="settings-agreed">
      <SectionHeading icon="shield" title="What I have agreed to" />

      {problem === null ? null : (
        <ErrorBox variant="box" gapAbove="mt-2" testId="settings-agreed-error">
          {problem}
        </ErrorBox>
      )}

      {waiting ? (
        <p aria-hidden="true" className="invisible mt-1 text-ink-muted">
          {NOTHING_YET}
        </p>
      ) : null}
      {consent !== null && granted.length === 0 ? (
        <p data-testid="settings-agreed-empty" className="mt-1 text-ink-muted">
          {NOTHING_YET}
        </p>
      ) : null}

      <ConsentStatus granted={granted} onWithdraw={(kind) => void onWithdraw(kind)} />
    </section>
  );
}
