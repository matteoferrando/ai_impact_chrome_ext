(() => {
  const C = window.AIImpactCommon;
  if (!C || C.detectProvider() !== "chatgpt" || window.__aiimChatgpt) return;
  window.__aiimChatgpt = true;

  const IMAGE_ALT_RE = /generat|immagine generata|imagen generada|image générée|erstellt|bild/i;

  // Un turno dell'assistente può contenere più messaggi (ragionamento, tool, risposta):
  // si usa il contenitore del turno per contare tutto il testo prodotto.
  function getAssistantNodes() {
    const msgs = document.querySelectorAll("[data-message-author-role='assistant']");
    const out = [];
    let prev = null;
    for (const m of msgs) {
      const c = m.closest("article, [data-testid^='conversation-turn-']") || m;
      if (c !== prev) {
        out.push(c);
        prev = c;
      }
    }
    if (out.length) return out;
    return Array.from(document.querySelectorAll("article[data-turn='assistant'], .agent-turn"));
  }

  function fileKey(src) {
    if (!src) return "";
    const m = src.match(/[?&]id=(file[-_][^&]+)/i) || src.match(/(file[-_][A-Za-z0-9]+)/);
    if (m) return m[1];
    try {
      const u = new URL(src, location.href);
      return u.protocol === "blob:" ? src : u.origin + u.pathname;
    } catch (_e) {
      return src;
    }
  }

  function largest(imgs) {
    let best = null;
    let area = -1;
    for (const img of imgs) {
      const r = img.getBoundingClientRect();
      const a = Math.max((img.naturalWidth || 0) * (img.naturalHeight || 0), r.width * r.height);
      if (a > area) {
        area = a;
        best = img;
      }
    }
    return best;
  }

  function scanMedia(node) {
    const items = [];
    const containers = node.querySelectorAll("div[id^='image-'], [class*='imagegen-image']");
    const covered = new Set();
    for (const c of containers) {
      const imgs = Array.from(c.querySelectorAll("img"));
      imgs.forEach((i) => covered.add(i));
      const img = largest(imgs);
      if (!img) continue;
      items.push({ key: `chatgpt:${c.id || fileKey(img.currentSrc || img.src)}`, kind: "image", el: img });
    }
    for (const img of node.querySelectorAll("img[alt]")) {
      if (covered.has(img)) continue;
      if (!IMAGE_ALT_RE.test(img.getAttribute("alt") || "")) continue;
      const r = img.getBoundingClientRect();
      if (r.width < 120 && r.height < 120) continue;
      items.push({ key: `chatgpt:${fileKey(img.currentSrc || img.src)}`, kind: "image", el: img });
    }
    for (const v of node.querySelectorAll("video")) {
      const src = v.currentSrc || v.src || v.poster;
      if (src) items.push({ key: `chatgpt:v:${fileKey(src)}`, kind: "video", el: v });
    }
    return items;
  }

  C.createTracker({
    provider: "chatgpt",
    idleMs: 1500,
    composerSelectors: ["#prompt-textarea", "form [contenteditable='true']", "form textarea", "textarea[data-id='root']"],
    sendButtonSelectors: [
      "button[data-testid='send-button']",
      "#composer-submit-button",
      "button[data-testid='composer-send-button']"
    ],
    stopSelectors: [
      "button[data-testid='stop-button']",
      "button[aria-label='Stop streaming']",
      "button[aria-label='Stop generating']",
      ".result-streaming"
    ],
    regenerateSelectors: ["button[data-testid='regenerate-thread-error-button']", "[data-testid='regenerate-button']"],
    userSelectors: ["[data-message-author-role='user']", "article[data-turn='user']"],
    getAssistantNodes,
    modelSelectors: ["[data-testid='model-switcher-dropdown-button']", "button[aria-label*='Model selector' i]"],
    scanMedia
  });
})();
