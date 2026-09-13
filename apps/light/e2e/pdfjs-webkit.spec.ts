/**
 * Does pdf.js actually work under WebKit? (L-111)
 *
 * ============================================================================
 * THE GAP THIS CLOSES
 * ============================================================================
 * `packages/cv-parsing/src/pdfjs.ts` has a deliberate seam. The packaged app
 * loads the MODERN `pdfjs-dist` build with a real worker; the Node tests swap in
 * the LEGACY build, because the modern one cannot be imported in Node at all.
 * Every unit test in `packages/cv-parsing` therefore exercises a DIFFERENT BUILD
 * from the one users run, and the seam's own docblock says so.
 *
 * The only check against a real engine was `.github/workflows/smoke.yml`, which
 * drives the built binary on windows-latest — WebView2, a Chromium engine. iOS
 * renders in WKWebView, which is WebKit, under the same strict policy
 * (`script-src 'self'; worker-src 'self'`). Worker startup, module loading and
 * transferable buffers are all engine-level behaviour, and none of it had ever
 * been executed anywhere. The first time pdf.js met WebKit would have been on a
 * reviewer's device or a user's.
 *
 * So this drives the REAL path — modern build, real module worker, the app's own
 * asset wiring, the production Content-Security-Policy — under Playwright's
 * WebKit.
 *
 * ============================================================================
 * THE HONEST LIMIT. READ THIS BEFORE QUOTING THIS CHECK AT ANYONE.
 * ============================================================================
 * PLAYWRIGHT'S WEBKIT IS THE SAME ENGINE FAMILY AS WKWebView. IT IS NOT iOS.
 *
 * What a green run here DOES retire:
 *   - the ENGINE-level risk. A same-origin module worker starting under
 *     `worker-src 'self'`; the modern (non-legacy) `pdfjs-dist` build evaluating
 *     and parsing at all; `getTextContent()` returning the right text; the
 *     cmaps and standard-font directories being fetchable under
 *     `connect-src 'self'`; the scan verdict coming back as `NO_TEXT_LAYER`
 *     instead of silently-empty text. Those are WebCore and JavaScriptCore
 *     behaviours, and they are the same code on iOS.
 *
 * What a green run here DOES NOT retire, and must never be claimed to:
 *   - iOS MEMORY LIMITS. A WKWebView on a phone is killed by the OS at a
 *     fraction of a desktop's budget, and a 1.2 MB worker plus a large PDF is
 *     exactly the shape of allocation that gets a tab reloaded out from under
 *     you. Nothing here is measured under that pressure.
 *   - THE SHARE-SHEET FILE PATH. On iOS a CV arrives through a file provider and
 *     the `cv-opened` event in `src-tauri/src/lib.rs`, which is compiled for
 *     macOS, iOS and Android only. This page fetches bytes over HTTP instead.
 *     The route the bytes travel is untested by this file.
 *   - THE TAURI iOS SHELL. The app runs inside a Tauri WKWebView with a custom
 *     scheme, Tauri's own CSP rewriting, and the IPC bridge. A plain
 *     `http://127.0.0.1` origin in Playwright is not that environment.
 *   - THE SHIPPED BUNDLE. This builds its own page from the same sources (see
 *     `vite.webkit-harness.config.ts` for why). `smoke.yml` is what drives the
 *     bundle that is actually installed — on WebView2.
 *
 * A check that invites false confidence is worse than no check. If somebody
 * proposes closing the iOS-verification work item because this is green, the
 * four paragraphs above are the answer.
 *
 * ============================================================================
 * WHY IT IS NOT PART OF `pnpm test`
 * ============================================================================
 * It needs a ~60 MB WebKit download. `pnpm test` must stay something a
 * contributor can run offline in seconds, so this lives behind `pnpm webkit`,
 * exactly as the built-binary check lives behind `pnpm smoke`. It runs in CI on
 * every push and pull request, in ci.yml's `webkit` job, and
 * `src/lib/webkit-check-runs-in-ci.contract.test.ts` fails if that job stops
 * existing — a check nobody runs is not a check.
 *
 * ============================================================================
 * A MISSING BROWSER IS A FAILURE, NOT A SKIP
 * ============================================================================
 * `before()` does not guard the launch with `existsSync` and it does not call
 * `it.skip`. If the WebKit binary is absent the launch throws, every test in
 * this file goes red, and the message names the command that installs it. A
 * suite that reports green because it inspected nothing is the failure class
 * this repository keeps fighting (`lessons_silently_inert_guards`), and a
 * browser that CI forgot to install is precisely how it would happen here.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { webkit, type Browser, type BrowserContext, type Page } from 'playwright-core';

// The repository's own fixture builders, reused rather than re-invented. No
// binary PDF is ever committed here: both documents are emitted from source a
// person can read, with a real computed xref table. See the header of that file.
import { makeMinimalPdf, makeScannedPdf } from '../../../packages/cv-parsing/src/test/fixtures.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));

/** What `pnpm webkit:build` produces. Built, not served from source. */
const HARNESS_DIST = join(HERE, 'webkit', 'dist');

