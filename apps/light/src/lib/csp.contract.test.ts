/**
 * The Content-Security-Policy contract: the web view is restricted, and the
 * restriction is as tight as the shipped bundle actually allows.
 *
 * ============================================================================
 * WHY THIS EXISTS
 * ============================================================================
 * `outbound-hosts.contract.test.ts` proves the web page has no Tauri HTTP
 * plugin and no `http:*` capability, so it cannot make a request through Tauri.
 * That is only half of it. A web view with `"csp": null` has NO restriction at
 * all: `fetch('https://…')`, an `<img>` beacon, a `<script src>` from a CDN and
 * a WebSocket are all available to anything that gets to run in the page, and
 * none of them goes anywhere near a capability file. The registry guard would
 * stay green throughout, because the host would arrive at runtime from an
 * advert's HTML rather than as a literal in this tree.
 *
 * That matters here more than in most apps. This one feeds attacker-influenced
 * text — a fetched job advert, a pasted advert, a model's reply — into a
 * renderer that shares an origin with a credential store. The CSP is the layer
 * that says: whatever ends up executing in this page, it still cannot open a
 * socket to anywhere.
 *
 * Every real network call in this app is a Rust command reached over IPC
 * (`ai/transport.ts`, `jobs/transport.ts`, `tracker/pageFetch.ts`). So the web
 * view needs no external host at all, and `connect-src` can name none.
 *
 * ============================================================================
 * A FORBID-LIST, NOT AN ALLOW-LIST (LESSON-033)
 * ============================================================================
 * The assertions encode "no source that reaches the open web", "no
 * `'unsafe-eval'`", "no wildcard" — never "the policy must be this exact
 * string". A guard that pinned the literal policy would fail on the day
 * somebody legitimately tightened it, and the first person to hit that deletes
 * the guard rather than the hole.
 *
 * ============================================================================
 * WHAT THIS CANNOT DO, SAID PLAINLY
 * ============================================================================
 * A CSP only breaks things in a REAL BUILT APP. `cargo check`, `vitest` and
 * `vite build` never load the page under the policy, and CLAUDE.md forbids
 * `tauri build` here. So this file cannot prove the app still works — it can
 * only prove the policy is restrictive and that every asset the bundle is known
 * to load is permitted BY CONSTRUCTION, which is what the `the bundle's own
 * assets are all same-origin` block below does. Final proof belongs to the
 * built-app smoke job (L-88, PR #25).
 *
 * That block is the load-bearing half. If somebody points the pdf.js worker at
 * a CDN, or adds a font `<link>`, the policy stops being sufficient and the
 * failure is a blank screen in a shipped installer — so the things the policy
 * DEPENDS ON are asserted here rather than assumed.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from './repo-scan.ts';

const CONFIG_PATH = join(REPO_ROOT, 'apps/light/src-tauri/tauri.conf.json');
const FONTS_CSS_PATH = join(REPO_ROOT, 'apps/light/src/styles/fonts.css');
const PDFJS_ASSETS_PATH = join(REPO_ROOT, 'apps/light/src/parsing/pdfjs-assets.ts');
const INDEX_HTML_PATH = join(REPO_ROOT, 'apps/light/index.html');

/** A parsed policy: directive name (lower-cased) to its source list. */
export type Policy = Readonly<Record<string, readonly string[]>>;

/**
 * Split a policy into directives.
 *
 * Deliberately lexical, like every other guard in this repo. A CSP is a
 * semicolon-separated list of `name source source …`, and nothing here needs to
 * understand what the sources mean — only what they name.
 */
export function parseCsp(csp: string): Policy {
  const policy: Record<string, string[]> = {};
  for (const chunk of csp.split(';')) {
    const tokens = chunk.trim().split(/\s+/).filter(Boolean);
    const [name, ...sources] = tokens;
    if (name === undefined) continue;
    policy[name.toLowerCase()] = sources;
  }
  return policy;
}

