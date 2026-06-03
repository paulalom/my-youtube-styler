# My YouTube Styler

A local Firefox WebExtension for small YouTube homepage tweaks.

## What It Does

- Shows 6 videos per row on the YouTube homepage.
- Shrinks card avatars, title text, and metadata text slightly.
- Hides Shorts, topic shelves, and common paid/member-only badge variants.
- Adds toolbar-popup toggles for:
  - Compact thumbnails, icons, and text
  - Hide paid/member videos
  - Hide Shorts
  - Hide You might like sections
  - Hide Explore more topics
  - Hide playlists
  - Remember seen homepage videos
- Adds right-side homepage filters on the same row as the category chips:
  - All
  - 7 days
  - 1 month
  - 1 year
  - 5 years
- Adds min-view and max-view filters:
  - All
  - 1K
  - 10K
  - 100K
  - 1M
  - 10M
  - 100M
  - 1B

The extension is scoped to `https://www.youtube.com/*`. Its JavaScript only operates on the YouTube homepage container, `ytd-browse[page-subtype="home"]`, so it keeps working when YouTube navigates between pages without a full reload.

## Load In Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on...**.
3. Select `F:\projects\my-youtube-styler\extension\manifest.json`.
4. Open or reload `https://www.youtube.com/`.

Temporary add-ons are unloaded when Firefox restarts. For permanent use, package and install the extension or keep loading it during testing.

## Notes

- The old Firefox profile `userContent.css` tweaks were migrated into this extension.
- The date filter reads the visible relative age text on homepage video cards, such as `3 hours ago` or `2 weeks ago`.
- The view filters read visible homepage metadata, such as `71 views`, `1.5K views`, or `1.5 million views`.
- Videos with unrecognized or missing age/view text are left visible.
- Selected filters are stored in the YouTube tab session only.
- Toolbar-popup settings are stored in Firefox extension storage.
- The Explore more topics toggle defaults to on.
- The playlist toggle defaults to off.
- Seen-video history stores homepage video IDs with last-seen timestamps, hides them on the next Home load or refresh, and prunes entries older than 7 days.
- Seen-video history is never uploaded anywhere.
- The popup includes a clear-history button for seen-video history.
- The popup includes a reset button for inline date/view filters.
- No network requests are made by the extension.
- Do not initialize Git inside your Firefox profile folder. Keep browser profile data out of this repo.
