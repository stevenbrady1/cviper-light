/**
 * Nine questions asked of the REAL built binary (L-88, extended by L-103, L-104).
 *
 * ============================================================================
 * WHY THIS EXISTS
 * ============================================================================
 * `CLAUDE.md` forbids an agent from running `tauri build`, for good reasons —
 * it is slow, it writes into `target/`, and a release bundle is a human/CI
 * artefact. The cost of that rule is that nothing in this repository had ever
 * been verified in the thing users actually run. Every test here is a Vitest
 * test against jsdom or a pure function; the Rust tests are `cargo test --lib`.
 * Between "the React tree renders" and "the app opens on a Windows desktop"
 * sit the WebView2 runtime, the Tauri IPC bridge, the capability file, the
 * bundled `frontendDist`, and the plugin registrations in `lib.rs` — none of
 * which any existing test can fail on.
 *
 * So this runs against the built `src-tauri/target/<profile>/<app>.exe` — see
 * the note on the build profile below for why that profile is `debug` — in CI,
 * on Windows, where a build is allowed. The app serves WebDriver itself when
 * compiled with the `wdio` feature, so there is no external driver process:
 * this file launches the binary and talks to it directly.
 *
 * ============================================================================
 * IT DOES NOT BUILD THE APP. THAT IS DELIBERATE.
 * ============================================================================
 * The canonical Tauri example calls `tauri build` inside its `before` hook.
 * This one refuses to, for two reasons:
 *
 *   1. `pnpm smoke` must never be the thing that violates the HARD RULE in
 *      CLAUDE.md. Run it on a machine with no build and it fails with a
 *      sentence telling you to build first — it does not quietly start a
 *      twenty-minute release build nobody asked for.
 *   2. In CI the build is its own step. A compile error then fails at
 *      "Build the app" instead of being reported as a smoke-test failure,
 *      which is the difference between a useful red and a confusing one.
 *
 * ============================================================================
 * NINE ASSERTIONS, ONE SESSION, IN ORDER
 * ============================================================================
 * The window opens, the first-run welcome is shown, Settings opens, and the
 * Privacy section is visible. Then an observer goes into the page, a generated
 * PDF is parsed by the app's own pdf.js, the real worker is proved to have run,
 * the whole run is adjudicated for Content-Security-Policy violations, and
 * finally a generated SCAN — real pages, no text layer — goes through the same
 * pdf.js under the same policy. They share one app session and each moves it
 * along, so they run in declaration order — `node:test` guarantees that within a
 * file. No API key, no network: everything asserted here is true of a machine
 * that has never seen this app and is offline.
 *
 * ============================================================================
 * WHY THE PDF HALF EXISTS (L-103)
 * ============================================================================
 * PR #32 replaced `"csp": null` with a real policy. The four assertions above
 * exercise it for app START and NAVIGATION, and nothing else — so the policy
 * was proven for the two cheapest things it governs and unproven for the one
 * reviewers actually flagged. pdf.js runs a worker and calls
 * `WebAssembly.instantiate` for JBIG2, OpenJPEG and ICC, and `script-src 'self'`
 * blocks WASM compilation without `'wasm-unsafe-eval'`. The standing argument
 * is that `wasmUrl` is left unset so those paths degrade to a warning — which
 * is REASONING, and `csp.contract.test.ts` can only assert it BY CONSTRUCTION,
 * because a CSP breaks things in a built app and nothing else. A policy never
 * executed against the feature most likely to break it is a configuration file.
 *
 * So this drives the real binary through a real PDF and watches what the page
 * says while it happens.
 *
 * ============================================================================
 * WHY THE SCANNED HALF EXISTS, AND WHY NO FIXTURE COULD DO BETTER (L-104)
 * ============================================================================
 * L-103's fixture is a TEXT PDF, and text extraction never reaches an image
 * decoder. The image decoders — JBIG2 and JPEG2000 — are the actual WebAssembly
 * callers named above, so the one document class that could still trip
 * `script-src 'self'` was the one class never driven: a scan. "Text extraction
 * should not reach those paths" was, again, reasoning.
 *
 * So `makeScannedPdf` is parsed here too, in the same session, under the same
 * policy, and what the WASM probe saw is printed either way. That is the
 * EXECUTED half: a document with real pages and no text layer goes through the
 * packaged app's own pdf.js, and the policy refuses nothing.
 *
 * The other half is STRUCTURAL, and it is the stronger of the two, because it
 * holds for every document rather than for one fixture. The image decoders are
 * unreachable from this app BY CONSTRUCTION, behind two independent barriers:
 *
 *   1. NOTHING CAN ASK FOR A RENDER. `PdfPageLike`
 *      (packages/cv-parsing/src/pdfjs.ts:51-53) declares exactly one method,
 *      `getTextContent()`. There is no `render` and no `getOperatorList` on this
 *      app's own type for a page, so a call to either does not compile. The only
 *      page loop in the codebase, `harvestPages`
 *      (packages/cv-parsing/src/pdf.ts:97-113), calls `getPage()` and then
 *      `getTextContent()`, and nothing else. pdfjs.ts:190-192 already says it in
 *      words: "we never draw a page".
 *   2. THE DECODER MODULES ARE NOT SHIPPED. `configurePdfJsAssets`
 *      (apps/light/src/parsing/pdfjs-assets.ts:58-69) sets `workerSrc`,
 *      `cMapUrl` and `standardFontDataUrl` and deliberately leaves `wasmUrl` and
 *      `iccUrl` unset, so `pdfDocumentInit` (pdfjs.ts:198-212) omits both keys
 *      and pdf.js has no decoder module to fetch in the first place.
 *
 * Swept for counter-examples rather than assumed: the only `.render(` in shipped
 * source is `ReactDOM.createRoot(...).render(` (apps/light/src/main.tsx:18), and
 * there is no `getOperatorList`, canvas, `drawImage`, `ImageData`,
 * `createImageBitmap`, `OffscreenCanvas` or `toDataURL` anywhere under
 * `packages/` or `apps/light/src/`. pdfjs-dist has exactly two production
 * importers — the loader at pdfjs.ts:123 and the worker URL at
 * pdfjs-assets.ts:31. No preview, no thumbnail, no second consumer.
 *
 * WHICH MAKES THE FIXTURE'S LIMIT A NON-ISSUE, AND IT IS STILL WORTH STATING.
 * `makeScannedPdf`'s pages carry `0.5 g 0 0 612 792 re f` — a grey VECTOR
 * rectangle, not an encoded image — because what its unit tests need is the
 * property a scan has (`numPages > 0`, no text items) and not a JPEG. So this
 * spec does not drive a JBIG2, JPX or DCTDecode stream. Embedding one to force
 * that would be testing pdf.js rather than testing this app, down a path
 * barrier 1 makes unreachable regardless. The honest claim is the pair:
 * no-text-layer documents are EXECUTED clean under the policy, and image
 * decoding is EXCLUDED by construction. Should a page preview ever land — the
 * note at pdfjs-assets.ts:62 anticipates exactly that — barrier 2 falls,
 * `wasmUrl` gets set, and this reasoning must be redone against a real raster.
 *
 * ============================================================================
 * THE APP'S OWN UPLOAD BUTTON CANNOT BE DRIVEN, AND THAT IS BY DESIGN
 * ============================================================================
 * `analysis-upload` calls `pick_and_read_cv`, which opens the OS file dialog
 * in RUST (`src-tauri/src/files.rs`) precisely so that JavaScript can never
 * name a path. A WebDriver session lives inside the web view and cannot touch a
 * native dialog, so that route ends at a modal this spec cannot answer. The
 * second ingestion route, the `cv-opened` event, is compiled only for macOS,
 * iOS and Android (`lib.rs`), and this job runs on Windows. There is therefore
 * NO non-dialog path into `Analysis.tsx`'s `ingest()` on this platform, and
 * manufacturing one would mean either automating a native dialog with
 * keystrokes or shipping a test-only seam in the web bundle — and that bundle
 * is the same one the CLEAN installer carries, so the seam would reach users.
 *
 * What is driven instead is the app's OWN pdf.js: the chunk Vite emitted, the
 * worker Vite emitted, the font and cmap directories the Vite plugin copied,
 * inside the built binary, under the shipped policy. Every CSP-relevant thing
 * `extractText` would do is done here. What is NOT covered is the React wiring
 * between the dialog and `extractText`, which `Analysis.test.tsx` covers in
 * jsdom and no CSP can affect. That gap is stated rather than papered over.
 *
 * The point is NOT coverage. It is that the binary starts, paints, responds to
 * a click, and reads a PDF without the policy refusing anything. Everything
 * deeper is cheaper to test in Vitest, and is.
 */
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { connect } from 'node:net';
import { join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { Builder, By, Capabilities, until, type WebDriver } from 'selenium-webdriver';

// The repository's own fixture builder, reused rather than re-implemented: it
// emits an uncompressed ~600-byte PDF with a real, computed xref table, from
// source a person can read. No binary fixture is ever committed here — see the
// header of that file for why.
import { makeMinimalPdf, makeScannedPdf } from '../../../packages/cv-parsing/src/test/fixtures.ts';

/**
 * The port the app's own WebDriver server listens on.
 *
 * `tauri-plugin-wdio-webdriver` reads `TAURI_WEBDRIVER_PORT` and otherwise
 * falls back to 4445 (`DEFAULT_PORT` in that crate). It is passed explicitly
 * below rather than relied on, so this file and the app agree in writing.
 */
const DRIVER_PORT = 4445;
const DRIVER_URL = `http://127.0.0.1:${DRIVER_PORT}/`;

/** How long to wait for an element. Generous: a cold WebView2 first paint is slow. */
const ELEMENT_TIMEOUT = 20_000;

/** How long to wait for the app's embedded WebDriver server to start listening. */
const DRIVER_STARTUP_TIMEOUT = 30_000;

/**
 * The heading on the first-run welcome.
 *
 * Asserted as an exact string on purpose: it is the one piece of copy that
 * proves the React bundle inside the installer actually rendered, rather than
 * the window merely existing with a title the OS took from the manifest.
 */
const WELCOME_HEADING = 'Three things this does.';

const HERE = fileURLToPath(new URL('.', import.meta.url));

/**
 * A DEBUG BUILD, NOT A RELEASE ONE. THIS IS NOT AN OVERSIGHT.
 *
 * ============================================================================
 * The binary this drives is built by `.github/workflows/smoke.yml` with
 * `--debug --features wdio`, and those two go together by force rather than by
 * habit: `src-tauri/src/lib.rs` raises a `compile_error!` if `wdio` is ever
 * enabled without debug assertions. A release build carrying the automation
 * server does not compile at all, so it cannot reach a user through anybody
 * forgetting anything. Proven, not asserted — `cargo check --release
 * --features wdio` fails with that error; `cargo check` alone does not even
 * fetch the plugin.
 *
 * A debug build is still the real application: the real toolchain, the real
 * WebView2, the real bundled frontend. Tauri's CLI documentation notes that
 * with `--debug` "the bundler etc. will do the same as they would in the
 * actual release mode", so the same installers come out, under
 * `target/debug/bundle`. Only the Rust optimisation level differs.
 *
 * Overridable so a developer who has built the other profile by hand can point
 * this at it without editing the file — though a release binary has no
 * WebDriver server compiled into it, by design, so it will not be drivable.
 */
const BUILD_PROFILE = process.env.SMOKE_PROFILE ?? 'debug';
const BUILD_DIRECTORY = resolve(HERE, '..', 'src-tauri', 'target', BUILD_PROFILE);

/**
 * What Tauri may have called the executable.
 *
 * Tauri v2 derives it from `mainBinaryName`, falling back to the Cargo package
 * name — but it also renames the binary to `productName` in some versions, and
 * the two differ here (`light` vs `CViper Light`). Rather than pin a guess that
 * goes stale at the next CLI bump, both are tried and a miss reports what IS in
 * the directory. A wrong guess must never look like a missing build.
 *
 * Settled by the build logs: they report
 * `Built application at: ...\target\debug\light.exe`, so the Cargo package
 * name wins over `productName`.
 */
const BINARY_CANDIDATES = ['CViper Light.exe', 'light.exe'];

function resolveApplication(): string {
  for (const name of BINARY_CANDIDATES) {
    const candidate = join(BUILD_DIRECTORY, name);
    if (existsSync(candidate)) return candidate;
  }

  const listing = existsSync(BUILD_DIRECTORY)
    ? readdirSync(BUILD_DIRECTORY)
        .filter((entry) => entry.endsWith('.exe'))
        .join(', ')
    : `(no ${BUILD_PROFILE} directory at all)`;

  throw new Error(
    `No built application found in ${BUILD_DIRECTORY}.\n` +
      `Tried: ${BINARY_CANDIDATES.join(', ')}\n` +
      `Executables actually there: ${listing || '(none)'}\n\n` +
      'This spec drives the REAL binary and deliberately does not build it. ' +
      'CI builds it in its own step; locally a human runs ' +
      '`pnpm --filter @cviper/light tauri build --debug` first (never an agent — ' +
      'see CLAUDE.md). Set SMOKE_PROFILE=release to drive a release build, but ' +
      'note that one has no inspector for the driver to attach to.',
  );
}

/**
 * Wait until the app's WebDriver server is accepting connections.
 *
 * The app has to boot, create its window and start the server before there is
 * anything to talk to. Connecting immediately would be a race, and "usually
 * wins the race" is how a CI job becomes flaky — a flaky guard is one people
 * start re-running instead of reading.
 */
async function waitForDriver(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const listening = await new Promise<boolean>((settle) => {
      const socket = connect({ port, host: '127.0.0.1' });
      const done = (value: boolean): void => {
        socket.destroy();
        settle(value);
      };
      socket.once('connect', () => done(true));
      socket.once('error', () => done(false));
      socket.setTimeout(1_000, () => done(false));
    });

    if (listening) return;
    if (Date.now() > deadline) {
      throw new Error(
        `The app's WebDriver server never started listening on 127.0.0.1:${port} within ` +
          `${timeoutMs}ms. Was the binary built with \`--features wdio\`? Without it the ` +
          'plugin is not compiled in and the app runs perfectly well with no server at all.',
      );
    }
    await new Promise((settle) => setTimeout(settle, 200));
  }
}

