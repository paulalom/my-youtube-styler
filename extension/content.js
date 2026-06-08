(() => {
  const extensionApi = globalThis.browser || globalThis.chrome;
  const FILTER_ID = "my-youtube-styler-filter-bar";
  const CHIP_AREA_ID = "my-youtube-styler-chip-area";
  const FILTER_AREA_ID = "my-youtube-styler-filter-area";
  const SUBSCRIPTIONS_FILTER_ANCHOR_ID = "my-youtube-styler-subscriptions-filter-anchor";
  const DATE_HIDDEN_ATTR = "data-my-youtube-styler-date-hidden";
  const VIEW_HIDDEN_ATTR = "data-my-youtube-styler-view-hidden";
  const PAID_HIDDEN_ATTR = "data-my-youtube-styler-paid-hidden";
  const SEEN_HIDDEN_ATTR = "data-my-youtube-styler-seen-hidden";
  const DATE_STORAGE_KEY = "myYouTubeStylerDateFilter";
  const MIN_VIEWS_STORAGE_KEY = "myYouTubeStylerMinViewsFilter";
  const MAX_VIEWS_STORAGE_KEY = "myYouTubeStylerMaxViewsFilter";
  const SETTINGS_STORAGE_KEY = "myYouTubeStylerSettings";
  const SEEN_HISTORY_STORAGE_KEY = "myYouTubeStylerSeenVideos";
  const NOT_INTERESTED_STORAGE_KEY = "myYouTubeStylerNotInterestedVideos";
  const LEGACY_MANUAL_SEEN_STORAGE_KEY = "myYouTubeStylerManualSeenVideos";
  const RESET_FILTERS_STORAGE_KEY = "myYouTubeStylerResetFiltersAt";
  const VIEW_TONE_ATTR = "data-my-youtube-styler-view-tone";
  const AGE_TONE_ATTR = "data-my-youtube-styler-age-tone";
  const DAY = 24 * 60 * 60 * 1000;
  const VIEW_TONE_MIN = 1_000;
  const VIEW_TONE_MAX = 1_000_000;
  const AGE_TONE_MIN_MS = DAY;
  const AGE_TONE_MAX_MS = 31 * DAY;
  const TONE_HUE_RED = 4;
  const TONE_HUE_GREEN = 132;
  const FILTER_CONTROL_INTERACTION_GRACE_MS = 1200;
  const SEEN_HISTORY_MAX_AGE_MS = 7 * DAY;
  const SEEN_HISTORY_WRITE_DELAY_MS = 1500;
  const NOT_INTERESTED_CLICK_SUPPRESSION_MS = 1500;
  const NOT_INTERESTED_CLICK_SUPPRESSION_TOLERANCE_PX = 16;
  const isPrivateContext = Boolean(extensionApi?.extension?.inIncognitoContext);

  const defaultSettings = {
    compactLayout: true,
    hidePaidVideos: true,
    hideShorts: true,
    hideYouMightLike: true,
    hideExploreMoreTopics: true,
    hideFeaturedShelves: true,
    colorVideoMetadata: true,
    openVideoOnThumbnailClick: true,
    hidePlaylists: true,
    hideMiniplayer: true,
    rememberSeenVideos: false
  };

  const settingClasses = {
    compactLayout: "my-youtube-styler-compact",
    hidePaidVideos: "my-youtube-styler-hide-paid",
    hideShorts: "my-youtube-styler-hide-shorts",
    hideYouMightLike: "my-youtube-styler-hide-you-might-like",
    hideExploreMoreTopics: "my-youtube-styler-hide-explore-more-topics",
    hideFeaturedShelves: "my-youtube-styler-hide-featured",
    openVideoOnThumbnailClick: "my-youtube-styler-open-video-on-thumbnail-click",
    hidePlaylists: "my-youtube-styler-hide-playlists",
    hideMiniplayer: "my-youtube-styler-hide-miniplayer"
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
  let seenHistory = {};
  let notInterestedHistory = {};
  let hiddenSeenVideoIds = new Set();
  let currentPageSeenVideoIds = new Set();
  let seenHistoryFlushTimer = 0;
  let seenHistoryFlushInFlight = false;
  let seenHistoryWriteGeneration = 0;
  let seenObserver = null;
  let reroutingThumbnailClick = false;
  const pendingSeenVideoIds = new Set();
  let observedSeenCards = new WeakMap();
  let activeFeedKey = null;
  let chipBarRefreshScheduled = false;
  let filterControlInteractionUntil = 0;
  let notInterestedClickSuppression = null;
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

  function getLocal(keys) {
    if (!extensionApi?.storage?.local) {
      return Promise.resolve({});
    }

    if (globalThis.browser?.storage?.local) {
      return browser.storage.local.get(keys);
    }

    return new Promise((resolve) => {
      chrome.storage.local.get(keys, resolve);
    });
  }

  function setLocal(items) {
    if (!extensionApi?.storage?.local) {
      return Promise.resolve();
    }

    if (globalThis.browser?.storage?.local) {
      return browser.storage.local.set(items);
    }

    return new Promise((resolve) => {
      chrome.storage.local.set(items, resolve);
    });
  }

  function watchSettings() {
    if (!extensionApi?.storage?.onChanged) {
      return;
    }

    extensionApi.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local") {
        return;
      }

      if (changes[SETTINGS_STORAGE_KEY]) {
        settings = normalizeSettings(changes[SETTINGS_STORAGE_KEY].newValue);

        if (!settings.rememberSeenVideos) {
          discardPendingSeenHistory();
          disconnectSeenObserver();
        }

        applySettingsClasses();
        scheduleApply();
      }

      if (changes[SEEN_HISTORY_STORAGE_KEY]) {
        const changedHistory = normalizeSeenHistory(changes[SEEN_HISTORY_STORAGE_KEY].newValue);

        if (Object.keys(changedHistory).length === 0) {
          discardPendingSeenHistory();
          currentPageSeenVideoIds = getCurrentFeedVideoIds();
        }

        seenHistory = pruneSeenHistory(changedHistory);
        updateHiddenSeenVideoIds();
        disconnectSeenObserver();
        scheduleApply();
      }

      if (changes[NOT_INTERESTED_STORAGE_KEY] || changes[LEGACY_MANUAL_SEEN_STORAGE_KEY]) {
        notInterestedHistory = changes[NOT_INTERESTED_STORAGE_KEY]
          ? normalizeSeenHistory(changes[NOT_INTERESTED_STORAGE_KEY].newValue)
          : {
              ...notInterestedHistory,
              ...normalizeSeenHistory(changes[LEGACY_MANUAL_SEEN_STORAGE_KEY].newValue)
            };
        updateHiddenSeenVideoIds();
        scheduleApply();
      }

      if (changes[RESET_FILTERS_STORAGE_KEY]) {
        resetInlineFilters();
      }
    });
  }

  async function loadSettings() {
    const result = await getLocal(SETTINGS_STORAGE_KEY);
    settings = normalizeSettings(result[SETTINGS_STORAGE_KEY]);
    applySettingsClasses();
    scheduleApply();
  }

  async function loadSeenHistory() {
    if (isPrivateContext) {
      seenHistory = {};
      updateHiddenSeenVideoIds();
      disconnectSeenObserver();
      scheduleApply();
      return;
    }

    const result = await getLocal(SEEN_HISTORY_STORAGE_KEY);
    const rawHistory = normalizeSeenHistory(result[SEEN_HISTORY_STORAGE_KEY]);
    const prunedHistory = pruneSeenHistory(rawHistory);

    seenHistory = prunedHistory;
    updateHiddenSeenVideoIds();

    if (Object.keys(rawHistory).length !== Object.keys(prunedHistory).length) {
      await setLocal({ [SEEN_HISTORY_STORAGE_KEY]: prunedHistory });
    }

    scheduleApply();
  }

  async function loadNotInterestedHistory() {
    if (isPrivateContext) {
      notInterestedHistory = {};
      updateHiddenSeenVideoIds();
      scheduleApply();
      return;
    }

    const result = await getLocal([NOT_INTERESTED_STORAGE_KEY, LEGACY_MANUAL_SEEN_STORAGE_KEY]);
    const legacyHistory = normalizeSeenHistory(result[LEGACY_MANUAL_SEEN_STORAGE_KEY]);
    const migratedHistory = {
      ...legacyHistory,
      ...normalizeSeenHistory(result[NOT_INTERESTED_STORAGE_KEY])
    };

    notInterestedHistory = migratedHistory;
    updateHiddenSeenVideoIds();

    if (Object.keys(legacyHistory).length > 0) {
      await setLocal({
        [NOT_INTERESTED_STORAGE_KEY]: migratedHistory,
        [LEGACY_MANUAL_SEEN_STORAGE_KEY]: {}
      });
    }

    scheduleApply();
  }

  function normalizeSeenHistory(rawHistory) {
    if (!rawHistory || typeof rawHistory !== "object") {
      return {};
    }

    const normalizedHistory = {};

    for (const [videoId, timestamp] of Object.entries(rawHistory)) {
      if (typeof videoId === "string" && Number.isFinite(timestamp)) {
        normalizedHistory[videoId] = timestamp;
      }
    }

    return normalizedHistory;
  }

  function pruneSeenHistory(history) {
    const newestAllowedTimestamp = Date.now() - SEEN_HISTORY_MAX_AGE_MS;
    const prunedHistory = {};

    for (const [videoId, timestamp] of Object.entries(history)) {
      if (timestamp >= newestAllowedTimestamp) {
        prunedHistory[videoId] = timestamp;
      }
    }

    return prunedHistory;
  }

  function updateHiddenSeenVideoIds() {
    hiddenSeenVideoIds = new Set([
      ...Object.keys(seenHistory).filter((videoId) => !currentPageSeenVideoIds.has(videoId)),
      ...Object.keys(notInterestedHistory)
    ]);
  }

  function discardPendingSeenHistory() {
    seenHistoryWriteGeneration += 1;
    pendingSeenVideoIds.clear();

    if (seenHistoryFlushTimer) {
      window.clearTimeout(seenHistoryFlushTimer);
      seenHistoryFlushTimer = 0;
    }
  }

  function getCurrentFeedVideoIds() {
    const feedPage = getFeedPage();
    const videoIds = new Set();

    if (!feedPage) {
      return videoIds;
    }

    for (const card of feedPage.querySelectorAll("ytd-rich-item-renderer")) {
      const videoId = getCardVideoId(card);

      if (videoId) {
        videoIds.add(videoId);
      }
    }

    return videoIds;
  }

  function applySettingsClasses() {
    const root = document.documentElement;

    for (const [key, className] of Object.entries(settingClasses)) {
      root.classList.toggle(className, Boolean(settings[key]));
    }
  }

  function getSupportedFeedKey() {
    if (location.pathname === "/") {
      return "home";
    }

    if (location.pathname === "/feed/subscriptions") {
      return "subscriptions";
    }

    return null;
  }

  function isSubscriptionsFeedPath() {
    return getSupportedFeedKey() === "subscriptions";
  }

  function getFeedPage() {
    const feedKey = getSupportedFeedKey();
    const feedPage = feedKey ? findFeedPage(feedKey) : null;

    for (const previousFeedPage of document.querySelectorAll(".my-youtube-styler-feed-page")) {
      if (previousFeedPage !== feedPage) {
        previousFeedPage.classList.remove("my-youtube-styler-feed-page");
        delete previousFeedPage.dataset.myYoutubeStylerFeed;
      }
    }

    if (feedPage) {
      feedPage.classList.add("my-youtube-styler-feed-page");
      feedPage.dataset.myYoutubeStylerFeed = feedKey;
    }

    if (feedKey !== "subscriptions" || !feedPage) {
      removeSubscriptionsFilterAnchor();
    }

    return feedPage;
  }

  function findFeedPage(feedKey) {
    const primarySelector =
      feedKey === "home"
        ? 'ytd-browse[page-subtype="home"]'
        : 'ytd-browse[page-subtype="subscriptions"], ytd-browse[page-subtype="subscriptions-feed"]';
    const primaryCandidates = [...document.querySelectorAll(primarySelector)];
    const primaryPage = primaryCandidates.find(isVisibleElement);

    if (primaryPage) {
      return primaryPage;
    }

    return [...document.querySelectorAll("ytd-browse")].find((browse) => {
      const pageSubtype = browse.getAttribute("page-subtype") || "";

      if (pageSubtype) {
        const matchesFeed = feedKey === "home" ? pageSubtype === "home" : pageSubtype.includes("subscriptions");
        return matchesFeed && isVisibleElement(browse);
      }

      return isVisibleElement(browse);
    }) || null;
  }

  function isVisibleElement(element) {
    if (!element?.isConnected || element.getClientRects().length === 0) {
      return false;
    }

    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  }

  function getFilterRowTarget(feedPage) {
    const renderer = feedPage.querySelector("ytd-feed-filter-chip-bar-renderer, yt-chip-cloud-renderer");
    if (!renderer) {
      return null;
    }

    return {
      renderer,
      rowHost:
        renderer.querySelector("#chips-wrapper") ||
        renderer.querySelector("#container") ||
        renderer.querySelector("#chips-content") ||
        renderer
    };
  }

  function ensureFilterControls(feedPage) {
    const shouldUseSubscriptionsAnchor = isSubscriptionsFeedPath();
    const filterRowTarget = shouldUseSubscriptionsAnchor ? null : getFilterRowTarget(feedPage);
    let controls = document.getElementById(FILTER_ID);

    if (controls && !controls.querySelector("select[data-date-filter]")) {
      controls.remove();
      controls = null;
    }

    if (controls) {
      ensureFilterControlEventProtection(controls);

      if (controls.isConnected && isFilterControlInteractionActive()) {
        return;
      }
    }

    if (!filterRowTarget && !shouldUseSubscriptionsAnchor) {
      if (controls) {
        updateControlState(controls);
      }

      return;
    }

    if (!controls) {
      controls = document.createElement("div");
      controls.id = FILTER_ID;
      controls.className = "my-youtube-styler-filter-bar";
      controls.setAttribute("role", "group");
      controls.setAttribute("aria-label", "Filter feed videos");

      controls.appendChild(createDateGroup());
      controls.appendChild(createViewSelectGroup("Min views", "min"));
      controls.appendChild(createViewSelectGroup("Max views", "max"));
    }

    ensureFilterControlEventProtection(controls);

    if (shouldUseSubscriptionsAnchor) {
      const subscriptionsAnchor = ensureSubscriptionsFilterAnchor(feedPage);

      if (subscriptionsAnchor && controls.parentElement !== subscriptionsAnchor) {
        subscriptionsAnchor.appendChild(controls);
      }

      updateControlState(controls);
      return;
    }

    const { renderer, rowHost } = filterRowTarget;
    renderer.classList.add("my-youtube-styler-filter-renderer");
    rowHost.classList.add("my-youtube-styler-filter-row");

    const layout = ensureFilterRowLayout(rowHost);
    if (!layout) {
      return;
    }

    if (controls.parentElement !== layout.filterArea) {
      layout.filterArea.appendChild(controls);
    }

    updateControlState(controls);
  }

  function ensureSubscriptionsFilterAnchor(feedPage) {
    let anchor = document.getElementById(SUBSCRIPTIONS_FILTER_ANCHOR_ID);

    if (!anchor) {
      anchor = document.createElement("div");
      anchor.id = SUBSCRIPTIONS_FILTER_ANCHOR_ID;
      anchor.className = "my-youtube-styler-subscriptions-filter-anchor";
    }

    const richGrid = feedPage.querySelector("ytd-rich-grid-renderer");
    const sectionList = feedPage.querySelector("ytd-section-list-renderer");
    const mount =
      feedPage.querySelector("ytd-two-column-browse-results-renderer #primary") ||
      richGrid?.parentElement ||
      sectionList?.parentElement ||
      feedPage;

    if (anchor.parentElement !== mount) {
      const referenceNode =
        richGrid?.parentElement === mount ? richGrid :
        sectionList?.parentElement === mount ? sectionList :
        mount.querySelector(":scope > ytd-rich-grid-renderer, :scope > ytd-section-list-renderer, :scope > #contents");

      mount.insertBefore(anchor, referenceNode || mount.firstChild);
    }

    return anchor;
  }

  function removeSubscriptionsFilterAnchor() {
    document.getElementById(SUBSCRIPTIONS_FILTER_ANCHOR_ID)?.remove();
  }

  function syncActiveFeed() {
    const nextFeedKey = getSupportedFeedKey();

    if (nextFeedKey !== activeFeedKey) {
      flushSeenHistory();
      currentPageSeenVideoIds.clear();
      updateHiddenSeenVideoIds();
      disconnectSeenObserver();
      activeFeedKey = nextFeedKey;
    }

    return nextFeedKey;
  }

  function ensureFilterRowLayout(rowHost) {
    let chipArea = rowHost.querySelector(`:scope > #${CHIP_AREA_ID}`);
    let filterArea = rowHost.querySelector(`:scope > #${FILTER_AREA_ID}`);
    const selectedChipContent = rowHost.querySelector(":scope > #selected-chip-content");
    let layoutChanged = false;
    const chipNodes = ["left-arrow", "chips-content", "filter", "scroll-container", "chip-container", "right-arrow"]
      .map((id) => rowHost.querySelector(`:scope > #${id}`) || chipArea?.querySelector(`:scope > #${id}`))
      .filter(Boolean);

    if (chipNodes.length === 0) {
      return null;
    }

    if (!chipArea) {
      chipArea = document.createElement("div");
      chipArea.id = CHIP_AREA_ID;
      chipArea.className = "my-youtube-styler-chip-area";
      rowHost.insertBefore(chipArea, chipNodes[0]);
      layoutChanged = true;
    }

    if (!filterArea) {
      filterArea = document.createElement("div");
      filterArea.id = FILTER_AREA_ID;
      filterArea.className = "my-youtube-styler-filter-area";
      layoutChanged = true;
    }

    if (filterArea.parentElement !== rowHost) {
      rowHost.insertBefore(filterArea, selectedChipContent || chipArea.nextSibling);
      layoutChanged = true;
    } else if (selectedChipContent && filterArea.nextSibling !== selectedChipContent) {
      rowHost.insertBefore(filterArea, selectedChipContent);
      layoutChanged = true;
    } else if (!selectedChipContent && chipArea.nextSibling !== filterArea) {
      rowHost.insertBefore(filterArea, chipArea.nextSibling);
      layoutChanged = true;
    }

    for (const chipNode of chipNodes) {
      if (chipNode.parentElement !== chipArea) {
        chipArea.appendChild(chipNode);
        layoutChanged = true;
      }
    }

    if (layoutChanged) {
      scheduleChipBarRefresh();
    }

    return { chipArea, filterArea };
  }

  function getElementTarget(target) {
    return target instanceof Element ? target : target?.parentElement;
  }

  function isWithinFilterControls(element) {
    return Boolean(element?.closest?.(`#${FILTER_ID}`));
  }

  function noteFilterControlInteraction() {
    filterControlInteractionUntil = Date.now() + FILTER_CONTROL_INTERACTION_GRACE_MS;
  }

  function isFilterControlInteractionActive() {
    const activeElement = document.activeElement;

    return (
      (activeElement instanceof Element && isWithinFilterControls(activeElement)) ||
      Date.now() < filterControlInteractionUntil
    );
  }

  function ensureFilterControlEventProtection(controls) {
    if (controls.dataset.myYoutubeStylerEventsBound) {
      return;
    }

    controls.dataset.myYoutubeStylerEventsBound = "true";

    const protectControlEvent = (event) => {
      noteFilterControlInteraction();
      event.stopPropagation();
    };

    for (const eventName of [
      "pointerdown",
      "pointerup",
      "mousedown",
      "mouseup",
      "click",
      "auxclick",
      "keydown",
      "keyup",
      "input",
      "change"
    ]) {
      controls.addEventListener(eventName, protectControlEvent);
    }

    controls.addEventListener("focusin", noteFilterControlInteraction);
    controls.addEventListener("focusout", noteFilterControlInteraction);
  }

  function scheduleChipBarRefresh() {
    if (chipBarRefreshScheduled) {
      return;
    }

    chipBarRefreshScheduled = true;
    window.requestAnimationFrame(() => {
      chipBarRefreshScheduled = false;
      window.dispatchEvent(new Event("resize"));
    });
  }

  function createDateGroup() {
    const group = document.createElement("label");
    group.className = "my-youtube-styler-filter-bar__select-group";

    const label = document.createElement("span");
    label.className = "my-youtube-styler-filter-bar__label";
    label.textContent = "Newer";
    group.appendChild(label);

    const select = document.createElement("select");
    select.className = "my-youtube-styler-filter-bar__select";
    select.dataset.dateFilter = "newer";

    for (const filter of dateFilters) {
      const option = document.createElement("option");
      option.value = filter.key;
      option.textContent = filter.label;
      select.appendChild(option);
    }

    select.addEventListener("change", () => {
      selectedDateFilter = select.value;
      storeChoice(DATE_STORAGE_KEY, select.value);
      applyFeedTweaks();
    });

    group.appendChild(select);

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

      applyFeedTweaks();
    });

    group.appendChild(select);

    return group;
  }

  function updateControlState(controls) {
    const dateSelect = controls.querySelector("select[data-date-filter]");
    const minSelect = controls.querySelector('select[data-view-filter-type="min"]');
    const maxSelect = controls.querySelector('select[data-view-filter-type="max"]');

    if (dateSelect) {
      dateSelect.value = selectedDateFilter;
    }

    if (minSelect) {
      minSelect.value = selectedMinViewsFilter;
    }

    if (maxSelect) {
      maxSelect.value = selectedMaxViewsFilter;
    }
  }

  function resetInlineFilters() {
    selectedDateFilter = "all";
    selectedMinViewsFilter = "all";
    selectedMaxViewsFilter = "all";
    storeChoice(DATE_STORAGE_KEY, selectedDateFilter);
    storeChoice(MIN_VIEWS_STORAGE_KEY, selectedMinViewsFilter);
    storeChoice(MAX_VIEWS_STORAGE_KEY, selectedMaxViewsFilter);
    scheduleApply();
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

  function getCardBadgeTextCandidates(card) {
    return [
      ...card.querySelectorAll(
        [
          ".ytBadgeShapeText",
          ".badge-shape-wiz__text",
          "ytd-badge-supported-renderer",
          "yt-badge-view-model",
          "badge-shape"
        ].join(", ")
      )
    ];
  }

  function isPaidBadgeText(text) {
    const normalized = normalizeText(text).toLowerCase();

    return (
      normalized === "members only" ||
      normalized === "youtube premium" ||
      normalized === "buy or rent" ||
      normalized === "purchase"
    );
  }

  function hasPaidBadgeText(card) {
    return getCardBadgeTextCandidates(card).some((element) => isPaidBadgeText(element.textContent || ""));
  }

  function getCardStylableMetadataCandidates(card) {
    return [
      ...card.querySelectorAll(
        [
          "#metadata-line span",
          "ytd-video-meta-block span",
          ".ytContentMetadataViewModelMetadataText",
          ".ytLockupMetadataViewModelMetadata span",
          ".yt-content-metadata-view-model-wiz__metadata-text"
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

  function getToneRangeRatio(value, min, max) {
    if (!Number.isFinite(value) || max <= min) {
      return 0;
    }

    return Math.min(1, Math.max(0, (value - min) / (max - min)));
  }

  function getLogToneRangeRatio(value, min, max) {
    return getToneRangeRatio(Math.log10(value), Math.log10(min), Math.log10(max));
  }

  function getToneHue(score) {
    return Math.round(TONE_HUE_RED + (TONE_HUE_GREEN - TONE_HUE_RED) * score);
  }

  function getViewToneHue(viewCount) {
    return getToneHue(getLogToneRangeRatio(viewCount, VIEW_TONE_MIN, VIEW_TONE_MAX));
  }

  function getAgeToneHue(ageMs) {
    const recencyScore = 1 - getToneRangeRatio(ageMs, AGE_TONE_MIN_MS, AGE_TONE_MAX_MS);
    return getToneHue(recencyScore);
  }

  function getParsedMetadataValue(element, parser) {
    const ariaValue = element.getAttribute("aria-label");
    const parsedAriaValue = ariaValue ? parser(ariaValue) : null;

    if (parsedAriaValue !== null) {
      return parsedAriaValue;
    }

    return parser(element.textContent || "");
  }

  function setMetadataTone(element, attr, styleProperty, hue) {
    const hueValue = String(hue);

    if (element.getAttribute(attr) !== hueValue) {
      element.setAttribute(attr, hueValue);
    }

    if (element.style.getPropertyValue(styleProperty) !== hueValue) {
      element.style.setProperty(styleProperty, hueValue);
    }
  }

  function clearMetadataTone(element, attr, styleProperty) {
    if (element.hasAttribute(attr)) {
      element.removeAttribute(attr);
    }

    if (element.style.getPropertyValue(styleProperty)) {
      element.style.removeProperty(styleProperty);
    }
  }

  function clearElementMetadataTones(element) {
    clearMetadataTone(element, VIEW_TONE_ATTR, "--my-youtube-styler-view-hue");
    clearMetadataTone(element, AGE_TONE_ATTR, "--my-youtube-styler-age-hue");
  }

  function clearMetadataColoring(feedPage) {
    for (const element of feedPage.querySelectorAll(`[${VIEW_TONE_ATTR}], [${AGE_TONE_ATTR}]`)) {
      clearElementMetadataTones(element);
    }
  }

  function applyMetadataColoring(feedPage) {
    if (!settings.colorVideoMetadata) {
      clearMetadataColoring(feedPage);
      return;
    }

    for (const card of feedPage.querySelectorAll("ytd-rich-item-renderer")) {
      const viewToneElements = new Set();
      const ageToneElements = new Set();

      for (const element of getCardStylableMetadataCandidates(card)) {
        const viewCount = getParsedMetadataValue(element, parseViewCount);
        const ageMs = getParsedMetadataValue(element, parseAgeMs);

        if (viewCount !== null) {
          viewToneElements.add(element);
          setMetadataTone(element, VIEW_TONE_ATTR, "--my-youtube-styler-view-hue", getViewToneHue(viewCount));
        }

        if (ageMs !== null) {
          ageToneElements.add(element);
          setMetadataTone(element, AGE_TONE_ATTR, "--my-youtube-styler-age-hue", getAgeToneHue(ageMs));
        }
      }

      for (const element of card.querySelectorAll(`[${VIEW_TONE_ATTR}], [${AGE_TONE_ATTR}]`)) {
        if (!viewToneElements.has(element)) {
          clearMetadataTone(element, VIEW_TONE_ATTR, "--my-youtube-styler-view-hue");
        }

        if (!ageToneElements.has(element)) {
          clearMetadataTone(element, AGE_TONE_ATTR, "--my-youtube-styler-age-hue");
        }
      }
    }
  }

  function getCardVideoLink(card) {
    return card.querySelector('a[href*="/watch"][href*="v="]');
  }

  function getCardVideoId(card) {
    const link = getCardVideoLink(card);
    if (!link) {
      return null;
    }

    try {
      return new URL(link.getAttribute("href"), location.origin).searchParams.get("v");
    } catch {
      return null;
    }
  }

  function getCardThumbnailTarget(card) {
    return card.querySelector(
      [
        'a#thumbnail[href*="/watch"][href*="v="]',
        'a.ytLockupViewModelContentImage[href*="/watch"][href*="v="]',
        'a[href*="/watch"][href*="v="][aria-hidden="true"]',
        "ytd-thumbnail",
        "yt-thumbnail-view-model"
      ].join(", ")
    );
  }

  function isPaidPromotionHelpUrl(href) {
    if (!href) {
      return false;
    }

    try {
      const url = new URL(href, location.origin);
      return (
        url.hostname === "support.google.com" &&
        url.pathname.startsWith("/youtube") &&
        (url.pathname.includes("/answer/10588440") || url.searchParams.get("p") === "ppp")
      );
    } catch {
      return href.includes("support.google.com/youtube") && href.includes("p=ppp");
    }
  }

  function getPaidPromotionDisclosureTarget(target, card) {
    const disclosure = target?.closest?.(
      [
        ".ytp-paid-content-overlay",
        ".ytm-paid-content-overlay-renderer",
        ".YtmPaidContentOverlayHost",
        'a[href*="support.google.com/youtube" i][href*="p=ppp" i]',
        'a[href*="support.google.com/youtube/answer/10588440" i]',
        '[aria-label*="Includes paid promotion" i]',
        '[title*="Includes paid promotion" i]'
      ].join(", ")
    );

    if (disclosure && card.contains(disclosure)) {
      return disclosure;
    }

    const helpLink = target?.closest?.("a[href]");
    return helpLink && card.contains(helpLink) && isPaidPromotionHelpUrl(helpLink.getAttribute("href"))
      ? helpLink
      : null;
  }

  function isPointInsideElement(event, element) {
    if (!element) {
      return false;
    }

    for (const rect of element.getClientRects()) {
      if (
        rect.width > 0 &&
        rect.height > 0 &&
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom
      ) {
        return true;
      }
    }

    return false;
  }

  function getAbsoluteHref(link) {
    try {
      return new URL(link.getAttribute("href"), location.origin).href;
    } catch {
      return link.href || "";
    }
  }

  function followVideoLink(link, event) {
    const href = getAbsoluteHref(link);

    if (!href) {
      return;
    }

    if (event.type === "auxclick" || event.button === 1 || event.ctrlKey || event.metaKey || event.shiftKey) {
      window.open(href, "_blank", "noopener");
      return;
    }

    try {
      reroutingThumbnailClick = true;
      link.click();
    } finally {
      reroutingThumbnailClick = false;
    }
  }

  function handleThumbnailVideoClick(event) {
    if (
      !settings.openVideoOnThumbnailClick ||
      reroutingThumbnailClick ||
      event.defaultPrevented ||
      (event.type !== "click" && event.type !== "auxclick")
    ) {
      return;
    }

    if (event.type === "auxclick" && event.button !== 1) {
      return;
    }

    const target = getElementTarget(event.target);
    if (isWithinFilterControls(target)) {
      return;
    }

    const card = target?.closest?.("ytd-rich-item-renderer");

    if (!card || (!card.closest(".my-youtube-styler-feed-page") && !getSupportedFeedKey())) {
      return;
    }

    const link = getCardVideoLink(card);
    const thumbnailTarget = getCardThumbnailTarget(card) || link;
    const paidPromotionTarget = getPaidPromotionDisclosureTarget(target, card);

    if (!link || (!isPointInsideElement(event, thumbnailTarget) && !paidPromotionTarget)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    followVideoLink(link, event);
  }

  function suppressVideoMouseEvent(event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  function isPlainAltPrimaryMouseEvent(event) {
    return (
      event.button === 0 &&
      event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey
    );
  }

  function isNotInterestedStartEvent(event) {
    return (
      (event.type === "pointerdown" || event.type === "mousedown" || event.type === "click") &&
      isPlainAltPrimaryMouseEvent(event)
    );
  }

  function getNotInterestedVideoMatch(event) {
    const target = getElementTarget(event.target);
    if (isWithinFilterControls(target)) {
      return null;
    }

    const card = target?.closest?.("ytd-rich-item-renderer");

    if (!card || (!card.closest(".my-youtube-styler-feed-page") && !getSupportedFeedKey())) {
      return null;
    }

    const videoId = getCardVideoId(card);

    if (!videoId) {
      return null;
    }

    return { card, videoId };
  }

  function startNotInterestedClickSuppression(event) {
    notInterestedClickSuppression = {
      clientX: event.clientX,
      clientY: event.clientY,
      pointerId: typeof event.pointerId === "number" ? event.pointerId : null,
      until: Date.now() + NOT_INTERESTED_CLICK_SUPPRESSION_MS
    };
  }

  function isSuppressedNotInterestedFollowup(event) {
    if (!notInterestedClickSuppression || event.button !== 0) {
      return false;
    }

    if (Date.now() > notInterestedClickSuppression.until) {
      notInterestedClickSuppression = null;
      return false;
    }

    if (
      typeof event.pointerId === "number" &&
      notInterestedClickSuppression.pointerId !== null &&
      event.pointerId !== notInterestedClickSuppression.pointerId
    ) {
      return false;
    }

    const deltaX = Math.abs(event.clientX - notInterestedClickSuppression.clientX);
    const deltaY = Math.abs(event.clientY - notInterestedClickSuppression.clientY);

    return (
      deltaX <= NOT_INTERESTED_CLICK_SUPPRESSION_TOLERANCE_PX &&
      deltaY <= NOT_INTERESTED_CLICK_SUPPRESSION_TOLERANCE_PX
    );
  }

  function markNotInterestedVideo(card, videoId) {
    card.setAttribute(SEEN_HIDDEN_ATTR, "");
    recordNotInterestedVideo(videoId);
  }

  function handleNotInterestedVideoMouseEvent(event) {
    if (isSuppressedNotInterestedFollowup(event)) {
      suppressVideoMouseEvent(event);
      if (event.type === "click") {
        notInterestedClickSuppression = null;
      }
      return;
    }

    if (event.defaultPrevented || !isNotInterestedStartEvent(event)) {
      return;
    }

    const match = getNotInterestedVideoMatch(event);
    if (!match) {
      return;
    }

    suppressVideoMouseEvent(event);
    startNotInterestedClickSuppression(event);
    markNotInterestedVideo(match.card, match.videoId);
  }

  function ensureSeenObserver() {
    if (seenObserver || typeof IntersectionObserver !== "function") {
      return;
    }

    seenObserver = new IntersectionObserver(handleSeenIntersections, {
      root: null,
      threshold: 0.5
    });
  }

  function handleSeenIntersections(entries) {
    if (!settings.rememberSeenVideos) {
      return;
    }

    for (const entry of entries) {
      if (!entry.isIntersecting || entry.intersectionRatio < 0.5) {
        continue;
      }

      const card = entry.target;
      const videoId = getCardVideoId(card);

      if (!videoId || hiddenSeenVideoIds.has(videoId) || card.hasAttribute(SEEN_HIDDEN_ATTR)) {
        continue;
      }

      recordSeenVideo(videoId);
      seenObserver?.unobserve(card);
      observedSeenCards.delete(card);
    }
  }

  function recordSeenVideo(videoId) {
    if (isPrivateContext) {
      return;
    }

    if (currentPageSeenVideoIds.has(videoId)) {
      return;
    }

    currentPageSeenVideoIds.add(videoId);
    seenHistory[videoId] = Date.now();
    pendingSeenVideoIds.add(videoId);
    scheduleSeenHistoryFlush();
  }

  async function recordNotInterestedVideo(videoId) {
    if (isPrivateContext || !videoId) {
      return;
    }

    const timestamp = Date.now();
    notInterestedHistory = {
      ...notInterestedHistory,
      [videoId]: timestamp
    };
    updateHiddenSeenVideoIds();
    scheduleApply();

    try {
      const result = await getLocal([NOT_INTERESTED_STORAGE_KEY, LEGACY_MANUAL_SEEN_STORAGE_KEY]);
      const mergedHistory = {
        ...normalizeSeenHistory(result[LEGACY_MANUAL_SEEN_STORAGE_KEY]),
        ...normalizeSeenHistory(result[NOT_INTERESTED_STORAGE_KEY])
      };

      mergedHistory[videoId] = timestamp;
      notInterestedHistory = mergedHistory;
      updateHiddenSeenVideoIds();
      await setLocal({
        [NOT_INTERESTED_STORAGE_KEY]: mergedHistory,
        [LEGACY_MANUAL_SEEN_STORAGE_KEY]: {}
      });
    } catch {
      // The card stays hidden for this page even if extension storage is unavailable.
    }
  }

  function scheduleSeenHistoryFlush() {
    if (seenHistoryFlushTimer) {
      return;
    }

    seenHistoryFlushTimer = window.setTimeout(() => {
      seenHistoryFlushTimer = 0;
      flushSeenHistory();
    }, SEEN_HISTORY_WRITE_DELAY_MS);
  }

  async function flushSeenHistory() {
    if (isPrivateContext) {
      discardPendingSeenHistory();
      return;
    }

    if (seenHistoryFlushInFlight || pendingSeenVideoIds.size === 0) {
      return;
    }

    seenHistoryFlushInFlight = true;
    const writeGeneration = seenHistoryWriteGeneration;

    const pendingEntries = [...pendingSeenVideoIds].map((videoId) => [
      videoId,
      seenHistory[videoId] || Date.now()
    ]);

    pendingSeenVideoIds.clear();

    try {
      const result = await getLocal(SEEN_HISTORY_STORAGE_KEY);

      if (writeGeneration !== seenHistoryWriteGeneration) {
        return;
      }

      const mergedHistory = pruneSeenHistory(normalizeSeenHistory(result[SEEN_HISTORY_STORAGE_KEY]));

      for (const [videoId, timestamp] of pendingEntries) {
        mergedHistory[videoId] = timestamp;
      }

      seenHistory = mergedHistory;
      updateHiddenSeenVideoIds();

      await setLocal({ [SEEN_HISTORY_STORAGE_KEY]: mergedHistory });
    } finally {
      seenHistoryFlushInFlight = false;

      if (pendingSeenVideoIds.size > 0) {
        scheduleSeenHistoryFlush();
      }
    }
  }

  function applyDateFilter(feedPage) {
    const activeDateFilter = getActiveDateFilter();

    for (const card of feedPage.querySelectorAll("ytd-rich-item-renderer")) {
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

  function applyViewFilter(feedPage) {
    const minViews = getActiveViewFilter(selectedMinViewsFilter).value;
    const maxViews = getActiveViewFilter(selectedMaxViewsFilter).value;

    for (const card of feedPage.querySelectorAll("ytd-rich-item-renderer")) {
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

  function applyPaidVideoFilter(feedPage) {
    if (!settings.hidePaidVideos) {
      for (const card of feedPage.querySelectorAll("ytd-rich-item-renderer")) {
        card.removeAttribute(PAID_HIDDEN_ATTR);
      }

      return;
    }

    for (const card of feedPage.querySelectorAll("ytd-rich-item-renderer")) {
      if (hasPaidBadgeText(card)) {
        card.setAttribute(PAID_HIDDEN_ATTR, "");
      } else {
        card.removeAttribute(PAID_HIDDEN_ATTR);
      }
    }
  }

  function applySeenHistoryFilter(feedPage) {
    if (isPrivateContext) {
      disconnectSeenObserver();

      for (const card of feedPage.querySelectorAll("ytd-rich-item-renderer")) {
        card.removeAttribute(SEEN_HIDDEN_ATTR);
      }

      return;
    }

    if (settings.rememberSeenVideos) {
      ensureSeenObserver();
    } else {
      disconnectSeenObserver();
    }

    for (const card of feedPage.querySelectorAll("ytd-rich-item-renderer")) {
      const videoId = getCardVideoId(card);

      if (!videoId) {
        card.removeAttribute(SEEN_HIDDEN_ATTR);
        continue;
      }

      if (hiddenSeenVideoIds.has(videoId)) {
        card.setAttribute(SEEN_HIDDEN_ATTR, "");
        continue;
      }

      card.removeAttribute(SEEN_HIDDEN_ATTR);

      if (settings.rememberSeenVideos && !currentPageSeenVideoIds.has(videoId)) {
        observeSeenCard(card, videoId);
      }
    }
  }

  function observeSeenCard(card, videoId) {
    if (!seenObserver) {
      return;
    }

    const observedVideoId = observedSeenCards.get(card);

    if (observedVideoId === videoId) {
      return;
    }

    if (observedVideoId) {
      seenObserver.unobserve(card);
    }

    observedSeenCards.set(card, videoId);
    seenObserver.observe(card);
  }

  function disconnectSeenObserver() {
    if (!seenObserver) {
      return;
    }

    seenObserver.disconnect();
    seenObserver = null;
    observedSeenCards = new WeakMap();
  }

  function applyFeedTweaks() {
    syncActiveFeed();

    const feedPage = getFeedPage();

    applySettingsClasses();

    if (!feedPage) {
      return;
    }

    ensureFilterControls(feedPage);
    applyMetadataColoring(feedPage);
    applyPaidVideoFilter(feedPage);
    applyDateFilter(feedPage);
    applyViewFilter(feedPage);
    applySeenHistoryFilter(feedPage);
  }

  function scheduleApply() {
    if (scheduled) {
      return;
    }

    scheduled = true;
    window.requestAnimationFrame(() => {
      scheduled = false;
      applyFeedTweaks();
    });
  }

  function handleNavigateFinish() {
    syncActiveFeed();
    scheduleApply();
  }

  function handlePageHide() {
    if (seenHistoryFlushTimer) {
      window.clearTimeout(seenHistoryFlushTimer);
      seenHistoryFlushTimer = 0;
    }

    flushSeenHistory();
  }

  applySettingsClasses();
  watchSettings();
  loadSettings();
  loadSeenHistory();
  loadNotInterestedHistory();

  const observer = new MutationObserver(scheduleApply);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  window.addEventListener("yt-navigate-finish", handleNavigateFinish);
  window.addEventListener("pointerdown", handleNotInterestedVideoMouseEvent, true);
  window.addEventListener("pointerup", handleNotInterestedVideoMouseEvent, true);
  window.addEventListener("mousedown", handleNotInterestedVideoMouseEvent, true);
  window.addEventListener("mouseup", handleNotInterestedVideoMouseEvent, true);
  window.addEventListener("click", handleNotInterestedVideoMouseEvent, true);
  window.addEventListener("click", handleThumbnailVideoClick, true);
  window.addEventListener("auxclick", handleThumbnailVideoClick, true);
  window.addEventListener("popstate", scheduleApply);
  window.addEventListener("pageshow", scheduleApply);
  window.addEventListener("pagehide", handlePageHide);

  scheduleApply();
})();
