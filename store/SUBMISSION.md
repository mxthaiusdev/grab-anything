# Push-to-store guide — click by click

Everything referenced here is pre-written in this folder. Total hands-on
time: ~30 minutes + review wait.

## 0. The one thing that costs money
Chrome Web Store developer registration: **$5, one-time, forever**.
That's the only mandatory cost in this entire process.

## 1. Register (once)
1. Go to https://chrome.google.com/webstore/devconsole
2. Sign in with the Google account you want to own the extension
   (consider a dedicated account — the publisher email is public)
3. Pay the $5 registration fee, accept the developer agreement
4. In Account settings: verify your contact email (required to publish)

## 2. Upload
1. Developer Dashboard → **+ New item**
2. Upload `dist/grab-anything-0.7.0.zip`
3. The dashboard reads the manifest: name, version, icons all auto-fill

## 3. Store listing tab
- Description: paste the detailed description from `store/LISTING.md`
- Category: **Tools**; Language: English
- Graphics: upload `store/screenshot-picker.png`,
  `store/screenshot-gallery.png`, `store/screenshot-1280x800.png`
  (in that order) and `store/promo-440x280.png` as the small promo tile
- Optional but worth it: add each language from `store/locales/` via
  "Add language" — paste its short + detailed description

## 4. Privacy tab (this is what reviewers read)
- Single purpose: paste from LISTING.md
- Permission justifications: paste each from LISTING.md
- Data usage: check **no data collected** in every category, certify
- Privacy policy: paste `store/PRIVACY.md` contents to a public URL —
  easiest: make the GitHub repo public and use the raw file link, or a
  GitHub Gist (free, 2 minutes)

## 5. Distribution tab
- Visibility: **Public**
- Regions: all

## 6. Submit
- Click **Submit for review**. Broad host permissions trigger in-depth
  review: expect **a few days to ~2 weeks**. Don't resubmit while pending.
- If rejected, it's almost always a permission-justification wording issue —
  reply using the justifications text, don't change code reflexively.

## 7. The moment it's published
1. Copy the real listing URL (chromewebstore.google.com/detail/…)
2. Put it in `popup.js` → `STORE_URL` (the review prompt links there)
3. Bump version to 0.7.1, `bash dev/build-zip.sh`, upload the update
4. Pin a 5-star review from your own account? No — never review your own
   product; ask real friends who actually use it.

## Free distribution multipliers (do the same week)
- **Edge Add-ons** (free registration): https://partner.microsoft.com/dashboard/microsoftedge
  — upload the SAME `grab-anything-0.7.0.zip`. Less competition, free installs.
- **Firefox AMO** (free): https://addons.mozilla.org/developers/
  — upload `dist/grab-anything-0.7.0-firefox.zip`. Best-effort port: install
  it in Firefox yourself first and click through the basics before submitting.
- Make the GitHub repo public for the open-source trust play (one click in
  repo Settings → it's currently private at github.com/mxthaiusdev/grab-anything)
- Launch posts: Product Hunt + Show HN + a 30-second screen recording of the
  picker grabbing a logo/font/navbar (that clip IS the marketing)

## What's deliberately NOT in v1 (don't let review stall on it)
- No YouTube/DRM downloading — never add it; it's the #1 takedown cause
- No analytics — keep it that way; "zero tracking" is the brand
