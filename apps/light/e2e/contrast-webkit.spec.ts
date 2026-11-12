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

/**
 * The funnel strip above the board wraps on a phone and never runs past the
 * window (L-383). "Applied so far" and "Interviewed so far" made two labels
 * longer, so at 375px the strip may take one more row, never a sideways scroll.
 */
async function funnelOverflow(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const strip = document.querySelector('[data-testid="tracker-funnel"]');
    if (strip === null) return ['no funnel strip'];
    const over: string[] = [];
    const root = document.documentElement;
    if (root.scrollWidth > root.clientWidth) {
      over.push(`page: ${String(root.scrollWidth - root.clientWidth)}px too wide`);
    }
    if (strip.scrollWidth > strip.clientWidth) {
      over.push(`strip: ${String(strip.scrollWidth - strip.clientWidth)}px too wide`);
    }
    for (const part of strip.querySelectorAll('dt, dd, p')) {
      const right = part.getBoundingClientRect().right;
      if (right > root.clientWidth + 0.5) {
        over.push(`"${part.textContent ?? ''}" ends at ${String(right)}px`);
      }
    }
    return over;
  });
}

describe('the Tracker funnel strip fits a phone (L-383)', () => {
  it('at 375px the strip wraps and nothing runs past the window', async () => {
    const page = await open('?seen=1&entries=1', { width: 375, height: 700 });
    await goTo(page, 'tracker');
    await page.waitForSelector('[data-testid="tracker-funnel"]');
    const height = await page.evaluate(
      () =>
        document.querySelector('[data-testid="tracker-funnel"]')?.getBoundingClientRect().height,
    );
    console.log(`funnel strip at 375px: ${String(height)}px tall`);
    assert.deepEqual(await funnelOverflow(page), []);
    await page.context().close();
  });

  it('the check can fail: a label too wide for the window is reported', async () => {
    const page = await open('?seen=1&entries=1', { width: 375, height: 700 });
    await goTo(page, 'tracker');
    await page.waitForSelector('[data-testid="tracker-funnel"]');
    await page.evaluate(() => {
      const label = document.querySelector('[data-testid="tracker-funnel"] dt');
      if (label !== null) label.textContent = 'W'.repeat(200);
    });
    const report = await funnelOverflow(page);
    assert.ok(report.length > 0, 'the widened label was not flagged');
    await page.context().close();
  });
});

/**
 * The shared content column (L-341) never makes a screen scroll sideways.
 *
 * jsdom does no layout, so `contentColumn.contract.test.tsx` can only read the
 * classes. Here the real engine measures, at 1000px — a narrow desktop window,
 * where the column's `max-w-5xl` (1024px) plus the rail is wider than the
 * window and the column must give way, not overflow — and at 768 and 375.
 *
 * L-326 centred the column. At 1440 and 1920 it is 1024px with equal gaps each
 * side, and the page title starts where the column starts. The Tracker board
 * is not in it, and is measured wider than 1024px.
 */
const COLUMN_VIEWS = ['profile', 'search', 'settings', 'analysis', 'tailor'] as const;

async function sidewaysOverflow(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const over: string[] = [];
    const root = document.documentElement;
    if (root.scrollWidth > root.clientWidth) {
      over.push(`page: ${String(root.scrollWidth - root.clientWidth)}px too wide`);
    }
    const column = document.querySelector('[data-content-column]');
    const area = column?.parentElement?.closest('.overflow-y-auto');
    if (column === null || column === undefined || area === null || area === undefined) {
      return [...over, 'no content column inside a scroll area'];
    }
    if (area.scrollWidth > area.clientWidth) {
      over.push(`scroll area: ${String(area.scrollWidth - area.clientWidth)}px too wide`);
    }
    return over;
  });
}

/** Where the column sits in its scroll area, and where the page title's row starts. */
async function columnBox(page: Page): Promise<{
  width: number;
  left: number;
  gapLeft: number;
  gapRight: number;
  areaInner: number;
  titleLeft: number;
}> {
  return page.evaluate(() => {
    const column = document.querySelector('[data-content-column]');
    const area = column?.parentElement?.closest('.overflow-y-auto');
    const title = column?.closest('section')?.querySelector('header h1');
    if (!column || !area || !title) throw new Error('no column, scroll area or page title');
    const box = column.getBoundingClientRect();
    const inner = area.getBoundingClientRect();
    const style = getComputedStyle(area);
    const padLeft = parseFloat(style.paddingLeft);
    const padRight = parseFloat(style.paddingRight);
    // The title's row: the header's first child, which carries the column's width.
    const row = title.closest('header')?.firstElementChild ?? title;
    return {
      width: box.width,
      left: box.left,
      gapLeft: box.left - (inner.left + padLeft),
      gapRight: inner.left + area.clientWidth - padRight - box.right,
      areaInner: area.clientWidth - padLeft - padRight,
      titleLeft: row.getBoundingClientRect().left,
    };
  });
}

describe('the shared content column fits the window (L-341, L-326)', () => {
  for (const viewport of [
    { width: 1000, height: 700 },
    { width: 768, height: 700 },
    { width: 375, height: 700 },
  ]) {
    for (const view of COLUMN_VIEWS) {
      it(`the ${view} screen has no sideways scroll at ${String(viewport.width)}px`, async () => {
        const page = await open('?seen=1', viewport);
        await goTo(page, view);
        await page.waitForSelector('[data-content-column]');
        const box = await columnBox(page);
        console.log(`${view} at ${String(viewport.width)}px: column ${String(box.width)}px wide`);
        assert.ok(box.width > 0 && box.width <= 1024, `${view}: column ${String(box.width)}px`);
        assert.ok(box.width <= box.areaInner + 0.5, `${view}: column wider than its area`);
        assert.deepEqual(await sidewaysOverflow(page), []);
        await page.context().close();
      });
    }
  }

  for (const width of [1440, 1920]) {
    for (const view of COLUMN_VIEWS) {
      it(`the ${view} screen at ${String(width)}px: a 1024px column with equal gaps`, async () => {
        const page = await open('?seen=1', { width, height: 900 });
        await goTo(page, view);
        await page.waitForSelector('[data-content-column]');
        const box = await columnBox(page);
        console.log(`${view} at ${String(width)}px: ${JSON.stringify(box)}`);
        assert.equal(Math.round(box.width), 1024, `${view}: column ${String(box.width)}px`);
        assert.ok(box.gapLeft > 0, `${view}: no gap left of the column`);
        assert.ok(Math.abs(box.gapLeft - box.gapRight) <= 1, `${view}: gaps are not equal`);
        // The page title lines up with the column, not the far left (owner decision 2).
        assert.ok(Math.abs(box.titleLeft - box.left) <= 1, `${view}: title not in line`);
        assert.deepEqual(await sidewaysOverflow(page), []);
        await page.context().close();
      });
    }
  }

  it('negative: the Tracker board is NOT held to 1024px — wider than that at 1920', async () => {
    const page = await open('?seen=1&entries=1', { width: 1920, height: 900 });
    await goTo(page, 'tracker');
    await page.waitForSelector('[data-testid="tracker-card-c"]');
    const board = await page.evaluate(() => {
      const view = document.querySelector('[data-testid="view-tracker"]');
      const boxes = [...(view?.querySelectorAll('[data-testid^="tracker-column-"]') ?? [])].map(
        (column) => column.getBoundingClientRect(),
      );
      return {
        columns: view?.querySelectorAll('[data-content-column]').length ?? -1,
        width:
          Math.max(...boxes.map((box) => box.right)) - Math.min(...boxes.map((box) => box.left)),
      };
    });
    console.log(`tracker at 1920px: board ${String(board.width)}px wide`);
    assert.equal(board.columns, 0);
    assert.ok(board.width > 1024, `board only ${String(board.width)}px wide`);
    await page.context().close();
  });

  it('the check can fail: content wider than the window is reported', async () => {
    const page = await open('?seen=1', { width: 1000, height: 800 });
    await goTo(page, 'search');
    await page.waitForSelector('[data-content-column]');
    await page.evaluate(() => {
      const wide = document.createElement('div');
      wide.style.width = '3000px';
      wide.style.height = '1px';
      document.querySelector('[data-content-column]')?.append(wide);
    });
    const report = await sidewaysOverflow(page);
    assert.ok(
      report.some((line) => line.startsWith('scroll area')),
      `the widened column was not flagged: ${JSON.stringify(report)}`,
    );
    await page.context().close();
  });
});

/**
 * The Search button stays on screen on short windows (L-342).
 *
 * The form runs fields, then a tall "Where to look" box, then the submit row,
 * and the app's smallest window is 1000×700: the row used to fall below the
 * bottom edge, so a person saw neither the button nor why it was grey. It is
 * now sticky to the bottom of the scroll area from `md:` up, and in the form's
 * flow, so it sits in its natural place when there is room and scrolls away
 * with the form when the user scrolls on to the results.
 *
 * jsdom does no layout, so whether any of that is true is only knowable here.
 */
const SEARCH_AREA = '[data-testid="view-search"] .overflow-y-auto';
const SUBMIT_ROW = '[data-testid="search-submit-row"]';
const SMALLEST_WINDOW = { width: 1000, height: 700 };
const NARROWEST_STICKY = { width: 768, height: 700 };

/** Search with the owner's typing: a grey button, its reason, and the Reed fix. */
async function openTypedSearch(
  viewport: { width: number; height: number },
  query = '?seen=1',
): Promise<Page> {
  const page = await open(query, viewport);
  await goTo(page, 'search');
  await page.fill('[data-testid="search-keywords"]', 'Project Coordinator');
  await page.fill('[data-testid="search-location"]', 'London');
  if (query === '?seen=1') await page.waitForSelector('[data-testid="search-get-reed-key"]');
  return page;
}

/** What is wrong with what the user can see of the row. Empty means all is well. */
async function submitRowProblems(
  page: Page,
  parts: readonly string[] = ['search-submit', 'search-reason', 'search-get-reed-key'],
): Promise<string[]> {
  return page.evaluate(
    ({ areaSelector, ids }) => {
      const area = document.querySelector(areaSelector);
      if (area === null) return ['no scroll area'];
      const seen = area.getBoundingClientRect();
      return ids.flatMap((id) => {
        const part = document.querySelector(`[data-testid="${id}"]`);
        if (part === null) return [`${id}: not drawn`];
        const box = part.getBoundingClientRect();
        if (box.top < seen.top || box.bottom > seen.bottom) {
          return [
            `${id}: ${String(box.top)}–${String(box.bottom)} is outside the scroll area's ` +
              `${String(seen.top)}–${String(seen.bottom)}`,
          ];
        }
        const onTop = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return onTop !== null && part.contains(onTop) ? [] : [`${id}: something is on top of it`];
      });
    },
    { areaSelector: SEARCH_AREA, ids: parts },
  );
}

/** Open "More boards", then back to the top: pressing it scrolls it clear of the row. */
async function pressMoreBoards(page: Page): Promise<void> {
  await page.click('[data-testid="keyless-more"]');
  await page.waitForSelector('[data-testid="keyless-more"][aria-expanded="true"]');
  await scrollAreaTo(page, 0);
}

/**
 * The tallest form a real user reaches at the smallest window: a job-board key
 * saved, so the keyed boards show, and "More boards" open. The Search button
 * itself runs past the bottom of the window here if nothing holds it up.
 */
async function openTallestSearch(viewport: { width: number; height: number }): Promise<Page> {
  const page = await openTypedSearch(viewport, '?seen=1&results=1');
  await pressMoreBoards(page);
  return page;
}

/**
 * The same form with nothing ticked, so the reason shows too. At the narrowest
 * sticky width the ticks wrap, and the row really does cover the last of them.
 */
async function openTicksUnderTheRow(): Promise<Page> {
  const page = await openTallestSearch(NARROWEST_STICKY);
  const ticked = page.locator('[data-testid="search-where"] input:checked');
  while ((await ticked.count()) > 0) await ticked.first().uncheck();
  await page.waitForSelector('[data-testid="search-reason"]');
  await scrollAreaTo(page, 0);
  return page;
}

/** The row's top where it is, and where it would be if it were not sticky. */
async function rowAgainstFlow(page: Page): Promise<{ top: number; inFlow: number }> {
  return page.evaluate((selector) => {
    const row = document.querySelector<HTMLElement>(selector);
    if (row === null) throw new Error('no submit row');
    const top = row.getBoundingClientRect().top;
    row.style.position = 'static';
    const inFlow = row.getBoundingClientRect().top;
    row.style.position = '';
    return { top, inFlow };
  }, SUBMIT_ROW);
}

async function scrollAreaTo(page: Page, top: number): Promise<void> {
  await page.evaluate(
    ({ selector, to }) => {
      const area = document.querySelector(selector);
      if (area === null) throw new Error('no scroll area');
      area.scrollTop = to;
    },
    { selector: SEARCH_AREA, to: top },
  );
}

