const extensionApi = globalThis.browser || globalThis.chrome;
const SETTINGS_STORAGE_KEY = "myYouTubeStylerSettings";

const defaultSettings = {
  compactLayout: true,
  hidePaidVideos: true,
  hideShorts: true,
  hideYouMightLike: true
};

function normalizeSettings(rawSettings) {
  return {
    ...defaultSettings,
    ...(rawSettings && typeof rawSettings === "object" ? rawSettings : {})
  };
}

function getStoredSettings() {
  if (globalThis.browser?.storage?.local) {
    return browser.storage.local.get(SETTINGS_STORAGE_KEY);
  }

  return new Promise((resolve) => {
    chrome.storage.local.get(SETTINGS_STORAGE_KEY, resolve);
  });
}

function setStoredSettings(settings) {
  if (globalThis.browser?.storage?.local) {
    return browser.storage.local.set({ [SETTINGS_STORAGE_KEY]: settings });
  }

  return new Promise((resolve) => {
    chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: settings }, resolve);
  });
}

function applyToForm(settings) {
  for (const input of document.querySelectorAll("input[data-setting]")) {
    input.checked = Boolean(settings[input.dataset.setting]);
  }
}

async function initializePopup() {
  if (!extensionApi?.storage?.local) {
    return;
  }

  const result = await getStoredSettings();
  let settings = normalizeSettings(result[SETTINGS_STORAGE_KEY]);

  applyToForm(settings);

  for (const input of document.querySelectorAll("input[data-setting]")) {
    input.addEventListener("change", async () => {
      settings = {
        ...settings,
        [input.dataset.setting]: input.checked
      };

      await setStoredSettings(settings);
    });
  }
}

initializePopup();

