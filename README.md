# My YouTube Styler

My YouTube Styler is a local Firefox WebExtension that makes YouTube's Home and Subscriptions feeds denser, quieter, and easier to scan. It keeps the normal YouTube experience, but trims visual weight, adds feed filters, and lets you hide sections that tend to interrupt browsing.

The extension runs only in your browser, stores settings locally, and does not make network requests.

## Features

- Shows 6 videos per row on the YouTube Home and Subscriptions feeds.
- Shrinks card avatars, title text, and metadata text slightly.
- Colors visible view counts and video ages from green to red based on popularity and freshness.
- Adds date filters for videos newer than 7 days, 1 month, 1 year, or 5 years.
- Adds minimum and maximum view-count filters from 1K through 1B views.
- Remembers videos you have already seen and hides them on the next feed load or refresh, with a 7-day rolling history.
- Routes thumbnail-overlay clicks, including paid-promotion overlays, to the video page.
- Hides Shorts, topic shelves, YouTube featured shelves, playlists, YouTube's bottom-right miniplayer, "You might like" sections, and common paid/member-only badge variants.
- Adds toolbar popup toggles for:
  - Compact thumbnails, icons, and text
  - Color views and age
  - Hide paid/member videos
  - Open video from thumbnail clicks
  - Hide Shorts
  - Hide You might like sections
  - Hide Explore more topics
  - Hide YouTube featured shelves
  - Hide playlists
  - Hide miniplayer
  - Remember seen feed videos

On Home, the filters share the category-chip row, with the chips constrained to the left half and the extension controls on the right. On Subscriptions, where the chip row is not available, the extension adds a right-aligned sticky filter anchor above the feed.

The extension is scoped to `https://www.youtube.com/*`. Its JavaScript only operates on the YouTube Home path (`/`) and Subscriptions path (`/feed/subscriptions`), so it keeps working when YouTube navigates between pages without a full reload.

## Examples

Firefox v0.6.4 examples:

![YouTube homepage with compact styling](examples/firefox-v0.6.4/homepage.PNG)

![My YouTube Styler options popup](examples/firefox-v0.6.4/styler-options.PNG)

## Install In Firefox

This is an unsigned local extension, so the simplest way to try it is as a temporary Firefox add-on.

1. Download or clone this repo.
2. Open Firefox.
3. Go to `about:debugging#/runtime/this-firefox`.
4. Click **Load Temporary Add-on...**.
5. Select `extension/manifest.json` from this repo.
6. Open or reload `https://www.youtube.com/` or `https://www.youtube.com/feed/subscriptions`.

Temporary add-ons are unloaded when Firefox restarts. During development, reload the temporary add-on from the same Firefox debugging page after pulling changes or editing extension files.

## Privacy

- No network requests are made by the extension.
- Settings are stored in Firefox extension storage.
- Selected inline date/view filters are stored only in the YouTube tab session.
- Seen-video history stores video IDs with last-seen timestamps, prunes entries older than 7 days, and is never uploaded anywhere.

## Notes

- The date filter reads the visible relative age text on feed video cards, such as `3 hours ago` or `2 weeks ago`.
- The view filters read visible feed metadata, such as `71 views`, `1.5K views`, or `1.5 million views`.
- Videos with unrecognized or missing age/view text are left visible.