/** Focus each control in "Where to look" in turn; report any the row then hides. */
async function focusedControlsUnderTheRow(page: Page): Promise<string[]> {
  return page.evaluate(
    async ({ areaSelector, rowSelector }) => {
      const area = document.querySelector(areaSelector);
      const row = document.querySelector(rowSelector);
      const controls = [
        ...document.querySelectorAll<HTMLElement>(
          '[data-testid="search-where"] :is(input, button, [tabindex="0"])',
        ),
      ];
      if (area === null || row === null || controls.length === 0) return ['nothing to measure'];
      const problems: string[] = [];
      for (const control of controls) {
        // From the top each time: the hardest start, and what a click on the field does.
        (document.activeElement as HTMLElement | null)?.blur();
        area.scrollTop = 0;
        control.focus();
        // WebKit brings a focused box into view in a later frame, not during `focus()`.
        await new Promise((done) => requestAnimationFrame(done));
        await new Promise((done) => requestAnimationFrame(done));
        const name = control.dataset.testid ?? '?';
        const over = control.getBoundingClientRect().bottom - row.getBoundingClientRect().top;
        if (document.activeElement !== control) problems.push(`${name}: did not take focus`);
        else if (over > 0) problems.push(`${name}: ${String(over)}px under the row`);
      }
      return problems;
    },
    { areaSelector: SEARCH_AREA, rowSelector: SUBMIT_ROW },
  );
}

/** Focus the last tick in "Where to look", from wherever the area is now. */
async function lastTickFocused(page: Page): Promise<{
  tick: string | undefined;
  focused: boolean;
  overBeforeFocus: number;
  tickBottom: number;
  rowTop: number;
}> {
  return page.evaluate(async (selector) => {
    const ticks = document.querySelectorAll<HTMLElement>('[data-testid="search-where"] input');
    const tick = ticks[ticks.length - 1];
    const row = document.querySelector(selector);
    if (tick === undefined || row === null) throw new Error('no tick or row');
    const overBeforeFocus = tick.getBoundingClientRect().bottom - row.getBoundingClientRect().top;
    tick.focus();
    // WebKit brings a focused box into view in a later frame, not during `focus()`.
    await new Promise((done) => requestAnimationFrame(done));
    await new Promise((done) => requestAnimationFrame(done));
    return {
      tick: tick.dataset.testid,
      focused: document.activeElement === tick,
      overBeforeFocus,
      tickBottom: tick.getBoundingClientRect().bottom,
      rowTop: row.getBoundingClientRect().top,
    };
  }, SUBMIT_ROW);
}

describe('the Search button stays on screen on short windows (L-342)', () => {
  // HAPPY — the owner's report, at the smallest window and the default one.
  for (const viewport of [SMALLEST_WINDOW, { width: 1280, height: 800 }]) {
    const size = `${String(viewport.width)}×${String(viewport.height)}`;

    it(`the button, its reason and the fix are on screen at ${size}, unscrolled`, async () => {
      const page = await openTypedSearch(viewport);
      const scrollTop = await page.evaluate(
        (selector) => document.querySelector(selector)?.scrollTop ?? -1,
        SEARCH_AREA,
      );
      assert.equal(scrollTop, 0, 'the area was scrolled before measuring');
      assert.deepEqual(await submitRowProblems(page), []);
      await page.context().close();
    });
  }

  // The typed form above fits 1000×700 by 2px with nothing holding the row up. So
  // the two forms that do NOT fit, both a click away at the smallest window.
  it('with "More boards" open the reason and the fix are on screen at 1000×700', async () => {
    const page = await openTypedSearch(SMALLEST_WINDOW);
    await pressMoreBoards(page);
    assert.deepEqual(await submitRowProblems(page), []);
    await page.context().close();
  });

  it('with a key saved and "More boards" open the button is on screen at 1000×700', async () => {
    const page = await openTallestSearch(SMALLEST_WINDOW);
    assert.deepEqual(await submitRowProblems(page, ['search-submit']), []);
    await page.context().close();
  });

  // NEGATIVE — a check that cannot fail is not a check.
  it('the check can fail: without the sticky position the row is reported', async () => {
    const page = await openTallestSearch(SMALLEST_WINDOW);
    await page.evaluate((selector) => {
      const row = document.querySelector<HTMLElement>(selector);
      if (row !== null) row.style.position = 'static';
    }, SUBMIT_ROW);
    const report = await submitRowProblems(page, ['search-submit']);
    assert.ok(
      report.some((line) => line.startsWith('search-submit')),
      `the button below the window was not flagged: ${JSON.stringify(report)}`,
    );
    await page.context().close();
  });

  // TRAP — a sticky `bottom-0` stops at the scroll area's PADDING edge, which
  // would leave a 20px strip of the form showing below the row.
  it('nothing shows through below the row, and its background is the page behind it', async () => {
    const page = await openTallestSearch(SMALLEST_WINDOW);
    const seen = await page.evaluate(
      ({ areaSelector, rowSelector }) => {
        const area = document.querySelector(areaSelector);
        const row = document.querySelector(rowSelector);
        if (area === null || row === null) throw new Error('no area or row');
        const areaBox = area.getBoundingClientRect();
        const rowBox = row.getBoundingClientRect();
        const atBottomEdge = document.elementFromPoint(rowBox.left + 4, areaBox.bottom - 1);
        let behind: Element | null = area;
        let painted = 'none';
        while (behind !== null && painted === 'none') {
          const colour = getComputedStyle(behind).backgroundColor;
          if (colour !== 'rgba(0, 0, 0, 0)' && colour !== 'transparent') painted = colour;
          behind = behind.parentElement;
        }
        return {
          gap: areaBox.bottom - rowBox.bottom,
          rowHeight: rowBox.height,
          edgeIsRow: atBottomEdge !== null && row.contains(atBottomEdge),
          rowColour: getComputedStyle(row).backgroundColor,
          painted,
        };
      },
      { areaSelector: SEARCH_AREA, rowSelector: SUBMIT_ROW },
    );
    console.log(`stuck row at 1000×700: ${JSON.stringify(seen)}`);
    assert.ok(Math.abs(seen.gap) < 0.5, `${String(seen.gap)}px between the row and the edge`);
    assert.ok(seen.edgeIsRow, 'the last pixel of the scroll area is not the row');
    assert.equal(seen.rowColour, seen.painted);
    await page.context().close();
  });

  // TRAP — the row's background spans the column, and adds no sideways scroll.
  it('the row is as wide as the column and adds no sideways scroll at 1000×700', async () => {
    const page = await openTypedSearch(SMALLEST_WINDOW);
    const edges = await page.evaluate((selector) => {
      const row = document.querySelector(selector)?.getBoundingClientRect();
      const column = document.querySelector('[data-content-column]')?.getBoundingClientRect();
      return { row: [row?.left, row?.right], column: [column?.left, column?.right] };
    }, SUBMIT_ROW);
    assert.deepEqual(edges.row, edges.column);
    assert.deepEqual(await sidewaysOverflow(page), []);
    await page.context().close();
  });

  // BOUNDARY — a tall window: its natural place, with the spacing it always had.
  it('on a tall window the row sits in its natural place, with the same gaps', async () => {
    const page = await openTypedSearch({ width: 1280, height: 1400 });
    const { top, inFlow } = await rowAgainstFlow(page);
    console.log(`row on a tall window: at ${String(top)}, in flow ${String(inFlow)}`);
    assert.equal(top, inFlow);
    const gaps = await page.evaluate(() => {
      const box = (id: string): DOMRect => {
        const part = document.querySelector(`[data-testid="${id}"]`);
        if (part === null) throw new Error(`no ${id}`);
        return part.getBoundingClientRect();
      };
      return {
        above: box('search-reason-area').top - box('search-where').bottom,
        below: box('search-open-boards-row').top - box('search-reason-area').bottom,
      };
    });
    // `mt-4` and `mt-3`, as they were before the row had a background to paint.
    assert.deepEqual(gaps, { above: 16, below: 12 });
    await page.context().close();
  });

  // BOUNDARY — no jump: scrolled to the end, the row is exactly where it belongs.
  it('scrolled on at 1000×700, the row is back in its natural place', async () => {
    const page = await openTypedSearch(SMALLEST_WINDOW);
    await scrollAreaTo(page, 100_000);
    const { top, inFlow } = await rowAgainstFlow(page);
    assert.equal(top, inFlow);
    await page.context().close();
  });

  // BOUNDARY — phones: an on-screen keyboard plus a tall wrapped row would cover
  // the fields, so below `md:` nothing changes at all.
  for (const width of [375, 767]) {
    it(`at ${String(width)}px the row is not sticky and its spacing is unchanged`, async () => {
      const page = await openTypedSearch({ width, height: 700 });
      const seen = await page.evaluate((selector) => {
        const row = document.querySelector(selector);
        if (row === null) throw new Error('no submit row');
        const style = getComputedStyle(row);
        return {
          position: style.position,
          marginTop: style.marginTop,
          marginBottom: style.marginBottom,
          paddingTop: style.paddingTop,
          paddingBottom: style.paddingBottom,
          background: style.backgroundColor,
        };
      }, SUBMIT_ROW);
      assert.deepEqual(seen, {
        position: 'static',
        marginTop: '16px',
        marginBottom: '0px',
        paddingTop: '0px',
        paddingBottom: '0px',
        background: 'rgba(0, 0, 0, 0)',
      });
      await page.context().close();
    });
  }

  it('from exactly the md: width up, the row is sticky', async () => {
    const page = await openTypedSearch(NARROWEST_STICKY);
    const position = await page.evaluate((selector) => {
      const row = document.querySelector(selector);
      return row === null ? 'no row' : getComputedStyle(row).position;
    }, SUBMIT_ROW);
    assert.equal(position, 'sticky');
    await page.context().close();
  });

  // TRAP — WCAG 2.4.11, Focus Not Obscured. Every control in "Where to look" is
  // above the pinned row when it has focus. The row is at its tallest with the
  // grey reason and the fix button, and tallest of all where it wraps the most.
  for (const viewport of [SMALLEST_WINDOW, NARROWEST_STICKY]) {
    const size = `${String(viewport.width)}×${String(viewport.height)}`;

    it(`a focused control in "Where to look" is clear of the tallest row at ${size}`, async () => {
      const page = await openTypedSearch(viewport);
      await pressMoreBoards(page);
      assert.deepEqual(await focusedControlsUnderTheRow(page), []);
      await page.context().close();
    });
  }

  it('the last tick, focused at 1000×700, is clear of the row', async () => {
    const page = await openTypedSearch(SMALLEST_WINDOW);
    await pressMoreBoards(page);
    const seen = await lastTickFocused(page);
    console.log(`last tick focused at 1000×700: ${JSON.stringify(seen)}`);
    assert.ok(seen.focused, 'the last tick did not take focus');
    assert.ok(seen.tickBottom <= seen.rowTop, JSON.stringify(seen));
    await page.context().close();
  });

  // At 1000×700 the last tick happens to clear the row by itself. Here it does
  // not, so this is the case that shows the scroll padding doing the work.
  it('a tick really under the row is moved clear of it when focused', async () => {
    const page = await openTicksUnderTheRow();
    const seen = await lastTickFocused(page);
    console.log(`last tick focused under the row: ${JSON.stringify(seen)}`);
    assert.ok(seen.focused, 'the last tick did not take focus');
    assert.ok(seen.overBeforeFocus > 0, `it was not under the row: ${JSON.stringify(seen)}`);
    assert.ok(seen.tickBottom <= seen.rowTop, JSON.stringify(seen));
    await page.context().close();
  });

  it('the check can fail: with no scroll padding a focused tick is reported', async () => {
    const page = await openTicksUnderTheRow();
    await page.evaluate((selector) => {
      const area = document.querySelector<HTMLElement>(selector);
      if (area !== null) area.style.scrollPaddingBottom = '0px';
    }, SEARCH_AREA);
    const report = await focusedControlsUnderTheRow(page);
    assert.ok(
      report.some((line) => line.includes('under the row')),
      `a tick under the row was not flagged: ${JSON.stringify(report)}`,
    );
    await page.context().close();
  });

  // The scroll padding puts the pinned row inside the zone the browser scrolls
  // things out of, so moving focus to Search from code threw the form 300px up.
  it('pressing the fix in the pinned row does not scroll the form', async () => {
    const page = await openTypedSearch(SMALLEST_WINDOW);
    await page.fill('[data-testid="search-location"]', 'Berlin');
    await page.uncheck('[data-testid="keyless-source-arbeitnow"]');
    const fix = page.locator('[data-testid="search-tick-feeds"]');
    await fix.waitFor();
    await scrollAreaTo(page, 0);
    const box = await fix.boundingBox();
    assert.ok(box !== null, 'no fix button');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.locator('[data-testid="search-submit"]:focus').waitFor();
    const scrollTop = await page.evaluate(async (selector) => {
      await new Promise((done) => requestAnimationFrame(done));
      await new Promise((done) => requestAnimationFrame(done));
      return document.querySelector(selector)?.scrollTop ?? -1;
    }, SEARCH_AREA);
    assert.equal(scrollTop, 0);
    assert.deepEqual(await submitRowProblems(page, ['search-submit']), []);
    await page.context().close();
  });

  // TRAP — z-order, both ways: above the ticks, below the hints.
  it('the row paints above the ticks it covers', async () => {
    const page = await openTicksUnderTheRow();
    const report = await page.evaluate(
      ({ areaSelector, rowSelector }) => {
        const area = document.querySelector(areaSelector);
        const row = document.querySelector(rowSelector);
        const ticks = document.querySelectorAll('[data-testid="search-where"] input');
        const tick = ticks[ticks.length - 1];
        if (area === null || row === null || tick === undefined)
          throw new Error('nothing to measure');
        // Scroll the last tick into the middle of the row, which stays pinned.
        const middleOf = (box: DOMRect): number => box.top + box.height / 2;
        area.scrollTop +=
          middleOf(tick.getBoundingClientRect()) - middleOf(row.getBoundingClientRect());
        const tickBox = tick.getBoundingClientRect();
        const rowBox = row.getBoundingClientRect();
        const hit = document.elementFromPoint(tickBox.left + tickBox.width / 2, middleOf(tickBox));
        return {
          tickInsideRow: middleOf(tickBox) > rowBox.top && middleOf(tickBox) < rowBox.bottom,
          topmostIsRow: hit !== null && row.contains(hit),
        };
      },
      { areaSelector: SEARCH_AREA, rowSelector: SUBMIT_ROW },
    );
    console.log(`a tick under the row: ${JSON.stringify(report)}`);
    assert.deepEqual(report, { tickInsideRow: true, topmostIsRow: true });
    await page.context().close();
  });

  it('a hint paints above the row', async () => {
    const page = await openTypedSearch(SMALLEST_WINDOW);
    await page.locator('[data-testid="search-where"] input').last().focus();
    await page.waitForSelector('[data-testid="hint"]:visible');
    const onTop = await page.evaluate((selector) => {
      const row = document.querySelector(selector);
      const tip = document.querySelector<HTMLElement>('[data-testid="hint"]:not([hidden])');
      if (row === null || tip === null) throw new Error('no row or hint');
      // A tip takes no pointer events, so `elementFromPoint` would look through
      // it. Give it some, and put it over the row, to ask the stacking order.
      const box = row.getBoundingClientRect();
      tip.style.pointerEvents = 'auto';
      tip.style.top = `${String(box.top)}px`;
      tip.style.left = `${String(box.left)}px`;
      const tipBox = tip.getBoundingClientRect();
      return document.elementFromPoint(tipBox.left + 2, tipBox.top + 2) === tip;
    }, SUBMIT_ROW);
    assert.ok(onTop, 'the hint paints below the row');
    await page.context().close();
  });

  // TRAP — results: the row must never float over them.
  it('after a search, the row never covers a result and scrolls away with the form', async () => {
    const page = await openTypedSearch(SMALLEST_WINDOW, '?seen=1&results=1');
    await page.locator('[data-testid="search-submit"]:not([disabled])').click();
    await page.getByText('Project Coordinator 11').first().waitFor();
    const report = await page.evaluate(
      async ({ areaSelector, rowSelector }) => {
        const area = document.querySelector(areaSelector);
        const row = document.querySelector(rowSelector);
        if (area === null || row === null) throw new Error('no area or row');
        const first = document.querySelector('[data-testid="search-results"]');
        if (first === null) throw new Error('no results drawn');
        const overlaps: number[] = [];
        const range = area.scrollHeight - area.clientHeight;
        for (let top = 0; top <= range; top += 40) {
          area.scrollTop = top;
          await new Promise((done) => requestAnimationFrame(done));
          const rowBox = row.getBoundingClientRect();
          const resultsBox = first.getBoundingClientRect();
          if (resultsBox.top < rowBox.bottom && resultsBox.bottom > rowBox.top) overlaps.push(top);
        }
        area.scrollTop = range;
        await new Promise((done) => requestAnimationFrame(done));
        return {
          overlaps,
          range,
          rowBottom: row.getBoundingClientRect().bottom,
          areaTop: area.getBoundingClientRect().top,
        };
      },
      { areaSelector: SEARCH_AREA, rowSelector: SUBMIT_ROW },
    );
    console.log(`results: ${JSON.stringify(report)}`);
    assert.ok(report.range > 0, 'the results did not make the area scroll');
    assert.deepEqual(report.overlaps, [], 'the row covered a result at these scroll positions');
    assert.ok(report.rowBottom < report.areaTop, 'the row did not scroll away');
    await page.context().close();
  });
});

