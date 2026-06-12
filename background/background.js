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
  const FALLBACK_MODEL = LOCAL_9ROUTER_SETTINGS.model;

  const SYSTEM_PROMPT = [
    "You are an English proofreading assistant.",
    "Check spelling, grammar, word choice, and clarity.",
    "Return only valid JSON with this exact shape:",
    "{\"correctedText\":\"...\",\"summary\":\"...\",\"issues\":[{\"type\":\"spelling|grammar|word_choice|style\",\"original\":\"...\",\"suggestion\":\"...\",\"explanation\":\"...\"}]}",
    "The issues field must be an array of objects, not strings.",
    "For every issue, original must be the exact incorrect substring from the user's text.",
    "For every issue, suggestion must be the exact replacement text.",
    "Keep the user's meaning and tone. Do not add new facts."
  ].join(" ");

  if (api.webRequest && api.webRequest.onBeforeSendHeaders) {
    api.webRequest.onBeforeSendHeaders.addListener(
      strip9RouterOriginHeaders,
      {
        urls: [
          "http://localhost:20128/*",
          "http://127.0.0.1:20128/*",
          "http://localhost:5174/*",
          "http://127.0.0.1:5174/*"
        ]
      },
      ["blocking", "requestHeaders"]
    );
  }

  api.runtime.onInstalled.addListener(() => {
    api.contextMenus.create({
      id: "grammaly-check-selection",
      title: "Check English with Grammaly",
      contexts: ["selection", "editable"]
    });
  });

  api.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== "grammaly-check-selection" || !tab || !tab.id) {
      return;
    }

    api.tabs.sendMessage(tab.id, {
      type: "GRAMMALY_RUN_CHECK",
      text: info.selectionText || ""
    });
  });

  api.runtime.onMessage.addListener((message, sender) => {
    if (!message || !message.type) {
      return undefined;
    }

    if (message.type === "GRAMMALY_GET_SETTINGS") {
      return getSettings().then((settings) => sanitizeSettings(settings));
    }

    if (message.type === "GRAMMALY_RESET_LOCAL_9ROUTER") {
      return resetLocal9RouterSettings().then((settings) => sanitizeSettings(settings));
    }

    if (message.type === "GRAMMALY_CHECK_TEXT") {
      return checkText(message.text || "", sender && sender.tab ? sender.tab.url : "");
    }

    return undefined;
  });

  async function getSettings() {
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

    return settings;
  }

  async function resetLocal9RouterSettings() {
    const nextSettings = Object.assign({}, DEFAULT_SETTINGS, LOCAL_9ROUTER_SETTINGS);

    await api.storage.local.set(nextSettings);
    return nextSettings;
  }

  function normalizeSettings(settings) {
    const endpoint = String(settings.endpoint || "").trim();

    if (!endpoint || endpoint === LEGACY_OPENAI_ENDPOINT) {
      return Object.assign({}, DEFAULT_SETTINGS, settings, {
        endpoint: DEFAULT_SETTINGS.endpoint,
        model: DEFAULT_SETTINGS.model,
        provider: DEFAULT_SETTINGS.provider,
        apiKey: settings.apiKey || DEFAULT_SETTINGS.apiKey
      });
    }

    if (isLocal9RouterEndpoint(endpoint)) {
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

    if (isGeminiEndpoint(endpoint)) {
      return Object.assign({}, settings, {
        provider: "gemini",
        apiKey: settings.apiKey || DEFAULT_SETTINGS.apiKey
      });
    }

    return Object.assign({}, settings, {
      provider: settings.provider || "openai-compatible"
    });
  }

  function sanitizeSettings(settings) {
    return Object.assign({}, settings, {
      apiKey: settings.apiKey ? "configured" : ""
    });
  }

  async function checkText(text, pageUrl) {
    const settings = await getSettings();
    const trimmedText = String(text || "").trim();

    if (!settings.enabled) {
      throw makeError("DISABLED", "Grammaly is disabled.");
    }

    if (!settings.apiKey && !isLocal9RouterEndpoint(settings.endpoint)) {
      throw makeError("NO_API_KEY", "Add your AI API key in the extension options.");
    }

    if (trimmedText.length < Number(settings.minTextLength || DEFAULT_SETTINGS.minTextLength)) {
      throw makeError("TEXT_TOO_SHORT", "Text is too short to check.");
    }

    const payload = buildPayload(settings, trimmedText, pageUrl);
    const result = await runCorrectionPayload(settings, payload, trimmedText);

    return result;
  }

  async function runCorrectionPayload(settings, payload, originalText) {
    try {
      return await fetchCorrectionResult(settings, payload, originalText);
    } catch (error) {
      if (!shouldUseFallback(error, payload)) {
        throw error;
      }

      const fallbackPayload = Object.assign({}, payload, {
        model: FALLBACK_MODEL,
        max_tokens: 1200
      });

      return fetchCorrectionResult(settings, fallbackPayload, originalText);
    }
  }

  async function fetchCorrectionResult(settings, payload, originalText) {
    const data = await requestCompletion(settings, payload);
    const content = extractAssistantText(data);
    const parsed = parseJsonContent(content);

    return normalizeResult(parsed, originalText);
  }

  function shouldUseFallback(error, payload) {
    if (!error || !payload.model || payload.model === FALLBACK_MODEL) {
      return false;
    }

    return (
      error.code === "BAD_API_RESPONSE" ||
      (error.code === "API_ERROR" && /502|timeout/i.test(error.message || ""))
    );
  }

  function buildPayload(settings, text, pageUrl) {
    if (isGeminiEndpoint(settings.endpoint)) {
      return {
        systemInstruction: {
          parts: [{ text: SYSTEM_PROMPT }]
        },
        contents: [
          {
            role: "user",
            parts: [
              {
                text: JSON.stringify({
                  pageUrl: pageUrl || "",
                  text
                })
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 4096,
          responseMimeType: "application/json"
        }
      };
    }

    return {
      model: settings.model || DEFAULT_SETTINGS.model,
      temperature: 0.2,
      max_tokens: 4096,
      stream: false,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: JSON.stringify({
            pageUrl: pageUrl || "",
            text
          })
        }
      ]
    };
  }

  async function requestCompletion(settings, payload) {
    if (isGeminiEndpoint(settings.endpoint)) {
      const response = await fetchCompletion(settings, payload);

      if (response.ok) {
        return response.json();
      }

      const error = await readApiError(response, settings);
      throw makeError("API_ERROR", error.message || "The Gemini API request failed.");
    }

    const firstResponse = await fetchCompletion(settings, payload);

    if (firstResponse.ok) {
      return firstResponse.json();
    }

    if (firstResponse.status === 401 && settings.apiKey) {
      const noAuthResponse = await fetchCompletion(settings, payload, { omitAuth: true });

      if (noAuthResponse.ok) {
        return noAuthResponse.json();
      }

      const noAuthError = await readApiError(noAuthResponse, settings);
      throw makeError("API_ERROR", noAuthError.message || "The AI API request failed.");
    }

    const firstError = await readApiError(firstResponse, settings);
    const canRetryWithoutJsonMode =
      firstResponse.status === 400 &&
      /response_format|json_object/i.test(firstError.message || "");

    if (!canRetryWithoutJsonMode) {
      throw makeError("API_ERROR", firstError.message || "The AI API request failed.");
    }

    const retryPayload = Object.assign({}, payload);
    delete retryPayload.response_format;
    const retryResponse = await fetchCompletion(settings, retryPayload);

    if (!retryResponse.ok) {
      const retryError = await readApiError(retryResponse, settings);
      throw makeError("API_ERROR", retryError.message || "The AI API request failed.");
    }

    return retryResponse.json();
  }

  function fetchCompletion(settings, payload, options) {
    const headers = {
      "Content-Type": "application/json"
    };
    const omitAuth = options && options.omitAuth;

    if (!omitAuth && settings.apiKey && isGeminiEndpoint(settings.endpoint)) {
      headers["x-goog-api-key"] = settings.apiKey;
    } else if (!omitAuth && settings.apiKey && !isLocal9RouterEndpoint(settings.endpoint)) {
      headers.Authorization = `Bearer ${settings.apiKey}`;
    }

    return fetch(getCompletionUrl(settings), {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });
  }

  function getCompletionUrl(settings) {
    const endpoint = String(settings.endpoint || DEFAULT_SETTINGS.endpoint).replace(/\/+$/, "");

    if (!isGeminiEndpoint(endpoint)) {
      return endpoint;
    }

    if (/:generateContent$/i.test(endpoint)) {
      return endpoint;
    }

    if (/\/models\/[^/]+$/i.test(endpoint)) {
      return `${endpoint}:generateContent`;
    }

    return `${endpoint}/models/${encodeURIComponent(settings.model || DEFAULT_SETTINGS.model)}:generateContent`;
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

  function strip9RouterOriginHeaders(details) {
    return {
      requestHeaders: (details.requestHeaders || []).filter((header) => {
        const name = header.name.toLowerCase();
        return name !== "origin";
      })
    };
  }

  async function readApiError(response, settings) {
    const hint = buildApiErrorHint(response.status, settings);

    try {
      const data = await response.json();
      return {
        message:
          data.error && data.error.message
            ? `${data.error.message}${hint}`
            : `API request failed with status ${response.status}.${hint}`
      };
    } catch (error) {
      return { message: `API request failed with status ${response.status}.${hint}` };
    }
  }

  function buildApiErrorHint(status, settings) {
    if (status !== 401) {
      return "";
    }

    if (isLocal9RouterEndpoint(settings.endpoint)) {
      return " Local 9Router should not need an API key; reload the extension if this persists.";
    }

    if (isGeminiEndpoint(settings.endpoint)) {
      return " Check the Gemini API key saved in extension options.";
    }

    return " The saved endpoint may be old. Open options and reset to local 9Router.";
  }

  function extractAssistantText(data) {
    if (data && data.candidates) {
      return extractGeminiText(data);
    }

    const content =
      data &&
      data.choices &&
      data.choices[0] &&
      data.choices[0].message &&
      data.choices[0].message.content;

    if (!content) {
      throw makeError("BAD_API_RESPONSE", "The AI API returned an empty response.");
    }

    return Array.isArray(content)
      ? content.map((part) => part.text || "").join("")
      : String(content);
  }

  function extractGeminiText(data) {
    const candidate = data.candidates && data.candidates[0];
    const parts =
      candidate &&
      candidate.content &&
      Array.isArray(candidate.content.parts)
        ? candidate.content.parts
        : [];
    const content = parts.map((part) => part.text || "").join("");

    if (!content) {
      const reason = candidate && candidate.finishReason ? ` Finish reason: ${candidate.finishReason}.` : "";
      throw makeError("BAD_API_RESPONSE", `Gemini returned an empty response.${reason}`);
    }

    return content;
  }

  function parseJsonContent(content) {
    const cleaned = String(content)
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "");

    try {
      return JSON.parse(cleaned);
    } catch (error) {
      const firstBrace = cleaned.indexOf("{");
      const lastBrace = cleaned.lastIndexOf("}");

      if (firstBrace !== -1 && lastBrace > firstBrace) {
        return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
      }

      throw makeError("BAD_JSON", "The AI response was not valid correction JSON.");
    }
  }

  function normalizeResult(result, originalText) {
    const issues = Array.isArray(result.issues)
      ? result.issues.slice(0, 12).map((issue) => {
          if (typeof issue === "string") {
            const parsedStringIssue = parseStringIssue(issue);

            return {
              type: parsedStringIssue.type,
              original: parsedStringIssue.original,
              suggestion: parsedStringIssue.suggestion,
              explanation: issue
            };
          }

          return {
            type: String(issue && issue.type ? issue.type : "style"),
            original: String(issue && issue.original ? issue.original : ""),
            suggestion: String(issue && issue.suggestion ? issue.suggestion : ""),
            explanation: String(issue && issue.explanation ? issue.explanation : "")
          };
        })
      : [];

    return {
      originalText,
      correctedText: String(result.correctedText || originalText),
      summary: String(result.summary || (issues.length ? "Suggestions found." : "Looks good.")),
      issues
    };
  }

  function parseStringIssue(issue) {
    const text = String(issue || "");
    const quotedParts = Array.from(text.matchAll(/['"]([^'"]+)['"]/g)).map((match) => match[1]);
    const type = /spell/i.test(text)
      ? "spelling"
      : /grammar|verb|agreement|tense/i.test(text)
        ? "grammar"
        : /word|vocab/i.test(text)
          ? "word_choice"
          : "style";

    return {
      type,
      original: quotedParts[0] || "",
      suggestion: quotedParts[1] || ""
    };
  }

  function makeError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }
})();
