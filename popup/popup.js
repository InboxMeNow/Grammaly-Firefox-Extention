(function () {
  "use strict";

  const api = typeof browser !== "undefined" ? browser : chrome;
  const DEFAULT_SETTINGS = {
    enabled: true,
    autoCheck: true,
    provider: "gemini",
    apiKey: "",
    endpoint: "https://generativelanguage.googleapis.com/v1beta",
    model: "gemini-3.1-flash-lite",
    minTextLength: 12,
    debounceMs: 900
  };
  const LOCAL_9ROUTER_SETTINGS = {
    provider: "openai-compatible",
    apiKey: "",
    endpoint: "http://127.0.0.1:5174/v1/chat/completions",
    model: "kr/glm-5"
  };
  const LEGACY_OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";

  const enabled = document.getElementById("enabled");
  const autoCheck = document.getElementById("autoCheck");
  const keyStatus = document.getElementById("key-status");
  const status = document.getElementById("status");
  const checkNow = document.getElementById("check-now");
  const openOptions = document.getElementById("open-options");
  const resetRouter = document.getElementById("reset-router");

  loadSettings();

  enabled.addEventListener("change", saveToggles);
  autoCheck.addEventListener("change", saveToggles);
  checkNow.addEventListener("click", runCheckOnActiveTab);
  openOptions.addEventListener("click", () => {
    api.runtime.openOptionsPage();
  });
  resetRouter.addEventListener("click", resetLocal9Router);

  async function loadSettings() {
    const stored = await api.storage.local.get(Object.keys(DEFAULT_SETTINGS));
    const settings = normalizeSettings(Object.assign({}, DEFAULT_SETTINGS, stored));

    if (
      settings.provider !== stored.provider ||
      settings.endpoint !== stored.endpoint ||
      settings.model !== stored.model ||
      settings.apiKey !== stored.apiKey
    ) {
      await api.storage.local.set({
        provider: settings.provider,
        endpoint: settings.endpoint,
        model: settings.model,
        apiKey: settings.apiKey
      });
    }

    enabled.checked = Boolean(settings.enabled);
    autoCheck.checked = Boolean(settings.autoCheck);
    keyStatus.textContent = getKeyStatus(settings);
  }

  async function saveToggles() {
    await api.storage.local.set({
      enabled: enabled.checked,
      autoCheck: autoCheck.checked
    });
    status.textContent = "Saved.";
    window.setTimeout(() => {
      status.textContent = "";
    }, 1600);
  }

  async function runCheckOnActiveTab() {
    const tabs = await api.tabs.query({ active: true, currentWindow: true });
    const tab = tabs && tabs[0];

    if (!tab || !tab.id) {
      status.textContent = "No active tab.";
      return;
    }

    try {
      await api.tabs.sendMessage(tab.id, { type: "GRAMMALY_RUN_CHECK" });
      status.textContent = "Checking selected text.";
    } catch (error) {
      status.textContent = "Open a normal webpage first.";
    }
  }

  async function resetLocal9Router() {
    await api.runtime.sendMessage({ type: "GRAMMALY_RESET_LOCAL_9ROUTER" });
    enabled.checked = true;
    autoCheck.checked = true;
    keyStatus.textContent = "Using local 9Router";
    status.textContent = "Reset. Try again.";
  }

  function getKeyStatus(settings) {
    if (isLocal9RouterEndpoint(settings.endpoint)) {
      return "Using local 9Router";
    }

    if (isGeminiEndpoint(settings.endpoint)) {
      return settings.apiKey ? "Using Gemini" : "Gemini key needed";
    }

    return settings.apiKey ? "API key configured" : "API key needed";
  }

  function isLocal9RouterEndpoint(endpoint) {
    try {
      const url = new URL(endpoint || DEFAULT_SETTINGS.endpoint);
      return (
        (url.port === "20128" || url.port === "5174") &&
        (url.pathname.startsWith("/v1/") || url.pathname.startsWith("/api/v1/"))
      );
    } catch (error) {
      return false;
    }
  }

  function normalizeSettings(settings) {
    if (!settings.endpoint || settings.endpoint === LEGACY_OPENAI_ENDPOINT) {
      return Object.assign({}, DEFAULT_SETTINGS, settings, {
        endpoint: DEFAULT_SETTINGS.endpoint,
        model: DEFAULT_SETTINGS.model,
        provider: DEFAULT_SETTINGS.provider,
        apiKey: settings.apiKey || DEFAULT_SETTINGS.apiKey
      });
    }

    if (isLocal9RouterEndpoint(settings.endpoint)) {
      if (settings.provider !== LOCAL_9ROUTER_SETTINGS.provider) {
        return Object.assign({}, DEFAULT_SETTINGS, settings, {
          provider: DEFAULT_SETTINGS.provider,
          endpoint: DEFAULT_SETTINGS.endpoint,
          model: DEFAULT_SETTINGS.model,
          apiKey: settings.apiKey || DEFAULT_SETTINGS.apiKey
        });
      }

      return Object.assign({}, settings, {
        provider: LOCAL_9ROUTER_SETTINGS.provider,
        model: settings.model || LOCAL_9ROUTER_SETTINGS.model,
        apiKey: ""
      });
    }

    if (isGeminiEndpoint(settings.endpoint)) {
      return Object.assign({}, settings, {
        provider: "gemini",
        apiKey: settings.apiKey || DEFAULT_SETTINGS.apiKey
      });
    }

    return Object.assign({}, settings, {
      provider: settings.provider || "openai-compatible"
    });
  }

  function isGeminiEndpoint(endpoint) {
    try {
      const url = new URL(endpoint || DEFAULT_SETTINGS.endpoint);
      return url.hostname === "generativelanguage.googleapis.com";
    } catch (error) {
      return false;
    }
  }
})();