/**
 * Every screen opens at the top of its scroll areas (L-353).
 *
 * Tailor scrolls to its current step when it opens, and `scrollWithin`
 * measured from the scroll area's outer edge, not from where its content
 * starts — so it counted the area's own top padding (20px, 16px on a phone) as
 * distance to scroll. Tailor opened 20px down, "Your CV" tight under the step
 * bar. Settings, opened at Job boards or the Reed key, uses the same function:
 * its section now lands with that same gap above it rather than flush.
 *
 * jsdom does no layout and has no padding, so only a real engine can see this.
 */

/** Wait until no scroll area has moved for a while: the step scroll is smooth. */
async function scrollingSettled(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const areas = [...document.querySelectorAll('*')].filter((element) =>
      ['auto', 'scroll'].includes(getComputedStyle(element).overflowY),
    );
    let last = '';
    let still = 0;
    for (let frame = 0; frame < 600 && still < 20; frame += 1) {
      await new Promise((done) => requestAnimationFrame(done));
      const now = areas.map((area) => String(area.scrollTop)).join(',');
      still = now === last ? still + 1 : 0;
      last = now;
    }
  });
}

/** Every scroll area on the page that is not at its top. Empty means all are. */
async function scrolledAreas(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('*')]
      .filter((element) => ['auto', 'scroll'].includes(getComputedStyle(element).overflowY))
      .filter((area) => area.scrollTop !== 0)
      .map((area) => {
        const name =
          area.getAttribute('data-testid') ??
          area.closest('[data-testid^="view-"]')?.getAttribute('data-testid') ??
          area.tagName.toLowerCase();
        return `${name}: scrolled ${String(area.scrollTop)}px`;
      }),
  );
}

/** Where a target sits in its scroll area, against the area's own top padding. */
async function landing(
  page: Page,
  target: string,
): Promise<{ gap: number; padding: number; scrollTop: number; atEnd: boolean }> {
  return page.evaluate((selector) => {
    const element = document.querySelector(selector);
    const area = element?.parentElement?.closest('.overflow-y-auto');
    if (element === null || area === null || area === undefined) throw new Error(`no ${selector}`);
    return {
      gap: element.getBoundingClientRect().top - area.getBoundingClientRect().top,
      padding: parseFloat(getComputedStyle(area).paddingTop),
      scrollTop: area.scrollTop,
      atEnd: area.scrollTop >= area.scrollHeight - area.clientHeight - 1,
    };
  }, target);
}

/** One call to a scroll area's `scrollTo`, and the layout at that same moment. */
interface ScrollRequest {
  /** The position asked for. */
  readonly top: number;
  /** Where the target's top was, in the area's scrolled content, when asked. */
  readonly sectionAt: number;
  /** The area's own top padding, when asked. */
  readonly padding: number;
}

/**
 * From now on, write down every `scrollTo` on a scroll area holding `target`,
 * with where the target was at that instant — the same layout `scrollWithin`
 * measured, before anything drawn later can move it.
 */
async function recordScrollRequests(page: Page, target: string): Promise<void> {
  await page.evaluate((selector) => {
    const record: unknown[] = [];
    (window as unknown as { __scrollRequests: unknown[] }).__scrollRequests = record;
    const original = Element.prototype.scrollTo;
    Element.prototype.scrollTo = function scrollTo(this: Element, ...args: unknown[]) {
      const section = document.querySelector(selector);
      const options = args[0] as ScrollToOptions | undefined;
      if (section !== null && this.contains(section) && typeof options?.top === 'number') {
        record.push({
          top: options.top,
          sectionAt:
            this.scrollTop + section.getBoundingClientRect().top - this.getBoundingClientRect().top,
          padding: parseFloat(getComputedStyle(this).paddingTop),
        });
      }
      return (original as (...a: unknown[]) => void).apply(this, args);
    } as Element['scrollTo'];
  }, target);
}

async function scrollRequests(page: Page): Promise<ScrollRequest[]> {
  return page.evaluate(
    () => (window as unknown as { __scrollRequests: ScrollRequest[] }).__scrollRequests,
  );
}

describe('every screen opens at the top of its scroll areas (L-353)', () => {
  for (const [width, viewport] of Object.entries(VIEWPORTS)) {
    const padding = width === 'phone' ? 16 : 20;

    it(`Tailor opens at the top of its own scroll area, ${width}`, async () => {
      const page = await open('?seen=1', viewport);
      await goTo(page, 'tailor');
      await page.waitForSelector('[data-testid="tailor-scroll"] [data-content-column]');
      await scrollingSettled(page);
      const seen = await landing(page, '[data-testid="tailor-scroll"] [data-content-column]');
      const room = await page.evaluate(() => {
        const area = document.querySelector('[data-testid="tailor-scroll"]');
        return area === null ? 0 : area.scrollHeight - area.clientHeight;
      });
      console.log(`Tailor opened (${width}): ${JSON.stringify({ ...seen, room })}`);
      // Room to scroll, or the bug could not show: an area that cannot move
      // stays at the top whatever it is asked.
      assert.ok(room > padding, `Tailor's area has only ${String(room)}px to scroll`);
      assert.equal(seen.scrollTop, 0, 'Tailor opened scrolled down');
      assert.equal(seen.padding, padding);
      assert.equal(seen.gap, padding, '"Your CV" is not the padding below the step bar');
      await page.context().close();
    });

    it(`no screen opens with a scroll area already scrolled, ${width}`, async () => {
      const page = await open('?seen=1', viewport);
      const report: string[] = [];
      for (const view of VIEWS) {
        await goTo(page, view);
        await scrollingSettled(page);
        report.push(...(await scrolledAreas(page)).map((line) => `${view} — ${line}`));
      }
      assert.deepEqual(report, []);
      await page.context().close();
    });

    /*
      Judged at the moment the scroll is asked for, not after it lands.

      A KNOWN, SEPARATE late shift: Settings' backup section, above Job boards,
      shows `.json` in IBM Plex Mono. The browser fetches that face only when
      Settings first draws it, which is after Settings has already worked out
      the scroll. Until it arrives the line uses a fallback mono font, whose
      line box is a different height: 0.5px taller on Windows, about 2px on
      CI's Linux. So once the font lands, Job boards sits that much higher
      than it was when the scroll was aimed, and the gap read after landing
      was 14px on CI, not 16. That is not `scrollWithin`'s arithmetic, so it
      is not measured here; it is reported as its own item.
    */
    it(`Settings opened at Job boards aims the section the padding below the top, ${width}`, async () => {
      const page = await open('?seen=1', viewport);
      await goTo(page, 'search');
      await recordScrollRequests(page, '[data-testid="boards-settings"]');
      await page.click('[data-testid="keyless-manage"]');
      await page.locator('[data-testid="nav-settings"][aria-current="page"]:visible').waitFor();
      await page.locator('[data-testid="boards-settings"]:focus').waitFor();
      await scrollingSettled(page);
      const requests = await scrollRequests(page);
      const seen = await landing(page, '[data-testid="boards-settings"]');
      console.log(
        `Settings at Job boards (${width}): ${JSON.stringify({ requests, landed: seen })}`,
      );
      assert.equal(requests.length, 1, 'Settings did not ask its scroll area to move once');
      const [asked] = requests as [ScrollRequest];
      assert.equal(asked.padding, padding);
      // Before L-353 the area was asked for `sectionAt` itself: flush.
      assert.equal(
        asked.top,
        asked.sectionAt - asked.padding,
        'the scroll was not aimed the padding above the section',
      );
      assert.ok(!seen.atEnd, 'the area ran out of room, so the aim proves nothing');
      // It got there: an engine scrolls in whole pixels, and a section can sit
      // on a half pixel, so the area stops within the pixel it was asked for.
      assert.ok(
        Math.abs(seen.scrollTop - asked.top) < 1,
        `asked for ${String(asked.top)}, stopped at ${String(seen.scrollTop)}`,
      );
      await page.context().close();
    });
  }

  // NEGATIVE — a check that cannot fail is not a check.
  it('the check can fail: a scroll area moved by hand is reported', async () => {
    const page = await open('?seen=1', VIEWPORTS.desktop);
    await goTo(page, 'settings');
    await page.evaluate(() => {
      const area = document.querySelector('[data-testid="view-settings"] .overflow-y-auto');
      if (area !== null) area.scrollTop = 40;
    });
    const report = await scrolledAreas(page);
    assert.ok(
      report.some((line) => line.includes('scrolled 40px')),
      `the moved area was not flagged: ${JSON.stringify(report)}`,
    );
    await page.context().close();
  });
});

