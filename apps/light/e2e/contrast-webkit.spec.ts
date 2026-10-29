/**
 * Colour contrast, measured on the rendered app (L-300, from L-237).
 *
 * ============================================================================
 * THE GAP THIS CLOSES
 * ============================================================================
 * `src/styles/contrast.contract.test.ts` pairs a text colour with a background
 * colour when both appear in the same class string, and its own header lists
 * what that cannot see: a background a PARENT paints, classes built by
 * concatenation, inline style — "those need a rendered check". The axe pass in
 * `src/app/a11y.axe.test.tsx` runs in jsdom, which paints nothing, so axe
 * reports colour contrast there as "incomplete", never as passed.
 *
 * So this builds the real app (`e2e/contrast/`, see `harness.tsx`), opens it in
 * Playwright's WebKit, and asks axe-core's `color-contrast` rule — WCAG 2.1 AA,
 * 4.5:1 for normal text and 3:1 for large — about every main screen and the
 * states a user reaches in their first minute, at a desktop width and a phone
 * width.
 *
 * ============================================================================
 * HONEST LIMITS
 * ============================================================================
 *   - axe marks some text "incomplete" when it cannot tell what is behind it (a
 *     gradient, an image, text overlapping another element). Those are counted
 *     and printed, not failed: a check that fails on "could not tell" is one
 *     people learn to ignore.
 *   - Only the states listed below are drawn. Error states and dialogs are not.
 *   - The light theme only: the app has no dark theme, and
 *     `contrast.contract.test.ts` fails the day one appears.
 *
 * Runs in ci.yml's `webkit` job through `pnpm webkit`, with the pdf.js check.
 * Like that check, a missing browser is a failure, not a skip.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import type axeCore from 'axe-core';
import { webkit, type Browser, type Page } from 'playwright-core';

const HERE = fileURLToPath(new URL('.', import.meta.url));

/** What `pnpm webkit:build` produces for this page. */
const DIST = join(HERE, 'contrast', 'dist');

const AXE_SOURCE = createRequire(import.meta.url).resolve('axe-core/axe.min.js');

/** The screens behind the nav, by their `nav-<id>` test id. */
const VIEWS = ['profile', 'search', 'tracker', 'analysis', 'tailor', 'settings'] as const;

const VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  phone: { width: 390, height: 844 },
} as const;

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.json': 'application/json',
};

