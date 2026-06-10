// Grab Anything — service worker.
//
// Three jobs:
//  1. Context menu: STATIC entries (image/video/audio/link/selection/page)
//     that Chrome targets natively, plus DYNAMIC "extras" (inline SVG,
//     background image, webfont, canvas) sent by the content script per
//     right-click.
//  2. Downloads with a fallback chain for hotlink-protected/CORS-blocked
//     files: plain download -> page-context fetch (referer+cookies) ->
//     worker fetch (no CORS) -> data-URL download.
//  3. Media sniffer: observes completed requests per tab so the toolbar
//     popup can list everything the page loaded. Local only.

const DEFAULTS = {
  subfolder: false,
  toasts: true,
  sniffer: true,
  detectFonts: true,
  detectBackgrounds: true,
  detectSvg: true,
  detectCanvas: true,
  detectComponents: true,
  convertImages: 'png', // webp/avif saved as: 'png' | 'jpg' | 'off'
};

let settings = Object.assign({}, DEFAULTS);
chrome.storage.sync.get(DEFAULTS).then((s) => Object.assign(settings, s)).catch(() => {});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  for (const key of Object.keys(changes)) settings[key] = changes[key].newValue;
});

/* ---------------- context menu ---------------- */

const t = (key, fallback) => {
  try { return chrome.i18n.getMessage(key) || fallback; } catch (_) { return fallback; }
};

const STATIC_ITEMS = [
  { id: 'ga-picker', title: t('menuPicker', 'Pick what to grab…'), contexts: ['all'] },
  { id: 'ga-image', title: t('menuImage', 'Download image'), contexts: ['image'] },
  { id: 'ga-video', title: t('menuVideo', 'Download video'), contexts: ['video'] },
  { id: 'ga-audio', title: t('menuAudio', 'Download audio'), contexts: ['audio'] },
  { id: 'ga-link', title: t('menuLink', 'Download linked file'), contexts: ['link'] },
  { id: 'ga-selection', title: t('menuSelection', 'Save selected text'), contexts: ['selection'] },
  { id: 'ga-page', title: t('menuPage', 'Save whole page'), contexts: ['page'] },
  { id: 'ga-shot-page', title: t('menuShotPage', 'Screenshot whole page'), contexts: ['page'] },
];

let extraEntries = new Map(); // menuItemId -> { asset, tabId, frameId }
let prevExtraIds = [];
let pending = new Map();      // downloadId  -> { asset, tabId, frameId }
let buildQueue = Promise.resolve();

function swallowError() { void chrome.runtime.lastError; }

function createMenu(props) {
  return new Promise((resolve) => {
    chrome.contextMenus.create(props, () => { swallowError(); resolve(); });
  });
}

function removeMenu(id) {
  return new Promise((resolve) => {
    chrome.contextMenus.remove(id, () => { swallowError(); resolve(); });
  });
}

function resetMenus() {
  return new Promise((resolve) => chrome.contextMenus.removeAll(resolve))
    .then(() => Promise.all(STATIC_ITEMS.map(createMenu)));
}

chrome.runtime.onInstalled.addListener((details) => {
  buildQueue = buildQueue.then(resetMenus).catch(() => {});
  injectIntoOpenTabs();
  if (details && details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') }).catch(() => {});
  }
});

// keyboard shortcut -> element picker
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'activate-picker') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.id >= 0) sendToTab(tab.id, { type: 'ga-picker-start' });
});

// send to the top frame, injecting the content script first if needed
async function sendToTab(tabId, msg) {
  try {
    await chrome.tabs.sendMessage(tabId, msg, { frameId: 0 });
  } catch (_) {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      await chrome.tabs.sendMessage(tabId, msg, { frameId: 0 });
    } catch (_) {}
  }
}

function bumpGrabCount() {
  chrome.storage.local.get({ grabCount: 0 }).then(({ grabCount }) =>
    chrome.storage.local.set({ grabCount: grabCount + 1 })
  ).catch(() => {});
}

