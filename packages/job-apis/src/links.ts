/**
 * Keyless job-board links - the search that works before anything is set up.
 *
 * ============================================================================
 * WHAT IS DELIBERATELY NOT HERE: THE LINKEDIN SCRAPER.
 * ============================================================================
 * The CViper web application has a `LinkedInAPI` class that calls LinkedIn's
 * unauthenticated guest endpoint and parses the returned HTML with
 * BeautifulSoup (`backend/job_sites_api.py`, line 336, whose own docstring says
 * "may break at any time"). Only the URL construction is ported. The scraper is
 * not, and this is a design decision rather than a shortcut:
 *
 *   * It would point LinkedIn's rate limiting and bot detection at the USER's
 *     home IP address, from software they installed. A server-side scraper
 *     costs the operator an IP block; a desktop one costs the user their
 *     LinkedIn account.
 *   * HTML parsing against an endpoint nobody promised us breaks on LinkedIn's
 *     schedule, and a desktop binary cannot be patched the same afternoon.
 *     Between the break and the update the feature is simply broken for
 *     everyone who installed it.
 *   * It needs an HTML parser in the bundle to read a page we are not entitled
 *     to read.
 *
 * A link that opens the user's own browser, where they are already signed in,
 * is not a lesser substitute for that. It is the correct design: it always
 * works, it needs no key, it breaks nothing when the site changes, and the
 * request comes from the user's browser because the user clicked something.
 *
 * ============================================================================
 * THE HOST AND PATH COME FROM THE TEMPLATE. NOTHING THE USER TYPES DOES.
 * ============================================================================
 * There is no longer one function per board: a board is a `BoardTemplate`, and
 * a template is a fixed URL with `{keyword}` and `{location}` holes in it. The
 * same principle as `providers.rs` still holds and is what makes that safe —
 * every typed value is percent-encoded before it is substituted, so an `&` in a
 * job title cannot start a new parameter, a `#` cannot start a fragment, and a
 * pasted URL cannot become the destination.
 *
 * `boardTemplateProblem` is the other half: a template the USER wrote is
 * refused unless it names `{keyword}`, is `http(s)`, keeps its own host out of
 * the placeholders, and still produces a valid URL when the location box is
 * empty.
 */
import {
  KEYWORD_PLACEHOLDER,
  LOCATION_PLACEHOLDER,
  type BoardEncoding,
  type BoardTemplate,
} from '@cviper/core-types';

/** The same two fields the real search uses, so one form drives both. */
export interface BrowserSearchInput {
  readonly keywords: string;
  readonly location: string;
}

/**
 * Collapse whitespace and control characters.
 *
 * Deliberately duplicated from `params.ts` rather than imported: that copy
 * guards what goes on the wire to a paid API, this one guards what goes in a
 * link. They agree today and are allowed to diverge without one silently
 * changing the other.
 */
function tidy(raw: string): string {
  let cleaned = '';
  for (const character of raw) {
    const code = character.codePointAt(0) ?? 0;
    cleaned += code < 0x20 || code === 0x7f ? ' ' : character;
  }
  return cleaned.replace(/\s+/g, ' ').trim();
}

/**
 * One typed value, ready to be dropped into a template.
 *
 * `encodeURIComponent` does the work in BOTH encodings, which is the whole
 * reason `C#` arrives as `C%23` on a path board and a query board alike. The
 * only difference is what a SPACE becomes: a hyphen in a path, a `+` in a
 * query. Anything else that needs escaping is escaped identically.
 */
function encodeValue(raw: string, encoding: BoardEncoding): string {
  const text = tidy(raw);
  if (text === '') return '';

  if (encoding === 'plus') {
    // `%20` -> `+` is the form encoding every one of these boards reads. It is
    // applied AFTER encodeURIComponent, so a `+` the user actually typed has
    // already become `%2B` and cannot be read back as a space.
    return encodeURIComponent(text).replaceAll('%20', '+');
  }

  return text.split(' ').map(encodeURIComponent).join('-');
}

/*
 * ============================================================================
 * THE EMPTY-VALUE RULE
 * ============================================================================
 * A URL template is not a string with holes in it; it is a string with holes
 * and the PUNCTUATION THAT ATTACHES THEM. Substituting nothing into
 * `.../{keyword}-jobs-in-{location}` leaves `.../business-analyst-jobs-in-`,
 * which is not a search — it is a 404 with a dangling preposition.
 *
 * So an empty value takes its connector with it, in three cases:
 *
 *   1. The placeholder is the WHOLE value of a query parameter
 *      (`&l={location}`) -> the whole parameter goes. `?q=analyst`, never
 *      `?q=analyst&l=`. An explicitly empty filter is not the same request as
 *      an absent one on every board, and it is noise on all of them.
 *
 *   2. The placeholder is a WHOLE path segment (`/jobs/{keyword}/`) -> the
 *      segment goes, so no `//` is ever left behind.
 *
 *   3. Otherwise the placeholder leaves with ONE adjacent connector: a run of
 *      joining punctuation, optionally wrapped around one of the joining words
 *      `in` / `at` / `near`. The run BEFORE the placeholder is preferred, and
 *      the one after it is used only when there is nothing before — which is
 *      exactly the case where the placeholder opens the segment or the value.
 *
 * Rule 3 is deliberately narrow. It removes `-in-`, `/in-` and `+`; it does NOT
 * remove `+jobs+`, because `jobs` is a word somebody put in the template on
 * purpose (Google's, where it is the difference between searching for the role
 * and searching for the role's job adverts). The lookbehind and lookahead on
 * the joining words are what stop `-internal-` being read as `-in` + `ternal`.
 */

/** Punctuation that only exists in a URL to join two words together. */
const JOIN = '[-+_.,]';

