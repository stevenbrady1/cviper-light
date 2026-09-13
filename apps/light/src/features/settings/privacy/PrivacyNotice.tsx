import {
  OUTBOUND_CAPABILITIES,
  OUTBOUND_HOSTS,
  type OutboundPurpose,
} from '../../../lib/outbound-hosts';

import { DATA_LOCATIONS } from './dataLocations';

/**
 * The privacy notice, generated from the same registry the build is held to.
 *
 * `lib/outbound-hosts.ts` is the list of every host shipped code may name,
 * and `outbound-hosts.contract.test.ts` fails the build on any other. This
 * screen renders that list, so what the user reads and what the code can do
 * are the same object — a notice that cannot drift from the app it describes,
 * because there is no second copy to drift.
 *
 * Grouped by what the request means to the user, not by what it is
 * technically: "sent with your own key" is the group that costs money, "only
 * when you press a button" is the group that leaves the machine, "opened in
 * your browser" never touches the app's network at all, and "stays on this
 * computer" is Ollama.
 */

interface Group {
  readonly purpose: OutboundPurpose;
  readonly heading: string;
  readonly meaning: string;
}

export const GROUPS: readonly Group[] = [
  {
    purpose: 'fetched-with-your-key',
    heading: 'Sent with your own key, when you ask',
    meaning:
      'These carry a key you pasted into Settings, under an account that is yours. The bill, if there is one, is between you and that provider.',
  },
  {
    purpose: 'fetched-on-request',
    heading: 'Only when you press a button, with no key',
    meaning: 'A plain request with nothing about you in it beyond the request itself.',
  },
  {
    purpose: 'opened-in-your-browser',
    heading: 'Opened in your browser, never by the app',
    meaning:
      'The app hands the address to your own browser and is not involved from then on. What that site sees is what your browser shows it.',
  },
  {
    purpose: 'local-only',
    heading: 'Stays on this computer',
    meaning: 'A program running on this same machine. The request never reaches the internet.',
  },
  {
    purpose: 'made-by-your-system',
    heading: 'Done by Windows, not by this app',
    meaning:
      'Part of the operating system, around the app rather than inside it. It is listed because ' +
      'it is a real request leaving your PC, and left out it would look like something this app ' +
      'was hiding.',
  },
];

/**
 * The paragraph at the top of Settings → Privacy. The owner's own words.
 *
 * ============================================================================
 * NAMES NO AI PROVIDER, ON PURPOSE, AND PERMANENTLY (L-148)
 * ============================================================================
 * Every earlier version of this paragraph enumerated what could be configured
 * TODAY — "today that's OpenAI", then "today that's OpenAI or Anthropic" once
 * L-149 shipped a second card — and `configurableAi.contract.test.ts` used to
 * fail the build if a newly-configurable provider went unnamed here. The owner
 * reversed that on 13 September 2026: "the product must not read as tied to
 * one AI provider… provider names belong only in the 'how to get a key'
 * guidance, never in the product's description of itself."
 *
 * So this paragraph now says "the provider you choose" and stops there. That
 * is not a downgrade in honesty — a user can read exactly which providers
 * those are one screen down, where the generated host list names
 * `api.openai.com` and `api.anthropic.com` with the same "why" it always had —
 * it is a decision about where a brand name is allowed to live. The per-host
 * registry, the key cards themselves, and the analysis screen's option labels
 * still name providers, because that is where a specific provider is actually
 * being set up or chosen. This paragraph is the product describing itself, and
 * the product is not one provider's front end.
 *
 * A THIRD KEY CARD ARRIVING OWES THIS PARAGRAPH NOTHING. That is the whole
 * point of the reversal: naming was the thing that went stale, so removing it
 * is what stops the next provider from being one more paragraph to remember.
 * `lib/no-provider-brand-in-product-copy.contract.test.ts` fails the build the
 * other way now — if a brand name ever appears here again.
 *
 * The per-provider consent gate in `runAnalysis.ts` (L-97, PR #35) still needs
 * no update from any of this: its `ConsentProviderKind` is
 * `Exclude<ProviderId, 'ollama'>`, and the per-provider consent DIALOG is one
 * of the places a name is allowed, and expected, to appear.
 *
 * ============================================================================
 * "OR TEST A KEY" IS STILL LOAD-BEARING. DO NOT TIDY IT AWAY.
 * ============================================================================
 * A draft once said the job-board keys leave "only when you search". That is
 * not quite true: `job_test_credentials` (`src-tauri/src/jobs.rs`) runs a real
 * one-result search through `send_search` when the user presses "Test and save
 * this key" in Settings, so the key leaves the machine at SAVE time too. It is
 * literally a search, which is why the shorter sentence reads as defensible —
 * but nobody pressing Save would describe themselves as searching, and that
 * gap is exactly the kind this paragraph exists to close.
 */
export const PRIVACY_SUMMARY =
  'CViper Light runs on your computer. We have no server, no accounts, and no copy of your ' +
  'data. Your CV, a pasted advert and your own AI key only ever go to the provider you ' +
  'choose, or to a model running on your own PC. Your job-board keys go only to Adzuna and ' +
  'Reed, and only when you search or test a key.';

export function PrivacyNotice() {
  return (
    <div data-testid="privacy-notice" className="mt-3 space-y-4">
      <div>
        <h3 className="font-medium text-ink">Where your data lives</h3>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-ink-muted">
          {DATA_LOCATIONS.map((location) => (
            <li key={location.what}>
              <span className="text-ink">{location.what}</span> — {location.where}.
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h3 className="font-medium text-ink">Every place this app can contact</h3>
        <p className="mt-1 text-xs text-ink-faint">
          This list is not a summary. It is the exact set of addresses the code is allowed to name;
          a test fails the build if one is added without appearing here. Two things below have no
          fixed address — the advert page you choose, and Windows itself — so they are described
          instead of named.
        </p>

        {GROUPS.map((group) => {
          const hosts = OUTBOUND_HOSTS.filter((entry) => entry.purpose === group.purpose);
          const capabilities = OUTBOUND_CAPABILITIES.filter(
            (entry) => entry.purpose === group.purpose,
          );
          if (hosts.length === 0 && capabilities.length === 0) return null;
          return (
            <section key={group.purpose} className="mt-3">
              <h4 className="text-sm font-medium text-ink">{group.heading}</h4>
              <p className="text-xs text-ink-faint">{group.meaning}</p>
              <ul className="mt-1 space-y-1 text-ink-muted">
                {hosts.map((entry) => (
                  <li key={entry.host} data-testid={`privacy-host-${entry.host}`}>
                    <code className="text-ink">{entry.host}</code> — {entry.why}
                  </li>
                ))}
                {/*
                  Not a `<code>`: these are descriptions, not addresses, and
                  setting them in the address face would read as though the app
                  contacted something literally called "any job-advert page".
                */}
                {capabilities.map((entry) => (
                  <li key={entry.id} data-testid={`privacy-capability-${entry.id}`}>
                    <span className="text-ink">{entry.what}</span> — {entry.why}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
