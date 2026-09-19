/**
 * Shared XML readers for `Package.appxmanifest` (L-168 follow-up).
 *
 * ============================================================================
 * WHY THIS EXISTS
 * ============================================================================
 * `identityAttributes` and `manifestVersion` used to be three near-identical
 * regex readers, duplicated across `appxManifestVersion.contract.test.ts` and
 * `msix-store-build.contract.test.ts` (twice there — a function and an inline
 * duplicate). All three read the RAW file text, and none of them excluded XML
 * comments.
 *
 * That was a real hole, not a theoretical one. `Package.appxmanifest`'s own
 * header comment explains the version rule with a worked example, and the
 * obvious next edit to that prose — pasting an illustrative
 * `<Identity Name="…" Version="9.9.9.0" />` above the real element, the way a
 * reviewer would to show a "before" — puts a SECOND `<Identity>` ahead of the
 * real one in the raw text. `.exec()` returns the first match, so every one
 * of the old readers would silently start reading the example instead of the
 * manifest, and the version-pinning guard this module backs would pass on a
 * manifest that had actually drifted. Proved by mutation (L-168 review): a
 * planted commented-out `<Identity Version="9.9.9.0" />` above the real
 * element made all three old readers — and every test built on them — read
 * the wrong value.
 *
 * So every reader here strips comments FIRST, unconditionally, before any
 * `<Identity>` pattern is applied.
 *
 * `repo-scan.ts`'s `stripComments` is the sibling for TypeScript/Rust/JSON —
 * this is the XML comment shape (`<!-- … -->`, not `//` or `/* *\/`), and it
 * lives with the manifest-specific readers it feeds rather than in the
 * generic file-walking module.
 */

/**
 * Every XML comment removed, non-greedily so one `-->` cannot swallow content
 * past the next comment's close.
 */
export function stripXmlComments(xml: string): string {
  return xml.replace(/<!--[\s\S]*?-->/g, '');
}

/**
 * The three identity values a Store submission replaces (`Name`, `Publisher`,
 * `PublisherDisplayName`), or `null` where absent. Comments are stripped
 * first — see the module docblock.
 */
export function identityAttributes(manifestXml: string): Record<string, string | null> {
  const stripped = stripXmlComments(manifestXml);
  const identity = /<Identity\b([^>]*)>/.exec(stripped)?.[1] ?? '';
  return {
    Name: /\bName="([^"]*)"/.exec(identity)?.[1] ?? null,
    Publisher: /\bPublisher="([^"]*)"/.exec(identity)?.[1] ?? null,
    PublisherDisplayName:
      /<PublisherDisplayName>([^<]*)<\/PublisherDisplayName>/.exec(stripped)?.[1] ?? null,
  };
}

/**
 * `Identity/@Version` out of the manifest XML, or `null` if absent. Comments
 * are stripped first — see the module docblock.
 */
export function manifestVersion(manifestXml: string): string | null {
  const stripped = stripXmlComments(manifestXml);
  return /<Identity\b[^>]*\bVersion="([^"]*)"/.exec(stripped)?.[1] ?? null;
}
