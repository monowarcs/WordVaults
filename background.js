// ============================================================================
// WordVaults — Background Service Worker
// Manages toolbar state per tab and relays toggle/exit messages to content scripts
// ============================================================================

// Per-tab state: { [tabId]: { active: bool, visible: bool } }
const tabState = {};

function getState(tabId) {
  if (!tabState[tabId]) {
    tabState[tabId] = { active: false, visible: false };
  }
  return tabState[tabId];
}

function setBadge(tabId, active) {
  if (active) {
    chrome.action.setBadgeText({ text: "ON", tabId });
    chrome.action.setBadgeBackgroundColor({ color: "#6C63FF", tabId });
    chrome.action.setTitle({ title: "WordVaults - Active (click to hide)", tabId });
  } else {
    chrome.action.setBadgeText({ text: "", tabId });
    chrome.action.setTitle({ title: "WordVaults - Click to toggle", tabId });
  }
}

// ---------------------------------------------------------------------------
// SHARED TOGGLE LOGIC — used by both icon click and keyboard shortcut
// ---------------------------------------------------------------------------
function handleToggle(tab) {
  if (!tab.id || tab.url?.startsWith("chrome://") || tab.url?.startsWith("chrome-extension://")) {
    return; // Cannot inject into restricted pages
  }

  const state = getState(tab.id);

  if (!state.active) {
    // First activation or after exit — SHOW
    state.active = true;
    state.visible = true;
    setBadge(tab.id, true);
    sendMessage(tab.id, { action: "SHOW_TOOLBAR" });
  } else if (state.visible) {
    // Currently visible — HIDE
    state.visible = false;
    setBadge(tab.id, false);
    sendMessage(tab.id, { action: "HIDE_TOOLBAR" });
  } else {
    // Hidden — SHOW
    state.visible = true;
    setBadge(tab.id, true);
    sendMessage(tab.id, { action: "SHOW_TOOLBAR" });
  }
}

// Extension icon click handler — primary toggle
chrome.action.onClicked.addListener(async (tab) => {
  handleToggle(tab);
});

// ---------------------------------------------------------------------------
// KEYBOARD SHORTCUTS — chrome.commands.onCommand
// ---------------------------------------------------------------------------
chrome.commands.onCommand.addListener(async (command) => {
  // Get the active tab in the current window
  let tabs;
  try {
    tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch (e) {
    console.warn("WordVaults: Could not query active tab", e.message);
    return;
  }

  if (!tabs || tabs.length === 0) return;
  const tab = tabs[0];

  // Skip restricted pages
  if (!tab.id || tab.url?.startsWith("chrome://") || tab.url?.startsWith("chrome-extension://")) {
    return;
  }

  switch (command) {
    case "toggle-wordvault":
      handleToggle(tab);
      break;

    case "save-word":
      // Only send save if WordVaults is active and visible
      if (getState(tab.id).active && getState(tab.id).visible) {
        sendMessage(tab.id, { action: "WORDVAULT_SAVE" });
      } else {
        // Activate WordVaults first, then send save
        handleToggle(tab);
        // Small delay to let toolbar initialize
        setTimeout(() => {
          sendMessage(tab.id, { action: "WORDVAULT_SAVE" });
        }, 150);
      }
      break;

    case "toggle-select-mode":
      if (getState(tab.id).active && getState(tab.id).visible) {
        sendMessage(tab.id, { action: "WORDVAULT_TOGGLE_SELECT" });
      } else {
        // Activate WordVaults first, then toggle select mode
        handleToggle(tab);
        setTimeout(() => {
          sendMessage(tab.id, { action: "WORDVAULT_TOGGLE_SELECT" });
        }, 150);
      }
      break;

    case "clear-selection":
      if (getState(tab.id).active) {
        sendMessage(tab.id, { action: "WORDVAULT_CLEAR" });
      }
      break;

    case "exit-wordvault": {
      const state = getState(tab.id);
      if (state.active) {
        state.active = false;
        state.visible = false;
        setBadge(tab.id, false);
        sendMessage(tab.id, { action: "WORDVAULT_EXIT" });
      }
      break;
    }
  }
});

async function sendMessage(tabId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch (e) {
    // Content script might not be loaded yet — inject it first
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"]
      });
      // Retry
      await chrome.tabs.sendMessage(tabId, message);
    } catch (err) {
      console.warn("WordVaults: Could not communicate with tab", tabId, err.message);
    }
  }
}

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!sender.tab) return;
  const tabId = sender.tab.id;

  if (message.action === "EXIT_WORDVAULT") {
    const state = getState(tabId);
    state.active = false;
    state.visible = false;
    setBadge(tabId, false);
    sendResponse({ ok: true });
  }

  if (message.action === "GET_STATE") {
    sendResponse(getState(tabId));
  }

  if (message.action === "OPEN_DASHBOARD") {
    chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
    sendResponse({ ok: true });
  }
});

// Cleanup state when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  delete tabState[tabId];
});

// Reset state on navigation
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    const state = getState(tabId);
    state.active = false;
    state.visible = false;
    setBadge(tabId, false);
  }
});
