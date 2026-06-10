// Real-world component extraction demo: grab github.com's header nav as a
// standalone HTML+CSS file, then render the export and screenshot it.
// Run from repo root: node grab-anything/dev/component-demo.mjs

import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profile = mkdtempSync(path.join(tmpdir(), 'ga-comp-'));

const ctx = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});

let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });

const page = await ctx.newPage();
const downloads = [];
page.on('download', (d) => downloads.push(d));

await page.goto('https://github.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(1500);

await page.locator('header nav a, header a').first().click({ button: 'right', force: true });
await page.waitForTimeout(900);

const extras = await sw.evaluate(() =>
  [...extraEntries.entries()].map(([id, e]) => ({ id, kind: e.asset.kind, label: e.asset.label }))
);
console.log('extras:', extras.map((e) => e.label).join(' | '));

const comp = extras.find((e) => e.kind === 'component');
if (!comp) { console.log('FAIL: no component extra'); process.exit(1); }

const tabId = await sw.evaluate(async () => {
  const tabs = await chrome.tabs.query({});
  return tabs.find((t) => (t.url || '').includes('github.com')).id;
});
await sw.evaluate(
  ({ tabId, id }) => onMenuClicked({ menuItemId: id, frameId: 0 }, { id: tabId }),
  { tabId, id: comp.id }
);

const start = Date.now();
while (!downloads.length && Date.now() - start < 15000) await page.waitForTimeout(300);
if (!downloads.length) { console.log('FAIL: no download'); process.exit(1); }

const file = await downloads[0].path();
const text = readFileSync(file, 'utf8');
console.log(`exported: ${downloads[0].suggestedFilename()} (${Math.round(text.length / 1024)} KB, ` +
  `${(text.match(/\{/g) || []).length} css blocks)`);

const out = path.join(tmpdir(), 'ga-component-export.html');
writeFileSync(out, text);

const view = await ctx.newPage();
await view.setViewportSize({ width: 1280, height: 300 });
await view.goto('file://' + out);
await view.waitForTimeout(1200);
await view.screenshot({ path: path.join(EXT, 'dev', 'component-render.png') });
console.log('render screenshot: dev/component-render.png');

await ctx.close();