async function serve(): Promise<{ origin: string; server: Server }> {
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    const relative = normalize(path === '/' ? '/index.html' : path).replace(/^[\\/]+/, '');
    const file = resolve(DIST, relative);
    if (file !== DIST && !file.startsWith(DIST + sep)) {
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
  if (address === null || typeof address === 'string') throw new Error('no TCP port');
  return { origin: `http://127.0.0.1:${String(address.port)}`, server };
}

interface ContrastReport {
  /** Rule passes: proof the rule looked at real text, not an empty page. */
  readonly checked: number;
  readonly failures: readonly string[];
  readonly incomplete: number;
}

/** Run axe's colour-contrast rule over the whole page. */
async function contrast(page: Page): Promise<ContrastReport> {
  await page.addScriptTag({ path: AXE_SOURCE });
  return page.evaluate(async () => {
    const axe = (window as unknown as { axe: typeof axeCore }).axe;
    const result = await axe.run(document, {
      runOnly: { type: 'rule', values: ['color-contrast'] },
      resultTypes: ['violations', 'incomplete', 'passes'],
    });
    const failures = result.violations.flatMap((v) =>
      v.nodes.map((n) => `${n.target.join(' ')} — ${n.failureSummary ?? v.help}`),
    );
    const checked = result.passes.reduce((sum, p) => sum + p.nodes.length, 0);
    const incomplete = result.incomplete.reduce((sum, p) => sum + p.nodes.length, 0);
    return { checked, failures, incomplete };
  });
}

let browser: Browser;
let origin: string;
let server: Server;

before(async () => {
  assert.ok(
    existsSync(join(DIST, 'index.html')),
    `${DIST} is missing. Run \`pnpm webkit:build\` first (\`pnpm webkit\` does both).`,
  );
  ({ origin, server } = await serve());
  // No existsSync guard and no skip: if WebKit is not installed this throws and
  // every test below goes red, naming the install command in the error.
  browser = await webkit.launch();
});

after(async () => {
  await browser?.close();
  await new Promise<void>((done) => server?.close(() => done()));
});

async function open(query: string, viewport: { width: number; height: number }): Promise<Page> {
  const context = await browser.newContext({ viewport, colorScheme: 'light' });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${origin}/${query}`);
  await page.waitForSelector('[data-testid="welcome"], [data-testid="shell"]');
  // Web fonts change glyph sizes, and axe's large-text rule depends on size.
  await page.evaluate(() => document.fonts.ready);
  assert.deepEqual(errors, [], 'the app threw while drawing');
  // An unstyled page is black on white and passes every contrast rule. So
  // prove the app's own tokens are painted before measuring anything: the
  // page surface is `--color-canvas`, #f7f8fa.
  const surface = await page.evaluate(() => {
    const shell = document.querySelector('[data-testid="shell"], [data-testid="welcome"]');
    let node: Element | null = shell;
    while (node !== null) {
      const colour = getComputedStyle(node).backgroundColor;
      if (colour !== 'rgba(0, 0, 0, 0)' && colour !== 'transparent') return colour;
      node = node.parentElement;
    }
    return getComputedStyle(document.body).backgroundColor;
  });
  assert.notEqual(surface, 'rgba(0, 0, 0, 0)', 'no painted surface: the stylesheet did not load');
  assert.notEqual(surface, 'rgb(255, 255, 255)', 'white page: the theme did not load');
  return page;
}

/**
 * Open a screen from the nav that is on show. The side rail and the phone's
 * bottom bar carry the same `nav-<id>` test ids, and only one is visible.
 */
async function goTo(page: Page, view: string): Promise<void> {
  await page.locator(`[data-testid="nav-${view}"]:visible`).click();
  await page.locator(`[data-testid="nav-${view}"][aria-current="page"]:visible`).waitFor();
}

/** One line per state, so a CI log shows what was measured as well as what failed. */
function judge(name: string, report: ContrastReport): void {
  console.log(
    `${name}: ${String(report.checked)} text nodes passed, ` +
      `${String(report.failures.length)} failed, ${String(report.incomplete)} undecided`,
  );
  // A state with almost no text measured did not draw. Every screen has a
  // header, a nav and body copy.
  assert.ok(report.checked >= 10, `${name}: only ${String(report.checked)} text nodes measured`);
  assert.deepEqual(report.failures, [], `${name}: text below WCAG AA contrast`);
}

describe('colour contrast on the rendered app (WCAG 2.1 AA)', () => {
  it('the first-run welcome screen', async () => {
    const page = await open('', VIEWPORTS.desktop);
    judge('welcome', await contrast(page));
    await page.context().close();
  });

  for (const [width, viewport] of Object.entries(VIEWPORTS)) {
    for (const view of VIEWS) {
      it(`the ${view} screen, ${width}`, async () => {
        const page = await open('?seen=1', viewport);
        await goTo(page, view);
        judge(`${view} (${width})`, await contrast(page));
        await page.context().close();
      });
    }
  }

  it('the sample result on the CV check', async () => {
    const page = await open('?seen=1', VIEWPORTS.desktop);
    await goTo(page, 'analysis');
    await page.click('[data-testid="analysis-try-sample"]');
    await page.waitForSelector('[data-testid="analysis-sample"]');
    // The result itself, not just its frame: the score and the skill lists.
    await page.waitForSelector('[data-testid="analysis-sample"] [data-testid="analysis-proof"]', {
      state: 'attached',
    });
    judge('sample result', await contrast(page));
    await page.context().close();
  });

  // NEGATIVE — a check that cannot fail is not a check. Grey #aaa on the
  // app's white card is 2.3:1, and must be caught on the real, styled page.
  it('the check itself: text below 4.5:1 on the styled page is caught', async () => {
    const page = await open('?seen=1', VIEWPORTS.desktop);
    await page.evaluate(() => {
      const probe = document.createElement('p');
      probe.dataset.testid = 'contrast-probe';
      probe.textContent = 'This sentence is too pale to read.';
      probe.style.cssText = 'color:#aaaaaa;background:#ffffff;font-size:14px';
      document.querySelector('main')?.prepend(probe);
    });
    const report = await contrast(page);
    assert.ok(
      report.failures.some((line) => line.includes('contrast-probe')),
      `the pale probe was not flagged: ${JSON.stringify(report.failures)}`,
    );
    await page.context().close();
  });

  it('a board with applications, and one opened at interview stage', async () => {
    const page = await open('?seen=1&entries=1', VIEWPORTS.desktop);
    await goTo(page, 'tracker');
    await page.waitForSelector('[data-testid="tracker-card-c"]');
    judge('board', await contrast(page));
    await page.click('[data-testid="tracker-card-c"]');
    await page.waitForSelector('[data-testid="detail-pane"]');
    judge('opened application', await contrast(page));
    await page.context().close();
  });
});

/**
 * Tracker column headings whose content is wider than the heading (L-311).
 *
 * With an application open the board's columns shrink to their minimum, and
 * the Interviewing heading — its name, "Edit stages" and the count — was wider
 * than that: the count ran into the next column's name ("1OFFER"). jsdom does
 * no layout, so only a real engine can see this.
 */
async function overflowingColumnHeadings(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-testid^="tracker-count-"]')].flatMap((count) => {
      const header = count.closest('header');
      if (header === null) return [`${count.getAttribute('data-testid') ?? '?'}: no header`];
      const over = header.scrollWidth - header.clientWidth;
      return over > 0
        ? [`${count.getAttribute('data-testid') ?? '?'}: ${String(over)}px too wide`]
        : [];
    }),
  );
}

describe('the Tracker board lays out (L-311)', () => {
  for (const width of [1024, 1280, 1440]) {
    it(`every column heading fits its column at ${String(width)}px, with an application open`, async () => {
      const page = await open('?seen=1&entries=1', { width, height: 800 });
      await goTo(page, 'tracker');
      await page.waitForSelector('[data-testid="tracker-card-c"]');
      await page.click('[data-testid="tracker-card-c"]');
      await page.waitForSelector('[data-testid="detail-pane"]');
      const counts = await page.locator('[data-testid^="tracker-count-"]').count();
      assert.ok(counts >= 5, `only ${String(counts)} column headings drawn`);
      assert.deepEqual(await overflowingColumnHeadings(page), []);
      await page.context().close();
    });
  }

  it('the check can fail: a heading pushed wider than its column is reported', async () => {
    const page = await open('?seen=1&entries=1', VIEWPORTS.desktop);
    await goTo(page, 'tracker');
    await page.waitForSelector('[data-testid="tracker-count-offer"]');
    await page.evaluate(() => {
      const count = document.querySelector('[data-testid="tracker-count-offer"]');
      if (count !== null) count.textContent = '0'.repeat(400);
    });
    const report = await overflowingColumnHeadings(page);
    assert.ok(
      report.some((line) => line.startsWith('tracker-count-offer')),
      `the widened heading was not flagged: ${JSON.stringify(report)}`,
    );
    await page.context().close();
  });
});
