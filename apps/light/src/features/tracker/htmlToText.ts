/**
 * A fetched page, turned into the text a person would have copied off it.
 *
 * ============================================================================
 * NO HTML PARSER, ON PURPOSE
 * ============================================================================
 * A real parser would be more correct on malformed markup, and it would also be
 * a new dependency in a local-first desktop app whose whole pitch is that you
 * can see what it does. What is needed here is not a DOM: it is "give the model
 * roughly what the reader saw", and the model is about to be asked for nine
 * short fields out of it by another model that tolerates noise. So this is
 * ordered string work, and the order IS the behaviour — see the numbered steps
 * in `htmlToText`.
 *
 * ============================================================================
 * WHAT COMES OUT OF HERE IS UNTRUSTED, AND IS TREATED THAT WAY
 * ============================================================================
 * The bytes came from somebody else's server and they are going into a prompt.
 * That is the textbook prompt-injection surface, and it is not hypothetical: an
 * advert with "ignore all previous instructions" in white-on-white text costs
 * an attacker nothing. So the last thing this function does is run the result
 * through `sanitizeForPrompt`, the same defence the pasted-advert path uses —
 * `packages/cv-parsing/src/sanitize.ts` has the full account.
 *
 * ============================================================================
 * A PAGE THAT CAME BACK EMPTY IS A FAILURE, NOT AN EMPTY ADVERT
 * ============================================================================
 * The two commonest replies to a fetch of a big job board are a login wall and
 * a single-page app that is one empty div. Both arrive with a 200 status and
 * both look like a success to anything watching the network. `isPlausiblyReadable`
 * is what turns them back into failures, so the user gets the guided message
 * rather than a review form the model filled in from the words "Sign in".
 */
import { normalizeWhitespace, sanitizeWithStats } from '@cviper/cv-parsing';

import { MAX_DESCRIPTION_LENGTH } from './model';

/**
 * The shortest thing we will accept as an advert.
 *
 * A job advert with a title, a company, a location and three sentences of
 * description is comfortably past four hundred characters; a login wall
 * ("Sign in to see this job. Join now.") is nowhere near it, and a
 * JavaScript-only page is nearer forty.
 *
 * Being wrong in the strict direction costs the user one copy and paste, with a
 * message that tells them exactly that. Being wrong in the generous direction
 * costs them a model reading a cookie banner and a review form confidently full
 * of nonsense. So the line sits where the second mistake is the rarer one.
 *
 * What this does NOT catch, said out loud rather than discovered later: a
 * verbose consent interstitial or an error page with a lot of prose can clear
 * four hundred characters. Nothing length-based catches those, which is one
 * more reason every field still goes in front of the user before anything is
 * saved.
 */
export const MIN_READABLE_CHARS = 400;

/**
 * Elements removed WITH THEIR CONTENT.
 *
 * Two groups, both of which would otherwise end up in the prompt:
 *
 *   * `script`, `style`, `noscript`, `svg`, `template`, `iframe`, `canvas` —
 *     never visible text. A page's inline JavaScript is often bigger than its
 *     advert, and a minified bundle stripped of its tags is a wall of
 *     punctuation that would sail past any length check.
 *
 *   * `nav`, `header`, `footer`, `aside` — site chrome. The `aside` is the one
 *     that does real damage: it is usually a "similar jobs" rail, i.e. a
 *     different job at a different company, and the model has no way to know
 *     which of the two the user meant.
 *
 * The cost, stated rather than hidden: a site that marks the advert up as
 * `<article><header><h1>Job title</h1></header>…` loses its title here. The
 * title is then an empty box the user fills in — which is the app's rule for
 * anything it does not actually know — rather than a wrong one. Dropping a
 * page-level banner is the common case and this is the uncommon one.
 */
const DROP_OPENER =
  /<(script|style|noscript|svg|template|iframe|canvas|nav|header|footer|aside)\b[^>]*>/gi;

