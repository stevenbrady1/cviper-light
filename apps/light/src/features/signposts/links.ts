/**
 * Every address a signpost or the About entry may hand to the browser (L-87).
 *
 * Constants, not configuration: the outbound-hosts guard reads these literals
 * and holds them to `lib/outbound-hosts.ts`, so a link to a host the privacy
 * notice does not list cannot ship. Nothing is appended to any of them — no
 * `utm_`, no version, no install id (`platform/browser.ts`).
 *
 * `CVIPER_URL` — the root of the site, where the analysis and tracker
 * signposts used to point — was removed with those signposts (L-114). It
 * described a hosted product that no longer exists.
 */

/**
 * This app's own privacy policy, published from `docs/app-store/privacy-policy.md`.
 * Where the Settings → Privacy signpost points. The trailing slash is the
 * canonical form the site serves.
 */
export const CVIPER_PRIVACY_URL = 'https://cviper.ai/privacy/';

/** The page about this app: downloads, the generated policy, the source. */
export const LIGHT_PAGE_URL = 'https://cviper.ai/light';

/** The public source, MIT-licensed. */
export const LIGHT_SOURCE_URL = 'https://github.com/stevenbrady1/cviper-light';
