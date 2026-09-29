import markUrl from '../../branding/cviper-mark.svg';

/**
 * The CViper mark (L-184): a navy badge with three rising teal bars.
 *
 * This is CViper's own logo FILE, not a redrawing of it. `branding/cviper-mark.svg`
 * is a copy of CViper's `frontend/public/cviper-mark.svg`; the app icons are
 * generated from a PNG rendered from the same file. Showing the file itself
 * means there is one logo and nothing to keep in step — and its brand colours
 * stay out of `.tsx`, where the token contract rightly forbids raw hex.
 *
 * Vite bundles it into the app, so it loads from the app itself (`img-src
 * 'self'` in the CSP) and nothing is fetched from anywhere else. It is
 * decorative: the words "CViper Light" beside it are the accessible name.
 */
export function CViperMark({ size = 32 }: { readonly size?: number }) {
  return (
    <img
      data-testid="cviper-mark"
      src={markUrl}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      draggable={false}
      className="shrink-0"
    />
  );
}
