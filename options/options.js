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

  const form = document.getElementById("settings-form");
  const reset9Router = document.getElementById("reset-9router");
  const status = document.getElementById("status");
  const fields = {
    enabled: document.getElementById("enabled"),
    autoCheck: document.getElementById("autoCheck"),
    apiKey: document.getElementById("apiKey"),
    endpoint: document.getElementById("endpoint"),
    model: document.getElementById("model"),
    minTextLength: document.getElementById("minTextLength"),
    debounceMs: document.getElementById("debounceMs")
  };

  loadSettings();
  form.addEventListener("submit", saveSettings);
  reset9Router.addEventListener("click", resetToLocal9Router);

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

    fields.enabled.checked = Boolean(settings.enabled);
    fields.autoCheck.checked = Boolean(settings.autoCheck);
    fields.apiKey.value = settings.apiKey || "";
    fields.endpoint.value = settings.endpoint || DEFAULT_SETTINGS.endpoint;
    fields.model.value = settings.model || DEFAULT_SETTINGS.model;
    fields.minTextLength.value = Number(settings.minTextLength || DEFAULT_SETTINGS.minTextLength);
    fields.debounceMs.value = Number(settings.debounceMs || DEFAULT_SETTINGS.debounceMs);
  }

  async function resetToLocal9Router() {
    fields.endpoint.value = LOCAL_9ROUTER_SETTINGS.endpoint;
    fields.model.value = LOCAL_9ROUTER_SETTINGS.model;
    fields.apiKey.value = LOCAL_9ROUTER_SETTINGS.apiKey;

    await api.storage.local.set(Object.assign({}, DEFAULT_SETTINGS, LOCAL_9ROUTER_SETTINGS));

    status.textContent = "Reset to local 9Router.";
  }

  async function saveSettings(event) {
    event.preventDefault();

    const nextSettings = {
      enabled: fields.enabled.checked,
      autoCheck: fields.autoCheck.checked,
      provider: isGeminiEndpoint(fields.endpoint.value) ? "gemini" : "openai-compatible",
      apiKey: fields.apiKey.value.trim(),
      endpoint: fields.endpoint.value.trim() || DEFAULT_SETTINGS.endpoint,
      model: fields.model.value.trim() || DEFAULT_SETTINGS.model,
      minTextLength: clampNumber(fields.minTextLength.value, 1, 200, DEFAULT_SETTINGS.minTextLength),
      debounceMs: clampNumber(fields.debounceMs.value, 250, 5000, DEFAULT_SETTINGS.debounceMs)
    };

    await api.storage.local.set(nextSettings);
    status.textContent = "Saved.";

    window.setTimeout(() => {
      status.textContent = "";
    }, 2200);
  }

  function clampNumber(value, min, max, fallback) {
    const parsed = Number(value);

    if (!Number.isFinite(parsed)) {
      return fallback;
    }

    return Math.min(max, Math.max(min, parsed));
  }

  function normalizeSettings(settings) {
    if (!settings.endpoint || settings.endpoint === "https://api.openai.com/v1/chat/completions") {
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

  function isGeminiEndpoint(endpoint) {
    try {
      const url = new URL(endpoint || DEFAULT_SETTINGS.endpoint);
      return url.hostname === "generativelanguage.googleapis.com";
    } catch (error) {
      return false;
    }
  }
})();
