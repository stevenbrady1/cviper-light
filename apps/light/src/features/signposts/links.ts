/**
 * Every address a signpost or the About entry may hand to the browser (L-87).
 *
 * Constants, not configuration: the outbound-hosts guard reads these literals
 * and holds them to `lib/outbound-hosts.ts`, so a link to a host the privacy
 * notice does not list cannot ship. Nothing is appended to any of them — no
 * `utm_`, no version, no install id (`platform/browser.ts`).
 */

/** The full CViper. Where the analysis and tracker signposts point. */
export const CVIPER_URL = 'https://cviper.ai/';

/** What the full CViper keeps. Where the Settings → Privacy signpost points. */
export const CVIPER_PRIVACY_URL = 'https://cviper.ai/?tab=privacy';

/** The page about this app: downloads, the generated policy, the source. */
export const LIGHT_PAGE_URL = 'https://cviper.ai/light';

/** The public source, MIT-licensed. */
export const LIGHT_SOURCE_URL = 'https://github.com/stevenbrady1/cviper-light';
