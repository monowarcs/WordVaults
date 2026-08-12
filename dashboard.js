// ============================================================================
// WordVaults Dashboard — JavaScript
// Manages vocabulary list, search, filter, edit, delete, favorite, CSV I/O
// ============================================================================

(function () {
  "use strict";

  let vocabulary = [];
  let currentFilter = "all";
  let searchQuery = "";
  let editingId = null;

  // DOM references
  const wordList = document.getElementById("word-list");
  const emptyState = document.getElementById("empty-state");
  const searchInput = document.getElementById("search-input");
  const statTotal = document.getElementById("stat-total");
  const statFav = document.getElementById("stat-fav");
  const statToday = document.getElementById("stat-today");
  const statSources = document.getElementById("stat-sources");
  const btnExport = document.getElementById("btn-export");
  const btnImport = document.getElementById("btn-import");
  const fileImport = document.getElementById("file-import");
  const modalOverlay = document.getElementById("modal-overlay");
  const tabs = document.querySelectorAll(".tab");

  // ---------------------------------------------------------------------------
  // INIT
  // ---------------------------------------------------------------------------
  loadVocabulary();

  // ---------------------------------------------------------------------------
  // LOAD & RENDER
  // ---------------------------------------------------------------------------
  function loadVocabulary() {
    chrome.storage.local.get({ vocabulary: [] }, (result) => {
      vocabulary = result.vocabulary || [];
      render();
    });
  }

  function saveVocabulary(callback) {
    chrome.storage.local.set({ vocabulary }, callback);
  }

  function render() {
    const filtered = getFiltered();
    updateStats();

    if (filtered.length === 0) {
      wordList.innerHTML = "";
      emptyState.style.display = "flex";
      if (searchQuery) {
        emptyState.querySelector("h2").textContent = "No results found";
        emptyState.querySelector("p").textContent = `No words matching "${searchQuery}"`;
      } else {
        emptyState.querySelector("h2").textContent = "Your WordVaults is empty";
        emptyState.querySelector("p").textContent = "Start collecting words by activating WordVaults on any webpage!";
      }
      return;
    }

    emptyState.style.display = "none";

    wordList.innerHTML = filtered
      .sort((a, b) => b.timestamp - a.timestamp)
      .map((item) => renderCard(item))
      .join("");

    // Bind card events
    wordList.querySelectorAll("[data-action]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const action = btn.dataset.action;
        const id = btn.dataset.id;
        if (action === "delete") deleteWord(id);
        else if (action === "edit") openEditModal(id);
        else if (action === "fav") toggleFavorite(id);
        else if (action === "copy") copyWord(id, btn);
      });
    });
  }

  function renderCard(item) {
    const domain = getDomain(item.sourceUrl);
    const meaning = escapeHtml(item.meaning || "");
    const context = escapeHtml(item.contextSentence || "");
    return `
      <div class="word-card">
        <div class="word-card-header">
          <span class="word-text">${escapeHtml(item.text)}</span>
          <div class="word-card-actions">
            <button class="btn btn-icon btn-sm fav-btn ${item.favorite ? "fav-active" : ""}" data-action="fav" data-id="${item.id}" title="Favorite">★</button>
            <button class="btn btn-icon btn-sm" data-action="copy" data-id="${item.id}" title="Copy">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            </button>
            <button class="btn btn-icon btn-sm" data-action="edit" data-id="${item.id}" title="Edit">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="btn btn-icon btn-sm" data-action="delete" data-id="${item.id}" title="Delete" style="color:#f87171;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </div>
        ${meaning ? `<div class="word-meaning">${meaning}</div>` : ""}
        ${context ? `<div class="word-context">"${context}"</div>` : ""}
        <div class="word-meta">
          <span class="word-source">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            <a href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="noopener">${escapeHtml(domain || item.sourceTitle || "Unknown")}</a>
          </span>
          <span>${escapeHtml(item.dateAdded || "")}</span>
        </div>
      </div>
    `;
  }

  // ---------------------------------------------------------------------------
  // FILTERING
  // ---------------------------------------------------------------------------
  function getFiltered() {
    let items = [...vocabulary];

    if (currentFilter === "favorites") {
      items = items.filter((i) => i.favorite);
    } else if (currentFilter === "recent") {
      const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      items = items.filter((i) => i.timestamp >= weekAgo);
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      items = items.filter(
        (i) =>
          (i.text || "").toLowerCase().includes(q) ||
          (i.meaning || "").toLowerCase().includes(q) ||
          (i.note || "").toLowerCase().includes(q) ||
          (i.sourceTitle || "").toLowerCase().includes(q) ||
          (i.contextSentence || "").toLowerCase().includes(q)
      );
    }

    return items;
  }

  // ---------------------------------------------------------------------------
  // STATS
  // ---------------------------------------------------------------------------
  function updateStats() {
    const today = new Date().toISOString().split("T")[0];
    statTotal.textContent = vocabulary.length;
    statFav.textContent = vocabulary.filter((i) => i.favorite).length;
    statToday.textContent = vocabulary.filter((i) => i.dateAdded === today).length;
    const sources = new Set(vocabulary.map((i) => getDomain(i.sourceUrl)).filter(Boolean));
    statSources.textContent = sources.size;
  }

  // ---------------------------------------------------------------------------
  // ACTIONS
  // ---------------------------------------------------------------------------
  function deleteWord(id) {
    if (!confirm("Delete this word from WordVaults?")) return;
    vocabulary = vocabulary.filter((i) => i.id !== id);
    saveVocabulary(() => render());
  }

  function toggleFavorite(id) {
    const item = vocabulary.find((i) => i.id === id);
    if (item) {
      item.favorite = !item.favorite;
      saveVocabulary(() => render());
    }
  }

  function copyWord(id, btn) {
    const item = vocabulary.find((i) => i.id === id);
    if (item) {
      navigator.clipboard.writeText(item.text).then(() => {
        const orig = btn.innerHTML;
        btn.innerHTML = "✓";
        setTimeout(() => (btn.innerHTML = orig), 1200);
      });
    }
  }

  // ---------------------------------------------------------------------------
  // EDIT MODAL
  // ---------------------------------------------------------------------------
  function openEditModal(id) {
    const item = vocabulary.find((i) => i.id === id);
    if (!item) return;
    editingId = id;
    document.getElementById("edit-text").value = item.text || "";
    document.getElementById("edit-meaning").value = item.meaning || "";
    document.getElementById("edit-note").value = item.note || "";
    document.getElementById("edit-example").value = item.example || "";
    document.getElementById("edit-category").value = item.category || "";
    document.getElementById("edit-source").textContent = "Source: " + (item.sourceUrl || "N/A");
    document.getElementById("edit-date").textContent = "Added: " + (item.dateAdded || "N/A");
    modalOverlay.style.display = "flex";
  }

  function closeEditModal() {
    modalOverlay.style.display = "none";
    editingId = null;
  }

  function saveEdit() {
    const item = vocabulary.find((i) => i.id === editingId);
    if (!item) return;
    item.text = document.getElementById("edit-text").value.trim() || item.text;
    item.meaning = document.getElementById("edit-meaning").value.trim();
    item.note = document.getElementById("edit-note").value.trim();
    item.example = document.getElementById("edit-example").value.trim();
    item.category = document.getElementById("edit-category").value.trim();
    saveVocabulary(() => {
      closeEditModal();
      render();
    });
  }

  document.getElementById("modal-close").addEventListener("click", closeEditModal);
  document.getElementById("modal-cancel").addEventListener("click", closeEditModal);
  document.getElementById("modal-save").addEventListener("click", saveEdit);
  modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) closeEditModal();
  });

  // ---------------------------------------------------------------------------
  // SEARCH
  // ---------------------------------------------------------------------------
  searchInput.addEventListener("input", () => {
    searchQuery = searchInput.value.trim();
    render();
  });

  // ---------------------------------------------------------------------------
  // TABS
  // ---------------------------------------------------------------------------
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      currentFilter = tab.dataset.filter;
      render();
    });
  });

  // ---------------------------------------------------------------------------
  // CSV EXPORT
  // ---------------------------------------------------------------------------
  btnExport.addEventListener("click", () => {
    if (vocabulary.length === 0) {
      alert("No vocabulary to export.");
      return;
    }
    const headers = ["Word", "Meaning", "Context", "Source URL", "Source Title", "Date Added", "Note", "Example", "Category", "Favorite"];
    const rows = vocabulary.map((item) => [
      csvCell(item.text),
      csvCell(item.meaning),
      csvCell(item.contextSentence),
      csvCell(item.sourceUrl),
      csvCell(item.sourceTitle),
      csvCell(item.dateAdded),
      csvCell(item.note),
      csvCell(item.example),
      csvCell(item.category),
      item.favorite ? "Yes" : "No",
    ]);
    const csv = "\uFEFF" + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `WordVaults_Export_${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });

  function csvCell(value) {
    if (value == null) return '""';
    const str = String(value);
    if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return '"' + str + '"';
  }

  // ---------------------------------------------------------------------------
  // CSV IMPORT
  // ---------------------------------------------------------------------------
  btnImport.addEventListener("click", () => fileImport.click());
  fileImport.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (ev) {
      try {
        const text = ev.target.result;
        const lines = parseCSV(text);
        if (lines.length < 2) {
          alert("CSV file appears empty.");
          return;
        }
        const headers = lines[0].map((h) => h.toLowerCase().trim());
        const wordIdx = headers.indexOf("word");
        if (wordIdx < 0) {
          alert("CSV must have a 'Word' column.");
          return;
        }
        let imported = 0;
        let skipped = 0;
        for (let i = 1; i < lines.length; i++) {
          const row = lines[i];
          const word = (row[wordIdx] || "").trim();
          if (!word) continue;
          // Duplicate check
          if (vocabulary.some((v) => v.text.toLowerCase() === word.toLowerCase())) {
            skipped++;
            continue;
          }
          vocabulary.push({
            id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5) + i,
            text: word,
            meaning: row[headers.indexOf("meaning")] || "",
            contextSentence: row[headers.indexOf("context")] || "",
            sourceUrl: row[headers.indexOf("source url")] || "",
            sourceTitle: row[headers.indexOf("source title")] || "",
            dateAdded: row[headers.indexOf("date added")] || new Date().toISOString().split("T")[0],
            timestamp: Date.now(),
            note: row[headers.indexOf("note")] || "",
            example: row[headers.indexOf("example")] || "",
            category: row[headers.indexOf("category")] || "",
            favorite: (row[headers.indexOf("favorite")] || "").toLowerCase() === "yes",
          });
          imported++;
        }
        saveVocabulary(() => {
          render();
          alert(`Imported ${imported} words. Skipped ${skipped} duplicates.`);
        });
      } catch (err) {
        alert("Failed to parse CSV: " + err.message);
      }
    };
    reader.readAsText(file, "utf-8");
    fileImport.value = "";
  });

  function parseCSV(text) {
    const result = [];
    let row = [];
    let cell = "";
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (i + 1 < text.length && text[i + 1] === '"') {
            cell += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          cell += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ",") {
          row.push(cell);
          cell = "";
        } else if (ch === "\n" || ch === "\r") {
          if (ch === "\r" && i + 1 < text.length && text[i + 1] === "\n") i++;
          row.push(cell);
          cell = "";
          if (row.length > 0) result.push(row);
          row = [];
        } else {
          cell += ch;
        }
      }
    }
    row.push(cell);
    if (row.some((c) => c.trim())) result.push(row);
    return result;
  }

  // ---------------------------------------------------------------------------
  // HELPERS
  // ---------------------------------------------------------------------------
  function escapeHtml(str) {
    if (!str) return "";
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function getDomain(url) {
    try {
      return new URL(url).hostname.replace("www.", "");
    } catch {
      return "";
    }
  }

  // Listen for storage changes (from other tabs/contexts)
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.vocabulary) {
      vocabulary = changes.vocabulary.newValue || [];
      render();
    }
  });

  // ---------------------------------------------------------------------------
  // KEYBOARD SHORTCUTS LINK
  // ---------------------------------------------------------------------------
  const shortcutsLink = document.getElementById("link-chrome-shortcuts");
  if (shortcutsLink) {
    shortcutsLink.addEventListener("click", (e) => {
      e.preventDefault();
      // chrome:// URLs cannot be opened directly from extensions
      navigator.clipboard.writeText("chrome://extensions/shortcuts").then(() => {
        alert("Link copied to clipboard!\n\nPaste  chrome://extensions/shortcuts  in your address bar to customize keyboard shortcuts.");
      }).catch(() => {
        alert("Open  chrome://extensions/shortcuts  in your address bar to customize keyboard shortcuts.");
      });
    });
  }
})();