/**
 * Sources in this list that can reach the open web.
 *
 * `http://ipc.localhost` is Tauri's own IPC origin on Windows and is NOT the
 * open web — it never leaves the process. RFC 6761 reserves the whole
 * `localhost.` TLD, which is the same reasoning `fetch_page.rs` uses when it
 * refuses those names, so the test is on the name rather than on an allow-list
 * of blessed strings.
 *
 * A BARE scheme (`https:`, `http:`, `data:` in a script context) and a wildcard
 * (`*`, `https://*`) are worse than any single host, so they count too.
 */
export function webSourcesIn(sources: readonly string[]): string[] {
  return sources.filter((source) => {
    const bare = source.replace(/^'|'$/g, '');
    if (bare === '*' || bare.includes('*')) return true;
    // `https:` with no host is every host.
    if (/^https?:$/i.test(bare)) return true;

    const url = /^https?:\/\/([^/]+)/i.exec(bare);
    if (url === null) return false;
    const host = (url[1] ?? '').toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
    return host !== 'localhost' && !host.endsWith('.localhost');
  });
}

const CONFIG = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as {
  app?: { security?: { csp?: unknown } };
};

const RAW_CSP = CONFIG.app?.security?.csp;

describe('the web view has a Content-Security-Policy at all', () => {
  it('is a policy, not null', () => {
    expect(
      RAW_CSP,
      '`app.security.csp` is null, which means the web view has NO restriction: a script that ' +
        'gets to run in the page can fetch any host, open a WebSocket, or load a remote script. ' +
        'Every real request in this app goes through a Rust command over IPC, so the page needs ' +
        'no external host — set a policy.',
    ).not.toBeNull();
    expect(typeof RAW_CSP).toBe('string');
    expect(String(RAW_CSP).trim().length).toBeGreaterThan(0);
  });
});

describe('the policy names nothing on the open web', () => {
  const policy = parseCsp(String(RAW_CSP ?? ''));

  it('has a default-src that falls back to this origin only', () => {
    expect(
      policy['default-src'],
      'a policy with no default-src restricts only what it lists',
    ).toBeDefined();
    expect(webSourcesIn(policy['default-src'] ?? [])).toEqual([]);
  });

  it('connect-src names no web host', () => {
    // THE assertion this file exists for. Every fetch, XHR, WebSocket and
    // EventSource the page could make is governed by this one directive, and
    // the answer for this app is "none of them, ever".
    const sources = policy['connect-src'];
    expect(sources, 'connect-src must be stated explicitly, not inherited').toBeDefined();
    expect(
      webSourcesIn(sources ?? []),
      'The web page must not be able to open a socket to the internet. Every network call in ' +
        'this app is a Rust command reached over IPC — see ai/transport.ts, jobs/transport.ts ' +
        'and tracker/pageFetch.ts. A host here is a request nobody has explained to the user, ' +
        'and it would not appear in outbound-hosts.ts either.',
    ).toEqual([]);
  });

  it('no directive anywhere reaches the open web', () => {
    const offenders = Object.entries(policy).flatMap(([directive, sources]) =>
      webSourcesIn(sources).map((source) => `${directive}: ${source}`),
    );
    expect(offenders).toEqual([]);
  });

  it('never allows eval, and never allows an inline script', () => {
    const everything = Object.values(policy).flat();
    expect(
      everything,
      'pdf.js is configured with `isEvalSupported: false` precisely so the app never needs ' +
        "'unsafe-eval' — see packages/cv-parsing/src/pdfjs.ts.",
    ).not.toContain("'unsafe-eval'");

    expect(
      policy['script-src'] ?? [],
      'An inline script is how injected content becomes running code, and this app renders ' +
        'text it did not write. Vite emits hashed same-origin bundles; nothing needs this.',
    ).not.toContain("'unsafe-inline'");
  });
});

