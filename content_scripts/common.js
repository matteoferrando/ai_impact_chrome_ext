(() => {
  const PREFIX = "[AI Impact Meter]";

  function log(...args) {
    try {
      console.log(PREFIX, ...args);
    } catch (_e) {}
  }

  function uuid() {
    // Simple UUIDv4-ish
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function debounce(fn, wait) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  function estimateTokensFromChars(chars, charsPerToken) {
    if (!charsPerToken || charsPerToken <= 0) return 0;
    return Math.ceil(chars / charsPerToken);
  }

  function countWords(text) {
    if (!text) return 0;
    const m = text.trim().match(/\S+/g);
    return m ? m.length : 0;
  }

  function getVisibleText(el) {
    if (!el) return "";
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    const parts = [];
    let node;
    while ((node = walker.nextNode())) {
      const t = node.textContent;
      if (t && t.trim()) parts.push(t.trim());
    }
    return parts.join(" ").trim();
  }

  function isVisible(el) {
    if (!el || !(el instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    return true;
  }

  function hasIconLikeMeta(img) {
    const alt = (img.getAttribute("alt") || "").toLowerCase();
    const cls = (img.className || "").toString().toLowerCase();
    const src = (img.getAttribute("src") || "").toLowerCase();
    const hints = ["icon", "logo", "avatar", "sprite", "emoji", "profile", "favicon"];
    if (src.startsWith("chrome-extension://")) return true;
    return hints.some((h) => alt.includes(h) || cls.includes(h) || src.includes(h));
  }

  function extractGeneratedImages(rootEl) {
    if (!rootEl || !(rootEl instanceof HTMLElement)) return [];
    const imgs = Array.from(rootEl.querySelectorAll("img"));
    const filtered = imgs.filter((img) => {
      if (!isVisible(img)) return false;
      const w = img.naturalWidth || img.width || 0;
      const h = img.naturalHeight || img.height || 0;
      const rect = img.getBoundingClientRect();
      const rw = rect.width || 0;
      const rh = rect.height || 0;
      const sizeOk = (w >= 80 || h >= 80) || (rw >= 80 || rh >= 80);
      if (!sizeOk) return false;
      if (hasIconLikeMeta(img)) return false;
      return true;
    });
    return filtered;
  }

  function findMainComposer() {
    // Try common patterns: textarea, contenteditable
    const textarea = document.querySelector("textarea");
    if (textarea) return textarea;

    const editable = document.querySelector("[contenteditable='true']");
    if (editable) return editable;

    return null;
  }

  function stableObserver(targetEl, idleMs, onDone) {
    if (!targetEl) return () => {};
    let lastChange = Date.now();
    const observer = new MutationObserver(() => {
      lastChange = Date.now();
    });
    observer.observe(targetEl, { childList: true, subtree: true, characterData: true });

    const interval = setInterval(() => {
      if (Date.now() - lastChange >= idleMs) {
        clearInterval(interval);
        try {
          observer.disconnect();
        } catch (_e) {}
        onDone();
      }
    }, Math.min(500, Math.max(200, idleMs / 3)));

    return () => {
      clearInterval(interval);
      try {
        observer.disconnect();
      } catch (_e) {}
    };
  }

  function sendMessage(msg) {
    try {
      chrome.runtime.sendMessage(msg, () => {
        const err = chrome.runtime.lastError;
        if (err) log("sendMessage error", err);
      });
    } catch (e) {
      log("sendMessage exception", e);
    }
  }

  function detectProvider() {
    const host = location.host;
    if (host.includes("chat.openai.com") || host.includes("chatgpt.com")) return "chatgpt";
    if (host.includes("gemini.google.com")) return "gemini";
    if (host.includes("claude.ai")) return "claude";
    return "unknown";
  }

  function getDomain() {
    return location.host;
  }

  function buildBaseActivity() {
    return {
      id: uuid(),
      provider: detectProvider(),
      page_url: location.href,
      domain: getDomain(),
      modality: "text",
      type: "text_turn",
      ts_start: Date.now(),
      prompt_chars: 0,
      prompt_words: 0,
      response_chars: 0,
      response_words: 0,
      tab_id: null,
      session_id: null,
      meta: {}
    };
  }

  function getSchemaDefaults() {
    return {
      chars_per_token: 4,
      kwh_per_1k_tokens_range: { min: 0.0005, mid: 0.001, max: 0.002 },
      kwh_per_image_range: { min: 0.0002, mid: 0.0006, max: 0.001 },
      kwh_per_video_sec_range: { min: 0.00005, mid: 0.0002, max: 0.0006 },
      grid_gco2e_per_kwh_range: { min: 200, mid: 400, max: 700 }
    };
  }

  window.AIImpactCommon = {
    log,
    uuid,
    debounce,
    estimateTokensFromChars,
    countWords,
    getVisibleText,
    extractGeneratedImages,
    findMainComposer,
    stableObserver,
    sendMessage,
    detectProvider,
    getDomain,
    buildBaseActivity,
    getSchemaDefaults
  };

  // Backward-compat alias for provider scripts expecting AIIM
  if (!window.AIIM) {
    window.AIIM = window.AIImpactCommon;
  }
})();
