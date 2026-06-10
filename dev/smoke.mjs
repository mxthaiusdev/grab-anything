// Smoke test: loads the extension into a real Chromium via Playwright,
// right-clicks things on a local test page, and verifies that menu entries
// are built and that downloads actually happen through the real click handler.
//
// Run from the repo root:  node grab-anything/dev/smoke.mjs

import { createServer } from 'http';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

const HTML = `<!doctype html>
<html><head><title>Grab test</title>
<style>
@font-face { font-family: 'TestFont'; src: url('/font.woff2') format('woff2'); }
body { font-family: 'TestFont', sans-serif; }
.hero { background-image: url('/hero.jpg'); width: 300px; height: 100px; }
.topnav { background: #112233; display: flex; gap: 12px; padding: 10px; }
.topnav a { color: #fff; text-decoration: none; }
.topnav a:hover { color: tomato; }
@media (max-width: 600px) { .topnav { display: block; } }
</style></head>
<body>
<nav id="mainnav" class="topnav"><a href="/" class="brand">Brand</a><a href="/doc.pdf">Docs</a></nav>
<section class="hero"><h1>Big Hero</h1></section>
<section id="s2"><p class="inner">section two text</p></section>
<footer id="ftr" class="site-footer"><p>foot</p></footer>
<img id="logo" src="/logo.png" width="60" height="60">
<img id="resp" src="/logo.png" srcset="/logo.png 400w, /big-1600.png 1600w" sizes="40px" width="40" height="40">
<svg id="brand" width="50" height="50" viewBox="0 0 40 40"><circle cx="20" cy="20" r="18" fill="tomato"/></svg>
<div class="hero" id="hero">hero text</div>
<a id="doc" href="/doc.pdf">a document</a>
<video id="vid" src="/clip.mp4" width="120" height="60"></video>
<p id="text">some words to right-click on</p>
</body></html>`;