/** The packaged app's config — the ONE place the policy is written down. */
const TAURI_CONF = join(HERE, '..', 'src-tauri', 'tauri.conf.json');

/**
 * Text that must come back out of the text PDF.
 *
 * A real CV line rather than "hello": it has a capital, a space and a word that
 * cannot occur by accident in pdf.js's own output, so a partial extraction
 * cannot half-satisfy it.
 */
const PDF_SENTINEL = 'Senior Credit Risk Analyst';

/**
 * Pages in the generated scan. TWO, not one.
 *
 * The page count is what tells the two documents apart, so a run that silently
 * re-parsed the one-page text fixture cannot satisfy the scanned assertions.
 */
const SCANNED_PAGE_COUNT = 2;

/** Where the server publishes the generated documents. Not on disk. */
const TEXT_PDF_URL = '/fixture/text.pdf';
const SCANNED_PDF_URL = '/fixture/scanned.pdf';

/** One real file out of each directory the Vite plugin copies. */
const STANDARD_FONT_PROBE = '/pdfjs/standard_fonts/FoxitSerif.pfb';
const CMAP_PROBE = '/pdfjs/cmaps/78-EUC-H.bcmap';

/**
 * A host the policy must refuse.
 *
 * `.invalid` is reserved by RFC 2606 and can never resolve, so if the policy
 * were NOT enforced this would fail as a DNS error rather than quietly
 * succeeding against somebody's server. Either way no packet leaves the runner:
 * a refusal is decided before the network is touched.
 */
const FORBIDDEN_ORIGIN = 'https://blocked.invalid/';

// ── The production policy, read rather than retyped ──────────────────────────

/**
 * The Content-Security-Policy out of `tauri.conf.json`.
 *
 * READ, NEVER TRANSCRIBED. A copy in this file would be a second source of
 * truth, and the first time somebody loosened the real one to fix a bug this
 * check would carry on proving the old policy — green, and about nothing.
 *
 * Throws rather than defaulting. "No policy configured" must fail the run: a
 * page served with no CSP header refuses nothing, and every assertion below
 * would pass for the wrong reason.
 */
function productionCsp(): string {
  const parsed: unknown = JSON.parse(readFileSync(TAURI_CONF, 'utf8'));
  const csp: unknown = (parsed as { app?: { security?: { csp?: unknown } } }).app?.security?.csp;
  if (typeof csp !== 'string' || csp.trim() === '') {
    throw new Error(
      `${TAURI_CONF} has no app.security.csp string. Either the packaged app now ships with no ` +
        'Content-Security-Policy — which is a finding, not a test problem — or the config moved ' +
        'and this reader must move with it.',
    );
  }
  return csp;
}

const CSP = productionCsp();

// ── A static server that serves the harness under that policy ────────────────

/**
 * Content types, by extension.
 *
 * `.mjs` is the load-bearing entry: Vite emits the pdf.js worker as
 * `assets/pdf.worker.min-<hash>.mjs`, and a browser refuses a module worker
 * that does not arrive with a JavaScript type. Serving it as
 * `application/octet-stream` would look exactly like a CSP refusal.
 */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.pdf': 'application/pdf',
  // pdf.js's data files. Binary blobs it fetches by name; the type is not
  // inspected, only the bytes.
  '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

interface Harness {
  readonly origin: string;
  readonly server: Server;
}

/**
 * Serve `HARNESS_DIST`, plus the two generated PDFs, with the real CSP on every
 * response.
 *
 * Port 0: the OS picks a free one. A fixed port is how two runs on the same
 * runner silently drive each other's server.
 */
