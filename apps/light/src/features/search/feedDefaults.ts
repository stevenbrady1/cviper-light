/**
 * Which free feeds a search reads by default (L-219).
 *
 * Arbeitnow is mostly Germany and the rest of Europe. For a search in the UK
 * it mostly adds noise, so it starts switched OFF when the location is
 * recognisably in the UK — a UK city or town, a county or nation, a postcode,
 * or "UK" itself (owner decision, 2026-10-08). A blank location, or one
 * outside the UK, keeps it on. Guardian Jobs is UK and stays on.
 *
 * A tick or untick the user makes is theirs: it wins over the default from
 * then on, and is remembered across restarts in a small store of its own.
 */
import { KEYLESS_SOURCE_IDS, type KeylessSourceId } from '@cviper/job-apis';

export const FEED_CHOICE_KEY = 'cviper.light.search.feeds';

/** What the user ticked or unticked themselves. Absent: no choice made. */
export type FeedChoice = Readonly<Partial<Record<KeylessSourceId, boolean>>>;

/**
 * Places that mean "the UK" on their own: nations, the largest cities and
 * towns, and the counties and regions people type after a town. Not a
 * gazetteer — a town that is missing only keeps Arbeitnow on, which is how
 * the screen behaved before.
 */
const UK_PLACES: ReadonlySet<string> = new Set([
  'uk',
  'u.k',
  'united kingdom',
  'great britain',
  'britain',
  'gb',
  'england',
  'scotland',
  'wales',
  'northern ireland',
  'london',
  'greater london',
  'city of london',
  'westminster',
  'canary wharf',
  'croydon',
  'birmingham',
  'manchester',
  'greater manchester',
  'leeds',
  'glasgow',
  'sheffield',
  'bradford',
  'liverpool',
  'edinburgh',
  'bristol',
  'cardiff',
  'leicester',
  'coventry',
  'belfast',
  'nottingham',
  'newcastle',
  'newcastle upon tyne',
  'sunderland',
  'brighton',
  'hull',
  'plymouth',
  'stoke',
  'stoke-on-trent',
  'wolverhampton',
  'derby',
  'swansea',
  'southampton',
  'salford',
  'aberdeen',
  'westminster',
  'portsmouth',
  'york',
  'peterborough',
  'dundee',
  'lancaster',
  'oxford',
  'newport',
  'preston',
  'st albans',
  'norwich',
  'chester',
  'cambridge',
  'salisbury',
  'exeter',
  'gloucester',
  'lisburn',
  'chichester',
  'winchester',
  'londonderry',
  'derry',
  'carlisle',
  'worcester',
  'bath',
  'durham',
  'lincoln',
  'hereford',
  'armagh',
  'inverness',
  'stirling',
  'canterbury',
  'lichfield',
  'newry',
  'ripon',
  'bangor',
  'truro',
  'ely',
  'wakefield',
  'wells',
  'milton keynes',
  'reading',
  'slough',
  'luton',
  'northampton',
  'swindon',
  'bournemouth',
  'poole',
  'middlesbrough',
  'huddersfield',
  'ipswich',
  'blackpool',
  'bolton',
  'stockport',
  'watford',
  'guildford',
  'woking',
  'basingstoke',
  'crawley',
  'maidstone',
  'colchester',
  'chelmsford',
  'southend',
  'warrington',
  'telford',
  'cheltenham',
  'harrogate',
  'doncaster',
  'rotherham',
  'barnsley',
  'gateshead',
  'birkenhead',
  'wigan',
  'oldham',
  'rochdale',
  'blackburn',
  'burnley',
  'high wycombe',
  'aylesbury',
  'bedford',
  'stevenage',
  'hemel hempstead',
  'harlow',
  'farnborough',
  'reigate',
  'redhill',
  'sevenoaks',
  'tunbridge wells',
  'eastbourne',
  'hastings',
  'worthing',
  'bracknell',
  'maidenhead',
  'newbury',
  'leamington spa',
  'solihull',
  'dudley',
  'walsall',
  'west bromwich',
  'kettering',
  'corby',
  'mansfield',
  'grimsby',
  'scunthorpe',
  'darlington',
  'hartlepool',
  'stockton-on-tees',
  'livingston',
  'paisley',
  'kilmarnock',
  'falkirk',
  'perth',
  'wrexham',
  'greater london',
  'surrey',
  'kent',
  'essex',
  'sussex',
  'east sussex',
  'west sussex',
  'hampshire',
  'berkshire',
  'buckinghamshire',
  'hertfordshire',
  'oxfordshire',
  'bedfordshire',
  'cambridgeshire',
  'norfolk',
  'suffolk',
  'yorkshire',
  'west yorkshire',
  'south yorkshire',
  'north yorkshire',
  'east yorkshire',
  'lancashire',
  'merseyside',
  'cheshire',
  'derbyshire',
  'nottinghamshire',
  'leicestershire',
  'lincolnshire',
  'staffordshire',
  'warwickshire',
  'west midlands',
  'east midlands',
  'midlands',
  'worcestershire',
  'shropshire',
  'herefordshire',
  'gloucestershire',
  'wiltshire',
  'somerset',
  'dorset',
  'devon',
  'cornwall',
  'cumbria',
  'northumberland',
  'tyne and wear',
  'county durham',
  'northamptonshire',
  'rutland',
  'isle of wight',
  'south east',
  'south west',
  'north east',
  'north west',
  'east anglia',
  'home counties',
]);