let driver: WebDriver | undefined;
let app: ChildProcess | undefined;
let shuttingDown = false;

/**
 * The session, or a sentence saying why there isn't one.
 *
 * A plain `driver!` would turn "the app never started" into a
 * `Cannot read properties of undefined` three frames from anything useful.
 */
function session(): WebDriver {
  if (driver === undefined) {
    throw new Error('No WebDriver session — the `before` hook did not complete.');
  }
  return driver;
}

async function visible(selector: string): Promise<void> {
  const element = await session().wait(until.elementLocated(By.css(selector)), ELEMENT_TIMEOUT);
  await session().wait(until.elementIsVisible(element), ELEMENT_TIMEOUT);
}

async function click(selector: string): Promise<void> {
  const element = await session().wait(until.elementLocated(By.css(selector)), ELEMENT_TIMEOUT);
  await session().wait(until.elementIsVisible(element), ELEMENT_TIMEOUT);
  await element.click();
}

// ── L-103: the PDF path, under the policy ───────────────────────────────────

/** How long the in-page parse may take. A cold worker start on CI is slow. */
const PARSE_TIMEOUT = 90_000;

/**
 * The text drawn into the generated PDF, and looked for in what comes back.
 *
 * Deliberately a string that appears NOWHERE else in the app. A sentinel like
 * "Analyst" could already be on screen or in the bundle, and an assertion that
 * can pass without anything having been parsed is not an assertion.
 */