async function startHarnessServer(fixtures: ReadonlyMap<string, Uint8Array>): Promise<Harness> {
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;

    // Every response, including 404s. A policy applied to some responses and
    // not others would make a refusal depend on which file was asked for.
    response.setHeader('Content-Security-Policy', CSP);

    const fixture = fixtures.get(path);
    if (fixture !== undefined) {
      response.writeHead(200, { 'Content-Type': 'application/pdf' });
      response.end(Buffer.from(fixture));
      return;
    }

    const relative = normalize(path === '/' ? '/index.html' : path).replace(/^[\\/]+/, '');
    const file = resolve(HARNESS_DIST, relative);
    // Path traversal would let a failing test read the rest of the tree.
    if (file !== HARNESS_DIST && !file.startsWith(HARNESS_DIST + sep)) {
      response.writeHead(403).end('outside the harness');
      return;
    }
    if (!existsSync(file)) {
      response.writeHead(404).end(`no such file: ${relative}`);
      return;
    }

    response.writeHead(200, {
      'Content-Type': CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
    });
    response.end(readFileSync(file));
  });

  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('the harness server did not bind to a TCP port');
  }
  return { origin: `http://127.0.0.1:${String(address.port)}`, server };
}

// ── The observer ─────────────────────────────────────────────────────────────

/**
 * What the page reports about itself.
 *
 * Three channels, because they fail differently and the interesting failures
 * are the quiet ones:
 *
 *   - `violations` is the authoritative one. A CSP breakage very often does NOT
 *     throw: the resource is refused, the feature quietly does less, and
 *     `securitypolicyviolation` is the only trace. It carries the directive by
 *     name, which a console scrape can only guess at.
 *   - `console` catches what pdf.js itself says, and the loudest of those is
 *     "Setting up fake worker" — the degradation that looks like success,
 *     because the text still comes out afterwards.
 *   - `workers` turns "pdf.js used a worker" from an inference into a fact. A
 *     refused worker script and a working one produce almost the same output.
 */
interface CspViolation {
  readonly directive: string;
  readonly blocked: string;
  readonly source: string;
}

interface Observations {
  readonly console: readonly string[];
  readonly violations: readonly CspViolation[];
  readonly workers: readonly string[];
}

/**
 * A violation reduced to what identifies it: WHAT was refused, under WHICH
 * directive. The source file carries a Vite content hash and a line number, so
 * comparing whole strings would go red at the next unrelated rebuild.
 */
function fingerprint(violations: readonly CspViolation[]): string[] {
  return violations.map((entry) => `${entry.directive}|${entry.blocked}`);
}

/**
 * ============================================================================
 * EMPTY, AND IT MUST STAY EMPTY (L-112).
 * ============================================================================
 * This list once held `script-src|eval`: a refusal THE PACKAGED APP RAISED AT
 * STARTUP, before a user touched anything, on every single launch. Zod 4 decided
 * whether to JIT-compile its validators by running `new Function("")` inside a
 * try/catch (`allowsEval` in zod/v4/core); under `script-src 'self'` that was
 * refused, zod caught the `EvalError` and quietly used its interpreted validator
 * instead. Nothing broke, and a real `securitypolicyviolation` was raised in the
 * shipped product anyway. This check is what found it.
 *
 * It is fixed. Every schema in the app is now built from `z` re-exported by
 * `packages/core-types/src/zod.ts`, which calls `z.config({ jitless: true })`
 * before it hands `z` on — and `allowsEval` skips the probe entirely under
 * `jitless`, so the `new Function` is never reached. Import order is what makes
 * that hold, and it is PROVEN rather than asserted: `zod.test.ts` in both
 * `core-types` and `resume-schema` reads zod's own memoisation state to show the
 * probe never ran, and `no-direct-zod-imports.contract.test.ts` fails if any
 * shipped file reaches for `zod` without going through that module.
 *
 * `smoke.yml` could never have seen the original defect: its observer is
 * installed once WebDriver has a session, and the refusal fired during first
 * paint, before there was one.
 *
 * WHY AN EMPTY LIST RATHER THAN A DELETED ASSERTION. The assertion below is
 * equality against this constant, so an empty list is the strongest form of the
 * claim — ANY refusal, from anywhere, fails the run. Deleting the constant and
 * the assertion with it would have left the app's startup CSP behaviour
 * unwatched by anything, which is how the refusal went unnoticed until L-111
 * built this check. If a new entry is ever proposed here, it is a defect being
 * pinned, not a policy being approved: say which, and open the work item.
 */
