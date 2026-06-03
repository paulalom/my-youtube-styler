(() => {
  const extensionApi = globalThis.browser || globalThis.chrome;
  const FILTER_ID = "my-youtube-styler-filter-bar";
  const DATE_HIDDEN_ATTR = "data-my-youtube-styler-date-hidden";
  const VIEW_HIDDEN_ATTR = "data-my-youtube-styler-view-hidden";
  const DATE_STORAGE_KEY = "myYouTubeStylerDateFilter";
  const MIN_VIEWS_STORAGE_KEY = "myYouTubeStylerMinViewsFilter";
  const MAX_VIEWS_STORAGE_KEY = "myYouTubeStylerMaxViewsFilter";
  const SETTINGS_STORAGE_KEY = "myYouTubeStylerSettings";
  const DAY = 24 * 60 * 60 * 1000;

  const defaultSettings = {
    compactLayout: true,
    hidePaidVideos: true,
    hideShorts: true,
    hideYouMightLike: true
  };

  const settingClasses = {
    compactLayout: "my-youtube-styler-compact",
    hidePaidVideos: "my-youtube-styler-hide-paid",
    hideShorts: "my-youtube-styler-hide-shorts",
    hideYouMightLike: "my-youtube-styler-hide-you-might-like"
  };

  const dateFilters = [
    { key: "all", label: "All", maxAgeMs: Infinity },
    { key: "7d", label: "7 days", maxAgeMs: 7 * DAY },
    { key: "1m", label: "1 month", maxAgeMs: 31 * DAY },
    { key: "1y", label: "1 year", maxAgeMs: 366 * DAY },
    { key: "5y", label: "5 years", maxAgeMs: 5 * 366 * DAY }
  ];

  const viewFilters = [
    { key: "all", label: "All", value: null },
    { key: "1k", label: "1K", value: 1_000 },
    { key: "10k", label: "10K", value: 10_000 },
    { key: "100k", label: "100K", value: 100_000 },
    { key: "1m", label: "1M", value: 1_000_000 },
    { key: "10m", label: "10M", value: 10_000_000 },
    { key: "100m", label: "100M", value: 100_000_000 },
    { key: "1b", label: "1B", value: 1_000_000_000 }
  ];

  let settings = { ...defaultSettings };
  let selectedDateFilter = readStoredChoice(DATE_STORAGE_KEY, dateFilters, "all");
  let selectedMinViewsFilter = readStoredChoice(MIN_VIEWS_STORAGE_KEY, viewFilters, "all");
  let selectedMaxViewsFilter = readStoredChoice(MAX_VIEWS_STORAGE_KEY, viewFilters, "all");
  let scheduled = false;

  function readStoredChoice(storageKey, choices, fallback) {
    try {
      const value = sessionStorage.getItem(storageKey);
      return choices.some((choice) => choice.key === value) ? value : fallback;
    } catch {
      return fallback;
    }
  }

  function storeChoice(storageKey, key) {
    try {
      sessionStorage.setItem(storageKey, key);
    } catch {
      // The filters still work for the current page when sessionStorage is unavailable.
    }
  }

  function normalizeSettings(rawSettings) {
    return {
      ...defaultSettings,
      ...(rawSettings && typeof rawSettings === "object" ? rawSettings : {})
    };
  }

  function getStoredSettings() {
    if (!extensionApi?.storage?.local) {
      return Promise.resolve({});
    }

    if (globalThis.browser?.storage?.local) {
      return browser.storage.local.get(SETTINGS_STORAGE_KEY);
    }

    return new Promise((resolve) => {
      chrome.storage.local.get(SETTINGS_STORAGE_KEY, resolve);
    });
  }

  function watchSettings() {
    if (!extensionApi?.storage?.onChanged) {
      return;
    }

    extensionApi.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local" || !changes[SETTINGS_STORAGE_KEY]) {
        return;
      }

      settings = normalizeSettings(changes[SETTINGS_STORAGE_KEY].newValue);
      applySettingsClasses();
      scheduleApply();
    });
  }

  async function loadSettings() {
    const result = await getStoredSettings();
    settings = normalizeSettings(result[SETTINGS_STORAGE_KEY]);
    applySettingsClasses();
    scheduleApply();
  }

  function applySettingsClasses() {
    const root = document.documentElement;

    for (const [key, className] of Object.entries(settingClasses)) {
      root.classList.toggle(className, Boolean(settings[key]));
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
      controls.className = "my-youtube-styler-filter-bar";
      controls.setAttribute("role", "group");
      controls.setAttribute("aria-label", "Filter homepage videos");

      controls.appendChild(createDateGroup());
      controls.appendChild(createViewSelectGroup("Min views", "min"));
      controls.appendChild(createViewSelectGroup("Max views", "max"));
    }

    if (controls.parentElement !== chipHost) {
      chipHost.appendChild(controls);
    }

    updateControlState(controls);
  }

  function createDateGroup() {
    const group = document.createElement("div");
    group.className = "my-youtube-styler-filter-bar__group";

    const label = document.createElement("span");
    label.className = "my-youtube-styler-filter-bar__label";
    label.textContent = "Newer";
    group.appendChild(label);

    for (const filter of dateFilters) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "my-youtube-styler-filter-bar__button";
      button.dataset.dateFilterKey = filter.key;
      button.textContent = filter.label;
      button.addEventListener("click", () => {
        selectedDateFilter = filter.key;
        storeChoice(DATE_STORAGE_KEY, filter.key);
        applyHomepageTweaks();
      });
      group.appendChild(button);
    }

    return group;
  }

  function createViewSelectGroup(labelText, type) {
    const group = document.createElement("label");
    group.className = "my-youtube-styler-filter-bar__select-group";

    const label = document.createElement("span");
    label.className = "my-youtube-styler-filter-bar__label";
    label.textContent = labelText;
    group.appendChild(label);

    const select = document.createElement("select");
    select.className = "my-youtube-styler-filter-bar__select";
    select.dataset.viewFilterType = type;

    for (const filter of viewFilters) {
      const option = document.createElement("option");
      option.value = filter.key;
      option.textContent = filter.label;
      select.appendChild(option);
    }

    select.addEventListener("change", () => {
      if (type === "min") {
        selectedMinViewsFilter = select.value;
        storeChoice(MIN_VIEWS_STORAGE_KEY, select.value);
      } else {
        selectedMaxViewsFilter = select.value;
        storeChoice(MAX_VIEWS_STORAGE_KEY, select.value);
      }

      applyHomepageTweaks();
    });

    group.appendChild(select);

    return group;
  }

  function updateControlState(controls) {
    for (const button of controls.querySelectorAll("button[data-date-filter-key]")) {
      button.setAttribute("aria-pressed", String(button.dataset.dateFilterKey === selectedDateFilter));
    }

    const minSelect = controls.querySelector('select[data-view-filter-type="min"]');
    const maxSelect = controls.querySelector('select[data-view-filter-type="max"]');

    if (minSelect) {
      minSelect.value = selectedMinViewsFilter;
    }

    if (maxSelect) {
      maxSelect.value = selectedMaxViewsFilter;
    }
  }

  function getActiveDateFilter() {
    return dateFilters.find((filter) => filter.key === selectedDateFilter) || dateFilters[0];
  }

  function getActiveViewFilter(key) {
    return viewFilters.find((filter) => filter.key === key) || viewFilters[0];
  }

  function parseAgeMs(text) {
    const normalized = normalizeText(text).toLowerCase();

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

  function parseViewCount(text) {
    const normalized = normalizeText(text).toLowerCase();

    if (!/\b(view|views)\b/.test(normalized)) {
      return null;
    }

    const match = normalized.match(
      /\b(\d+(?:[,.]\d+)?)\s*(k|m|b|thousand|million|billion)?\s+(?:view|views)\b/i
    );

    if (!match) {
      return null;
    }

    const rawAmount = match[1];
    const suffix = (match[2] || "").toLowerCase();
    const amount = parseLocalizedNumber(rawAmount, suffix);
    const multiplier = {
      "": 1,
      k: 1_000,
      m: 1_000_000,
      b: 1_000_000_000,
      thousand: 1_000,
      million: 1_000_000,
      billion: 1_000_000_000
    }[suffix];

    return Number.isFinite(amount) && multiplier ? amount * multiplier : null;
  }

  function parseLocalizedNumber(rawAmount, suffix) {
    const hasSuffix = Boolean(suffix);
    const hasComma = rawAmount.includes(",");
    const hasDot = rawAmount.includes(".");

    if (hasSuffix && hasComma && !hasDot) {
      return Number.parseFloat(rawAmount.replace(",", "."));
    }

    return Number.parseFloat(rawAmount.replace(/,/g, ""));
  }

  function normalizeText(text) {
    return (text || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getCardMetadataCandidates(card) {
    return [
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
  }

  function getCardAgeMs(card) {
    for (const element of getCardMetadataCandidates(card)) {
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

  function getCardViewCount(card) {
    for (const element of getCardMetadataCandidates(card)) {
      const ariaViews = element.getAttribute("aria-label");
      const parsedAriaViews = ariaViews ? parseViewCount(ariaViews) : null;

      if (parsedAriaViews !== null) {
        return parsedAriaViews;
      }

      const parsedTextViews = parseViewCount(element.textContent || "");

      if (parsedTextViews !== null) {
        return parsedTextViews;
      }
    }

    return null;
  }

  function applyDateFilter(home) {
    const activeDateFilter = getActiveDateFilter();

    for (const card of home.querySelectorAll("ytd-rich-item-renderer")) {
      if (activeDateFilter.key === "all") {
        card.removeAttribute(DATE_HIDDEN_ATTR);
        continue;
      }

      const ageMs = getCardAgeMs(card);
      const shouldHide = ageMs !== null && ageMs > activeDateFilter.maxAgeMs;

      if (shouldHide) {
        card.setAttribute(DATE_HIDDEN_ATTR, "");
      } else {
        card.removeAttribute(DATE_HIDDEN_ATTR);
      }
    }
  }

  function applyViewFilter(home) {
    const minViews = getActiveViewFilter(selectedMinViewsFilter).value;
    const maxViews = getActiveViewFilter(selectedMaxViewsFilter).value;

    for (const card of home.querySelectorAll("ytd-rich-item-renderer")) {
      if (minViews === null && maxViews === null) {
        card.removeAttribute(VIEW_HIDDEN_ATTR);
        continue;
      }

      const viewCount = getCardViewCount(card);
      const shouldHide =
        viewCount !== null &&
        ((minViews !== null && viewCount < minViews) || (maxViews !== null && viewCount > maxViews));

      if (shouldHide) {
        card.setAttribute(VIEW_HIDDEN_ATTR, "");
      } else {
        card.removeAttribute(VIEW_HIDDEN_ATTR);
      }
    }
  }

  function applyHomepageTweaks() {
    const home = getHome();

    applySettingsClasses();

    if (!home) {
      return;
    }

    ensureFilterControls(home);
    applyDateFilter(home);
    applyViewFilter(home);
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

  applySettingsClasses();
  watchSettings();
  loadSettings();

  const observer = new MutationObserver(scheduleApply);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  window.addEventListener("yt-navigate-finish", scheduleApply);
  window.addEventListener("popstate", scheduleApply);
  window.addEventListener("pageshow", scheduleApply);

  scheduleApply();
})();
