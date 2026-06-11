# Changelog

All notable changes to Grab Anything. Dates are when the version was cut.

## 0.10.1 — 2026-06-11
### Fixed
- **`Screenshot whole page` could leave the page visually broken.** If a
  frame capture failed mid-scroll, sticky/fixed headers stayed hidden and the
  scroll position wasn't restored until reload. The capture loop now restores
  the page in a `finally`, and aborts cleanly with a toast on total failure.
- **Copy-design (`buildInlineHtml`) leaked an offscreen sandbox node** if the
  computed-style loop threw. Now cleaned up in a `finally`. (Harmless — 0×0
  offscreen — but tidy.)
### Added
- This changelog.
- Regression tests: a failed full-page capture must restore sticky visibility
  and scroll position (59 checks total).

## 0.10.0 — 2026-06-11
### Added
- **Audio capture.** Video recordings now carry their sound; screen-area
  recordings capture tab audio; a new "♪ Grab audio" button rips a media
  element's audio track to `.webm`.
### Changed
- The element picker selects on `pointerdown` instead of `click`, so native
  media controls (which swallow synthesized clicks below the DOM) no longer
  block selection. A click-swallower prevents links navigating mid-pick.

## 0.9.0 — 2026-06-11
### Added
- **Record any element that moves.** Video elements record (drawn frame by
  frame); a screen-capture fallback records CSS animations and any visible
  region, cropped to the picked element.
- **GIF export** via a from-scratch, dependency-free GIF89a encoder (LZW +
  Floyd–Steinberg dithering) — [gif.js](gif.js).

## 0.8.0 — 2026-06-11
### Added
- **Record live canvas/WebGL animations to `.webm`** from the picker.
### Changed
- "Save design" on a canvas-dominated element now falls back to a still image
  (no HTML exists for WebGL output) and points to the new record button.

## 0.7.x — 2026-06-11
### Added
- **"Copy design"** — component to clipboard with computed styles inlined
  (rich HTML flavor) plus standalone code (plain-text flavor).
- **11-language localization** (`_locales/`) + localized store copy.
- Onboarding page, review prompt, options page, WebP/AVIF→PNG conversion.
### Fixed
- 8 defects from an adversarial review: tabId plumbing for popup/picker
  downloads, sniffer restart merge, filename sanitization, ghost gallery
  selections, honest ZIP status, conversion fallback + size caps, runtime
  store URL.

## 0.5.x – 0.6.x — 2026-06-11
### Added
- Element picker (`Alt+Shift+G`), element + full-page screenshots, gallery
  popup with ZIP export, palette/font cards, page-kit export, friendly
  plain-English labels, content-addressed menu ids (stale-menu safety).

## 0.3.x – 0.4.x — 2026-06-11
### Added
- Full-resolution image upgrades (CDN original), component → HTML+CSS export,
  toolbar popup + media sniffer, icons and Web Store packaging.

## 0.1.0 — 2026-06-11
- First build: right-click → download images, inline SVG, webfonts,
  backgrounds, video/audio, canvas, links, selections, whole page.
