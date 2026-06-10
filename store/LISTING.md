# Chrome Web Store listing — Grab Anything

## Name
Grab Anything — right-click downloader

## Short description (max 132 chars)
Right-click → download anything: images, SVG logos, webfonts, backgrounds, video — plus a popup listing every file a page loads.

## Category
Tools

## Detailed description

Save the things browsers make annoying to save — in one right-click.

WHAT IT GRABS
• Images — including srcset, lazy-loaded and CDN URLs without file extensions
• FULL RESOLUTION: thumbnails are auto-upgraded to the CDN original where
  possible (YouTube avatars and video thumbnails, Twitter, Wikipedia,
  WordPress/Shopify size suffixes) — verified before download
• Inline SVG logos — exported as standalone .svg files (most site logos!)
• CSS background images — even on pseudo-elements and image-set()
• Webfonts — right-click any text and download the actual font file (woff2), Google Fonts included
• Video & audio with real sources, alternate encodings, posters and subtitle tracks
• Canvas drawings as PNG
• Linked files, selections as .txt, whole pages as HTML

COMPONENT EXTRACTION
Right-click a navbar, card or footer → "Save design" exports it
as a standalone file: markup plus every matching CSS rule, hover states,
media queries, fonts, keyframes and CSS variables included. Open it and the
component renders exactly as it did on the page — perfect for studying how
a design was built.

THE POPUP
The toolbar popup lists every image, font, video and stream manifest the
current page loaded over the network — including files added by JavaScript
that never appear in the DOM. Download one, or all of them at once.

ROBUST DOWNLOADS
If a CDN blocks the direct download (hotlink protection), Grab Anything
automatically retries through the page itself and then through the
extension's own fetch. If nothing works you get an on-page explanation, not
silence.

HONEST LIMITS
DRM/MSE streams (YouTube, Netflix, Spotify) cannot be downloaded — there is
no file to grab, and we don't try to circumvent protection.

PRIVACY
Everything runs locally. No analytics, no tracking, no data ever leaves
your machine. See the privacy policy.

## Single-purpose statement
The extension's single purpose is letting the user download media assets
(images, fonts, SVG, audio/video, documents) from the page they are viewing.

## Permission justifications
- contextMenus — the core UI: "Download …" entries in the right-click menu.
- downloads — saving the chosen file to the user's Downloads folder.
- storage — user settings (sync) and the per-tab media list (session).
- scripting — injecting the detector into tabs already open at install time,
  so the extension works without a browser restart.
- webRequest (observational only) — building the popup's list of media files
  the current tab loaded. No requests are modified or blocked.
- host_permissions <all_urls> — the user can right-click on any site; asset
  detection and download fallbacks must work wherever they browse. No data
  is collected or transmitted.

## Assets in this folder
- promo-440x280.png — small promo tile
- screenshot-1280x800.png — listing screenshot (explainer)
Take 1-2 additional real screenshots (context menu open on a real site, the
popup listing a busy page) before submitting.

## Submission checklist
1. `bash dev/build-zip.sh` → upload `dist/grab-anything-<version>.zip`
2. Developer account ($5 one-time), verified email
3. Privacy tab: link/paste PRIVACY.md, declare "no data collected"
4. Justify each permission (copy from above)
5. Expect an in-depth review (broad host permissions) — typically days, not hours
