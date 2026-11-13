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

  /*
    L-390: the key cards are closed rows now, and axe skips what a closed fold
    hides, so the plain Settings visit above measures less than it used to.
    This puts the inside of a row back under the check: one AI row open, and
    the job-board fold with its Reed row open. With every key saved too, so
    the saved lines and the model in each title are measured.
  */
  for (const [width, viewport] of Object.entries(VIEWPORTS)) {
    for (const query of ['?seen=1', '?seen=1&results=1']) {
      it(`Settings with an AI row and the Reed row open, ${width}, ${query}`, async () => {
        const page = await open(query, viewport);
        await goTo(page, 'settings');
        await page.click('[data-testid="ai-key-row-openai"] > summary');
        await page.locator('[data-testid="ai-key-input-openai"]:visible').waitFor();
        // axe measures only text on screen, so each open row is brought into view.
        await page.locator('[data-testid="ai-key-card-openai"]').scrollIntoViewIfNeeded();
        judge(`settings, AI row open (${width}, ${query})`, await contrast(page));
        await page.click('[data-testid="settings-advanced"] > summary');
        await page.click('[data-testid="key-row-reed"] > summary');
        await page.locator('[data-testid="key-input-reed_api_key"]:visible').waitFor();
        await page.locator('[data-testid="key-card-reed"]').scrollIntoViewIfNeeded();
        judge(`settings, Reed row open (${width}, ${query})`, await contrast(page));
        await page.context().close();
      });
    }
  }

  /*
    L-398: "Where to look" is a closed fold now, so the plain Search visit
    above no longer measures its text. This opens it and measures its top and
    its foot in view, with and without a key saved (the keyed boards row).
  */
  for (const [width, viewport] of Object.entries(VIEWPORTS)) {
    for (const query of ['?seen=1', '?seen=1&results=1']) {
      it(`Search with Where to look open, ${width}, ${query}`, async () => {
        const page = await open(query, viewport);
        await goTo(page, 'search');
        await page.click('[data-testid="search-where-fold"] > summary');
        await page.locator('[data-testid="keyless-bar"]:visible').waitFor();
        await page.locator('[data-testid="keyless-feeds"]').scrollIntoViewIfNeeded();
        judge(`search, where open, top (${width}, ${query})`, await contrast(page));
        await page.locator('[data-testid="keyless-bar"]').scrollIntoViewIfNeeded();
        judge(`search, where open, foot (${width}, ${query})`, await contrast(page));
        await page.context().close();
      });
    }
  }
});

/**
 * Placeholder text (L-316). axe's colour-contrast rule does not measure the
 * example text in an empty box, so read the colour WebKit paints it in. Before
 * the theme rule it was the text colour at 50%, about 3.4:1.
 */
const INK_FAINT = 'rgb(95, 107, 128)'; // --color-ink-faint, #5f6b80

async function placeholderColours(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[placeholder]')].map(
      (box) =>
        `${box.getAttribute('data-testid') ?? box.tagName}: ${getComputedStyle(box, '::placeholder').color}`,
    ),
  );
}

describe('placeholder text is painted in ink-faint (L-316)', () => {
  for (const view of ['profile', 'search'] as const) {
    it(`every placeholder on ${view} computes to the ink-faint colour`, async () => {
      const page = await open('?seen=1', VIEWPORTS.desktop);
      await goTo(page, view);
      const found = await placeholderColours(page);
      assert.ok(found.length >= 4, `${view}: only ${String(found.length)} placeholders found`);
      assert.deepEqual(
        found.filter((line) => !line.endsWith(`: ${INK_FAINT}`)),
        [],
        `${view}: placeholders not in ink-faint`,
      );
      await page.context().close();
    });
  }

  // The rule sits in `@layer base`, so a box's own `placeholder:` class (layer
  // utilities) must still win. SubstageEditor ships `placeholder:text-ink-muted`.
  it("a box's own placeholder: class still beats the theme rule", async () => {
    const page = await open('?seen=1', VIEWPORTS.desktop);
    const colour = await page.evaluate(() => {
      const box = document.createElement('input');
      box.placeholder = 'probe';
      box.className = 'placeholder:text-ink-muted';
      document.querySelector('main')?.prepend(box);
      return getComputedStyle(box, '::placeholder').color;
    });
    assert.equal(colour, 'rgb(70, 83, 106)', 'the per-box ink-muted placeholder lost to the theme');
    await page.context().close();
  });
});

/**
 * The match score is the hero; the keyword check is a plain row under it (L-391).
 *
 * Both numbers are out of 100, and both used to be in the serif, the keyword
 * one in a white card — so it read as a second score. jsdom does no layout and
 * loads no fonts, so only a real engine can measure which one the eye meets.
 * Measured on the real sample result, in its grey box, as Smoke picture 3 is.
 */
const HERO_WINDOWS = [
  { width: 1000, height: 700 },
  { width: 1264, height: 720 },
  { width: 1440, height: 900 },
  { width: 375, height: 812 },
] as const;

interface HeroReport {
  readonly heroHeight: number;
  readonly scorePx: number;
  readonly keywordPx: number;
  /** True when the verdict pill sits on the numeral's row, not under the bar. */
  readonly pillBeside: boolean;
  readonly problems: readonly string[];
}

async function openSample(viewport: { width: number; height: number }): Promise<Page> {
  const page = await open('?seen=1', viewport);
  await goTo(page, 'analysis');
  await page.click('[data-testid="analysis-try-sample"]');
  await page.waitForSelector('[data-testid="analysis-sample"] [data-testid="analysis-ats-score"]');
  await page.evaluate(() => document.fonts.ready);
  return page;
}

async function heroReport(page: Page): Promise<HeroReport> {
  return page.evaluate(() => {
    const problems: string[] = [];
    const inSample = (id: string): HTMLElement | null =>
      document.querySelector(`[data-testid="analysis-sample"] [data-testid="${id}"]`);
    const hero = inSample('analysis-hero');
    const score = inSample('band-scale-score');
    const keyword = inSample('analysis-ats-score');
    const keywordValue = inSample('analysis-ats-score-value');
    const pill = inSample('analysis-verdict');
    if (!hero || !score || !keyword || !keywordValue || !pill) {
      return {
        heroHeight: 0,
        scorePx: 0,
        keywordPx: 0,
        pillBeside: false,
        problems: ['the sample has no hero, score, verdict or keyword row'],
      };
    }
    const scorePx = parseFloat(getComputedStyle(score).fontSize);
    const keywordPx = parseFloat(getComputedStyle(keywordValue).fontSize);
    if (scorePx < keywordPx * 2) {
      problems.push(
        `size: the score is ${String(scorePx)}px, the keyword number ${String(keywordPx)}px`,
      );
    }
    const heroBox = hero.getBoundingClientRect();
    const rowBox = keyword.getBoundingClientRect();
    if (hero.contains(keyword) || keyword.contains(hero)) {
      problems.push('place: the keyword row and the hero are one block');
    }
    if (rowBox.top < heroBox.bottom - 0.5) {
      problems.push(
        `place: the keyword row starts at ${String(rowBox.top)}px, above the hero's bottom ${String(heroBox.bottom)}px`,
      );
    }
    const labels = ['weak', 'possible', 'strong'].map((band) =>
      inSample(`band-scale-label-${band}`)?.getBoundingClientRect(),
    );
    for (let i = 0; i + 1 < labels.length; i += 1) {
      const left = labels[i];
      const right = labels[i + 1];
      if (!left || !right) problems.push('labels: a band label is missing');
      else if (left.right >= right.left) {
        problems.push(`labels: band labels ${String(i)} and ${String(i + 1)} touch`);
      }
    }
    const scoreBox = score.getBoundingClientRect();
    const pillBox = pill.getBoundingClientRect();
    return {
      heroHeight: heroBox.height,
      scorePx,
      keywordPx,
      pillBeside: pillBox.top < scoreBox.bottom,
      problems,
    };
  });
}

