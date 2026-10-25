// End-to-end tests: loads dist/chrome into Chromium and drives real pages.
//
//   npm test
//
// Needs Playwright's Chromium (`npx playwright install chromium`), or set
// CHROMIUM_PATH to another Chromium build. Branded Google Chrome can't load
// unpacked extensions from the command line.
//
// Note: Playwright runs page scripts with a simulated user gesture, so these tests
// can't prove that the popup and shortcuts pass a real gesture through to the page.

import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fixtures = path.join(root, 'tests', 'fixtures');
const PORT = 8765;
const ORIGIN = `http://localhost:${PORT}`;
// A second origin, so embeds are cross-origin like a real YouTube/Vimeo embed.
const EMBED_PORT = 8766;
const EMBED_ORIGIN = `http://127.0.0.1:${EMBED_PORT}`;

// ---------- setup ----------

// Automation can't click the toolbar button, so the test copy gets host access to
// the fixture server instead of relying on activeTab.
const extDir = await mkdtemp(path.join(tmpdir(), 'yoyo-player-'));
await cp(path.join(root, 'dist', 'chrome'), extDir, { recursive: true });
const manifest = JSON.parse(await readFile(path.join(extDir, 'manifest.json'), 'utf8'));
manifest.host_permissions = [`${ORIGIN}/*`, `${EMBED_ORIGIN}/*`];
await writeFile(path.join(extDir, 'manifest.json'), JSON.stringify(manifest));

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const serve = async (req, res) => {
  const name = path.basename(new URL(req.url, ORIGIN).pathname) || 'basic.html';
  try {
    const body = await readFile(path.join(fixtures, name));
    res.setHeader('content-type', TYPES[path.extname(name)] ?? 'application/octet-stream');
    if (name === 'csp.html') {
      res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'");
    }
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end();
  }
};
const servers = [createServer(serve).listen(PORT), createServer(serve).listen(EMBED_PORT)];

const context = await chromium.launchPersistentContext('', {
  headless: !process.env.HEADED,
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: [
    `--disable-extensions-except=${extDir}`,
    `--load-extension=${extDir}`,
    '--autoplay-policy=no-user-gesture-required',
  ],
  viewport: { width: 1200, height: 800 },
});
const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
const extId = new URL(worker.url()).host;

// ---------- helpers ----------

async function open(fixture) {
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.goto(`${ORIGIN}/${fixture}`);
  await page.waitForFunction(() => {
    const host = document.querySelector('shadow-player');
    const v = host ? host.shadowRoot.querySelector('video') : document.querySelector('video');
    return v && !v.paused && v.readyState > 2;
  });
  return page;
}

// Where the video is right now and whether it's still playing.
function state(page) {
  return page.evaluate(() => {
    const pipDoc = window.documentPictureInPicture?.window?.document;
    const host = document.querySelector('yoyo-player');
    const v = pipDoc?.querySelector('video')
      ?? host?.shadowRoot.querySelector('video')
      ?? document.querySelector('shadow-player')?.shadowRoot.querySelector('video')
      ?? document.querySelector('video');
    return {
      where: pipDoc?.querySelector('video') ? 'window' : host ? 'page' : 'inline',
      playing: !!v && !v.paused,
      placeholder: !!document.querySelector('.yoyo-player-placeholder')
        || !!document.querySelector('shadow-player')?.shadowRoot.querySelector('.yoyo-player-placeholder'),
      box: host?.getBoundingClientRect().toJSON() ?? null,
      radius: host ? getComputedStyle(host.shadowRoot.querySelector('.frame')).borderRadius : null,
    };
  });
}

async function tabIdOf(page) {
  return worker.evaluate((url) => chrome.tabs.query({ url }).then(([t]) => t.id), page.url());
}

// The same calls the popup and keyboard shortcuts make (see src/send.js).
const runAction = async (page, action) => worker.evaluate(
  ([id, a]) => runAction(id, a), [await tabIdOf(page), action]);