const PDF_SENTINEL = 'L103 Sentinel Reinsurance Pricing Actuary Vellichor';

/** Console text that means the policy refused something. */
const CSP_IN_CONSOLE = /Refused to |Content Security Policy|violated directive/i;

interface CspViolation {
  readonly directive: string;
  readonly blocked: string;
  readonly source: string;
}

/** What the in-page observer saw. */
interface PageObservations {
  readonly console: readonly string[];
  readonly violations: readonly CspViolation[];
  readonly workers: readonly string[];
  readonly wasm: readonly string[];
}

/** The result of the in-page parse. */
interface ParseRun {
  readonly state: 'running' | 'done' | 'failed';
  readonly error?: string;
  readonly text?: string;
  readonly pageCount?: number;
  readonly chunkUrl?: string;
  readonly workerUrl?: string;
  readonly fontProbe?: number;
  readonly cmapProbe?: number;
}

/**
 * Install the observer.
 *
 * ==========================================================================
 * THE PAGE HAS TO WATCH ITSELF. THERE IS NO LOG ENDPOINT TO ASK.
 * ==========================================================================
 * W3C WebDriver has no console-log command, and `tauri-plugin-wdio-webdriver`
 * implements none either — its 47 endpoints cover elements, scripts, cookies
 * and actions, and nothing that reads what the page printed. So the console is
 * captured by patching it from inside, which is the only mechanism available.
 *
 * `securitypolicyviolation` is the authoritative half, and it is the half that
 * was PROVEN to bite. A CSP breakage very often does NOT throw: the resource is
 * simply refused, the feature quietly does less, and the only trace is this
 * event. It fires on the document for anything the document initiated —
 * including a worker script the policy refuses — and carries the directive by
 * name, which a scrape of console text can only guess at.
 *
 * WHICH HALF ACTUALLY CATCHES A VIOLATION, SETTLED BY EXPERIMENT. A page-side
 * `fetch` to a host `connect-src` does not allow was planted in this function
 * and the run went red naming `connect-src` — while the captured console buffer
 * came back EMPTY. WebView2 emits a CSP refusal from the renderer itself rather
 * than through the page's `console` object, so the console scrape alone would
 * have been inert for exactly the class of failure this file exists to catch.
 *
 * Both are kept. The scrape is not decoration: it catches the messages the APP
 * emits, and the loudest of those is pdf.js announcing it is "setting up fake
 * worker" — the degradation that looks like success. But the listener is the
 * one carrying the weight, and a future author tempted to drop it for the
 * simpler-looking string match should read this paragraph first.
 *
 * `Worker` is proxied because "pdf.js worked" and "pdf.js fell back to running
 * in the main thread because it could not start its worker" print almost the
 * same thing and differ entirely. Recording the constructed worker URL settles
 * it as a fact.
 *
 * `WebAssembly` is proxied to turn the `wasmUrl`-is-unset premise from an
 * argument into an observation: whatever pdf.js does or does not attempt, the
 * run says so out loud.
 *
 * LIMITATION, stated rather than discovered later: this is installed once the
 * driver has a session, so anything refused during first paint is already gone,
 * and a violation raised INSIDE the worker's own global scope fires there, not
 * here. The worker-URL record is what covers the second gap — a worker that was
 * refused never gets constructed.
 */