/*
 * ============================================================================
 * EVERY PASS IS LINEAR, BECAUSE THE INPUT IS HOSTILE (L-225)
 * ============================================================================
 * These steps used to be single regexes — `<nav…>[\s\S]*?</nav>`,
 * `<!--[\s\S]*?-->`, `<[^>]*>` — and each one goes quadratic on an opener with
 * no closer: the engine scans to the end of the input, fails, and retries one
 * character later. 500 KB of `<` took two minutes; Fetch accepts 5 MB, on the
 * UI thread. So each pass below either scans once with `indexOf`, or runs its
 * regex only where a match is still possible:
 *
 *   * A pattern that must END in `>` can only match before the last `>` in the
 *     text. `splitAtLastClose` cuts there, the regex runs on the head — where
 *     every `<` has a `>` after it and so every attempt succeeds or fails at
 *     once — and the tail is handled on its own.
 *   * A drop element whose closer is missing is remembered by name, so the
 *     next opener of that name does not go looking for it again.
 *
 * `htmlToText.hostile.test.ts` holds each shape to a time budget.
 */

/** Text up to and including its last `>`, and what follows it. */
function splitAtLastClose(text: string): readonly [string, string] {
  const end = text.lastIndexOf('>') + 1;
  return [text.slice(0, end), text.slice(end)];
}

/** `text.replace(pattern, …)` for a pattern whose every match ends in `>`. */
function replaceClosed(text: string, pattern: RegExp, replacement: string): string {
  const [head, tail] = splitAtLastClose(text);
  return head.replace(pattern, replacement) + tail;
}

/** `<!-- … -->` removed, each as one space. An unclosed one is left for later steps. */
function removeComments(html: string): string {
  let out = '';
  let from = 0;
  for (;;) {
    const open = html.indexOf('<!--', from);
    if (open === -1) break;
    // No `-->` after this one means none after any later one either: stop.
    const close = html.indexOf('-->', open + 4);
    if (close === -1) break;
    out += `${html.slice(from, open)} `;
    from = close + 3;
  }
  return out + html.slice(from);
}

/** The closing-tag pattern for one element name, built once. */
const CLOSERS = new Map<string, RegExp>();
function closerFor(name: string): RegExp {
  let closer = CLOSERS.get(name);
  if (closer === undefined) {
    closer = new RegExp(`</${name}\\s*>`, 'gi');
    CLOSERS.set(name, closer);
  }
  return closer;
}

/**
 * Every `DROP_OPENER` element removed with its content, each as one newline.
 *
 * An opener is paired with the NEXT closer of its own name, as the old lazy
 * regex did. One with no closer stays, to be stripped later as a plain tag.
 */
function dropWithContent(html: string): string {
  const [head, tail] = splitAtLastClose(html);
  const unclosed = new Set<string>();
  const opener = new RegExp(DROP_OPENER.source, 'gi');
  let out = '';
  let from = 0;

  for (let match = opener.exec(head); match !== null; match = opener.exec(head)) {
    const name = (match[1] ?? '').toLowerCase();
    if (unclosed.has(name)) continue;

    const closer = closerFor(name);
    closer.lastIndex = match.index + match[0].length;
    const close = closer.exec(head);
    if (close === null) {
      unclosed.add(name);
      // Retry one character on, once per name, as the regex would: an opener
      // tucked inside this one's attributes is still found.
      opener.lastIndex = match.index + 1;
      continue;
    }

    out += `${head.slice(from, match.index)}\n`;
    from = close.index + close[0].length;
    opener.lastIndex = from;
  }
  return out + head.slice(from) + tail;
}

/** Tags that start or end a line of reading. */
const BLOCK_TAGS =
  'p|div|section|article|main|li|ul|ol|dl|dt|dd|h[1-6]|tr|td|th|table|thead|tbody|blockquote|pre|figcaption|form|address|hr';

