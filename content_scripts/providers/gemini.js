(() => {
  const C = window.AIImpactCommon;
  if (!C || C.detectProvider() !== "gemini" || window.__aiimGemini) return;
  window.__aiimGemini = true;

  const IMAGE_ALT_RE = /generat|creata con|ai-generated|immagine generata|imagen generada/i;

  function hash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  function mediaKey(src) {
    if (!src) return "";
    try {
      const u = new URL(src, location.href);
      if (u.protocol === "blob:") return src;
      if (u.protocol === "data:") return `data:${hash(src)}`;
      // googleusercontent aggiunge suffissi di dimensione (=s1024, =w512-h512...)
      return u.origin + u.pathname.replace(/=[a-z0-9-]+$/i, "");
    } catch (_e) {
      return hash(src);
    }
  }

  function scanMedia(node) {
    const items = [];
    const seen = new Set();
    const generated = node.querySelectorAll(
      "generated-image img, single-image img, .generated-image img, .generated-images img, img[data-test-id='generated-image']"
    );
    const pushImg = (img) => {
      if (seen.has(img)) return;
      seen.add(img);
      const src = img.currentSrc || img.src;
      if (!src) return;
      const r = img.getBoundingClientRect();
      if (r.width < 96 && r.height < 96) return;
      items.push({ key: `gemini:${mediaKey(src)}`, kind: "image", el: img });
    };
    generated.forEach(pushImg);
    for (const img of node.querySelectorAll("img[alt]")) {
      if (IMAGE_ALT_RE.test(img.getAttribute("alt") || "")) pushImg(img);
    }
    for (const v of node.querySelectorAll("video")) {
      const src = v.currentSrc || v.src || v.poster || (v.querySelector("source") || {}).src;
      if (src) items.push({ key: `gemini:v:${mediaKey(src)}`, kind: "video", el: v });
    }
    return items;
  }

  C.createTracker({
    provider: "gemini",
    idleMs: 2000,
    composerSelectors: [
      ".ql-editor[contenteditable='true']",
      "rich-textarea [contenteditable='true']",
      "div[contenteditable='true'][role='textbox']",
      "textarea"
    ],
    sendButtonSelectors: ["button.send-button:not(.stop)", "button[aria-label*='Send message' i]", "button[aria-label*='Invia messaggio' i]"],
    stopSelectors: [
      "button.send-button.stop",
      "button[aria-label*='Stop response' i]",
      "button[aria-label*='Interrompi risposta' i]"
    ],
    regenerateSelectors: ["button[aria-label*='Regenerate' i]", "button[aria-label*='Rigenera' i]", "button[mattooltip*='Redo' i]"],
    userSelectors: ["user-query", ".user-query-bubble-with-background", "user-query-content"],
    assistantSelectors: ["model-response", "message-content", ".model-response-text"],
    modelSelectors: ["[data-test-id='bard-mode-menu-button']", "bard-mode-switcher button", ".current-mode-title"],
    scanMedia
  });
})();