chrome.runtime.onStartup.addListener(() => {
  buildQueue = buildQueue.then(resetMenus).catch(() => {});
});

// Make tabs that were already open before install work without a refresh.
async function injectIntoOpenTabs() {
  let tabs = [];
  try { tabs = await chrome.tabs.query({}); } catch (_) { return; }
  for (const tab of tabs) {
    if (!tab.id || !/^https?:/.test(tab.url || '')) continue;
    chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      files: ['content.js'],
    }).catch(() => {});
  }
}

// '&' is an accelerator marker in menu titles on Windows
const menuTitle = (s) => String(s).replace(/&/g, '&&');

async function getSniffEntries(tabId) {
  // merge what survived a worker restart (session) with what the current
  // worker has seen (live) — either alone can be a truncated view
  const stored = (await chrome.storage.session.get('sniff' + tabId))['sniff' + tabId] || [];
  const merged = new Map(stored.map((e) => [e.url, e]));
  const live = sniffed.get(tabId);
  if (live) for (const [url, e] of live) merged.set(url, e);
  if (merged.size) return [...merged.values()];
  // worker may have been asleep during page load — ask the page itself
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: 'ga-inventory' }, { frameId: 0 });
    if (res && res.entries && res.entries.length) return res.entries;
  } catch (_) {}
  return [];
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // from the popup (no sender.tab): live sniffer list, no debounce race
  if (msg.type === 'ga-sniff-get') {
    getSniffEntries(msg.tabId).then((entries) => sendResponse({ entries })).catch(() => sendResponse({ entries: [] }));
    return true;
  }

  // centralised downloads with upgrades (popup passes msg.tabId; the
  // picker's content script has sender.tab — keep it so the referer
  // fallback chain and failure toasts work)
  if (msg.type === 'ga-download') {
    const dlTab = sender.tab ? sender.tab.id : (Number.isInteger(msg.tabId) ? msg.tabId : -1);
    const dlFrame = sender.frameId || 0;
    if (msg.kind === 'image' && /^https?:/.test(msg.url)) {
      downloadImageSmart(msg.url, dlTab, dlFrame);
    } else {
      startDownload({ url: msg.url, filename: msg.filename }, dlTab, dlFrame);
    }
    return;
  }

  if (!sender.tab) return;

  // text payloads (page-kit parts) saved with folder structure
  if (msg.type === 'ga-save-text') {
    chrome.downloads.download({
      url: 'data:' + (msg.mime || 'text/plain') + ';base64,' + toBase64(new TextEncoder().encode(msg.text)),
      filename: withFolder(msg.filename || 'export.txt'),
      conflictAction: 'uniquify',
    }, swallowError);
    bumpGrabCount();
    return;
  }

  // screenshot service for the picker / full-page capture
  if (msg.type === 'ga-capture') {
    const winId = sender.tab ? sender.tab.windowId : chrome.windows.WINDOW_ID_CURRENT;
    const attempt = (tries) => {
      chrome.tabs.captureVisibleTab(winId, { format: 'png' }, (dataUrl) => {
        if (chrome.runtime.lastError || !dataUrl) {
          if (tries > 0) { setTimeout(() => attempt(tries - 1), 700); return; }
          sendResponse({ ok: false, error: chrome.runtime.lastError ? chrome.runtime.lastError.message : 'no data' });
          return;
        }
        sendResponse({ ok: true, dataUrl });
      });
    };
    attempt(2);
    return true;
  }

  if (msg.type === 'ga-menu') {
    const tabId = sender.tab.id;
    const frameId = sender.frameId || 0;
    buildQueue = buildQueue
      .then(() => rebuildExtras(msg.assets || [], tabId, frameId))
      .catch(() => {});
    return;
  }

  // Cross-origin stylesheet fetch for the font detector — the worker fetch
  // isn't subject to the page's CORS thanks to host_permissions.
  if (msg.type === 'ga-fetch-css') {
    fetch(msg.url)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error('HTTP ' + r.status))))
      .then((text) => sendResponse({ ok: true, text }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
});