/**
 * The mono font cannot move Settings after a jump (L-364).
 *
 * The fix for the "known, separate" late shift that the L-353 Settings check
 * above describes. Settings' backup section shows `.json` in IBM Plex Mono.
 * On the narrow layout nothing had drawn that face before Settings did, so it
 * was fetched only then, after Settings had worked out where to scroll. The
 * fallback face's line box is a different height (0.5px on Windows, about 2px
 * on CI's Linux), so the section moved once the real face landed, and the
 * first jump into Settings stopped that far off. The desktop layout was never
 * affected: the side menu's "Ctrl N" labels draw the same face at startup.
 *
 * The fix has two parts. The app loads both Plex Mono faces as it starts
 * (`app/startupFonts.ts`), so no screen lays out before them; and the `.json`
 * code carries `leading-none`, so that one line's height does not depend on
 * any font's metrics, however late the font arrives.
 *
 * Every check here serves a DIFFERENT font in place of Plex Mono (Newsreader,
 * whose line box differs from every platform's fallback mono face). That makes
 * the shift big and the same on every OS, instead of the half pixel Windows
 * happened to show.
 *
 * "Late" is made exact rather than raced: once the app has started, any Plex
 * Mono face asked for is HELD until the screen has settled, measured, and then
 * let through. A screen whose height then changes would have moved under the
 * user. Holding also keeps slow, unrelated content (a store loading) out of the
 * comparison, because both measurements are taken after it has arrived.
 */
const MONO_FACES = /\/fonts\/ibm-plex-mono-(400|500)-latin\.woff2$/;
const STAND_IN = join(DIST, 'fonts', 'newsreader-400-latin.woff2');

interface StandInApp {
  readonly page: Page;
  /** Every Plex Mono face the page asked for, in order. */
  readonly served: readonly string[];
  /** From now on, hold every Plex Mono face asked for until `release`. */
  holdLateFonts(): void;
  /** Let held faces through; returns the ones that were held. */
  release(): string[];
}

/** The app, started with every Plex Mono face it asks for answered by the stand-in. */
async function openWithMonoStandIn(
  viewport: { width: number; height: number },
  query = '?seen=1',
): Promise<StandInApp> {
  const context = await browser.newContext({ viewport, colorScheme: 'light' });
  const served: string[] = [];
  let held: string[] = [];
  let gate: Promise<void> | null = null;
  let open = (): void => undefined;
  await context.route(MONO_FACES, async (route) => {
    const path = new URL(route.request().url()).pathname;
    served.push(path);
    if (gate !== null) {
      held.push(path);
      await gate;
    }
    await route.fulfill({ status: 200, contentType: 'font/woff2', body: readFileSync(STAND_IN) });
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${origin}/${query}`);
  await page.waitForSelector('[data-testid="shell"]');
  // Startup is over only once everything the app asks for while starting has
  // landed. `fonts.ready` alone can settle before the first frame has even
  // asked for a face (a face is requested when text first needs it, and the
  // app's own requests run in an effect after the first paint), and anything
  // asked for after this point counts as late.
  await layoutSettled(page, { fonts: true });
  await page.evaluate(() => document.fonts.ready);
  assert.deepEqual(errors, [], 'the app threw while drawing');
  return {
    page,
    served,
    holdLateFonts: () => {
      gate = new Promise((done) => {
        open = done;
      });
    },
    release: () => {
      const was = held;
      held = [];
      gate = null;
      open();
      return was;
    },
  };
}

/**
 * No scroll area has moved or changed height for 20 frames. Not waiting for
 * `document.fonts.ready` when told a font is being held: it would never come.
 */
async function layoutSettled(page: Page, { fonts }: { fonts: boolean }): Promise<void> {
  await page.evaluate(async (waitForFonts) => {
    if (waitForFonts) await document.fonts.ready;
    let last = '';
    let still = 0;
    for (let frame = 0; frame < 600 && still < 20; frame += 1) {
      await new Promise((done) => requestAnimationFrame(done));
      const now = [...document.querySelectorAll('*')]
        .filter((element) => ['auto', 'scroll'].includes(getComputedStyle(element).overflowY))
        .map((area) => `${String(area.scrollTop)}:${String(area.scrollHeight)}`)
        .join(',');
      still = now === last ? still + 1 : 0;
      last = now;
    }
  }, fonts);
}

/** How tall everything above Job boards is: where the section starts in its column. */
async function aboveBoards(page: Page): Promise<number> {
  return page.evaluate(() => {
    const section = document.querySelector('[data-testid="boards-settings"]');
    const column = section?.closest('[data-content-column]');
    if (section === null || column === null || column === undefined) {
      throw new Error('no Job boards section in a content column');
    }
    return section.getBoundingClientRect().top - column.getBoundingClientRect().top;
  });
}

/**
 * The open screen, and every scroll area in it (either direction: the Tracker
 * board scrolls sideways): its content height, child by child.
 */
async function screenHeights(page: Page, view: string): Promise<string[]> {
  return page.evaluate((selector) => {
    const screen = document.querySelector(selector);
    if (screen === null) throw new Error(`no ${selector}`);
    const scrolls = (element: Element): boolean => {
      const style = getComputedStyle(element);
      return [style.overflowY, style.overflowX].some((o) => ['auto', 'scroll'].includes(o));
    };
    return [screen, ...[...screen.querySelectorAll('*')].filter(scrolls)].map(
      (area) =>
        `${area.getAttribute('data-testid') ?? area.tagName.toLowerCase()}: ` +
        `${String(area.scrollHeight)} / ` +
        [...area.children].map((child) => String(child.getBoundingClientRect().height)).join(','),
    );
  }, `[data-testid="view-${view}"]`);
}

/** The other screens, each in a fresh app so its first look is the one measured. */
const OTHER_VIEWS = ['profile', 'search', 'tracker', 'analysis', 'tailor'] as const;

describe('the mono font cannot move Settings after a jump (L-364)', () => {
  for (const [width, viewport] of Object.entries(VIEWPORTS)) {
    const padding = width === 'phone' ? 16 : 20;

    it(`Settings above Job boards is as tall before a late mono font as after, ${width}`, async () => {
      const app = await openWithMonoStandIn(viewport);
      app.holdLateFonts();
      await goTo(app.page, 'settings');
      await layoutSettled(app.page, { fonts: false });
      const before = await aboveBoards(app.page);
      const late = app.release();
      await layoutSettled(app.page, { fonts: true });
      const after = await aboveBoards(app.page);
      console.log(
        `Settings above Job boards (${width}): ${JSON.stringify({ before, after, late })}`,
      );
      // The stand-in really was drawn, or nothing here was tested.
      assert.ok(
        app.served.some((path) => path.includes('plex-mono-400')),
        `Plex Mono 400 was never asked for: ${JSON.stringify(app.served)}`,
      );
      assert.ok(before > 0, 'Job boards is at the top: nothing above it to measure');
      assert.equal(after, before, 'Job boards moved when the mono font landed');
      await app.page.context().close();
    });

    // The assertion L-353 had to leave out: where the section really stops,
    // after every font has landed.
    it(`Settings opened at Job boards stops the padding below the top, ${width}`, async () => {
      const app = await openWithMonoStandIn(viewport);
      await goTo(app.page, 'search');
      await app.page.click('[data-testid="keyless-manage"]');
      await app.page.locator('[data-testid="nav-settings"][aria-current="page"]:visible').waitFor();
      await app.page.locator('[data-testid="boards-settings"]:focus').waitFor();
      await layoutSettled(app.page, { fonts: true });
      const seen = await landing(app.page, '[data-testid="boards-settings"]');
      console.log(`Settings landed at Job boards (${width}): ${JSON.stringify(seen)}`);
      assert.ok(seen.scrollTop > 0, 'Settings did not scroll at all');
      assert.ok(!seen.atEnd, 'the area ran out of room, so where it stopped proves nothing');
      assert.equal(seen.padding, padding);
      assert.equal(seen.gap, padding, 'Job boards did not stop the padding below the top');
      await app.page.context().close();
    });

    // NEGATIVE — no other screen changes height when a mono font lands after
    // it has drawn.
    it(`no other screen changes height when a mono font lands late, ${width}`, async () => {
      const report: string[] = [];
      for (const view of OTHER_VIEWS) {
        // An empty board has nothing to scroll; three applications do.
        const app = await openWithMonoStandIn(
          viewport,
          view === 'tracker' ? '?seen=1&entries=1' : '?seen=1',
        );
        // Tracker is where the app opens. Step away so it is drawn again.
        if (view === 'tracker') await goTo(app.page, 'profile');
        app.holdLateFonts();
        await goTo(app.page, view);
        await layoutSettled(app.page, { fonts: false });
        const before = await screenHeights(app.page, view);
        const late = app.release();
        await layoutSettled(app.page, { fonts: true });
        const after = await screenHeights(app.page, view);
        console.log(`${view} (${width}): ${JSON.stringify({ heights: after, late })}`);
        assert.ok(before.length > 1, `${view}: no scroll area measured: ${JSON.stringify(before)}`);
        if (JSON.stringify(after) !== JSON.stringify(before)) {
          report.push(`${view}: ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
        }
        await app.page.context().close();
      }
      assert.deepEqual(report, []);
    });
  }

  // NEGATIVE — a check that cannot fail is not a check. A line above Job boards
  // that grows between the two measurements moves the section, and is caught.
  it('the check can fail: a line above Job boards growing after it settled is reported', async () => {
    const app = await openWithMonoStandIn(VIEWPORTS.phone);
    await goTo(app.page, 'settings');
    await layoutSettled(app.page, { fonts: true });
    const before = await aboveBoards(app.page);
    await app.page.evaluate(() => {
      const code = document.querySelector<HTMLElement>('[data-content-column] code');
      if (code === null) throw new Error('no code above Job boards');
      code.style.lineHeight = '40px';
    });
    await layoutSettled(app.page, { fonts: true });
    const after = await aboveBoards(app.page);
    assert.notEqual(after, before, `a taller line went unnoticed: ${String(before)}`);
    await app.page.context().close();
  });
});

/**
 * A long unbroken word in an error message wraps (L-374).
 *
 * An error that carries a file path or a web address has a "word" with no
 * spaces in it. Nothing told the error strips (`ui/ErrorBox.tsx`, L-368) to
 * break such a word, so in a narrow window it ran on past the strip's edge.
 * Measured on `main` before the fix, with a 200-character Windows path:
 *   - the page itself never scrolled sideways: the shell clips (`overflow-x:
 *     clip`). The text was simply CUT OFF at the window's edge, unreadable.
 *   - Tracker's strip is a row with Retry at the end. The path would not let
 *     its span shrink (a flex item is never narrower than its longest word), so
 *     Retry was pushed out to x≈1680 at 375px: off screen, and not pressable.
 *   - the box inside a panel spilled out of the panel, and the Settings scroll
 *     area grew a sideways scroll.
 *
 * The fix is `break-words` on every shape (a word breaks only when it cannot
 * fit on a line of its own), and `min-w-0` on the span holding a row strip's
 * message, so it can be narrower than that word.
 *
 * jsdom does no layout, so only a real engine can see any of this. The checks
 * also draw a REFERENCE: a copy of the same strip with the fix's classes taken
 * off, next to it in the same place. That is what `main` drew, so "an ordinary
 * sentence wraps exactly as before" is a comparison on the same machine and
 * fonts, not a pixel count that would differ on CI's Linux.
 */
const LONG_PATH = ((): string => {
  let path = 'C:\\Users\\someone\\AppData\\Roaming\\com.cviper.light\\backups';
  while (path.length < 195) path += '\\NestedFolder';
  return `${path.slice(0, 195)}.json`;
})();

const ORDINARY =
  'The database is locked by another copy of CViper. Close the other copy, then open this ' +
  'one again so your board can be read.';

/** The classes the fix adds: on the strip itself, and on a row strip's message span. */
const WRAP_FIX = { strip: ['break-words'], span: ['min-w-0'] } as const;

const ERROR_WIDTHS = [375, 1000] as const;

interface ErrorLayout {
  readonly viewport: number;
  readonly strip: { readonly left: number; readonly right: number; readonly height: number };
  /** How far the page scrolls sideways. 0 is none. */
  readonly pageScroll: number;
  /** The element holding the words: the strip, or a row strip's span. */
  readonly message: {
    readonly scrollWidth: number;
    readonly clientWidth: number;
    readonly width: number;
    /**
     * How far the furthest word reaches past the right of the message's content
     * box. `scrollWidth` alone misses words running into the padding.
     */
    readonly overrun: number;
  };
  /** The message and everything around it, out to the page, whose content is wider than it. */
  readonly wider: readonly string[];
  readonly button: {
    readonly left: number;
    readonly right: number;
    readonly width: number;
    /** A click at the button's centre lands on the button. */
    readonly onTop: boolean;
  } | null;
}

