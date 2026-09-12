/**
 * Every network host this app can name.
 *
 * This is the registry the privacy notice is generated from and the list the
 * `outbound-hosts.contract.test.ts` guard holds the source tree to. A host
 * that is not here cannot appear in shipped code — the guard fails the build —
 * so the notice can honestly say "these, and nothing else".
 *
 * Two things are deliberately NOT hosts in this list:
 *
 *   * The page a user asks the app to fetch from a link. That host is whatever
 *     they pasted; it is never a literal in this tree. `fetch_page.rs` refuses
 *     private and loopback targets and follows no links, and the README's
 *     "When you press Fetch" section describes it.
 *   * A job-board link the user adds themselves in Settings. Those live in the
 *     database, are opened in the user's own browser, and are theirs.
 *
 * Adding an entry is a product decision, not a code change: it widens what
 * the app may contact, so the `why` must say who started the request and
 * whose credential it carries (ADR 012 in the hosted repository: no request
 * without a user action, no credential that is not the user's own).
 */

export type OutboundPurpose =
  /** The app sends a request here, carrying a key the user pasted in Settings. */
  | 'fetched-with-your-key'
  /** The app sends a request here with no credential, only when the user presses a button. */
  | 'fetched-on-request'
  /** The app never contacts this host; it hands the address to the user's browser. */
  | 'opened-in-your-browser'
  /** Loopback only — a program on this same machine. Never leaves the computer. */
  | 'local-only';

export interface OutboundHost {
  readonly host: string;
  readonly purpose: OutboundPurpose;
  /** One plain sentence a user can read: who starts it and what it carries. */
  readonly why: string;
}

export const OUTBOUND_HOSTS: readonly OutboundHost[] = [
  {
    host: 'api.openai.com',
    purpose: 'fetched-with-your-key',
    why: 'A CV analysis you start, sent with your own OpenAI key under your own OpenAI account.',
  },
  {
    host: 'api.anthropic.com',
    purpose: 'fetched-with-your-key',
    why: 'A CV analysis you start, sent with your own Anthropic key under your own Anthropic account.',
  },
  {
    host: 'api.adzuna.com',
    purpose: 'fetched-with-your-key',
    why: 'A job search you start, sent with the free Adzuna key you registered yourself.',
  },
  {
    host: 'www.reed.co.uk',
    purpose: 'fetched-with-your-key',
    why: 'A job search you start, sent with the free Reed key you registered yourself. Reed’s developer page is also opened in your browser from Settings.',
  },
  {
    host: 'developer.adzuna.com',
    purpose: 'opened-in-your-browser',
    why: 'The page where you register your own Adzuna key. Opened in your browser from Settings; the app does not load it.',
  },
  {
    host: 'platform.openai.com',
    purpose: 'opened-in-your-browser',
    why: 'The page where you create your own OpenAI API key. The welcome screen and the OpenAI card in Settings hand the address to your browser when you tap it; the app never loads it, and nothing is added to the link.',
  },
  {
    host: 'www.linkedin.com',
    purpose: 'opened-in-your-browser',
    why: 'A keyless search link for LinkedIn, from job-boards.json. Pressing it hands the address to your own browser; the app never loads the page.',
  },
  {
    host: 'uk.indeed.com',
    purpose: 'opened-in-your-browser',
    why: 'A keyless search link for Indeed, from job-boards.json. Pressing it hands the address to your own browser; the app never loads the page.',
  },
  {
    host: 'www.totaljobs.com',
    purpose: 'opened-in-your-browser',
    why: 'A keyless search link for Totaljobs, from job-boards.json. Pressing it hands the address to your own browser; the app never loads the page.',
  },
  {
    host: 'www.cv-library.co.uk',
    purpose: 'opened-in-your-browser',
    why: 'A keyless search link for CV-Library, from job-boards.json. Pressing it hands the address to your own browser; the app never loads the page.',
  },
  {
    host: 'www.adzuna.co.uk',
    purpose: 'opened-in-your-browser',
    why: 'A keyless search link for Adzuna’s public search, from job-boards.json. Pressing it hands the address to your own browser; the app never loads the page.',
  },
  {
    host: 'www.google.com',
    purpose: 'opened-in-your-browser',
    why: 'A keyless search link for Google Jobs, from job-boards.json. Pressing it hands the address to your own browser; the app never loads the page.',
  },
  {
    host: 'jobs.theguardian.com',
    purpose: 'opened-in-your-browser',
    why: 'A keyless search link for Guardian Jobs, from job-boards.json. Pressing it hands the address to your own browser; the app never loads the page.',
  },
  {
    host: 'www.jobserve.com',
    purpose: 'opened-in-your-browser',
    why: 'A keyless search link for Jobserve, from job-boards.json. Pressing it hands the address to your own browser; the app never loads the page, and it never scrapes Jobserve.',
  },
  {
    host: 'cviper.ai',
    purpose: 'opened-in-your-browser',
    why: 'The full CViper, and the page about this app. Three one-line signposts and the About entry in Settings hand the address to your browser when you tap them; the app never loads it, and nothing is added to the link.',
  },
  {
    host: 'github.com',
    purpose: 'fetched-on-request',
    why: 'The update check reads a small signed file from this app’s public GitHub releases. It happens when you press “Check for updates”, and carries no data about you beyond the request itself. The source code is also opened in your browser from Settings → About.',
  },
  {
    host: '127.0.0.1',
    purpose: 'local-only',
    why: 'Ollama, if you installed it. The request goes to a program on this computer, not to the internet.',
  },
  {
    host: 'localhost',
    purpose: 'local-only',
    why: 'Named only so the fetch-from-link guard can refuse it. Never contacted.',
  },
];

/** The hosts alone, for the guard and for anything that needs a quick membership test. */
export const OUTBOUND_HOST_NAMES: ReadonlySet<string> = new Set(
  OUTBOUND_HOSTS.map((entry) => entry.host),
);