const INSTALL_OBSERVER = String.raw`
const w = window;
if (w.__l103 !== undefined) return 'already-installed';

const record = { console: [], violations: [], workers: [], wasm: [] };
w.__l103 = record;

for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
  const original = console[level].bind(console);
  console[level] = function () {
    const args = Array.prototype.slice.call(arguments);
    try {
      record.console.push(level + ': ' + args.map(function (a) { return String(a); }).join(' '));
    } catch (e) {
      record.console.push(level + ': <an argument that could not be stringified>');
    }
    return original.apply(console, args);
  };
}

document.addEventListener('securitypolicyviolation', function (event) {
  record.violations.push({
    directive: String(event.violatedDirective),
    blocked: String(event.blockedURI),
    source: String(event.sourceFile) + ':' + String(event.lineNumber),
  });
});

const NativeWorker = w.Worker;
w.Worker = new Proxy(NativeWorker, {
  construct: function (target, args) {
    record.workers.push(String(args[0]));
    return Reflect.construct(target, args);
  },
});

for (const name of ['instantiate', 'instantiateStreaming', 'compile', 'compileStreaming']) {
  const original = WebAssembly[name];
  if (typeof original !== 'function') continue;
  WebAssembly[name] = function () {
    record.wasm.push(name);
    return original.apply(WebAssembly, arguments);
  };
}

return 'installed';
`;

