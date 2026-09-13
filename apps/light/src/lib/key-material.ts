/**
 * ONE list of what counts as signing material, for every guard that forbids it.
 *
 * ==========================================================================
 * WHY THIS FILE EXISTS
 * ==========================================================================
 * Three forbid-lists were written independently and disagreed. The artefact
 * rules in `msix-store-build.contract.test.ts` knew about `.snk` and not about
 * `.asc` or `id_rsa`; `FORBIDDEN_UPLOAD_PATTERNS` in
 * `no-automation-server-in-shipped-builds.contract.test.ts` knew about `.asc`
 * and `id_rsa` and not about `.snk`; the sweep inside `msix.yml` was a fourth
 * copy. Every one of them read as complete, and each had a gap the others
 * covered — which is the worst shape a security rule can take, because the
 * reviewer of any one of them sees a finished list.
 *
 * A shared constant makes the gap impossible: widening the list widens every
 * guard, and a guard that disagrees with it is a failing test rather than a
 * quiet hole.
 *
 * This is NOT a test module, for the reason `repo-scan.ts` gives: importing
 * one TEST module from another re-registers its whole suite under the wrong
 * name. A plain module has no suites to re-register.
 */

/**
 * Extensions that carry, or can carry, a private key — with the leading dot,
 * lowercase, in the spelling the `msix.yml` sweep uses so the two can be
 * compared literally.
 *
 * `.cer` is deliberately ABSENT. A DER certificate is a public key and a
 * signature; the MSIX artefact publishes one on purpose, and a list that also
 * forbade the fix would be a rule nobody could satisfy.
 */
export const KEY_MATERIAL_EXTENSIONS: readonly string[] = [
  '.pfx',
  '.p12',
  '.pem',
  '.key',
  '.snk',
  '.jks',
  '.keystore',
  '.asc',
];

/**
 * Names that are key material whatever their extension — or with none at all.
 *
 * `id_rsa` has no extension, so an extension list alone never sees it.
 */
export const KEY_MATERIAL_NAMES: readonly string[] = ['id_rsa'];

/**
 * The same list as line-matching patterns, for guards that read TEXT (a
 * workflow, a manifest) rather than a directory listing.
 *
 * `\b` after each so `.key` does not match `.keystore`'s prefix by accident
 * and, more importantly, so `something.keyfoo` is not read as a `.key`.
 */
export const KEY_MATERIAL_PATTERNS: readonly RegExp[] = [
  ...KEY_MATERIAL_EXTENSIONS.map((extension) => new RegExp(`\\${extension}\\b`, 'i')),
  ...KEY_MATERIAL_NAMES.map((name) => new RegExp(`\\b${name}\\b`, 'i')),
];

/** Does this line of text name key material? */
export function namesKeyMaterial(text: string): boolean {
  return KEY_MATERIAL_PATTERNS.some((pattern) => pattern.test(text));
}