const tabStatus = async (page) => worker.evaluate(
  (id) => frameStates(id).then(summarize), await tabIdOf(page));

// The embedded player's frame on iframe.html, once its video is playing.
async function embedFrame(page) {
  const frame = page.frames().find((f) => f.url().startsWith(EMBED_ORIGIN));
  await frame.waitForFunction(() => {
    const v = document.querySelector('video');
    return v && !v.paused && v.readyState > 2;
  });
  return frame;
}

function iframeState(page) {
  return page.evaluate(() => {
    const f = document.getElementById('embed');
    return {
      floating: !!document.querySelector('yoyo-player'),
      position: getComputedStyle(f).position,
      box: f.getBoundingClientRect().toJSON(),
      placeholder: !!document.querySelector('.yoyo-player-placeholder'),
    };
  });
}

async function scrollTo(page, y) {
  await page.mouse.move(600, 400);
  await page.mouse.wheel(0, y - await page.evaluate(() => scrollY));
  await page.waitForTimeout(600);
}

// ---------- tests ----------

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('scrolling past a playing video floats it, scrolling back restores it', async () => {
  const page = await open('basic.html');
  await scrollTo(page, 40); // the user has seen it playing
  await scrollTo(page, 1600);
  let s = await state(page);
  assert.equal(s.where, 'page');
  assert.ok(s.playing, 'keeps playing while floating');
  assert.ok(s.placeholder, 'leaves a placeholder in the page');
  await scrollTo(page, 0);
  s = await state(page);
  assert.equal(s.where, 'inline');
  assert.ok(s.playing);
  assert.ok(!s.placeholder);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('the in-page player can be dragged, and a click pauses it', async () => {
  const page = await open('basic.html');
  await runAction(page, 'float');
  const { box } = await state(page);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(300, 200, { steps: 8 });
  await page.mouse.up();
  let s = await state(page);
  assert.ok(Math.abs(s.box.x + s.box.width / 2 - 300) < 30, `moved horizontally (x=${s.box.x})`);
  assert.ok(s.playing);
  await page.mouse.click(300, 200);
  s = await state(page);
  assert.ok(!s.playing, 'click pauses');
  await page.close();
});

test("the player's pop-out button moves the video into its own window", async () => {
  const page = await open('basic.html');
  await runAction(page, 'float');
  const { box } = await state(page);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); // reveal controls
  await page.mouse.click(box.x + box.width - 28, box.y + box.height - 20);
  await page.waitForTimeout(500);
  let s = await state(page);
  assert.equal(s.where, 'window');
  assert.ok(s.playing, 'keeps playing in the window');
  await page.evaluate(() => documentPictureInPicture.window.close());
  await page.waitForTimeout(300);
  s = await state(page);
  assert.equal(s.where, 'inline', 'closing the window returns the video');
  assert.ok(s.playing);
  await page.close();
});

test('the popOut action toggles the window', async () => {
  const page = await open('basic.html');
  assert.equal((await runAction(page, 'popOut')).mode, 'window');
  assert.equal((await state(page)).where, 'window');
  assert.equal((await runAction(page, 'popOut')).mode, null);
  const s = await state(page);
  assert.equal(s.where, 'inline');
  assert.ok(s.playing);
  await page.close();
});

test('works on a page with a strict Content-Security-Policy', async () => {
  const page = await open('csp.html');
  await runAction(page, 'float');
  const s = await state(page);
  assert.equal(s.where, 'page');
  assert.equal(s.radius, '12px', "the player's styles are applied");
  await runAction(page, 'popOut');
  assert.equal((await state(page)).where, 'window');
  await runAction(page, 'popOut');
  await page.close();
});

test('finds videos inside shadow DOM players', async () => {
  const page = await open('shadow.html');
  const status = await runAction(page, 'status');
  assert.ok(status.hasVideo);
  await runAction(page, 'float');
  let s = await state(page);
  assert.equal(s.where, 'page');
  assert.ok(s.playing);
  await runAction(page, 'float');
  s = await state(page);
  assert.equal(s.where, 'inline');
  assert.ok(s.playing);
  await page.close();
});

test('embedded videos float in the page without reloading', async () => {
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/iframe.html`);
  const frame = await embedFrame(page);
  const loadedAt = await frame.evaluate(() => performance.timeOrigin);
  await page.waitForTimeout(300); // let the embed report its video

  assert.ok((await tabStatus(page)).canFloat);
  await runAction(page, 'float');
  let s = await iframeState(page);
  assert.ok(s.floating && s.placeholder);
  assert.equal(s.position, 'fixed');

  // Drag it by its bar.
  const bar = await page.evaluate(() => document.querySelector('yoyo-player').getBoundingClientRect().toJSON());
  await page.mouse.move(bar.x + 40, bar.y + 12);
  await page.mouse.down();
  await page.mouse.move(200, 100, { steps: 8 });
  await page.mouse.up();
  const moved = await iframeState(page);
  assert.ok(Math.abs(moved.box.x - (s.box.x + 200 - bar.x - 40)) < 30, `embed follows the bar (x=${moved.box.x})`);

  await runAction(page, 'float');
  s = await iframeState(page);
  assert.ok(!s.floating && !s.placeholder);
  assert.equal(s.position, 'static');
  assert.equal(await frame.evaluate(() => performance.timeOrigin), loadedAt, 'the embed was not reloaded');
  assert.ok(await frame.evaluate(() => !document.querySelector('video').paused), 'still playing');
  await page.close();
});

test('scrolling past a playing embed floats it', async () => {
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/iframe.html`);
  await embedFrame(page);
  await page.waitForTimeout(300);
  await scrollTo(page, 40);
  await scrollTo(page, 1600);
  assert.equal((await iframeState(page)).position, 'fixed');
  await scrollTo(page, 0);
  assert.equal((await iframeState(page)).position, 'static');
  await page.close();
});