async function errorLayout(page: Page, testId: string): Promise<ErrorLayout> {
  return page.evaluate((id) => {
    const strip = document.querySelector(`[data-testid="${id}"]`);
    if (strip === null) throw new Error(`no ${id}`);
    const message = strip.querySelector(':scope > span') ?? strip;
    const wider: string[] = [];
    for (let node: Element | null = message; node !== null; node = node.parentElement) {
      if (node.scrollWidth > node.clientWidth) {
        const name = node.getAttribute('data-testid') ?? node.tagName.toLowerCase();
        wider.push(`${name}: ${String(node.scrollWidth - node.clientWidth)}px wider than it is`);
      }
    }
    const style = getComputedStyle(message);
    const contentRight =
      message.getBoundingClientRect().right -
      parseFloat(style.paddingRight) -
      parseFloat(style.borderRightWidth);
    let furthest = -Infinity;
    const walker = document.createTreeWalker(message, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      for (const word of (node.textContent ?? '').matchAll(/\S+/g)) {
        const range = document.createRange();
        range.setStart(node, word.index);
        range.setEnd(node, word.index + word[0].length);
        for (const rect of range.getClientRects()) furthest = Math.max(furthest, rect.right);
      }
    }
    const box = strip.getBoundingClientRect();
    const button = strip.querySelector('button');
    let pressable: ErrorLayout['button'] = null;
    if (button !== null) {
      const at = button.getBoundingClientRect();
      const hit = document.elementFromPoint(at.left + at.width / 2, at.top + at.height / 2);
      pressable = {
        left: at.left,
        right: at.right,
        width: at.width,
        onTop: hit !== null && button.contains(hit),
      };
    }
    const root = document.documentElement;
    return {
      viewport: window.innerWidth,
      strip: { left: box.left, right: box.right, height: box.height },
      pageScroll: root.scrollWidth - root.clientWidth,
      message: {
        scrollWidth: message.scrollWidth,
        clientWidth: message.clientWidth,
        width: message.getBoundingClientRect().width,
        overrun: furthest === -Infinity ? 0 : Math.max(0, furthest - contentRight),
      },
      wider,
      button: pressable,
    };
  }, testId);
}

/**
 * Put a copy of the strip straight after it, with the fix's classes taken off:
 * what `main` drew, in the same place, with the same fonts. Not an alert, so a
 * screen reader is not told twice. Its test id is `<id>-reference`.
 */
async function drawReference(page: Page, testId: string): Promise<string> {
  await page.evaluate(
    ({ id, fix }) => {
      const strip = document.querySelector(`[data-testid="${id}"]`);
      if (strip === null) throw new Error(`no ${id}`);
      const copy = strip.cloneNode(true) as Element;
      copy.setAttribute('data-testid', `${id}-reference`);
      copy.removeAttribute('role');
      copy.classList.remove(...fix.strip);
      copy.querySelector(':scope > span')?.classList.remove(...fix.span);
      strip.after(copy);
    },
    { id: testId, fix: WRAP_FIX },
  );
  return `${testId}-reference`;
}

/** The word each line starts with: where a sentence wraps. */
async function lineStarts(page: Page, testId: string): Promise<string[]> {
  return page.evaluate((id) => {
    const strip = document.querySelector(`[data-testid="${id}"]`);
    if (strip === null) throw new Error(`no ${id}`);
    const message = strip.querySelector(':scope > span') ?? strip;
    const walker = document.createTreeWalker(message, NodeFilter.SHOW_TEXT);
    const starts: string[] = [];
    let lastTop: number | null = null;
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const text = node.textContent ?? '';
      for (const word of text.matchAll(/\S+/g)) {
        const range = document.createRange();
        range.setStart(node, word.index);
        range.setEnd(node, word.index + 1);
        const top = Math.round(range.getBoundingClientRect().top);
        if (top !== lastTop) starts.push(word[0]);
        lastTop = top;
      }
    }
    return starts;
  }, testId);
}

/** Everything in the strip, its words included, is inside the strip and the window. */
function assertFits(name: string, seen: ErrorLayout): void {
  console.log(`${name}: ${JSON.stringify(seen)}`);
  assert.ok(seen.strip.right <= seen.viewport, `${name}: the strip runs past the window's edge`);
  assert.equal(seen.pageScroll, 0, `${name}: the page scrolls sideways`);
  assert.ok(
    seen.message.scrollWidth <= seen.message.clientWidth,
    `${name}: the words run ${String(seen.message.scrollWidth - seen.message.clientWidth)}px past the strip`,
  );
  // Sub-pixel rounding only: a letter that runs over is several pixels.
  assert.ok(
    seen.message.overrun < 0.5,
    `${name}: the words run ${String(seen.message.overrun)}px into the padding or past it`,
  );
  assert.deepEqual(seen.wider, [], `${name}: something around the message got wider`);
}

/** Tracker, with the board failing to load: its row strip, with Retry. */
async function trackerFailing(width: number, message: string): Promise<Page> {
  const page = await open(`?seen=1&trackerLoadError=${encodeURIComponent(message)}`, {
    width,
    height: 800,
  });
  await page.waitForSelector('[data-testid="tracker-error"] button');
  return page;
}

/** Profile, with the profile failing to load: its plain strip. */
async function profileFailing(width: number, message: string): Promise<Page> {
  const page = await open(`?seen=1&profileLoadError=${encodeURIComponent(message)}`, {
    width,
    height: 800,
  });
  await goTo(page, 'profile');
  await page.waitForSelector('[data-testid="profile-error"]');
  return page;
}

interface Mount {
  readonly variant: 'strip' | 'box';
  readonly layout?: 'row';
  readonly testId: string;
  readonly message: string;
}

/**
 * The app's own `ErrorBox`, drawn where that shape lives: a strip straight
 * under Profile's header, a box at the end of the AI key panel in Settings
 * (where that panel's own hand-built error box sits).
 */
async function mountErrorBox(page: Page, box: Mount): Promise<void> {
  await page.evaluate((props) => {
    const into = document.createElement('div');
    if (props.variant === 'box') {
      document.querySelector('[data-testid="ai-key-setup"]')?.append(into);
    } else {
      const screen = document.querySelector('[data-testid="view-profile"]');
      screen?.insertBefore(into, screen.children[1] ?? null);
    }
    if (!into.isConnected) throw new Error(`nowhere to draw ${props.testId}`);
    (
      window as unknown as { __mountErrorBox: (into: Element, box: unknown) => void }
    ).__mountErrorBox(into, props.variant === 'box' ? { ...props, gapAbove: 'mt-3' } : props);
  }, box);
  await page.waitForSelector(`[data-testid="${box.testId}"]`, { state: 'attached' });
}

async function settingsPanel(width: number): Promise<Page> {
  const page = await open('?seen=1', { width, height: 800 });
  await goTo(page, 'settings');
  await page.waitForSelector('[data-testid="ai-key-setup"]');
  return page;
}

async function profileScreen(width: number): Promise<Page> {
  const page = await open('?seen=1', { width, height: 800 });
  await goTo(page, 'profile');
  return page;
}

describe('a long unbroken word in an error message wraps (L-374)', () => {
  it('the path is 200 characters with nowhere a browser may break it', () => {
    assert.equal(LONG_PATH.length, 200);
    // No space, hyphen or slash: letters, colons, dots and backslashes only.
    assert.match(LONG_PATH, /^[A-Za-z:.\\]+$/);
  });

  for (const width of ERROR_WIDTHS) {
    const px = `${String(width)}px`;

    it(`the strip under Profile's header keeps the path inside the window at ${px}`, async () => {
      const page = await profileFailing(width, LONG_PATH);
      assertFits(`profile strip, path (${px})`, await errorLayout(page, 'profile-error'));
      // The message is whole: the path, then the words after it.
      assert.equal(
        await page.locator('[data-testid="profile-error"]').textContent(),
        `${LONG_PATH} Your data is still on this machine.`,
      );
      await page.context().close();
    });

    it(`Tracker's strip keeps the path inside, with Retry on screen and pressable, at ${px}`, async () => {
      const page = await trackerFailing(width, LONG_PATH);
      const seen = await errorLayout(page, 'tracker-error');
      assertFits(`tracker strip, path (${px})`, seen);
      assert.ok(seen.button !== null, 'no Retry button');
      assert.ok(
        seen.button.left >= 0 && seen.button.right <= seen.viewport,
        `Retry is not inside the window: ${JSON.stringify(seen.button)}`,
      );
      assert.ok(seen.button.onTop, 'something else is over Retry');
      // As wide as with an ordinary message: the path did not squash it.
      const ordinary = await trackerFailing(width, ORDINARY);
      assert.equal(
        seen.button.width,
        (await errorLayout(ordinary, 'tracker-error')).button?.width,
        'Retry was squashed',
      );
      await ordinary.context().close();
      // And it can really be pressed. The board fails again, so the strip stays.
      await page.locator('[data-testid="tracker-error"] button').click({ timeout: 5000 });
      await page.waitForSelector('[data-testid="tracker-error"] button:has-text("Retry")');
      await page.context().close();
    });

    it(`the box inside a Settings panel keeps the path inside at ${px}`, async () => {
      const page = await settingsPanel(width);
      await mountErrorBox(page, { variant: 'box', testId: 'probe-box', message: LONG_PATH });
      assertFits(`panel box, path (${px})`, await errorLayout(page, 'probe-box'));
      await page.context().close();
    });

    // NEGATIVE — the fix may change nothing else. An ordinary sentence wraps at
    // the same words, and the strip is the same height, as without the fix.
    it(`NEGATIVE: an ordinary sentence wraps exactly as before, in all three shapes, at ${px}`, async () => {
      const box = await settingsPanel(width);
      await mountErrorBox(box, { variant: 'box', testId: 'probe-box', message: ORDINARY });
      const shapes = [
        { page: await profileFailing(width, ORDINARY), id: 'profile-error' },
        { page: await trackerFailing(width, ORDINARY), id: 'tracker-error' },
        { page: box, id: 'probe-box' },
      ];
      for (const { page, id } of shapes) {
        const reference = await drawReference(page, id);
        const now = await errorLayout(page, id);
        const before = await errorLayout(page, reference);
        const starts = await lineStarts(page, id);
        console.log(
          `${id}, ordinary sentence (${px}): height ${String(now.strip.height)}, ` +
            `lines start ${JSON.stringify(starts)}`,
        );
        assertFits(`${id}, ordinary (${px})`, now);
        assert.ok(starts.length > 1, `${id}: the sentence is on one line, so wrapping is untested`);
        assert.deepEqual(starts, await lineStarts(page, reference), `${id}: wraps elsewhere`);
        assert.equal(now.strip.height, before.strip.height, `${id}: a different height`);
        assert.equal(now.message.width, before.message.width, `${id}: the words take a new width`);
        assert.equal(now.button?.width, before.button?.width, `${id}: Retry is a different width`);
        await page.context().close();
      }
    });

    // BOUNDARY — a word that just fits stays whole on one line; one letter
    // more and it breaks, instead of running off.
    it(`BOUNDARY: a word exactly as wide as the line stays whole; one letter more wraps, at ${px}`, async () => {
      const page = await profileScreen(width);
      await mountErrorBox(page, { variant: 'strip', testId: 'one-line', message: 'x' });
      // The longest run of x that fits the strip's line (its content box, inside
      // the padding), measured on a copy without the fix, which never breaks it.
      const fits = await page.evaluate((fix) => {
        const strip = document.querySelector('[data-testid="one-line"]');
        if (strip === null) throw new Error('no strip');
        const probe = strip.cloneNode(true) as HTMLElement;
        probe.classList.remove(...fix);
        probe.removeAttribute('data-testid');
        probe.removeAttribute('role');
        strip.after(probe);
        const style = getComputedStyle(probe);
        const line =
          probe.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        const range = document.createRange();
        let count = 1;
        for (; count < 1000; count += 1) {
          probe.textContent = 'x'.repeat(count + 1);
          range.selectNodeContents(probe);
          if (range.getBoundingClientRect().width > line) break;
        }
        probe.remove();
        return count;
      }, WRAP_FIX.strip);
      // Each measured before the next is drawn: one that spills makes the
      // screen around it wider, and that must not be blamed on the other.
      const line = await errorLayout(page, 'one-line');
      await mountErrorBox(page, { variant: 'strip', testId: 'exact', message: 'x'.repeat(fits) });
      const exact = await errorLayout(page, 'exact');
      await mountErrorBox(page, {
        variant: 'strip',
        testId: 'over',
        message: 'x'.repeat(fits + 1),
      });
      const over = await errorLayout(page, 'over');
      console.log(
        `a word as wide as the line (${px}): ${String(fits)} letters; heights ` +
          `${String(line.strip.height)} / ${String(exact.strip.height)} / ${String(over.strip.height)}`,
      );
      assert.ok(fits > 10 && fits < 1000, `${String(fits)} letters is not a line`);
      assertFits('exactly as wide', exact);
      assertFits('one letter more', over);
      assert.equal(exact.strip.height, line.strip.height, 'a word that fits was broken');
      assert.ok(over.strip.height > line.strip.height, 'one letter more did not wrap');
      await page.context().close();
    });

    it(`BOUNDARY: an empty message draws as it did before, in all three shapes, at ${px}`, async () => {
      const page = await profileScreen(width);
      await mountErrorBox(page, { variant: 'strip', testId: 'empty-strip', message: '' });
      await mountErrorBox(page, {
        variant: 'strip',
        layout: 'row',
        testId: 'empty-row',
        message: '',
      });
      const panel = await settingsPanel(width);
      await mountErrorBox(panel, { variant: 'box', testId: 'empty-box', message: '' });
      for (const [on, id] of [
        [page, 'empty-strip'],
        [page, 'empty-row'],
        [panel, 'empty-box'],
      ] as const) {
        const reference = await drawReference(on, id);
        const now = await errorLayout(on, id);
        assertFits(`${id} (${px})`, now);
        assert.ok(now.strip.height > 0, `${id}: not drawn`);
        assert.equal(now.strip.height, (await errorLayout(on, reference)).strip.height, id);
        assert.equal(await on.locator(`[role="alert"][data-testid="${id}"]`).count(), 1, id);
      }
      await page.context().close();
      await panel.context().close();
    });
  }

  // NEGATIVE — a check that cannot fail is not a check. The same strips with
  // the fix's classes taken off (what `main` drew) are reported.
  it('the check can fail: without the fix the path runs off, and Retry is off screen', async () => {
    const page = await trackerFailing(375, LONG_PATH);
    const without = await errorLayout(page, await drawReference(page, 'tracker-error'));
    console.log(`tracker strip without the fix: ${JSON.stringify(without)}`);
    // A row's span grows with the path, so it is the strip that is too wide.
    assert.ok(
      without.wider.some((line) => line.startsWith('tracker-error-reference')),
      `the spilling strip was not reported: ${JSON.stringify(without.wider)}`,
    );
    assert.ok((without.button?.right ?? 0) > without.viewport, 'Retry stayed on screen anyway');
    assert.ok(without.button?.onTop === false, 'Retry was pressable anyway');
    await page.context().close();

    const panel = await settingsPanel(375);
    await mountErrorBox(panel, { variant: 'box', testId: 'probe-box', message: LONG_PATH });
    const box = await errorLayout(panel, await drawReference(panel, 'probe-box'));
    assert.ok(
      box.wider.some((line) => line.startsWith('probe-box-reference')),
      `the spilling box was not reported: ${JSON.stringify(box.wider)}`,
    );
    await panel.context().close();
  });
});