async function rebuildExtras(assets, tabId, frameId) {
  // Clear previous extras — including ones from before a worker restart.
  let stale = prevExtraIds;
  if (!stale.length) {
    const { lastExtras } = await chrome.storage.session.get('lastExtras');
    if (lastExtras) stale = lastExtras.assets.map((a) => a.gaId).filter(Boolean);
  }
  await Promise.all(stale.map(removeMenu));
  prevExtraIds = [];
  extraEntries.clear();

  // Menu ids are content-addressed (hashed from the asset), so a click on a
  // stale menu snapshot either resolves to the exact same asset or to
  // nothing — never to a different entry.
  await Promise.all(assets.map((asset, i) => {
    const id = asset.gaId || 'ga-x-' + i;
    extraEntries.set(id, { asset, tabId, frameId });
    prevExtraIds.push(id);
    return createMenu({
      id,
      contexts: ['all'],
      title: menuTitle(asset.label),
      enabled: asset.enabled !== false,
    });
  }));
  await chrome.storage.session.set({ lastExtras: { assets, tabId, frameId } });
}

async function onMenuClicked(info, tab) {
  const tabId = tab && tab.id >= 0 ? tab.id : -1;
  const frameId = info.frameId || 0;

  switch (info.menuItemId) {
    case 'ga-picker':
      sendToTab(tabId, { type: 'ga-picker-start' });
      return;
    case 'ga-shot-page':
      sendToTab(tabId, { type: 'ga-fullshot' });
      return;
    case 'ga-image':
    case 'ga-video':
    case 'ga-audio': {
      if (!info.srcUrl) return;
      if (info.srcUrl.startsWith('blob:') && info.menuItemId !== 'ga-image') {
        notify(tabId, frameId, "This video is streamed in protected pieces — there's no single file to save.");
        return;
      }
      if (info.menuItemId === 'ga-image' && /^https?:/.test(info.srcUrl)) {
        downloadImageSmart(info.srcUrl, tabId, frameId);
        return;
      }
      startDownload({ url: info.srcUrl, filename: guessFilename(info.srcUrl) }, tabId, frameId);
      return;
    }
    case 'ga-link':
      if (info.linkUrl) {
        startDownload({ url: info.linkUrl, filename: guessFilename(info.linkUrl) }, tabId, frameId);
      }
      return;
    case 'ga-selection':
      chrome.downloads.download({
        url: 'data:text/plain;charset=utf-8,' + encodeURIComponent(info.selectionText || ''),
        filename: withFolder('selection.txt'),
        conflictAction: 'uniquify',
      }, swallowError);
      return;
    case 'ga-page': {
      try {
        const res = await chrome.tabs.sendMessage(tabId, { type: 'ga-grab', what: 'page' }, { frameId: 0 });
        if (res && res.ok) return;
      } catch (_) {}
      if (info.pageUrl && /^https?:/.test(info.pageUrl)) {
        startDownload({ url: info.pageUrl, filename: 'page.html' }, tabId, 0);
      }
      return;
    }
  }

  // Dynamic extras — looked up strictly by content-addressed id
  let entry = extraEntries.get(info.menuItemId);
  if (!entry) {
    const { lastExtras } = await chrome.storage.session.get('lastExtras');
    const hit = lastExtras && lastExtras.assets.find((a) => a.gaId === info.menuItemId);
    if (hit) entry = { asset: hit, tabId: lastExtras.tabId, frameId: lastExtras.frameId };
  }
  if (!entry) {
    notify(tabId, frameId, 'That menu was stale — right-click again and retry.');
    return;
  }
  if (entry.asset.enabled === false) return;

  const asset = entry.asset;
  if (asset.method === 'content') {
    // DOM-derived assets (inline SVG, canvas, blob images) are exported by
    // the content script itself.
    chrome.tabs.sendMessage(tabId, { type: 'ga-grab', gaId: asset.gaId, assetId: asset.id }, { frameId: entry.frameId })
      .catch(() => {});
    return;
  }
  if (asset.kind === 'image' && /^https?:/.test(asset.url)) {
    downloadImageSmart(asset.url, tabId, entry.frameId);
    return;
  }
  startDownload(asset, tabId, entry.frameId);
}
chrome.contextMenus.onClicked.addListener(onMenuClicked);