const KNOWN_REFUSALS: readonly string[] = [];

/**
 * Installed through Playwright's `addInitScript`, so it is running before the
 * page's own first module byte executes — early enough to see a module script
 * the policy refuses, which a `<script>` inside the page could never do.
 *
 * It is the ONLY thing in the page that is not the app's own code. Written as a
 * source string rather than a function, matching `smoke.spec.ts`: what crosses
 * into the browser is then exactly what is written here, with no compiler step
 * in between to reason about.
 */
const INSTALL_OBSERVER = String.raw`
(function () {
  var record = { console: [], violations: [], workers: [] };
  window.__cviperObserver = record;

  ['log', 'info', 'warn', 'error', 'debug'].forEach(function (level) {
    var original = console[level].bind(console);
    console[level] = function () {
      var args = Array.prototype.slice.call(arguments);
      try {
        record.console.push(level + ': ' + args.map(function (a) { return String(a); }).join(' '));
      } catch (e) {
        record.console.push(level + ': <an argument that could not be stringified>');
      }
      return original.apply(console, args);
    };
  });

  document.addEventListener('securitypolicyviolation', function (event) {
    record.violations.push({
      directive: String(event.violatedDirective),
      blocked: String(event.blockedURI),
      source: String(event.sourceFile) + ':' + String(event.lineNumber),
    });
  });

  var NativeWorker = window.Worker;
  window.Worker = new Proxy(NativeWorker, {
    construct: function (target, args) {
      record.workers.push(String(args[0]));
      return Reflect.construct(target, args);
    },
  });
})();
`;

// ── Session state, shared in declaration order ───────────────────────────────

let browser: Browser | undefined;
let context: BrowserContext | undefined;
let page: Page | undefined;
let harness: Harness | undefined;

/** Everything WebKit printed, captured outside the page. */
const browserConsole: string[] = [];
/** Uncaught page errors. An empty list is part of the claim. */
const pageErrors: string[] = [];

/** The page, or a sentence saying why there is none. */
function session(): Page {
  if (page === undefined) {
    throw new Error('There is no WebKit page — the `before` hook did not complete.');
  }
  return page;
}

/** What the in-page observer has seen so far. */
async function observed(): Promise<Observations> {
  return session().evaluate<Observations>('window.__cviperObserver');
}

/** `Result<ExtractedDocument, ParseError>`, as it survives the page boundary. */
interface ExtractionResult {
  readonly ok: boolean;
  readonly value?: {
    readonly text: string;
    readonly pageCount: number | null;
    readonly warnings: readonly string[];
  };
  readonly error?: { readonly code: string; readonly message: string; readonly pageCount?: number };
}

/** Run the app's own `extractPdfText` over one of the served fixtures. */
async function extract(url: string): Promise<ExtractionResult> {
  return session().evaluate<ExtractionResult>(
    `window.__cviperWebKitHarness.extract(${JSON.stringify(url)})`,
  );
}

