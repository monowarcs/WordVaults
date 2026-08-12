// ============================================================================
// WordVaults — Content Script
// Injects floating toolbar, handles text selection, vocabulary capture
// ============================================================================

(function () {
  "use strict";

  // Prevent double-injection
  if (window.__wordvault_initialized) return;
  window.__wordvault_initialized = true;

  // ---------------------------------------------------------------------------
  // STATE
  // ---------------------------------------------------------------------------
  let toolbarExists = false;
  let toolbarVisible = false;
  let selectionModeActive = false;
  let selectedText = "";
  let contextSentence = "";
  let shadowHost = null;
  let shadowRoot = null;

  // Named handlers for cleanup
  const handlers = {};

  // ---------------------------------------------------------------------------
  // MESSAGE LISTENER
  // ---------------------------------------------------------------------------
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "SHOW_TOOLBAR") {
      if (!toolbarExists) {
        createToolbar();
      }
      showToolbar();
      sendResponse({ ok: true });
    } else if (msg.action === "HIDE_TOOLBAR") {
      hideToolbar();
      sendResponse({ ok: true });
    } else if (msg.action === "EXIT_WORDVAULT" || msg.action === "WORDVAULT_EXIT") {
      cleanupWordVault();
      sendResponse({ ok: true });
    } else if (msg.action === "WORDVAULT_SAVE") {
      // Keyboard shortcut save — reuses existing saveWord()
      if (!selectedText) {
        showStatus("No text selected", "warning");
      } else {
        saveWord();
      }
      sendResponse({ ok: true });
    } else if (msg.action === "WORDVAULT_TOGGLE_SELECT") {
      // Keyboard shortcut select mode — reuses existing toggle
      toggleSelectMode();
      sendResponse({ ok: true });
    } else if (msg.action === "WORDVAULT_CLEAR") {
      // Keyboard shortcut clear — reuses existing clearSelection()
      clearSelection();
      sendResponse({ ok: true });
    }
    return true;
  });

  // ---------------------------------------------------------------------------
  // TOOLBAR CREATION (Shadow DOM for isolation)
  // ---------------------------------------------------------------------------
  function createToolbar() {
    if (document.getElementById("wordvault-host")) {
      shadowHost = document.getElementById("wordvault-host");
      shadowRoot = shadowHost.shadowRoot;
      toolbarExists = true;
      return;
    }

    shadowHost = document.createElement("div");
    shadowHost.id = "wordvault-host";
    shadowHost.style.cssText = "all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none;";

    shadowRoot = shadowHost.attachShadow({ mode: "open" });

    // Inject styles
    const style = document.createElement("style");
    style.textContent = getToolbarCSS();
    shadowRoot.appendChild(style);

    // Toolbar container
    const toolbar = document.createElement("div");
    toolbar.id = "wordvault-toolbar";
    toolbar.className = "wv-toolbar";
    toolbar.innerHTML = getToolbarHTML();
    shadowRoot.appendChild(toolbar);

    document.documentElement.appendChild(shadowHost);
    toolbarExists = true;

    bindToolbarEvents();
  }

  function getToolbarHTML() {
    return `
      <div class="wv-header">
        <div class="wv-logo">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
          </svg>
          <span>WordVaults</span>
        </div>
        <div class="wv-header-actions">
          <button id="wv-btn-dashboard" class="wv-btn wv-btn-icon" title="Open Dashboard">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
          </button>
          <button id="wv-btn-minimize" class="wv-btn wv-btn-icon" title="Minimize">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
          <button id="wv-btn-exit" class="wv-btn wv-btn-icon wv-btn-danger" title="Exit WordVaults (Ctrl+Shift+X)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>
      <div class="wv-body">
        <div class="wv-selection-area">
          <div id="wv-selected-display" class="wv-selected-display">
            <span class="wv-placeholder">Select a word or phrase from the page…</span>
          </div>
        </div>
        <div id="wv-context-display" class="wv-context-display" style="display:none;">
          <span class="wv-context-label">Context:</span>
          <span id="wv-context-text"></span>
        </div>
        <div class="wv-actions">
          <button id="wv-btn-select" class="wv-btn wv-btn-primary wv-btn-sm" title="Toggle Select Mode (Ctrl+Shift+Space)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>
            Select Mode
          </button>
          <button id="wv-btn-save" class="wv-btn wv-btn-success wv-btn-sm" disabled title="Save selected word (Alt+Shift+S)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
            Save
          </button>
          <button id="wv-btn-clear" class="wv-btn wv-btn-ghost wv-btn-sm" title="Clear selection (Ctrl+Shift+Backspace)">
            Clear
          </button>
        </div>
        <div id="wv-status" class="wv-status" style="display:none;"></div>
      </div>
      <div id="wv-minimized-bar" class="wv-minimized-bar" style="display:none;">
        <span class="wv-mini-logo">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
          </svg>
          WordVaults
        </span>
        <button id="wv-btn-expand" class="wv-btn wv-btn-icon wv-btn-sm" title="Expand">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/></svg>
        </button>
      </div>
    `;
  }

  // ---------------------------------------------------------------------------
  // TOOLBAR EVENTS
  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  // TOGGLE SELECT MODE — shared by toolbar button and keyboard shortcut
  // ---------------------------------------------------------------------------
  function toggleSelectMode() {
    if (!shadowRoot) return;
    const btn = shadowRoot.getElementById("wv-btn-select");
    selectionModeActive = !selectionModeActive;
    if (btn) {
      btn.classList.toggle("wv-active", selectionModeActive);
      btn.innerHTML = selectionModeActive
        ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg> Selecting…`
        : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg> Select Mode`;
    }
    if (selectionModeActive) {
      enableSelectionMode();
    } else {
      disableSelectionMode();
    }
  }

  function bindToolbarEvents() {
    const $ = (id) => shadowRoot.getElementById(id);

    // Select Mode toggle — calls shared function
    $("wv-btn-select").addEventListener("click", () => toggleSelectMode());

    // Save
    $("wv-btn-save").addEventListener("click", () => saveWord());

    // Clear
    $("wv-btn-clear").addEventListener("click", () => clearSelection());

    // Dashboard
    $("wv-btn-dashboard").addEventListener("click", () => {
      chrome.runtime.sendMessage({ action: "OPEN_DASHBOARD" });
    });

    // Minimize
    $("wv-btn-minimize").addEventListener("click", () => {
      shadowRoot.getElementById("wordvault-toolbar").querySelector(".wv-header").style.display = "none";
      shadowRoot.getElementById("wordvault-toolbar").querySelector(".wv-body").style.display = "none";
      $("wv-minimized-bar").style.display = "flex";
    });

    // Expand
    $("wv-btn-expand").addEventListener("click", () => {
      shadowRoot.getElementById("wordvault-toolbar").querySelector(".wv-header").style.display = "";
      shadowRoot.getElementById("wordvault-toolbar").querySelector(".wv-body").style.display = "";
      $("wv-minimized-bar").style.display = "none";
    });

    // Exit
    $("wv-btn-exit").addEventListener("click", () => {
      chrome.runtime.sendMessage({ action: "EXIT_WORDVAULT" });
      cleanupWordVault();
    });
  }

  // ---------------------------------------------------------------------------
  // SELECTION MODE
  // ---------------------------------------------------------------------------
  function enableSelectionMode() {
    handlers.onMouseUp = function () {
      const sel = window.getSelection();
      if (sel && sel.toString().trim().length > 0) {
        const raw = sel.toString().trim().replace(/\s+/g, " ");
        selectedText = raw;
        contextSentence = getContextSentence(sel);
        updateSelectionDisplay();
      }
    };
    document.addEventListener("mouseup", handlers.onMouseUp);
  }

  function disableSelectionMode() {
    if (handlers.onMouseUp) {
      document.removeEventListener("mouseup", handlers.onMouseUp);
      delete handlers.onMouseUp;
    }
  }

  function getContextSentence(selection) {
    try {
      if (!selection.rangeCount) return "";
      const range = selection.getRangeAt(0);
      let node = range.startContainer;
      if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
      if (!node) return "";
      // Walk up to find a block-level element
      const block = node.closest("p, div, li, td, th, h1, h2, h3, h4, h5, h6, span, article, section, blockquote") || node;
      let text = (block.textContent || "").replace(/\s+/g, " ").trim();
      // Limit context length
      if (text.length > 300) {
        const idx = text.indexOf(selectedText);
        if (idx >= 0) {
          const start = Math.max(0, idx - 80);
          const end = Math.min(text.length, idx + selectedText.length + 80);
          text = (start > 0 ? "…" : "") + text.substring(start, end) + (end < text.length ? "…" : "");
        } else {
          text = text.substring(0, 300) + "…";
        }
      }
      return text;
    } catch (e) {
      return "";
    }
  }

  function updateSelectionDisplay() {
    if (!shadowRoot) return;
    const display = shadowRoot.getElementById("wv-selected-display");
    const ctxContainer = shadowRoot.getElementById("wv-context-display");
    const ctxText = shadowRoot.getElementById("wv-context-text");
    const saveBtn = shadowRoot.getElementById("wv-btn-save");

    if (selectedText) {
      display.textContent = selectedText;
      display.classList.add("wv-has-text");
      saveBtn.disabled = false;
      if (contextSentence && contextSentence !== selectedText) {
        ctxContainer.style.display = "block";
        ctxText.textContent = contextSentence;
      }
    } else {
      display.innerHTML = '<span class="wv-placeholder">Select a word or phrase from the page…</span>';
      display.classList.remove("wv-has-text");
      saveBtn.disabled = true;
      ctxContainer.style.display = "none";
    }
  }

  function clearSelection() {
    selectedText = "";
    contextSentence = "";
    updateSelectionDisplay();
    showStatus("", "");
  }

  // ---------------------------------------------------------------------------
  // SAVE WORD
  // ---------------------------------------------------------------------------
  async function saveWord() {
    if (!selectedText) return;

    const word = selectedText;
    const ctx = contextSentence;
    const url = window.location.href;
    const title = document.title;

    try {
      const result = await chrome.storage.local.get({ vocabulary: [] });
      const vocab = result.vocabulary;

      // Duplicate check (case-insensitive)
      const duplicate = vocab.find(
        (item) => item.text.toLowerCase() === word.toLowerCase() && item.sourceUrl === url
      );
      if (duplicate) {
        showStatus("Word already exists in WordVaults", "warning");
        return;
      }

      const entry = {
        id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
        text: word,
        meaning: "",
        note: "",
        example: "",
        category: "",
        contextSentence: ctx,
        sourceUrl: url,
        sourceTitle: title,
        dateAdded: new Date().toISOString().split("T")[0],
        timestamp: Date.now(),
        favorite: false,
      };

      vocab.push(entry);
      await chrome.storage.local.set({ vocabulary: vocab });
      showStatus("Saved to WordVaults!", "success");
      clearSelection();
    } catch (e) {
      showStatus("Error saving word", "error");
      console.error("WordVaults save error:", e);
    }
  }

  // ---------------------------------------------------------------------------
  // STATUS MESSAGE
  // ---------------------------------------------------------------------------
  function showStatus(message, type) {
    if (!shadowRoot) return;
    const status = shadowRoot.getElementById("wv-status");
    if (!status) return;
    if (!message) {
      status.style.display = "none";
      return;
    }
    status.textContent = message;
    status.className = "wv-status wv-status-" + type;
    status.style.display = "block";
    setTimeout(() => {
      if (status) status.style.display = "none";
    }, 2500);
  }

  // ---------------------------------------------------------------------------
  // SHOW / HIDE / CLEANUP
  // ---------------------------------------------------------------------------
  function showToolbar() {
    if (!toolbarExists) createToolbar();
    if (shadowHost) {
      shadowHost.style.display = "";
      const tb = shadowRoot.getElementById("wordvault-toolbar");
      if (tb) {
        tb.style.display = "";
        tb.classList.remove("wv-hide");
        tb.classList.add("wv-show");
      }
    }
    toolbarVisible = true;
  }

  function hideToolbar() {
    if (shadowRoot) {
      const tb = shadowRoot.getElementById("wordvault-toolbar");
      if (tb) {
        tb.classList.remove("wv-show");
        tb.classList.add("wv-hide");
        setTimeout(() => {
          if (tb) tb.style.display = "none";
        }, 200);
      }
    }
    disableSelectionMode();
    selectionModeActive = false;
    toolbarVisible = false;
  }

  function cleanupWordVault() {
    disableSelectionMode();
    selectionModeActive = false;
    selectedText = "";
    contextSentence = "";

    if (shadowHost && shadowHost.parentNode) {
      shadowHost.parentNode.removeChild(shadowHost);
    }
    shadowHost = null;
    shadowRoot = null;
    toolbarExists = false;
    toolbarVisible = false;
    window.__wordvault_initialized = false;
  }

  // ---------------------------------------------------------------------------
  // TOOLBAR CSS (embedded in Shadow DOM for full isolation)
  // ---------------------------------------------------------------------------
  function getToolbarCSS() {
    return `
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

      :host { all: initial; }

      *, *::before, *::after {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }

      .wv-toolbar {
        position: fixed;
        top: 16px;
        right: 16px;
        width: 340px;
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        font-size: 13px;
        color: #e2e8f0;
        background: linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.95));
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border: 1px solid rgba(99, 102, 241, 0.25);
        border-radius: 14px;
        box-shadow:
          0 20px 60px rgba(0, 0, 0, 0.5),
          0 0 0 1px rgba(99, 102, 241, 0.1),
          inset 0 1px 0 rgba(255, 255, 255, 0.05);
        overflow: hidden;
        z-index: 2147483647;
        pointer-events: auto;
        transition: opacity 0.2s ease, transform 0.2s ease;
      }

      .wv-toolbar.wv-show {
        opacity: 1;
        transform: translateY(0);
      }

      .wv-toolbar.wv-hide {
        opacity: 0;
        transform: translateY(-8px);
      }

      @media (prefers-reduced-motion: reduce) {
        .wv-toolbar { transition: none; }
      }

      .wv-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 14px;
        background: linear-gradient(135deg, rgba(99, 102, 241, 0.15), rgba(139, 92, 246, 0.1));
        border-bottom: 1px solid rgba(99, 102, 241, 0.15);
      }

      .wv-logo {
        display: flex;
        align-items: center;
        gap: 8px;
        font-weight: 700;
        font-size: 14px;
        letter-spacing: -0.02em;
        background: linear-gradient(135deg, #818cf8, #a78bfa);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
      }

      .wv-logo svg {
        color: #818cf8;
        flex-shrink: 0;
      }

      .wv-header-actions {
        display: flex;
        gap: 4px;
      }

      .wv-body {
        padding: 12px 14px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .wv-selected-display {
        padding: 10px 12px;
        background: rgba(0, 0, 0, 0.25);
        border: 1px solid rgba(99, 102, 241, 0.15);
        border-radius: 8px;
        min-height: 40px;
        display: flex;
        align-items: center;
        word-break: break-word;
        line-height: 1.5;
      }

      .wv-selected-display.wv-has-text {
        color: #f1f5f9;
        font-weight: 500;
        font-size: 15px;
        border-color: rgba(99, 102, 241, 0.4);
        background: rgba(99, 102, 241, 0.08);
      }

      .wv-placeholder {
        color: #64748b;
        font-style: italic;
        font-size: 12px;
      }

      .wv-context-display {
        padding: 8px 10px;
        background: rgba(0, 0, 0, 0.15);
        border-radius: 6px;
        font-size: 11px;
        color: #94a3b8;
        line-height: 1.5;
      }

      .wv-context-label {
        color: #818cf8;
        font-weight: 600;
        margin-right: 4px;
      }

      .wv-actions {
        display: flex;
        gap: 6px;
      }

      .wv-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
        border: none;
        border-radius: 7px;
        cursor: pointer;
        font-family: inherit;
        font-size: 12px;
        font-weight: 500;
        transition: all 0.15s ease;
        pointer-events: auto;
        line-height: 1;
        white-space: nowrap;
      }

      .wv-btn:active { transform: scale(0.96); }

      .wv-btn-sm { padding: 7px 12px; }

      .wv-btn-icon {
        padding: 6px;
        background: transparent;
        color: #94a3b8;
        border-radius: 6px;
      }
      .wv-btn-icon:hover { background: rgba(255,255,255,0.08); color: #e2e8f0; }

      .wv-btn-primary {
        background: linear-gradient(135deg, #6366f1, #8b5cf6);
        color: #fff;
        box-shadow: 0 2px 8px rgba(99, 102, 241, 0.3);
      }
      .wv-btn-primary:hover {
        box-shadow: 0 4px 16px rgba(99, 102, 241, 0.5);
        filter: brightness(1.1);
      }
      .wv-btn-primary.wv-active {
        background: linear-gradient(135deg, #f59e0b, #f97316);
        box-shadow: 0 2px 8px rgba(245, 158, 11, 0.4);
      }

      .wv-btn-success {
        background: linear-gradient(135deg, #10b981, #059669);
        color: #fff;
        box-shadow: 0 2px 8px rgba(16, 185, 129, 0.3);
      }
      .wv-btn-success:hover {
        box-shadow: 0 4px 16px rgba(16, 185, 129, 0.5);
        filter: brightness(1.1);
      }
      .wv-btn-success:disabled {
        opacity: 0.4;
        cursor: not-allowed;
        filter: grayscale(0.5);
        box-shadow: none;
      }

      .wv-btn-ghost {
        background: rgba(255,255,255,0.06);
        color: #94a3b8;
        border: 1px solid rgba(255,255,255,0.08);
      }
      .wv-btn-ghost:hover {
        background: rgba(255,255,255,0.1);
        color: #e2e8f0;
      }

      .wv-btn-danger { color: #f87171; }
      .wv-btn-danger:hover { background: rgba(248,113,113,0.12); }

      .wv-status {
        padding: 7px 10px;
        border-radius: 6px;
        font-size: 11px;
        font-weight: 500;
        text-align: center;
        animation: wv-fade-in 0.2s ease;
      }
      .wv-status-success { background: rgba(16,185,129,0.15); color: #34d399; border: 1px solid rgba(16,185,129,0.2); }
      .wv-status-warning { background: rgba(245,158,11,0.15); color: #fbbf24; border: 1px solid rgba(245,158,11,0.2); }
      .wv-status-error { background: rgba(239,68,68,0.15); color: #f87171; border: 1px solid rgba(239,68,68,0.2); }

      .wv-minimized-bar {
        position: fixed;
        top: 16px;
        right: 16px;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        font-family: 'Inter', sans-serif;
        font-size: 12px;
        font-weight: 600;
        color: #a5b4fc;
        background: linear-gradient(135deg, rgba(15, 23, 42, 0.92), rgba(30, 41, 59, 0.92));
        backdrop-filter: blur(16px);
        border: 1px solid rgba(99, 102, 241, 0.2);
        border-radius: 10px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.4);
        z-index: 2147483647;
        pointer-events: auto;
        cursor: default;
      }

      .wv-mini-logo {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .wv-mini-logo svg { color: #818cf8; }

      @keyframes wv-fade-in {
        from { opacity: 0; transform: translateY(-4px); }
        to { opacity: 1; transform: translateY(0); }
      }

      @media (max-width: 400px) {
        .wv-toolbar { width: calc(100vw - 24px); right: 12px; top: 12px; }
      }
    `;
  }
})();
