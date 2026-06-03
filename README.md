# My YouTube Styler

A local Firefox WebExtension for small YouTube Home and Subscriptions feed tweaks.

## What It Does

- Shows 6 videos per row on the YouTube Home and Subscriptions feeds.
- Shrinks card avatars, title text, and metadata text slightly.
- Hides Shorts, topic shelves, and common paid/member-only badge variants.
- Adds toolbar-popup toggles for:
  - Compact thumbnails, icons, and text
  - Hide paid/member videos
  - Hide Shorts
  - Hide You might like sections
  - Hide Explore more topics
  - Hide playlists
  - Remember seen feed videos
- Adds right-side feed filters:
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

On Home, the filters share the category-chip row, with the chips constrained to the left half and the extension controls on the right. On Subscriptions, where the chip row is not available, the extension adds a right-aligned sticky filter anchor above the feed.

The extension is scoped to `https://www.youtube.com/*`. Its JavaScript only operates on the YouTube Home path (`/`) and Subscriptions path (`/feed/subscriptions`), so it keeps working when YouTube navigates between pages without a full reload.

## Load In Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on...**.
3. Select `F:\projects\my-youtube-styler\extension\manifest.json`.
4. Open or reload `https://www.youtube.com/` or `https://www.youtube.com/feed/subscriptions`.

Temporary add-ons are unloaded when Firefox restarts. For permanent use, package and install the extension or keep loading it during testing.

## Notes

- The old Firefox profile `userContent.css` tweaks were migrated into this extension.
- The date filter reads the visible relative age text on feed video cards, such as `3 hours ago` or `2 weeks ago`.
- The view filters read visible feed metadata, such as `71 views`, `1.5K views`, or `1.5 million views`.
- Videos with unrecognized or missing age/view text are left visible.
- Selected filters are stored in the YouTube tab session only.
- Toolbar-popup settings are stored in Firefox extension storage.
- The Explore more topics toggle defaults to on.
- The playlist toggle defaults to off.
- Seen-video history stores feed video IDs with last-seen timestamps, hides them on the next Home or Subscriptions feed load or refresh, and prunes entries older than 7 days.
- Seen-video history is never uploaded anywhere.
- The popup includes a clear-history button for seen-video history.
- The popup includes a reset button for inline date/view filters.
- No network requests are made by the extension.
- Do not initialize Git inside your Firefox profile folder. Keep browser profile data out of this repo.
