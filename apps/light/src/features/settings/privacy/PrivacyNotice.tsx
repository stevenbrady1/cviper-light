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
 * The last sentence is the owner's AMENDMENT to their first draft, which named
 * OpenAI as the only destination. It is not the only one: the app also reaches
 * job boards with the user's own keys, whichever advert page they press Fetch
 * on, and GitHub for an update check. "except to reach the AI provider you
 * choose" is scoped to the two things it names — the key and the CV — which is
 * exactly what is true of those two, and `privacyCopy.test.tsx` pins the
 * wording so it cannot drift back into a promise about everything.
 */
export const PRIVACY_SUMMARY =
  'CViper Light runs on your computer. We have no server, no accounts, and no copy of your ' +
  'data. Your key and your CV never leave your machine except to reach the AI provider you ' +
  'choose — OpenAI, or a model running on your own PC.';

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
