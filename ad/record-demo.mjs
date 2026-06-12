// Records the REAL extension picker grabbing a logo + a whole section on a
// clean demo site, with a visible animated cursor (Playwright's real pointer
// isn't rendered in video). Output: a .webm in ad/
// Run from repo root: node grab-anything/ad/record-demo.mjs

import { mkdtempSync, mkdirSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, '..');
const OUT = path.join(HERE);
mkdirSync(OUT, { recursive: true });
const W = 1280, H = 800;

// content scripts don't inject into file:// — serve over http
const html = readFileSync(path.join(HERE, 'demo-site.html'), 'utf8');
const server = createServer((q, s) => { s.setHeader('content-type', 'text/html'); s.end(html); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const DEMO = `http://127.0.0.1:${server.address().port}/`;

const ctx = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'ga-ad-')), {
  channel: 'chromium',
  viewport: { width: W, height: H },
  deviceScaleFactor: 2,
  permissions: ['clipboard-read', 'clipboard-write'],
  recordVideo: { dir: OUT, size: { width: W, height: H } },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--force-device-scale-factor=2'],
});
let sw = ctx.serviceWorkers()[0];
if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });

await new Promise((r) => setTimeout(r, 800)); // let the onboarding tab open
const page = await ctx.newPage();
await page.goto(DEMO);
await page.waitForTimeout(1200); // let the content script inject
// close every other page (onboarding, default blank) so only the demo records
for (const p of ctx.pages()) { if (p !== page) await p.close().catch(() => {}); }

// inject a visible cursor that follows the real mouse
await page.addStyleTag({ content: `
  #ad-cursor { position: fixed; z-index: 2147483647; left: 0; top: 0; width: 30px; height: 30px;
    pointer-events: none; transform: translate(-3px,-2px); filter: drop-shadow(0 2px 4px rgba(0,0,0,.4)); }
` });
await page.evaluate(() => {
  const c = document.createElement('div');
  c.id = 'ad-cursor';
  c.innerHTML = '<svg viewBox="0 0 24 24" width="30" height="30"><path d="M5 3 L19 12 L12 13 L9 20 Z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  document.documentElement.appendChild(c);
  window.addEventListener('mousemove', (e) => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
});

const tabId = await sw.evaluate(async (base) => {
  const tabs = await chrome.tabs.query({});
  const t = tabs.find((x) => (x.url || '').startsWith(base));
  return t ? t.id : -1;
}, DEMO);
if (tabId < 0) throw new Error('demo tab not found');
const startPicker = () => sw.evaluate((id) => chrome.tabs.sendMessage(id, { type: 'ga-picker-start' }, { frameId: 0 }), tabId);

async function glide(x, y, steps = 36) { await page.mouse.move(x, y, { steps }); }
const centerOf = async (sel) => { const b = await page.locator(sel).boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2, b]; };
const wait = (ms) => page.waitForTimeout(ms);

await glide(W / 2, H / 2, 4);
await wait(700);

/* ---- Beat 1: grab the logo as SVG ---- */
await startPicker();
await wait(300);
{
  const [x, y] = await centerOf('#brandLogo svg');
  await glide(x, y, 44);
  await wait(900);
  await page.mouse.down(); await page.mouse.up();
  await wait(700);
  const [bx, by] = await centerOf('[data-ga-action="copy-svg"]');
  await glide(bx, by, 26);
  await wait(450);
  await page.mouse.down(); await page.mouse.up();
  await wait(1700);
}

/* ---- Beat 2: grab the whole hero section (scroll to widen) ---- */
await startPicker();
await wait(300);
{
  const [x, y] = await centerOf('h1');
  await glide(x, y, 40);
  await wait(700);
  await page.mouse.wheel(0, -260);
  await wait(500);
  await page.mouse.wheel(0, -260);
  await wait(900);
  await page.mouse.down(); await page.mouse.up();
  await wait(700);
  const [bx, by] = await centerOf('[data-ga-action="design"]');
  await glide(bx, by, 24);
  await wait(400);
  await page.mouse.down(); await page.mouse.up();
  await wait(1800);
}

const vid = page.video();
await page.close();
await ctx.close();
server.close();
const finalPath = await vid.path();
console.log('DEMO_VIDEO=' + finalPath);