/**
 * The entity table.
 *
 * Not exhaustive, and does not need to be: what a job advert actually contains
 * is money, dashes, quotes and the occasional accent. An entity that is not
 * here is LEFT ALONE rather than deleted — a visible `&notarealentity;` in the
 * description is a smaller harm than a silently missing word, and the user is
 * looking at the box either way.
 */
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ensp: ' ',
  emsp: ' ',
  thinsp: ' ',
  shy: '',
  pound: '£',
  euro: '€',
  cent: '¢',
  yen: '¥',
  ndash: '–',
  mdash: '—',
  minus: '−',
  hellip: '…',
  bull: '•',
  middot: '·',
  lsquo: '‘',
  rsquo: '’',
  sbquo: '‚',
  ldquo: '“',
  rdquo: '”',
  bdquo: '„',
  laquo: '«',
  raquo: '»',
  copy: '©',
  reg: '®',
  trade: '™',
  deg: '°',
  plusmn: '±',
  times: '×',
  divide: '÷',
  frac12: '½',
  frac14: '¼',
  frac34: '¾',
  sup2: '²',
  sup3: '³',
  aacute: 'á',
  agrave: 'à',
  acirc: 'â',
  auml: 'ä',
  aring: 'å',
  aelig: 'æ',
  ccedil: 'ç',
  eacute: 'é',
  egrave: 'è',
  ecirc: 'ê',
  euml: 'ë',
  iacute: 'í',
  icirc: 'î',
  iuml: 'ï',
  ntilde: 'ñ',
  oacute: 'ó',
  ograve: 'ò',
  ocirc: 'ô',
  ouml: 'ö',
  oslash: 'ø',
  uacute: 'ú',
  ugrave: 'ù',
  ucirc: 'û',
  uuml: 'ü',
  szlig: 'ß',
};

