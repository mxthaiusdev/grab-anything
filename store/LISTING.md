# Chrome Web Store listing — Grab Anything (v0.7.0)

## Name (from manifest)
Grab Anything

## Short description (110/132 chars — from manifest, shown under the name)
Right-click or point-and-pick to download anything: images at full quality, logos, fonts, video, whole designs.

## Category
Tools

## Language
English (default) — localized listings for 10 more languages in `store/locales/`
(es, fr, de, pt_BR, it, ja, ko, ru, zh_CN, hi). Paste each into the dashboard's
per-language listing fields; the extension UI localizes automatically.

## Detailed description (English)

Save anything you can see — in one right-click or one point-and-click.

WHAT IT GRABS
• Images at the BEST QUALITY the site has — thumbnails are auto-upgraded to
  the CDN original (YouTube avatars, video thumbnails, Twitter, Wikipedia,
  WordPress and more), verified before download
• WebP/AVIF saved as PNG or JPG automatically — no more files your photo
  apps refuse to open
• Logos as crisp SVG files, the fonts a page uses, video & audio files,
  subtitles, backgrounds — even ones hidden behind overlays
• Whole designs: save a navigation bar, hero or footer as a working
  HTML+CSS file you can open and study — or export every section of a page
  in one click

THE ELEMENT PICKER
Press Alt+Shift+G and point at anything: it highlights with a plain-English
label, scroll widens the selection, click saves it as a pixel-perfect image
or a design file. Copy SVG pastes straight into Figma.

RECORD ANYTHING THAT MOVES
Capture a canvas, WebGL animation, video or any region of the page to
video, GIF or audio — with sound. If it plays on your screen, you can save
the motion, not just a still.

SAVE AS MARKDOWN
Grab an article or section as clean Markdown — headings, links, lists,
tables, code and images — straight into your notes, docs or a file.

GRAB DESIGN TOKENS
Export a page's whole design system in one file: color palette, fonts, type
scale, spacing, radii and shadows, as JSON, CSS variables and a Tailwind
config.

THE GALLERY POPUP
The toolbar popup shows every image, video and font the page loaded — even
files JavaScript fetched behind the scenes — as a thumbnail grid. Download
one, a selection, or everything as a single ZIP. Plus one-click color
palette and font specimen cards for any site.

PRIVACY FIRST
Everything runs locally on your device. No accounts, no analytics, no
tracking — nothing ever leaves your machine. Protected video streams
(YouTube, Netflix) can't be saved: that's a browser-wide rule we don't
circumvent, by design and by policy.

## Single-purpose statement
The extension's single purpose is letting the user save assets (images,
fonts, graphics, audio/video, page designs) from the web page they are
viewing.

## Permission justifications (paste into the Privacy tab)
- contextMenus — the core UI: "Download …" / "Save design …" entries in the
  right-click menu.
- downloads — saving the user's chosen files to their Downloads folder.
- storage — user settings (sync) and the per-tab media list (session,
  auto-deleted on navigation). A local counter for the review prompt.
- scripting — injecting the detector into tabs already open at install
  time, so the extension works without a browser restart.
- webRequest (observational only) — building the popup's list of media the
  current tab loaded. No requests are modified, redirected, or blocked.
- clipboardWrite — the picker's "Copy image" / "Copy SVG" actions.
- activeTab implication via commands — the Alt+Shift+G shortcut starts the
  on-page element picker.
- host_permissions <all_urls> — the user can right-click on any site they
  visit; asset detection, screenshot capture and download fallbacks must
  work wherever they browse. No data is collected or transmitted anywhere.

## Data collection disclosure (Privacy tab questionnaire)
- Does NOT collect or use any user data. Tick "No" / "None" for every
  category (personally identifiable info, health, financial, location, web
  history, user activity, website content). Nothing is transmitted.

## Assets (this folder)
- promo-440x280.png — small promo tile
- screenshot-picker.png (1280x800) — REAL screenshot: picker in action
- screenshot-gallery.png (1280x800) — REAL screenshot: gallery popup + ZIP
- screenshot-1280x800.png — context-menu explainer
- Use all three screenshots; picker first (it demos best).

## Privacy policy
store/PRIVACY.md — paste as text, or publish the GitHub repo and link the
raw file URL.
