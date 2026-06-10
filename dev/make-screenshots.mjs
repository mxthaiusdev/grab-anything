// Generates REAL store screenshots (1280x800): the picker in action on a
// demo page, and the gallery popup with live thumbnails.
// Run from repo root: node grab-anything/dev/make-screenshots.mjs

import { createServer } from 'http';
import { mkdtempSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STORE = path.join(EXT, 'store');

const DEMO = `<!doctype html><html><head><title>Atelier North</title><style>
  * { margin: 0; box-sizing: border-box; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #1d1d1f; background: #faf8f5; }
  nav { display: flex; justify-content: space-between; align-items: center; padding: 22px 56px; background: #faf8f5; border-bottom: 1px solid #e8e2d9; }
  .logo { font-size: 22px; letter-spacing: 2px; font-weight: 700; }
  nav .links { display: flex; gap: 30px; font-family: -apple-system, sans-serif; font-size: 14px; color: #6b6257; }
  .hero { display: grid; grid-template-columns: 1.1fr 1fr; gap: 48px; padding: 64px 56px; align-items: center; }
  .hero h1 { font-size: 52px; line-height: 1.12; font-weight: 400; }
  .hero p { margin-top: 18px; font-family: -apple-system, sans-serif; font-size: 16px; line-height: 1.7; color: #6b6257; max-width: 42ch; }
  .hero .cta { display: inline-block; margin-top: 28px; background: #1d1d1f; color: #faf8f5; padding: 14px 28px; font-family: -apple-system, sans-serif; font-size: 14px; letter-spacing: 1px; }
  .card { border-radius: 4px; overflow: hidden; box-shadow: 0 24px 60px rgba(70,55,35,0.18); }
  .card img { width: 100%; display: block; }
</style></head><body>
<nav><span class="logo">ATELIER NORTH</span><span class="links"><span>Collection</span><span>Journal</span><span>About</span><span>Contact</span></span></nav>
<div class="hero">
  <div><h1>Furniture built for a hundred years.</h1>
  <p>Small-batch pieces in oak and ash, joined by hand in our Yorkshire workshop. No screws, no shortcuts, no landfill.</p>
  <span class="cta">EXPLORE THE COLLECTION</span></div>
  <div class="card"><img id="heroimg" src="/img1.png" width="560" height="420" alt=""></div>
</div>
</body></html>`;

// colorful generated "photos" for thumbnails
function makeImageRoutes(page) {
  return page.evaluate(() => {
    const palettes = [
      ['#D4A373', '#FAEDCD'], ['#457B9D', '#A8DADC'], ['#6D6875', '#FFCDB2'],
      ['#2A9D8F', '#E9C46A'], ['#9A8C98', '#F2E9E4'], ['#588157', '#DAD7CD'],
      ['#BC6C25', '#FEFAE0'], ['#3D405B', '#F2CC8F'], ['#81667A', '#D6CFCB'],
      ['#1D3557', '#F1FAEE'], ['#7F5539', '#EDE0D4'], ['#386641', '#A7C957'],
    ];
    return palettes.map(([a, b], i) => {
      const c = document.createElement('canvas');
      c.width = 560; c.height = 420;
      const x = c.getContext('2d');
      const g = x.createLinearGradient(0, 0, 560, 420);
      g.addColorStop(0, a); g.addColorStop(1, b);
      x.fillStyle = g; x.fillRect(0, 0, 560, 420);
      x.fillStyle = 'rgba(255,255,255,0.25)';
      x.beginPath(); x.arc(140 + (i * 37) % 280, 120 + (i * 53) % 180, 70 + (i * 11) % 60, 0, 7); x.fill();
      x.fillStyle = 'rgba(0,0,0,0.12)';
      x.fillRect(60 + (i * 23) % 200, 220, 180, 90);
      return c.toDataURL('image/png').split(',')[1];
    });
  });
}

const routes = { '/': ['text/html', DEMO] };
const server = createServer((req, res) => {
  const hit = routes[req.url];
  if (!hit) { res.statusCode = 404; res.end(); return; }
  res.setHeader('content-type', hit[0]);
  res.end(hit[1]);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const ctx = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'ga-shots-')), {
  channel: 'chromium',
  viewport: { width: 1280, height: 800 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });

const page = await ctx.newPage();
await page.goto('about:blank');
const imgs = await makeImageRoutes(page);
imgs.forEach((b64, i) => { routes[`/img${i + 1}.png`] = ['image/png', Buffer.from(b64, 'base64')]; });

await page.goto(BASE + '/');
await page.waitForTimeout(800);
const tabId = await sw.evaluate(async (base) => {
  const tabs = await chrome.tabs.query({});
  return tabs.find((t) => (t.url || '').startsWith(base)).id;
}, BASE);

/* ---- shot 1: picker in action (frozen, action bar showing) ---- */
await sw.evaluate((id) => chrome.tabs.sendMessage(id, { type: 'ga-picker-start' }, { frameId: 0 }), tabId);
await page.waitForTimeout(300);
const card = await page.locator('.card').boundingBox();
await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2);
await page.waitForTimeout(300);
await page.mouse.click(card.x + card.width / 2, card.y + card.height / 2);
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(STORE, 'screenshot-picker.png') });
console.log('store/screenshot-picker.png');
await page.keyboard.press('Escape');

