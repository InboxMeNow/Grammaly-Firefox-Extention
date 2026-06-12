# Grammaly Firefox Extension

A lightweight Firefox extension that checks selected English text for spelling, grammar, vocabulary, and clarity issues with AI-powered suggestions.

Grammaly adds a small floating action button after you select text. Click it to send the selected passage to your configured AI provider, then review inline highlights, explanations, and suggested replacements.

## Features

- Check selected webpage text from a floating Grammaly button.
- Review spelling, grammar, word choice, and style suggestions.
- Hover highlighted issues to see explanations and replacements.
- Configure the AI endpoint, model, API key, minimum text length, and selection behavior.
- Use Gemini by default, with a local 9Router reset option for development.

## Default AI Provider

The extension is configured for Gemini by default:

```text
Endpoint: https://generativelanguage.googleapis.com/v1beta
Model:    gemini-3.1-flash-lite
```

For Gemini, Grammaly calls:

```text
models/{model}:generateContent
```

The API key is stored in Firefox extension storage after you enter it in Options. It is intentionally not committed to this repository.

## Install for Development

1. Install dependencies:

   ```bash
   npm install
   ```

2. Open Firefox and go to:

   ```text
   about:debugging#/runtime/this-firefox
   ```

3. Click **Load Temporary Add-on**.
4. Select `manifest.json` from this folder.
5. Open the extension options and add your Gemini API key.
6. Select English text on a webpage and click the floating **G** button.

## Run with web-ext

```bash
npm install
npm run run
```

## Local 9Router Proxy

The extension still includes a development helper for a local 9Router-compatible proxy:

```bash
npm run proxy
```

Then use the **Reset to local 9Router** button in the popup or options page. Local 9Router mode does not send an API key from the extension.

## Scripts

```bash
npm run lint
npm run run
npm run proxy
```

## Privacy

Grammaly sends only the text you select, plus the current page URL, to the AI endpoint configured in Options. For non-local providers, it also sends the API key you save in Firefox extension storage.

Do not commit API keys or other secrets to this repository.

## Project Layout

```text
background/   Extension background script and AI API integration
content/      Selection capture, inline highlights, and suggestion panel
icons/        Extension icon
options/      Full settings UI
popup/        Quick controls and manual check trigger
manifest.json Firefox extension manifest
```

## Validation

Run the extension linter before publishing:

```bash
npm run lint
```
