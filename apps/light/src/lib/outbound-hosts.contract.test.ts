/**
 * The outbound-hosts contract: shipped code names no network host that
 * `outbound-hosts.ts` does not list, and the web page cannot reach the network
 * at all.
 *
 * ============================================================================
 * WHY THIS EXISTS
 * ============================================================================
 * The README promises "the only requests this app ever makes are ones you
 * start". That promise is only checkable if the set of places the app can
 * reach is finite and written down. `outbound-hosts.ts` writes it down; this
 * guard makes the source tree agree with it, so the privacy notice generated
 * from the registry is a statement about the code, not about intentions.
 *
 * The hosted product's ADR 012 calls this invariant R-DATA: no request without
 * a user action, and nothing reaches a server belonging to us. A host that is
 * not in the registry is a request nobody has explained to the user yet.
 *
 * ============================================================================
 * A FORBID-LIST, NOT AN ALLOW-LIST (LESSON-033)
 * ============================================================================
 * The guard never asserts that a host IS present — that would go green on the
 * day someone deleted the Adzuna client and red on the day someone renamed it.
 * It asserts that no host is present that the registry does not know, which is
 * the only shape that stays true as the product changes.
 *
 * ============================================================================
 * WHAT IS SCANNED, AND WHAT IS NOT
 * ============================================================================
 * Scanned: every non-test `.ts`, `.tsx`, `.rs`, `.sql`, `.html`, `.css` and
 * `.json` file under `apps/` and `packages/`, comments stripped, Rust
 * `#[cfg(test)]` modules stripped. That covers the Rust transport (the only
 * place a socket is opened), the SQL seeds (job-board links), the HTML shell
 * (a CDN font would be a request on launch) and `tauri.conf.json` (the
 * updater endpoint).
 *
 * Not scanned: test files. They name hosts that must be REFUSED —
 * `evil.example.com`, cloud metadata addresses — to prove they are refused,
 * and a guard that fired on its own negative tests would be deleted.
 *
 * Reserved documentation names (`example.com`, `.invalid`, `.test`) are also
 * let through: RFC 2606 guarantees they resolve to nothing, so a literal
 * naming one is prose, not a request. `tauri.app`, `doc.rust-lang.org` and
 * the JSON-schema hosts only ever appear in `$schema` fields and comments.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { OUTBOUND_HOSTS, OUTBOUND_HOST_NAMES } from './outbound-hosts.ts';
import { REPO_ROOT, displayPath, shippedText, walk } from './repo-scan.ts';

const SCANNED_EXTENSIONS = ['.ts', '.tsx', '.rs', '.sql', '.html', '.css', '.json'] as const;

/**
 * Hosts that are not requests. RFC 2606 reserved names resolve to nothing;
 * the rest appear only in `$schema` URLs, which editors read and the app does
 * not.
 */
const NOT_A_REQUEST: readonly RegExp[] = [
  /(^|\.)example\.(com|net|org)$/,
  /\.(invalid|test|localhost)$/,
  /^(json\.schemastore\.org|json-schema\.org|schema\.tauri\.app|schemas\.tauri\.app|tauri\.app|doc\.rust-lang\.org|www\.w3\.org)$/,
];

/** Every `https?://host` in a piece of text, hosts only, lower-cased. */
export function hostsNamedIn(text: string): string[] {
  return [...text.matchAll(/https?:\/\/([A-Za-z0-9.-]+)/g)]
    .map((match) => (match[1] ?? '').toLowerCase().replace(/\.$/, ''))
    .filter((host) => host.length > 0);
}

const FILES = [
  ...walk(join(REPO_ROOT, 'apps'), { extensions: SCANNED_EXTENSIONS }),
  ...walk(join(REPO_ROOT, 'packages'), { extensions: SCANNED_EXTENSIONS }),
].filter((file) => !file.endsWith('package.json') && !file.endsWith('pnpm-lock.yaml'));

interface Finding {
  readonly file: string;
  readonly host: string;
}

const UNREGISTERED: Finding[] = FILES.flatMap((file) =>
  [...new Set(hostsNamedIn(shippedText(file)))]
    .filter((host) => !OUTBOUND_HOST_NAMES.has(host))
    .filter((host) => !NOT_A_REQUEST.some((pattern) => pattern.test(host)))
    .map((host) => ({ file: displayPath(file), host })),
);

