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
