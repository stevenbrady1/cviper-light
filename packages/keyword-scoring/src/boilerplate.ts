/**
 * Strip boilerplate from a job advert before anything reads it (L-205).
 *
 * A pasted or fetched advert often arrives wrapped in a cookie banner, an
 * equal-opportunities statement and a recruitment agency's legal footer. None of
 * it describes the job, and all of it is words: it pads the keyword matcher's
 * denominator and it costs a model tokens. This removes it, when it is there.
 *
 * ============================================================================
 * CONSERVATIVE, ON PURPOSE
 * ============================================================================
 * Deleting a real requirement, salary or location line is far worse than
 * leaving a banner in. So:
 *
 *  - Matching is per BLOCK (a paragraph, or a line when the paste has few blank
 *    lines), never per phrase, so a sentence is never cut out of a paragraph.
 *  - A block must carry a STRONG signal ("accept all cookies", "equal
 *    opportunities employer", "acting as an employment agency"). The bare word
 *    "cookies" or "equal" never qualifies.
 *  - Only blocks near the top (cookie notices, navigation) or the bottom
 *    (everything else) are candidates. The middle of an advert is never touched.
 *  - A block that also carries a content marker (a pound sign, "requirements",
 *    "you will", "salary" ...) is kept.
 *  - Long blocks are never candidates.
 *  - If stripping would leave almost nothing, the original comes back. The
 *    result is never empty for non-empty input.
 *
 * No regular expression runs over the input. Splitting is `split('\n')` and
 * detection is `includes` against short lowercase phrases on candidate blocks
 * only, so the cost is linear and there is nothing to backtrack.
 *
 * Pure and deterministic. Callers keep the raw text for storage and display and
 * pass only the analysis input through this.
 */

/** A block longer than this is real prose, not a notice. */
const MAX_BLOCK_CHARS = 1200;

/** Fewer than this many characters left means we over-stripped: give up. */
const MIN_REMAINING_CHARS = 100;

/** ...or less than this share of the original. */
const MIN_REMAINING_SHARE = 0.15;

/** Below this many paragraphs the paste is treated line by line. */
const MIN_PARAGRAPHS_FOR_BLOCK_MODE = 3;

const HEADER_MIN_UNITS = 2;
const HEADER_SHARE = 0.25;
const FOOTER_MIN_UNITS = 3;
const FOOTER_SHARE = 0.35;

/** Cookie notices: needs the word AND a banner-shaped phrase. */
const COOKIE_WORD = 'cookie';
const COOKIE_PHRASES: readonly string[] = [
  'accept all',
  'accept cookies',
  'we use cookies',
  'uses cookies',
  'use cookies to',
  'cookie settings',
  'cookie preferences',
  'cookie policy',
  'cookie notice',
  'manage cookies',
  'manage your cookie',
  'reject all',
  'reject cookies',
];

/** Equal-opportunity and diversity statements. */
const EO_PHRASES: readonly string[] = [
  'equal opportunity employer',
  'equal opportunities employer',
  'equal opportunity policy',
  'equal opportunities policy',
  'equal opportunities statement',
  'committed to equal opportunit',
  'regardless of race',
  'regardless of age',
  'regardless of gender',
  'protected characteristic',
  'does not discriminate',
  'do not discriminate',
  'celebrate diversity',
  'diverse and inclusive',
  'diversity and inclusion statement',
  'welcome applications from',
  'welcomes applications from',
];

/** Recruitment-agency and data-protection footers. */
const AGENCY_PHRASES: readonly string[] = [
  'acting as an employment agency',
  'acts as an employment agency',
  'acting as an employment business',
  'acts as an employment business',
  'we are an employment agency',
  'we are an employment business',
  'is an employment agency',
  'is an employment business',
  'registered in england',
  'registered in scotland',
  'registered in wales',
  'registered office',
  'company registration number',
  'company number',
  'unable to respond to all',
  'unable to reply to all',
  'high volume of applications',
  'if you have not heard back',
  'if you do not hear from us',
  'if you have not heard from us',
  'unsuccessful on this occasion',
  'by applying you agree',
  'by applying, you agree',
  'by submitting your application you',
];

/** Navigation chrome copied with the page: whole short lines, exact. */
const CHROME_LINES: ReadonlySet<string> = new Set([
  'skip to main content',
  'skip to content',
  'back to search',
  'back to search results',
  'back to results',
  'back to jobs',
  'share this job',
  'report this job',
  'save this job',
]);