const requests = [];
const extraRoutes = {}; // routes added during the test run
const server = createServer((req, res) => {
  requests.push(req.url);
  const routes = {
    '/': ['text/html', HTML],
    '/logo.png': ['image/png', PNG],
    '/big-1600.png': ['image/png', PNG],
    '/photo-300x200.jpg': ['image/png', PNG],
    '/photo.jpg': ['image/png', PNG],
    '/hero.jpg': ['image/png', PNG],
    '/font.woff2': ['font/woff2', Buffer.from('wOF2fake')],
    '/clip.mp4': ['video/mp4', Buffer.from([0, 0, 0, 24])],
    '/doc.pdf': ['application/pdf', '%PDF-1.4 fake'],
  };
  const hit = routes[req.url] || extraRoutes[req.url];
  if (!hit) { res.statusCode = 404; res.end('nope'); return; }
  res.setHeader('content-type', hit[0]);
  res.end(hit[1]);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const results = [];
const check = (name, cond, detail = '') =>
  results.push({ name, ok: !!cond, detail });

const profile = mkdtempSync(path.join(tmpdir(), 'ga-profile-'));
let ctx;
try {
  ctx = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
} catch (e) {
  console.log('headless chromium channel failed (' + e.message.split('\n')[0] + '), retrying headed');
  ctx = await chromium.launchPersistentContext(profile, {
    headless: false,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
}

let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });

const page = await ctx.newPage();
const pageDownloads = [];
const downloadObjs = [];
page.on('download', (d) => { pageDownloads.push(d.suggestedFilename()); downloadObjs.push(d); });

await page.goto(BASE + '/');
await page.waitForTimeout(600);

const tabId = await sw.evaluate(async (base) => {
  const tabs = await chrome.tabs.query({});
  const tab = tabs.find((t) => (t.url || '').startsWith(base));
  return tab ? tab.id : -1;
}, BASE);
check('test tab visible to extension', tabId >= 0, 'tabId=' + tabId);

const swDownloads = () =>
  sw.evaluate(() => new Promise((res) => chrome.downloads.search({}, res)));

async function waitFor(fn, timeout = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

/* ---- 1. static item: image (the core "right-click an image" path) ---- */
await sw.evaluate(
  ({ tabId, url }) => onMenuClicked({ menuItemId: 'ga-image', srcUrl: url, frameId: 0 }, { id: tabId }),
  { tabId, url: BASE + '/logo.png' }
);
const imgDone = await waitFor(async () => {
  const items = await swDownloads();
  return items.find((i) => i.url.includes('/logo.png') && i.state === 'complete');
});
check('image download completes', imgDone, imgDone ? imgDone.filename : JSON.stringify(await swDownloads()));

/* ---- 2. static item: linked file ---- */
await sw.evaluate(
  ({ tabId, url }) => onMenuClicked({ menuItemId: 'ga-link', linkUrl: url, frameId: 0 }, { id: tabId }),
  { tabId, url: BASE + '/doc.pdf' }
);
const linkDone = await waitFor(async () => {
  const items = await swDownloads();
  return items.find((i) => i.url.includes('/doc.pdf') && i.state === 'complete');
});
check('linked file download completes', linkDone);

/* ---- 3. static item: selection as txt ---- */
await sw.evaluate(
  ({ tabId }) => onMenuClicked({ menuItemId: 'ga-selection', selectionText: 'hello grab', frameId: 0 }, { id: tabId }),
  { tabId }
);
const selDone = await waitFor(async () => {
  const items = await swDownloads();
  return items.find((i) => i.url.startsWith('data:text/plain') && i.state === 'complete');
});
check('selection download completes', selDone);

/* ---- 4. dynamic extras: right-click the inline SVG ---- */
await page.click('#brand', { button: 'right' });
await page.waitForTimeout(600);
let extras = await sw.evaluate(() =>
  [...extraEntries.entries()].map(([id, e]) => ({ id, kind: e.asset.kind, label: e.asset.label }))
);
const svgEntry = extras.find((e) => e.kind === 'svg');
check('svg extra appears in menu', svgEntry, JSON.stringify(extras));

if (svgEntry) {
  await sw.evaluate(
    ({ tabId, id }) => onMenuClicked({ menuItemId: id, frameId: 0 }, { id: tabId }),
    { tabId, id: svgEntry.id }
  );
  const svgDone = await waitFor(async () =>
    pageDownloads.find((f) => f.endsWith('.svg')) ||
    (await swDownloads()).find((i) => (i.filename || '').endsWith('.svg') && i.state === 'complete')
  );
  check('inline svg exports as .svg', svgDone, String(svgDone));
}

/* ---- 5. dynamic extras: webfont on text ---- */
await page.click('#text', { button: 'right' });
await page.waitForTimeout(600);
extras = await sw.evaluate(() =>
  [...extraEntries.entries()].map(([id, e]) => ({ id, kind: e.asset.kind, label: e.asset.label }))
);
const fontEntry = extras.find((e) => e.kind === 'font');
check('font extra appears in menu', fontEntry, JSON.stringify(extras));

if (fontEntry) {
  await sw.evaluate(
    ({ tabId, id }) => onMenuClicked({ menuItemId: id, frameId: 0 }, { id: tabId }),
    { tabId, id: fontEntry.id }
  );
  const fontDone = await waitFor(async () => {
    const items = await swDownloads();
    return items.find((i) => i.url.includes('/font.woff2') && i.state === 'complete');
  });
  check('webfont download completes', fontDone);
}

/* ---- 6. dynamic extras: background image ---- */
await page.click('#hero', { button: 'right' });
await page.waitForTimeout(600);
extras = await sw.evaluate(() =>
  [...extraEntries.entries()].map(([id, e]) => ({ id, kind: e.asset.kind, label: e.asset.label }))
);
const bgEntry = extras.find((e) => e.label.includes('Background image'));
check('background image extra appears', bgEntry, JSON.stringify(extras));

if (bgEntry) {
  await sw.evaluate(
    ({ tabId, id }) => onMenuClicked({ menuItemId: id, frameId: 0 }, { id: tabId }),
    { tabId, id: bgEntry.id }
  );
  const bgDone = await waitFor(async () => {
    const items = await swDownloads();
    return items.find((i) => i.url.includes('/hero.jpg') && i.state === 'complete');
  });
  check('background image download completes', bgDone);
}

/* ---- 7. page as HTML (content-script export path) ---- */
await sw.evaluate(
  ({ tabId, url }) => onMenuClicked({ menuItemId: 'ga-page', pageUrl: url, frameId: 0 }, { id: tabId }),
  { tabId, url: BASE + '/' }
);
const pageDone = await waitFor(async () =>
  pageDownloads.find((f) => f.endsWith('.html')) ||
  (await swDownloads()).find((i) => (i.filename || '').endsWith('.html') && i.state === 'complete')
);
check('page exports as .html', pageDone, String(pageDone));

/* ---- 8. settings defaults loaded in the worker ---- */
const defaultsOk = await sw.evaluate(() =>
  settings.toasts === true && settings.sniffer === true && settings.detectSvg === true && settings.subfolder === false
);
check('settings defaults loaded', defaultsOk);

/* ---- 9. sniffer captured the page's media ---- */
const sniffEntries = await sw.evaluate(async (id) => {
  const entries = await getSniffEntries(id);
  return entries.map((e) => ({ url: e.url, kind: e.kind }));
}, tabId);
check('sniffer captured the image', sniffEntries.some((e) => e.url.includes('/logo.png') && e.kind === 'image'), JSON.stringify(sniffEntries));
check('sniffer captured the font', sniffEntries.some((e) => e.url.includes('/font.woff2') && e.kind === 'font'), JSON.stringify(sniffEntries));

/* ---- 10. subfolder setting flows through to download naming ---- */
await sw.evaluate(() => chrome.storage.sync.set({ subfolder: true }));
await page.waitForTimeout(300);
const folderName = await sw.evaluate(() => withFolder('x.png'));
check('subfolder setting honoured', folderName === 'Grab Anything/x.png', folderName);
await sw.evaluate(
  ({ tabId, url }) => onMenuClicked({ menuItemId: 'ga-image', srcUrl: url, frameId: 0 }, { id: tabId }),
  { tabId, url: BASE + '/hero.jpg' }
);
const folderDone = await waitFor(async () => {
  const items = await swDownloads();
  return items.find((i) => i.url.includes('/hero.jpg') && i.state === 'complete');
});
check('download still completes with subfolder on', folderDone);
await sw.evaluate(() => chrome.storage.sync.set({ subfolder: false }));

/* ---- 11. lazy-load image detection ---- */
await page.evaluate(() => {
  const img = document.createElement('img');
  img.id = 'lazy';
  img.setAttribute('data-src', '/logo.png');
  img.width = 40; img.height = 40;
  document.body.appendChild(img);
});
await page.click('#lazy', { button: 'right' });
await page.waitForTimeout(600);
const lazyExtras = await sw.evaluate(() =>
  [...extraEntries.values()].map((e) => e.asset.label)
);
check('lazy image extra appears', lazyExtras.some((l) => l.includes('Image (logo.png')), JSON.stringify(lazyExtras));

/* ---- 12. full-resolution upgrade: URL pattern resolver ---- */
const candidates = await sw.evaluate(() => ({
  yt: bestImageCandidates('https://yt3.googleusercontent.com/ytc/AIdro_abc=s176-c-k-c0x00ffffff-no-rj'),
  thumb: bestImageCandidates('https://i.ytimg.com/vi/abc123/hqdefault.jpg'),
  wp: bestImageCandidates('https://example.com/uploads/photo-300x200.jpg'),
  tw: bestImageCandidates('https://pbs.twimg.com/profile_images/123/me_normal.jpg'),
}));
check('resolver: youtube avatar -> =s0', candidates.yt[0] && candidates.yt[0].endsWith('=s0'), JSON.stringify(candidates.yt));
check('resolver: yt thumb -> maxres', candidates.thumb[0] && candidates.thumb[0].includes('maxresdefault'), JSON.stringify(candidates.thumb));
check('resolver: wordpress size suffix stripped', candidates.wp[0] === 'https://example.com/uploads/photo.jpg', JSON.stringify(candidates.wp));
check('resolver: twitter _normal stripped', candidates.tw[0] && candidates.tw[0].endsWith('/me.jpg'), JSON.stringify(candidates.tw));

/* ---- 13. full-resolution upgrade end-to-end ---- */
await sw.evaluate(
  ({ tabId, url }) => onMenuClicked({ menuItemId: 'ga-image', srcUrl: url, frameId: 0 }, { id: tabId }),
  { tabId, url: BASE + '/photo-300x200.jpg' }
);
const upgraded = await waitFor(async () => {
  const items = await swDownloads();
  return items.find((i) => i.url.endsWith('/photo.jpg') && i.state === 'complete');
});
check('thumbnail upgraded to original before download', upgraded, JSON.stringify((await swDownloads()).map((i) => i.url)));

/* ---- 14. srcset largest-source extra ---- */
await page.click('#resp', { button: 'right' });
await page.waitForTimeout(600);
const respExtras = await sw.evaluate(() =>
  [...extraEntries.values()].map((e) => ({ label: e.asset.label, url: e.asset.url }))
);
check('largest srcset source offered', respExtras.some((e) => e.label.includes('Best-quality image') && e.url.includes('big-1600')), JSON.stringify(respExtras));

/* ---- 15. component extraction: navbar as HTML+CSS ---- */
await page.click('#mainnav .brand', { button: 'right' });
await page.waitForTimeout(600);
const navExtras = await sw.evaluate(() =>
  [...extraEntries.entries()].map(([id, e]) => ({ id, kind: e.asset.kind, label: e.asset.label }))
);
const compEntry = navExtras.find((e) => e.kind === 'component');
check('component extra appears for navbar', compEntry && compEntry.label.includes('navigation bar'), JSON.stringify(navExtras));

if (compEntry) {
  await sw.evaluate(
    ({ tabId, id }) => onMenuClicked({ menuItemId: id, frameId: 0 }, { id: tabId }),
    { tabId, id: compEntry.id }
  );
  const compDl = await waitFor(async () =>
    downloadObjs.find((d) => d.suggestedFilename() === 'mainnav.html')
  );
  check('component file downloads', compDl, pageDownloads.join(','));
  if (compDl) {
    const text = readFileSync(await compDl.path(), 'utf8');
    check('export contains the markup', text.includes('<nav') && text.includes('Brand'));
    check('export contains matched CSS', text.includes('.topnav') && text.includes('#112233'.replace('#', '')) || text.includes('rgb(17, 34, 51)') || text.includes('#112233'), text.slice(0, 200));
    check('export keeps hover state', text.includes(':hover'));
    check('export keeps media query', text.includes('@media'));
    check('export absolutizes links', text.includes(BASE + '/doc.pdf'));
  }
}

/* ---- 16. scoped extraction: component + enclosing section ---- */
await page.click('#s2 .inner', { button: 'right' });
await page.waitForTimeout(600);
const scopeExtras = await sw.evaluate(() =>
  [...extraEntries.values()].map((e) => e.asset.label)
);
check('section scope offered', scopeExtras.some((l) => l.includes('whole section')), JSON.stringify(scopeExtras));
check('page kit entry offered', scopeExtras.some((l) => l.includes('each section')), JSON.stringify(scopeExtras));

/* ---- 17. headless extract-kit API ---- */
const kit = await sw.evaluate(
  (id) => chrome.tabs.sendMessage(id, { type: 'ga-extract-kit' }, { frameId: 0 }),
  tabId
);
const kitNames = kit && kit.ok ? kit.parts.map((p) => p.name) : [];
check('kit finds header/hero/footer', ['full-page', 'header', 'hero', 'footer'].every((n) => kitNames.includes(n)), JSON.stringify(kitNames));
check('kit parts are standalone html', kit.ok && kit.parts.every((p) => p.html.includes('<style>') && p.html.startsWith('<!DOCTYPE')));

/* ---- 18. kit menu click -> per-site folder downloads ---- */
const kitEntry = await sw.evaluate(() =>
  [...extraEntries.entries()].find(([, e]) => e.asset.kind === 'kit')?.[0]
);
if (kitEntry) {
  await sw.evaluate(
    ({ tabId, id }) => onMenuClicked({ menuItemId: id, frameId: 0 }, { id: tabId }),
    { tabId, id: kitEntry }
  );
  // NB: Playwright renames downloads to GUIDs, so assert on the data: URL +
  // completion count rather than the target filename.
  const kitDls = await waitFor(async () => {
    const items = await swDownloads();
    const hits = items.filter((i) => i.url.startsWith('data:text/html') && i.state === 'complete');
    return hits.length >= 3 ? hits : null;
  });
  check('kit click downloads all parts', kitDls, kitDls ? kitDls.length + ' parts' : 'timeout');
} else {
  check('kit click downloads all parts', false, 'no kit menu entry');
}

/* ---- 19. stale-menu safety: unknown id must execute nothing ---- */
const beforeStale = (await swDownloads()).length;
await sw.evaluate(
  ({ tabId }) => onMenuClicked({ menuItemId: 'ga-x-deadbeef', frameId: 0 }, { id: tabId }),
  { tabId }
);
await page.waitForTimeout(1500);
const afterStale = (await swDownloads()).length;
check('stale menu id downloads nothing', beforeStale === afterStale, `${beforeStale} -> ${afterStale}`);

/* ---- 20. element picker: highlight, action bar, save design ---- */
await sw.evaluate(
  ({ tabId }) => chrome.tabs.sendMessage(tabId, { type: 'ga-picker-start' }, { frameId: 0 }),
  { tabId }
);
await page.waitForTimeout(300);
const logoBox = await page.locator('#logo').boundingBox();
await page.mouse.move(logoBox.x + 10, logoBox.y + 10);
await page.waitForTimeout(250);
const overlayOn = await page.evaluate(() => !!document.querySelector('[data-ga-picker]'));
check('picker overlay appears', overlayOn);

await page.mouse.click(logoBox.x + 10, logoBox.y + 10);
await page.waitForTimeout(250);
const barOn = await page.evaluate(() => !!document.querySelector('[data-ga-bar]'));
check('picker action bar appears on click', barOn);

await page.click('[data-ga-bar] [data-ga-action="design"]');
const pickedDesign = await waitFor(async () => pageDownloads.find((f) => f === 'logo.html'));
check('picker saves design of picked element', pickedDesign, pageDownloads.join(','));
const overlayGone = await page.evaluate(() => !document.querySelector('[data-ga-picker]'));
check('picker closes after action', overlayGone);

/* ---- 21. element screenshot via picker ---- */
await sw.evaluate(
  ({ tabId }) => chrome.tabs.sendMessage(tabId, { type: 'ga-picker-start' }, { frameId: 0 }),
  { tabId }
);
await page.waitForTimeout(250);
const svgBox = await page.locator('#brand').boundingBox();
await page.mouse.move(svgBox.x + 10, svgBox.y + 10);
await page.waitForTimeout(250);
await page.mouse.click(svgBox.x + 10, svgBox.y + 10);
await page.waitForTimeout(250);
await page.click('[data-ga-bar] [data-ga-action="shot"]');
const shotDone = await waitFor(async () => pageDownloads.find((f) => f === 'brand.png'), 12000);
check('picker element screenshot saves png', shotDone, pageDownloads.join(','));

/* ---- 22. Esc cancels picker ---- */
await sw.evaluate(
  ({ tabId }) => chrome.tabs.sendMessage(tabId, { type: 'ga-picker-start' }, { frameId: 0 }),
  { tabId }
);
await page.waitForTimeout(250);
await page.keyboard.press('Escape');
await page.waitForTimeout(150);
const escGone = await page.evaluate(() => !document.querySelector('[data-ga-picker]'));
check('Esc cancels picker', escGone);

/* ---- 23. webp auto-conversion to png ---- */
const webpB64 = await page.evaluate(() => {
  const c = document.createElement('canvas');
  c.width = 8; c.height = 8;
  const x = c.getContext('2d');
  x.fillStyle = '#ff0000';
  x.fillRect(0, 0, 8, 8);
  return c.toDataURL('image/webp').split(',')[1];
});
extraRoutes['/pic.webp'] = ['image/webp', Buffer.from(webpB64, 'base64')];
await sw.evaluate(
  ({ tabId, url }) => downloadImageSmart(url, tabId, 0),
  { tabId, url: BASE + '/pic.webp' }
);
const converted = await waitFor(async () => {
  const items = await swDownloads();
  return items.find((i) => i.url.startsWith('data:image/png') && i.state === 'complete');
});
check('webp auto-converts to png on save', converted);

/* ---- 24. palette + font cards + full-page screenshot ---- */
await sw.evaluate(({ tabId }) => chrome.tabs.sendMessage(tabId, { type: 'ga-palette' }, { frameId: 0 }), { tabId });
const paletteDone = await waitFor(async () => pageDownloads.find((f) => f.endsWith('-palette.png')), 10000);
check('palette card exports', paletteDone, pageDownloads.join(','));

await sw.evaluate(({ tabId }) => chrome.tabs.sendMessage(tabId, { type: 'ga-fontcard' }, { frameId: 0 }), { tabId });
const fontsDone = await waitFor(async () => pageDownloads.find((f) => f.endsWith('-fonts.png')), 10000);
check('font card exports', fontsDone, pageDownloads.join(','));

await sw.evaluate(({ tabId }) => chrome.tabs.sendMessage(tabId, { type: 'ga-fullshot' }, { frameId: 0 }), { tabId });
const fullshotDone = await waitFor(async () => pageDownloads.find((f) => f.endsWith('-page.png')), 15000);
check('full-page screenshot exports', fullshotDone, pageDownloads.join(','));

/* ---- report ---- */
console.log('\n=== Grab Anything smoke test ===');
let failed = 0;
for (const r of results) {
  console.log(`${r.ok ? '  PASS' : '✗ FAIL'}  ${r.name}${r.ok ? '' : '   ' + r.detail}`);
  if (!r.ok) failed++;
}
console.log(failed ? `\n${failed} FAILURES` : '\nall green');

await ctx.close();
server.close();
process.exit(failed ? 1 : 0);