describe('pdf.js under WebKit, with the packaged app’s policy and wiring', () => {
  before(async () => {
    // ------------------------------------------------------------------
    // THE PREMISE, CHECKED BEFORE A BROWSER IS EVEN STARTED.
    // ------------------------------------------------------------------
    // A missing bundle must say "run the build", not fail forty seconds later
    // as a 404 that reads like a pdf.js problem.
    if (!existsSync(join(HARNESS_DIST, 'index.html'))) {
      throw new Error(
        `There is no built harness at ${HARNESS_DIST}. Run \`pnpm webkit\` from the repository ` +
          'root, which builds it first; `pnpm webkit:build` builds it alone.',
      );
    }

    const fixtures = new Map<string, Uint8Array>([
      [TEXT_PDF_URL, makeMinimalPdf(PDF_SENTINEL)],
      [SCANNED_PDF_URL, makeScannedPdf(SCANNED_PAGE_COUNT)],
    ]);
    harness = await startHarnessServer(fixtures);

    try {
      browser = await webkit.launch();
    } catch (cause) {
      // Rethrown, never skipped. See the header.
      throw new Error(
        'Playwright could not start WebKit. If the browser is not installed, install it with\n' +
          '    pnpm --filter @cviper/light exec playwright-core install webkit\n' +
          'This check does NOT skip when the browser is missing: a suite that reports green ' +
          `because it inspected nothing is worse than no suite.\nUnderlying error: ${String(cause)}`,
        { cause },
      );
    }

    context = await browser.newContext({
      // EXPLICIT, and it must stay false. Playwright can disable a page's CSP
      // outright; doing so here would delete the entire point of the file while
      // leaving every assertion below passing.
      bypassCSP: false,
    });

    page = await context.newPage();
    page.on('console', (message) => browserConsole.push(`${message.type()}: ${message.text()}`));
    page.on('pageerror', (error) => pageErrors.push(String(error)));

    await page.addInitScript({ content: INSTALL_OBSERVER });

    const response = await page.goto(`${harness.origin}/`, { waitUntil: 'load' });
    assert.ok(response !== null, 'WebKit did not load the harness page at all');
    assert.equal(response.status(), 200, 'the harness page did not answer 200');

    // The header the whole check hangs on, asserted here rather than in a test,
    // because every later assertion is meaningless without it.
    assert.equal(
      response.headers()['content-security-policy'],
      CSP,
      'the harness server did not serve the production Content-Security-Policy',
    );

    // The module must actually evaluate. If the policy refused it, this is
    // where the run stops — with the refusal already recorded by the observer.
    await page
      .waitForFunction('window.__cviperWebKitHarness !== undefined', undefined, { timeout: 30_000 })
      .catch(async (cause: unknown) => {
        const seen = await observed();
        throw new Error(
          'The harness module never evaluated, so the app’s own parsing code did not load under ' +
            `WebKit at all.\n  violations: ${JSON.stringify(seen.violations)}\n` +
            `  console: ${JSON.stringify(seen.console)}\n` +
            `  browser console: ${JSON.stringify(browserConsole)}\n` +
            `  page errors: ${JSON.stringify(pageErrors)}\n  cause: ${String(cause)}`,
          { cause },
        );
      });
  });

  after(async () => {
    await context?.close();
    await browser?.close();
    await new Promise<void>((done) => {
      if (harness === undefined) {
        done();
        return;
      }
      harness.server.close(() => {
        done();
      });
    });
  });

  // ── The premise ───────────────────────────────────────────────────────────

  it('the policy under test is the packaged app’s, and it is a real policy', () => {
    // Anti-inert. A config edit that emptied the policy, or a reader that
    // silently returned '', would make every assertion below pass by refusing
    // nothing. These are the two directives the pdf.js risk actually lives in.
    assert.match(CSP, /script-src 'self'/, `the policy has no strict script-src: ${CSP}`);
    assert.match(CSP, /worker-src 'self'/, `the policy has no strict worker-src: ${CSP}`);
    assert.ok(!CSP.includes('unsafe-eval'), `the policy allows eval, so this proves less: ${CSP}`);
    console.log(`webkit: policy   = ${CSP}`);
  });

  it('the page WebKit loaded carries the MODERN pdf.js build, not the legacy one', () => {
    // The whole reason this file exists: the Node tests run
    // `pdfjs-dist/legacy/build/pdf.mjs`. If the harness had somehow been built
    // against the legacy build too, it would prove exactly what those tests
    // already prove — and look identical while doing it.
    const chunks = readdirSync(join(HARNESS_DIST, 'assets'));
    const worker = chunks.filter((name) => /^pdf\.worker/.test(name));
    assert.ok(worker.length > 0, `no pdf.js worker was emitted into the bundle: ${chunks.join()}`);

    const bundled = chunks
      .filter((name) => name.endsWith('.js') || name.endsWith('.mjs'))
      .map((name) => readFileSync(join(HARNESS_DIST, 'assets', name), 'utf8'))
      .join('\n');
    assert.ok(
      !bundled.includes('legacy/build/pdf'),
      'the harness bundle references pdfjs-dist/legacy, so it is running the Node build rather ' +
        'than the one the app ships.',
    );
    console.log(`webkit: worker   = ${worker.join()}`);
  });

  it('the observer is installed, so the assertions below are reading something', async () => {
    const seen = await observed();
    // A record that exists but never grows is the shape of an inert guard, so
    // the worker leg below is the one that proves the channels are live; this
    // only proves the object made it into the page.
    assert.ok(Array.isArray(seen.violations), 'the observer did not install');
    assert.ok(Array.isArray(seen.workers), 'the observer did not install');
  });

  // ── The wiring ────────────────────────────────────────────────────────────

  it('pdf.js is wired to the app’s own worker, cmap and standard-font URLs', async () => {
    const assets = await session().evaluate<Record<string, string | null>>(
      'window.__cviperWebKitHarness.assets()',
    );
    console.log(`webkit: assets   = ${JSON.stringify(assets)}`);

    // Not a retyped copy: these came out of `configurePdfJsAssets()`, which is
    // the app's own module, imported by the harness page.
    assert.match(
      String(assets['workerSrc']),
      /^\/assets\/pdf\.worker[A-Za-z0-9_.-]*\.mjs$/,
      'the worker is not a same-origin Vite-emitted asset. pdf.js wraps a cross-origin worker in ' +
        'a blob: URL, which this policy names no source for and would refuse.',
    );
    assert.equal(assets['cMapUrl'], '/pdfjs/cmaps/');
    assert.equal(assets['standardFontDataUrl'], '/pdfjs/standard_fonts/');
    // Left unset on purpose — the image decoders are for rendering a page, and
    // this app only ever asks for text. See src/parsing/pdfjs-assets.ts.
    assert.equal(assets['wasmUrl'], null);
    assert.equal(assets['iccUrl'], null);
  });

  it('serves the cmap and standard-font directories under connect-src', async () => {
    const font = await session().evaluate<number>(
      `window.__cviperWebKitHarness.probe(${JSON.stringify(STANDARD_FONT_PROBE)})`,
    );
    const cmap = await session().evaluate<number>(
      `window.__cviperWebKitHarness.probe(${JSON.stringify(CMAP_PROBE)})`,
    );
    console.log(`webkit: probes   = font ${String(font)}, cmap ${String(cmap)}`);
    // A CV exported from Word leans on the standard-14 metrics and a CJK one
    // needs the cmaps, so a policy or a build that refused these would break
    // real CVs and no Latin-1 fixture.
    assert.equal(font, 200, 'the standard-font directory was not served');
    assert.equal(cmap, 200, 'the cmap directory was not served');
  });

  // ── The answer ────────────────────────────────────────────────────────────

  it('extracts the text of a normal PDF', { timeout: 120_000 }, async () => {
    const result = await extract(TEXT_PDF_URL);
    const seen = await observed();

    // Printed unconditionally, before any assertion can end the test: a red run
    // is read out of a CI log and this is the only place any of it exists.
    console.log(`webkit: text run = ${JSON.stringify(result)}`);
    for (const line of seen.console) console.log(`webkit: page > ${line}`);
    for (const line of browserConsole) console.log(`webkit: webkit > ${line}`);

    assert.equal(
      result.ok,
      true,
      `the app’s own extractPdfText failed under WebKit: ${JSON.stringify(result.error)}`,
    );
    assert.equal(result.value?.pageCount, 1);
    assert.ok(
      result.value?.text.includes(PDF_SENTINEL),
      `the extracted text did not contain the sentinel. Got: ${JSON.stringify(result.value?.text)}`,
    );
    assert.deepEqual(result.value?.warnings, []);
  });

  it('drove a real, same-origin module worker — not the fake-worker fallback', async () => {
    const seen = await observed();
    const pdfWorkers = seen.workers.filter((url) => /\/assets\/pdf\.worker/.test(url));

    console.log(`webkit: workers  = ${JSON.stringify(seen.workers)}`);

    assert.ok(
      pdfWorkers.length > 0,
      'pdf.js constructed no worker at all. It falls back to running in the main thread when the ' +
        'worker cannot start — which is what `worker-src` refusing the script looks like — and ' +
        'the text still comes out either way, so this is the only thing that tells the two ' +
        `apart. Workers seen: ${JSON.stringify(seen.workers)}`,
    );

    for (const url of pdfWorkers) {
      assert.ok(
        !url.startsWith('blob:'),
        `pdf.js wrapped its worker in a blob: URL (${url}), which it only does when it judges the ` +
          'script cross-origin. The policy names no blob: source, so a packaged build would ' +
          'refuse it. See the same-origin note in packages/cv-parsing/src/pdfjs.ts.',
      );
    }

    // The second half, and the one a worker URL alone cannot answer: pdf.js
    // CONSTRUCTS the worker, sends it a test message, and on no reply tears it
    // down and warns "Setting up fake worker." A worker that started and then
    // died is indistinguishable from a healthy one by URL alone.
    const fellBack = [...seen.console, ...browserConsole].filter((line) =>
      /fake worker/i.test(line),
    );
    assert.deepEqual(
      fellBack,
      [],
      `pdf.js fell back to running in the main thread:\n${fellBack.join('\n')}`,
    );
  });

  it('gives a scan the NO_TEXT_LAYER verdict rather than silently empty text', async () => {
    const result = await extract(SCANNED_PDF_URL);
    console.log(`webkit: scan run = ${JSON.stringify(result)}`);

    // The failure this guards against is not a crash. It is an extraction that
    // "succeeds" with an empty string, which the analysis then reports as
    // "no skills found" — a verdict on the candidate rather than on the file.
    assert.equal(
      result.ok,
      false,
      `a scan must not extract successfully. Got: ${JSON.stringify(result.value)}`,
    );
    assert.equal(result.error?.code, 'NO_TEXT_LAYER');
    // Two pages, not one: proof this was the SCAN and not a second run of the
    // one-page text fixture.
    assert.equal(result.error?.pageCount, SCANNED_PAGE_COUNT);
  });

  it('refused nothing at all — the app raises no policy violation of its own', async () => {
    const seen = await observed();
    console.log(`webkit: refusals = ${JSON.stringify(seen.violations)}`);

    // EQUALITY against an EMPTY list, not "contains none of the bad ones". See
    // KNOWN_REFUSALS: any refusal, from anywhere, fails here.
    assert.deepEqual(
      fingerprint(seen.violations),
      KNOWN_REFUSALS,
      'The set of Content-Security-Policy refusals changed.\n' +
        'The app must load with NONE. A refusal here is something the app now does that the ' +
        'packaged build blocks — find it before shipping, and do not pin it here without a ' +
        'work item saying why.\n' +
        'If it is `script-src|eval` again, L-112 has regressed: some schema is being built ' +
        'from a `z` that did not come through packages/core-types/src/zod.ts. ' +
        'no-direct-zod-imports.contract.test.ts should have caught that first — find out why ' +
        'it did not.\n' +
        `  seen: ${JSON.stringify(seen.violations)}`,
    );

    assert.deepEqual(
      pageErrors,
      [],
      `the page raised an uncaught error:\n${pageErrors.join('\n')}`,
    );
  });

  it('nothing pdf.js touched was refused', async () => {
    // The question this whole file was opened to answer, asked directly rather
    // than inferred from the set above: no worker, module, cmap or font was
    // blocked. Stated separately so that a future change to KNOWN_REFUSALS can
    // never quietly widen into the pdf.js surface.
    const seen = await observed();
    const nearPdfJs = seen.violations.filter(
      (entry) =>
        /worker-src|connect-src|font-src|default-src/.test(entry.directive) ||
        /pdf|cmap|standard_fonts|blob:/i.test(entry.blocked),
    );
    assert.deepEqual(
      nearPdfJs,
      [],
      `The policy refused something on the pdf.js path:\n${nearPdfJs
        .map((entry) => `  ${entry.directive} blocked ${entry.blocked} (${entry.source})`)
        .join('\n')}`,
    );
  });

  // ── Proof the policy is real and the detector fires ───────────────────────

  it('LAST: a deliberate refusal proves the policy and the observer are live', async () => {
    // Everything above asserts that nothing was refused. On its own that is
    // satisfied just as well by a page with no policy and an observer that
    // records nothing — the exact shape of a guard that passes while inspecting
    // nothing. So the run ends by asking for something the policy must refuse.
    //
    // It runs LAST because it deliberately dirties the violation record.
    const before = (await observed()).violations.length;

    await session().evaluate<string>(
      `fetch(${JSON.stringify(FORBIDDEN_ORIGIN)}).then(function () { return 'allowed'; },` +
        ` function (e) { return 'rejected: ' + String(e); })`,
    );

    const after_ = await observed();
    const planted = after_.violations.slice(before);
    console.log(`webkit: planted  = ${JSON.stringify(planted)}`);

    assert.ok(
      planted.length > 0,
      'A cross-origin fetch was NOT refused, or the refusal was not observed. Either the ' +
        'Content-Security-Policy is not being applied to this page, or the ' +
        '`securitypolicyviolation` channel is dead — and in both cases every refusal assertion ' +
        'above passed while inspecting nothing.',
    );
    assert.ok(
      planted.some((entry) => entry.directive.includes('connect-src')),
      `the refusal was not attributed to connect-src: ${JSON.stringify(planted)}`,
    );
    assert.equal(planted[0]?.blocked, FORBIDDEN_ORIGIN);
  });
});
