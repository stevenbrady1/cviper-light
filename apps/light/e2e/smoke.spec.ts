/**
 * Four questions asked of the REAL built binary (L-88).
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
 * the note on the build profile below for why that profile is `debug` —
 * driven through `tauri-driver`, in CI, on Windows, where a build is allowed.
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
 * FOUR ASSERTIONS, ONE SESSION, IN ORDER
 * ============================================================================
 * The window opens, the first-run welcome is shown, Settings opens, and the
 * Privacy section is visible. They share one app session and each moves it
 * along, so they run in declaration order — `node:test` guarantees that within
 * a file. Four cheap questions, no API key, no network: everything asserted
 * here is true of a machine that has never seen this app and is offline.
 *
 * The point is NOT coverage. It is that the binary starts, paints, and
 * responds to a click. Everything deeper is cheaper to test in Vitest, and is.
 */
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { connect } from 'node:net';
import { join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { Builder, By, Capabilities, until, type WebDriver } from 'selenium-webdriver';

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
 * Run #1 settled it for now: the build log said
 * `Built application at: ...\target\release\light.exe`.
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
});