/**
 * Drawn marks sit at a readable size beside their words (L-370).
 *
 * The marks were redrawn to fill more of their 1em box and given a heavier
 * line. `src/ui/StateMark.size.test.tsx` holds the drawing's size from its own
 * numbers, but jsdom does no layout, so whether a row grew for it — a taller
 * ATS row, a taller step button — is only knowable here.
 *
 * The harness's `?marks=1` page draws the three real components that put a
 * mark beside words, in states that show all nine marks. Each row is measured
 * against a NO-MARK TWIN: the same row cloned beside it with its marks taken
 * out, laid out in the same table, list or card. No height is written down
 * here, so a change of font or padding cannot make the check stale; only the
 * mark can make a row differ from its twin.
 *
 * At the narrowest window (375px) and at 150% zoom (a 1280px window is 853
 * CSS px wide at 150%) every mark must also sit inside its cell or button, and
 * the page must not scroll sideways.
 */
const MARK_WINDOWS = {
  desktop: { viewport: { width: 1280, height: 800 }, scale: 1 },
  'zoom 150%': { viewport: { width: 853, height: 533 }, scale: 1.5 },
  'phone 375px': { viewport: { width: 375, height: 800 }, scale: 1 },
} as const;

type MarkWindow = (typeof MARK_WINDOWS)[keyof typeof MARK_WINDOWS];

/** Every mark there is: the sheet must draw them all, or it tested less than it says. */
const ALL_MARKS = ['back', 'cross', 'dot', 'down', 'ring', 'skipped', 'tick', 'up', 'warning'];

