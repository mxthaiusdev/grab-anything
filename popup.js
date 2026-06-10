// Toolbar popup — power actions plus a gallery of everything the page
// loaded (from the webRequest sniffer), with multi-select ZIP export.

// resolves to the real listing once published (runtime.id == store id)
const STORE_URL = 'https://chromewebstore.google.com/detail/' + chrome.runtime.id;

const t = (key, fallback) => {
  try { return chrome.i18n.getMessage(key) || fallback; } catch (_) { return fallback; }
};

const GROUPS = [
  ['media', t('groupMedia', 'Video & audio')],
  ['stream', t('groupStreams', 'Stream playlists (advanced)')],
  ['font', t('groupFonts', 'Fonts')],
  ['other', t('groupOther', 'Other files')],
];

const leaf = (url) => {
  try {
    const u = new URL(url);
    return decodeURIComponent(u.pathname.split('/').pop() || '') || u.hostname;
  } catch (_) { return url.slice(0, 60); }
};

const safeName = (s) =>
  (s || '').replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').replace(/^\.+/, '').slice(0, 150) || 'file';

const fmtSize = (n) => {
  if (!n) return '';
  return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
};

const extFromType = (ct) => {
  const map = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif',
    'image/svg+xml': '.svg', 'image/avif': '.avif', 'font/woff2': '.woff2', 'video/mp4': '.mp4', 'audio/mpeg': '.mp3' };
  return map[(ct || '').split(';')[0]] || '';
};

