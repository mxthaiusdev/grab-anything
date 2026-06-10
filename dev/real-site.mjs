// Real-world check: load github.com, right-click its inline SVG logo,
// confirm extras get collected on a heavy production page and the SVG
// actually exports. Run from repo root: node grab-anything/dev/real-site.mjs

import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profile = mkdtempSync(path.join(tmpdir(), 'ga-real-'));

const ctx = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});

let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });

const page = await ctx.newPage();
const downloads = [];
page.on('download', (d) => downloads.push(d.suggestedFilename()));

await page.goto('https://github.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(1500);

// right-click the header logo (inline SVG)
const logo = page.locator('header svg').first();
await logo.click({ button: 'right', force: true });
await page.waitForTimeout(800);

const extras = await sw.evaluate(() =>
  [...extraEntries.entries()].map(([id, e]) => ({ id, kind: e.asset.kind, label: e.asset.label }))
);
console.log('extras on github.com logo right-click:', JSON.stringify(extras, null, 2));

const tabId = await sw.evaluate(async () => {
  const tabs = await chrome.tabs.query({});
  return tabs.find((t) => (t.url || '').includes('github.com')).id;
});

const svgEntry = extras.find((e) => e.kind === 'svg');
if (svgEntry) {
  await sw.evaluate(
    ({ tabId, id }) => onMenuClicked({ menuItemId: id, frameId: 0 }, { id: tabId }),
    { tabId, id: svgEntry.id }
  );
  await page.waitForTimeout(2500);
  console.log('downloads after svg export:', downloads);
  console.log(downloads.some((f) => f.endsWith('.svg')) ? 'PASS: real-site svg export' : 'FAIL: no svg download');
} else {
  console.log('FAIL: no svg extra found on github logo');
}

// also exercise the static image path with a real CDN avatar URL
await sw.evaluate(
  ({ tabId }) => onMenuClicked(
    { menuItemId: 'ga-image', srcUrl: 'https://avatars.githubusercontent.com/u/9919?s=200&v=4', frameId: 0 },
    { id: tabId }
  ),
  { tabId }
);
const avatarOk = await sw.evaluate(() => new Promise((res) => {
  const start = Date.now();
  (function poll() {
    chrome.downloads.search({}, (items) => {
      const hit = items.find((i) => i.url.includes('avatars.githubusercontent'));
      if (hit && hit.state === 'complete') return res('complete: ' + hit.filename);
      if (Date.now() - start > 8000) return res('timeout: ' + JSON.stringify(items.map(i => ({url: i.url.slice(0, 60), state: i.state, error: i.error}))));
      setTimeout(poll, 300);
    });
  })();
}));
console.log('avatar (extensionless CDN URL):', avatarOk);

await ctx.close();
