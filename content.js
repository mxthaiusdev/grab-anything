// Grab Anything — content script.
// Chrome's native context targeting handles plain images/video/audio/links.
// This script adds the things Chrome can't see: inline SVG, CSS background
// images (incl. pseudo-elements and image-set), the webfont rendered on the
// clicked text, canvases, blob images, lazy-load images, extra <source> and
// subtitle tracks. It also exports DOM-derived assets, runs credentialed
// fetch fallbacks, and shows failure toasts.

(() => {
  if (window.__grabAnything) return;
  window.__grabAnything = true;

  const DEFAULTS = {
    subfolder: false,
    toasts: true,
    sniffer: true,
    detectFonts: true,
    detectBackgrounds: true,
    detectSvg: true,
    detectCanvas: true,
    detectComponents: true,
  };
  let settings = Object.assign({}, DEFAULTS);
  try {
    chrome.storage.sync.get(DEFAULTS).then((s) => Object.assign(settings, s)).catch(() => {});
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      for (const key of Object.keys(changes)) settings[key] = changes[key].newValue;
    });
  } catch (_) {}

  let lastAssets = [];
  const refs = { svg: null, canvas: null, components: [] };

  /* ---------------- utils ---------------- */

  const sanitize = (s) =>
    (s || '')
      .replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_')
      .replace(/^\.+/, '')
      .trim()
      .slice(0, 150);

  function extOf(url) {
    try {
      const m = new URL(url, location.href).pathname.match(/\.([a-z0-9]{1,5})$/i);
      return m ? m[1].toLowerCase() : '';
    } catch (_) { return ''; }
  }

  function filenameFromUrl(url, fallbackBase, fallbackExt) {
    try {
      const u = new URL(url, location.href);
      let base = sanitize(decodeURIComponent(u.pathname.split('/').pop() || ''));
      if (base && /\.[a-z0-9]{1,5}$/i.test(base)) return base;
      if (base) return fallbackExt ? base + '.' + fallbackExt : base;
    } catch (_) {}
    return (fallbackBase || 'download') + (fallbackExt ? '.' + fallbackExt : '');
  }

  const short = (s) => (s.length > 44 ? s.slice(0, 24) + '…' + s.slice(-16) : s);

  /* ---------------- webfont harvesting ---------------- */

  const fontCache = new Map(); // family (lowercase) -> [{ url, format }]
  const fontNames = new Set(); // original-case family names, for display
  let harvestStarted = false;

  function harvestFonts() {
    if (harvestStarted) return;
    harvestStarted = true;
    for (const sheet of Array.from(document.styleSheets)) {
      harvestSheet(sheet, sheet.href || document.baseURI);
    }
    try {
      for (const sheet of document.adoptedStyleSheets || []) {
        harvestRules(sheet.cssRules, document.baseURI);
      }
    } catch (_) {}
    // constructed / JS-registered fonts
    try {
      for (const ff of document.fonts) {
        if (ff.family && typeof ff.src === 'string' && ff.src) {
          addFontSrcs(ff.family.replace(/^['"]|['"]$/g, ''), ff.src, document.baseURI);
        }
      }
    } catch (_) {}
  }

  function harvestSheet(sheet, baseUrl) {
    let rules = null;
    try { rules = sheet.cssRules; } catch (_) {}
    if (rules) {
      harvestRules(rules, baseUrl);
    } else if (sheet.href) {
      // Cross-origin stylesheet (e.g. Google Fonts) — the worker fetches it
      // for us, since its fetch isn't bound by the page's CORS.
      try {
        chrome.runtime.sendMessage({ type: 'ga-fetch-css', url: sheet.href })
          .then((res) => { if (res && res.ok) harvestCssText(res.text, sheet.href); })
          .catch(() => {});
      } catch (_) {}
    }
  }

  function harvestRules(rules, baseUrl) {
    for (const rule of rules) {
      try {
        if (rule.type === CSSRule.FONT_FACE_RULE) {
          const fam = (rule.style.getPropertyValue('font-family') || '')
            .trim().replace(/^['"]|['"]$/g, '');
          addFontSrcs(fam, rule.style.getPropertyValue('src'), baseUrl);
        } else if (rule.type === CSSRule.IMPORT_RULE && rule.styleSheet) {
          harvestSheet(rule.styleSheet, rule.styleSheet.href || baseUrl);
        } else if (rule.cssRules && rule.cssRules.length) {
          harvestRules(rule.cssRules, baseUrl); // @media / @supports / @layer
        }
      } catch (_) {}
    }
  }

  function harvestCssText(cssText, baseUrl) {
    const faceRe = /@font-face\s*\{([^}]*)\}/gi;
    let m;
    while ((m = faceRe.exec(cssText))) {
      const body = m[1];
      const famM = body.match(/font-family\s*:\s*(['"]?)([^;'"]+)\1/i);
      const srcM = body.match(/src\s*:\s*([^;]+)/i);
      if (famM && srcM) addFontSrcs(famM[2].trim(), srcM[1], baseUrl);
    }
  }

  function addFontSrcs(family, srcValue, baseUrl) {
    if (!family || !srcValue) return;
    fontNames.add(family);
    const key = family.toLowerCase();
    const list = fontCache.get(key) || [];
    const re = /url\((['"]?)([^'")]+)\1\)(?:\s*format\((['"]?)([^'")]+)\3\))?/g;
    let m;
    while ((m = re.exec(srcValue))) {
      let u = m[2];
      if (u.startsWith('data:')) continue;
      try { u = new URL(u, baseUrl).href; } catch (_) { continue; }
      if (!list.some((f) => f.url === u)) {
        list.push({ url: u, format: (m[4] || extOf(u) || '').toLowerCase() });
      }
    }
    if (list.length) fontCache.set(key, list);
  }

  function pickBestFontSrc(list) {
    const rank = { woff2: 0, woff: 1, truetype: 2, ttf: 2, opentype: 3, otf: 3, 'embedded-opentype': 4, svg: 5 };
    return [...list].sort((a, b) => (rank[a.format] ?? 9) - (rank[b.format] ?? 9))[0];
  }

  /* ---------------- extras collection ---------------- */

  function collect(target, x, y) {
    const extras = [];
    const seen = new Set();
    refs.svg = null;
    refs.canvas = null;
    refs.components = [];

    const push = (a) => {
      const key = a.url || a.kind + ':' + a.label;
      if (seen.has(key)) return;
      seen.add(key);
      extras.push(a);
    };

    const urlAsset = (kind, url, noun, fallbackExt) => {
      const filename = filenameFromUrl(url, kind, fallbackExt);
      return { kind, url, filename, label: noun + ' (' + short(filename) + ')', method: 'url' };
    };

    const abs = (u) => new URL(u, location.href).href;

    // Everything under the cursor, not just the top element — players and
    // lightboxes love to stack overlay divs above the actual media.
    const stack = (x != null && y != null) ? document.elementsFromPoint(x, y) : [];
    const candidates = [];
    for (const el of [target, ...stack]) {
      if (el && el.nodeType === 1 && !candidates.includes(el)) candidates.push(el);
    }
    if (target && target.closest) {
      for (const sel of ['img', 'video', 'audio', 'svg', 'canvas']) {
        const hit = target.closest(sel);
        if (hit && !candidates.includes(hit)) candidates.push(hit);
      }
    }

    for (const el of candidates) {
      const tag = el.tagName.toLowerCase();

      if (tag === 'img') {
        const src = el.currentSrc || el.src;
        const big = largestSrcsetUrl(el);
        if (big) push(urlAsset('image', big, 'Best-quality image', 'jpg'));
        if (src && src.startsWith('blob:')) {
          // blob: images can't be fetched by the worker — export from the page
          push({ kind: 'blob', url: src, filename: 'image.png', label: 'Image (created by this page)', method: 'content' });
        } else if (!src || src.startsWith('data:')) {
          // lazy-loaded image that hasn't swapped its real source in yet
          const lazy = el.getAttribute('data-src') || el.getAttribute('data-original') || el.getAttribute('data-lazy-src');
          if (lazy) {
            try { push(urlAsset('image', abs(lazy), 'Image', 'jpg')); } catch (_) {}
          }
        }
      }

      if (tag === 'canvas' && settings.detectCanvas && !refs.canvas) {
        refs.canvas = el;
        push({ kind: 'canvas', filename: 'canvas.png', label: 'Drawing as image (PNG)', method: 'content' });
      }

      const svgRoot = el.ownerSVGElement || (tag === 'svg' ? el : null);
      if (svgRoot && settings.detectSvg && !refs.svg) {
        refs.svg = svgRoot;
        push({ kind: 'svg', filename: svgFilename(svgRoot), label: 'Logo / graphic (SVG)', method: 'content' });
      }

      if (tag === 'video' || tag === 'audio') {
        const noun = tag === 'video' ? 'Video file' : 'Audio file';
        const cur = el.currentSrc;
        // alternate <source> encodings Chrome's native item doesn't offer
        for (const s of el.querySelectorAll('source')) {
          if (s.src && s.src !== cur && !s.src.startsWith('blob:')) {
            try { push(urlAsset('media', abs(s.src), noun, tag === 'video' ? 'mp4' : 'mp3')); } catch (_) {}
          }
        }
        for (const t of el.querySelectorAll('track')) {
          if (t.src) {
            try { push(urlAsset('media', abs(t.src), 'Subtitles', 'vtt')); } catch (_) {}
          }
        }
        if (tag === 'video' && el.poster) {
          try { push(urlAsset('image', abs(el.poster), 'Video thumbnail', 'jpg')); } catch (_) {}
        }
      }
    }

    // CSS background images: clicked element (incl. ::before/::after),
    // then up the ancestor chain.
    if (settings.detectBackgrounds) {
      const pushBg = (bg) => {
        if (!bg || bg === 'none') return false;
        let found = false;
        for (const m of bg.matchAll(/url\((['"]?)([^'")]+)\1\)/g)) {
          try {
            const raw = m[2];
            if (raw.startsWith('data:')) {
              push({ kind: 'image', url: raw, filename: 'background.png', label: 'Background image (data URI)', method: 'url' });
            } else {
              push(urlAsset('image', abs(raw), 'Background image', 'jpg'));
            }
            found = true;
          } catch (_) {}
        }
        if (!found) {
          // image-set("hero.avif" type("image/avif"), ...) — quoted-string form
          for (const m of bg.matchAll(/["']([^"']+?\.(?:jpe?g|png|webp|avif|gif|svg))["']/gi)) {
            try { push(urlAsset('image', abs(m[1]), 'Background image', 'jpg')); found = true; } catch (_) {}
          }
        }
        return found;
      };

      let hit = pushBg(getComputedStyle(target).backgroundImage);
      for (const pseudo of ['::before', '::after']) {
        try { hit = pushBg(getComputedStyle(target, pseudo).backgroundImage) || hit; } catch (_) {}
      }
      let el = target.parentElement;
      for (let depth = 0; !hit && el && el.nodeType === 1 && depth < 8; el = el.parentElement, depth++) {
        hit = pushBg(getComputedStyle(el).backgroundImage);
      }
    }

    // The webfont actually rendered on the clicked element
    if (settings.detectFonts) {
      let fontPushed = false;
      const families = getComputedStyle(target).fontFamily
        .split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, ''));
      for (const fam of families) {
        const hits = fontCache.get(fam.toLowerCase());
        if (!hits || !hits.length) continue;
        const best = pickBestFontSrc(hits);
        push({
          kind: 'font',
          url: best.url,
          filename: filenameFromUrl(best.url, sanitize(fam) || 'font', best.format === 'woff2' ? 'woff2' : null),
          label: 'Font used here: ' + fam,
          method: 'url',
        });
        fontPushed = true;
        break; // first family with a matching @font-face is the rendered one
      }
      if (!fontPushed) {
        // last resort: fonts the page preloaded
        let n = 0;
        for (const link of document.querySelectorAll('link[rel="preload"][as="font"][href]')) {
          if (n >= 2) break;
          try {
            const u = abs(link.getAttribute('href'));
            push({
              kind: 'font', url: u,
              filename: filenameFromUrl(u, 'font', null),
              label: 'Font file (' + short(filenameFromUrl(u, 'font')) + ')',
              method: 'url',
            });
            n++;
          } catch (_) {}
        }
      }
    }

    // Component / section under the cursor as HTML + CSS, plus the page kit
    if (settings.detectComponents) {
      for (const { el: scopeEl, noun } of componentScopes(target)) {
        const idx = refs.components.push(scopeEl) - 1;
        push({
          kind: 'component',
          refIdx: idx,
          filename: componentName(scopeEl) + '.html',
          label: scopeLabel(scopeEl, noun),
          method: 'content',
        });
      }
      if (window === window.top) {
        push({ kind: 'kit', filename: 'kit', label: 'Save whole page + each section (separate files)', method: 'content' });
      }
    }

    // Content-addressed menu ids: a click can only ever execute the asset
    // its label described, even if Chrome rendered a stale menu snapshot.
    const usedIds = new Set();
    extras.forEach((asset, i) => {
      asset.id = i;
      let gaId = 'ga-x-' + hashId(asset.kind + '|' + asset.label + '|' + (asset.url || '') + '|' + (asset.refIdx ?? ''));
      while (usedIds.has(gaId)) gaId += 'x';
      usedIds.add(gaId);
      asset.gaId = gaId;
    });
    return extras;
  }

  function hashId(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  /* ---------------- component extraction (HTML + CSS) ----------------
     Serializes an element and collects every CSS rule that matches it or
     its descendants — hover/focus states, @media blocks, the @font-face
     and @keyframes it uses, and the CSS variables it references — into a
     standalone .html file. */

  function componentRoot(el) {
    const hit = el.closest && el.closest('nav, header, footer, aside, article, form, dialog');
    if (hit && hit !== document.body) return hit;
    let r = el;
    for (let i = 0; i < 5 && r && r !== document.body; i++) {
      if (r.id || (typeof r.className === 'string' && r.className.trim())) return r;
      r = r.parentElement;
    }
    return el;
  }

  // Up to two nested scopes: the tight component, and the section it lives in
  function componentScopes(el) {
    const scopes = [];
    const usable = (n) => n && n !== document.body && n !== document.documentElement;
    const comp = componentRoot(el);
    if (usable(comp)) scopes.push({ el: comp, noun: 'Component' });
    const sec = el.closest && el.closest('section, main, [class*="hero" i], [class*="banner" i], [class*="footer" i]');
    if (usable(sec) && sec !== comp) scopes.push({ el: sec, noun: 'Section' });
    return scopes;
  }

  // The page's major building blocks, for one-click "page kit" export.
  // Layout-based, not tag-based: most sites build sections out of plain
  // divs, so we walk down to the element holding the content bands and
  // treat each substantial band as a section.
  function kitTargets() {
    const out = [];
    const seen = new Set();
    const add = (el, name) => {
      if (!el || seen.has(el) || el === document.body || el === document.documentElement) return;
      if (el.querySelectorAll('*').length > 1500) return;
      seen.add(el);
      out.push({ el, name });
    };

    const header = document.querySelector('header, [role="banner"], nav');
    const footerEl = document.querySelector('footer, [role="contentinfo"]');
    add(header, 'header');

    const SKIP = new Set(['script', 'style', 'link', 'template', 'noscript']);
    const bands = (el) => [...el.children].filter((c) => {
      if (SKIP.has(c.tagName.toLowerCase())) return false;
      try { return c.getBoundingClientRect().height > 40; } catch (_) { return false; }
    });

    // descend through single-child wrappers (#__next, #root, .page …)
    let flow = document.querySelector('main') || document.body;
    for (let i = 0; i < 6; i++) {
      const kids = bands(flow);
      if (kids.length === 1 && kids[0].querySelectorAll('*').length > 3) { flow = kids[0]; continue; }
      break;
    }

    const sections = [];
    const queue = bands(flow);
    while (queue.length && sections.length < 10) {
      const band = queue.shift();
      if (band === header || band === footerEl) continue;
      if ((header && band.contains(header)) || (footerEl && band.contains(footerEl))) {
        queue.unshift(...bands(band)); // unwrap wrappers that mix chrome + content
        continue;
      }
      const isSection = band.tagName.toLowerCase() === 'section';
      if (!isSection && band.getBoundingClientRect().height < 150) continue;
      sections.push(band);
    }

    sections.forEach((band, i) => add(band, i === 0 ? 'hero' : 'section-' + i));
    if (!sections.length) {
      add(document.querySelector('[class*="hero" i]'), 'hero');
    }
    add(footerEl, 'footer');
    return out;
  }

  async function buildPageKit() {
    const parts = [];
    // the complete page first — scripts stripped, URLs absolutized
    try {
      parts.push({ name: 'full-page', html: '<!DOCTYPE html>\n' + cloneComponentHtml(document.documentElement) });
    } catch (_) {}
    for (const { el, name } of kitTargets()) {
      try { parts.push({ name, html: await buildComponentHtml(el) }); } catch (_) {}
    }
    return parts;
  }

  function compDesc(el) {
    const tag = el.tagName.toLowerCase();
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/)[0] : '';
    return (tag + (el.id ? '#' + el.id : cls ? '.' + cls : '')).slice(0, 36);
  }

  // Plain-English name for an element, for people who don't speak HTML
  function friendlyName(el) {
    const tag = el.tagName.toLowerCase();
    const cls = (typeof el.className === 'string' ? el.className : '').toLowerCase();
    if (tag === 'nav' || /\bnav|menu/.test(cls)) return 'navigation bar';
    if (tag === 'header' || /header|topbar/.test(cls)) return 'header';
    if (tag === 'footer' || /footer/.test(cls)) return 'footer';
    if (/hero/.test(cls)) return 'hero section';
    if (/card/.test(cls)) return 'card';
    if (/banner/.test(cls)) return 'banner';
    if (tag === 'aside' || /sidebar/.test(cls)) return 'sidebar';
    if (tag === 'form') return 'form';
    if (tag === 'dialog' || /modal|popup/.test(cls)) return 'popup';
    if (tag === 'article') return 'article';
    if (tag === 'section') return 'section';
    if (tag === 'main') return 'main content';
    if (tag === 'table') return 'table';
    if (tag === 'button' || /\bbtn|button/.test(cls)) return 'button';
    if (tag === 'img' || tag === 'picture') return 'image';
    if (tag === 'svg') return 'graphic';
    if (tag === 'video') return 'video';
    if (tag === 'audio') return 'audio player';
    return 'this block';
  }

  function scopeLabel(el, noun) {
    const name = friendlyName(el);
    if (noun === 'Section') {
      return 'Save design: whole ' + (name === 'this block' ? 'section' : name);
    }
    let label = 'Save design: ' + name;
    if (name === 'this block' || name === 'section') label += ' (' + compDesc(el) + ')';
    return label;
  }

  function componentName(el) {
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/)[0] : '';
    return sanitize(el.id || cls || el.tagName.toLowerCase()) || 'component';
  }

  let sheetCache = null; // [{ rules, baseUrl }]

  async function getAllSheets() {
    if (sheetCache) return sheetCache;
    const out = [];
    const jobs = [];
    const addParsed = (text, baseUrl) => {
      try {
        const s = new CSSStyleSheet();
        s.replaceSync(text);
        out.push({ rules: s.cssRules, baseUrl });
      } catch (_) {}
    };
    const visit = (sheet, baseUrl) => {
      let rules = null;
      try { rules = sheet.cssRules; } catch (_) {}
      if (rules) {
        out.push({ rules, baseUrl });
        for (const r of rules) {
          try {
            if (r.type === CSSRule.IMPORT_RULE && r.styleSheet) {
              visit(r.styleSheet, r.styleSheet.href || baseUrl);
            }
          } catch (_) {}
        }
      } else if (sheet.href) {
        jobs.push(
          chrome.runtime.sendMessage({ type: 'ga-fetch-css', url: sheet.href })
            .then((res) => { if (res && res.ok) addParsed(res.text, sheet.href); })
            .catch(() => {})
        );
      }
    };
    for (const sheet of Array.from(document.styleSheets)) visit(sheet, sheet.href || document.baseURI);
    try {
      for (const s of document.adoptedStyleSheets || []) out.push({ rules: s.cssRules, baseUrl: document.baseURI });
    } catch (_) {}
    await Promise.all(jobs);
    sheetCache = out;
    return out;
  }

  function absolutizeCss(cssText, baseUrl) {
    return cssText.replace(/url\((['"]?)([^'")]+)\1\)/g, (m, q, u) => {
      if (/^(data:|https?:|\/\/|#)/.test(u)) return m;
      try { return 'url("' + new URL(u, baseUrl).href + '")'; } catch (_) { return m; }
    });
  }

  const stripPseudo = (sel) => sel.replace(
    /::?(hover|focus-within|focus-visible|focus|active|visited|target|checked|disabled|placeholder-shown|placeholder|selection|marker|backdrop|before|after|first-line|first-letter)\b/gi,
    ''
  );

  function selectorMatches(rootEl, selectorText) {
    for (const sel of String(selectorText).split(',')) {
      for (const t of [sel.trim(), stripPseudo(sel).trim()]) {
        if (!t) continue;
        try {
          if (rootEl.matches(t) || rootEl.querySelector(t)) return true;
        } catch (_) {}
      }
    }
    return false;
  }

  async function exportComponent(rootEl, filename) {
    saveBlob(new Blob([await buildComponentHtml(rootEl)], { type: 'text/html' }), filename);
  }

  async function buildComponentHtml(rootEl) {
    if (rootEl.querySelectorAll('*').length > 1500) {
      throw new Error('this area is too big to save — right-click something more specific');
    }
    const sheets = await getAllSheets();
    const fontFaceRules = [];
    const keyframeRules = new Map(); // name -> [cssText]

    const walk = (rules, baseUrl) => {
      const chunks = [];
      for (const rule of rules) {
        try {
          if (rule.type === CSSRule.STYLE_RULE) {
            if (selectorMatches(rootEl, rule.selectorText)) {
              chunks.push(absolutizeCss(rule.cssText, baseUrl));
            }
          } else if (rule.type === CSSRule.MEDIA_RULE) {
            const inner = walk(rule.cssRules, baseUrl);
            if (inner.length) chunks.push('@media ' + rule.conditionText + ' {\n' + inner.join('\n') + '\n}');
          } else if (rule.type === CSSRule.SUPPORTS_RULE) {
            const inner = walk(rule.cssRules, baseUrl);
            if (inner.length) chunks.push('@supports ' + rule.conditionText + ' {\n' + inner.join('\n') + '\n}');
          } else if (rule.type === CSSRule.FONT_FACE_RULE) {
            fontFaceRules.push({ rule, baseUrl });
          } else if (rule.type === CSSRule.KEYFRAMES_RULE) {
            const arr = keyframeRules.get(rule.name) || [];
            arr.push(absolutizeCss(rule.cssText, baseUrl));
            keyframeRules.set(rule.name, arr);
          } else if (rule.cssRules && rule.cssRules.length) {
            // @layer blocks and other grouping rules (legacy type === 0)
            const inner = walk(rule.cssRules, baseUrl);
            if (inner.length) {
              const head = rule.cssText.slice(0, rule.cssText.indexOf('{')).trim();
              chunks.push(head ? head + ' {\n' + inner.join('\n') + '\n}' : inner.join('\n'));
            }
          } else if (rule.cssText && /^@(layer[^{]*;|property)/.test(rule.cssText.trim())) {
            // @layer order statements and @property registrations
            chunks.push(rule.cssText);
          }
        } catch (_) {}
      }
      return chunks;
    };

    let chunks = [];
    for (const { rules, baseUrl } of sheets) chunks.push(...walk(rules, baseUrl));
    chunks = [...new Set(chunks)];
    const cssJoined = chunks.join('\n');

    // CSS variables the component references, resolved at the element
    const varNames = new Set([...cssJoined.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)].map((m) => m[1]));
    let varsBlock = '';
    if (varNames.size) {
      const cs = getComputedStyle(rootEl);
      const decls = [];
      for (const v of varNames) {
        const val = cs.getPropertyValue(v).trim();
        if (val) decls.push('  ' + v + ': ' + val + ';');
      }
      if (decls.length) varsBlock = ':root {\n' + decls.join('\n') + '\n}\n';
    }

    // @font-face for families the collected rules actually use
    const famSet = new Set();
    for (const m of cssJoined.matchAll(/font(?:-family)?\s*:\s*([^;}]+)/gi)) {
      m[1].split(',').forEach((f) => {
        const t = f.trim().replace(/^['"]|['"]$/g, '').toLowerCase();
        if (t && !/^\d/.test(t)) famSet.add(t);
      });
    }
    const faceChunks = [];
    for (const { rule, baseUrl } of fontFaceRules) {
      const fam = (rule.style.getPropertyValue('font-family') || '').trim().replace(/^['"]|['"]$/g, '').toLowerCase();
      if (fam && famSet.has(fam)) faceChunks.push(absolutizeCss(rule.cssText, baseUrl));
    }

    // @keyframes referenced by the collected rules
    const KEYWORDS = new Set(['none', 'infinite', 'linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out',
      'alternate', 'forwards', 'backwards', 'both', 'running', 'paused', 'normal', 'reverse', 'alternate-reverse']);
    const kfChunks = [];
    for (const m of cssJoined.matchAll(/animation(?:-name)?\s*:\s*([^;}]+)/gi)) {
      for (const part of m[1].split(',')) {
        const token = part.trim().split(/\s+/).find((w) => /^[A-Za-z_][\w-]*$/.test(w) && !KEYWORDS.has(w));
        if (token) for (const text of keyframeRules.get(token) || []) kfChunks.push(text);
      }
    }

    // inherited context so the export renders like it does in situ
    const ctx = getComputedStyle(rootEl.parentElement || document.body);
    let pageBg = getComputedStyle(document.body).backgroundColor;
    if (!pageBg || pageBg === 'rgba(0, 0, 0, 0)') pageBg = '#ffffff';
    const bodyCss = 'body { margin: 0; font-family: ' + ctx.fontFamily + '; font-size: ' + ctx.fontSize +
      '; line-height: ' + ctx.lineHeight + '; color: ' + ctx.color + '; background: ' + pageBg + '; }';

    return '<!DOCTYPE html>\n' +
      '<!-- <' + compDesc(rootEl) + '> extracted from ' + location.href + ' by Grab Anything -->\n' +
      '<html>\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
      '<style>\n' + varsBlock + [...new Set(faceChunks)].join('\n') + '\n' + [...new Set(kfChunks)].join('\n') + '\n' +
      bodyCss + '\n' + chunks.join('\n') + '\n</style>\n</head>\n<body>\n' +
      cloneComponentHtml(rootEl) + '\n</body>\n</html>\n';
  }

  function cloneComponentHtml(rootEl) {
    const clone = rootEl.cloneNode(true);
    clone.querySelectorAll('script, noscript').forEach((s) => s.remove());

    const fixUrl = (el, attr) => {
      const v = el.getAttribute(attr);
      if (v && !/^(data:|https?:|#|mailto:|tel:|javascript:)/i.test(v)) {
        try { el.setAttribute(attr, new URL(v, location.href).href); } catch (_) {}
      }
    };
    for (const el of [clone, ...clone.querySelectorAll('*')]) {
      for (const attr of [...el.attributes]) {
        if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
      }
      fixUrl(el, 'src');
      fixUrl(el, 'href');
      fixUrl(el, 'poster');
      const ss = el.getAttribute && el.getAttribute('srcset');
      if (ss) {
        el.setAttribute('srcset', ss.split(',').map((part) => {
          const bits = part.trim().split(/\s+/);
          try { bits[0] = new URL(bits[0], location.href).href; } catch (_) {}
          return bits.join(' ');
        }).join(', '));
      }
    }

    // icon sprites: copy referenced <symbol>/<defs> targets into the export
    const defs = new Set();
    for (const use of clone.querySelectorAll('use')) {
      const ref = use.getAttribute('href') || use.getAttribute('xlink:href');
      if (ref && ref.startsWith('#')) {
        try {
          const sym = document.querySelector(ref);
          if (sym) defs.add(sym.outerHTML);
        } catch (_) {}
      }
    }
    const defsBlock = defs.size
      ? '<svg xmlns="http://www.w3.org/2000/svg" style="display:none">' + [...defs].join('') + '</svg>\n'
      : '';
    return defsBlock + clone.outerHTML;
  }

  // Largest candidate across the img's srcset and any <picture> sources —
  // the browser usually renders a smaller variant than the page offers.
  function largestSrcsetUrl(img) {
    let best = null;
    let bestW = 0;
    const scan = (ss) => {
      if (!ss) return;
      for (const part of ss.split(',')) {
        const bits = part.trim().split(/\s+/);
        const u = bits[0];
        const d = bits[1] || '';
        const w = d.endsWith('w') ? parseInt(d, 10)
          : d.endsWith('x') ? parseInt(d, 10) * 1000 : 1;
        if (u && w >= bestW) { best = u; bestW = w; }
      }
    };
    scan(img.getAttribute('srcset'));
    const pic = img.closest('picture');
    if (pic) for (const s of pic.querySelectorAll('source')) scan(s.getAttribute('srcset'));
    if (!best) return null;
    try {
      const absUrl = new URL(best, location.href).href;
      return absUrl !== (img.currentSrc || img.src) ? absUrl : null;
    } catch (_) { return null; }
  }

  function svgFilename(svg) {
    const name = sanitize(svg.getAttribute('aria-label') || svg.id || '');
    return (name || 'graphic') + '.svg';
  }

  /* ---------------- visual element picker ---------------- */

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let picker = null;

  function startPicker() {
    if (picker || window !== window.top) return;
    const box = document.createElement('div');
    box.setAttribute('data-ga-picker', '');
    Object.assign(box.style, {
      position: 'fixed', zIndex: 2147483646, left: 0, top: 0, width: 0, height: 0,
      border: '2px solid #6366F1', background: 'rgba(99,102,241,0.12)',
      borderRadius: '3px', pointerEvents: 'none', transition: 'all 60ms linear',
    });
    const tag = document.createElement('div');
    Object.assign(tag.style, {
      position: 'fixed', zIndex: 2147483647, background: '#111', color: '#fff',
      font: '12px/1.7 -apple-system, system-ui, sans-serif', padding: '1px 9px',
      borderRadius: '5px', pointerEvents: 'none', whiteSpace: 'nowrap',
    });
    document.documentElement.append(box, tag);
    picker = { box, tag, bar: null, el: null, stack: [], depth: 0, frozen: false };
    window.addEventListener('mousemove', onPickMove, true);
    window.addEventListener('wheel', onPickWheel, { capture: true, passive: false });
    window.addEventListener('click', onPickClick, true);
    window.addEventListener('keydown', onPickKey, true);
    toast('Point at anything. Scroll or ↑↓ to widen, click to grab, Esc to cancel.');
  }

  function stopPicker() {
    if (!picker) return;
    window.removeEventListener('mousemove', onPickMove, true);
    window.removeEventListener('wheel', onPickWheel, { capture: true });
    window.removeEventListener('click', onPickClick, true);
    window.removeEventListener('keydown', onPickKey, true);
    picker.box.remove();
    picker.tag.remove();
    if (picker.bar) picker.bar.remove();
    picker = null;
  }

  function pickerTargetFromPoint(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el || el === picker.box || el === picker.tag || (picker.bar && picker.bar.contains(el))) return null;
    return el;
  }

  function updatePickBox() {
    const el = picker.stack[picker.depth];
    if (!el) return;
    picker.el = el;
    const r = el.getBoundingClientRect();
    Object.assign(picker.box.style, {
      left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px',
    });
    picker.tag.textContent = friendlyName(el) + '  ' + Math.round(r.width) + '×' + Math.round(r.height);
    picker.tag.style.left = Math.max(6, r.left) + 'px';
    picker.tag.style.top = Math.max(6, r.top - 26) + 'px';
  }

  function onPickMove(e) {
    if (!picker || picker.frozen) return;
    let el = pickerTargetFromPoint(e.clientX, e.clientY);
    if (el && el.ownerSVGElement) el = el.ownerSVGElement; // pick the logo, not its shapes
    if (!el || el === picker.stack[0]) return;
    const stack = [];
    for (let n = el; n && n !== document.body && stack.length < 12; n = n.parentElement) stack.push(n);
    picker.stack = stack;
    picker.depth = 0;
    updatePickBox();
  }

  function onPickWheel(e) {
    if (!picker || picker.frozen) return;
    e.preventDefault();
    e.stopPropagation();
    picker.depth = Math.max(0, Math.min(picker.stack.length - 1, picker.depth + (e.deltaY > 0 ? 1 : -1)));
    updatePickBox();
  }

  function onPickKey(e) {
    if (!picker) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); stopPicker(); return; }
    if (picker.frozen) return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      picker.depth = Math.max(0, Math.min(picker.stack.length - 1, picker.depth + (e.key === 'ArrowUp' ? 1 : -1)));
      updatePickBox();
    }
  }

  function onPickClick(e) {
    if (!picker) return;
    if (!e.isTrusted) return; // our own programmatic clicks (download anchors)
    if (picker.bar && e.composedPath().includes(picker.bar)) return; // let bar buttons work
    e.preventDefault();
    e.stopPropagation();
    if (picker.frozen) { // click off the bar resumes picking
      picker.frozen = false;
      if (picker.bar) { picker.bar.remove(); picker.bar = null; }
      return;
    }
    if (!picker.el) return;
    picker.frozen = true;
    showPickBar(picker.el);
  }

  function showPickBar(el) {
    const bar = document.createElement('div');
    bar.setAttribute('data-ga-bar', '');
    Object.assign(bar.style, {
      position: 'fixed', zIndex: 2147483647, display: 'flex', gap: '6px',
      background: 'rgba(17,17,17,0.96)', padding: '8px', borderRadius: '10px',
      boxShadow: '0 8px 28px rgba(0,0,0,.4)',
    });
    const mkBtn = (label, action, fn) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.setAttribute('data-ga-action', action);
      Object.assign(b.style, {
        font: '13px -apple-system, system-ui, sans-serif', color: '#fff',
        background: '#6366F1', border: 'none', borderRadius: '7px',
        padding: '7px 12px', cursor: 'pointer',
      });
      if (action === 'cancel') b.style.background = '#444';
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        Promise.resolve()
          .then(fn)
          .catch((err) => toast('Could not grab this: ' + err.message))
          .finally(stopPicker);
      });
      return b;
    };

    bar.append(mkBtn('Save as image', 'shot', () => pickerShot(el)));
    bar.append(mkBtn('Save design', 'design', () => exportComponent(el, componentName(el) + '.html')));
    const img = el.tagName === 'IMG' ? el : el.querySelector && el.querySelector('img');
    if (el.tagName === 'IMG') {
      bar.append(mkBtn('Download image', 'download-img', () => {
        const p = chrome.runtime.sendMessage({ type: 'ga-download', kind: 'image', url: el.currentSrc || el.src });
        if (p && p.catch) p.catch(() => {});
      }));
      bar.append(mkBtn('Copy image', 'copy-img', () => copyImageToClipboard(el)));
    }
    const svg = el.ownerSVGElement || (el.tagName.toLowerCase() === 'svg' ? el : null);
    if (svg) {
      bar.append(mkBtn('Copy SVG', 'copy-svg', async () => {
        await navigator.clipboard.writeText(serializeSvg(svg));
        toast('SVG copied — paste it into Figma or a file.');
      }));
    }
    bar.append(mkBtn('Cancel', 'cancel', () => {}));

    document.documentElement.append(bar);
    const r = el.getBoundingClientRect();
    const top = r.bottom + 10 < innerHeight - 60 ? r.bottom + 10 : Math.max(8, r.top - 54);
    bar.style.top = top + 'px';
    bar.style.left = Math.max(8, Math.min(r.left, innerWidth - bar.offsetWidth - 8)) + 'px';
    picker.bar = bar;
  }

  async function copyImageToClipboard(imgEl) {
    const blob = await (await fetch(imgEl.currentSrc || imgEl.src)).blob();
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    c.getContext('2d').drawImage(bmp, 0, 0);
    const png = await new Promise((res) => c.toBlob(res, 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    toast('Image copied to clipboard.');
  }

  /* ---------------- screenshots (element + full page) ---------------- */

  async function captureViewport() {
    const res = await chrome.runtime.sendMessage({ type: 'ga-capture' });
    if (!res || !res.ok) throw new Error((res && res.error) || 'capture failed');
    const img = new Image();
    img.src = res.dataUrl;
    await img.decode();
    return img;
  }

  async function pickerShot(el) {
    const r0 = el.getBoundingClientRect();
    if (r0.top < 0 || r0.bottom > innerHeight) {
      el.scrollIntoView({ block: 'center' });
      await sleep(400);
    }
    if (picker) {
      picker.box.style.display = 'none';
      picker.tag.style.display = 'none';
      if (picker.bar) picker.bar.style.display = 'none';
    }
    await sleep(120);
    const r = el.getBoundingClientRect();
    const x = Math.max(0, r.left);
    const y = Math.max(0, r.top);
    const w = Math.min(r.right, innerWidth) - x;
    const h = Math.min(r.bottom, innerHeight) - y;
    if (w < 2 || h < 2) throw new Error('element is not visible');
    const img = await captureViewport();
    const scale = img.width / innerWidth;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * scale));
    c.height = Math.max(1, Math.round(h * scale));
    c.getContext('2d').drawImage(img, x * scale, y * scale, w * scale, h * scale, 0, 0, c.width, c.height);
    await new Promise((res) => c.toBlob((b) => { saveBlob(b, (componentName(el) || 'element') + '.png'); res(); }, 'image/png'));
  }

  async function fullPageShot() {
    const host = sanitize(location.hostname.replace(/^www\./, '')) || 'page';
    const maxCss = Math.min(document.documentElement.scrollHeight, Math.floor(16000 / devicePixelRatio));
    const startY = scrollY;
    const frames = [];
    let hidden = [];

    const total = Math.ceil(maxCss / innerHeight);
    for (let y = 0; y < maxCss; y += innerHeight) {
      scrollTo(0, y);
      await sleep(460); // captureVisibleTab is rate-limited to ~2/sec
      if (y > 0 && !hidden.length) {
        // sticky headers repeat on every frame — hide them after frame one
        for (const el of document.querySelectorAll('body *')) {
          if (hidden.length > 40) break;
          const pos = getComputedStyle(el).position;
          if (pos === 'fixed' || pos === 'sticky') {
            hidden.push([el, el.style.visibility]);
            el.style.visibility = 'hidden';
          }
        }
      }
      toast('Capturing… ' + (frames.length + 1) + '/' + total);
      const img = await captureViewport();
      frames.push({ y: scrollY, img });
      if (scrollY + innerHeight >= maxCss) break;
    }
    for (const [el, v] of hidden) el.style.visibility = v;
    scrollTo(0, startY);

    const scale = frames[0].img.width / innerWidth;
    const c = document.createElement('canvas');
    c.width = frames[0].img.width;
    c.height = Math.round(maxCss * scale);
    const ctx = c.getContext('2d');
    for (const f of frames) ctx.drawImage(f.img, 0, Math.round(f.y * scale));
    await new Promise((res) => c.toBlob((b) => { saveBlob(b, host + '-page.png'); res(); }, 'image/png'));
    toast('Full-page screenshot saved.');
  }

  /* ---------------- palette & font cards ---------------- */

  function cssColorToHex(col) {
    const m = col && col.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
    if (!m) return null;
    if (m[4] !== undefined && parseFloat(m[4]) < 0.5) return null;
    const h = (v) => Math.round(parseFloat(v)).toString(16).padStart(2, '0');
    return ('#' + h(m[1]) + h(m[2]) + h(m[3])).toUpperCase();
  }

  function collectPalette() {
    const weights = new Map();
    const bump = (col, w) => {
      const hex = cssColorToHex(col);
      if (hex) weights.set(hex, (weights.get(hex) || 0) + w);
    };
    let i = 0;
    for (const el of document.querySelectorAll('body, body *')) {
      if (++i > 1200) break;
      const r = el.getBoundingClientRect();
      const area = Math.min(r.width * r.height, 400000);
      if (!area) continue;
      const cs = getComputedStyle(el);
      if (cs.backgroundColor && !cs.backgroundColor.startsWith('rgba(0, 0, 0, 0')) bump(cs.backgroundColor, area);
      bump(cs.color, Math.max(60, area / 40));
    }
    const sorted = [...weights.entries()].sort((a, b) => b[1] - a[1]);
    const out = [];
    const rgb = (hex) => [1, 3, 5].map((p) => parseInt(hex.slice(p, p + 2), 16));
    for (const [hex] of sorted) {
      if (out.length >= 8) break;
      const c1 = rgb(hex);
      if (out.some((h2) => {
        const c2 = rgb(h2);
        return (c1[0] - c2[0]) ** 2 + (c1[1] - c2[1]) ** 2 + (c1[2] - c2[2]) ** 2 < 2400;
      })) continue;
      out.push(hex);
    }
    const lum = (hex) => rgb(hex).reduce((a, v) => a + v, 0);
    return out.sort((a, b) => lum(b) - lum(a));
  }

  function cardCanvas(host, subtitle) {
    const c = document.createElement('canvas');
    c.width = 1200;
    c.height = 630;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 1200, 630);
    ctx.fillStyle = '#111111';
    ctx.font = '700 40px -apple-system, system-ui, sans-serif';
    ctx.fillText(host, 60, 86);
    ctx.fillStyle = '#999999';
    ctx.font = '22px -apple-system, system-ui, sans-serif';
    ctx.fillText(subtitle, 60, 122);
    ctx.font = '18px -apple-system, system-ui, sans-serif';
    ctx.fillText('Grab Anything', 1042, 600);
    return [c, ctx];
  }

  async function makePaletteCard() {
    const host = sanitize(location.hostname.replace(/^www\./, '')) || 'site';
    const cols = collectPalette();
    if (!cols.length) throw new Error('no colors found');
    const [c, ctx] = cardCanvas(host, 'color palette');
    const n = cols.length;
    const gap = 18;
    const w = (1200 - 120 - (n - 1) * gap) / n;
    cols.forEach((hex, i) => {
      const x = 60 + i * (w + gap);
      ctx.fillStyle = hex;
      ctx.beginPath();
      ctx.roundRect(x, 180, w, 280, 16);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.08)';
      ctx.stroke();
      ctx.fillStyle = '#333333';
      ctx.font = '17px ui-monospace, monospace';
      ctx.fillText(hex, x + (w - ctx.measureText(hex).width) / 2, 500);
    });
    await new Promise((res) => c.toBlob((b) => { saveBlob(b, host + '-palette.png'); res(); }, 'image/png'));
    toast('Palette card saved.');
  }

  async function makeFontCard() {
    const host = sanitize(location.hostname.replace(/^www\./, '')) || 'site';
    harvestFonts();
    await sleep(300); // give cross-origin sheets a beat
    const fams = [];
    const addFam = (ff) => {
      const f = (ff || '').split(',')[0].trim().replace(/^['"]|['"]$/g, '');
      if (f && !fams.some((x) => x.toLowerCase() === f.toLowerCase())) fams.push(f);
    };
    const h = document.querySelector('h1, h2');
    if (h) addFam(getComputedStyle(h).fontFamily);
    addFam(getComputedStyle(document.body).fontFamily);
    for (const name of fontNames) { if (fams.length >= 4) break; addFam(name); }
    if (!fams.length) throw new Error('no fonts found');

    const [c, ctx] = cardCanvas(host, 'fonts');
    fams.slice(0, 4).forEach((fam, i) => {
      const y = 205 + i * 105;
      ctx.fillStyle = '#999999';
      ctx.font = '17px -apple-system, system-ui, sans-serif';
      ctx.fillText(fam, 60, y - 44);
      ctx.fillStyle = '#111111';
      ctx.font = '400 40px "' + fam + '", sans-serif';
      ctx.fillText('Aa Bb Cc 0123 — The quick brown fox', 60, y);
    });
    await new Promise((res) => c.toBlob((b) => { saveBlob(b, host + '-fonts.png'); res(); }, 'image/png'));
    toast('Font card saved.');
  }

  /* ---------------- export (content-side downloads) ---------------- */

  function clickAnchor(a) {
    (document.body || document.documentElement).appendChild(a);
    a.click();
    a.remove();
  }

  function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'download';
    clickAnchor(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function serializeSvg(svg) {
    const clone = svg.cloneNode(true);
    if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    if (!clone.getAttribute('xmlns:xlink') && /xlink:/.test(svg.outerHTML)) {
      clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    }
    if (!clone.getAttribute('viewBox')) {
      const r = svg.getBoundingClientRect();
      if (r.width && r.height) clone.setAttribute('viewBox', '0 0 ' + Math.round(r.width) + ' ' + Math.round(r.height));
    }
    return new XMLSerializer().serializeToString(clone);
  }

  async function runContentAsset(asset) {
    try {
      if (asset.kind === 'svg' && refs.svg) {
        saveBlob(new Blob([serializeSvg(refs.svg)], { type: 'image/svg+xml' }), asset.filename);
      } else if (asset.kind === 'canvas' && refs.canvas) {
        const a = document.createElement('a');
        a.href = refs.canvas.toDataURL('image/png'); // throws if canvas is cross-origin tainted
        a.download = asset.filename;
        clickAnchor(a);
      } else if (asset.kind === 'page') {
        const html = '<!DOCTYPE html>\n' + document.documentElement.outerHTML;
        saveBlob(new Blob([html], { type: 'text/html' }), asset.filename);
      } else if (asset.kind === 'blob' && asset.url) {
        const blob = await (await fetch(asset.url)).blob();
        saveBlob(blob, asset.filename);
      } else if (asset.kind === 'component' && refs.components[asset.refIdx]) {
        await exportComponent(refs.components[asset.refIdx], asset.filename);
      } else if (asset.kind === 'kit') {
        const parts = await buildPageKit();
        if (!parts.length) throw new Error('no header/sections/footer found on this page');
        toast('Exporting page kit — ' + parts.length
          + ' parts to Downloads/' + sanitize(location.hostname.replace(/^www\./, '')));
        const host = sanitize(location.hostname.replace(/^www\./, '')) || 'site';
        parts.forEach((part, i) => {
          try {
            const p = chrome.runtime.sendMessage({
              type: 'ga-save-text',
              filename: host + '/' + String(i + 1).padStart(2, '0') + '-' + part.name + '.html',
              text: part.html,
              mime: 'text/html',
            });
            if (p && p.catch) p.catch(() => {});
          } catch (_) {}
        });
      }
    } catch (e) {
      console.warn('[Grab Anything]', e);
      toast('Grab Anything could not export this: ' + e.message);
    }
  }

  // Referer/cookie-credentialed fetch fallback, requested by the worker when
  // a plain download gets 403'd by hotlink protection.
  async function pageFetchSave(url, filename) {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) return false;
    saveBlob(await res.blob(), filename || filenameFromUrl(url, 'download'));
    return true;
  }

  let toastEl = null;
  let toastTimer = 0;
  function toast(text) {
    if (!settings.toasts) return;
    try {
      if (!toastEl || !toastEl.isConnected) {
        toastEl = document.createElement('div');
        Object.assign(toastEl.style, {
          position: 'fixed', zIndex: 2147483647, left: '50%', bottom: '24px',
          transform: 'translateX(-50%)', background: 'rgba(20,20,20,.95)',
          color: '#fff', padding: '10px 16px', borderRadius: '8px',
          font: '13px/1.4 -apple-system, system-ui, sans-serif',
          maxWidth: '70vw', boxShadow: '0 4px 16px rgba(0,0,0,.35)',
          pointerEvents: 'none',
        });
        (document.body || document.documentElement).appendChild(toastEl);
      }
      toastEl.textContent = text;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toastEl.remove(), 4000);
    } catch (_) {}
  }

  /* ---------------- wiring ---------------- */

  let lastMenuTs = 0;
  let lastMenuTarget = null;

  function onMenuOpen(e) {
    const deep = e.composedPath ? e.composedPath()[0] : e.target; // pierce shadow DOM
    let el = deep && deep.nodeType === 1 ? deep : (deep && deep.parentElement);
    if (!el) el = document.body || document.documentElement;

    // mousedown + contextmenu fire back-to-back for one gesture — build once
    if (e.timeStamp - lastMenuTs < 250 && lastMenuTarget === el) return;
    lastMenuTs = e.timeStamp;
    lastMenuTarget = el;

    harvestFonts(); // lazy, first right-click only
    lastAssets = collect(el, e.clientX, e.clientY);
    try {
      const p = chrome.runtime.sendMessage({
        type: 'ga-menu',
        assets: lastAssets.map((a) => ({
          id: a.id, gaId: a.gaId, kind: a.kind, url: a.url, filename: a.filename,
          label: a.label, method: a.method, enabled: a.enabled, refIdx: a.refIdx,
        })),
      });
      if (p && p.catch) p.catch(() => {});
    } catch (_) {}
  }

  window.addEventListener('contextmenu', onMenuOpen, { capture: true, passive: true });
  window.addEventListener('mousedown', (e) => {
    if (e.button === 2) onMenuOpen(e); // fires a beat earlier than contextmenu
  }, { capture: true, passive: true });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'ga-grab') {
      if (msg.what === 'page') {
        runContentAsset({ kind: 'page', filename: (sanitize(document.title) || 'page') + '.html' });
      } else {
        const asset = msg.gaId
          ? lastAssets.find((a) => a.gaId === msg.gaId)
          : lastAssets[msg.assetId];
        if (asset) {
          runContentAsset(asset);
        } else {
          toast('That menu was stale — right-click again and retry.');
        }
      }
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === 'ga-toast') {
      toast(msg.text);
      return;
    }
    if (msg.type === 'ga-picker-start') {
      if (window === window.top) startPicker();
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === 'ga-fullshot') {
      if (window === window.top) fullPageShot().catch((e) => toast('Screenshot failed: ' + e.message));
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === 'ga-palette') {
      if (window === window.top) makePaletteCard().catch((e) => toast('Palette failed: ' + e.message));
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === 'ga-fontcard') {
      if (window === window.top) makeFontCard().catch((e) => toast('Font card failed: ' + e.message));
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === 'ga-fetch-save') {
      pageFetchSave(msg.url, msg.filename)
        .then((ok) => sendResponse({ ok }))
        .catch(() => sendResponse({ ok: false }));
      return true;
    }
    // media inventory from the page's own performance timeline — backstop
    // for when the worker was asleep while the page loaded (MV3 doesn't
    // wake workers for observational webRequest events)
    if (msg.type === 'ga-inventory') {
      const out = new Map();
      const add = (url, kind, size) => {
        if (url && /^https?:/.test(url) && !out.has(url)) out.set(url, { url, kind, size: size || 0 });
      };
      const extKind = (url) => {
        if (/\.(jpe?g|png|gif|webp|avif|svgz?|ico|bmp)(\?|#|$)/i.test(url)) return 'image';
        if (/\.(mp4|webm|mkv|mov|m4v|mp3|m4a|aac|ogg|opus|wav|flac)(\?|#|$)/i.test(url)) return 'media';
        if (/\.(woff2?|ttf|otf|eot)(\?|#|$)/i.test(url)) return 'font';
        if (/\.(m3u8|mpd)(\?|#|$)/i.test(url)) return 'stream';
        if (/\.(pdf|zip|vtt|srt)(\?|#|$)/i.test(url)) return 'other';
        return null;
      };
      for (const img of document.querySelectorAll('img')) add(img.currentSrc || img.src, 'image');
      try {
        for (const e of performance.getEntriesByType('resource')) {
          let kind = extKind(e.name);
          if (!kind && e.initiatorType === 'img') kind = 'image';
          if (!kind) continue;
          add(e.name, kind, e.transferSize || e.decodedBodySize);
        }
      } catch (_) {}
      sendResponse({ entries: [...out.values()].slice(0, 500) });
      return;
    }
    // headless API: extract the page's building blocks and return them
    // (used by tooling that drives the extension via Playwright)
    if (msg.type === 'ga-extract-kit') {
      buildPageKit()
        .then((parts) => sendResponse({ ok: true, parts }))
        .catch((e) => sendResponse({ ok: false, error: e.message }));
      return true;
    }
    if (msg.type === 'ga-debug-sheets') {
      getAllSheets().then((sheets) => {
        let found = 0;
        const scan = (rules) => {
          for (const r of rules) {
            try {
              if (r.selectorText && msg.find && r.selectorText.includes(msg.find)) found++;
              if (r.cssRules) scan(r.cssRules);
            } catch (_) {}
          }
        };
        const summary = sheets.map((s) => {
          try { scan(s.rules); return { baseUrl: (s.baseUrl || '').slice(-50), count: s.rules.length }; }
          catch (e) { return { baseUrl: (s.baseUrl || '').slice(-50), err: e.message }; }
        });
        sendResponse({ ok: true, sheets: summary, found });
      }).catch((e) => sendResponse({ ok: false, error: e.message }));
      return true;
    }
    if (msg.type === 'ga-extract-selector') {
      (async () => {
        const el = document.querySelector(msg.selector);
        if (!el) return { ok: false, error: 'no match for ' + msg.selector };
        return { ok: true, html: await buildComponentHtml(el) };
      })().then(sendResponse).catch((e) => sendResponse({ ok: false, error: e.message }));
      return true;
    }
  });
})();
