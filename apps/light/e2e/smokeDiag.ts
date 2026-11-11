/**
 * L-375 TEMPORARY DIAGNOSTICS — removed before merge.
 *
 * Runs AFTER each picture is saved, so the saved picture is taken exactly as
 * before. Records: what is hovered / focused / animating at the shot, where
 * the OS cursor is, a burst of frames after the shot (is anything still
 * changing?), and a frame after a forced window resize (does a repaint change
 * the anti-aliased edges?).
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { type WebDriver } from 'selenium-webdriver';

const PROBE = String.raw`
function describe(el) {
  if (!el || !el.tagName) return String(el);
  var id = el.getAttribute && el.getAttribute('data-testid');
  return el.tagName.toLowerCase() + (id ? '[' + id + ']' : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').slice(0, 3).join('.') : '');
}
var hovered = Array.prototype.map.call(document.querySelectorAll(':hover'), describe);
var anims = document.getAnimations().map(function (a) {
  return (a.animationName || a.transitionProperty || a.constructor.name) + '@' + describe(a.effect && a.effect.target) + ':' + a.playState;
});
var gl = '';
try {
  var c = document.createElement('canvas').getContext('webgl');
  var ext = c && c.getExtension('WEBGL_debug_renderer_info');
  gl = c ? (ext ? c.getParameter(ext.UNMASKED_RENDERER_WEBGL) : c.getParameter(c.RENDERER)) : 'no webgl';
} catch (e) { gl = 'error ' + e; }
return JSON.stringify({
  hovered: hovered.slice(-3),
  active: describe(document.activeElement),
  anims: anims,
  fonts: document.fonts.status,
  dpr: window.devicePixelRatio,
  screen: [screen.width, screen.height],
  win: [window.screenX, window.screenY, window.outerWidth, window.outerHeight, window.innerWidth, window.innerHeight],
  ua: navigator.userAgent,
  gl: gl,
});
`;

function osCursor(): string {
  try {
    return execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        'Add-Type -AssemblyName System.Windows.Forms; $p=[System.Windows.Forms.Cursor]::Position; $b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; "cursor=$($p.X),$($p.Y) screen=$($b.Width)x$($b.Height)"',
      ],
      { encoding: 'utf8', timeout: 20_000 },
    ).trim();
  } catch (error) {
    return `cursor unknown (${String(error).slice(0, 200)})`;
  }
}

function hash(png: string): string {
  return createHash('sha256').update(Buffer.from(png, 'base64')).digest('hex').slice(0, 8);
}

export async function diagnose(driver: WebDriver, dir: string, name: string): Promise<void> {
  const diag = join(dir, 'diag');
  mkdirSync(diag, { recursive: true });
  const probe = await driver.executeScript<string>(PROBE);
  console.log(`smoke: diag ${name} probe = ${probe}`);
  console.log(`smoke: diag ${name} os = ${osCursor()}`);

  const seen = new Map<string, number>();
  const sequence: string[] = [];
  const started = Date.now();
  for (let i = 0; i < 10; i += 1) {
    const png = await driver.takeScreenshot();
    const h = hash(png);
    sequence.push(`${String(Date.now() - started)}ms:${h}`);
    if (!seen.has(h)) {
      seen.set(h, i);
      writeFileSync(join(diag, `${name}-burst-${String(i)}-${h}.png`), Buffer.from(png, 'base64'));
    }
    await driver.sleep(200);
  }
  console.log(`smoke: diag ${name} burst = ${sequence.join(' ')}`);

  // A forced repaint: one pixel wider and taller, then back.
  try {
    const rect = await driver.manage().window().getRect();
    await driver
      .manage()
      .window()
      .setRect({ x: rect.x, y: rect.y, width: rect.width + 1, height: rect.height + 1 });
    await driver.sleep(400);
    await driver.manage().window().setRect(rect);
    await driver.sleep(800);
    const png = await driver.takeScreenshot();
    const h = hash(png);
    writeFileSync(join(diag, `${name}-resized-${h}.png`), Buffer.from(png, 'base64'));
    console.log(`smoke: diag ${name} resized = ${h}`);
  } catch (error) {
    console.log(`smoke: diag ${name} resized = failed ${String(error)}`);
  }
}