async function openMarks(markWindow: MarkWindow): Promise<Page> {
  const context = await browser.newContext({
    viewport: markWindow.viewport,
    deviceScaleFactor: markWindow.scale,
    colorScheme: 'light',
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${origin}/?marks=1`);
  await page.waitForSelector('[data-testid="marks-sheet"] [data-mark]');
  await page.evaluate(() => document.fonts.ready);
  assert.deepEqual(errors, [], 'the sheet threw while drawing');
  // Unstyled, every row would be the same height with or without anything. The
  // card's border is a token-driven style; WebKit snaps its width to the
  // screen's pixels (1px is 0.67 CSS px at 150%), so only its presence counts.
  const border = await page.evaluate(() => {
    const card = document.querySelector('[data-testid="tailor-ats"]');
    if (card === null) return 'no ATS card';
    const style = getComputedStyle(card);
    return `${style.borderTopStyle} ${String(parseFloat(style.borderTopWidth) > 0)}`;
  });
  assert.equal(border, 'solid true', 'the ATS card has no border: the stylesheet did not load');
  return page;
}

interface MarkReport {
  /** The mark names drawn on the sheet. */
  readonly drawn: readonly string[];
  /** How many rows and lines were compared with their no-mark twin. */
  readonly compared: number;
  readonly problems: readonly string[];
}

/** Every row, button and line that is taller with its mark, and every mark outside its box. */
async function markProblems(page: Page): Promise<MarkReport> {
  return page.evaluate(() => {
    const sheet = document.querySelector('[data-testid="marks-sheet"]');
    if (sheet === null) return { drawn: [], compared: 0, problems: ['no sheet'] };
    const problems: string[] = [];
    let compared = 0;
    const height = (element: Element): number => element.getBoundingClientRect().height;
    const nameOf = (element: Element): string =>
      element.getAttribute('data-testid') ??
      element.closest('[data-testid]')?.getAttribute('data-testid') ??
      element.tagName.toLowerCase();

    // The same row, beside itself, without its marks.
    const againstTwin = (row: Element, what: string): void => {
      const twin = row.cloneNode(true) as Element;
      for (const mark of twin.querySelectorAll('[data-mark]')) mark.remove();
      row.after(twin);
      const withMark = height(row);
      const without = height(twin);
      twin.remove();
      compared += 1;
      if (Math.abs(withMark - without) > 0.01) {
        problems.push(`${what}: ${String(withMark)}px with its mark, ${String(without)}px without`);
      }
    };

    const marked = (selector: string): Element[] =>
      [...sheet.querySelectorAll(selector)].filter((row) => row.querySelector('[data-mark]'));
    for (const row of marked('[data-testid="tailor-ats"] tbody tr')) {
      againstTwin(row, `ATS row ${nameOf(row)}`);
    }
    for (const button of marked('[data-testid="job-steps"] button')) {
      againstTwin(button, `step button ${nameOf(button)}`);
    }
    for (const row of marked('[data-testid^="tracker-card-progress-"] > div')) {
      againstTwin(row, 'card dots row');
    }

    // One line of 13px text and one of 16px, with each kind of mark, against
    // the same words alone.
    const kinds = new Map<string, Element>();
    for (const mark of sheet.querySelectorAll('[data-mark]')) {
      const name = mark.getAttribute('data-mark') ?? '?';
      if (!kinds.has(name)) kinds.set(name, mark);
    }
    for (const [size, className] of [
      ['13px', 'text-xs'],
      ['16px', ''],
    ] as const) {
      for (const [name, mark] of kinds) {
        const line = document.createElement('p');
        line.className = className;
        line.append(mark.cloneNode(true), ' Missing');
        sheet.append(line);
        const actual = getComputedStyle(line).fontSize;
        if (actual !== size) problems.push(`the ${size} line is ${actual}`);
        againstTwin(line, `${size} line with ${name}`);
        line.remove();
      }
    }

    // Every mark inside the cell, button or card row that holds it, and on screen.
    for (const mark of sheet.querySelectorAll('[data-mark]')) {
      const holder = mark.closest('td, button, [data-testid^="tracker-card-progress-"]');
      const box = mark.getBoundingClientRect();
      const name = mark.getAttribute('data-mark') ?? '?';
      if (holder === null) {
        problems.push(`${name}: not in a cell, button or card`);
        continue;
      }
      const room = holder.getBoundingClientRect();
      const inside =
        box.left >= room.left - 0.5 &&
        box.right <= room.right + 0.5 &&
        box.top >= room.top - 0.5 &&
        box.bottom <= room.bottom + 0.5;
      if (!inside) problems.push(`${name} in ${nameOf(holder)}: outside its ${holder.tagName}`);
      if (box.right > window.innerWidth + 0.5 || box.left < -0.5) {
        problems.push(`${name}: off the side of the window`);
      }
    }
    const root = document.documentElement;
    if (root.scrollWidth > root.clientWidth) {
      problems.push(`page: ${String(root.scrollWidth - root.clientWidth)}px too wide`);
    }
    return { drawn: [...kinds.keys()].sort(), compared, problems };
  });
}

describe('drawn marks sit at a readable size beside their words (L-370)', () => {
  for (const [name, markWindow] of Object.entries(MARK_WINDOWS)) {
    it(`no row is taller for its mark, and every mark sits inside its cell, ${name}`, async () => {
      const page = await openMarks(markWindow);
      const report = await markProblems(page);
      console.log(`marks (${name}): ${JSON.stringify(report)}`);
      assert.deepEqual(report.drawn, ALL_MARKS, 'the sheet did not draw every mark');
      // 5 ATS rows, 6 step buttons, the dots row, and 9 marks × 2 line sizes.
      assert.ok(report.compared >= 30, `only ${String(report.compared)} rows compared`);
      assert.deepEqual(report.problems, []);
      await page.context().close();
    });
  }

  // NEGATIVE — a check that cannot fail is not a check. A mark twice the
  // height of its text makes its rows taller, and is caught.
  it('the check can fail: a mark drawn too big makes its rows taller, and is reported', async () => {
    const page = await openMarks(MARK_WINDOWS.desktop);
    await page.evaluate(() => {
      for (const svg of document.querySelectorAll('[data-mark] svg')) {
        svg.setAttribute('width', '2em');
        svg.setAttribute('height', '2em');
      }
    });
    const report = await markProblems(page);
    for (const kind of ['ATS row', 'step button', '13px line', '16px line']) {
      assert.ok(
        report.problems.some((line) => line.startsWith(kind)),
        `a taller ${kind} went unnoticed: ${JSON.stringify(report.problems)}`,
      );
    }
    await page.context().close();
  });

  it('the check can fail: a mark pushed out of its button is reported', async () => {
    const page = await openMarks(MARK_WINDOWS['phone 375px']);
    await page.evaluate(() => {
      const mark = document.querySelector<HTMLElement>('[data-testid="job-steps"] [data-mark]');
      if (mark === null) throw new Error('no mark in the step bar');
      mark.style.transform = 'translateX(-60px)';
    });
    const report = await markProblems(page);
    assert.ok(
      report.problems.some((line) => line.includes('outside its BUTTON')),
      `the pushed mark was not flagged: ${JSON.stringify(report.problems)}`,
    );
    await page.context().close();
  });
});

/**
 * A tracker card's Continue and its dots (L-319).
 *
 * The button keeps its short word, "Continue", so in the sheet's 176px card it
 * sits on the dots' line, as it always has. A card in a column at its minimum
 * (`md:min-w-44`, 176px, less the list's `px-2`) is 160px, and there the dots
 * (55px), the gap and "Continue" (80px) are about 9px too wide for one line:
 * the button wraps under the dots instead of squashing them onto two lines, as
 * it used to, or poking out of the card.
 */
async function continueProblems(
  page: Page,
  cardWidth: string | null,
  oneLine: boolean,
): Promise<string[]> {
  return page.evaluate(
    ([width, sameLine]) => {
      const row = document.querySelector('[data-testid="tracker-card-progress-marks"]');
      const button = row?.querySelector('button');
      if (!(row instanceof HTMLElement) || !button || !row.parentElement) return ['no card'];
      if (width !== null) row.parentElement.style.width = width;
      const problems: string[] = [];
      const room = row.getBoundingClientRect();
      const box = button.getBoundingClientRect();
      if (box.left < room.left - 0.5 || box.right > room.right + 0.5) {
        problems.push(`Continue: ${String(box.width)}px wide in a ${String(room.width)}px row`);
      }
      if (button.scrollWidth > button.clientWidth) problems.push('Continue: its words overflow it');
      const marks = [...row.querySelectorAll('[data-mark]')].map((mark) =>
        mark.getBoundingClientRect(),
      );
      const dotTops = new Set(marks.map((mark) => Math.round(mark.top)));
      if (dotTops.size !== 1) problems.push(`dots: squashed onto ${String(dotTops.size)} lines`);
      // One line: the dots' middle falls within the button's height.
      const dots = marks[0];
      if (sameLine && dots !== undefined) {
        const middle = dots.top + dots.height / 2;
        if (middle < box.top || middle > box.bottom) {
          problems.push(
            `Continue: not beside the dots (top ${String(box.top)}, dots ${String(middle)})`,
          );
        }
      }
      return problems;
    },
    [cardWidth, oneLine] as const,
  );
}

describe('a tracker card’s Continue fits its card (L-319)', () => {
  for (const [name, markWindow] of Object.entries(MARK_WINDOWS)) {
    it(`sits beside the dots on one line in a 176px card, ${name}`, async () => {
      const page = await openMarks(markWindow);
      assert.equal(
        await page.textContent('[data-testid="tracker-card-continue-marks"]'),
        'Continue',
      );
      assert.deepEqual(await continueProblems(page, null, true), []);
      await page.context().close();
    });

    it(`stays inside the narrowest desktop card, 160px, and the dots stay one line, ${name}`, async () => {
      const page = await openMarks(markWindow);
      assert.deepEqual(await continueProblems(page, '160px', false), []);
      await page.context().close();
    });
  }

  // NEGATIVE — the long "Continue: ATS Score" does not fit beside the dots in
  // a 176px card, and is caught.
  it('the check can fail: a Continue too long for the dots’ line is reported', async () => {
    const page = await openMarks(MARK_WINDOWS.desktop);
    await page.evaluate(() => {
      const button = document.querySelector('[data-testid="tracker-card-continue-marks"]');
      if (button === null) throw new Error('no Continue on the sheet');
      button.textContent = 'Continue: ATS Score';
    });
    const report = await continueProblems(page, null, true);
    assert.ok(
      report.some((line) => line.startsWith('Continue:')),
      `the long button was not flagged: ${JSON.stringify(report)}`,
    );
    await page.context().close();
  });
});

/**
 * A box that holds more than one block (L-377).
 *
 * Settings' notice (two paragraphs) and Erase everything's failure (a paragraph
 * and a list) moved onto `ErrorBox` as `variant="box" as="div"`. They gained
 * `break-words`, which is inherited, so a path inside a paragraph or a list
 * item breaks too. These checks draw the app's own `ErrorBox` in the `div` form
 * at the end of the Delete everything section, where the list form lives,
 * through `__mountBlockErrorBox` in the harness. With `reference`, the harness
 * draws the hand-built box `main` drew right after it, so "ordinary content
 * looks as it did" compares two boxes on the same machine with the same fonts.
 *
 * Uses the L-374 helpers above (`LONG_PATH`, `ORDINARY`, `errorLayout`,
 * `assertFits`, `lineStarts`, `open`, `goTo`); defines nothing they define.
 */
interface BlockMount {
  readonly holds: 'list' | 'paragraphs';
  readonly testId: string;
  readonly heading: string;
  readonly lines: readonly string[];
  readonly reference: boolean;
}

async function eraseSection(width: number): Promise<Page> {
  const page = await open('?seen=1', { width, height: 800 });
  await goTo(page, 'settings');
  await page.waitForSelector('[data-testid="settings-erase-section"]');
  return page;
}

async function mountBlockErrorBox(page: Page, box: BlockMount): Promise<void> {
  await page.evaluate((props) => {
    const into = document.createElement('div');
    document.querySelector('[data-testid="settings-erase-section"]')?.append(into);
    if (!into.isConnected) throw new Error(`nowhere to draw ${props.testId}`);
    (
      window as unknown as { __mountBlockErrorBox: (into: Element, box: unknown) => void }
    ).__mountBlockErrorBox(into, props);
  }, box);
  await page.waitForSelector(`[data-testid="${box.testId}"]`, { state: 'attached' });
}

/** The element, its role, and whether it sits inside the section, edge to edge. */
async function blockBox(
  page: Page,
  testId: string,
): Promise<{ tag: string; role: string | null; inside: boolean; text: string }> {
  return page.evaluate((id) => {
    const box = document.querySelector(`[data-testid="${id}"]`);
    const section = document.querySelector('[data-testid="settings-erase-section"]');
    if (box === null || section === null) throw new Error(`no ${id}`);
    const b = box.getBoundingClientRect();
    const s = section.getBoundingClientRect();
    return {
      tag: box.tagName,
      role: box.getAttribute('role'),
      inside: b.left >= s.left && b.right <= s.right,
      text: box.textContent ?? '',
    };
  }, testId);
}

const BLOCK_HEADING = 'Some of it could not be removed.';

describe('a box that holds more than one block (L-377)', () => {
  for (const width of ERROR_WIDTHS) {
    const px = `${String(width)}px`;

    for (const holds of ['list', 'paragraphs'] as const) {
      it(`the div form holding ${holds} keeps a 200-character path inside its panel at ${px}`, async () => {
        const page = await eraseSection(width);
        const lines = [LONG_PATH, 'Nothing else was changed.'];
        await mountBlockErrorBox(page, {
          holds,
          testId: 'block-box',
          heading: BLOCK_HEADING,
          lines,
          reference: false,
        });
        const box = await blockBox(page, 'block-box');
        assert.equal(box.tag, 'DIV', 'a box holding blocks must be a div, not a p');
        assert.equal(box.role, 'alert');
        assert.ok(box.inside, `the box is not inside its section at ${px}`);
        assertFits(`div box holding ${holds}, path (${px})`, await errorLayout(page, 'block-box'));
        // Every word is there: nothing was cut to make it fit.
        assert.equal(
          box.text,
          holds === 'list'
            ? `${BLOCK_HEADING}${lines.join('')}`
            : `${BLOCK_HEADING}${lines.join('\n')}`,
        );
        await page.context().close();
      });
    }

    // NEGATIVE — moving the box changed nothing with ordinary words: the same
    // height, width and line breaks as the hand-built box drawn beside it.
    it(`NEGATIVE: ordinary content looks exactly as the hand-built box did, both forms, at ${px}`, async () => {
      for (const holds of ['list', 'paragraphs'] as const) {
        const page = await eraseSection(width);
        await mountBlockErrorBox(page, {
          holds,
          testId: 'block-box',
          heading: BLOCK_HEADING,
          lines: [ORDINARY, 'The saved keys'],
          reference: true,
        });
        const now = await errorLayout(page, 'block-box');
        const before = await errorLayout(page, 'block-box-reference');
        const starts = await lineStarts(page, 'block-box');
        console.log(
          `div box holding ${holds}, ordinary (${px}): height ${String(now.strip.height)}, ` +
            `lines start ${JSON.stringify(starts)}`,
        );
        assertFits(`div box holding ${holds}, ordinary (${px})`, now);
        assert.ok(starts.length > 2, `${holds}: the content is on too few lines to test wrapping`);
        assert.deepEqual(
          starts,
          await lineStarts(page, 'block-box-reference'),
          `${holds}: wraps elsewhere`,
        );
        assert.equal(now.strip.height, before.strip.height, `${holds}: a different height`);
        assert.equal(now.message.width, before.message.width, `${holds}: a different width`);
        await page.context().close();
      }
    });

    it(`BOUNDARY: an empty div box draws as the hand-built one did, at ${px}`, async () => {
      const page = await eraseSection(width);
      await mountBlockErrorBox(page, {
        holds: 'paragraphs',
        testId: 'empty-block',
        heading: '',
        lines: [],
        reference: true,
      });
      const now = await errorLayout(page, 'empty-block');
      assertFits(`empty div box (${px})`, now);
      assert.ok(now.strip.height > 0, 'not drawn');
      assert.equal(
        now.strip.height,
        (await errorLayout(page, 'empty-block-reference')).strip.height,
      );
      assert.equal(await page.locator('[role="alert"][data-testid="empty-block"]').count(), 1);
      await page.context().close();
    });
  }

  // NEGATIVE — a check that cannot fail is not a check. The hand-built box,
  // without `break-words`, holding the path is reported spilling.
  it('the check can fail: the hand-built box holding the path spills out of its panel', async () => {
    for (const holds of ['list', 'paragraphs'] as const) {
      const page = await eraseSection(375);
      await mountBlockErrorBox(page, {
        holds,
        testId: 'block-box',
        heading: BLOCK_HEADING,
        lines: [LONG_PATH],
        reference: true,
      });
      const without = await errorLayout(page, 'block-box-reference');
      console.log(`hand-built box holding ${holds}, without the fix: ${JSON.stringify(without)}`);
      assert.ok(
        without.wider.some((line) => line.startsWith('block-box-reference')),
        `${holds}: the spilling box was not reported: ${JSON.stringify(without.wider)}`,
      );
      assert.ok(without.message.overrun > 100, `${holds}: the path did not run past the box`);
      await page.context().close();
    }
  });
});

/**
 * The last hand-built error boxes (L-380).
 *
 * The two boxes in the search results (one per job board, one per free feed
 * that failed) and the follow-up panel's box moved onto `ErrorBox`, so they
 * gained `break-words`. On `main` they were built by hand without it, and a
 * failed board's path ran 1666px wide in a 327px column (L-374's measurement).
 *
 * These checks draw the app's OWN `SearchResults` and `FollowUpPanel` through
 * the harness (`__mountSearchFailures`, `__mountFollowUpPanel`) — not a copy of
 * the box — in the real Search column and the real Tracker detail pane. So the
 * same spec, run on `main`'s screens, measures the hand-built boxes and is red.
 * "Looks as it did" compares against a reference drawn beside each box with the
 * fix's class taken off (`drawReference`, L-374): what `main` drew.
 *
 * Uses the L-374 helpers above (`LONG_PATH`, `ORDINARY`, `errorLayout`,
 * `assertFits`, `lineStarts`, `drawReference`, `open`, `goTo`); defines nothing
 * they define.
 */
const SEARCH_BOXES = ['search-error-reed', 'keyless-error-arbeitnow'] as const;
const FOLLOW_UP_BOX = 'detail-followup-error';
const FOLLOW_UP_WORDS = 'Your archived documents could not be read: ';

/** The Search screen with the real `SearchResults` drawn into its results column. */
async function searchWithFailures(width: number, message: string): Promise<Page> {
  const page = await open('?seen=1', { width, height: 800 });
  await goTo(page, 'search');
  await page.waitForSelector('[data-testid="search-empty"]');
  await page.evaluate(async (text) => {
    const empty = document.querySelector('[data-testid="search-empty"]');
    const into = document.createElement('div');
    into.setAttribute('data-testid', 'l380-search-results');
    empty?.before(into);
    if (!into.isConnected) throw new Error('nowhere to draw the search results');
    await (
      window as unknown as {
        __mountSearchFailures: (into: Element, props: { message: string }) => Promise<void>;
      }
    ).__mountSearchFailures(into, { message: text });
  }, message);
  for (const id of SEARCH_BOXES) await page.waitForSelector(`[data-testid="${id}"]`);
  return page;
}

/** Tracker with an application open, and the real `FollowUpPanel` failing to draft in its pane. */
async function followUpFailing(width: number, message: string): Promise<Page> {
  const page = await open('?seen=1&entries=1', { width, height: 800 });
  await goTo(page, 'tracker');
  await page.waitForSelector('[data-testid="tracker-card-c"]');
  await page.click('[data-testid="tracker-card-c"]');
  await page.waitForSelector('[data-testid="detail-followup"]');
  await page.evaluate(async (text) => {
    const panel = document.querySelector('[data-testid="detail-followup"]');
    const into = document.createElement('div');
    into.setAttribute('data-testid', 'l380-followup');
    panel?.after(into);
    if (!into.isConnected) throw new Error('nowhere to draw the follow-up panel');
    await (
      window as unknown as {
        __mountFollowUpPanel: (into: Element, props: { message: string }) => Promise<void>;
      }
    ).__mountFollowUpPanel(into, { message: text });
  }, message);
  const draft = page.locator('[data-testid="l380-followup"] [data-testid="detail-followup-draft"]');
  await draft.waitFor();
  await page.waitForFunction(() => {
    const button = document.querySelector(
      '[data-testid="l380-followup"] [data-testid="detail-followup-draft"]',
    );
    return button instanceof HTMLButtonElement && !button.disabled;
  });
  await draft.click();
  await page.waitForSelector(`[data-testid="l380-followup"] [data-testid="${FOLLOW_UP_BOX}"]`);
  return page;
}

/** The box: its element, role and kind, its words, and whether it sits inside its column. */
async function lastBox(
  page: Page,
  testId: string,
): Promise<{
  tag: string;
  role: string | null;
  kind: string | null;
  inside: boolean;
  text: string;
}> {
  return page.evaluate((id) => {
    const box = document.querySelector(`[data-testid="${id}"]`);
    const column = box?.closest('[data-testid^="l380-"]')?.parentElement;
    if (box === null || column === null || column === undefined) throw new Error(`no ${id}`);
    const b = box.getBoundingClientRect();
    const c = column.getBoundingClientRect();
    return {
      tag: box.tagName,
      role: box.getAttribute('role'),
      kind: box.getAttribute('data-kind'),
      inside: b.left >= c.left - 0.5 && b.right <= c.right + 0.5,
      text: box.textContent ?? '',
    };
  }, testId);
}

describe('the last hand-built error boxes (L-380)', () => {
  for (const width of ERROR_WIDTHS) {
    const px = `${String(width)}px`;

    it(`a failed board and a failed feed keep a 200-character path inside the search column at ${px}`, async () => {
      const page = await searchWithFailures(width, LONG_PATH);
      for (const id of SEARCH_BOXES) {
        const box = await lastBox(page, id);
        assert.equal(box.tag, 'P');
        assert.equal(box.role, 'alert');
        assert.equal(box.kind, 'server', `${id}: the kind of failure is not marked`);
        assert.ok(box.inside, `${id}: the box is not inside the search column at ${px}`);
        assert.equal(box.text, LONG_PATH, `${id}: words were lost`);
        assertFits(`${id}, path (${px})`, await errorLayout(page, id));
      }
      await page.context().close();
    });

    it(`the follow-up panel's box keeps a 200-character path inside the detail pane at ${px}`, async () => {
      const page = await followUpFailing(width, LONG_PATH);
      const box = await lastBox(page, FOLLOW_UP_BOX);
      assert.equal(box.tag, 'P');
      assert.equal(box.role, 'alert');
      assert.ok(box.inside, `the box is not inside the detail pane at ${px}`);
      assert.equal(box.text, `${FOLLOW_UP_WORDS}${LONG_PATH}`);
      assertFits(`follow-up box, path (${px})`, await errorLayout(page, FOLLOW_UP_BOX));
      await page.context().close();
    });

    // NEGATIVE — moving the boxes changed nothing with ordinary words: the same
    // height, width and line breaks as the hand-built box drawn beside each.
    it(`NEGATIVE: ordinary messages look exactly as the hand-built boxes did, at ${px}`, async () => {
      const pages = [
        { page: await searchWithFailures(width, ORDINARY), ids: SEARCH_BOXES },
        { page: await followUpFailing(width, ORDINARY), ids: [FOLLOW_UP_BOX] },
      ];
      for (const { page, ids } of pages) {
        for (const id of ids) {
          const reference = await drawReference(page, id);
          const now = await errorLayout(page, id);
          const before = await errorLayout(page, reference);
          const starts = await lineStarts(page, id);
          console.log(
            `${id}, ordinary (${px}): height ${String(now.strip.height)}, ` +
              `lines start ${JSON.stringify(starts)}`,
          );
          assertFits(`${id}, ordinary (${px})`, now);
          assert.ok(
            starts.length >= 2,
            `${id}: the message is on one line, so wrapping is untested`,
          );
          assert.deepEqual(starts, await lineStarts(page, reference), `${id}: wraps elsewhere`);
          assert.equal(now.strip.height, before.strip.height, `${id}: a different height`);
          assert.equal(now.message.width, before.message.width, `${id}: a different width`);
        }
        await page.context().close();
      }
    });
  }

  // NEGATIVE — a check that cannot fail is not a check. Without `break-words`
  // (what `main` drew), the path spills out of the box and widens its column.
  it('the check can fail: the hand-built boxes holding the path spill out', async () => {
    const pages = [
      { page: await searchWithFailures(375, LONG_PATH), ids: SEARCH_BOXES },
      { page: await followUpFailing(375, LONG_PATH), ids: [FOLLOW_UP_BOX] },
    ];
    for (const { page, ids } of pages) {
      for (const id of ids) {
        const reference = await drawReference(page, id);
        const without = await errorLayout(page, reference);
        console.log(`${id}, hand-built, without the fix: ${JSON.stringify(without)}`);
        assert.ok(
          without.wider.some((line) => line.startsWith(reference)),
          `${id}: the spilling box was not reported: ${JSON.stringify(without.wider)}`,
        );
        assert.ok(without.message.overrun > 100, `${id}: the path did not run past the box`);
      }
      await page.context().close();
    }
  });
});

