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
 * The shared content column (L-341) never makes a screen scroll sideways.
 *
 * jsdom does no layout, so `contentColumn.contract.test.tsx` can only read the
 * classes. Here the real engine measures, at 1000px — a narrow desktop window,
 * where the column's `max-w-4xl` (896px) plus the rail is wider than the window
 * and the column must give way, not overflow.
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

describe('the shared content column fits the window (L-341)', () => {
  for (const view of COLUMN_VIEWS) {
    it(`the ${view} screen has no sideways scroll at 1000px`, async () => {
      const page = await open('?seen=1', { width: 1000, height: 800 });
      await goTo(page, view);
      await page.waitForSelector('[data-content-column]');
      const width = await page.evaluate(
        () => document.querySelector('[data-content-column]')?.getBoundingClientRect().width ?? 0,
      );
      console.log(`${view} at 1000px: column ${String(Math.round(width))}px wide`);
      assert.ok(width > 0 && width <= 896, `${view}: column ${String(width)}px`);
      assert.deepEqual(await sidewaysOverflow(page), []);
      await page.context().close();
    });
  }

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
