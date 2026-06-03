(() => {
  const FILTER_ID = "my-youtube-styler-date-filter";
  const HIDDEN_ATTR = "data-my-youtube-styler-date-hidden";
  const STORAGE_KEY = "myYouTubeStylerDateFilter";
  const DAY = 24 * 60 * 60 * 1000;

  const filters = [
    { key: "all", label: "All", maxAgeMs: Infinity },
    { key: "7d", label: "7 days", maxAgeMs: 7 * DAY },
    { key: "1m", label: "1 month", maxAgeMs: 31 * DAY },
    { key: "1y", label: "1 year", maxAgeMs: 366 * DAY },
    { key: "5y", label: "5 years", maxAgeMs: 5 * 366 * DAY }
  ];

  let selectedFilter = readStoredFilter();
  let scheduled = false;

  function readStoredFilter() {
    try {
      const value = sessionStorage.getItem(STORAGE_KEY);
      return filters.some((filter) => filter.key === value) ? value : "all";
    } catch {
      return "all";
    }
  }

  function storeFilter(key) {
    selectedFilter = key;

    try {
      sessionStorage.setItem(STORAGE_KEY, key);
    } catch {
      // The filter still works for the current page when sessionStorage is unavailable.
    }
  }

  function getHome() {
    return document.querySelector('ytd-browse[page-subtype="home"]');
  }

  function getChipHost(home) {
    return (
      home.querySelector("yt-chip-cloud-renderer #chips") ||
      home.querySelector("ytd-feed-filter-chip-bar-renderer #chips") ||
      home.querySelector("yt-chip-cloud-renderer") ||
      home.querySelector("ytd-feed-filter-chip-bar-renderer")
    );
  }

  function ensureFilterControls(home) {
    const chipHost = getChipHost(home);
    if (!chipHost) {
      return;
    }

    let controls = document.getElementById(FILTER_ID);

    if (!controls) {
      controls = document.createElement("div");
      controls.id = FILTER_ID;
      controls.className = "my-youtube-styler-date-filter";
      controls.setAttribute("role", "group");
      controls.setAttribute("aria-label", "Filter homepage videos by age");

      const label = document.createElement("span");
      label.className = "my-youtube-styler-date-filter__label";
      label.textContent = "Newer than";
      controls.appendChild(label);

      for (const filter of filters) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "my-youtube-styler-date-filter__button";
        button.dataset.filterKey = filter.key;
        button.textContent = filter.label;
        button.addEventListener("click", () => {
          storeFilter(filter.key);
          applyHomepageTweaks();
        });
        controls.appendChild(button);
      }
    }

    if (controls.parentElement !== chipHost) {
      chipHost.appendChild(controls);
    }

    updatePressedState(controls);
  }

  function updatePressedState(controls) {
    for (const button of controls.querySelectorAll("button[data-filter-key]")) {
      button.setAttribute("aria-pressed", String(button.dataset.filterKey === selectedFilter));
    }
  }

  function getActiveFilter() {
    return filters.find((filter) => filter.key === selectedFilter) || filters[0];
  }

  function parseAgeMs(text) {
    const normalized = text
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();

    if (!normalized) {
      return null;
    }

    if (/\b(just now|today|now)\b/i.test(normalized)) {
      return 0;
    }

    if (/\byesterday\b/i.test(normalized)) {
      return DAY;
    }

    const match = normalized.match(
      /\b(\d+(?:\.\d+)?)\s*(second|sec|s|minute|min|hour|hr|h|day|d|week|wk|w|month|mo|year|yr|y)s?\s+ago\b/i
    );

    if (!match) {
      return null;
    }

    const amount = Number.parseFloat(match[1]);
    const unit = match[2].toLowerCase();
    const unitMs = {
      second: 1000,
      sec: 1000,
      s: 1000,
      minute: 60 * 1000,
      min: 60 * 1000,
      hour: 60 * 60 * 1000,
      hr: 60 * 60 * 1000,
      h: 60 * 60 * 1000,
      day: DAY,
      d: DAY,
      week: 7 * DAY,
      wk: 7 * DAY,
      w: 7 * DAY,
      month: 31 * DAY,
      mo: 31 * DAY,
      year: 366 * DAY,
      yr: 366 * DAY,
      y: 366 * DAY
    }[unit];

    return Number.isFinite(amount) && unitMs ? amount * unitMs : null;
  }

  function getCardAgeMs(card) {
    const candidates = [
      ...card.querySelectorAll(
        [
          "[aria-label]",
          "#metadata-line span",
          "ytd-video-meta-block span",
          ".ytContentMetadataViewModelMetadataText",
          ".ytLockupMetadataViewModelMetadata span"
        ].join(", ")
      )
    ];

    for (const element of candidates) {
      const ariaAge = element.getAttribute("aria-label");
      const parsedAriaAge = ariaAge ? parseAgeMs(ariaAge) : null;

      if (parsedAriaAge !== null) {
        return parsedAriaAge;
      }

      const parsedTextAge = parseAgeMs(element.textContent || "");

      if (parsedTextAge !== null) {
        return parsedTextAge;
      }
    }

    return null;
  }

  function applyDateFilter(home) {
    const activeFilter = getActiveFilter();

    for (const card of home.querySelectorAll("ytd-rich-item-renderer")) {
      if (activeFilter.key === "all") {
        card.removeAttribute(HIDDEN_ATTR);
        continue;
      }

      const ageMs = getCardAgeMs(card);
      const shouldHide = ageMs !== null && ageMs > activeFilter.maxAgeMs;

      if (shouldHide) {
        card.setAttribute(HIDDEN_ATTR, "");
      } else {
        card.removeAttribute(HIDDEN_ATTR);
      }
    }
  }

  function applyHomepageTweaks() {
    const home = getHome();

    if (!home) {
      return;
    }

    ensureFilterControls(home);
    applyDateFilter(home);
  }

  function scheduleApply() {
    if (scheduled) {
      return;
    }

    scheduled = true;
    window.requestAnimationFrame(() => {
      scheduled = false;
      applyHomepageTweaks();
    });
  }

  const observer = new MutationObserver(scheduleApply);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  window.addEventListener("yt-navigate-finish", scheduleApply);
  window.addEventListener("popstate", scheduleApply);
  window.addEventListener("pageshow", scheduleApply);

  scheduleApply();
})();