/**
 * A suggestion's priority label stays on one line, inside its card (L-378).
 *
 * The label is the shared `StatusPill`, which does not shrink: when a long
 * section name squeezes the row on a phone, the section name wraps and the
 * label keeps its one line. Before L-378 the hand-built label shrank and broke
 * onto two lines ("Do this / first"). jsdom does no layout, so only a real
 * browser can say which of the two happened.
 *
 * The harness's `__mountPrioritySuggestions` draws the app's own
 * `AnalysisResult` with one suggestion of each priority and long section
 * names, in a phone-width column. One line is measured, not written down: the
 * label's height must be its own line height plus its padding.
 */
const PRIORITY_WINDOW = { width: 375, height: 800 } as const;

interface PriorityReport {
  readonly labels: readonly string[];
  readonly problems: readonly string[];
}

async function openPriorities(): Promise<Page> {
  const context = await browser.newContext({ viewport: PRIORITY_WINDOW, colorScheme: 'light' });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${origin}/?seen=1`);
  await page.waitForSelector('[data-testid="nav-analysis"]');
  await page.evaluate(async () => {
    document.getElementById('root')?.setAttribute('hidden', '');
    const column = document.createElement('main');
    column.className = 'p-4';
    document.body.append(column);
    await (
      window as unknown as { __mountPrioritySuggestions: (into: Element) => Promise<void> }
    ).__mountPrioritySuggestions(column);
  });
  await page.waitForSelector('main [data-testid="analysis-suggestion-low"]');
  await page.evaluate(() => document.fonts.ready);
  assert.deepEqual(errors, [], 'the suggestions threw while drawing');
  return page;
}

async function priorityProblems(page: Page): Promise<PriorityReport> {
  return page.evaluate(() => {
    const problems: string[] = [];
    const labels: string[] = [];
    for (const card of document.querySelectorAll('main [data-testid^="analysis-suggestion-"]')) {
      // The first thing in the card's top row: the label, before or after L-378.
      const label = card.querySelector(':scope > div > span:first-child');
      const name = card.getAttribute('data-testid') ?? '?';
      if (label === null) {
        problems.push(`${name}: no label`);
        continue;
      }
      labels.push(label.textContent ?? '');
      const style = getComputedStyle(label);
      const oneLine =
        parseFloat(style.lineHeight) +
        parseFloat(style.paddingTop) +
        parseFloat(style.paddingBottom);
      const box = label.getBoundingClientRect();
      if (box.height > oneLine + 0.5) {
        problems.push(
          `${name}: label is ${String(box.height)}px tall, one line is ${String(oneLine)}px`,
        );
      }
      const room = card.getBoundingClientRect();
      if (box.left < room.left - 0.5 || box.right > room.right + 0.5) {
        problems.push(`${name}: label is outside its card`);
      }
      // The squeeze is real: the section name beside it did wrap.
      const section = label.nextElementSibling;
      if (section === null || section.getBoundingClientRect().height <= oneLine) {
        problems.push(`${name}: the section name did not wrap, so the row was never squeezed`);
      }
    }
    const root = document.documentElement;
    if (root.scrollWidth > root.clientWidth) {
      problems.push(`page: ${String(root.scrollWidth - root.clientWidth)}px too wide`);
    }
    return { labels, problems };
  });
}

describe('a suggestion priority label stays on one line, inside its card (L-378)', () => {
  it('each priority label keeps one line beside a long section name at 375px', async () => {
    const page = await openPriorities();
    const report = await priorityProblems(page);
    console.log(`priority labels (375px): ${JSON.stringify(report)}`);
    assert.deepEqual(report.labels, ['Do this first', 'Worth doing', 'If you have time']);
    assert.deepEqual(report.problems, []);
    await page.context().close();
  });

  // NEGATIVE — a label allowed to shrink (as the hand-built one did) breaks
  // onto two lines, and is caught.
  it('the check can fail: a label that may shrink wraps, and is reported', async () => {
    const page = await openPriorities();
    await page.evaluate(() => {
      for (const label of document.querySelectorAll<HTMLElement>(
        'main [data-testid^="analysis-suggestion-"] > div > span:first-child',
      )) {
        label.style.flexShrink = '1';
      }
    });
    const report = await priorityProblems(page);
    assert.ok(
      report.problems.some((line) => line.includes('analysis-suggestion-high: label is')),
      `the wrapped label was not flagged: ${JSON.stringify(report.problems)}`,
    );
    await page.context().close();
  });
});

/**
 * Page titles: one line, in the serif, and the header no taller (L-382).
 *
 * The page title grew from 18px on a 28px line to 24px on a 32px line, set in
 * Newsreader at regular weight, and the header bar's padding shrank by the same
 * 4px. The header must not grow: the Search form fits the 1000×700 minimum
 * window by only 2px (the L-342 checks above), and the Smoke pictures need the
 * step bar and the ATS table fully on screen. On main before L-382 every
 * screen's header measured 85px at 1000×700 in this harness; that is the cap.
 *
 * One line is measured, not written down: the title's height must be its own
 * line height. jsdom does no layout and loads no fonts, so only a real engine
 * can say either.
 */
const HEADER_CAP_PX = 85;
const TITLE_WINDOWS = {
  smallest: { width: 1000, height: 700 },
  phone: { width: 375, height: 800 },
} as const;

async function titleProblems(
  page: Page,
  view: string,
  headerCap: number | null,
): Promise<string[]> {
  return page.evaluate(
    ({ view, headerCap }) => {
      const title = document.querySelector<HTMLElement>(`[data-testid="view-${view}"] h1`);
      const header = title?.closest('header');
      if (title === null || title === undefined || header === null || header === undefined) {
        return [`${view}: no title in a header`];
      }
      const problems: string[] = [];
      const line = parseFloat(getComputedStyle(title).lineHeight);
      const height = title.getBoundingClientRect().height;
      if (height > line + 0.5) {
        problems.push(`${view}: title is ${String(height)}px tall, one line is ${String(line)}px`);
      }
      if (title.scrollWidth > title.clientWidth + 0.5) {
        problems.push(`${view}: title is clipped`);
      }
      const tall = header.getBoundingClientRect().height;
      if (headerCap !== null && tall > headerCap + 0.5) {
        problems.push(
          `${view}: header is ${String(tall)}px tall, the cap is ${String(headerCap)}px`,
        );
      }
      return problems;
    },
    { view, headerCap },
  );
}

async function everyTitle(
  viewport: { width: number; height: number },
  headerCap: number | null,
): Promise<string[]> {
  const page = await open('?seen=1', viewport);
  const problems: string[] = [];
  for (const view of VIEWS) {
    await goTo(page, view);
    problems.push(...(await titleProblems(page, view, headerCap)));
  }
  await page.context().close();
  return problems;
}

describe('page titles stay on one line in the serif, and the header does not grow (L-382)', () => {
  it(`every screen's title is one line and the header is no taller than ${String(HEADER_CAP_PX)}px at 1000×700`, async () => {
    assert.deepEqual(await everyTitle(TITLE_WINDOWS.smallest, HEADER_CAP_PX), []);
  });

  it("every screen's title is one line at 375×800", async () => {
    assert.deepEqual(await everyTitle(TITLE_WINDOWS.phone, null), []);
  });

  it("the title's computed font family is Newsreader at weight 400, and the face loaded", async () => {
    const page = await open('?seen=1', TITLE_WINDOWS.smallest);
    await goTo(page, 'settings');
    const seen = await page.evaluate(() => {
      const title = document.querySelector('[data-testid="view-settings"] h1');
      const style = title === null ? null : getComputedStyle(title);
      return {
        family: style?.fontFamily.split(',')[0]?.trim().replaceAll(/['"]/g, '') ?? '',
        weight: style?.fontWeight ?? '',
        size: style?.fontSize ?? '',
        // A family name in the computed style proves nothing if the file never
        // arrived: the browser would draw the Georgia fallback under that name.
        loaded: document.fonts.check('400 24px Newsreader'),
      };
    });
    assert.deepEqual(seen, { family: 'Newsreader', weight: '400', size: '24px', loaded: true });
    await page.context().close();
  });

  // NEGATIVE — a title too long for its row wraps, and is caught.
  it('the check can fail: a long title is reported', async () => {
    const page = await open('?seen=1', TITLE_WINDOWS.smallest);
    await goTo(page, 'settings');
    await page.evaluate(() => {
      const title = document.querySelector('[data-testid="view-settings"] h1');
      if (title !== null) title.textContent = 'Settings '.repeat(20).trim();
    });
    const problems = await titleProblems(page, 'settings', HEADER_CAP_PX);
    assert.ok(
      problems.some((line) => line.startsWith('settings: title is')),
      `the wrapped title was not flagged: ${JSON.stringify(problems)}`,
    );
    assert.ok(
      problems.some((line) => line.startsWith('settings: header is')),
      `the taller header was not flagged: ${JSON.stringify(problems)}`,
    );
    await page.context().close();
  });
});
