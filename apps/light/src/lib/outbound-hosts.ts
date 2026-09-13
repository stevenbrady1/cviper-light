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
 *
 * ============================================================================
 * THE SECOND LIST, AND WHY IT IS A SECOND LIST (L-91)
 * ============================================================================
 * "A host that is not here cannot appear in shipped code" is only checkable
 * because `OUTBOUND_HOST_NAMES` is a set of real host names that the guard
 * compares against real host names extracted from the tree. That is the whole
 * contract, and it is worth keeping exactly as narrow as it is.
 *
 * But it left the privacy notice INCOMPLETE, which is a different defect.
 * `fetch_page.rs` will open any public http(s) page the user pastes and presses
 * Fetch on, and the Windows WebView2 runtime talks to Microsoft on its own
 * schedule. Neither has a fixed address, so neither can be a host — and a
 * notice that says "these, and nothing else" while omitting them is not honest.
 *
 * So they live in `OUTBOUND_CAPABILITIES`, which deliberately does NOT join
 * `OUTBOUND_HOST_NAMES`. The guard's allow-set is byte-for-byte what it was;
 * the two screens generated from this module render both lists into the same
 * grouping, so what the user reads is complete. One registry, two shapes: an
 * address, and a permission that has no address.
 */

export type OutboundPurpose =
  /** The app sends a request here, carrying a key the user pasted in Settings. */
  | 'fetched-with-your-key'
  /** The app sends a request here with no credential, only when the user presses a button. */
  | 'fetched-on-request'
  /** The app never contacts this host; it hands the address to the user's browser. */
  | 'opened-in-your-browser'
  /** Loopback only — a program on this same machine. Never leaves the computer. */
  | 'local-only'
  /**
   * Not this app's request at all — something the operating system does around
   * it. Only ever valid on an `OutboundCapability`; the contract test pins
   * `OUTBOUND_HOSTS` to the four purposes above, so a host given this one fails
   * the build.
   */
  | 'made-by-your-system';

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
    // L-134c: the tracker's "paste a job" box (runExtraction.ts) sends
    // whatever was pasted — which can be a recruiter's email forwarded
    // verbatim — through the same provider adapter a CV analysis uses. The
    // sentence used to name only the CV analysis.
    why: 'A CV analysis, or a pasted job advert, that you start, sent with your own OpenAI key under your own OpenAI account.',
  },
  {
    host: 'api.anthropic.com',
    purpose: 'fetched-with-your-key',
    // Scoped deliberately (L-105). `providers.rs` can reach Anthropic and
    // `anthropic_api_key` is a real slot in the credential store — but since
    // L-102 no screen in this build can put one there, so copy offering the
    // reader "your own Anthropic key" described something no part of the app
    // supports. The host STAYS: this list states reach, not choice, and
    // dropping it would make the notice a summary. Only the sentence changed.
    // `privacy/unconfigurableKeyClaims.contract.test.tsx` fails the build if a
    // provider with no key card is ever described as one you hold a key for.
    //
    // L-134c added "or a pasted job advert" for the same reason as OpenAI's
    // entry above; the "no screen for adding one" caveat is unchanged.
    why:
      'A CV analysis, or a pasted job advert, that you start, but only if an Anthropic key is ' +
      'already in this computer’s credential store. This version has no screen for adding ' +
      'one, so for most people it is never contacted.',
  },
  {
    host: 'api.adzuna.com',
    purpose: 'fetched-with-your-key',
    // L-134a: `jobs.rs:496-499` puts both credentials on the query string —
    // Adzuna's API requires them there, unlike Reed's HTTP Basic auth a few
    // lines below — so they appear in Adzuna's own request logs and in any
    // proxy between here and Adzuna. `describe_request_failure` exists so a
    // `reqwest` error can never print that address back to the user.
    //
    // W3 (coordinator review): "nothing else about you is sent" was
    // stronger than the truth, and stronger than every keyless sibling
    // below, which all add the IP-address caveat. A search carries the
    // search words and location — that is what a search is — and Adzuna
    // sees the requester's IP address the same way any site would.
    why:
      'A job search you start, sent with the free Adzuna key you registered yourself. ' +
      'Adzuna’s API requires both parts of that key — the app ID and the app key — as ' +
      'parameters in the web address, so they appear in Adzuna’s own request logs. The ' +
      'request also carries your search words and location, which is what a search is, and ' +
      'Adzuna sees your IP address, exactly as it would if you searched on its own site ' +
      'yourself.',
  },
  {
    host: 'www.reed.co.uk',
    purpose: 'fetched-with-your-key',
    // L-128: `config/job-boards.json` also has a keyless www.reed.co.uk
    // search link opened in the browser — the same host as the keyed API
    // above, so it cannot be a second entry (that would list this host
    // twice) and has to be disclosed here instead.
    //
    // W3: same IP-address caveat as Adzuna's entry above, for the same
    // reason — the keyed search is still a real request Reed receives and
    // answers, carrying the search words and location.
    why:
      'A job search you start, sent with the free Reed key you registered yourself, carrying ' +
      'your search words and location — Reed sees those and your IP address, exactly as it ' +
      'would if you searched on reed.co.uk yourself. Reed’s developer page is also opened in ' +
      'your browser from Settings, and so is a keyless search link for Reed from ' +
      'job-boards.json; the app never loads either page.',
  },
  {
    host: 'www.arbeitnow.com',
    purpose: 'fetched-on-request',
    why:
      'The list of recent jobs this free job board publishes, read when you press Browse. It ' +
      'takes no key and no account, and nothing about you is sent — the site sees your IP ' +
      'address, exactly as it would if you opened its job board in your browser. It cannot ' +
      'search: CViper reads the recent list and narrows it down on your computer.',
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
    // Two different things at one address, and the entry has to say both
    // (L-110). It was only ever a link handed to the browser; since the
    // keyless browse it is also a feed the app itself reads. Describing only
    // the older half would make this list a summary rather than the complete
    // statement it claims to be.
    purpose: 'fetched-on-request',
    why:
      'Guardian Jobs’ public list of its twenty most recent UK jobs, read when you press ' +
      'Browse. It takes no key and no account, and nothing about you is sent — the site sees ' +
      'your IP address, exactly as it would if you opened the page yourself. Its own search ' +
      'page is also opened in your browser by the keyless buttons on the search screen, and ' +
      'the app does not load that one.',
  },
  {
    host: 'www.jobserve.com',
    purpose: 'opened-in-your-browser',
    why: 'A keyless search link for Jobserve, from job-boards.json. Pressing it hands the address to your own browser; the app never loads the page, and it never scrapes Jobserve.',
  },
  {
    host: 'cviper.ai',
    purpose: 'opened-in-your-browser',
    why: 'This app’s own website: its download page and the privacy policy, opened in your browser when you tap a line that names it. The app never contacts it, and nothing is added to the link.',
  },
  {
    host: 'github.com',
    purpose: 'fetched-on-request',
    why: 'The update check reads a small signed file from this app’s public GitHub releases. It happens when you press “Check for updates”, and once when the app starts unless you switch that off in Settings. It carries no data about you beyond the request itself. The source code is also opened in your browser from Settings → About.',
  },
  {
    host: '127.0.0.1',
    purpose: 'local-only',
    // L-134b: this one is NOT started by a button. App.tsx:238-248 re-reads
    // the environment strip on mount and on every view change; that fans out
    // (status/environment.ts:145-154) into probeOllama() asking
    // 127.0.0.1:11434/api/tags whether Ollama is running, with no press
    // behind it. The sentence used to read as though every Ollama contact
    // was a request the user made.
    why:
      'Ollama, if you installed it. The app checks on its own — when it opens, and again each ' +
      'time you change screens — whether Ollama is running, by asking this same computer. ' +
      'Nothing about this ever leaves this computer, whether or not Ollama answers.',
  },
  {
    host: 'localhost',
    purpose: 'local-only',
    why: 'Named only so the fetch-from-link guard can refuse it. Never contacted.',
  },
];