test('pop-out runs inside the embed and uses picture-in-picture', async () => {
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/iframe.html`);
  const frame = await embedFrame(page);
  await page.waitForTimeout(300);
  await runAction(page, 'popOut');
  await frame.waitForFunction(() => !!document.pictureInPictureElement);
  assert.ok((await tabStatus(page)).pip);
  await runAction(page, 'popOut');
  await frame.waitForFunction(() => !document.pictureInPictureElement);
  await page.close();
});

test('DRM videos (Netflix, Prime Video, ...) are never moved; pop-out uses picture-in-picture', async () => {
  const page = await open('drm.html');
  await page.waitForFunction(() => document.body.dataset.drm);
  assert.equal(await page.evaluate(() => document.body.dataset.drm), 'ready');

  const status = await tabStatus(page);
  assert.ok(status.hasVideo);
  assert.ok(!status.canFloat, 'float in page is not offered');
  await runAction(page, 'float');
  assert.equal((await state(page)).where, 'inline');

  await runAction(page, 'popOut');
  await page.waitForFunction(() => document.pictureInPictureElement);
  const s = await state(page);
  assert.equal(s.where, 'inline', 'the video stays in the page');
  assert.ok(!s.placeholder);
  assert.ok(s.playing);
  await runAction(page, 'popOut');
  await page.waitForFunction(() => !document.pictureInPictureElement);
  await page.close();
});

test('the popup loads without errors', async () => {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`chrome-extension://${extId}/popup.html`);
  await page.waitForFunction(() => document.getElementById('status').textContent !== 'Looking for a video…');
  assert.deepEqual(errors, []);
  assert.match(await page.textContent('#key-pop-out'), /^(Alt\+Shift\+P|⌥⇧P)$/);
  await page.close();
});

// ---------- run ----------

let failed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n    ${e.message.split('\n').join('\n    ')}`);
  }
}
console.log(`\n${tests.length - failed} passed, ${failed} failed`);

await context.close();
for (const s of servers) s.close();
await rm(extDir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
