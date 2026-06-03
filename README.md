# My YouTube Styler

A local Firefox WebExtension for small YouTube homepage tweaks.

## What It Does

- Shows 6 videos per row on the YouTube homepage.
- Shrinks title and metadata text slightly.
- Hides Shorts, topic shelves, and common paid/member-only badge variants.
- Adds a homepage date filter beside the category chips:
  - All
  - 7 days
  - 1 month
  - 1 year
  - 5 years

The extension is scoped to `https://www.youtube.com/*`. Its JavaScript only operates on the YouTube homepage container, `ytd-browse[page-subtype="home"]`, so it keeps working when YouTube navigates between pages without a full reload.

## Load In Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on...**.
3. Select `F:\projects\my-youtube-styler\extension\manifest.json`.
4. Open or reload `https://www.youtube.com/`.

Temporary add-ons are unloaded when Firefox restarts. For permanent use, package and install the extension or keep loading it during testing.

## Notes

- The date filter reads the visible relative age text on homepage video cards, such as `3 hours ago` or `2 weeks ago`.
- Videos with unrecognized or missing age text are left visible.
- The selected date filter is stored in the YouTube tab session only.
- No network requests are made by the extension.
- Do not initialize Git inside your Firefox profile folder. Keep browser profile data out of this repo.

