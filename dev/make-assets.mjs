// Generates icons and Chrome Web Store art by rendering SVG/HTML in
// Chromium and screenshotting. Run from repo root: node grab-anything/dev/make-assets.mjs

import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(path.join(ROOT, 'icons'), { recursive: true });
mkdirSync(path.join(ROOT, 'store'), { recursive: true });

const iconSvg = (s) => `<svg width="${s}" height="${s}" viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#6366F1"/><stop offset="1" stop-color="#06B6D4"/>
  </linearGradient></defs>
  <rect x="4" y="4" width="120" height="120" rx="28" fill="url(#g)"/>
  <path d="M64 28 v36" stroke="#fff" stroke-width="13" stroke-linecap="round"/>
  <path d="M42 50 L64 74 L86 50" stroke="#fff" stroke-width="13" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <path d="M38 96 h52" stroke="#fff" stroke-width="13" stroke-linecap="round"/>
</svg>`;

const browser = await chromium.launch();
const page = await browser.newPage();

for (const size of [16, 32, 48, 128]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<body style="margin:0">${iconSvg(size)}</body>`);
  const buf = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  writeFileSync(path.join(ROOT, 'icons', `icon-${size}.png`), buf);
  console.log(`icons/icon-${size}.png`);
}

// ---- 440x280 small promo tile ----
await page.setViewportSize({ width: 440, height: 280 });
await page.setContent(`<body style="margin:0;width:440px;height:280px;display:flex;align-items:center;justify-content:center;gap:26px;background:linear-gradient(135deg,#0f172a,#1e293b);font-family:-apple-system,system-ui,sans-serif">
  ${iconSvg(96)}
  <div>
    <div style="color:#fff;font-size:30px;font-weight:700;letter-spacing:-.5px">Grab Anything</div>
    <div style="color:#94a3b8;font-size:15px;margin-top:8px;line-height:1.5">Right-click &rarr; download anything.<br>Images, SVG logos, fonts, video.</div>
  </div>
</body>`);
writeFileSync(path.join(ROOT, 'store', 'promo-440x280.png'), await page.screenshot());
console.log('store/promo-440x280.png');

// ---- 1280x800 listing screenshot (explainer) ----
await page.setViewportSize({ width: 1280, height: 800 });
await page.setContent(`<body style="margin:0;width:1280px;height:800px;background:linear-gradient(160deg,#0f172a,#1e3a5f);font-family:-apple-system,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;gap:70px">
  <!-- mock page -->
  <div style="width:520px;background:#fff;border-radius:14px;box-shadow:0 30px 80px rgba(0,0,0,.45);overflow:hidden">
    <div style="height:34px;background:#f1f5f9;display:flex;align-items:center;gap:6px;padding:0 14px">
      <span style="width:11px;height:11px;border-radius:50%;background:#fca5a5"></span>
      <span style="width:11px;height:11px;border-radius:50%;background:#fcd34d"></span>
      <span style="width:11px;height:11px;border-radius:50%;background:#86efac"></span>
    </div>
    <div style="padding:34px 38px">
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:22px">
        <svg width="44" height="44" viewBox="0 0 40 40"><circle cx="20" cy="20" r="18" fill="#f97316"/><path d="M12 20 l6 6 10-12" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <div style="font-size:21px;font-weight:700;color:#0f172a">Acme Studio</div>
      </div>
      <div style="height:14px;background:#e2e8f0;border-radius:7px;width:88%;margin:10px 0"></div>
      <div style="height:14px;background:#e2e8f0;border-radius:7px;width:72%;margin:10px 0"></div>
      <div style="height:150px;background:linear-gradient(120deg,#c7d2fe,#a5f3fc);border-radius:10px;margin-top:20px"></div>
    </div>
  </div>
  <!-- mock context menu -->
  <div style="width:340px;background:#fff;border-radius:12px;box-shadow:0 24px 70px rgba(0,0,0,.5);padding:8px 0;font-size:16.5px;color:#1e293b">
    <div style="padding:9px 18px;color:#94a3b8">Back</div>
    <div style="padding:9px 18px;color:#94a3b8">Reload</div>
    <div style="height:1px;background:#e2e8f0;margin:6px 0"></div>
    <div style="padding:9px 18px;display:flex;align-items:center;gap:11px;background:#eef2ff;font-weight:600">${iconSvg(20)} Download image</div>
    <div style="padding:9px 18px;display:flex;align-items:center;gap:11px">${iconSvg(20)} Pick what to grab…</div>
    <div style="padding:9px 18px;display:flex;align-items:center;gap:11px">${iconSvg(20)} Font used here: Inter</div>
    <div style="padding:9px 18px;display:flex;align-items:center;gap:11px">${iconSvg(20)} Background image (hero.jpg)</div>
    <div style="padding:9px 18px;display:flex;align-items:center;gap:11px">${iconSvg(20)} Save design: navigation bar</div>
    <div style="height:1px;background:#e2e8f0;margin:6px 0"></div>
    <div style="padding:9px 18px;color:#94a3b8">Inspect</div>
  </div>
</body>`);
writeFileSync(path.join(ROOT, 'store', 'screenshot-1280x800.png'), await page.screenshot());
console.log('store/screenshot-1280x800.png');

await browser.close();
console.log('all assets written');
