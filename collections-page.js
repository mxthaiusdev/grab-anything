// Board manager page — renders boards, items, and the ZIP export
// (full-res images + a moodboard contact sheet + colors.css + notes.md).
(() => {
  const $ = (id) => document.getElementById(id);
  const el = (tag, props) => Object.assign(document.createElement(tag), props || {});
  const esc = (s) => (s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const status = (t) => { $('status').textContent = t || ''; };

  let activeId = null;

  async function render() {
    const { boards, activeId: aId } = await GrabBoards.list();
    activeId = (aId && boards.some((b) => b.id === aId)) ? aId : (boards[0] ? boards[0].id : null);

    const list = $('boardList');
    list.innerHTML = '';
    if (!boards.length) list.append(el('div', { className: 'empty', textContent: 'No boards yet. Create one, then add things to it from any page.' }));
    for (const b of boards) {
      const row = el('div', { className: 'board-item' + (b.id === activeId ? ' active' : '') });
      row.append(el('span', { className: 'nm', textContent: b.name }), el('span', { className: 'ct', textContent: b.count }));
      row.addEventListener('click', () => selectBoard(b.id));
      list.append(row);
    }
    await renderBoard();
  }

  async function selectBoard(id) { await GrabBoards.setActive(id); }

  async function renderBoard() {
    const grid = $('grid');
    const title = $('boardTitle');
    grid.innerHTML = '';
    const board = activeId ? await GrabBoards.get(activeId) : null;
    if (!board) {
      title.textContent = 'Boards';
      title.contentEditable = 'false';
      $('exportBtn').disabled = $('deleteBtn').disabled = true;
      grid.append(emptyState('Create a board on the left to get started.'));
      return;
    }
    title.textContent = board.name;
    title.contentEditable = 'true';
    $('exportBtn').disabled = $('deleteBtn').disabled = false;

    if (!board.items.length) { grid.append(emptyState('This board is empty. On any page, use the picker → <b>＋ Board</b>, or add images from the toolbar popup.')); return; }

    for (const it of board.items) grid.append(cardFor(board, it));
  }

  function emptyState(html) {
    const d = el('div', { className: 'empty-main' });
    d.innerHTML = '<p style="font-size:16px;font-weight:600;margin-bottom:8px">Nothing here yet</p><p>' + html + '</p>';
    return d;
  }

  function cardFor(board, it) {
    const card = el('div', { className: 'card' });
    if (it.type === 'image') {
      card.append(el('img', { src: it.thumb || it.url || '', loading: 'lazy', alt: '' }));
    } else if (it.type === 'svg') {
      // NEVER innerHTML untrusted page SVG in this privileged page (it can
      // carry <script>). An <img>-loaded SVG is script-sandboxed by the browser.
      const wrap = el('div', { className: 'swatch', style: 'display:flex;align-items:center;justify-content:center;padding:16px;background:#fff' });
      let src = it.thumb;
      if (!src && it.content) { try { src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(it.content))); } catch (_) {} }
      if (src) wrap.append(el('img', { src, style: 'max-width:100%;max-height:100%' }));
      card.append(wrap);
    } else if (it.type === 'color') {
      const sw = el('div', { className: 'swatch', style: 'background:' + (it.content || '#000') });
      card.append(sw, el('div', { className: 'cap', textContent: it.content }));
    } else if (it.type === 'font') {
      const spec = el('div', { className: 'fontspec', style: "font-family:'" + (it.meta.family || 'sans-serif') + "'", textContent: 'Aa' });
      card.append(spec, el('div', { className: 'cap', textContent: it.meta.family || 'font' }));
    } else if (it.type === 'link') {
      const t = el('div', { className: 'txt' });
      t.innerHTML = '<b>🔗 ' + esc(it.meta.title || 'Link') + '</b><br><span style="opacity:.6;word-break:break-all">' + esc(it.url || '') + '</span>';
      card.append(t);
    } else {
      const t = el('div', { className: 'txt', textContent: (it.content || '').slice(0, 400) });
      card.append(t, el('div', { className: 'cap', textContent: it.type }));
    }
    if (it.type === 'image' || it.type === 'svg') {
      const cap = el('div', { className: 'cap', textContent: it.meta.name || leaf(it.url) || it.type });
      card.append(cap);
    }
    const x = el('button', { className: 'x', textContent: '✕', title: 'Remove' });
    x.addEventListener('click', async (e) => { e.stopPropagation(); await GrabBoards.removeItem(board.id, it.id); });
    card.append(x);
    // click a downloadable item to save it
    if (it.url || it.type === 'svg') {
      card.style.cursor = 'pointer';
      card.addEventListener('click', () => downloadItem(it));
    }
    return card;
  }

  const leaf = (u) => { try { return decodeURIComponent(new URL(u).pathname.split('/').pop() || ''); } catch (_) { return ''; } };

  function downloadItem(it) {
    if (it.type === 'svg' && it.content) {
      const b = new Blob([it.content], { type: 'image/svg+xml' });
      chrome.downloads.download({ url: URL.createObjectURL(b), filename: (it.meta.name || 'graphic') + '.svg', conflictAction: 'uniquify' });
    } else if (it.url) {
      chrome.runtime.sendMessage({ type: 'ga-download', kind: it.type === 'image' ? 'image' : 'file', url: it.url });
    }
  }

  /* ---------------- export a board as a ZIP moodboard ---------------- */
  async function exportBoard() {
    const board = await GrabBoards.get(activeId);
    if (!board || !board.items.length) { status('Nothing to export.'); return; }
    const entries = [];
    const enc = new TextEncoder();
    const cards = [];
    const colors = [], notes = [];
    let n = 0, imgN = 0, skipped = 0, total = 0;
    const MAX_IMG = 30 * 1024 * 1024;      // skip any single image over 30MB
    const MAX_TOTAL = 1200 * 1024 * 1024;  // bound memory + stay well under the ZIP 4GB limit

    for (const it of board.items) {
      status('Collecting ' + (++n) + '/' + board.items.length + '…');
      if (it.type === 'image' && it.url) {
        try {
          const res = await fetch(it.url, { signal: AbortSignal.timeout(9000) }); // never hang on a dead URL
          if (res.ok) {
            const len = parseInt(res.headers.get('content-length'), 10) || 0;
            if (len > MAX_IMG || total + len > MAX_TOTAL) { skipped++; continue; }
            const buf = new Uint8Array(await res.arrayBuffer());
            if (buf.length > MAX_IMG || total + buf.length > MAX_TOTAL) { skipped++; continue; }
            total += buf.length;
            let name = safe(leaf(it.url)) || ('image-' + (++imgN));
            if (!/\.[a-z0-9]{2,5}$/i.test(name)) name += extFromType(res.headers.get('content-type'));
            name = 'images/' + uniq(entries, name);
            entries.push({ name, data: buf });
            cards.push('<figure><img src="' + esc(name) + '"><figcaption>' + esc(it.meta.name || leaf(it.url)) + '</figcaption></figure>');
          }
        } catch (_) { skipped++; }
      } else if (it.type === 'image' && it.thumb) {
        const data = dataUriBytes(it.thumb);
        if (data) { const name = 'images/snapshot-' + (++imgN) + '.jpg'; entries.push({ name, data }); cards.push('<figure><img src="' + name + '"></figure>'); }
      } else if (it.type === 'svg' && it.content) {
        const name = 'svg/' + uniq(entries, safe(it.meta.name || 'graphic') + '.svg');
        entries.push({ name, data: enc.encode(it.content) });
        // reference the .svg file as an <img> — never inline raw untrusted SVG
        // into the moodboard HTML (it can carry <script>/onload). img-loaded SVG is sandboxed.
        cards.push('<figure class="svg"><img src="' + esc(name) + '"></figure>');
      } else if (it.type === 'color') {
        const c = colorSafe(it.content);
        if (c) { colors.push(c); cards.push('<figure><div class="sw" style="background:' + c + '"></div><figcaption>' + esc(c) + '</figcaption></figure>'); }
      } else if (it.type === 'font') {
        notes.push('- Font: **' + mdSafe(it.meta.family || '?') + '**' + (it.url ? ' — <' + urlClean(it.url) + '>' : ''));
        cards.push('<figure><div class="font">Aa</div><figcaption>' + esc(it.meta.family || 'font') + '</figcaption></figure>');
      } else if (it.type === 'link') {
        notes.push('- [' + mdSafe(it.meta.title || it.url) + '](<' + urlClean(it.url) + '>)');
      } else if (it.content) {
        notes.push('\n' + it.content + '\n');
      }
    }
    if (skipped) status('(' + skipped + ' image' + (skipped > 1 ? 's' : '') + ' skipped — too large or unreachable) …');

    // moodboard contact sheet
    const html = '<!doctype html><meta charset="utf-8"><title>' + esc(board.name) + '</title>'
      + '<style>body{font:15px system-ui;margin:0;background:#0E0E1A;color:#fff;padding:32px}h1{font-size:28px;margin:0 0 24px}'
      + '.g{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px}figure{margin:0;background:#fff;border-radius:12px;overflow:hidden}'
      + 'figure img{width:100%;display:block}.sw{height:150px}.font{height:150px;display:flex;align-items:center;justify-content:center;font-size:56px;color:#111}'
      + 'figure.svg{display:flex;align-items:center;justify-content:center;padding:24px}figcaption{padding:8px 12px;font-size:12px;color:#111}</style>'
      + '<h1>' + esc(board.name) + '</h1><div class="g">' + cards.join('') + '</div>';
    entries.push({ name: 'moodboard.html', data: enc.encode(html) });

    if (colors.length) {
      const css = ':root {\n' + colors.map((c, i) => '  --color-' + (i + 1) + ': ' + c + ';').join('\n') + '\n}\n';
      entries.push({ name: 'colors.css', data: enc.encode(css) });
    }
    if (notes.length) entries.push({ name: 'notes.md', data: enc.encode('# ' + board.name + '\n\n' + notes.join('\n') + '\n') });

    if (!entries.length) { status('Nothing exportable in this board.'); return; }
    status('Zipping ' + entries.length + ' files…');
    const blob = GrabZip.buildZip(entries);
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({ url, filename: safe(board.name) + '.zip', conflictAction: 'uniquify' });
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    status('Exported "' + board.name + '" — ' + entries.length + ' files.');
  }

  const safe = (s) => (s || '').replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').replace(/^\.+/, '').slice(0, 80) || 'board';
  // color values can only be a bounded charset — blocks ";"/"}" CSS breakout
  const colorSafe = (c) => {
    c = String(c || '').trim();
    if (/^#[0-9a-fA-F]{3,8}$/.test(c)) return c;
    if (/^(rgb|hsl)a?\([0-9.,%\s/]+\)$/i.test(c)) return c;
    if (/^[a-zA-Z]{3,24}$/.test(c)) return c;
    return null;
  };
  const mdSafe = (s) => String(s || '').replace(/[\r\n]+/g, ' ').replace(/([\\`*_[\]<>])/g, '\\$1').slice(0, 300);
  const urlClean = (u) => String(u || '').replace(/[\s<>()]/g, '').slice(0, 500);
  const uniq = (entries, name) => { let c = name, i = 1; while (entries.some((e) => e.name.endsWith('/' + c) || e.name === c)) c = (i++) + '-' + name; return c; };
  const extFromType = (ct) => ({ 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif', 'image/svg+xml': '.svg', 'image/avif': '.avif' }[(ct || '').split(';')[0]] || '.img');
  function dataUriBytes(uri) {
    try { const b = atob(uri.split(',')[1]); const a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; } catch (_) { return null; }
  }

  /* ---------------- wiring ---------------- */
  $('newBtn').addEventListener('click', async () => {
    const name = $('newName').value.trim(); if (!name) return;
    await GrabBoards.create(name); $('newName').value = '';
  });
  $('newName').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('newBtn').click(); });
  $('boardTitle').addEventListener('blur', async () => {
    if (activeId) await GrabBoards.rename(activeId, $('boardTitle').textContent.trim());
  });
  $('boardTitle').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('boardTitle').blur(); } });
  $('deleteBtn').addEventListener('click', async () => {
    if (activeId && confirm('Delete this board and its items? This cannot be undone.')) await GrabBoards.remove(activeId);
  });
  $('exportBtn').addEventListener('click', () => exportBoard().catch((e) => status('Export failed: ' + e.message)));

  GrabBoards.onChange(render);
  render();
})();
