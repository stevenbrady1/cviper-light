/**
 * "Report a problem": a pre-filled GitHub issue, and NOTHING else (L-91).
 *
 * ============================================================================
 * WHAT GOES IN, EXHAUSTIVELY
 * ============================================================================
 * Two strings: the app version and a description of the operating system and
 * web view. That is the entire input to this module — it is the whole of
 * `ReportFacts`, and there is no second parameter, no optional extra and no
 * port handed in that could fetch one.
 *
 * That is deliberate, and the type is the guard. The obvious "helpful" next
 * step for a bug report is to attach a log, then the last error, then the
 * job that was on screen — and each of those is the user's data leaving their
 * machine on a button press they thought was a bug report. This app writes no
 * log file at all, so there is nothing to attach even if somebody wanted to,
 * and the owner has decided it will stay that way.
 *
 * `model.test.ts` holds the shipped source of this folder to it as well, so the
 * promise survives somebody adding an import rather than a parameter.
 *
 * ============================================================================
 * WHY A URL AND NOT AN API CALL
 * ============================================================================
 * The address is handed to the user's own browser (`platform/browser.ts`). The
 * app never contacts github.com for this — the user sees the issue form, reads
 * exactly what is in it, and decides whether to press submit. An app that
 * POSTed a report would be an app that sent something the user never read.
 */

/** Where a report goes. `github.com` is registered in `lib/outbound-hosts.ts`. */
export const REPORT_ISSUE_URL = 'https://github.com/stevenbrady1/cviper-light/issues/new';

/** The issue title, pre-filled. The user can change it before submitting. */
export const REPORT_TITLE = 'Problem report';

/**
 * The longest URL we will hand to a browser.
 *
 * GitHub answers a longer query string with `414 URI Too Long`, and browsers
 * have their own limits below that. 8000 leaves room under every one of them.
 */
export const MAX_ISSUE_URL_LENGTH = 8000;

/**
 * The longest either fact may be.
 *
 * A real version is 5 characters and a real user-agent platform string is
 * about 40. Anything dramatically longer is a malformed or hostile user agent,
 * not information — and the report is more useful truncated than it is
 * unsendable.
 */
export const MAX_FACT_LENGTH = 120;

/** Everything that is known about this machine, and everything that is sent. */
export interface ReportFacts {
  /** The running build, e.g. `0.1.0`. */
  readonly version: string;
  /** The OS and web view, from `describeSystem`. */
  readonly system: string;
}

/** One fact, tidied and bounded. Never empty — an empty line reads as a bug. */
export function clampFact(value: string): string {
  const tidy = value.replace(/\s+/g, ' ').trim();
  if (tidy === '') return 'unknown';
  return tidy.length > MAX_FACT_LENGTH ? tidy.slice(0, MAX_FACT_LENGTH) : tidy;
}

/**
 * The operating system and web view, read off the web view's own user agent.
 *
 * Same reasoning as `platform/os.ts`: the user agent is already in the page, it
 * is stable, and it needs no Rust command, no plugin, no capability entry and
 * no network request. WebView2 reports itself as `Edg/<version>` — that IS the
 * WebView2 version, and it is the single most useful fact in a rendering bug
 * report, because the runtime updates itself on Microsoft's schedule and the
 * user has no idea which one they are on.
 *
 * Never the WHOLE user agent. It is long, it is mostly noise, and pasting an
 * opaque string into a public issue is the sort of thing people are right to be
 * wary of. The platform token and the engine version are what a maintainer
 * actually reads.
 */
export function describeSystem(userAgent: string): string {
  const platform = /\(([^)]*)\)/.exec(userAgent)?.[1]?.trim() ?? '';
  const webview2 = /\bEdg\/([0-9.]+)/.exec(userAgent)?.[1];
  const webkit = /\bAppleWebKit\/([0-9.]+)/.exec(userAgent)?.[1];

  const engine =
    webview2 !== undefined
      ? `WebView2 ${webview2}`
      : webkit !== undefined
        ? `WebKit ${webkit}`
        : '';

  const parts = [platform, engine].filter((part) => part !== '');
  return parts.length === 0 ? 'unknown' : parts.join(' · ');
}

/**
 * The issue body.
 *
 * The automatic part is written out in PLAIN SIGHT rather than hidden in an
 * HTML comment. A user who is reporting a problem with a privacy-first app is
 * exactly the user who wants to see what the button put in the box, and a
 * collapsed `<!-- -->` block would be the one part of this app they could not
 * read before sending.
 */
export function reportBody(facts: ReportFacts): string {
  return [
    'What went wrong?',
    '',
    '',
    'What did you expect instead?',
    '',
    '',
    '---',
    '',
    'Filled in automatically, and this is all of it:',
    '',
    `- App version: ${clampFact(facts.version)}`,
    `- System: ${clampFact(facts.system)}`,
    '',
    'Nothing else is attached. CViper Light writes no log file, so there is no log to send, ' +
      'and no part of your CVs, your saved jobs, your applications or your keys is in this ' +
      'report. Everything above this line is yours to write or delete before you submit it.',
  ].join('\n');
}

function assemble(body: string): string {
  return (
    `${REPORT_ISSUE_URL}?title=${encodeURIComponent(REPORT_TITLE)}` +
    `&body=${encodeURIComponent(body)}`
  );
}

/**
 * The pre-filled issue address.
 *
 * `limit` is a parameter rather than a constant read from scope so the
 * shrinking below can be exercised by a test at a length a real report never
 * reaches. Without that it would be a branch nothing ever executes, which is
 * the same as not having written it.
 *
 * The body is shortened BEFORE it is encoded, by code points rather than by
 * UTF-16 units — slicing an encoded string can cut a `%E2%80%` in half, and
 * slicing by unit can strand half a surrogate pair, which makes
 * `encodeURIComponent` throw.
 *
 * A `limit` smaller than the bare address cannot be met; the loop stops with an
 * empty body rather than spinning, and the caller gets the shortest URL this
 * can produce.
 */
export function reportUrl(facts: ReportFacts, limit: number = MAX_ISSUE_URL_LENGTH): string {
  let body = reportBody(facts);
  let url = assemble(body);

  while (url.length > limit && body.length > 0) {
    const points = Array.from(body);
    body = points.slice(0, Math.floor(points.length * 0.9)).join('');
    url = assemble(body);
  }

  return url;
}