/** Everything that looks like a character reference, named or numeric. */
const ANY_ENTITY = /&(#[0-9]+|#x[0-9a-f]+|[a-z][a-z0-9]*);/gi;

/** The largest code point there is. Anything past it is not a character. */
const MAX_CODE_POINT = 0x10ffff;

/**
 * One code point, or `null` if it is not something worth putting in text.
 *
 * C0 and C1 control characters are dropped rather than decoded: `&#0;` and
 * `&#13;` are not content, and a NUL in the middle of a prompt is the sort of
 * thing that breaks a tokeniser rather than a model's understanding. Tab and
 * newline are kept, because they are layout.
 */
function fromCodePoint(code: number): string | null {
  if (!Number.isInteger(code) || code < 0 || code > MAX_CODE_POINT) return null;
  // Surrogate halves are not characters on their own and corrupt any
  // re-encoding they survive into.
  if (code >= 0xd800 && code <= 0xdfff) return null;
  const isControl =
    (code < 0x20 && code !== 0x09 && code !== 0x0a) || (code >= 0x7f && code <= 0x9f);
  if (isControl) return '';
  return String.fromCodePoint(code);
}

/**
 * Decode character references in ONE pass.
 *
 * One pass is the whole point. A decoder that ran twice would turn `&amp;lt;`
 * — a page displaying the literal text `&lt;` — into `<`, manufacturing markup
 * out of something that never had any. Running once leaves `&` followed by the
 * literal `lt;`, which is exactly what the reader saw.
 */
function decodeEntities(text: string): string {
  return text.replace(ANY_ENTITY, (whole: string, reference: string): string => {
    if (reference.startsWith('#')) {
      const isHex = reference[1] === 'x' || reference[1] === 'X';
      const digits = isHex ? reference.slice(2) : reference.slice(1);
      const code = Number.parseInt(digits, isHex ? 16 : 10);
      const decoded = fromCodePoint(code);
      return decoded === null ? whole : decoded;
    }

    // Named references are case-sensitive in HTML, and the ones a job advert
    // uses are all lower case. An unknown name comes back untouched.
    const named = NAMED_ENTITIES[reference.toLowerCase()];
    return named === undefined ? whole : named;
  });
}

/**
 * A page of HTML, as readable text.
 *
 * The steps run in this order and the order matters:
 *
 *   1. comments go first, so anything parked inside one — including a whole
 *      `<script>` — never reaches the later steps;
 *   2. the drop-with-content elements go next, so their bodies are gone BEFORE
 *      tags are stripped and their JavaScript cannot survive as text;
 *   3. block boundaries become newlines, while there are still tags to read
 *      them from;
 *   4. every remaining tag becomes a SPACE, not nothing — `<b>£45k</b><span>
 *      to</span>` must not come out as one word;
 *   5. entities are decoded AFTER the tags are gone, so a page showing an
 *      escaped `&lt;script&gt;` cannot decode into something tag-shaped;
 *   6. whitespace is normalised with the app's existing helper;
 *   7. and the result — untrusted text bound for a prompt — goes through
 *      `sanitizeForPrompt`.
 */
export function htmlToText(html: string): string {
  return htmlToTextBounded(html).text;
}

/**
 * `htmlToText`, and whether the page was longer than a saved description can be
 * (`MAX_DESCRIPTION_LENGTH`) and so was cut to its start. The caller shows that
 * to the person: a silent cut of a long advert is a requirement they never saw.
 */
export function htmlToTextBounded(html: string): {
  readonly text: string;
  readonly capped: boolean;
} {
  const withoutComments = removeComments(html);

  const withoutNoise = dropWithContent(withoutComments);

  const withBreaks = replaceClosed(
    replaceClosed(
      replaceClosed(withoutNoise, /<br\s*\/?>/gi, '\n'),
      new RegExp(`</(?:${BLOCK_TAGS})\\s*>`, 'gi'),
      '\n',
    ),
    new RegExp(`<(?:${BLOCK_TAGS})\\b[^>]*>`, 'gi'),
    '\n',
  );

  // An unclosed tag at the end of a truncated page would otherwise survive as
  // visible text, so the final `<` with no `>` after it goes too. Every `<`
  // before the last `>` is a closed tag; only the tail can hold the unclosed one.
  const [head, tail] = splitAtLastClose(withBreaks);
  const withoutTags = head.replace(/<[^>]*>/g, ' ') + tail.replace(/<[^>]*$/, ' ');

  // ONE newline per boundary. Adjacent blocks emit two — a closing tag's and
  // the next opening tag's — and keeping both would put a blank line between
  // every single `<li>`, which is most of a job advert. HTML does not say which
  // of its boundaries were meant as paragraph breaks and which were merely
  // markup, so this stops guessing: the advert comes out as a sequence of
  // lines, which is also what copying it out of a browser gives you.
  const oneBreakPerBoundary = withoutTags.replace(/\n[ \t]*(?:\n[ \t]*)+/g, '\n');

  // Bounded at what a saved description may hold, not at the prompt default: the
  // text is stored whole and only cut to a field budget when a prompt is built.
  const { text, capped } = sanitizeWithStats(
    normalizeWhitespace(decodeEntities(oneBreakPerBoundary)),
    MAX_DESCRIPTION_LENGTH,
  );
  return { text, capped };
}

/**
 * Every `<script type="application/ld+json">` body on the page (L-190).
 *
 * Quoted, single-quoted or bare attribute values all occur in the wild, and the
 * attribute can sit anywhere in the tag. Read from the RAW page, before
 * `htmlToText` runs, because step 2 of that function drops every `<script>`
 * with its content — which is right for JavaScript and would throw this away.
 */
const SCRIPT_OPENER = /<script\b[^>]*>/gi;
const JSON_LD_TYPE = /\btype\s*=\s*["']?application\/ld\+json["']?/i;

/**
 * The body of every structured-data script, in page order.
 *
 * A scan, not one regex, for the reason above `splitAtLastClose`: the old
 * `<script…ld+json…>([\s\S]*?)</script>` went quadratic on openers with no
 * closer. Every `<script>` tag is matched once and its type checked on the
 * tag's own text; the first one with no `</script>` after it ends the search,
 * because none after it can have one either.
 */
function jsonLdBodies(html: string): string[] {
  const [head] = splitAtLastClose(html);
  const opener = new RegExp(SCRIPT_OPENER.source, 'gi');
  const closer = /<\/script\s*>/gi;
  const bodies: string[] = [];

  for (let match = opener.exec(head); match !== null; match = opener.exec(head)) {
    const bodyStart = match.index + match[0].length;
    closer.lastIndex = bodyStart;
    const close = closer.exec(head);
    if (close === null) break;
    if (JSON_LD_TYPE.test(match[0])) bodies.push(head.slice(bodyStart, close.index));
    opener.lastIndex = close.index + close[0].length;
  }
  return bodies;
}

/**
 * How deep the structured-data walk goes before it gives up.
 *
 * A real page nests a posting two or three levels down (`@graph` → array →
 * object). The limit exists so a hostile page with a ten-thousand-deep array
 * costs a few microseconds rather than the call stack.
 */
const MAX_JSON_LD_DEPTH = 8;

/** Escaped markup — `&lt;p&gt;` — in a description that has no real tags at all. */
const ESCAPED_TAG = /&lt;\/?[a-z]/i;
const REAL_TAG = /<\/?[a-z][^>]*>/i;

function isJobPostingType(type: unknown): boolean {
  const named = (value: unknown): boolean =>
    typeof value === 'string' &&
    (value === 'JobPosting' || value.endsWith('/JobPosting') || value.endsWith(':JobPosting'));
  return Array.isArray(type) ? type.some(named) : named(type);
}

/** The first JobPosting object in a parsed block, looking through arrays and `@graph`. */
function findJobPosting(node: unknown, depth: number): Record<string, unknown> | null {
  if (depth > MAX_JSON_LD_DEPTH || typeof node !== 'object' || node === null) return null;

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findJobPosting(item, depth + 1);
      if (found !== null) return found;
    }
    return null;
  }

  const record = node as Record<string, unknown>;
  if (isJobPostingType(record['@type'])) return record;
  return findJobPosting(record['@graph'], depth + 1);
}