/**
 * Places elsewhere whose names hold a UK one — New York holds York — and
 * country names that settle it. A part naming one of these is not the UK.
 */
const NOT_UK: ReadonlySet<string> = new Set([
  'new york',
  'new england',
  'new south wales',
  'new hampshire',
  'ontario',
  'australia',
  'canada',
  'usa',
  'united states',
  'america',
  'new zealand',
  'ireland',
  'perth wa',
]);

/** A full postcode (`SW1A 1AA`) or just its first half (`EC2`, `M1`). */
const POSTCODE = /^[a-z]{1,2}\d[a-z\d]?(\s*\d[a-z]{2})?$/;

/** True when the location is recognisably in the UK. Blank is not. */
export function isUkLocation(location: string): boolean {
  const parts = location
    .toLowerCase()
    .split(',')
    .map((part) =>
      part
        .replace(/[^a-z0-9\s.-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter((part) => part !== '');

  // Every run of one to three whole words in a part: "Greater London",
  // "Leeds city centre". Whole words only — "Londoners" is not London.
  const phrases = (part: string): string[] => {
    const words = part.split(' ');
    const found: string[] = [];
    for (let length = 3; length >= 1; length -= 1) {
      for (let start = 0; start + length <= words.length; start += 1) {
        found.push(words.slice(start, start + length).join(' '));
      }
    }
    return found;
  };

  // Across the commas too: "Perth, WA" is one place.
  if (phrases(parts.join(' ')).some((phrase) => NOT_UK.has(phrase))) return false;
  return parts.some(
    (part) => POSTCODE.test(part) || phrases(part).some((phrase) => UK_PLACES.has(phrase)),
  );
}

/** The feeds a search reads: the user's own choice where there is one, the default elsewhere. */
export function chosenFeeds(choice: FeedChoice, location: string): ReadonlySet<KeylessSourceId> {
  const uk = isUkLocation(location);
  return new Set(
    KEYLESS_SOURCE_IDS.filter((source) => choice[source] ?? (source === 'arbeitnow' ? !uk : true)),
  );
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    // Storage switched off: the user loses a remembered tick, not a search.
    return null;
  }
}

/** What the user chose before. Anything unreadable is no choice at all. */
export function readFeedChoice(): FeedChoice {
  const store = storage();
  if (store === null) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(store.getItem(FEED_CHOICE_KEY) ?? '{}');
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record);
  const valid = keys.every(
    (key) =>
      (KEYLESS_SOURCE_IDS as readonly string[]).includes(key) && typeof record[key] === 'boolean',
  );
  return valid ? (record as FeedChoice) : {};
}

/** Record a tick or untick the user made, and return the new choice. */
export function rememberFeedChoice(
  choice: FeedChoice,
  source: KeylessSourceId,
  on: boolean,
): FeedChoice {
  const next: FeedChoice = { ...choice, [source]: on };
  try {
    storage()?.setItem(FEED_CHOICE_KEY, JSON.stringify(next));
  } catch {
    // Storage full or switched off: the choice holds for this session.
  }
  return next;
}
