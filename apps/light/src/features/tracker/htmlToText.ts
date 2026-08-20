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
import { normalizeWhitespace, sanitizeForPrompt } from '@cviper/cv-parsing';

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
const DROP_WITH_CONTENT =
  /<(script|style|noscript|svg|template|iframe|canvas|nav|header|footer|aside)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

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
  const isControl = (code < 0x20 && code !== 0x09 && code !== 0x0a) || (code >= 0x7f && code <= 0x9f);
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
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, ' ');

  const withoutNoise = withoutComments.replace(DROP_WITH_CONTENT, '\n');

  const withBreaks = withoutNoise
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(new RegExp(`</(?:${BLOCK_TAGS})\\s*>`, 'gi'), '\n')
    .replace(new RegExp(`<(?:${BLOCK_TAGS})\\b[^>]*>`, 'gi'), '\n');

  // An unclosed tag at the end of a truncated page would otherwise survive as
  // visible text, so the final `<` with no `>` after it goes too.
  const withoutTags = withBreaks.replace(/<[^>]*>/g, ' ').replace(/<[^>]*$/, ' ');

  // ONE newline per boundary. Adjacent blocks emit two — a closing tag's and
  // the next opening tag's — and keeping both would put a blank line between
  // every single `<li>`, which is most of a job advert. HTML does not say which
  // of its boundaries were meant as paragraph breaks and which were merely
  // markup, so this stops guessing: the advert comes out as a sequence of
  // lines, which is also what copying it out of a browser gives you.
  const oneBreakPerBoundary = withoutTags.replace(/\n[ \t]*(?:\n[ \t]*)+/g, '\n');

  return sanitizeForPrompt(normalizeWhitespace(decodeEntities(oneBreakPerBoundary)));
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