const status = (t) => { document.getElementById('status').textContent = t; };

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const host = (() => { try { return new URL(tab.url).hostname.replace(/^www\./, ''); } catch (_) { return 'page'; } })();
  document.getElementById('host').textContent = host;

  /* ---- toolbar power actions ---- */
  const sendAction = (type) => async () => {
    try {
      await chrome.tabs.sendMessage(tab.id, { type }, { frameId: 0 });
      window.close();
    } catch (_) {
      status(t('noAccess', 'This page does not allow extensions (try a normal website).'));
    }
  };
  document.getElementById('btnPick').addEventListener('click', sendAction('ga-picker-start'));
  document.getElementById('btnShot').addEventListener('click', sendAction('ga-fullshot'));
  document.getElementById('btnPalette').addEventListener('click', sendAction('ga-palette'));
  document.getElementById('btnFonts').addEventListener('click', sendAction('ga-fontcard'));

  /* ---- review banner ---- */
  const { grabCount = 0, reviewDismissed = false } = await chrome.storage.local.get(['grabCount', 'reviewDismissed']);
  if (grabCount >= 5 && !reviewDismissed) {
    const banner = document.getElementById('banner');
    banner.style.display = 'flex';
    document.getElementById('rateLink').href = STORE_URL;
    document.getElementById('bannerX').addEventListener('click', () => {
      chrome.storage.local.set({ reviewDismissed: true });
      banner.style.display = 'none';
    });
  }

  /* ---- sniffer entries ---- */
  let entries = [];
  try {
    const res = await chrome.runtime.sendMessage({ type: 'ga-sniff-get', tabId: tab ? tab.id : -1 });
    entries = (res && res.entries) || [];
  } catch (_) {}

  const list = document.getElementById('list');
  if (!entries.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.append(t('popupEmptyTitle', 'Nothing captured on this page yet.'), document.createElement('br'), t('popupEmptyBody', 'Reload the page, then reopen this popup.'));
    list.append(empty);
    return;
  }

  const download = (url, name, kind) => {
    try {
      const p = chrome.runtime.sendMessage({ type: 'ga-download', url, filename: name, kind, tabId: tab ? tab.id : -1 });
      if (p && p.catch) p.catch(() => {});
    } catch (_) {}
  };

  async function zipAndDownload(items, zipName) {
    const entriesZ = [];
    const used = new Set();
    let done = 0;
    for (const it of items) {
      status(t('statusFetching', 'Fetching') + ' ' + (++done) + '/' + items.length + '…');
      try {
        const res = await fetch(it.url);
        if (!res.ok) continue;
        const buf = new Uint8Array(await res.arrayBuffer());
        let name = safeName(leaf(it.url)).slice(-80);
        if (!/\./.test(name)) name += extFromType(res.headers.get('content-type')) || '.bin';
        let candidate = name;
        let i = 1;
        while (used.has(candidate)) candidate = i++ + '-' + name;
        used.add(candidate);
        entriesZ.push({ name: candidate, data: buf });
      } catch (_) {}
    }
    if (!entriesZ.length) { status(t('statusNothing', 'Nothing could be fetched.')); return; }
    status(t('statusZipping', 'Zipping') + ' ' + entriesZ.length + '…');
    const blob = GrabZip.buildZip(entriesZ);
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({ url, filename: zipName, conflictAction: 'uniquify' }, (downloadId) => {
      if (chrome.runtime.lastError || downloadId === undefined) {
        status(t('statusNothing', 'Nothing could be fetched.'));
        return;
      }
      status(t('statusSaved', 'Saved') + ': ' + zipName + ' (' + entriesZ.length + ')');
    });
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  /* ---- image gallery ---- */
  const images = entries.filter((e) => e.kind === 'image');
  if (images.length) {
    const group = document.createElement('div');
    group.className = 'group';
    const h = document.createElement('h2');
    h.textContent = t('groupImages', 'Images') + ' · ' + images.length;
    group.append(h);

    const grid = document.createElement('div');
    grid.className = 'grid';
    const selected = new Set();

    for (const e of images) {
      const cell = document.createElement('div');
      cell.className = 'thumb';
      cell.title = leaf(e.url) + (e.size ? ' · ' + fmtSize(e.size) : '');
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.src = e.url;
      img.addEventListener('error', () => {
        cell.remove();
        if (selected.has(e)) {
          selected.delete(e);
          zipSel.textContent = t('zipSelected', 'ZIP selected') + (selected.size ? ' (' + selected.size + ')' : '');
          zipSel.disabled = !selected.size;
        }
      });
      const tick = document.createElement('span');
      tick.className = 'tick';
      tick.textContent = '✓';
      const dl = document.createElement('button');
      dl.className = 'dl';
      dl.textContent = '↓';
      dl.addEventListener('click', (ev) => { ev.stopPropagation(); download(e.url, safeName(leaf(e.url)), 'image'); });
      cell.append(img, tick, dl);
      cell.addEventListener('click', () => {
        if (selected.has(e)) { selected.delete(e); cell.classList.remove('sel'); }
        else { selected.add(e); cell.classList.add('sel'); }
        zipSel.textContent = t('zipSelected', 'ZIP selected') + (selected.size ? ' (' + selected.size + ')' : '');
        zipSel.disabled = !selected.size;
      });
      grid.append(cell);
    }
    group.append(grid);

    const zipbar = document.createElement('div');
    zipbar.className = 'zipbar';
    const zipSel = document.createElement('button');
    zipSel.textContent = t('zipSelected', 'ZIP selected');
    zipSel.disabled = true;
    zipSel.addEventListener('click', () => zipAndDownload([...selected], host + '-selected.zip'));
    const zipAll = document.createElement('button');
    zipAll.className = 'primary';
    zipAll.textContent = t('zipAll', 'ZIP all images') + ' · ' + images.length;
    zipAll.addEventListener('click', () => zipAndDownload(images, host + '-images.zip'));
    zipbar.append(zipSel, zipAll);
    group.append(zipbar);
    list.append(group);
  }

  /* ---- other groups as rows ---- */
  for (const [kind, title] of GROUPS) {
    const items = entries.filter((e) => e.kind === kind);
    if (!items.length) continue;

    const group = document.createElement('div');
    group.className = 'group';
    const h = document.createElement('h2');
    h.append(`${title} · ${items.length}`);
    const all = document.createElement('button');
    all.textContent = '↓ ' + t('downloadAll', 'all');
    all.addEventListener('click', () => {
      items.forEach((e, i) => setTimeout(() => download(e.url, safeName(leaf(e.url)), e.kind), i * 120));
    });
    h.append(all);
    group.append(h);

    for (const e of items) {
      const row = document.createElement('div');
      row.className = 'row';
      row.title = e.url;
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = leaf(e.url);
      const size = document.createElement('span');
      size.className = 'size';
      size.textContent = fmtSize(e.size);
      const btn = document.createElement('button');
      btn.textContent = '↓';
      row.append(name, size, btn);
      row.addEventListener('click', () => download(e.url, safeName(leaf(e.url)), e.kind));
      group.append(row);
    }

    if (kind === 'stream') {
      const hint = document.createElement('div');
      hint.className = 'hint';
      hint.textContent = t('streamHint', 'Playlists describe streamed video — feed one to ffmpeg or yt-dlp where the site permits it.');
      group.append(hint);
    }
    list.append(group);
  }
})();