/** Short headings that introduce a boilerplate paragraph. */
const BOILERPLATE_HEADINGS: ReadonlySet<string> = new Set([
  'equal opportunities',
  'equal opportunity',
  'equal opportunities statement',
  'equal opportunity employer',
  'equal opportunities employer',
  'diversity and inclusion',
  'diversity & inclusion',
  'diversity, equity and inclusion',
  'our commitment to diversity',
  'cookie policy',
  'cookies',
  'privacy notice',
  'privacy policy',
  'data protection',
  'disclaimer',
  'important information',
]);

/**
 * Anything that makes a block part of the advert itself. A block carrying one
 * is kept whatever else it says.
 */
const CONTENT_MARKERS: readonly string[] = [
  '£',
  '$',
  '€',
  'salary',
  'per annum',
  'day rate',
  'responsibilit',
  'requirement',
  'you will',
  'you have',
  'you must',
  'essential',
  'must have',
  'experience of',
  'experience in',
  'years of',
  'qualification',
  'skills',
  'benefits',
  'location',
];

const HEADING_MAX_CHARS = 50;

function fold(block: string): string {
  return block.toLowerCase().replace(/[‘’]/g, "'");
}

function hasAny(text: string, phrases: readonly string[]): boolean {
  for (const phrase of phrases) {
    if (text.includes(phrase)) return true;
  }
  return false;
}

type Region = 'header' | 'footer' | 'both' | 'middle';

/** Is this block a boilerplate notice, given where it sits? */
function isBoilerplate(block: string, region: Region): boolean {
  if (region === 'middle') return false;
  const trimmed = block.trim();
  if (trimmed === '' || trimmed.length > MAX_BLOCK_CHARS) return false;

  const text = fold(trimmed);
  const inHeader = region === 'header' || region === 'both';
  const inFooter = region === 'footer' || region === 'both';

  if (CHROME_LINES.has(text.replace(/[.:]+$/, ''))) return true;

  if (hasAny(text, CONTENT_MARKERS)) return false;

  if (text.includes(COOKIE_WORD) && hasAny(text, COOKIE_PHRASES)) {
    return inHeader || inFooter;
  }
  if (inFooter || inHeader) {
    if (hasAny(text, EO_PHRASES)) return true;
    if (inFooter && hasAny(text, AGENCY_PHRASES)) return true;
  }
  return false;
}

function isHeading(block: string): boolean {
  const trimmed = block.trim();
  if (trimmed === '' || trimmed.length > HEADING_MAX_CHARS) return false;
  return BOILERPLATE_HEADINGS.has(fold(trimmed).replace(/[:.]+$/, ''));
}

/** Split into paragraphs: runs of non-blank lines. */
function paragraphsOf(lines: readonly string[]): string[] {
  const out: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (line.trim() === '') {
      if (current.length > 0) out.push(current.join('\n'));
      current = [];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) out.push(current.join('\n'));
  return out;
}

function regionOf(index: number, count: number): Region {
  const headerSize = Math.max(HEADER_MIN_UNITS, Math.ceil(count * HEADER_SHARE));
  const footerSize = Math.max(FOOTER_MIN_UNITS, Math.ceil(count * FOOTER_SHARE));
  const inHeader = index < headerSize;
  const inFooter = index >= count - footerSize;
  if (inHeader && inFooter) return 'both';
  if (inHeader) return 'header';
  if (inFooter) return 'footer';
  return 'middle';
}

/**
 * The advert with its boilerplate removed - or the advert itself, unchanged,
 * when none is detected, when it is empty, or when stripping would leave
 * almost nothing.
 */
export function stripJobBoilerplate(text: string): string {
  if (typeof text !== 'string' || text.trim() === '') return text;

  const lines = text.split('\n').map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
  const paragraphs = paragraphsOf(lines);
  const blockMode = paragraphs.length >= MIN_PARAGRAPHS_FOR_BLOCK_MODE;
  const units = blockMode ? paragraphs : lines.filter((line) => line.trim() !== '');
  if (units.length < 2) return text;

  const drop: boolean[] = units.map((unit, i) => isBoilerplate(unit, regionOf(i, units.length)));

  // A heading goes only when the block it introduces goes.
  for (let i = 0; i < units.length - 1; i += 1) {
    if (!drop[i] && drop[i + 1] && isHeading(units[i] as string)) drop[i] = true;
  }

  if (!drop.includes(true)) return text;

  const kept = units.filter((_, i) => !drop[i]);
  const result = kept.join(blockMode ? '\n\n' : '\n').trim();

  const original = text.trim().length;
  if (result.length < MIN_REMAINING_CHARS || result.length < original * MIN_REMAINING_SHARE) {
    return text;
  }
  return result;
}
