/**
 * Turning provider text into something the app can store and show.
 *
 * Job adverts arrive as markup. Reed's `jobDescription` is HTML that has been
 * entity-escaped on the way out, so it reaches us as `&lt;p&gt;` rather than
 * `<p>`; Adzuna's `description` is a plain-text snippet that still contains the
 * occasional `&amp;`. Neither is safe to store as-is, because the description
 * is later fed to a language model and compared against other descriptions for
 * duplicate detection — and `&amp;` versus `&` must not make two identical
 * adverts look different.
 */

/**
 * The most description we keep, in characters.
 *
 * Long enough for a full advert (the longest in a 200-advert sample was ~5,500
 * characters) and short enough that a hostile or broken feed cannot put a
 * megabyte per row into the user's SQLite file. The original stored 4,000,
 * which visibly truncated real London banking adverts mid-requirement.
 */
export const DESCRIPTION_MAX_CHARS = 8000;

/**
 * A letter is REQUIRED after the optional slash.
 *
 * `<[^>]*>` would also match "<100k but >" in the unescaped text of
 * "salary &lt;100k but &gt;80k", swallowing the salary range — a common
 * phrasing in job descriptions. (Same regex, same reason, as the fingerprint
 * normaliser; see `fingerprint.ts`.)
 */
const TAG = /<\/?[a-zA-Z][^>]*>/g;

/** One pass over every entity, so `&amp;pound;` cannot decode twice. */
const ENTITY = /&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g;

const MAX_CODE_POINT = 0x10ffff;

/**
 * The named entities that actually turn up in UK job adverts.
 *
 * Python's `html.unescape` knows the full HTML5 list of ~2,200 names. This
 * knows a curated few dozen, and an unrecognised name is LEFT EXACTLY AS FOUND
 * — which is also what Python does for a name it does not know, so the two
 * agree on everything in this table and on everything neither can decode. The
 * gap is a name Python knows and this does not; the practical set for a job
 * advert is currency, quotes, dashes and `&`, and they are all here.
 */
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
  pound: '£',
  euro: '€',
  cent: '¢',
  yen: '¥',
  copy: '©',
  reg: '®',
  trade: '™',
  deg: '°',
  plusmn: '±',
  frac12: '½',
  frac14: '¼',
  frac34: '¾',
  times: '×',
  divide: '÷',
  middot: '·',
  bull: '•',
  hellip: '…',
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
  sbquo: '‚',
  bdquo: '„',
  dagger: '†',
  Dagger: '‡',
  permil: '‰',
  prime: '′',
  Prime: '″',
  eacute: 'é',
  egrave: 'è',
  agrave: 'à',
  ccedil: 'ç',
  uuml: 'ü',
  ouml: 'ö',
  auml: 'ä',
  szlig: 'ß',
  ntilde: 'ñ',
  aacute: 'á',
  iacute: 'í',
  oacute: 'ó',
  uacute: 'ú',
};

function decodeCodePoint(digits: string, radix: 10 | 16): string | null {
  const value = Number.parseInt(digits, radix);
  // `Number.parseInt` cannot fail here (the regex guaranteed the digits), but
  // the range check is real: `String.fromCodePoint` THROWS on anything above
  // 0x10FFFF, and a broken feed is exactly where such a number comes from.
  if (!Number.isFinite(value) || value < 0 || value > MAX_CODE_POINT) return null;
  try {
    return String.fromCodePoint(value);
  } catch {
    // Lone surrogates (0xD800-0xDFFF) are in range and still refused.
    return null;
  }
}

/**
 * Decode HTML entities, leaving anything unrecognised exactly as found.
 *
 * ONE PASS. `&amp;pound;` is the literal text "&pound;" and decodes to
 * "&pound;", not to "£" — re-running the decoder until it stops changing would
 * quietly turn escaped text back into markup.
 */
export function unescapeHtmlEntities(text: string): string {
  return text.replace(ENTITY, (whole, body: string) => {
    if (body.startsWith('#')) {
      const hex = body[1] === 'x' || body[1] === 'X';
      const decoded = hex ? decodeCodePoint(body.slice(2), 16) : decodeCodePoint(body.slice(1), 10);
      return decoded ?? whole;
    }
    return NAMED_ENTITIES[body] ?? whole;
  });
}

/**
 * Provider description -> the `Job.description` column, or `null`.
 *
 * Entities are decoded FIRST so `&lt;p&gt;` becomes a tag that the tag stripper
 * can then remove; a description that arrived with real tags is handled by the
 * same pass. Whitespace is collapsed because stripping a `</li>` leaves a hole
 * where a line break used to be.
 *
 * `null` rather than `''` for an empty result: the model's absent value is
 * `null`, and an empty string is a different claim — "this advert has a
 * description, and it is blank".
 */
export function normaliseDescription(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;

  const text = unescapeHtmlEntities(raw).replace(TAG, ' ').replace(/\s+/g, ' ').trim();
  if (text === '') return null;

  return text.length > DESCRIPTION_MAX_CHARS ? text.slice(0, DESCRIPTION_MAX_CHARS) : text;
}

/** `YYYY-MM-DD`, and nothing that merely starts like one. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A provider date field -> `Job.posted_date`, or `null`.
 *
 * Providers send `2026-08-19T09:00:00Z` (Adzuna), `2026-08-19T00:00:00`
 * (Reed) and occasionally a space instead of the `T`. All three are the same
 * calendar day, and the data model stores calendar days as `YYYY-MM-DD`
 * strings — never a `Date`, which does not survive a JSON round-trip as a
 * `Date` and has no SQLite type at all.
 *
 * Anything else is `null`. `JobSchema` validates this field with
 * `z.iso.date()` on import, so a value that is not a real date would fail the
 * user's own backup file later rather than here.
 */
export function toIsoDateOrNull(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;

  const [head] = raw.trim().split(/[T ]/);
  if (head === undefined || !ISO_DATE.test(head)) return null;

  // `Date.parse` accepts `2026-02-30` on some engines by rolling it forward.
  // Round-tripping catches that: a date that does not survive is not a date.
  const time = Date.parse(`${head}T00:00:00.000Z`);
  if (Number.isNaN(time)) return null;

  return new Date(time).toISOString().slice(0, 10) === head ? head : null;
}
