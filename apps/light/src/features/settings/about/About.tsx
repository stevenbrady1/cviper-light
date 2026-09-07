import { QUIET_BUTTON } from '../../../app/buttons';
import { type BrowserPort } from '../../../platform/browser';
import { LIGHT_PAGE_URL, LIGHT_SOURCE_URL } from '../../signposts/links';
import { APP_VERSION } from '../backup';

/**
 * About — who made Light, what it costs, and which build this is (L-87).
 *
 * Stateless, like the signposts: the version is a compile-time constant and
 * the two links hand a fixed address to the user's browser. Nothing here is
 * checked, counted or fetched, and `signposts.stateless.contract.test.ts`
 * holds this folder to that.
 */

export interface AboutProps {
  readonly browser: BrowserPort;
}

export function About({ browser }: AboutProps) {
  return (
    <section data-testid="settings-about">
      <h2 className="font-medium text-ink">About</h2>
      <p className="mt-1 text-ink-muted">
        Made by the people behind cviper.ai. Light is free, MIT-licensed, and never sends us
        anything.
      </p>
      <p data-testid="about-version" className="mt-1 text-xs text-ink-faint">
        CViper Light {APP_VERSION} · MIT licence
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        <button
          type="button"
          data-testid="about-open-site"
          onClick={() => void browser.open(LIGHT_PAGE_URL)}
          className={`${QUIET_BUTTON} px-0 text-blue hover:bg-card hover:text-navy`}
        >
          cviper.ai/light →
        </button>
        <button
          type="button"
          data-testid="about-open-source"
          onClick={() => void browser.open(LIGHT_SOURCE_URL)}
          className={`${QUIET_BUTTON} px-0 text-blue hover:bg-card hover:text-navy`}
        >
          Source and licence on GitHub →
        </button>
        <span className="text-xs text-ink-faint">Both open in your browser.</span>
      </div>
    </section>
  );
}