describe('the outbound-hosts registry', () => {
  it('explains every host in one user-readable sentence', () => {
    for (const entry of OUTBOUND_HOSTS) {
      expect(entry.why.length, entry.host).toBeGreaterThan(30);
      expect(entry.why.trim().endsWith('.'), `${entry.host}: "why" is a sentence`).toBe(true);
    }
  });

  it('never lists a host twice', () => {
    expect(OUTBOUND_HOST_NAMES.size).toBe(OUTBOUND_HOSTS.length);
  });

  it('only ever fetches with the user’s own key, on request, or on this machine', () => {
    // A fourth purpose — "fetched-with-our-key", "on launch" — has no place to
    // be declared, which is the point. The type forbids it; this pins the
    // runtime list against a cast.
    const purposes = new Set(OUTBOUND_HOSTS.map((entry) => entry.purpose));
    for (const purpose of purposes) {
      expect([
        'fetched-with-your-key',
        'fetched-on-request',
        'opened-in-your-browser',
        'local-only',
      ]).toContain(purpose);
    }
  });
});

describe('no shipped source names a host outside the registry', () => {
  it('scans the real tree', () => {
    // Anti-inert: an empty walk would make the assertion below vacuously
    // true for ever. The Rust transport and the Tauri config MUST be in scope.
    expect(FILES.length).toBeGreaterThan(80);
    expect(FILES.some((file) => file.endsWith('providers.rs'))).toBe(true);
    expect(FILES.some((file) => file.endsWith('tauri.conf.json'))).toBe(true);
    expect(FILES.some((file) => file.endsWith('index.html'))).toBe(true);
  });

  it('would catch a host that nobody registered', () => {
    // The detector, proven on a planted string so a regression in the
    // extraction regex cannot hide behind a clean tree.
    expect(hostsNamedIn('fetch("https://telemetry.example-vendor.io/v1/collect")')).toEqual([
      'telemetry.example-vendor.io',
    ]);
    expect(hostsNamedIn('see https://api.openai.com/v1 and http://127.0.0.1:11434')).toEqual([
      'api.openai.com',
      '127.0.0.1',
    ]);
  });

  it('finds none', () => {
    expect(
      UNREGISTERED,
      'Every host below is named in shipped code but not in outbound-hosts.ts. ' +
        'Either the code is making a request nobody has explained to the user, ' +
        'or the registry needs an entry with a "why" — decide which, do not silence this.',
    ).toEqual([]);
  });
});

describe('the web page cannot reach the network', () => {
  /**
   * "Network calls originate in Rust, never in the web page" is the one idea
   * that shapes Light's architecture (hosted `docs/ARCHITECTURE.md` §3). It
   * is what keeps a pasted API key out of the renderer. Two things would undo
   * it silently: granting the Tauri HTTP plugin to the window, or adding the
   * plugin's crate at all.
   */
  const capabilitiesDirectory = join(REPO_ROOT, 'apps/light/src-tauri/capabilities');
  const capabilityFiles = walk(capabilitiesDirectory, { extensions: ['.json'] });

  it('has capability files to check', () => {
    expect(capabilityFiles.length).toBeGreaterThan(0);
  });

  it('grants no http:* permission to any window', () => {
    for (const file of capabilityFiles) {
      const permissions = JSON.parse(readFileSync(file, 'utf8')) as {
        permissions?: readonly (string | { identifier?: string })[];
      };
      const identifiers = (permissions.permissions ?? []).map((permission) =>
        typeof permission === 'string' ? permission : (permission.identifier ?? ''),
      );
      expect(
        identifiers.filter((identifier) => identifier.startsWith('http:')),
        displayPath(file),
      ).toEqual([]);
    }
  });

  it('does not depend on the Tauri HTTP plugin in either language', () => {
    const cargo = readFileSync(join(REPO_ROOT, 'apps/light/src-tauri/Cargo.toml'), 'utf8');
    const manifest = readFileSync(join(REPO_ROOT, 'apps/light/package.json'), 'utf8');
    expect(cargo).not.toMatch(/^\s*tauri-plugin-http\b/m);
    expect(manifest).not.toContain('@tauri-apps/plugin-http');
  });
});