describe('the match score is the hero, the keyword check a plain row below (L-391)', () => {
  for (const viewport of HERO_WINDOWS) {
    const size = `${String(viewport.width)}×${String(viewport.height)}`;

    it(`the match score is drawn at least twice the size of the keyword number, ${size}`, async () => {
      const page = await openSample(viewport);
      const report = await heroReport(page);
      console.log(`hero at ${size}: ${JSON.stringify(report)}`);
      assert.deepEqual(
        report.problems.filter((line) => line.startsWith('size') || line.startsWith('the sample')),
        [],
      );
      await page.context().close();
    });

    it(`the keyword row starts below the hero, never beside or inside it, ${size}`, async () => {
      const page = await openSample(viewport);
      const report = await heroReport(page);
      assert.deepEqual(
        report.problems.filter((line) => line.startsWith('place') || line.startsWith('the sample')),
        [],
      );
      await page.context().close();
    });

    it(`the band labels do not touch, ${size}`, async () => {
      const page = await openSample(viewport);
      const report = await heroReport(page);
      assert.deepEqual(
        report.problems.filter(
          (line) => line.startsWith('labels') || line.startsWith('the sample'),
        ),
        [],
      );
      await page.context().close();
    });

    it(`no sideways scroll, ${size}`, async () => {
      const page = await openSample(viewport);
      assert.deepEqual(await sidewaysOverflow(page), []);
      await page.context().close();
    });
  }

  // NEGATIVE — a check that cannot fail is not a check.
  it('the check can fail: a big keyword number inside the hero, and touching labels, are reported', async () => {
    const page = await openSample({ width: 1000, height: 700 });
    await page.evaluate(() => {
      const inSample = (id: string): HTMLElement | null =>
        document.querySelector(`[data-testid="analysis-sample"] [data-testid="${id}"]`);
      const value = inSample('analysis-ats-score-value');
      if (value) value.style.fontSize = '48px';
      const keyword = inSample('analysis-ats-score');
      if (keyword) inSample('analysis-hero')?.append(keyword);
      const possible = inSample('band-scale-label-possible');
      if (possible) possible.style.left = '2%';
    });
    const report = await heroReport(page);
    for (const kind of ['size:', 'place:', 'labels:']) {
      assert.ok(
        report.problems.some((line) => line.startsWith(kind)),
        `${kind} was not flagged: ${JSON.stringify(report.problems)}`,
      );
    }
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
  for (const width of [1000, 1024, 1280, 1440]) {
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
 * window (L-383). "Applied so far" and "Interview or offer" (L-388; it was
 * "Interviewed so far", the same length) are longer labels, so at 375px the strip
 * may take one more row, never a sideways scroll.
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

  // L-387: the strip's one hint "i", on "Applied so far", is at least 24×24 and
  // takes no extra row: the strip is no taller than with the "i" taken out.
  for (const width of [375, 1264]) {
    it(`its one hint "i" is at least 24×24 and adds no row, at ${String(width)}px`, async () => {
      const page = await openTrackerAt(width);
      const report = await funnelHintReport(page);
      console.log(`funnel hint at ${String(width)}px: ${JSON.stringify(report)}`);
      assert.equal(report.count, 1, `${String(report.count)} "i" on the strip, not 1`);
      assert.ok(report.width >= 24 && report.height >= 24, `"i" is ${JSON.stringify(report)}`);
      assert.equal(report.withIt, report.without, 'the "i" gave the strip another row');
      assert.deepEqual(await funnelOverflow(page), []);
      await page.context().close();
    });
  }

  it('the check can fail: an "i" too wide for its row is reported as another row', async () => {
    const page = await openTrackerAt(375);
    await page.evaluate(() => {
      const button = document.querySelector<HTMLElement>(
        '[data-testid="tracker-funnel"] [data-testid="hint-info"]',
      );
      if (button !== null) button.style.minWidth = '260px';
    });
    const report = await funnelHintReport(page);
    assert.ok(
      report.withIt > report.without,
      `the extra row was not seen: ${JSON.stringify(report)}`,
    );
    await page.context().close();
  });
});

async function openTrackerAt(width: number): Promise<Page> {
  const page = await open('?seen=1&entries=1', { width, height: 700 });
  await goTo(page, 'tracker');
  await page.waitForSelector('[data-testid="tracker-funnel"]');
  return page;
}

/** The strip's "i" count and size, and the strip's height with and without the first "i". */
async function funnelHintReport(page: Page): Promise<{
  count: number;
  width: number;
  height: number;
  withIt: number;
  without: number;
}> {
  return page.evaluate(() => {
    const strip = document.querySelector('[data-testid="tracker-funnel"]');
    if (strip === null) throw new Error('no funnel strip');
    const buttons = [...strip.querySelectorAll<HTMLElement>('[data-testid="hint-info"]')];
    const button = buttons[0];
    if (button === undefined) return { count: 0, width: 0, height: 0, withIt: 0, without: 0 };
    const box = button.getBoundingClientRect();
    const withIt = strip.getBoundingClientRect().height;
    button.style.display = 'none';
    const without = strip.getBoundingClientRect().height;
    button.style.display = '';
    return { count: buttons.length, width: box.width, height: box.height, withIt, without };
  });
}

/**
 * Richer cards (L-393): the title may take three lines and company · location
 * two, an undated next action shows as one muted line, and an overdue one adds
 * a red dot beside the title. `?entries=long` stretches every part of a card:
 * a 200-letter word for a title, a long company, long action words. jsdom does
 * no layout, so only a real engine can say the card still fits its column.
 */
async function openLongBoard(width: number, height: number): Promise<Page> {
  const page = await open('?seen=1&entries=long', { width, height });
  await goTo(page, 'tracker');
  await page.waitForSelector('[data-testid="tracker-card-late"]');
  return page;
}

interface CardFit {
  readonly problems: string[];
  readonly cards: { id: string; width: number; height: number; column: number }[];
}

async function cardFit(page: Page): Promise<CardFit> {
  return page.evaluate(() => {
    const problems: string[] = [];
    const cards: { id: string; width: number; height: number; column: number }[] = [];
    const root = document.documentElement;
    if (root.scrollWidth > root.clientWidth) {
      problems.push(`page: ${String(root.scrollWidth - root.clientWidth)}px too wide`);
    }
    const found = document.querySelectorAll<HTMLElement>(
      'button[data-testid^="tracker-card-"][data-status]',
    );
    if (found.length === 0) problems.push('no tracker cards drawn');
    for (const card of found) {
      const id = (card.getAttribute('data-testid') ?? '').replace('tracker-card-', '');
      const box = card.getBoundingClientRect();
      const column = card.closest('[data-testid^="tracker-column-"]')?.getBoundingClientRect();
      cards.push({
        id,
        width: Math.round(box.width),
        height: Math.round(box.height),
        column: Math.round(column?.width ?? 0),
      });
      if (column === undefined) problems.push(`${id}: not in a column`);
      else if (box.width > column.width + 0.5) {
        problems.push(`${id}: card ${String(box.width)}px in a ${String(column.width)}px column`);
      }
      if (card.scrollWidth > card.clientWidth) {
        problems.push(`${id}: ${String(card.scrollWidth - card.clientWidth)}px spills sideways`);
      }
      // The lines that wrap must break a long word, never run past the card.
      for (const line of card.querySelectorAll<HTMLElement>('.break-words')) {
        if (line.scrollWidth > line.clientWidth) {
          problems.push(
            `${id}: "${(line.textContent ?? '').slice(0, 20)}…" runs ${String(line.scrollWidth - line.clientWidth)}px past its line`,
          );
        }
      }
      const when = card.querySelector(`[data-testid="tracker-card-due-when-${id}"]`);
      if (when !== null) {
        const due = when.getBoundingClientRect();
        if (
          due.width === 0 ||
          due.left < box.left ||
          due.right > box.right ||
          due.top < box.top ||
          due.bottom > box.bottom
        ) {
          problems.push(`${id}: "${when.textContent ?? ''}" is not wholly inside the card`);
        }
      }
    }
    return { problems, cards };
  });
}

async function overdueDot(
  page: Page,
): Promise<{ count: number; width: number; height: number; inside: boolean }> {
  return page.evaluate(() => {
    const card = document.querySelector('[data-testid="tracker-card-late"]');
    const dots = card?.querySelectorAll('[data-testid="tracker-card-overdue-late"]') ?? [];
    const dot = dots[0];
    if (card === null || dot === undefined) return { count: 0, width: 0, height: 0, inside: false };
    const box = dot.getBoundingClientRect();
    const outer = card.getBoundingClientRect();
    return {
      count: dots.length,
      width: box.width,
      height: box.height,
      inside:
        box.left >= outer.left &&
        box.right <= outer.right &&
        box.top >= outer.top &&
        box.bottom <= outer.bottom,
    };
  });
}

describe('richer Tracker cards fit their column (L-393)', () => {
  for (const [width, height] of [
    [1000, 700],
    [1264, 720],
    [1440, 900],
    [375, 812],
  ] as const) {
    it(`at ${String(width)}px no card is wider than its column, the due words sit inside the card, and the page does not scroll sideways`, async () => {
      const page = await openLongBoard(width, height);
      const fit = await cardFit(page);
      console.log(`cards at ${String(width)}px: ${JSON.stringify(fit.cards)}`);
      assert.ok(fit.cards.length >= 3, `only ${String(fit.cards.length)} cards measured`);
      assert.deepEqual(fit.problems, []);
      await page.context().close();
    });

    it(`at ${String(width)}px the overdue dot is at least 8×8 and inside its card`, async () => {
      const page = await openLongBoard(width, height);
      const dot = await overdueDot(page);
      console.log(`overdue dot at ${String(width)}px: ${JSON.stringify(dot)}`);
      assert.equal(dot.count, 1, `${String(dot.count)} overdue dots on the card, not 1`);
      assert.ok(dot.width >= 8 && dot.height >= 8, `the dot is ${JSON.stringify(dot)}`);
      assert.ok(dot.inside, 'the dot is not wholly inside the card');
      await page.context().close();
    });
  }

  // `?entries=1` cards have no next action, so the board pass above never sees
  // the new muted line, the gold "due" or the red "overdue" words. This does.
  it('the stretched board passes colour contrast, the new action lines included', async () => {
    const page = await openLongBoard(1264, 720);
    await page.waitForSelector('[data-testid="tracker-card-next-long"]');
    judge('stretched board', await contrast(page));
    await page.context().close();
  });

  it('the check can fail: a 400-letter title with breaking turned off is reported', async () => {
    const page = await openLongBoard(1264, 720);
    await page.evaluate(() => {
      const title = document.querySelector('[data-testid="tracker-card-long"] .break-words');
      if (!(title instanceof HTMLElement)) throw new Error('no wrapping title line');
      title.textContent = 'W'.repeat(400);
      title.style.overflowWrap = 'normal';
      title.style.wordBreak = 'normal';
    });
    const fit = await cardFit(page);
    assert.ok(
      fit.problems.some((line) => line.startsWith('long:')),
      `the unbreakable title was not flagged: ${JSON.stringify(fit.problems)}`,
    );
    await page.context().close();
  });
});

/**
 * All five Tracker columns fit the smallest window (L-397).
 *
 * The app's smallest window is 1000px. Less the side menu and the board's
 * padding, the board has 728px; five columns and four 8px gaps fit in it when
 * a column's floor is 136px (712px in all). At a 176px floor they needed
 * 912px and Rejected sat mostly off screen. Below the floor — a 768px window,
 * or the detail pane open beside the board — the board scrolls sideways
 * rather than squeezing a column under 136px.
 */
const COLUMN_FLOOR = 136;

interface BoardFit {
  readonly problems: string[];
  readonly board: number;
  readonly scroll: number;
  readonly columns: number[];
}

async function boardFit(page: Page): Promise<BoardFit> {
  return page.evaluate(() => {
    const problems: string[] = [];
    const board = document.querySelector('[data-testid="tracker-board"]');
    if (board === null) return { problems: ['no board'], board: 0, scroll: 0, columns: [] };
    const root = document.documentElement;
    if (root.scrollWidth > root.clientWidth) {
      problems.push(`page: ${String(root.scrollWidth - root.clientWidth)}px too wide`);
    }
    if (board.scrollWidth > board.clientWidth) {
      problems.push(`board: scrolls ${String(board.scrollWidth - board.clientWidth)}px sideways`);
    }
    const outer = board.getBoundingClientRect();
    const right = Math.min(outer.left + board.clientWidth, root.clientWidth);
    const columns = [
      ...board.querySelectorAll<HTMLElement>(':scope > [data-testid^="tracker-column-"]'),
    ];
    if (columns.length !== 5) problems.push(`${String(columns.length)} columns drawn, not 5`);
    for (const column of columns) {
      const box = column.getBoundingClientRect();
      if (box.left < outer.left - 0.5 || box.right > right + 0.5) {
        problems.push(
          `${column.getAttribute('data-testid') ?? '?'}: ${String(box.left)}–${String(box.right)}px, board shows ${String(outer.left)}–${String(right)}px`,
        );
      }
    }
    return {
      problems,
      board: board.clientWidth,
      scroll: board.scrollWidth,
      columns: columns.map((column) => Math.round(column.getBoundingClientRect().width * 10) / 10),
    };
  });
}

async function openBoard(query: string, width: number, height: number): Promise<Page> {
  const page = await open(`?seen=1&entries=${query}`, { width, height });
  await goTo(page, 'tracker');
  await page.waitForSelector('button[data-testid^="tracker-card-"][data-status]');
  return page;
}

/** The dated action line on a card: how much of the user's words survive beside the due. */
async function dueLine(page: Page): Promise<{ action: string; shown: number; full: number }[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-testid^="tracker-card-due-action-"]')].map(
      (span) => ({
        action: span.textContent ?? '',
        shown: span.clientWidth,
        full: span.scrollWidth,
      }),
    ),
  );
}