/* ---------------- full-resolution image upgrades ----------------
   Pages usually render a downscaled thumbnail while the original sits on
   the CDN behind a size parameter. Derive likely original URLs, verify
   they exist, and grab the best one. */

function bestImageCandidates(url) {
  const out = [];
  const add = (u) => { if (u && u !== url && !out.includes(u)) out.push(u); };
  try {
    const u = new URL(url);
    const host = u.hostname;
    const path = u.pathname;

    // Google image CDN (YouTube avatars/banners, Google profiles, Play, Photos)
    if (/(googleusercontent\.com|ggpht\.com)$/.test(host) && /=[swh]\d/.test(url)) {
      add(url.replace(/=[^=]*$/, '=s0'));
      add(url.replace(/=[^=]*$/, '=s2048'));
      add(url.replace(/=[^=]*$/, '=s800'));
    }

    // YouTube video thumbnails
    if (host === 'i.ytimg.com' && /\/[a-z]*default\.jpg/.test(path)) {
      add(url.replace(/\/[a-z]*default\.jpg/, '/maxresdefault.jpg'));
      add(url.replace(/\/[a-z]*default\.jpg/, '/sddefault.jpg'));
    }

    // Twitter / X
    if (host === 'pbs.twimg.com') {
      if (path.startsWith('/profile_images/')) {
        add(url.replace(/_(normal|bigger|mini|\d+x\d+)(\.[a-z]+)$/i, '$2'));
      }
      if (u.searchParams.has('name')) {
        const v = new URL(url);
        v.searchParams.set('name', 'orig');
        add(v.href);
      }
    }

    // Wikipedia / Wikimedia thumbnails
    if (/wikipedia\.org$|wikimedia\.org$/.test(host) && path.includes('/thumb/')) {
      add(u.origin + path.replace('/thumb', '').replace(/\/[^/]+$/, ''));
    }

    // WordPress "-300x200.jpg" / Shopify "_300x300.jpg" size suffixes
    if (/[-_]\d{2,4}x\d{2,4}\.[a-z]{3,4}(\?|#|$)/i.test(url)) {
      add(url.replace(/[-_]\d{2,4}x\d{2,4}(\.[a-z]{3,4})/i, '$1'));
    }

    // generic resize/quality query params
    const SIZE_PARAMS = ['w', 'h', 'width', 'height', 's', 'size', 'resize', 'fit', 'q', 'quality', 'dpr'];
    if (SIZE_PARAMS.some((p) => u.searchParams.has(p))) {
      const v = new URL(url);
      SIZE_PARAMS.forEach((p) => v.searchParams.delete(p));
      add(v.href);
    }
  } catch (_) {}
  return out;
}

async function probeImage(url) {
  try {
    let res = await fetch(url, { method: 'HEAD' });
    if (!res.ok) res = await fetch(url, { headers: { Range: 'bytes=0-0' } });
    if (!(res.ok || res.status === 206)) return false;
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    return !ct || ct.startsWith('image/') || ct === 'application/octet-stream';
  } catch (_) { return false; }
}

async function downloadImageSmart(url, tabId, frameId) {
  for (const candidate of bestImageCandidates(url)) {
    if (await probeImage(candidate)) {
      notify(tabId, frameId, 'Found a higher-resolution original — grabbing that instead.');
      await convertOrDownload(candidate, tabId, frameId);
      return;
    }
  }
  await convertOrDownload(url, tabId, frameId);
}

// Nobody wants .webp in their Downloads folder — re-encode locally.
async function maybeConvertImage(url) {
  const mode = settings.convertImages;
  if (!mode || mode === 'off') return null;
  if (!/\.(webp|avif)(\?|#|$)/i.test(url)) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    if (blob.size > 48 * 1024 * 1024) return null; // PNG re-encode can balloon — keep original
    const bmp = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    canvas.getContext('2d').drawImage(bmp, 0, 0);
    const out = await canvas.convertToBlob(
      mode === 'jpg' ? { type: 'image/jpeg', quality: 0.92 } : { type: 'image/png' }
    );
    if (out.size > 96 * 1024 * 1024) return null;
    const b64 = toBase64(new Uint8Array(await out.arrayBuffer()));
    const base = (guessFilename(url) || 'image').replace(/\.(webp|avif)$/i, '');
    return { url: 'data:' + out.type + ';base64,' + b64, filename: base + (mode === 'jpg' ? '.jpg' : '.png') };
  } catch (_) { return null; }
}

async function convertOrDownload(url, tabId, frameId) {
  const conv = await maybeConvertImage(url);
  if (conv) {
    chrome.downloads.download({
      url: conv.url,
      filename: withFolder(conv.filename),
      conflictAction: 'uniquify',
    }, (downloadId) => {
      if (chrome.runtime.lastError || downloadId === undefined) {
        // converted data-URL refused — fall back to the raw file's chain
        startDownload({ url, filename: guessFilename(url) }, tabId, frameId);
        return;
      }
      bumpGrabCount();
    });
    return;
  }
  startDownload({ url, filename: guessFilename(url) }, tabId, frameId);
}

/* ---------------- downloads ---------------- */

function guessFilename(url) {
  try {
    const u = new URL(url);
    const base = decodeURIComponent(u.pathname.split('/').pop() || '')
      .replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_')
      .replace(/^\.+/, '')
      .slice(0, 150);
    if (/\.[a-z0-9]{1,5}$/i.test(base)) return base;
  } catch (_) {}
  return undefined; // let Chrome name it from the response headers
}

function withFolder(name) {
  if (!settings.subfolder) return name;
  return 'Grab Anything/' + (name || 'download');
}

function startDownload(asset, tabId, frameId) {
  const opts = { url: asset.url, conflictAction: 'uniquify' };
  const name = withFolder(asset.filename || guessFilename(asset.url));
  if (name) opts.filename = name;
  chrome.downloads.download(opts, (downloadId) => {
    if (chrome.runtime.lastError || downloadId === undefined) {
      fallbackFetch(asset, tabId, frameId);
      return;
    }
    pending.set(downloadId, { asset, tabId, frameId });
  });
}

// Hotlink-protected CDNs 403 the bare request. Retry through the page
// (sends referer + cookies), then through a worker fetch (no CORS limits).
chrome.downloads.onChanged.addListener((delta) => {
  const entry = pending.get(delta.id);
  if (!entry) return;
  if (delta.state && delta.state.current === 'complete') {
    pending.delete(delta.id);
    bumpGrabCount();
    return;
  }
  if (delta.error && delta.error.current && delta.error.current !== 'USER_CANCELED') {
    pending.delete(delta.id);
    fallbackFetch(entry.asset, entry.tabId, entry.frameId);
  }
});

async function fallbackFetch(asset, tabId, frameId) {
  if (tabId >= 0) {
    try {
      const res = await chrome.tabs.sendMessage(
        tabId,
        { type: 'ga-fetch-save', url: asset.url, filename: asset.filename },
        { frameId }
      );
      if (res && res.ok) return;
    } catch (_) {}
  }

  try {
    const res = await fetch(asset.url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const buf = await res.arrayBuffer();
    if (buf.byteLength > 96 * 1024 * 1024) throw new Error('too large for data-URL fallback');
    const mime = (res.headers.get('content-type') || 'application/octet-stream').split(';')[0];
    chrome.downloads.download({
      url: 'data:' + mime + ';base64,' + toBase64(buf),
      filename: withFolder(asset.filename || 'download'),
      conflictAction: 'uniquify',
    }, swallowError);
  } catch (e) {
    console.warn('[Grab Anything] every download path failed for', asset.url, e);
    notify(tabId, frameId, "Couldn't download this — the site blocked every route.");
  }
}

function notify(tabId, frameId, text) {
  if (tabId < 0) return;
  chrome.tabs.sendMessage(tabId, { type: 'ga-toast', text }, { frameId }).catch(() => {});
}

function toBase64(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

/* ---------------- media sniffer (feeds the toolbar popup) ---------------- */

const sniffed = new Map(); // tabId -> Map(url -> entry)
const sniffTimers = new Map();
const SNIFF_CAP = 500;
const MEDIA_EXT = /\.(jpe?g|png|gif|webp|avif|svgz?|ico|bmp|mp4|webm|mkv|mov|m4v|mp3|m4a|aac|ogg|opus|wav|flac|woff2?|ttf|otf|eot|pdf|zip|vtt|srt)(\?|#|$)/i;

function classify(details) {
  const headers = details.responseHeaders || [];
  const ct = (headers.find((h) => h.name.toLowerCase() === 'content-type') || {}).value || '';
  const mime = ct.toLowerCase().split(';')[0];

  if (/mpegurl|dash\+xml/.test(mime) || /\.(m3u8|mpd)(\?|#|$)/i.test(details.url)) return ['stream', mime];
  if (details.type === 'image' || mime.startsWith('image/')) return ['image', mime];
  if (details.type === 'media' || mime.startsWith('video/') || mime.startsWith('audio/')) return ['media', mime];
  if (details.type === 'font' || mime.startsWith('font/') || /\.(woff2?|ttf|otf|eot)(\?|#|$)/i.test(details.url)) return ['font', mime];
  if (MEDIA_EXT.test(details.url)) return ['other', mime];
  return [null, mime];
}

function onRequestCompleted(details) {
  if (!settings.sniffer || details.tabId < 0) return;
  if (!/^https?:/.test(details.url)) return;

  const [kind] = classify(details);
  if (!kind) return;

  let tabMap = sniffed.get(details.tabId);
  if (!tabMap) {
    tabMap = new Map();
    sniffed.set(details.tabId, tabMap);
    // rehydrate entries that survived a worker restart, so the debounced
    // persist below doesn't overwrite the full list with a fresh sliver
    chrome.storage.session.get('sniff' + details.tabId).then((o) => {
      for (const e of o['sniff' + details.tabId] || []) {
        if (!tabMap.has(e.url) && tabMap.size < SNIFF_CAP) tabMap.set(e.url, e);
      }
    }).catch(() => {});
  }
  if (tabMap.size >= SNIFF_CAP && !tabMap.has(details.url)) return;

  const headers = details.responseHeaders || [];
  const len = parseInt((headers.find((h) => h.name.toLowerCase() === 'content-length') || {}).value, 10);
  tabMap.set(details.url, { url: details.url, kind, size: Number.isFinite(len) ? len : 0 });

  clearTimeout(sniffTimers.get(details.tabId));
  sniffTimers.set(details.tabId, setTimeout(() => {
    const m = sniffed.get(details.tabId);
    if (!m) return;
    chrome.storage.session.set({ ['sniff' + details.tabId]: [...m.values()] }).catch(() => {});
  }, 400));
}

chrome.webRequest.onCompleted.addListener(
  onRequestCompleted,
  { urls: ['http://*/*', 'https://*/*'] },
  ['responseHeaders']
);

function clearSniffed(tabId) {
  sniffed.delete(tabId);
  clearTimeout(sniffTimers.get(tabId));
  sniffTimers.delete(tabId);
  chrome.storage.session.remove('sniff' + tabId).catch(() => {});
}

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading') clearSniffed(tabId);
});
chrome.tabs.onRemoved.addListener(clearSniffed);
