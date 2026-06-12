(function () {
  "use strict";

  const api = typeof browser !== "undefined" ? browser : chrome;
  const EDITABLE_INPUT_TYPES = new Set(["text", "search", "url", "tel", ""]);

  let settings = {
    enabled: true,
    autoCheck: true,
    minTextLength: 12
  };
  let selectionState = null;
  let selectionButton = null;
  let panel = null;
  let tooltip = null;
  let overlayMarks = [];
  let overlayState = null;
  let requestSerial = 0;

  api.runtime.sendMessage({ type: "GRAMMALY_GET_SETTINGS" }).then((nextSettings) => {
    settings = Object.assign(settings, nextSettings || {});
  }).catch(() => {});

  document.addEventListener("mouseup", () => {
    window.setTimeout(captureSelection, 0);
  });

  document.addEventListener("keyup", (event) => {
    if (event.key === "Shift" || event.key.startsWith("Arrow")) {
      window.setTimeout(captureSelection, 0);
    }
  });

  document.addEventListener("selectionchange", () => {
    window.clearTimeout(captureSelection.timer);
    captureSelection.timer = window.setTimeout(captureSelection, 80);
  });

  document.addEventListener("mousedown", (event) => {
    if (
      selectionButton &&
      !selectionButton.contains(event.target) &&
      panel &&
      !panel.contains(event.target)
    ) {
      hideSelectionButton();
    }
  });

  document.addEventListener("mouseover", (event) => {
    const mark = event.target.closest ? event.target.closest(".grammaly-mark, .grammaly-overlay-mark") : null;

    if (mark) {
      showTooltip(mark);
    }
  });

  document.addEventListener("mouseout", (event) => {
    const mark = event.target.closest ? event.target.closest(".grammaly-mark, .grammaly-overlay-mark") : null;

    if (mark && (!event.relatedTarget || !mark.contains(event.relatedTarget))) {
      hideTooltip();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      hideSelectionButton();
      removePanel();
      removeOverlays();
      hideTooltip();
    }
  });

  window.addEventListener("scroll", () => {
    if (selectionButton && selectionState && selectionState.rect) {
      positionSelectionButton(selectionState.rect);
    }
    scheduleOverlayRefresh();
  }, true);

  window.addEventListener("resize", () => {
    if (selectionButton && selectionState && selectionState.rect) {
      positionSelectionButton(selectionState.rect);
    }
    scheduleOverlayRefresh();
  });

  api.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== "GRAMMALY_RUN_CHECK") {
      return undefined;
    }

    captureSelection();

    if (selectionState && selectionState.text) {
      checkSelection();
      return undefined;
    }

    if (message.text) {
      selectionState = {
        text: String(message.text),
        range: null,
        input: null,
        rect: null,
        canDecorate: false
      };
      checkSelection();
      return undefined;
    }

    showPanelMessage("Select a text passage first.", true, null);
    return undefined;
  });

  function captureSelection() {
    if (!settings.enabled || !settings.autoCheck) {
      hideSelectionButton();
      return;
    }

    if (selectionButton && document.activeElement === selectionButton) {
      return;
    }

    const inputSelection = getInputSelection();

    if (inputSelection) {
      selectionState = inputSelection;
      showSelectionButton(inputSelection.rect);
      return;
    }

    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      hideSelectionButton();
      selectionState = null;
      return;
    }

    const text = selection.toString().trim();

    if (text.length < Number(settings.minTextLength || 12)) {
      hideSelectionButton();
      selectionState = null;
      return;
    }

    const range = selection.getRangeAt(0).cloneRange();
    const rect = getRangeRect(range);

    if (!rect) {
      hideSelectionButton();
      selectionState = null;
      return;
    }

    selectionState = {
      text,
      range,
      input: null,
      rect,
      canDecorate: true
    };
    showSelectionButton(rect);
  }

  function getInputSelection() {
    const element = document.activeElement;

    if (!isTextInput(element)) {
      return null;
    }

    const start = element.selectionStart;
    const end = element.selectionEnd;

    if (typeof start !== "number" || typeof end !== "number" || start === end) {
      return null;
    }

    const text = element.value.slice(start, end).trim();

    if (text.length < Number(settings.minTextLength || 12)) {
      return null;
    }

    return {
      text,
      range: null,
      input: element,
      rect: element.getBoundingClientRect(),
      canDecorate: false
    };
  }

  function isTextInput(element) {
    if (!element) {
      return false;
    }

    if (element.tagName === "TEXTAREA") {
      return true;
    }

    return element.tagName === "INPUT" && EDITABLE_INPUT_TYPES.has(String(element.type || "").toLowerCase());
  }

  function getRangeRect(range) {
    const rect = range.getBoundingClientRect();

    if (rect && (rect.width || rect.height)) {
      return rect;
    }

    const rects = range.getClientRects();
    return rects && rects.length ? rects[0] : null;
  }

  function showSelectionButton(rect) {
    if (!selectionButton) {
      selectionButton = document.createElement("button");
      selectionButton.className = "grammaly-selection-button";
      selectionButton.type = "button";
      selectionButton.title = "Check English with Grammaly";
      selectionButton.setAttribute("aria-label", "Check English with Grammaly");
      selectionButton.textContent = "G";
      selectionButton.addEventListener("mousedown", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      selectionButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        checkSelection();
      });
      document.documentElement.append(selectionButton);
    }

    positionSelectionButton(rect);
  }

  function positionSelectionButton(rect) {
    const top = window.scrollY + rect.bottom + 8;
    const left = window.scrollX + rect.right - 34;
    const maxLeft = window.scrollX + window.innerWidth - 44;

    selectionButton.style.top = `${Math.max(window.scrollY + 8, top)}px`;
    selectionButton.style.left = `${Math.max(window.scrollX + 8, Math.min(left, maxLeft))}px`;
  }

  function hideSelectionButton() {
    if (selectionButton) {
      selectionButton.remove();
      selectionButton = null;
    }
  }

  async function checkSelection() {
    if (!selectionState || !selectionState.text) {
      showPanelMessage("Select a text passage first.", true, null);
      return;
    }

    const serial = ++requestSerial;
    const currentSelection = selectionState;

    hideSelectionButton();
    showPanelMessage("Checking selected text...", false, currentSelection.rect);

    try {
      const result = await api.runtime.sendMessage({
        type: "GRAMMALY_CHECK_TEXT",
        text: currentSelection.text
      });

      if (serial !== requestSerial) {
        return;
      }

      if (currentSelection.canDecorate) {
        const decoratedCount = decorateSelection(currentSelection, result);

        if (decoratedCount !== null) {
          if (decoratedCount) {
            removePanel();
            return;
          }
        }
      }

      showResultPanel(result, currentSelection.rect, currentSelection.canDecorate);
    } catch (error) {
      if (serial !== requestSerial) {
        return;
      }

      showPanelMessage(error && error.message ? error.message : "Unable to check this text.", true, currentSelection.rect);
    }
  }

  function decorateSelection(currentSelection, result) {
    if (!currentSelection.range) {
      return null;
    }

    const issueRanges = collectDomIssueRanges(currentSelection.range, result.issues || []);

    if (!issueRanges.length) {
      return 0;
    }

    drawIssueOverlays(issueRanges);
    window.getSelection().removeAllRanges();
    return issueRanges.length;
  }

  function collectDomIssueRanges(range, issues) {
    const pieces = getSelectedTextPieces(range);
    const text = pieces.map((piece) => piece.text).join("");
    const issueRanges = collectIssueRanges(text, issues);

    return issueRanges.map((issueRange) => {
      const domRange = createRangeFromTextOffsets(pieces, issueRange.start, issueRange.end);

      return domRange
        ? {
            range: domRange,
            issue: issueRange.issue
          }
        : null;
    }).filter(Boolean);
  }

  function getSelectedTextPieces(range) {
    const nodes = [];
    const root = range.commonAncestorContainer;

    if (root.nodeType === Node.TEXT_NODE) {
      nodes.push(root);
    } else {
      const walker = document.createTreeWalker(
        root,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode(node) {
            if (!node.nodeValue) {
              return NodeFilter.FILTER_REJECT;
            }

            try {
              return range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
            } catch (error) {
              return NodeFilter.FILTER_REJECT;
            }
          }
        }
      );

      while (walker.nextNode()) {
        nodes.push(walker.currentNode);
      }
    }

    let textStart = 0;

    return nodes.map((node) => {
      const value = node.nodeValue || "";
      const nodeStart = node === range.startContainer ? range.startOffset : 0;
      const nodeEnd = node === range.endContainer ? range.endOffset : value.length;
      const text = value.slice(nodeStart, nodeEnd);
      const piece = {
        node,
        nodeStart,
        textStart,
        textEnd: textStart + text.length,
        text
      };

      textStart = piece.textEnd;
      return piece;
    }).filter((piece) => piece.text);
  }

  function createRangeFromTextOffsets(pieces, start, end) {
    const startLocation = locateTextOffset(pieces, start, false);
    const endLocation = locateTextOffset(pieces, end, true);

    if (!startLocation || !endLocation) {
      return null;
    }

    const range = document.createRange();
    range.setStart(startLocation.node, startLocation.offset);
    range.setEnd(endLocation.node, endLocation.offset);
    return range;
  }

  function locateTextOffset(pieces, offset, preferPrevious) {
    for (let index = 0; index < pieces.length; index += 1) {
      const piece = pieces[index];
      const isInside = offset >= piece.textStart && offset <= piece.textEnd;

      if (!isInside) {
        continue;
      }

      if (
        offset === piece.textEnd &&
        offset !== piece.textStart &&
        !preferPrevious &&
        pieces[index + 1]
      ) {
        continue;
      }

      return {
        node: piece.node,
        offset: piece.nodeStart + offset - piece.textStart
      };
    }

    return null;
  }

  function collectIssueRanges(text, issues) {
    const used = [];

    issues.forEach((issue) => {
      const original = String(issue.original || "").trim();

      if (!original) {
        return;
      }

      const start = findAvailableIndex(text, original, used);

      if (start === -1) {
        return;
      }

      const end = start + original.length;
      used.push({
        start,
        end,
        issue
      });
    });

    return used.sort((a, b) => a.start - b.start);
  }

  function findAvailableIndex(text, original, used) {
    const direct = findNonOverlappingIndex(text, original, used, false);

    if (direct !== -1) {
      return direct;
    }

    return findNonOverlappingIndex(text, original, used, true);
  }

  function findNonOverlappingIndex(text, original, used, ignoreCase) {
    const haystack = ignoreCase ? text.toLowerCase() : text;
    const needle = ignoreCase ? original.toLowerCase() : original;
    let fromIndex = 0;

    while (fromIndex < haystack.length) {
      const index = haystack.indexOf(needle, fromIndex);

      if (index === -1) {
        return -1;
      }

      const end = index + original.length;
      const overlaps = used.some((range) => index < range.end && end > range.start);

      if (!overlaps) {
        return index;
      }

      fromIndex = index + 1;
    }

    return -1;
  }

  function drawIssueOverlays(issueRanges) {
    overlayState = { issueRanges };
    refreshOverlays();
  }

  function scheduleOverlayRefresh() {
    if (!overlayState) {
      return;
    }

    window.clearTimeout(scheduleOverlayRefresh.timer);
    scheduleOverlayRefresh.timer = window.setTimeout(refreshOverlays, 40);
  }

  function refreshOverlays() {
    if (!overlayState) {
      return;
    }

    clearOverlayMarks();
    overlayState.issueRanges.forEach((issueRange) => {
      Array.from(issueRange.range.getClientRects()).forEach((rect) => {
        if (rect.width < 2 || rect.height < 2) {
          return;
        }

        const mark = document.createElement("span");
        mark.className = "grammaly-overlay-mark";
        mark.tabIndex = 0;
        mark.dataset.type = String(issueRange.issue.type || "style").replace(/_/g, " ");
        mark.dataset.suggestion = String(issueRange.issue.suggestion || "");
        mark.dataset.explanation = String(issueRange.issue.explanation || "");
        mark.title = buildTooltipText(mark);
        mark.setAttribute("aria-label", buildTooltipText(mark));
        mark.style.left = `${window.scrollX + rect.left}px`;
        mark.style.top = `${window.scrollY + rect.bottom - 3}px`;
        mark.style.width = `${rect.width}px`;
        mark.style.height = "7px";
        document.documentElement.append(mark);
        overlayMarks.push(mark);
      });
    });
  }

  function clearOverlayMarks() {
    overlayMarks.forEach((mark) => {
      mark.remove();
    });
    overlayMarks = [];
  }

  function removeOverlays() {
    clearOverlayMarks();
    overlayState = null;
  }

  function buildTooltipText(mark) {
    const parts = [];

    if (mark.dataset.type) {
      parts.push(`Error: ${mark.dataset.type}`);
    }

    if (mark.dataset.suggestion) {
      parts.push(`Fix: ${mark.dataset.suggestion}`);
    }

    if (mark.dataset.explanation) {
      parts.push(mark.dataset.explanation);
    }

    return parts.join("\n");
  }

  function showTooltip(mark) {
    hideTooltip();

    tooltip = document.createElement("div");
    tooltip.className = "grammaly-tooltip";

    const type = document.createElement("div");
    const fix = document.createElement("div");
    const explanation = document.createElement("div");

    type.className = "grammaly-tooltip-type";
    fix.className = "grammaly-tooltip-fix";
    explanation.className = "grammaly-tooltip-explanation";

    type.textContent = mark.dataset.type ? `Error: ${mark.dataset.type}` : "Error";
    fix.textContent = mark.dataset.suggestion ? `Fix: ${mark.dataset.suggestion}` : "Fix: review this text";
    explanation.textContent = mark.dataset.explanation || "";

    tooltip.append(type, fix);

    if (mark.dataset.explanation) {
      tooltip.append(explanation);
    }

    document.documentElement.append(tooltip);

    const rect = mark.getBoundingClientRect();
    const top = window.scrollY + rect.bottom + 8;
    const maxLeft = window.scrollX + window.innerWidth - tooltip.offsetWidth - 12;
    const left = Math.max(window.scrollX + 12, Math.min(window.scrollX + rect.left, maxLeft));

    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;
  }

  function hideTooltip() {
    if (tooltip) {
      tooltip.remove();
      tooltip = null;
    }
  }

  function showPanelMessage(message, isError, anchor) {
    const body = document.createElement("div");
    body.className = isError ? "grammaly-error" : "grammaly-status";
    body.textContent = message;

    renderPanel(body, anchor);
  }

  function showResultPanel(result, anchor, canDecorate) {
    const body = document.createElement("div");
    const summary = document.createElement("p");
    const correction = document.createElement("div");
    const issues = document.createElement("ul");

    summary.className = "grammaly-summary";
    summary.textContent = canDecorate
      ? (result.summary || "Check complete.")
      : "This field cannot show inline underlines. Review the correction below.";

    correction.className = "grammaly-correction";
    correction.textContent = result.correctedText || result.originalText || "";
    issues.className = "grammaly-issues";

    (result.issues || []).forEach((issue) => {
      issues.append(createIssueItem(issue));
    });

    body.append(summary, correction);

    if (issues.children.length) {
      body.append(issues);
    }

    renderPanel(body, anchor);
  }

  function createIssueItem(issue) {
    const item = document.createElement("li");
    const type = document.createElement("div");
    const change = document.createElement("p");
    const explanation = document.createElement("p");
    const original = document.createElement("span");
    const suggestion = document.createElement("span");

    item.className = "grammaly-issue";
    type.className = "grammaly-issue-type";
    change.className = "grammaly-change";
    explanation.className = "grammaly-explanation";
    original.className = "grammaly-original";
    suggestion.className = "grammaly-suggestion";

    type.textContent = String(issue.type || "style").replace(/_/g, " ");
    original.textContent = issue.original || "";
    suggestion.textContent = issue.suggestion || "";
    explanation.textContent = issue.explanation || "";

    change.append(original, document.createTextNode(" -> "), suggestion);
    item.append(type, change);

    if (issue.explanation) {
      item.append(explanation);
    }

    return item;
  }

  function renderPanel(bodyContent, anchor) {
    removePanel();

    panel = document.createElement("section");
    panel.className = "grammaly-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Grammaly suggestions");

    const header = document.createElement("div");
    const title = document.createElement("div");
    const dot = document.createElement("span");
    const label = document.createElement("span");
    const close = document.createElement("button");
    const body = document.createElement("div");

    header.className = "grammaly-header";
    title.className = "grammaly-title";
    dot.className = "grammaly-dot";
    label.textContent = "Grammaly";
    close.className = "grammaly-close";
    close.type = "button";
    close.setAttribute("aria-label", "Close suggestions");
    close.textContent = "x";
    close.addEventListener("click", removePanel);
    body.className = "grammaly-body";

    title.append(dot, label);
    header.append(title, close);
    body.append(bodyContent);
    panel.append(header, body);
    document.documentElement.append(panel);

    positionPanel(panel, anchor);
  }

  function positionPanel(element, anchor) {
    const rect = anchor && typeof anchor.bottom === "number" ? anchor : null;
    const fallbackTop = window.scrollY + 16;
    const fallbackLeft = window.scrollX + window.innerWidth - element.offsetWidth - 12;

    if (!rect) {
      element.style.top = `${fallbackTop}px`;
      element.style.left = `${Math.max(12, fallbackLeft)}px`;
      return;
    }

    const top = window.scrollY + rect.bottom + 8;
    const preferredLeft = window.scrollX + rect.right - element.offsetWidth;
    const maxLeft = window.scrollX + window.innerWidth - element.offsetWidth - 12;
    const left = Math.max(window.scrollX + 12, Math.min(preferredLeft, maxLeft));

    element.style.top = `${Math.max(window.scrollY + 12, top)}px`;
    element.style.left = `${left}px`;
  }

  function removePanel() {
    if (panel) {
      panel.remove();
      panel = null;
    }
  }
})();