/**
 * Parse the PDF, in the page, with the app's own pdf.js.
 *
 * ==========================================================================
 * THE ASSET URLS ARE DISCOVERED FROM THE BUNDLE, NOT GUESSED.
 * ==========================================================================
 * Vite hashes both the pdf.js chunk and the worker, so a name pinned here
 * would go stale at the next build and fail as "no PDF support" rather than as
 * "the test is out of date". They are read out of the entry chunk the page
 * actually loaded: `pdfjs.ts` reaches pdf.js through `import('pdfjs-dist')`, so
 * Vite emits it as its own chunk, and `pdfjs-assets.ts` imports the worker with
 * `?url`, so that address is a literal in the same file. A miss throws with the
 * URL it read and how many bytes it got, so a wrong guess can never look like a
 * missing feature.
 *
 * The import resolves to the module instance the app would itself have used —
 * same URL, same module map — so this is the shipped pdf.js, not a second copy.
 *
 * The two probes fetch a real font and a real cmap before parsing. They are
 * cheap and they are the half a `getDocument` call would not reach on a Latin-1
 * PDF: `connect-src 'self'` governs them, and a policy that refused them would
 * break a CJK or Word-exported CV and nothing else.
 *
 * FIRE AND FORGET, THEN POLL. The result is parked on `window` and read back by
 * a second call rather than returned from an async script, so this does not
 * depend on the plugin's `execute/async` behaving; a synchronous script and a
 * poll work the same way on every implementation.
 *
 * The slot it parks in is named by `arguments[1]`, defaulting to L-103's, so a
 * second document (L-104's scan) can be driven through this same script without
 * the two runs overwriting each other's result.
 */
const RUN_PDF_PARSE = String.raw`
const base64 = arguments[0];
const resultKey = arguments[1] || '__l103run';
const w = window;
w[resultKey] = { state: 'running' };

(async function () {
  try {
    const tag = document.querySelector('script[type="module"][src]');
    if (tag === null) {
      throw new Error('the page has no module <script src>, so the bundle cannot be located');
    }
    const entryUrl = tag.src;

    const response = await fetch(entryUrl);
    if (!response.ok) {
      throw new Error('fetching the entry chunk ' + entryUrl + ' answered ' + response.status);
    }
    const entryText = await response.text();

    const chunkMatch = entryText.match(/["'\x60](\.\/pdf-[A-Za-z0-9_-]+\.js)["'\x60]/);
    if (chunkMatch === null) {
      throw new Error(
        'no ./pdf-<hash>.js dynamic-import literal in ' + entryUrl +
          ' (' + entryText.length + ' bytes read)'
      );
    }
    const workerMatch = entryText.match(/["'\x60](\/assets\/pdf\.worker[A-Za-z0-9_.\-]*\.mjs)["'\x60]/);
    if (workerMatch === null) {
      throw new Error('no /assets/pdf.worker-<hash>.mjs literal in ' + entryUrl);
    }

    const chunkUrl = new URL(chunkMatch[1], entryUrl).href;
    const workerUrl = workerMatch[1];

    const pdfjs = await import(chunkUrl);
    if (typeof pdfjs.getDocument !== 'function') {
      throw new Error(
        chunkUrl + ' is not pdf.js: its exports are ' + Object.keys(pdfjs).join(',')
      );
    }
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

    const fontProbe = await fetch('/pdfjs/standard_fonts/FoxitSerif.pfb');
    const cmapProbe = await fetch('/pdfjs/cmaps/78-EUC-H.bcmap');

    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);

    const task = pdfjs.getDocument({
      data: bytes,
      isEvalSupported: false,
      cMapUrl: '/pdfjs/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: '/pdfjs/standard_fonts/',
    });

    const doc = await task.promise;
    let text = '';
    for (let page = 1; page <= doc.numPages; page += 1) {
      const content = await (await doc.getPage(page)).getTextContent();
      for (const item of content.items) {
        if (typeof item.str === 'string') text += item.str;
      }
    }
    const pageCount = doc.numPages;
    await task.destroy();

    w[resultKey] = {
      state: 'done',
      text: text,
      pageCount: pageCount,
      chunkUrl: chunkUrl,
      workerUrl: workerUrl,
      fontProbe: fontProbe.status,
      cmapProbe: cmapProbe.status,
    };
  } catch (error) {
    w[resultKey] = { state: 'failed', error: String((error && error.stack) || error) };
  }
})();

return 'started';
`;