/** The employer's name, whether it is published as an object or a bare string. */
function organisationName(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const name = (value as Record<string, unknown>)['name'];
    if (typeof name === 'string') return name;
  }
  return '';
}

/**
 * The advert out of the page's `JobPosting` structured data, or `null`.
 *
 * ============================================================================
 * WHY THIS COMES BEFORE THE WHOLE-PAGE READ (L-190)
 * ============================================================================
 * Most job boards publish the whole advert as schema.org `JobPosting` data so
 * search engines can show it: the title, the employer and the full description,
 * with none of the page around it. The page around it is exactly what
 * `htmlToText` has to guess its way past — navigation, cookie banners, and the
 * "similar jobs" rail that is a DIFFERENT job at a different company. When the
 * structured data is there, it is the advert the site itself says it is.
 *
 * Returns `null`, never a partial answer, when there is no posting or it has no
 * description: a title on its own is not an advert, and the caller's fallback
 * (the whole page) is the better guess then.
 *
 * ============================================================================
 * STILL UNTRUSTED, STILL SANITISED
 * ============================================================================
 * Structured data came from the same somebody-else's server as the page, and
 * goes into the same prompt. The pieces are assembled into a small HTML
 * fragment and sent through `htmlToText` ONCE — so a script smuggled into the
 * description is dropped with its content, and `sanitizeForPrompt` sees the
 * whole text in one pass rather than three separately-cleaned pieces glued
 * together afterwards.
 *
 * A description whose markup arrived ESCAPED (`&lt;p&gt;…`, common in the wild)
 * is unescaped once first, and only when it has no real tags of its own.
 * `htmlToText` deliberately decodes entities once, after tags are gone, so
 * escaped markup would otherwise reach the model as literal `<p>` text. Doing
 * it here does "manufacture markup", which that function's comment warns about
 * — but the markup it makes is then stripped by the same pass, which is the
 * point: schema.org defines `description` as HTML.
 */
export function jobPostingText(html: string): string | null {
  for (const body of jsonLdBodies(html)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      // A malformed block is one site's bug, not a reason to stop looking —
      // pages often carry several blocks and only one of them is the posting.
      continue;
    }

    const posting = findJobPosting(parsed, 0);
    if (posting === null) continue;

    const raw = posting['description'];
    if (typeof raw !== 'string' || raw.trim() === '') continue;

    const description =
      !REAL_TAG.test(raw) && ESCAPED_TAG.test(raw)
        ? raw.replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
        : raw;
    const title = typeof posting['title'] === 'string' ? posting['title'] : '';
    const employer = organisationName(posting['hiringOrganization']);

    const text = htmlToText(`<p>${title}</p><p>${employer}</p><div>${description}</div>`);
    if (text !== '') return text;
  }
  return null;
}

/**
 * Was there actually an advert on that page?
 *
 * Length after trimming, because a page of nothing but layout whitespace is a
 * page of nothing. See `MIN_READABLE_CHARS` for where the line is and what it
 * does not catch.
 */
export function isPlausiblyReadable(text: string): boolean {
  return text.trim().length >= MIN_READABLE_CHARS;
}