describe('all five Tracker columns fit the smallest window (L-397)', () => {
  for (const query of ['1', 'long'] as const) {
    for (const [width, height] of [
      [1000, 700],
      [1264, 720],
      [1440, 900],
      [1920, 900],
    ] as const) {
      it(`at ${String(width)}px (?entries=${query}) all five columns are wholly on screen and the board does not scroll sideways`, async () => {
        const page = await openBoard(query, width, height);
        const fit = await boardFit(page);
        console.log(`board at ${String(width)}px (?entries=${query}): ${JSON.stringify(fit)}`);
        assert.deepEqual(fit.problems, []);
        if (query === 'long') {
          const cards = await cardFit(page);
          console.log(`  due line: ${JSON.stringify(await dueLine(page))}`);
          assert.deepEqual(cards.problems, []);
          const dot = await overdueDot(page);
          assert.ok(dot.count === 1 && dot.inside, `overdue dot: ${JSON.stringify(dot)}`);
        }
        await page.context().close();
      });
    }

    it(`at 768px (?entries=${query}) the board scrolls sideways rather than crushing columns below ${String(COLUMN_FLOOR)}px`, async () => {
      const page = await openBoard(query, 768, 800);
      const fit = await boardFit(page);
      console.log(`board at 768px (?entries=${query}): ${JSON.stringify(fit)}`);
      assert.ok(fit.scroll > fit.board, 'the board does not scroll sideways at 768px');
      assert.equal(fit.columns.length, 5);
      for (const column of fit.columns)
        assert.ok(column >= COLUMN_FLOOR - 0.5, `${String(column)}px`);
      await page.context().close();
    });

    // The 380px detail pane beside the board leaves it ~348px at 1000: the
    // board must scroll, the columns stay at the floor, and cards still fit.
    it(`at 1000px with a card open (?entries=${query}) the board scrolls sideways and the columns hold ${String(COLUMN_FLOOR)}px`, async () => {
      const page = await openBoard(query, 1000, 700);
      await page.locator('button[data-testid^="tracker-card-"][data-status]').first().click();
      await page.waitForSelector('[data-testid="detail-pane"]');
      const fit = await boardFit(page);
      console.log(`board at 1000px with a card open (?entries=${query}): ${JSON.stringify(fit)}`);
      assert.ok(fit.scroll > fit.board, 'the board does not scroll sideways beside the pane');
      for (const column of fit.columns)
        assert.ok(column >= COLUMN_FLOOR - 0.5, `${String(column)}px`);
      if (query === 'long') {
        const cards = await cardFit(page);
        console.log(`  due line: ${JSON.stringify(await dueLine(page))}`);
        assert.deepEqual(cards.problems, []);
        const dot = await overdueDot(page);
        assert.ok(dot.count === 1 && dot.inside, `overdue dot: ${JSON.stringify(dot)}`);
      }
      await page.context().close();
    });
  }

  // At 1000px the board has 728px; one 400px column and four at 136px need 976.
  it('the check can fail: a column forced to 400px is reported', async () => {
    const page = await openBoard('1', 1000, 700);
    await page.evaluate(() => {
      const column = document.querySelector<HTMLElement>('[data-testid="tracker-column-applied"]');
      if (column === null) throw new Error('no Applied column');
      column.style.minWidth = '400px';
    });
    const fit = await boardFit(page);
    assert.ok(
      fit.problems.some((line) => line.startsWith('board:')) &&
        fit.problems.some((line) => line.startsWith('tracker-column-')),
      `the widened column was not flagged: ${JSON.stringify(fit.problems)}`,
    );
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

/** "Where to look", a fold since L-398. */
const WHERE_FOLD = '[data-testid="search-where-fold"]';

/** Open "Where to look" as a person would: a click on its summary line. */
async function openWhereToLook(page: Page): Promise<void> {
  await page.click(`${WHERE_FOLD} > summary`);
  await page.waitForSelector(`${WHERE_FOLD}[open]`);
}

/** Search with the owner's typing: a grey button, its reason, and the Reed fix. Still folded. */
async function openTypedSearchFolded(
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

/**
 * The same, with "Where to look" opened (L-398). The tests below are about
 * the TALLEST form; with the box folded they would pass on a short one.
 */
async function openTypedSearch(
  viewport: { width: number; height: number },
  query = '?seen=1',
): Promise<Page> {
  const page = await openTypedSearchFolded(viewport, query);
  await openWhereToLook(page);
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
 * "Found one? Bring it in" on Search (L-324).
 *
 * One quiet line under "Also open" shows Tracker with the paste pane open and
 * the cursor in "Link to the advert". jsdom will focus an element a real
 * browser would not, and it does no layout, so whether the pane covers a
 * phone's window and the cursor is really in the box is only knowable here.
 */
const PHONE = { width: 375, height: 812 };

/** Search, then the new button, then wait for Tracker's paste pane. */
async function bringJobIn(viewport: { width: number; height: number }): Promise<Page> {
  const page = await open('?seen=1', viewport);
  await goTo(page, 'search');
  await page.click('[data-testid="search-bring-in"]');
  await page.locator('[data-testid="nav-tracker"][aria-current="page"]:visible').waitFor();
  await page.waitForSelector('[data-testid="paste-job-form"]');
  return page;
}

/** What is wrong with the pane on arrival. Empty means all is well. */
async function arrivalProblems(page: Page, covers: boolean): Promise<string[]> {
  return page.evaluate(async (mustCover) => {
    // Let any later focus move (the page title's, the pane's own) happen first.
    await new Promise((done) => requestAnimationFrame(done));
    await new Promise((done) => requestAnimationFrame(done));
    const problems: string[] = [];
    const pane = document.querySelector('[data-testid="detail-pane"]');
    const link = document.querySelector('[data-testid="paste-job-url"]');
    if (pane === null || link === null) return ['no pane or no link box'];
    const focused = document.activeElement;
    if (focused !== link) {
      problems.push(
        `focus is on ${focused?.getAttribute('data-testid') ?? focused?.tagName ?? '?'}`,
      );
    }
    const box = pane.getBoundingClientRect();
    const width = window.innerWidth;
    const height = window.innerHeight;
    if (mustCover) {
      const edges = [box.left, box.top, width - box.right, height - box.bottom];
      if (edges.some((edge) => Math.abs(edge) > 0.5)) {
        problems.push(`pane is ${JSON.stringify(edges)} short of the window's edges`);
      }
      const points = [
        [2, 2],
        [width - 2, 2],
        [width / 2, height / 2],
        [2, height - 2],
        [width - 2, height - 2],
      ] as const;
      for (const [x, y] of points) {
        const top = document.elementFromPoint(x, y);
        if (top === null || !pane.contains(top))
          problems.push(`(${String(x)}, ${String(y)}) is not the pane`);
      }
    }
    const linkBox = link.getBoundingClientRect();
    if (linkBox.top < 0 || linkBox.bottom > height || linkBox.left < 0 || linkBox.right > width) {
      problems.push('the link box is off screen');
    }
    return problems;
  }, covers);
}

/** The new button's height, and anything that scrolls sideways. */
async function bringInProblems(page: Page, minHeight: number): Promise<string[]> {
  const height = await page.evaluate(
    () =>
      document.querySelector('[data-testid="search-bring-in"]')?.getBoundingClientRect().height ??
      0,
  );
  const short = height < minHeight ? [`the button is ${String(height)}px tall`] : [];
  return [...short, ...(await sidewaysOverflow(page))];
}

describe('"Found one? Bring it in" opens the paste pane, cursor in the link box (L-324)', () => {
  it("at 375px, after 'Found one? Bring it in', the paste pane covers the window and the link box has focus", async () => {
    const page = await bringJobIn(PHONE);
    assert.deepEqual(await arrivalProblems(page, true), []);
    await page.context().close();
  });

  it('at 1000×700 the pane opens beside the board and the link box has focus', async () => {
    const page = await bringJobIn(SMALLEST_WINDOW);
    assert.deepEqual(await arrivalProblems(page, false), []);
    await page.context().close();
  });

  it('the new line adds no sideways scroll at 1000×700, and the button is at least 44px tall at 375px', async () => {
    for (const [viewport, minHeight] of [
      [SMALLEST_WINDOW, 0],
      [PHONE, 44],
    ] as const) {
      const page = await open('?seen=1', viewport);
      await goTo(page, 'search');
      await page.waitForSelector('[data-testid="search-bring-in"]');
      assert.deepEqual(await bringInProblems(page, minHeight), [], `${String(viewport.width)}px`);
      await page.context().close();
    }
  });

  // NEGATIVE — a check that cannot fail is not a check.
  it('the check can fail: a pane short of the window, focus elsewhere and a short button are reported', async () => {
    const page = await bringJobIn(PHONE);
    await page.evaluate(() => {
      const pane = document.querySelector<HTMLElement>('[data-testid="detail-pane"]');
      if (pane !== null) pane.style.width = '200px';
      document.querySelector<HTMLElement>('[data-testid="detail-pane-close"]')?.focus();
    });
    const report = await arrivalProblems(page, true);
    assert.ok(
      report.some((line) => line.startsWith('focus is on detail-pane-close')),
      `focus away from the link box was not flagged: ${JSON.stringify(report)}`,
    );
    assert.ok(
      report.some((line) => line.startsWith('pane is')),
      `a pane short of the window was not flagged: ${JSON.stringify(report)}`,
    );
    await page.context().close();

    const search = await open('?seen=1', PHONE);
    await goTo(search, 'search');
    await search.evaluate(() => {
      const button = document.querySelector<HTMLElement>('[data-testid="search-bring-in"]');
      if (button !== null) button.style.minHeight = '0';
    });
    const short = await bringInProblems(search, 44);
    assert.ok(
      short.some((line) => line.startsWith('the button is')),
      `a short button was not flagged: ${JSON.stringify(short)}`,
    );
    await search.context().close();
  });
});

/**
 * "Where to look" folds (L-398).
 *
 * Closed, the box is one summary line, so at the smallest window the fields,
 * Search with its reason and fix, and the top of the results area fit without
 * a scroll, and the pinned row (L-342) has nothing to do. jsdom draws a closed
 * fold's content and lets it be focused, clicked and tabbed into, so whether
 * the fold really keeps its content out of reach is only knowable here.
 */

/** What of the results area's top is not on screen. Empty means all is well. */
async function resultsTopProblems(page: Page): Promise<string[]> {
  return page.evaluate((areaSelector) => {
    const area = document.querySelector(areaSelector);
    const header = document.querySelector('[data-testid="search-results-header"]');
    const empty = document.querySelector('[data-testid="search-empty"]');
    if (area === null || header === null || empty === null) return ['nothing to measure'];
    const seen = area.getBoundingClientRect();
    const top = header.getBoundingClientRect();
    const box = empty.getBoundingClientRect();
    // The results header whole, and the top edge of the box the results go in.
    return top.top >= seen.top && top.bottom <= seen.bottom && box.top + 8 <= seen.bottom
      ? []
      : [
          `the results area starts at ${String(top.top)}, its box at ${String(box.top)}, ` +
            `the scroll area ends at ${String(seen.bottom)}`,
        ];
  }, SEARCH_AREA);
}

/** The summary line's height. */
async function summaryHeight(page: Page): Promise<number> {
  return page.evaluate(
    (fold) => document.querySelector(`${fold} > summary`)?.getBoundingClientRect().height ?? 0,
    WHERE_FOLD,
  );
}

/** Every element Tab lands on, from the first field until focus leaves the form. */
async function tabStops(page: Page): Promise<{ inside: string[]; summary: boolean }> {
  await page.focus('[data-testid="search-keywords"]');
  const inside: string[] = [];
  let summary = false;
  for (let presses = 0; presses < 60; presses += 1) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate((fold) => {
      const active = document.activeElement;
      const where = document.querySelector(fold);
      return {
        inForm: active?.closest('[data-testid="search-form"]') !== null,
        isSummary: active === where?.querySelector(':scope > summary'),
        insideFold: where !== null && active !== null && where.contains(active),
        name: active?.getAttribute('data-testid') ?? active?.tagName ?? '?',
      };
    }, WHERE_FOLD);
    if (!stop.inForm) break;
    if (stop.isSummary) summary = true;
    else if (stop.insideFold) inside.push(stop.name);
  }
  return { inside, summary };
}

describe('"Where to look" folds, and the form fits the smallest window (L-398)', () => {
  it('at 1000×700, folded: Search, its reason and the fix, and the top of the results area are on screen unscrolled', async () => {
    const page = await openTypedSearchFolded(SMALLEST_WINDOW);
    const seen = await page.evaluate(
      ({ areaSelector, fold }) => ({
        scrollTop: document.querySelector(areaSelector)?.scrollTop ?? -1,
        open: (document.querySelector(fold) as HTMLDetailsElement | null)?.open ?? null,
        resultsTop: document.querySelector('[data-testid="search-empty"]')?.getBoundingClientRect()
          .top,
      }),
      { areaSelector: SEARCH_AREA, fold: WHERE_FOLD },
    );
    console.log(`folded at 1000×700: ${JSON.stringify(seen)}`);
    assert.equal(seen.scrollTop, 0, 'the area was scrolled before measuring');
    assert.equal(seen.open, false, 'the fold was not closed on arrival');
    assert.deepEqual(await submitRowProblems(page), []);
    assert.deepEqual(await resultsTopProblems(page), []);
    await page.context().close();
  });

  it('folded at 1000×700, the button sits in its natural place (the pin is not needed)', async () => {
    const page = await openTypedSearchFolded(SMALLEST_WINDOW);
    const { top, inFlow } = await rowAgainstFlow(page);
    console.log(`row, folded at 1000×700: at ${String(top)}, in flow ${String(inFlow)}`);
    assert.equal(top, inFlow);
    await page.context().close();
  });

  it('the summary line is at least 44px tall, in whole pixels, at 375px and at 1000×700', async () => {
    for (const viewport of [PHONE, SMALLEST_WINDOW]) {
      const page = await openTypedSearchFolded(viewport);
      const height = await summaryHeight(page);
      console.log(`summary line at ${String(viewport.width)}px: ${String(height)}px`);
      assert.ok(height >= 44, `${String(viewport.width)}px: ${String(height)}px tall`);
      assert.ok(Number.isInteger(height), `${String(viewport.width)}px: ${String(height)}px`);
      await page.context().close();
    }
  });

  it('at 375px, with everything ticked, the summary wraps and adds no sideways scroll', async () => {
    const page = await openTypedSearchFolded(PHONE, '?seen=1&results=1');
    await openWhereToLook(page);
    await page.click('[data-testid="keyless-more"]');
    const unticked = page.locator(`${WHERE_FOLD} input:not(:checked)`);
    while ((await unticked.count()) > 0) await unticked.first().check();
    await page.click(`${WHERE_FOLD} > summary`);
    await page.waitForSelector(`${WHERE_FOLD}:not([open])`);
    const text = await page.locator('[data-testid="search-where-summary"]').textContent();
    const height = await summaryHeight(page);
    console.log(`summary line, all ticked at 375px: ${String(height)}px — ${String(text)}`);
    assert.match(text ?? '', /^Adzuna · Reed · Arbeitnow · \d+ job boards ticked$/);
    assert.ok(height >= 44, `${String(height)}px tall`);
    assert.ok(height <= 68, `${String(height)}px tall: more than two lines`);
    assert.deepEqual(await sidewaysOverflow(page), []);
    await page.context().close();
  });

  it('a click on the summary opens it, and Space and Enter work; the first tick inside is then visible', async () => {
    const page = await openTypedSearchFolded(SMALLEST_WINDOW);
    const firstTick = page.locator(`${WHERE_FOLD} input`).first();
    const isOpen = (): Promise<boolean> =>
      page.evaluate(
        (fold) => (document.querySelector(fold) as HTMLDetailsElement | null)?.open ?? false,
        WHERE_FOLD,
      );
    assert.equal(await firstTick.isVisible(), false, 'a tick shows while the fold is closed');

    await page.click(`${WHERE_FOLD} > summary`);
    await page.locator(`${WHERE_FOLD} input:visible`).first().waitFor();
    assert.equal(await isOpen(), true);
    await page.click(`${WHERE_FOLD} > summary`);
    await firstTick.waitFor({ state: 'hidden' });

    await page.focus(`${WHERE_FOLD} > summary`);
    await page.keyboard.press(' ');
    await page.locator(`${WHERE_FOLD} input:visible`).first().waitFor();
    assert.equal(await isOpen(), true, 'Space did not open it');
    await page.keyboard.press(' ');
    await firstTick.waitFor({ state: 'hidden' });

    await page.keyboard.press('Enter');
    await page.locator(`${WHERE_FOLD} input:visible`).first().waitFor();
    assert.equal(await isOpen(), true, 'Enter did not open it');
    await page.context().close();
  });

  it('closed, nothing inside the fold can be reached by Tab; open, its ticks can', async () => {
    const page = await openTypedSearchFolded(SMALLEST_WINDOW);
    const closed = await tabStops(page);
    console.log(`Tab stops, closed: ${JSON.stringify(closed)}`);
    assert.deepEqual(closed, { inside: [], summary: true });

    // The same walk with the fold open does land inside: the walk can see ticks.
    await openWhereToLook(page);
    const opened = await tabStops(page);
    assert.ok(opened.inside.includes('keyless-source-arbeitnow'), JSON.stringify(opened));
    await page.context().close();
  });

  // NEGATIVE — a check that cannot fail is not a check.
  it('the check can fail: a tall block pushed into the form is flagged', async () => {
    const page = await openTypedSearchFolded(SMALLEST_WINDOW);
    await page.evaluate((row) => {
      const block = document.createElement('div');
      block.style.height = '400px';
      document.querySelector(row)?.before(block);
    }, SUBMIT_ROW);
    const report = await resultsTopProblems(page);
    assert.ok(
      report.some((line) => line.startsWith('the results area starts at')),
      `the pushed-down results area was not flagged: ${JSON.stringify(report)}`,
    );
    const { top, inFlow } = await rowAgainstFlow(page);
    assert.notEqual(top, inFlow, 'the pin was not needed even with a tall block in the form');
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
      await openWhereToLook(page);
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
      await openWhereToLook(app.page);
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
    // The table's rows, and the keyword and bullet rows drawn as bars (L-396).
    for (const row of marked(
      '[data-testid="tailor-ats"] tbody tr, [data-testid="tailor-ats-bars"] > li',
    )) {
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
      const holder = mark.closest(
        'td, [data-testid="tailor-ats-bars"] > li > *, button, [data-testid^="tracker-card-progress-"]',
      );
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
 * A slimmer step bar (L-386).
 *
 * The bar under the page header was four stacked rows. On a desktop it is now
 * two: the job, its CV and engine, and Back and Next on one; the five steps,
 * joined by drawn lines, on the next. On a phone the steps are marks only, one
 * row of five 44px buttons, and one line of words under them says where the
 * user is and what was skipped — a tap on a step navigates, so its hint cannot
 * be reached there, and the words are what explain the marks.
 *
 * Measured on the real Tailor screen, opened from a tracker card's "Tailor".
 */
async function tailorWithBar(width: number): Promise<Page> {
  const page = await open('?seen=1&entries=1', { width, height: 800 });
  await goTo(page, 'tracker');
  await page.waitForSelector('[data-testid="tracker-card-c"]');
  await page.click('[data-testid="tracker-card-c"]');
  await page.click('[data-testid="detail-tailor"]');
  await page.waitForSelector('[data-testid="job-steps"] [data-testid="job-step-tailor"]');
  return page;
}

/**
 * The bar's height on main before L-386, measured with this harness in WebKit:
 * 227px at 375px (the steps wrapped onto two rows, Back and Next on a fourth)
 * and 153px at 1000px (four rows).
 */
const STEP_BAR_BEFORE_PX = { 375: 227, 1000: 153 } as const;

/** Everything about the bar's layout that is not as L-386 says, at this window's width. */
async function stepBarProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const bar = document.querySelector('[data-testid="job-steps"]');
    if (bar === null) return ['no step bar'];
    const problems: string[] = [];
    const phone = window.innerWidth < 768;
    const box = (element: Element): DOMRect => element.getBoundingClientRect();

    const steps = [...bar.querySelectorAll('[data-testid^="job-step-"][data-state]')];
    if (steps.length !== 5) problems.push(`${String(steps.length)} steps, not 5`);
    const rows = new Set(steps.map((step) => Math.round(box(step).top)));
    if (rows.size !== 1) problems.push(`steps: on ${String(rows.size)} rows`);
    for (const step of steps) {
      const { width, height } = box(step);
      if (phone && (width < 44 || height < 44)) {
        problems.push(
          `${step.getAttribute('data-testid') ?? '?'}: ${String(width)}×${String(height)}px`,
        );
      }
    }

    // Drawn, not typed: no text, a painted fill, and a size on screen.
    const lines = [...bar.querySelectorAll('[data-testid="job-steps-line"]')];
    if (lines.length !== 4) problems.push(`${String(lines.length)} connectors, not 4`);
    for (const line of lines) {
      const { width, height } = box(line);
      const fill = getComputedStyle(line).backgroundColor;
      const painted = fill !== 'rgba(0, 0, 0, 0)' && fill !== 'transparent';
      if ((line.textContent ?? '') !== '' || !painted || width < 1 || height < 0.5) {
        problems.push(`connector: not drawn (${String(width)}×${String(height)}px, ${fill})`);
      }
    }

    const where = bar.querySelector('[data-testid="job-steps-where"]');
    const shown = where !== null && box(where).height > 0;
    const stepsBottom = Math.max(...steps.map((step) => box(step).bottom));
    if (phone && !shown) problems.push('words line: not shown on a phone');
    if (phone && shown && box(where).top < stepsBottom - 0.5) {
      problems.push('words line: not under the steps');
    }
    if (!phone && shown) problems.push('words line: shown on a desktop, a third row');

    const job = bar.querySelector('[data-testid="job-steps-job"]');
    if (job === null) return [...problems, 'no job name'];
    const lineHeight = parseFloat(getComputedStyle(job).lineHeight);
    if (box(job).height > lineHeight * 1.5) {
      problems.push(`job name: wraps (${String(box(job).height)}px)`);
    }
    for (const id of ['job-steps-back', 'job-steps-next']) {
      const button = bar.querySelector(`[data-testid="${id}"]`);
      if (button === null) {
        problems.push(`${id}: missing`);
        continue;
      }
      const at = box(button);
      if (at.left < -0.5 || at.right > window.innerWidth + 0.5) problems.push(`${id}: off screen`);
      // A desktop's first row: Back and Next level with the job name.
      if (!phone && (at.top > box(job).bottom || at.bottom < box(job).top)) {
        problems.push(`${id}: not on the job's row`);
      }
      if (at.top >= stepsBottom) problems.push(`${id}: below the steps`);
    }

    const root = document.documentElement;
    if (root.scrollWidth > root.clientWidth) {
      problems.push(`page: ${String(root.scrollWidth - root.clientWidth)}px too wide`);
    }
    return problems;
  });
}

async function stepBarHeight(page: Page): Promise<number> {
  return page.evaluate(
    () => document.querySelector('[data-testid="job-steps"]')?.getBoundingClientRect().height ?? 0,
  );
}

describe('a slimmer step bar (L-386)', () => {
  it('at 375px the steps are one row and each is at least 44px', async () => {
    const page = await tailorWithBar(375);
    assert.deepEqual(await stepBarProblems(page), []);
    await page.context().close();
  });

  it('at 1000px: the job with Back and Next, then the steps joined by drawn lines', async () => {
    const page = await tailorWithBar(1000);
    assert.deepEqual(await stepBarProblems(page), []);
    await page.context().close();
  });

  for (const width of [375, 1000] as const) {
    it(`the bar is shorter than before at ${String(width)}px`, async () => {
      const page = await tailorWithBar(width);
      const height = await stepBarHeight(page);
      console.log(
        `step bar at ${String(width)}px: ${String(height)}px (before L-386: ${String(STEP_BAR_BEFORE_PX[width])}px)`,
      );
      assert.ok(height > 0, 'the bar drew nothing');
      assert.ok(
        height < STEP_BAR_BEFORE_PX[width],
        `${String(height)}px is not shorter than ${String(STEP_BAR_BEFORE_PX[width])}px`,
      );
      await page.context().close();
    });

    it(`edge: a very long job name is cut short, and Back and Next stay put, at ${String(width)}px`, async () => {
      const page = await tailorWithBar(width);
      const before = await stepBarHeight(page);
      const cut = await page.evaluate(() => {
        const job = document.querySelector<HTMLElement>('[data-testid="job-steps-job"]');
        if (job === null) throw new Error('no job name');
        job.textContent = 'Principal Senior Lead Data Analyst '.repeat(8);
        return job.scrollWidth > job.clientWidth;
      });
      assert.ok(cut, 'the long name was not cut short');
      assert.deepEqual(await stepBarProblems(page), []);
      assert.equal(await stepBarHeight(page), before, 'the long name made the bar taller');
      await page.context().close();
    });
  }

  // NEGATIVE — a check that cannot fail is not a check.
  it('the check can fail: a small step, no words line and a typed connector are reported', async () => {
    const page = await tailorWithBar(375);
    await page.evaluate(() => {
      const step = document.querySelector<HTMLElement>('[data-testid="job-step-find"]');
      const where = document.querySelector<HTMLElement>('[data-testid="job-steps-where"]');
      const line = document.querySelector<HTMLElement>('[data-testid="job-steps-line"]');
      if (step === null || where === null || line === null) throw new Error('bar parts missing');
      step.style.minWidth = '0';
      step.style.padding = '0';
      where.style.display = 'none';
      line.className = '';
      line.textContent = '─';
    });
    const problems = await stepBarProblems(page);
    for (const expected of ['job-step-find: ', 'words line: not shown', 'connector: not drawn']) {
      assert.ok(
        problems.some((line) => line.startsWith(expected)),
        `"${expected}" went unreported: ${JSON.stringify(problems)}`,
      );
    }
    await page.context().close();
  });
});

/**
 * No box that scrolls inside Tailor's page (L-322).
 *
 * The CV text was a `max-h-72 overflow-y-auto` box inside Tailor's own scroll
 * area, so the mouse wheel got caught in it. Now a long CV is clipped to the
 * same height with "Show all" under it, and a CV that fits has no button.
 * "Long" is counted in lines (`COLLAPSED_LINES`, 11); these checks prove the
 * count against the real layout: 12 lines really are clipped, so the button is
 * never a no-op, and 11 are not.
 *
 * The rule is general, not about the CV: nothing inside Tailor's reading view
 * scrolls vertically except Tailor's own scroll area. A later slice (the
 * tailored CV shown as a page) must pass it too. The correction text box is
 * not open in any of these checks.
 */
const CV_WINDOWS = {
  'desktop 1000x700': { width: 1000, height: 700 },
  'phone 375x812': { width: 375, height: 812 },
} as const;

/** Tailor, its CV panel open, with the harness's CV of `cv` length. */
async function tailorWithCv(
  cv: 'long' | 'short',
  viewport: { width: number; height: number },
): Promise<Page> {
  const page = await open(`?seen=1&cv=${cv}`, viewport);
  await goTo(page, 'tailor');
  await page.click('[data-testid="tailor-cv-preview-toggle"]');
  await page.waitForSelector('[data-testid="tailor-cv-preview-text"]:visible');
  return page;
}

/** Every element in Tailor, other than its own scroll area, that can scroll vertically. */
async function innerScrollers(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const view = document.querySelector('[data-testid="view-tailor"]');
    if (view === null) return ['no Tailor view'];
    return [...view.querySelectorAll('*')]
      .filter((element) => element.getAttribute('data-testid') !== 'tailor-scroll')
      .filter((element) => ['auto', 'scroll'].includes(getComputedStyle(element).overflowY))
      .filter((element) => element.scrollHeight > element.clientHeight)
      .map(
        (element) =>
          `${element.getAttribute('data-testid') ?? element.tagName.toLowerCase()}: ` +
          `${String(element.scrollHeight)} in ${String(element.clientHeight)}px`,
      );
  });
}

/** The CV text's own heights, and whether "Show all" is there. */
async function cvText(page: Page): Promise<{
  scrollHeight: number;
  clientHeight: number;
  lines: number;
  button: string | null;
}> {
  return page.evaluate(() => {
    const text = document.querySelector('[data-testid="tailor-cv-preview-text"]');
    if (text === null) throw new Error('no CV text');
    return {
      scrollHeight: text.scrollHeight,
      clientHeight: text.clientHeight,
      lines: (text.textContent ?? '').split('\n').length,
      button: document.querySelector('[data-testid="tailor-cv-show-all"]')?.textContent ?? null,
    };
  });
}

/** Wheel down over the middle of the CV text; how far the page and the text moved. */
async function wheelOverCv(page: Page): Promise<{ page: number; text: number; room: number }> {
  const start = await page.evaluate(() => {
    const area = document.querySelector('[data-testid="tailor-scroll"]');
    const text = document.querySelector('[data-testid="tailor-cv-preview-text"]');
    if (area === null || text === null) throw new Error('no scroll area or CV text');
    area.scrollTop = 0;
    // The part of the text inside the scroll area, so the pointer is really over it.
    const shown = area.getBoundingClientRect();
    const box = text.getBoundingClientRect();
    const bottom = Math.min(box.bottom, shown.bottom);
    return {
      x: box.left + box.width / 2,
      y: (box.top + bottom) / 2,
      room: area.scrollHeight - area.clientHeight,
    };
  });
  await page.mouse.move(start.x, start.y);
  await page.mouse.wheel(0, 120);
  await scrollingSettled(page);
  return page.evaluate((room) => {
    const area = document.querySelector('[data-testid="tailor-scroll"]');
    const text = document.querySelector('[data-testid="tailor-cv-preview-text"]');
    return { page: area?.scrollTop ?? -1, text: text?.scrollTop ?? -1, room };
  }, start.room);
}

describe('no box that scrolls inside Tailor (L-322)', () => {
  for (const [name, viewport] of Object.entries(CV_WINDOWS)) {
    it(`a long CV, collapsed, is clipped under "Show all"; the page does not scroll sideways (${name})`, async () => {
      const page = await tailorWithCv('long', viewport);
      const seen = await cvText(page);
      console.log(`long CV collapsed (${name}): ${JSON.stringify(seen)}`);
      assert.equal(seen.lines, 12);
      assert.equal(seen.button, 'Show all');
      // 288px is `max-h-72`; clipped means there really is more to show.
      assert.equal(seen.clientHeight, 288);
      assert.ok(
        seen.scrollHeight > seen.clientHeight,
        `12 lines fit in ${String(seen.clientHeight)}px: "Show all" would do nothing`,
      );
      assert.deepEqual(await sidewaysOverflow(page), []);
      assert.deepEqual(await innerScrollers(page), []);
      await page.context().close();
    });

    it(`a CV of exactly 11 lines is not clipped and has no button (${name})`, async () => {
      const page = await tailorWithCv('short', viewport);
      const seen = await cvText(page);
      console.log(`short CV (${name}): ${JSON.stringify(seen)}`);
      assert.equal(seen.lines, 11);
      assert.equal(seen.button, null);
      assert.ok(
        seen.scrollHeight <= seen.clientHeight,
        `11 lines are clipped: ${String(seen.scrollHeight)} in ${String(seen.clientHeight)}px`,
      );
      assert.deepEqual(await innerScrollers(page), []);
      await page.context().close();
    });

    it(`the wheel over the CV text scrolls the page, collapsed and after "Show all" (${name})`, async () => {
      const page = await tailorWithCv('long', viewport);
      const collapsed = await wheelOverCv(page);
      console.log(`wheel, collapsed (${name}): ${JSON.stringify(collapsed)}`);
      assert.ok(collapsed.room > 0, 'Tailor has no room to scroll, so the wheel proves nothing');
      assert.equal(collapsed.text, 0, 'the wheel scrolled the CV text');
      assert.ok(collapsed.page > 0, 'the wheel did not scroll the page');

      await page.click('[data-testid="tailor-cv-show-all"]');
      const seen = await cvText(page);
      console.log(`long CV expanded (${name}): ${JSON.stringify(seen)}`);
      assert.equal(seen.button, 'Show less');
      assert.ok(
        seen.scrollHeight <= seen.clientHeight,
        `after "Show all" the text is still clipped: ${String(seen.scrollHeight)} in ${String(seen.clientHeight)}px`,
      );
      assert.deepEqual(await innerScrollers(page), []);
      assert.deepEqual(await sidewaysOverflow(page), []);

      const expanded = await wheelOverCv(page);
      console.log(`wheel, expanded (${name}): ${JSON.stringify(expanded)}`);
      assert.equal(expanded.text, 0, 'the wheel scrolled the CV text');
      assert.ok(expanded.page > 0, 'the wheel did not scroll the page');
      await page.context().close();
    });
  }

  // NEGATIVE — a check that cannot fail is not a check.
  it('the check can fail: a box that scrolls inside Tailor is reported', async () => {
    const page = await tailorWithCv('long', CV_WINDOWS['desktop 1000x700']);
    await page.evaluate(() => {
      const text = document.querySelector<HTMLElement>('[data-testid="tailor-cv-preview-text"]');
      if (text === null) throw new Error('no CV text');
      text.style.overflowY = 'auto';
    });
    const found = await innerScrollers(page);
    assert.ok(
      found.some((line) => line.startsWith('tailor-cv-preview-text: ')),
      `the scrolling CV text went unreported: ${JSON.stringify(found)}`,
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
 * Hints show a small "i" button instead of a dotted underline (L-384).
 *
 * The words of a hint are plain text now; straight after them sits a small
 * circled "i" that is a real button and the Tab stop. Three things only a real
 * engine can say, measured on the same `?marks=1` sheet as the block above (the
 * ATS table, the step bar and a card's dots, drawn by the app's own code):
 *   - every "i" is at least 24×24 — the WCAG 2.2 AA minimum, the owner's named
 *     exception to the 44px phone rule — sits in no other button or link, and
 *     no ATS row is taller for its HEIGHT (its negative margin keeps the line
 *     height). The twin keeps each "i" as a flat box of the same width, so the
 *     words wrap the same way in both and only the height is compared: on a
 *     phone a cell may wrap onto one more line for the "i"'s width, and that is
 *     shown in the 375px picture rather than hidden by this check;
 *   - in the ATS table only the labels carry an "i" — the heading, the two
 *     column headers, the five row labels and the line under the table: nine
 *     on the sheet. The result cells (status, change, band) open their hint on
 *     hover and tap with no "i" (owner decision, 12 Nov 2026). The table still
 *     fits a 375px window;
 *   - a REAL tap opens the tip and leaves it open. A tap is followed by the
 *     mouse events a touch screen makes up, so the tip used to open on the
 *     made-up hover and shut on the click straight after it. Waits are on the
 *     click itself reaching the page, never on a clock.
 */
const HINT_WINDOWS = {
  desktop: { width: 1280, height: 800 },
  'phone 375px': { width: 375, height: 800 },
} as const;

/** The "i" every span-form hint draws. */
const HINT_BUTTON = '[data-testid="hint-info"]';

async function openHintSheet(
  viewport: { width: number; height: number },
  touch = false,
): Promise<Page> {
  const context = await browser.newContext({ viewport, hasTouch: touch, colorScheme: 'light' });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${origin}/?marks=1`);
  await page.waitForSelector('[data-testid="marks-sheet"] [data-mark]');
  await page.evaluate(() => document.fonts.ready);
  assert.deepEqual(errors, [], 'the sheet threw while drawing');
  return page;
}

interface HintButtonReport {
  readonly count: number;
  readonly problems: readonly string[];
}

/** Every "i" under 24×24 or inside another control, every ATS row it makes taller, a too-wide page. */
async function hintButtonProblems(page: Page): Promise<HintButtonReport> {
  return page.evaluate((selector) => {
    const problems: string[] = [];
    const words = (button: Element): string =>
      (button.parentElement?.textContent ?? '?').trim().slice(0, 30);
    const buttons = [...document.querySelectorAll(selector)];
    for (const button of buttons) {
      const box = button.getBoundingClientRect();
      if (box.width < 24 || box.height < 24) {
        problems.push(`"${words(button)}": ${String(box.width)}×${String(box.height)}px`);
      }
      if (button.parentElement?.closest('button, a') != null) {
        problems.push(`"${words(button)}": inside another button or link`);
      }
      if (box.right > window.innerWidth + 0.5 || box.left < -0.5) {
        problems.push(`"${words(button)}": off the side of the window`);
      }
    }
    // The same row, beside itself, with each "i" flattened to no height.
    for (const row of document.querySelectorAll(
      '[data-testid="tailor-ats"] tr, [data-testid="tailor-ats-bars"] > li',
    )) {
      if (row.querySelector(selector) === null) continue;
      const twin = row.cloneNode(true) as Element;
      for (const button of twin.querySelectorAll<HTMLElement>(selector)) {
        button.replaceChildren();
        button.style.minHeight = '0';
        button.style.height = '0';
      }
      row.after(twin);
      const withButtons = row.getBoundingClientRect().height;
      const without = twin.getBoundingClientRect().height;
      twin.remove();
      if (Math.abs(withButtons - without) > 0.01) {
        problems.push(
          `ATS row "${(row.textContent ?? '').slice(0, 24)}": ${String(withButtons)}px, ${String(without)}px without its i`,
        );
      }
    }
    const root = document.documentElement;
    if (root.scrollWidth > root.clientWidth) {
      problems.push(`page: ${String(root.scrollWidth - root.clientWidth)}px too wide`);
    }
    return { count: buttons.length, problems };
  }, HINT_BUTTON);
}

/** The ATS table's, and the bar list's (L-396), overflow past their card, in px (0 when they fit). */
async function atsTableOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const card = document.querySelector('[data-testid="tailor-ats"]');
    const table = card?.querySelector('table');
    const bars = card?.querySelector('[data-testid="tailor-ats-bars"]');
    if (card === null || card === undefined || table === null || table === undefined) {
      throw new Error('no ATS table on the sheet');
    }
    if (bars === null || bars === undefined) throw new Error('no ATS bars on the sheet');
    const inner =
      card.getBoundingClientRect().right - parseFloat(getComputedStyle(card).paddingRight);
    return Math.max(
      0,
      ...[table, bars].flatMap((part) => [
        part.getBoundingClientRect().right - inner,
        part.scrollWidth - part.clientWidth,
      ]),
    );
  });
}

/** Whether the tip of the hint whose words include `words` is showing. */
async function tipShowing(page: Page, words: string): Promise<boolean> {
  return page.evaluate((text) => {
    const wrapper = [...document.querySelectorAll('[data-testid="tailor-ats"] .cursor-help')].find(
      (element) => (element.textContent ?? '').includes(text),
    );
    const tip = document.getElementById(wrapper?.getAttribute('aria-describedby') ?? '');
    if (tip === null) throw new Error(`no hint on "${text}"`);
    return !tip.hidden;
  }, words);
}

/** Tap, then wait for the tap's click to reach the page and React to draw after it. */
async function tapAndSettle(page: Page, target: ReturnType<Page['locator']>): Promise<void> {
  const before = await page.evaluate(() => {
    const counted = window as unknown as { __clicks?: number };
    if (counted.__clicks === undefined) {
      counted.__clicks = 0;
      document.addEventListener(
        'click',
        () => (counted.__clicks = (counted.__clicks ?? 0) + 1),
        true,
      );
    }
    return counted.__clicks;
  });
  await target.tap();
  await page.waitForFunction(
    (count) => ((window as unknown as { __clicks?: number }).__clicks ?? 0) > count,
    before,
  );
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
}

describe('hints show a small "i" button (L-384)', () => {
  for (const [name, viewport] of Object.entries(HINT_WINDOWS)) {
    it(`every hint button is at least 24×24 and no row is taller for it, ${name}`, async () => {
      const page = await openHintSheet(viewport);
      const report = await hintButtonProblems(page);
      console.log(`hint buttons (${name}): ${JSON.stringify(report)}`);
      // ATS score, Before, After, five row labels, Fabrication check: the
      // result cells, the step bar's buttons and the card's dots draw none.
      assert.equal(report.count, 9, `${String(report.count)} hint buttons on the sheet, not 9`);
      assert.deepEqual(report.problems, []);
      await page.context().close();
    });
  }

  it('the ATS table does not scroll sideways at 375px with its hint buttons', async () => {
    const page = await openHintSheet(HINT_WINDOWS['phone 375px']);
    assert.equal(await page.locator(`[data-testid="tailor-ats"] ${HINT_BUTTON}`).count(), 9);
    assert.equal(
      await page.locator(`[data-testid="tailor-ats"] tbody td ${HINT_BUTTON}`).count(),
      0,
    );
    assert.equal(await atsTableOverflow(page), 0, 'the ATS table is wider than its card');
    await page.context().close();
  });

  it("a real tap on a status cell's words opens its tip and it stays open", async () => {
    const page = await openHintSheet(HINT_WINDOWS['phone 375px'], true);
    const words = page
      .locator('[data-testid="tailor-ats-check-section_headers"] td .cursor-help')
      .first();
    assert.equal(await words.locator('button').count(), 0, 'a status cell has a button');
    assert.equal(await tipShowing(page, 'Missing'), false, 'the tip showed before any tap');
    await tapAndSettle(page, words);
    assert.equal(await tipShowing(page, 'Missing'), true, 'one tap did not leave the tip open');
    await tapAndSettle(page, page.locator('[data-testid="tailor-ats"] p').first());
    assert.equal(await tipShowing(page, 'Missing'), false, 'a tap elsewhere left it open');
    await page.context().close();
  });

  it('the Tracker card dots draw no "i"', async () => {
    const page = await openHintSheet(HINT_WINDOWS['phone 375px']);
    assert.equal(
      await page.locator(`[data-testid^="tracker-card-progress-"] ${HINT_BUTTON}`).count(),
      0,
    );
    await page.context().close();
  });

  // The words and the "i" are both ways in, so a tap on either must work.
  for (const target of ['the words', 'the i'] as const) {
    it(`a real tap on ${target} opens the tip and it stays open; a tap elsewhere closes it`, async () => {
      const page = await openHintSheet(HINT_WINDOWS['phone 375px'], true);
      const wrapper = page.locator('[data-testid="tailor-ats"] thead .cursor-help', {
        hasText: 'Before',
      });
      const tapped = target === 'the i' ? wrapper.locator(HINT_BUTTON) : wrapper;
      assert.equal(await tipShowing(page, 'Before'), false, 'the tip showed before any tap');

      await tapAndSettle(page, tapped);
      assert.equal(await tipShowing(page, 'Before'), true, 'one tap did not leave the tip open');

      await tapAndSettle(page, tapped);
      assert.equal(await tipShowing(page, 'Before'), false, 'a second tap did not close it');

      await tapAndSettle(page, tapped);
      assert.equal(await tipShowing(page, 'Before'), true, 'a third tap did not open it again');
      await tapAndSettle(page, page.locator('[data-testid="tailor-ats"] p').first());
      assert.equal(await tipShowing(page, 'Before'), false, 'a tap elsewhere left it open');
      await page.context().close();
    });
  }

  // L-385: the tip is placed once at fixed screen coordinates, so a pinned tip
  // must close when the panel under it scrolls. The sheet itself does not
  // scroll, so its <main> is made a scroll panel here, as the app's screens
  // are: a panel's scroll event does not bubble, which is the case to prove.
  // The "i" is tapped, not the words, because a tap that scrolled it into view
  // would open the tip and shut it straight away — the first assertion.
  // TRAP — after a scroll WebKit sends a made-up mouseout from where the tap
  // was, and the mouse leaving closes a tip too. So the wait is on the tip's
  // own `hidden` changing, and it must change before any mouseout arrives.
  it('a tip opened by a real tap on the i closes when its panel scrolls', async () => {
    const page = await openHintSheet(HINT_WINDOWS['phone 375px'], true);
    await page.evaluate(() => {
      const sheet = document.querySelector<HTMLElement>('[data-testid="marks-sheet"]');
      if (sheet === null) throw new Error('no marks sheet');
      sheet.style.height = '400px';
      sheet.style.overflowY = 'auto';
    });
    const wrapper = page.locator('[data-testid="tailor-ats"] thead .cursor-help', {
      hasText: 'Before',
    });
    await tapAndSettle(page, wrapper.locator(HINT_BUTTON));
    assert.equal(await tipShowing(page, 'Before'), true, 'one tap did not leave the tip open');

    const seen = await page.evaluate(
      () =>
        new Promise<{ scrollTop: number; closedBy: string }>((done) => {
          const sheet = document.querySelector<HTMLElement>('[data-testid="marks-sheet"]');
          const words = [
            ...document.querySelectorAll('[data-testid="tailor-ats"] thead .cursor-help'),
          ].find((element) => (element.textContent ?? '').includes('Before'));
          const tip = document.getElementById(words?.getAttribute('aria-describedby') ?? '');
          if (sheet === null || words === undefined || tip === null) {
            throw new Error('no sheet, words or tip');
          }
          const report = (closedBy: string) => done({ scrollTop: sheet.scrollTop, closedBy });
          new MutationObserver(() => {
            if (tip.hidden) report('the scroll');
          }).observe(tip, { attributes: true, attributeFilter: ['hidden'] });
          words.addEventListener('mouseout', () => report('the mouse leaving'), true);
          // Only the failure path waits on a clock: nothing closed it at all.
          setTimeout(() => report('nothing'), 3000);
          sheet.scrollTop = 100;
        }),
    );
    assert.ok(seen.scrollTop > 0, 'the panel did not scroll');
    assert.equal(seen.closedBy, 'the scroll', 'the tip stayed open over the scroll');
    assert.equal(await tipShowing(page, 'Before'), false, 'the tip is showing after the scroll');
    await page.context().close();
  });

  // NEGATIVE — a size check that cannot fail is not a check.
  it('the check can fail: a shrunk "i", and one that makes its row taller, are reported', async () => {
    const page = await openHintSheet(HINT_WINDOWS.desktop);
    await page.evaluate((selector) => {
      const [first, second] = document.querySelectorAll<HTMLElement>(selector);
      if (first === undefined || second === undefined) throw new Error('no hint buttons');
      first.style.minWidth = '0';
      first.style.minHeight = '0';
      first.style.padding = '0';
      second.style.margin = '0';
      second.style.minHeight = '40px';
    }, HINT_BUTTON);
    const report = await hintButtonProblems(page);
    assert.ok(
      report.problems.some((line) => /: \d+(\.\d+)?×\d+(\.\d+)?px$/.test(line)),
      `the shrunk button was not reported: ${JSON.stringify(report.problems)}`,
    );
    assert.ok(
      report.problems.some((line) => line.startsWith('ATS row')),
      `the taller row was not reported: ${JSON.stringify(report.problems)}`,
    );
    await page.context().close();
  });
});

/**
 * The ATS Score's two numbers as bars (L-396).
 *
 * Keyword coverage and bullet strength each draw a Before bar and an After bar
 * as wide as the number beside them, out of their track. jsdom does no layout,
 * so whether a 43 really is 43% of its track, and whether the bars fit a phone,
 * is only knowable here. The `?marks=1` sheet draws a rise (16 → 43) and a fall
 * (84 → 81).
 */
const BAR_WINDOWS = {
  'desktop 1000x700': { width: 1000, height: 700 },
  'phone 375x812': { width: 375, height: 812 },
} as const;

interface BarReport {
  readonly bars: readonly { id: string; number: number; track: number; bar: number }[];
  readonly problems: readonly string[];
}

/** Each bar against its number and its track; the bar list against its card and the window. */
async function barProblems(page: Page): Promise<BarReport> {
  return page.evaluate(() => {
    const problems: string[] = [];
    const list = document.querySelector('[data-testid="tailor-ats-bars"]');
    const card = document.querySelector('[data-testid="tailor-ats"]');
    if (list === null || card === null) return { bars: [], problems: ['no ATS bars'] };
    const bars = [...list.querySelectorAll('[data-testid$="-track"]')].map((track) => {
      const id = (track.getAttribute('data-testid') ?? '?').replace(/-track$/, '');
      const fill = track.querySelector(`[data-testid="${id}-bar"]`);
      const line = track.closest(`[data-testid="${id}"]`);
      const number = Number(line?.querySelector('.font-mono')?.textContent);
      const room = track.getBoundingClientRect();
      const box = fill?.getBoundingClientRect();
      if (fill === null || box === undefined || !Number.isFinite(number)) {
        problems.push(`${id}: no bar or no number`);
        return { id, number, track: room.width, bar: 0 };
      }
      const expected = (room.width * number) / 100;
      if (Math.abs(box.width - expected) > 1) {
        problems.push(
          `${id}: ${String(box.width)}px for ${String(number)}, not ${String(expected)}px`,
        );
      }
      if (box.left < room.left - 0.5 || box.right > room.right + 0.5) {
        problems.push(`${id}: spills out of its track`);
      }
      return { id, number, track: room.width, bar: box.width };
    });
    if (bars.length !== 4) problems.push(`${String(bars.length)} bars, not 4`);
    const inner =
      card.getBoundingClientRect().right - parseFloat(getComputedStyle(card).paddingRight);
    if (list.getBoundingClientRect().right > inner + 0.5)
      problems.push('bars: wider than the card');
    if (list.scrollWidth > list.clientWidth) problems.push('bars: scroll sideways');
    const root = document.documentElement;
    if (root.scrollWidth > root.clientWidth) {
      problems.push(`page: ${String(root.scrollWidth - root.clientWidth)}px too wide`);
    }
    return { bars, problems };
  });
}

describe('the ATS Score numbers are drawn as bars (L-396)', () => {
  for (const [name, viewport] of Object.entries(BAR_WINDOWS)) {
    it(`each bar's width matches its number to within 1px, ${name}`, async () => {
      const page = await openHintSheet(viewport);
      const report = await barProblems(page);
      console.log(`ATS bars (${name}): ${JSON.stringify(report)}`);
      assert.deepEqual(
        report.bars.map((bar) => bar.number),
        [16, 43, 84, 81],
      );
      assert.deepEqual(report.problems, []);
      await page.context().close();
    });
  }

  it('the bars do not scroll sideways at 375px', async () => {
    const page = await openHintSheet(BAR_WINDOWS['phone 375x812']);
    const report = await barProblems(page);
    assert.deepEqual(
      report.problems.filter((line) => /^(bars|page):/.test(line)),
      [],
    );
    assert.equal(await atsTableOverflow(page), 0, 'the ATS bars or table are wider than the card');
    await page.context().close();
  });

  // NEGATIVE — a check that cannot fail is not a check.
  it('the check can fail: a bar the wrong width, and a bar list too wide for its card, are reported', async () => {
    const page = await openHintSheet(BAR_WINDOWS['phone 375x812']);
    await page.evaluate(() => {
      const bar = document.querySelector<HTMLElement>(
        '[data-testid="tailor-ats-keyword-after-bar"]',
      );
      const list = document.querySelector<HTMLElement>('[data-testid="tailor-ats-bars"]');
      if (bar === null || list === null) throw new Error('no ATS bars');
      bar.style.width = '60%';
      list.style.maxWidth = 'none';
      list.style.width = '600px';
    });
    const report = await barProblems(page);
    assert.ok(
      report.problems.some((line) => line.startsWith('tailor-ats-keyword-after: ')),
      `the wrong width went unnoticed: ${JSON.stringify(report.problems)}`,
    );
    assert.ok(
      report.problems.includes('bars: wider than the card'),
      `the too-wide bars went unnoticed: ${JSON.stringify(report.problems)}`,
    );
    assert.ok((await atsTableOverflow(page)) > 0, 'the overflow check missed the bars');
    await page.context().close();
  });
});

/**
 * The tailored CV as a page, with one main save button (L-400).
 *
 * The draft is drawn as a white sheet, at most 768px (`max-w-3xl`) and centred
 * in the column, and the save row is a blue "Save as PDF…" with the other
 * formats in the shared "More formats" menu. jsdom cannot say whether the sheet
 * scrolls inside itself (the L-322 rule above), runs past the window, or where
 * the menu opens; this can. The `?draft=` switch opens Tailor on a finished
 * draft, the way a restart brings one back.
 */
const SHEET_WINDOWS = {
  'desktop 1000x700': { width: 1000, height: 700 },
  'phone 375x812': { width: 375, height: 812 },
} as const;
const SHEET_MAX_PX = 768;
const SAVE_ROW = [
  'tailor-save-pdf-cv',
  'tailor-save-more',
  'tailor-review-run',
  'tailor-letter-run',
];

/** Tailor on the harness's draft; with `contact`, the confirmed details are on top. */
async function tailorWithDraft(
  viewport: { width: number; height: number },
  draft: '1' | 'contact' = '1',
): Promise<Page> {
  const page = await open(`?seen=1&draft=${draft}`, viewport);
  await goTo(page, 'tailor');
  await page.waitForSelector('[data-testid="tailor-cv"] [data-block="heading"]');
  return page;
}

interface SheetReport {
  readonly width: number;
  /** Sheet centre minus column centre, in px. */
  readonly offCentre: number;
  /** How many lines the save row's four buttons take. */
  readonly rowLines: number;
  readonly problems: readonly string[];
}

/** The sheet against its column, anything poking out of it, and the save row's lines. */
async function sheetReport(page: Page): Promise<SheetReport> {
  return page.evaluate((row) => {
    const problems: string[] = [];
    const sheet = document.querySelector('[data-testid="tailor-cv"]');
    const column = document.querySelector('[data-content-column]');
    if (sheet === null || column === null) {
      return { width: 0, offCentre: 0, rowLines: 0, problems: ['no sheet or no column'] };
    }
    const box = sheet.getBoundingClientRect();
    const room = column.getBoundingClientRect();
    if (box.left < room.left - 0.5 || box.right > room.right + 0.5) {
      problems.push(`sheet ${String(box.left)}–${String(box.right)} is outside its column`);
    }
    if (sheet.scrollWidth > sheet.clientWidth) problems.push('sheet: scrolls sideways');
    for (const part of sheet.querySelectorAll('[data-block]')) {
      if (part.getBoundingClientRect().right > box.right + 0.5) {
        problems.push(`"${(part.textContent ?? '').slice(0, 20)}" runs past the sheet`);
      }
    }
    // A button starts a new line when it sits wholly below the one before it.
    // (A bordered button is 2px taller than the blue one, so tops alone differ.)
    let rowLines = 0;
    let lineBottom = -Infinity;
    for (const id of row) {
      const button = document.querySelector(`[data-testid="${id}"]`);
      if (button === null) {
        problems.push(`no ${id}`);
        continue;
      }
      const { top, bottom } = button.getBoundingClientRect();
      if (top >= lineBottom) {
        rowLines += 1;
        lineBottom = bottom;
      } else {
        lineBottom = Math.max(lineBottom, bottom);
      }
    }
    return {
      width: box.width,
      offCentre: (box.left + box.right) / 2 - (room.left + room.right) / 2,
      rowLines,
      problems,
    };
  }, SAVE_ROW);
}

/** Scroll Tailor's own area so `selector` is wholly in view, top first when it is taller. */
async function scrollTailorTo(page: Page, selector: string): Promise<void> {
  await page.evaluate((target) => {
    const area = document.querySelector('[data-testid="tailor-scroll"]');
    const element = document.querySelector(target);
    if (area === null || element === null) throw new Error(`no scroll area or ${target}`);
    const seen = area.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    if (box.bottom > seen.bottom && box.height < seen.height) {
      area.scrollTop += box.bottom - seen.bottom + 8;
    } else if (box.top < seen.top || box.height >= seen.height) {
      area.scrollTop += box.top - seen.top - 8;
    }
  }, selector);
  await scrollingSettled(page);
}

/** The open "More formats" list against the window and the scroll area; covered or cut-off items. */
async function formatsMenuProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const problems: string[] = [];
    const trigger = document.querySelector('[data-testid="tailor-save-more"]');
    const list = trigger?.nextElementSibling;
    const area = document.querySelector('[data-testid="tailor-scroll"]');
    if (
      trigger?.getAttribute('aria-expanded') !== 'true' ||
      list === null ||
      list === undefined ||
      area === null
    ) {
      return ['the menu is not open'];
    }
    const box = list.getBoundingClientRect();
    const seen = area.getBoundingClientRect();
    if (box.left < 0 || box.right > window.innerWidth) {
      problems.push(`list ${String(box.left)}–${String(box.right)} runs past the window`);
    }
    if (box.top < seen.top || box.bottom > seen.bottom) {
      problems.push(`list ${String(box.top)}–${String(box.bottom)} is outside the scroll area`);
    }
    const items = [...list.querySelectorAll('button')];
    if (items.length !== 2) problems.push(`${String(items.length)} items, not 2`);
    for (const item of items) {
      const part = item.getBoundingClientRect();
      const onTop = document.elementFromPoint(
        part.left + part.width / 2,
        part.top + part.height / 2,
      );
      if (onTop === null || !item.contains(onTop)) {
        problems.push(`"${item.textContent ?? ''}" is covered or cut off`);
      }
    }
    return problems;
  });
}

describe('the tailored CV is a page, with one main save button (L-400)', () => {
  for (const [name, viewport] of Object.entries(SHEET_WINDOWS)) {
    it(`nothing inside the sheet scrolls on its own, and nothing scrolls sideways (${name})`, async () => {
      const page = await tailorWithDraft(viewport, 'contact');
      const report = await sheetReport(page);
      console.log(`sheet (${name}): ${JSON.stringify(report)}`);
      assert.deepEqual(report.problems, []);
      assert.deepEqual(await innerScrollers(page), []);
      assert.deepEqual(await sidewaysOverflow(page), []);
      assert.ok(report.width <= SHEET_MAX_PX + 0.5, `the sheet is ${String(report.width)}px wide`);
      // One blue button on screen, and it is Save as PDF.
      const primary = await page.evaluate(() =>
        [...document.querySelectorAll('[data-primary="true"]')].map((button) =>
          button.getAttribute('data-testid'),
        ),
      );
      assert.deepEqual(primary, ['tailor-save-pdf-cv']);
      await page.context().close();
    });

    it(`a real click opens More formats, it stays open, and it is wholly inside the window (${name})`, async () => {
      const page = await tailorWithDraft(viewport);
      await scrollTailorTo(page, '[data-testid="tailor-save-more"]');
      await page.click('[data-testid="tailor-save-more"]');
      await page.waitForSelector('[data-testid="tailor-save-more"][aria-expanded="true"]');
      await scrollTailorTo(page, '[data-testid="tailor-save-more"] + div');
      const problems = await formatsMenuProblems(page);
      console.log(`More formats open (${name}): ${JSON.stringify(problems)}`);
      assert.deepEqual(problems, []);
      assert.deepEqual(await sidewaysOverflow(page), []);
      assert.equal(
        await page.locator('[data-testid="tailor-save-docx-cv"]').textContent(),
        'Save as Word…',
      );
      assert.equal(
        await page.getAttribute('[data-testid="tailor-save-more"]', 'aria-expanded'),
        'true',
        'the menu closed by itself',
      );
      await page.context().close();
    });
  }

  it('the sheet is never wider than about 768px and is centred at 1264', async () => {
    const page = await tailorWithDraft({ width: 1264, height: 720 });
    const report = await sheetReport(page);
    console.log(`sheet (1264x720): ${JSON.stringify(report)}`);
    assert.deepEqual(report.problems, []);
    assert.ok(report.width <= SHEET_MAX_PX + 0.5, `the sheet is ${String(report.width)}px wide`);
    assert.ok(report.width >= SHEET_MAX_PX - 0.5, 'the column is too narrow to show the cap');
    assert.ok(
      Math.abs(report.offCentre) <= 1,
      `the sheet is ${String(report.offCentre)}px off centre`,
    );
    await page.context().close();
  });

  for (const [name, viewport] of Object.entries(SHEET_WINDOWS)) {
    it(`colour contrast on the sheet, top and bottom (${name})`, async () => {
      const page = await tailorWithDraft(viewport, 'contact');
      // axe measures only text on screen, so the sheet is brought into view.
      await scrollTailorTo(page, '[data-testid="tailor-cv"]');
      judge(`tailored CV, top (${name})`, await contrast(page));
      await page.evaluate(() => {
        const area = document.querySelector('[data-testid="tailor-scroll"]');
        const sheet = document.querySelector('[data-testid="tailor-cv"]');
        if (area === null || sheet === null) throw new Error('no scroll area or sheet');
        const bottom = sheet.getBoundingClientRect().bottom;
        area.scrollTop += bottom - area.getBoundingClientRect().bottom + 8;
      });
      await scrollingSettled(page);
      judge(`tailored CV, bottom (${name})`, await contrast(page));
      await page.context().close();
    });
  }

  // NEGATIVE — a check that cannot fail is not a check.
  it('the check can fail: a sheet that scrolls inside itself, and one too wide, are reported', async () => {
    const page = await tailorWithDraft(SHEET_WINDOWS['phone 375x812']);
    await page.evaluate(() => {
      const sheet = document.querySelector<HTMLElement>('[data-testid="tailor-cv"]');
      if (sheet === null) throw new Error('no sheet');
      sheet.style.maxHeight = '120px';
      sheet.style.overflowY = 'auto';
      sheet.style.maxWidth = 'none';
      sheet.style.width = '900px';
    });
    const inner = await innerScrollers(page);
    assert.ok(
      inner.some((line) => line.startsWith('tailor-cv: ')),
      `the scrolling sheet went unreported: ${JSON.stringify(inner)}`,
    );
    const report = await sheetReport(page);
    assert.ok(
      report.problems.some((line) => line.includes('outside its column')),
      `the too-wide sheet went unreported: ${JSON.stringify(report.problems)}`,
    );
    assert.ok((await sidewaysOverflow(page)).length > 0, 'the sideways check missed the sheet');
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

/**
 * A result card's "…" menu stays on screen and on top (L-392).
 *
 * Each card has one bordered "Save to tracker" and a small "…" that opens a
 * short list below it, right-aligned. The list hangs out of its card into the
 * scrolling results, so three things only a real engine can show: it is wholly
 * inside the window and adds no sideways scroll, it paints above the next card,
 * and under the last card the area grows so it can be scrolled to, not cut off.
 * On a phone the "…" and each item keep the 44px thumb height.
 */
const MENU_WINDOWS = {
  smallest: { width: 1000, height: 700 },
  phone: { width: 375, height: 700 },
} as const;
const FIRST_CARD = 'job-0';
const LAST_CARD = 'job-11';

/** Search with the harness's twelve fake adverts drawn. */
async function openResults(viewport: { width: number; height: number }): Promise<Page> {
  const page = await openTypedSearch(viewport, '?seen=1&results=1');
  await page.locator('[data-testid="search-submit"]:not([disabled])').click();
  await page.getByText('Project Coordinator 11').first().waitFor();
  return page;
}

/**
 * Press a card's "…" and scroll the results until the whole list is in view:
 * axe measures only text that is on screen, and a user scrolls to read it too.
 */
async function openCardMenu(page: Page, id: string): Promise<void> {
  await page.click(`[data-testid="result-more-${id}"]`);
  await page.waitForSelector(`[data-testid="result-more-${id}"][aria-expanded="true"]`);
  await page.evaluate(
    ({ areaSelector, trigger }) => {
      const area = document.querySelector(areaSelector);
      const list = document.querySelector(trigger)?.nextElementSibling;
      if (area === null || list === null || list === undefined) throw new Error('no open list');
      const seen = area.getBoundingClientRect();
      const box = list.getBoundingClientRect();
      if (box.bottom > seen.bottom) area.scrollTop += box.bottom - seen.bottom + 8;
      else if (box.top < seen.top) area.scrollTop -= seen.top - box.top + 8;
    },
    { areaSelector: SEARCH_AREA, trigger: `[data-testid="result-more-${id}"]` },
  );
}

interface MenuReport {
  readonly problems: readonly string[];
  readonly width: number;
  readonly triggerHeight: number;
  readonly itemHeights: readonly number[];
  /** How far the list reaches over the next card, in px; 0 for the last card. */
  readonly overNext: number;
}

/** What is wrong with an open list as the user sees it. No problems means all is well. */
async function menuReport(page: Page, id: string): Promise<MenuReport> {
  const report = await page.evaluate(
    ({ areaSelector, id }) => {
      const problems: string[] = [];
      const area = document.querySelector(areaSelector);
      const trigger = document.querySelector(`[data-testid="result-more-${id}"]`);
      const list = trigger?.nextElementSibling;
      if (area === null || trigger === null || list === null || list === undefined) {
        return {
          problems: ['no open list'],
          width: 0,
          triggerHeight: 0,
          itemHeights: [],
          overNext: 0,
        };
      }
      const box = list.getBoundingClientRect();
      const seen = area.getBoundingClientRect();
      if (box.left < 0 || box.right > window.innerWidth) {
        problems.push(`list ${String(box.left)}–${String(box.right)} runs past the window`);
      }
      if (box.top < seen.top || box.bottom > seen.bottom) {
        problems.push(
          `list ${String(box.top)}–${String(box.bottom)} is outside the scroll area's ` +
            `${String(seen.top)}–${String(seen.bottom)}`,
        );
      }
      const items = [...list.querySelectorAll('button')];
      for (const item of items) {
        const part = item.getBoundingClientRect();
        // Near each corner of each item, inside its rounding: anything but the
        // list there means the item is covered, and nothing means it is cut off.
        const corners = [
          [part.left + 4, part.top + 4],
          [part.right - 4, part.top + 4],
          [part.left + 4, part.bottom - 4],
          [part.right - 4, part.bottom - 4],
        ] as const;
        for (const [x, y] of corners) {
          const onTop = document.elementFromPoint(x, y);
          if (onTop === null || !list.contains(onTop)) {
            problems.push(
              `"${item.textContent ?? ''}" is covered or cut off at ${String(x)},${String(y)}`,
            );
          }
        }
      }
      const next = trigger.closest('article')?.nextElementSibling?.getBoundingClientRect();
      return {
        problems,
        width: box.width,
        triggerHeight: trigger.getBoundingClientRect().height,
        itemHeights: items.map((item) => item.getBoundingClientRect().height),
        overNext: next === undefined ? 0 : Math.max(0, box.bottom - next.top),
      };
    },
    { areaSelector: SEARCH_AREA, id },
  );
  return { ...report, problems: [...report.problems, ...(await sidewaysOverflow(page))] };
}

describe('a result card has one clear action, and its "…" menu stays in view (L-392)', () => {
  for (const [name, viewport] of Object.entries(MENU_WINDOWS)) {
    it(`${name}: the first card's open menu is wholly inside the window and paints above the next card`, async () => {
      const page = await openResults(viewport);
      await openCardMenu(page, FIRST_CARD);
      const report = await menuReport(page, FIRST_CARD);
      console.log(`first card menu (${name}): ${JSON.stringify(report)}`);
      assert.deepEqual(report.problems, []);
      // Proof the paint check looked at an overlap at all.
      assert.ok(
        report.overNext > 0,
        `the list does not reach the next card: ${String(report.overNext)}`,
      );
      await page.context().close();
    });

    it(`${name}: the last card's menu can be scrolled to and is not cut off`, async () => {
      const page = await openResults(viewport);
      await openCardMenu(page, LAST_CARD);
      const report = await menuReport(page, LAST_CARD);
      console.log(`last card menu (${name}): ${JSON.stringify(report)}`);
      assert.deepEqual(report.problems, []);
      await page.context().close();
    });

    it(`${name}: colour contrast with a menu open`, async () => {
      const page = await openResults(viewport);
      await openCardMenu(page, FIRST_CARD);
      const listed = await page.evaluate(
        () =>
          document.querySelectorAll(
            '[data-testid^="result-analyse-"], [data-testid^="result-open-"]',
          ).length,
      );
      assert.equal(listed, 2, 'the list was not open when contrast was measured');
      judge(`search results, menu open (${name})`, await contrast(page));
      await page.context().close();
    });
  }

  it('at 375px "…" and each item are at least 44px tall', async () => {
    const page = await openResults(MENU_WINDOWS.phone);
    await openCardMenu(page, FIRST_CARD);
    const report = await menuReport(page, FIRST_CARD);
    assert.ok(report.triggerHeight >= 44, `"…" is ${String(report.triggerHeight)}px tall`);
    assert.equal(report.itemHeights.length, 2);
    for (const height of report.itemHeights) {
      assert.ok(height >= 44, `an item is ${String(height)}px tall`);
    }
    await page.context().close();
  });

  // NEGATIVE — a list sent under the next card, and one cut off by its own card, are caught.
  it('the check can fail: a list painted under the cards, and one cut off by its card, are reported', async () => {
    const page = await openResults(MENU_WINDOWS.smallest);
    await openCardMenu(page, FIRST_CARD);
    const trigger = `[data-testid="result-more-${FIRST_CARD}"]`;
    await page.evaluate((selector) => {
      const list = document.querySelector(selector)?.nextElementSibling;
      if (list instanceof HTMLElement) list.style.zIndex = '-1';
    }, trigger);
    const under = await menuReport(page, FIRST_CARD);
    assert.ok(
      under.problems.some((line) => line.includes('covered or cut off')),
      `the list under the cards was not flagged: ${JSON.stringify(under.problems)}`,
    );

    await page.evaluate((selector) => {
      const button = document.querySelector(selector);
      const list = button?.nextElementSibling;
      if (list instanceof HTMLElement) list.style.zIndex = '';
      const card = button?.closest('article');
      if (card instanceof HTMLElement) card.style.overflow = 'hidden';
    }, trigger);
    const clipped = await menuReport(page, FIRST_CARD);
    assert.ok(
      clipped.problems.some((line) => line.includes('covered or cut off')),
      `the list cut off by its card was not flagged: ${JSON.stringify(clipped.problems)}`,
    );
    await page.context().close();
  });
});

/**
 * Settings key rows (L-390).
 *
 * Each AI provider, "Your own AI service" and the two job boards are short rows
 * on the browser's own fold (`<details>`). jsdom keeps a closed fold's content
 * drawn, focusable and clickable, and does not open one on Enter, so a row that
 * never opens passes every unit test. Only a real engine can say that the title
 * is one line, that Enter opens it, and that the Reed jump lands on a button a
 * person can see.
 */
const ROW_WINDOWS = {
  smallest: { width: 1000, height: 700 },
  desktop: { width: 1280, height: 800 },
  wide: { width: 1440, height: 900 },
  phone: { width: 375, height: 700 },
} as const;

/** Every key row: six providers, your own service, and the two job boards. */
const KEY_ROWS =
  'details[data-testid^="ai-key-row-"], details[data-testid="custom-service-row"], ' +
  'details[data-testid^="key-row-"]';

/** Settings, with the job-board fold opened so its two rows are drawn too. */
async function settingsWithRows(
  viewport: { width: number; height: number },
  query = '?seen=1',
): Promise<Page> {
  const page = await open(query, viewport);
  await goTo(page, 'settings');
  await page.waitForSelector('[data-testid="ai-key-row-openai"]');
  await page.click('[data-testid="settings-advanced"] > summary');
  await page.locator('[data-testid="key-row-reed"] > summary:visible').waitFor();
  return page;
}

/**
 * What is wrong with the closed rows. Empty means all is well: each title is
 * 44px to `tallest`px, and nothing reaches past the window or scrolls sideways.
 */
async function keyRowProblems(page: Page, tallest: number): Promise<string[]> {
  return page.evaluate(
    ({ selector, max }) => {
      const problems: string[] = [];
      const rows = [...document.querySelectorAll<HTMLDetailsElement>(selector)];
      if (rows.length !== 9) problems.push(`${String(rows.length)} rows drawn, not 9`);
      for (const row of rows) {
        const name = row.dataset.testid ?? '?';
        const title = row.querySelector('summary');
        if (title === null) {
          problems.push(`${name}: no title`);
          continue;
        }
        const box = title.getBoundingClientRect();
        if (row.open) problems.push(`${name}: open`);
        if (box.height < 44 || box.height > max) {
          problems.push(`${name}: title is ${String(box.height)}px tall`);
        }
        if (box.right > document.documentElement.clientWidth) {
          problems.push(`${name}: reaches ${String(box.right)}px, past the window`);
        }
      }
      const area = document.querySelector('[data-testid="view-settings"] .overflow-y-auto');
      for (const scroller of [document.documentElement, area]) {
        if (scroller !== null && scroller.scrollWidth > scroller.clientWidth) {
          problems.push(`${scroller.tagName.toLowerCase()} scrolls sideways`);
        }
      }
      return problems;
    },
    { selector: KEY_ROWS, max: tallest },
  );
}

/** Every closed title's height, for the log. */
async function keyRowHeights(page: Page): Promise<Record<string, number>> {
  return page.evaluate((selector) => {
    const out: Record<string, number> = {};
    for (const row of document.querySelectorAll<HTMLDetailsElement>(selector)) {
      out[row.dataset.testid ?? '?'] =
        row.querySelector('summary')?.getBoundingClientRect().height ?? 0;
    }
    return out;
  }, KEY_ROWS);
}

/** Whether the row with this test id is open. */
async function rowOpen(page: Page, testId: string): Promise<boolean> {
  return page
    .locator(`[data-testid="${testId}"]`)
    .evaluate((row) => (row as HTMLDetailsElement).open);
}

describe('Settings key rows (L-390)', () => {
  for (const [name, viewport] of Object.entries(ROW_WINDOWS)) {
    // Two lines are allowed on a phone: the model may wrap under the name.
    const tallest = name === 'phone' ? 76 : 56;
    const size = `${String(viewport.width)}×${String(viewport.height)}`;

    it(`every closed row is one title line, 44 to ${String(tallest)}px, nothing past the window, at ${size}`, async () => {
      const page = await settingsWithRows(viewport);
      console.log(`key rows (${size}): ${JSON.stringify(await keyRowHeights(page))}`);
      assert.deepEqual(await keyRowProblems(page, tallest), []);
      await page.context().close();
    });

    it(`with every key saved, the model shows in the title and the row still fits, at ${size}`, async () => {
      const page = await settingsWithRows(viewport, '?seen=1&results=1');
      await page.locator('[data-testid="ai-key-row-model-google"]').waitFor();
      const title = await page.locator('[data-testid="ai-key-row-google"] > summary').textContent();
      console.log(
        `key rows, all saved (${size}): ${JSON.stringify(await keyRowHeights(page))} — ${String(title)}`,
      );
      assert.match(title ?? '', /^Google Gemini\s*gemini\S*\s*Key saved$/);
      assert.deepEqual(await keyRowProblems(page, tallest), []);
      await page.context().close();
    });
  }

  it('a real Tab reaches the OpenAI row, Enter opens it and the key box is visible; Space closes it', async () => {
    const page = await open('?seen=1', ROW_WINDOWS.smallest);
    await goTo(page, 'settings');
    await page.waitForSelector('[data-testid="ai-key-row-openai"]');
    const box = page.locator('[data-testid="ai-key-input-openai"]');
    assert.equal(await box.isVisible(), false, 'the key box shows while the row is closed');

    let reached = false;
    for (let presses = 0; presses < 80 && !reached; presses += 1) {
      await page.keyboard.press('Tab');
      reached = await page.evaluate(
        () =>
          document.activeElement ===
          document.querySelector('[data-testid="ai-key-row-openai"] > summary'),
      );
    }
    assert.ok(reached, 'Tab never reached the OpenAI row');

    await page.keyboard.press('Enter');
    await page.locator('[data-testid="ai-key-input-openai"]:visible').waitFor();
    assert.equal(await rowOpen(page, 'ai-key-row-openai'), true);
    // Only that row: the next one is still closed.
    assert.equal(await page.locator('[data-testid="ai-key-input-anthropic"]').isVisible(), false);

    await page.keyboard.press(' ');
    await box.waitFor({ state: 'hidden' });
    assert.equal(await rowOpen(page, 'ai-key-row-openai'), false);
    await page.context().close();
  });

  for (const [name, viewport] of [
    ['1000×700', ROW_WINDOWS.smallest],
    ['375×700', ROW_WINDOWS.phone],
  ] as const) {
    it(`from Search, "Get a free Reed key" lands on a visible, focused Reed button inside an open row, ${name}`, async () => {
      const page = await openTypedSearch(viewport);
      await page.click('[data-testid="search-get-reed-key"]');
      await page.locator('[data-testid="nav-settings"][aria-current="page"]:visible').waitFor();
      await page.locator('[data-testid="key-signup-reed"]:visible:focus').waitFor();
      await scrollingSettled(page);
      const seen = await page.evaluate(() => {
        const button = document.querySelector('[data-testid="key-signup-reed"]');
        const area = document.querySelector('[data-testid="view-settings"] .overflow-y-auto');
        if (button === null || area === null) return null;
        const box = button.getBoundingClientRect();
        const room = area.getBoundingClientRect();
        const onTop = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        const open = (id: string): boolean =>
          (document.querySelector(`[data-testid="${id}"]`) as HTMLDetailsElement | null)?.open ??
          false;
        return {
          focused: document.activeElement === button,
          reedOpen: open('key-row-reed'),
          adzunaOpen: open('key-row-adzuna'),
          inArea: box.height > 0 && box.top >= room.top && box.bottom <= room.bottom,
          onTop: onTop !== null && button.contains(onTop),
        };
      });
      console.log(`Reed jump (${name}): ${JSON.stringify(seen)}`);
      assert.deepEqual(seen, {
        focused: true,
        reedOpen: true,
        adzunaOpen: false,
        inArea: true,
        onTop: true,
      });
      await page.context().close();
    });
  }

  // NEGATIVE — a check that cannot fail is not a check.
  it('the check can fail: a row forced to two lines at 1000px is reported', async () => {
    const page = await settingsWithRows(ROW_WINDOWS.smallest);
    await page.evaluate(() => {
      const heading = document.querySelector('[data-testid="ai-key-row-mistral"] h3');
      if (heading !== null) heading.textContent = 'Mistral '.repeat(30).trim();
    });
    const problems = await keyRowProblems(page, 56);
    assert.ok(
      problems.some((line) => line.startsWith('ai-key-row-mistral: title is')),
      `the two-line row was not flagged: ${JSON.stringify(problems)}`,
    );
    await page.context().close();
  });

  it('the check can fail: an open row is reported', async () => {
    const page = await settingsWithRows(ROW_WINDOWS.smallest);
    await page.click('[data-testid="ai-key-row-grok"] > summary');
    const problems = await keyRowProblems(page, 56);
    assert.ok(
      problems.includes('ai-key-row-grok: open'),
      `the open row was not flagged: ${JSON.stringify(problems)}`,
    );
    await page.context().close();
  });
});
