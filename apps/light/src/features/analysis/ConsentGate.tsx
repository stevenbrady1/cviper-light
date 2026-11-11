import { useRef } from 'react';

import { PRIMARY_BUTTON, QUIET_BUTTON, SECONDARY_BUTTON } from '../../app/buttons';
import { Dialog } from '../../ui';

import { type ConsentProviderKind } from './consent';
import { providerInSentence, providerLabel } from './model';

/**
 * The consent dialog (Apple 5.1.2(i)): shown once per provider, before the
 * first run that would send a CV to it, and never pre-answered.
 *
 * ============================================================================
 * WHY THIS ONE IS ALLOWED TO BE A MODAL
 * ============================================================================
 * `docs/PLAN.md`'s own design direction reserves modals for "blocking,
 * destructive or wizard-shaped things" — everything else in this app lives in
 * the detail pane. This qualifies on the first ground: the analysis must not
 * proceed, in either direction, until the user has actually answered. A card
 * sitting inline next to the Run button is answerable to by accident (a
 * misclick, a stray scroll); a dialog the app waits on is not.
 *
 * ============================================================================
 * FOCUS LANDS ON "NOT NOW", NOT ON "SEND TO X" — THE SAME RULE AS ConfirmDelete
 * ============================================================================
 * A stray Enter must not send anyone's CV anywhere. Escape is the same answer
 * as clicking "Not now", and claims the event so nothing underneath also
 * reacts to it. The backdrop, markers, trap and Escape are `ui/Dialog.tsx`'s
 * (L-356); the wording stays here.
 */

interface ConsentGateProps {
  readonly kind: ConsentProviderKind;
  readonly onAccept: () => void;
  readonly onDecline: () => void;
}

export function ConsentGate({ kind, onAccept, onDecline }: ConsentGateProps) {
  const declineRef = useRef<HTMLButtonElement>(null);
  const label = providerInSentence(kind);
  // L-150: CViper cannot name the typed-address service, and one on the
  // user's own network may have no key — so it says where the address came
  // from rather than claiming a key was used.
  const how =
    kind === 'custom' ? 'at the address you added in Settings' : 'using the API key you added';

  return (
    <Dialog
      initialFocus={declineRef}
      onEscape={onDecline}
      labelledBy="consent-gate-title"
      describedBy="consent-gate-body consent-gate-sensitive"
      testId="analysis-consent-gate"
    >
      <h2 id="consent-gate-title" className="font-semibold text-ink">
        {`Send this CV to ${label}?`}
      </h2>
      <p id="consent-gate-body" className="mt-1 text-ink-muted">
        {`Checking it this way sends the text of your CV and the job advert to ${label}, ` +
          `${how}. This is the moment your CV leaves this machine — ` +
          'nothing is sent until you say so, and you can withdraw this any time.'}
      </p>
      {/*
          L-296 (from L-234): CVs often carry details an employer does not
          need, and health is special-category data under UK GDPR. Said here
          because this is the last moment the user can act on it. A tip, not a
          warning: no role, no warning colour. Only the CV's text is sent, so a
          photo is not mentioned.
        */}
      <p
        id="consent-gate-sensitive"
        data-testid="analysis-consent-sensitive"
        className="mt-2 text-ink-muted"
      >
        Tip: CVs often hold things an employer does not need, like your date of birth, health
        details or nationality. You can take them out of your CV before you send it.
      </p>

      <div className="mt-4 flex items-center justify-end gap-2">
        <button
          ref={declineRef}
          type="button"
          onClick={onDecline}
          data-testid="analysis-consent-decline"
          className={SECONDARY_BUTTON}
        >
          Not now
        </button>
        <button
          type="button"
          onClick={onAccept}
          data-testid="analysis-consent-accept"
          className={PRIMARY_BUTTON}
        >
          {`Send to ${label}`}
        </button>
      </div>
    </Dialog>
  );
}

interface ConsentStatusProps {
  readonly granted: readonly ConsentProviderKind[];
  readonly onWithdraw: (kind: ConsentProviderKind) => void;
}

/**
 * The reachable half of "revocable": every provider the user has said yes to,
 * with a button that says no.
 *
 * ============================================================================
 * WHY THIS LIVES HERE AND NOT IN SETTINGS
 * ============================================================================
 * `Settings.tsx` is owned by another change in flight. Consent is decided on
 * this screen, at the point of use, so withdrawing it belongs on the same
 * screen — not behind a navigation the user has no reason to take. Rendered
 * regardless of which option is currently picked in the dropdown, so a
 * consent granted earlier stays visible and revocable even after the user has
 * switched to Ollama or the basic match.
 *
 * ============================================================================
 * ABSENT, NOT AN EMPTY BOX
 * ============================================================================
 * Nothing granted is the state of almost every user, and a permanent "no
 * providers have your consent" notice would be noise on every visit — the
 * same reasoning `providerOptions` uses for Ollama.
 */
export function ConsentStatus({ granted, onWithdraw }: ConsentStatusProps) {
  if (granted.length === 0) return null;

  return (
    <ul data-testid="analysis-consent-status" className="mt-2 space-y-1">
      {granted.map((kind) => (
        <li
          key={kind}
          data-testid={`analysis-consent-status-${kind}`}
          className="flex items-center justify-between gap-2 rounded-control bg-sunken px-3 py-1.5 text-xs text-ink-muted"
        >
          <span>{`${providerLabel(kind)} can receive your CV and the adverts you check it against.`}</span>
          <button
            type="button"
            onClick={() => onWithdraw(kind)}
            data-testid={`analysis-consent-withdraw-${kind}`}
            className={QUIET_BUTTON}
          >
            Withdraw
          </button>
        </li>
      ))}
    </ul>
  );
}
