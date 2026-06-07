const extensionApi = globalThis.browser || globalThis.chrome;
const SETTINGS_STORAGE_KEY = "myYouTubeStylerSettings";
const SEEN_HISTORY_STORAGE_KEY = "myYouTubeStylerSeenVideos";
const RESET_FILTERS_STORAGE_KEY = "myYouTubeStylerResetFiltersAt";

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

function normalizeSettings(rawSettings) {
  return {
    ...defaultSettings,
    ...(rawSettings && typeof rawSettings === "object" ? rawSettings : {})
  };
}

function getStoredSettings() {
  return getLocal(SETTINGS_STORAGE_KEY);
}

function getLocal(keys) {
  if (globalThis.browser?.storage?.local) {
    return browser.storage.local.get(keys);
  }

  return new Promise((resolve) => {
    chrome.storage.local.get(keys, resolve);
  });
}

function setStoredSettings(settings) {
  return setLocal({ [SETTINGS_STORAGE_KEY]: settings });
}

function setLocal(items) {
  if (globalThis.browser?.storage?.local) {
    return browser.storage.local.set(items);
  }

  return new Promise((resolve) => {
    chrome.storage.local.set(items, resolve);
  });
}

function applyToForm(settings) {
  for (const input of document.querySelectorAll("input[data-setting]")) {
    input.checked = Boolean(settings[input.dataset.setting]);
  }
}

function applyVersionLabel() {
  const version = extensionApi?.runtime?.getManifest?.().version;
  const versionLabel = document.getElementById("extension-version");

  if (version && versionLabel) {
    versionLabel.textContent = `v${version}`;
  }
}

async function initializePopup() {
  if (!extensionApi?.storage?.local) {
    return;
  }

  applyVersionLabel();

  const result = await getStoredSettings();
  let settings = normalizeSettings(result[SETTINGS_STORAGE_KEY]);

  applyToForm(settings);
  await updateSeenHistoryStatus();

  for (const input of document.querySelectorAll("input[data-setting]")) {
    input.addEventListener("change", async () => {
      settings = {
        ...settings,
        [input.dataset.setting]: input.checked
      };

      await setStoredSettings(settings);
    });
  }

  document.getElementById("clear-history")?.addEventListener("click", clearSeenHistory);
  document.getElementById("reset-filters")?.addEventListener("click", resetInlineFilters);
}

async function clearSeenHistory() {
  const button = document.getElementById("clear-history");
  const status = document.getElementById("clear-history-status");

  if (button) {
    button.disabled = true;
    button.textContent = "Clearing";
  }

  await setLocal({ [SEEN_HISTORY_STORAGE_KEY]: {} });

  if (status) {
    status.textContent = "History cleared.";
  }

  if (button) {
    button.textContent = "Clear";
    window.setTimeout(() => {
      button.disabled = false;
    }, 500);
  }
}

async function resetInlineFilters() {
  const button = document.getElementById("reset-filters");
  const status = document.getElementById("reset-filters-status");

  if (button) {
    button.disabled = true;
    button.textContent = "Resetting";
  }

  await setLocal({ [RESET_FILTERS_STORAGE_KEY]: Date.now() });

  if (status) {
    status.textContent = "Date and view filters reset to All.";
  }

  if (button) {
    button.textContent = "Reset";
    window.setTimeout(() => {
      button.disabled = false;
    }, 500);
  }
}

async function updateSeenHistoryStatus() {
  const status = document.getElementById("clear-history-status");
  if (!status) {
    return;
  }

  const result = await getLocal(SEEN_HISTORY_STORAGE_KEY);
  const history = result[SEEN_HISTORY_STORAGE_KEY];
  const count = history && typeof history === "object" ? Object.keys(history).length : 0;

  status.textContent =
    count === 0
      ? "History expires automatically after 7 days and is never uploaded anywhere."
      : `${count} remembered. History expires automatically after 7 days and is never uploaded anywhere.`;
}

initializePopup();
