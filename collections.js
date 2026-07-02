// Grab Anything — Collections (boards) storage layer.
// Plain global (like gif.js / zip.js) so the content script, popup and the
// board page can all share it. Persists to chrome.storage.local (already a
// granted permission). Stores REFERENCES + small thumbnails, never full-res
// blobs, to stay inside the default local quota — no new permission needed.
(() => {
  const KEY = 'ga_boards';        // { boards: [board], activeId }
  const MAX_ITEMS = 300;          // per board, keeps quota sane
  const MAX_THUMB = 24000;        // chars of a thumb data-URI (~18KB)

  const uid = () => 'b' + Math.random().toString(36).slice(2, 9) + (Date.now() % 100000).toString(36);

  // serialize read-modify-write within this context to avoid lost updates
  let queue = Promise.resolve();
  function tx(fn) {
    const run = queue.then(() => fn());
    queue = run.catch(() => {});
    return run;
  }

  async function readAll() {
    try {
      const o = await chrome.storage.local.get(KEY);
      const s = o[KEY];
      if (s && Array.isArray(s.boards)) return s;
    } catch (_) {}
    return { boards: [], activeId: null };
  }
  const writeAll = (state) => chrome.storage.local.set({ [KEY]: state });

  function trimThumb(t) {
    if (typeof t === 'string' && t.length > MAX_THUMB) return null; // drop oversize
    return t || null;
  }

  const GrabBoards = {
    KEY,

    async list() {
      const s = await readAll();
      return {
        activeId: s.activeId,
        boards: s.boards.map((b) => ({ id: b.id, name: b.name, count: b.items.length, updatedAt: b.updatedAt || b.createdAt })),
      };
    },

    async get(id) {
      const s = await readAll();
      return s.boards.find((b) => b.id === id) || null;
    },

    create(name) {
      return tx(async () => {
        const s = await readAll();
        const board = { id: uid(), name: (name || 'Untitled board').slice(0, 80), createdAt: Date.now(), updatedAt: Date.now(), items: [] };
        s.boards.unshift(board);
        s.activeId = board.id;
        await writeAll(s);
        return board;
      });
    },

    rename(id, name) {
      return tx(async () => {
        const s = await readAll();
        const b = s.boards.find((x) => x.id === id);
        if (b) { b.name = (name || b.name).slice(0, 80); b.updatedAt = Date.now(); await writeAll(s); }
        return b || null;
      });
    },

    remove(id) {
      return tx(async () => {
        const s = await readAll();
        s.boards = s.boards.filter((x) => x.id !== id);
        if (s.activeId === id) s.activeId = s.boards[0] ? s.boards[0].id : null;
        await writeAll(s);
      });
    },

    setActive(id) {
      return tx(async () => {
        const s = await readAll();
        if (s.boards.some((b) => b.id === id)) { s.activeId = id; await writeAll(s); }
      });
    },

    // returns the active board id, creating a default board if none exists
    ensureActive(defaultName) {
      return tx(async () => {
        const s = await readAll();
        if (s.activeId && s.boards.some((b) => b.id === s.activeId)) return s.activeId;
        if (s.boards[0]) { s.activeId = s.boards[0].id; await writeAll(s); return s.activeId; }
        const board = { id: uid(), name: defaultName || 'My board', createdAt: Date.now(), updatedAt: Date.now(), items: [] };
        s.boards.unshift(board);
        s.activeId = board.id;
        await writeAll(s);
        return board.id;
      });
    },

    // item: { type:'image'|'svg'|'color'|'font'|'link'|'text'|'tokens', url?, content?, thumb?, meta? }
    addItem(boardId, item) {
      return tx(async () => {
        const s = await readAll();
        const b = s.boards.find((x) => x.id === boardId);
        if (!b) return null;
        const entry = {
          id: uid(),
          type: item.type || 'image',
          url: item.url || null,
          content: item.content != null ? String(item.content).slice(0, 200000) : null,
          thumb: trimThumb(item.thumb),
          meta: item.meta || {},
          addedAt: Date.now(),
        };
        // de-dupe by url or content
        const dup = b.items.find((i) => (entry.url && i.url === entry.url) || (entry.content && i.content === entry.content));
        if (dup) return { board: b, item: dup, duplicate: true };
        b.items.unshift(entry);
        if (b.items.length > MAX_ITEMS) b.items.length = MAX_ITEMS;
        b.updatedAt = Date.now();
        await writeAll(s);
        return { board: b, item: entry };
      });
    },

    removeItem(boardId, itemId) {
      return tx(async () => {
        const s = await readAll();
        const b = s.boards.find((x) => x.id === boardId);
        if (b) { b.items = b.items.filter((i) => i.id !== itemId); b.updatedAt = Date.now(); await writeAll(s); }
      });
    },

    moveItem(boardId, itemId, toIndex) {
      return tx(async () => {
        const s = await readAll();
        const b = s.boards.find((x) => x.id === boardId);
        if (!b) return;
        const from = b.items.findIndex((i) => i.id === itemId);
        if (from < 0) return;
        const [it] = b.items.splice(from, 1);
        b.items.splice(Math.max(0, Math.min(b.items.length, toIndex)), 0, it);
        b.updatedAt = Date.now();
        await writeAll(s);
      });
    },

    onChange(cb) {
      const handler = (changes, area) => { if (area === 'local' && changes[KEY]) cb(); };
      chrome.storage.onChanged.addListener(handler);
      return () => chrome.storage.onChanged.removeListener(handler);
    },
  };

  (typeof globalThis !== 'undefined' ? globalThis : self).GrabBoards = GrabBoards;
})();
