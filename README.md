# Grab Anything

Right-click anything on any page → **Download**. Plus a toolbar popup that
lists every file the page loaded. v0.5.2 — Web Store ready.

## Features

**🎯 Element picker** — `Alt+Shift+G`, the toolbar popup, or right-click →
*Pick what to grab*. Hover highlights anything on the page (plain-English
labels + dimensions), scroll or ↑↓ widens/narrows the selection, click opens
actions: **Save as image** (pixel screenshot of just that element), **Save
design** (working HTML+CSS), **Download / Copy image**, **Copy SVG** (pastes
straight into Figma).

**📸 Screenshots** — element screenshots via the picker, plus full-page
capture (scroll-stitched, sticky headers de-duplicated, DPR-aware).

**🖼 WebP/AVIF → PNG/JPG** — images in formats photo apps refuse to open are
re-encoded locally on save (configurable; on by default).

**🗂 Gallery popup** — every image the page loaded as a thumbnail grid:
click to select, download one, or ZIP the selection / all of them into a
single archive (own dependency-free ZIP writer). Video, fonts, and stream
playlists listed below.

**🎨 Shareable cards** — one click exports a color-palette card or a
font-specimen card (1200×630 PNG) for any site.

**Onboarding + review loop** — a welcome page opens on install; after five
successful grabs the popup invites a store review (dismissable).

**Right-click menu** (two layers):
- *Native items* — Download image / video / audio / linked file, Save
  selection as .txt, Save page as HTML. Chrome targets these itself, so they
  always work — no timing races, no content script needed.
- *Smart extras* — detected per right-click: inline SVG logos (exported as
  standalone `.svg`), CSS background images (incl. `::before/::after` and
  `image-set()`), the webfont rendered on the clicked text (woff2 preferred;
  Google Fonts, constructed FontFaces and preloaded fonts all covered),
  canvas → PNG, blob images, lazy-load images (`data-src`), alternate
  `<source>` encodings, subtitle `<track>` files, video posters.

**Page kit** — one click ("Save whole page + each section" in the right-click
menu) exports the complete page plus its header, hero, every content section
and the footer as separate standalone files into `Downloads/<host>/…`.
Section discovery is layout-based (substantial visual bands), so div-built
sites work, not just ones using `<section>` tags. The same engine
is scriptable headlessly via the `ga-extract-kit` / `ga-extract-selector`
messages (see `tools/mine-components.mjs` in the parent repo).

**Component extraction** — right-click inside any navbar, card, footer or
form and choose *Save design: navigation bar* (labels are plain English,
generated from what the element actually is). You get a standalone
`.html` file containing the markup plus every CSS rule that matches it —
hover/focus states, `@media` breakpoints, the `@font-face` and `@keyframes`
it uses, resolved CSS variables, copied SVG icon sprites, absolutized URLs,
and the inherited body context so it renders exactly like it did in situ
(verified: GitHub's header exports pixel-perfect). Scripts and inline event
handlers are stripped.

**Toolbar popup** — lists every image, video, audio file, font and stream
manifest the current tab loaded over the network (webRequest, observational
only), grouped with sizes. Download single files or a whole group at once.
Catches XHR-loaded media that never appears in the DOM.

**Full-resolution upgrades** — pages render downscaled thumbnails; the
original usually sits on the CDN behind a size parameter. Right-clicked
images are automatically upgraded to the original where the pattern is
known — YouTube avatars/banners (`=s176` → `=s0`), YouTube video thumbnails
(→ `maxresdefault`), Twitter (`_normal` → original, `name=orig`), Wikipedia
thumbs, WordPress/Shopify size suffixes, generic `?w=/h=/q=` resize params —
each candidate verified before download, falling back to the rendered file.
Images with `srcset` also get a "Best-quality image" menu entry.

**Robust downloads** — 403 from a hotlink-protected CDN? It retries through
the page (referer + cookies), then through the extension's CORS-exempt
fetch, then as a data-URL. If everything fails you get an on-page toast
explaining why, never silence.

**Options page** — save into a `Grab Anything/` subfolder, toggle toasts,
the sniffer, and each detector individually. Synced across your Chrome
profiles.

## Install (Chrome / Edge / Brave / Arc — any Chromium)

1. `chrome://extensions` → **Developer mode** on
2. **Load unpacked** → select this folder
3. Right-click anything; pin the toolbar icon for the popup

Already-open tabs work immediately (it injects itself on install). After
code changes, hit ↻ on the extension card.

## Publishing

```
bash dev/build-zip.sh          # → dist/grab-anything-<version>.zip
```

`store/LISTING.md` has the listing copy, permission justifications and a
submission checklist. `store/PRIVACY.md` is the privacy policy (required).
Promo tile and explainer screenshot are pre-generated in `store/`.

## Dev / tests

```
node dev/make-assets.mjs   # regenerate icons + store art (Playwright render)
node dev/smoke.mjs         # 36-check headless E2E: menus, downloads, sniffer, settings, kit
node dev/real-site.mjs     # live check on github.com (svg + font extras, CDN avatar)
```

## Known limits

- **DRM/MSE streams (YouTube, Netflix, Spotify) can't be downloaded** — the
  media is assembled in memory from encrypted segments; there's no file to
  grab and we don't circumvent protection (Store policy + ToS). Stream
  *manifests* (`.m3u8`/`.mpd`) do show in the popup — pipe one to
  ffmpeg/yt-dlp where the site permits.
- Smart extras are computed per right-click; on a heavy page the very first
  right-click can show the previous click's extras. Native items are always
  correct.
- Tainted (cross-origin) canvases can't be exported — browser security.
- `chrome://` pages, the Web Store and the built-in PDF viewer don't allow
  content scripts.

Licensing note: being able to save something doesn't mean you own it.
