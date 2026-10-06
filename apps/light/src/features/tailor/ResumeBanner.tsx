import { QUIET_BUTTON, SECONDARY_BUTTON } from '../../app/buttons';

/**
 * "Continue where you left off" (L-199): a strip above the view on launch when
 * the user was tailoring for a job when the app last closed.
 *
 * A strip, never a modal, like `UpdateBanner`: the app is usable behind it,
 * and "Not now" changes nothing — the work is still kept for that job.
 * Continue is a SECONDARY button on purpose: every view keeps exactly one
 * primary action, and this strip sits above all of them.
 */
export interface ResumeBannerProps {
  readonly title: string;
  readonly company: string;
  readonly onContinue: () => void;
  readonly onDismiss: () => void;
}

export function ResumeBanner({ title, company, onContinue, onDismiss }: ResumeBannerProps) {
  const job = [title.trim(), company.trim()].filter((part) => part !== '').join(' at ');
  return (
    <div
      role="status"
      data-testid="resume-banner"
      className="flex flex-wrap items-center gap-3 border-b border-line bg-sunken px-4 py-2 md:px-6"
    >
      <p className="min-w-0 flex-1 text-ink-muted">
        <span className="font-medium text-ink">Continue where you left off</span>
        {job === '' ? ' — your tailored CV is still here.' : ` — Tailor for ${job}.`}
      </p>
      <button
        type="button"
        data-testid="resume-continue"
        onClick={onContinue}
        className={SECONDARY_BUTTON}
      >
        Continue
      </button>
      <button
        type="button"
        data-testid="resume-dismiss"
        onClick={onDismiss}
        className={QUIET_BUTTON}
      >
        Not now
      </button>
    </div>
  );
}