/** Filled by the PDF test, read by the two that adjudicate it. */
let observations: PageObservations | undefined;
let parseRun: ParseRun | undefined;

/** The observations, or a sentence saying why there are none. */
function seen(): PageObservations {
  if (observations === undefined) {
    throw new Error('No page observations — the PDF parse test did not complete.');
  }
  return observations;
}

// ── L-104: the scanned document, under the same policy ──────────────────────

/**
 * Pages in the generated scan.
 *
 * Two rather than one, so a run that silently reparsed L-103's one-page text
 * fixture cannot satisfy this test: the page count tells the two documents
 * apart on its own, and without that the violation check could come back green
 * for the wrong document.
 */
const SCANNED_PAGE_COUNT = 2;

/**
 * Where the scanned run parks its result.
 *
 * A slot of its own. L-103's assertions read `__l103run` and a shared slot
 * would make each run's result depend on the order of the other.
 */
const SCANNED_RESULT_KEY = '__l104run';

describe('the built CViper Light binary', () => {
  before(
    async () => {
      const application = resolveApplication();

      // ------------------------------------------------------------------
      // THE APP IS THE SERVER. NOTHING ELSE IS SPAWNED.
      // ------------------------------------------------------------------
      // Runs #1-#3 spawned `tauri-driver`, which spawned `msedgedriver`, which
      // launched the app and tried to attach to it over the Chrome DevTools
      // Protocol. All three died identically, sixty seconds in:
      // `session not created: DevToolsActivePort file doesn't exist`. The
      // version pairing was exact and the paths were right; the CDP handoff
      // was the thing that did not happen. WebdriverIO's ADR-0002 records the
      // same symptom on Windows CI and calls `tauri-driver` the deprecated
      // `external` provider.
      //
      // The app now carries its own W3C WebDriver server — 47 endpoints, via
      // `tauri-plugin-wdio-webdriver` behind the `wdio` Cargo feature — so
      // there is no external driver, no CDP, and no second version to keep in
      // step with the WebView2 runtime for ever. Launch the binary, talk to it.
      //
      // `WEBVIEW2_USER_DATA_FOLDER` is deliberately still NOT set: run #1 was
      // lost to it clashing with the driver's own `--user-data-dir`. The
      // first-run assertion below is guaranteed on a CI runner, which has
      // never run this app, and on a developer machine it holds only until
      // somebody dismisses the welcome for real.
      app = spawn(application, [], {
        stdio: ['ignore', 'inherit', 'inherit'],
        env: { ...process.env, TAURI_WEBDRIVER_PORT: String(DRIVER_PORT) },
      });

      app.on('exit', (code) => {
        if (shuttingDown) return;
        // Loud, not swallowed: an app that died is not a test that passed.
        console.error(`the app exited unexpectedly with code ${String(code)}`);
        process.exitCode = 1;
      });

      // Printed because run #1 spent sixty seconds failing without anything in
      // the log saying what it was pointed at.
      console.log(`smoke: application = ${application}`);
      console.log(`smoke: webdriver   = ${DRIVER_URL}`);

      await waitForDriver(DRIVER_PORT, DRIVER_STARTUP_TIMEOUT);

      const capabilities = new Capabilities();
      capabilities.set('tauri:options', { application });
      capabilities.setBrowserName('tauri');

      driver = await new Builder().withCapabilities(capabilities).usingServer(DRIVER_URL).build();
    },
    { timeout: 120_000 },
  );

  after(async () => {
    shuttingDown = true;
    // The session first: quitting closes the window the server lives inside.
    // Killing the process out from under a live session leaves CI hanging.
    if (driver !== undefined) await driver.quit();
    app?.kill();
  });

  it('opens a window', { timeout: 60_000 }, async () => {
    assert.equal(await session().getTitle(), 'CViper Light');
  });

  it('shows the first-run welcome', { timeout: 60_000 }, async () => {
    await visible('[data-testid="welcome"]');

    const heading = await session().findElement(By.css('[data-testid="welcome"] h1')).getText();
    assert.equal(heading, WELCOME_HEADING);
  });

  it('opens Settings', { timeout: 60_000 }, async () => {
    await click('[data-testid="welcome-skip"]');
    await click('[data-testid="nav-settings"]');
    await visible('[data-testid="view-settings"]');
  });

  it('shows the Privacy section in Settings', { timeout: 60_000 }, async () => {
    await visible('[data-testid="privacy-notice"]');
  });

  // ── L-103: the PDF path, under the policy ─────────────────────────────────

  it('runs script in the page and installs the observer', { timeout: 60_000 }, async () => {
    const installed = await session().executeScript<string>(INSTALL_OBSERVER);
    assert.equal(
      installed,
      'installed',
      'The observer did not install, which would leave every assertion below reading nothing.',
    );
  });

  it('parses a generated PDF CV with the app’s own pdf.js', { timeout: 180_000 }, async () => {
    const pdf = makeMinimalPdf(PDF_SENTINEL);

    const started = await session().executeScript<string>(
      RUN_PDF_PARSE,
      Buffer.from(pdf).toString('base64'),
    );
    assert.equal(started, 'started');

    await session().wait(async () => {
      const state = await session().executeScript<string | null>(
        'return window.__l103run ? window.__l103run.state : null;',
      );
      return state === 'done' || state === 'failed';
    }, PARSE_TIMEOUT);

    parseRun = await session().executeScript<ParseRun>('return window.__l103run;');
    observations = await session().executeScript<PageObservations>('return window.__l103;');

    // Printed unconditionally, before any assertion can end the test. A red run
    // is read out of the CI log, and this is the only place any of it exists.
    console.log(
      `smoke: pdf run    = state=${parseRun.state} pages=${String(parseRun.pageCount)} ` +
        `chars=${String(parseRun.text?.length)} font=${String(parseRun.fontProbe)} ` +
        `cmap=${String(parseRun.cmapProbe)}`,
    );
    console.log(`smoke: pdf chunk  = ${String(parseRun.chunkUrl)}`);
    console.log(`smoke: pdf worker = ${String(parseRun.workerUrl)}`);
    console.log(`smoke: workers    = ${JSON.stringify(seen().workers)}`);
    console.log(`smoke: wasm calls = ${JSON.stringify(seen().wasm)}`);
    console.log(`smoke: violations = ${JSON.stringify(seen().violations)}`);
    for (const line of seen().console) console.log(`smoke: page > ${line}`);

    assert.equal(
      parseRun.state,
      'done',
      `the in-page PDF parse failed: ${parseRun.error ?? '(no detail reported)'}`,
    );
    assert.equal(parseRun.pageCount, 1);
    assert.ok(
      parseRun.text?.includes(PDF_SENTINEL),
      `the extracted text did not contain the sentinel. Got: ${JSON.stringify(parseRun.text)}`,
    );
    // The two directories the Vite plugin copies. A CV exported from Word leans
    // on the standard-14 metrics and a CJK one needs the cmaps, so a policy or
    // a build that refused these would break real CVs and no Latin-1 fixture.
    assert.equal(parseRun.fontProbe, 200, 'the standard-font directory was not served');
    assert.equal(parseRun.cmapProbe, 200, 'the cmap directory was not served');
  });

  it('drove pdf.js through its real, same-origin worker', { timeout: 60_000 }, async () => {
    const workers = seen().workers;
    const pdfWorkers = workers.filter((url) => /\/assets\/pdf\.worker/.test(url));

    assert.ok(
      pdfWorkers.length > 0,
      'pdf.js constructed no worker at all. It falls back to running in the main thread when ' +
        'the worker cannot start — which is exactly what `worker-src` refusing the script looks ' +
        'like — and the text still comes out either way, so this is the only thing that tells ' +
        `the two apart. Workers seen: ${JSON.stringify(workers)}`,
    );

    for (const url of pdfWorkers) {
      assert.ok(
        !url.startsWith('blob:'),
        `pdf.js wrapped its worker in a blob: URL (${url}), which it only does when it judges ` +
          'the script cross-origin. The policy names no blob: source, so a shipped build would ' +
          'refuse it. See the same-origin note in packages/cv-parsing/src/pdfjs.ts.',
      );
    }
  });

  it('finished with no Content-Security-Policy violation', { timeout: 60_000 }, async () => {
    // THE assertion this whole half exists for. A CSP breakage usually does not
    // throw — the resource is refused, the feature quietly does less, and the
    // only trace is this event and a console line.
    const violations = seen().violations;
    assert.deepEqual(
      violations,
      [],
      'The policy refused something while the app parsed a PDF:\n' +
        violations
          .map((entry) => `  ${entry.directive} blocked ${entry.blocked} (${entry.source})`)
          .join('\n'),
    );

    const refusals = seen().console.filter((line) => CSP_IN_CONSOLE.test(line));
    assert.deepEqual(
      refusals,
      [],
      `The page logged a Content-Security-Policy refusal:\n${refusals.join('\n')}`,
    );
  });

  // ── L-104: the scanned document, under the same policy ────────────────────

  it(
    'parses a generated scan — pages, no text layer — with no policy violation',
    { timeout: 180_000 },
    async () => {
      const scanned = makeScannedPdf(SCANNED_PAGE_COUNT);
      const earlier = seen();

      // TEMPORARY — L-104 plant, removed before merge. A page-side fetch to a
      // host `connect-src` does not allow, issued on the scanned path only, so
      // the violation lands after L-103's snapshot was taken and can only be
      // caught by the check below. See the PR body for the red run it produced.
      await session().executeScript(
        "fetch('https://l104-planted-violation.invalid/csp-probe').catch(function () {});",
      );

      const started = await session().executeScript<string>(
        RUN_PDF_PARSE,
        Buffer.from(scanned).toString('base64'),
        SCANNED_RESULT_KEY,
      );
      assert.equal(started, 'started');

      await session().wait(async () => {
        const state = await session().executeScript<string | null>(
          `return window.${SCANNED_RESULT_KEY} ? window.${SCANNED_RESULT_KEY}.state : null;`,
        );
        return state === 'done' || state === 'failed';
      }, PARSE_TIMEOUT);

      const scanRun = await session().executeScript<ParseRun>(
        `return window.${SCANNED_RESULT_KEY};`,
      );

      // Read FRESH rather than reusing L-103's snapshot. The observer's record
      // is one accumulating object, so this is everything the page has seen
      // across BOTH parses; sliced against the earlier snapshot, what is left is
      // what this parse alone caused.
      const total = await session().executeScript<PageObservations>('return window.__l103;');
      const newConsole = total.console.slice(earlier.console.length);
      const newWorkers = total.workers.slice(earlier.workers.length);

      // Printed unconditionally, before any assertion can end the test.
      console.log(
        `smoke: scan run   = state=${scanRun.state} pages=${String(scanRun.pageCount)} ` +
          `chars=${String(scanRun.text?.length)} font=${String(scanRun.fontProbe)} ` +
          `cmap=${String(scanRun.cmapProbe)}`,
      );
      console.log(`smoke: scan workers    = ${JSON.stringify(newWorkers)}`);
      // REPORTED, NOT ASSERTED. Whether pdf.js reaches for WebAssembly on a
      // document with no text layer is the open question this run answers out
      // loud; pinning it to `[]` would freeze today's answer into a rule. The
      // assertion that matters is the violation check below — a refused
      // `WebAssembly.compile` raises `script-src`, and that is caught there.
      console.log(`smoke: scan wasm calls = ${JSON.stringify(total.wasm)}`);
      console.log(`smoke: scan violations = ${JSON.stringify(total.violations)}`);
      for (const line of newConsole) console.log(`smoke: scan page > ${line}`);

      assert.equal(
        scanRun.state,
        'done',
        `the in-page scanned-PDF parse failed: ${scanRun.error ?? '(no detail reported)'}`,
      );

      // Two pages and not one character of text: proof this was the SCAN, not a
      // silent second run of the one-page text fixture. Without it the violation
      // check could pass on the wrong document.
      assert.equal(scanRun.pageCount, SCANNED_PAGE_COUNT);
      assert.equal(
        scanRun.text,
        '',
        'a scan has no text layer, so pdf.js should have returned no text items. ' +
          `Got: ${JSON.stringify(scanRun.text)}`,
      );

      // THE assertion. Cumulative, so a violation raised by either parse fails
      // here; L-103's own check reads its snapshot from before this parse
      // existed, so that one stays answerable for the text PDF alone.
      assert.deepEqual(
        total.violations,
        [],
        'The policy refused something while the app parsed a SCANNED PDF:\n' +
          total.violations
            .map((entry) => `  ${entry.directive} blocked ${entry.blocked} (${entry.source})`)
            .join('\n'),
      );
    },
  );
});