/* ---- shot 2: gallery popup with live thumbnails ---- */
// our tabs.onUpdated handler clears sniffed data on navigation — disable it
// while we seed the demo entries
await sw.evaluate(() => { clearSniffed = () => {}; });
const popupPage = await ctx.newPage();
await popupPage.goto('chrome-extension://' + new URL(sw.url()).host + '/popup.html');
const popupTabId = await sw.evaluate(async () => {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0].id;
});
await sw.evaluate(({ id, base }) => {
  const entries = [];
  for (let i = 1; i <= 12; i++) entries.push({ url: `${base}/img${i}.png`, kind: 'image', size: 41000 + i * 1311 });
  entries.push({ url: base + '/intro.mp4', kind: 'media', size: 8400000 });
  entries.push({ url: base + '/serif-display.woff2', kind: 'font', size: 91000 });
  const m = new Map(entries.map((e) => [e.url, e]));
  sniffed.set(id, m);
  return chrome.storage.session.set({ ['sniff' + id]: entries });
}, { id: popupTabId, base: BASE });
await popupPage.reload();
await popupPage.waitForTimeout(1200);
const body = await popupPage.locator('body').boundingBox();
const popupShot = await popupPage.screenshot({ clip: { x: 0, y: 0, width: 462, height: Math.min(580, body.height) } });
writeFileSync('/tmp/ga-popup-raw.png', popupShot);

// compose onto a 1280x800 frame
const composer = await ctx.newPage();
await composer.setViewportSize({ width: 1280, height: 800 });
const popupB64 = readFileSync('/tmp/ga-popup-raw.png').toString('base64');
await composer.setContent(`<body style="margin:0;width:1280px;height:800px;display:flex;align-items:center;justify-content:center;gap:64px;background:linear-gradient(135deg,#0f172a,#1e3a5f);font-family:-apple-system,sans-serif">
  <div style="color:#fff;max-width:360px">
    <div style="font-size:34px;font-weight:700;line-height:1.25">Every file the page loaded.<br>One ZIP.</div>
    <div style="margin-top:14px;font-size:17px;color:#94a3b8;line-height:1.6">The popup lists every image, video and font a page fetched — even ones JavaScript loaded behind the scenes. Select a few or grab them all.</div>
  </div>
  <img src="data:image/png;base64,${popupB64}" style="width:430px;border-radius:14px;box-shadow:0 30px 80px rgba(0,0,0,.5)">
</body>`);
await composer.waitForTimeout(400);
await composer.screenshot({ path: path.join(STORE, 'screenshot-gallery.png') });
console.log('store/screenshot-gallery.png');

await ctx.close();
server.close();
console.log('done');