/** A connector immediately BEFORE the hole: `-in-`, `+`, `-`. */
const TRAILING_CONNECTOR = new RegExp(`(?:${JOIN}*(?<![a-z])(?:in|at|near))?${JOIN}+$`);

/** A connector immediately AFTER the hole: `-`, `+`, `-in-`. */
const LEADING_CONNECTOR = new RegExp(`^${JOIN}+(?:(?:in|at|near)(?=${JOIN}|$)${JOIN}*)?`);

/** `{keyword}` or `{location}`, wherever the next one is. */
const PLACEHOLDER = /\{(keyword|location)\}/;

/** A whole unit that is nothing but one placeholder. */
const ONLY_PLACEHOLDER = /^\{(keyword|location)\}$/;

type Values = Readonly<Record<string, string>>;

/**
 * Fill one unit — a path segment, or a whole `name=value` query parameter.
 *
 * Terminates because every iteration consumes the text up to and including one
 * placeholder, and a substituted value can never contain another: `{` and `}`
 * are percent-encoded by `encodeValue`.
 */
function fillUnit(unit: string, values: Values): string {
  let done = '';
  let rest = unit;

  for (;;) {
    const match = PLACEHOLDER.exec(rest);
    if (match === null) return done + rest;

    const before = rest.slice(0, match.index);
    const after = rest.slice(match.index + match[0].length);
    const value = values[match[1] ?? ''] ?? '';

    if (value !== '') {
      done += before + value;
      rest = after;
      continue;
    }

    const head = done + before;
    const trailing = TRAILING_CONNECTOR.exec(head);

    if (trailing !== null) {
      done = head.slice(0, head.length - trailing[0].length);
      rest = after;
      continue;
    }

    const leading = LEADING_CONNECTOR.exec(after);
    done = head;
    rest = leading === null ? after : after.slice(leading[0].length);
  }
}

/** Is this unit a placeholder that has nothing to put in it? */
function isEmptyPlaceholder(unit: string, values: Values): boolean {
  const match = ONLY_PLACEHOLDER.exec(unit);
  return match !== null && (values[match[1] ?? ''] ?? '') === '';
}

/** Split a template into the part that is fixed (`https://host`) and the rest. */
function splitOrigin(template: string): { origin: string; rest: string } {
  const scheme = template.indexOf('://');
  if (scheme === -1) return { origin: '', rest: template };

  const slash = template.indexOf('/', scheme + 3);
  if (slash === -1) return { origin: template, rest: '' };

  return { origin: template.slice(0, slash), rest: template.slice(slash) };
}

/**
 * The URL a board should open for this search.
 *
 * Never throws and always returns a string. A template that could not produce a
 * valid URL is refused at the point it is SAVED (`boardTemplateProblem`), and
 * `platform/browser.ts` refuses anything that is not `http(s)` at the point it
 * is opened — this function is not the place to discover that, because there is
 * no user standing in front of it.
 */
export function buildBoardUrl(board: BoardTemplate, input: BrowserSearchInput): string {
  const values: Values = {
    keyword: encodeValue(input.keywords, board.encoding),
    location: encodeValue(input.location, board.encoding),
  };

  const { origin, rest } = splitOrigin(board.urlTemplate);
  const mark = rest.indexOf('?');
  const pathTemplate = mark === -1 ? rest : rest.slice(0, mark);
  const queryTemplate = mark === -1 ? null : rest.slice(mark + 1);

  const segments: string[] = [];
  for (const segment of pathTemplate.split('/')) {
    if (isEmptyPlaceholder(segment, values)) continue;

    const filled = fillUnit(segment, values);
    // An empty segment that was NOT empty in the template collapsed away when
    // its connector went. Keeping it would leave `/jobs//` behind.
    if (filled === '' && segment !== '') continue;

    segments.push(filled);
  }

  const parameters: string[] = [];
  for (const parameter of queryTemplate === null ? [] : queryTemplate.split('&')) {
    const equals = parameter.indexOf('=');
    if (equals !== -1 && isEmptyPlaceholder(parameter.slice(equals + 1), values)) continue;

    const filled = fillUnit(parameter, values);
    if (filled !== '') parameters.push(filled);
  }

  const query = parameters.length === 0 ? '' : `?${parameters.join('&')}`;
  return `${origin}${segments.join('/')}${query}`;
}

/**
 * What is wrong with a template the user typed, or `null` if nothing is.
 *
 * Checked with the location box BOTH filled and empty, because a template that
 * only breaks when a box is empty is exactly the one a happy-path check waves
 * through.
 */
export function boardTemplateProblem(urlTemplate: string): string | null {
  const template = urlTemplate.trim();

  if (template === '') {
    return 'Paste the web address of a search on that site, with {keyword} where the job title goes.';
  }

  if (!template.includes(KEYWORD_PLACEHOLDER)) {
    return 'The address needs {keyword} in it, so the board knows what to search for.';
  }

  const { origin } = splitOrigin(template);
  if (origin.includes(KEYWORD_PLACEHOLDER) || origin.includes(LOCATION_PLACEHOLDER)) {
    return 'The name of the site has to be fixed — {keyword} and {location} belong after it.';
  }

  const probe: BoardTemplate = {
    id: 'probe',
    label: 'probe',
    urlTemplate: template,
    encoding: 'hyphen',
  };

  for (const input of [
    { keywords: 'business analyst', location: 'Milton Keynes' },
    { keywords: 'business analyst', location: '' },
  ]) {
    let parsed: URL;
    try {
      parsed = new URL(buildBoardUrl(probe, input));
    } catch {
      return 'That is not a web address CViper can open. It should start with https:// and be a link you could paste into a browser.';
    }

    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return 'Only https:// and http:// addresses can be opened.';
    }
  }

  return null;
}