describe('the bundle’s own assets are all same-origin, so the policy is sufficient', () => {
  // The half a config check cannot do. A policy of `'self'` is only correct
  // while everything the shipped page loads IS self, and each of these is a
  // real way that has stopped being true in other pdf.js and webfont projects.

  it('every shipped font is loaded from this origin', () => {
    const css = readFileSync(FONTS_CSS_PATH, 'utf8');
    const urls = [...css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map(
      (match) => match[1] ?? '',
    );

    // Anti-inert: a regex that matched nothing would clear this for ever.
    expect(urls.length).toBeGreaterThanOrEqual(9);
    for (const url of urls) {
      expect(
        url,
        `${url} is not a root-relative font URL, so font-src 'self' would block it`,
      ).toMatch(/^\/fonts\//);
    }
  });

  it('the pdf.js worker is an address Vite emits, not a CDN or a bundled worker', () => {
    const source = readFileSync(PDFJS_ASSETS_PATH, 'utf8');

    // `?url` keeps the worker same-origin. `?worker` would make Vite bundle it,
    // and a CROSS-origin workerSrc makes pdf.js wrap the script in a `blob:`
    // URL (`_createCDNWrapper`, only reached when `_isSameOrigin` is false) —
    // which this policy does not permit and which would fail only in the
    // packaged app.
    expect(source).toMatch(/pdfjs-dist\/build\/pdf\.worker\.min\.mjs\?url/);
    expect(source).not.toMatch(/pdf\.worker[^'"]*\?worker/);

    // The cmaps and font metrics are fetched by name at runtime from a
    // root-relative directory, so `default-src 'self'` covers them.
    expect(source).toMatch(/PDFJS_PUBLIC_BASE\s*=\s*'\/pdfjs'/);
  });

  it('the HTML shell loads nothing from an absolute address', () => {
    const html = readFileSync(INDEX_HTML_PATH, 'utf8');
    expect(html.length).toBeGreaterThan(100);
    // A font `<link>` or a CDN `<script>` here would be a request on the very
    // first paint, before the user has touched anything.
    expect(html).not.toMatch(/(?:src|href)\s*=\s*["']https?:\/\//i);
  });
});

describe('the detector can actually fail', () => {
  // Without this block, a regression in `parseCsp` or `webSourcesIn` that
  // returned nothing would clear every assertion above while the real policy
  // went unread.
  it('parses a policy into its directives', () => {
    const policy = parseCsp("default-src 'self'; connect-src 'self' ipc: http://ipc.localhost");
    expect(policy['default-src']).toEqual(["'self'"]);
    expect(policy['connect-src']).toEqual(["'self'", 'ipc:', 'http://ipc.localhost']);
  });

  it('catches every shape of a source that reaches the internet', () => {
    for (const source of [
      'https://telemetry.example-vendor.io',
      'http://evil.example.net:8080',
      'https://*.example.com',
      '*',
      'https:',
      'http:',
    ]) {
      expect(webSourcesIn([source]), `${source} must be reported`).toEqual([source]);
    }
  });

  it('negative: does not fire on the sources this app legitimately needs', () => {
    // A guard that flagged Tauri's own IPC origin would be deleted the first
    // time somebody hit it, and the guard for the real hole would go with it.
    expect(
      webSourcesIn([
        "'self'",
        "'unsafe-inline'",
        'ipc:',
        'http://ipc.localhost',
        'http://tauri.localhost',
        'data:',
        'blob:',
        "'none'",
      ]),
    ).toEqual([]);
  });

  it('boundary: an empty policy has no directives and no web sources', () => {
    expect(parseCsp('')).toEqual({});
    expect(webSourcesIn([])).toEqual([]);
  });

  it('boundary: a trailing semicolon and extra whitespace parse the same', () => {
    expect(parseCsp("  default-src   'self' ;  ")).toEqual({ 'default-src': ["'self'"] });
  });
});