/**
 * A destination the app can reach that has no fixed address.
 *
 * `what` sits where a host name would sit on the privacy screen, in plain
 * words rather than as an address — because there is no address to print. `id`
 * is a stable handle for a `data-testid`, never shown to the user.
 */
export interface OutboundCapability {
  readonly id: string;
  /** What it is, as the user would describe it. Not a host name. */
  readonly what: string;
  readonly purpose: OutboundPurpose;
  /** One plain sentence: who starts it and what it carries. */
  readonly why: string;
}

/**
 * Everything the app can reach that is not a name in the list above.
 *
 * These are NOT in `OUTBOUND_HOST_NAMES` and must never be: that set is the
 * guard's allow-list of literal host names, and putting a sentence in it would
 * turn a precise contract into a fuzzy one. They are here so the privacy notice
 * is complete, which is a separate promise from the guard's.
 */
export const OUTBOUND_CAPABILITIES: readonly OutboundCapability[] = [
  {
    id: 'fetched-advert',
    what: 'any job-advert page you ask it to open — only when you press Fetch',
    purpose: 'fetched-on-request',
    why:
      'You paste a link and press Fetch, and the app reads that one page so it can fill in the ' +
      'form. The address is whichever one you pasted, so it cannot be listed here in advance. ' +
      'It carries no cookies, no sign-in and no key, it cannot reach your saved keys, it ' +
      'follows no links, and addresses on your own computer or home network are refused. The ' +
      'site sees your IP address, exactly as it would if you had clicked the link yourself.',
  },
  {
    id: 'webview2-runtime',
    what: 'Microsoft, for the Windows WebView2 runtime this app draws in',
    purpose: 'made-by-your-system',
    why:
      'WebView2 is part of Windows, not part of this app. It updates itself and checks ' +
      'downloads with SmartScreen on Microsoft’s schedule. CViper Light does not start those ' +
      'requests, cannot see them and cannot switch them off; they happen for every program on ' +
      'your PC that uses WebView2, whether or not this one is running.',
  },
];

/** The hosts alone, for the guard and for anything that needs a quick membership test. */
export const OUTBOUND_HOST_NAMES: ReadonlySet<string> = new Set(
  OUTBOUND_HOSTS.map((entry) => entry.host),
);
