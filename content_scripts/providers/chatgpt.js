(() => {
  const C = window.AIImpactCommon;
  if (!C || C.detectProvider() !== "chatgpt") return;

  const STATE = {
    lastAssistantText: "",
    lastUserText: "",
    currentActivity: null,
    lastActivityId: null,
    responseObserverDisconnect: null,
    lastPromptTrackedText: "",
    seenImageKeys: new Set()
  };

  function getComposerText() {
    const composer = C.findMainComposer();
    if (!composer) return "";
    if (composer.tagName === "TEXTAREA" || composer.tagName === "INPUT") {
      return composer.value || "";
    }
    return composer.innerText || "";
  }

  function findChatContainer() {
    return document.querySelector("main") || document.body;
  }

  function findLatestUserMessage() {
    let nodes = document.querySelectorAll("[data-message-author-role='user']");
    if (nodes.length) return nodes[nodes.length - 1];
    nodes = document.querySelectorAll("article[data-turn='user'], [data-testid^='conversation-turn-'][data-turn='user']");
    if (nodes.length) return nodes[nodes.length - 1];
    return null;
  }

  function findLatestAssistantMessage() {
    let nodes = document.querySelectorAll("[data-message-author-role='assistant']");
    if (nodes.length) return nodes[nodes.length - 1];
    nodes = document.querySelectorAll("article[data-turn='assistant'], [data-testid^='conversation-turn-'][data-turn='assistant'], .agent-turn");
    if (nodes.length) return nodes[nodes.length - 1];
    return null;
  }

  function finalizeFromAssistantNode(node) {
    if (!node || !STATE.currentActivity) return;
    const text = C.getVisibleText(node);
    if (!text) return;
    const responseChars = text.length;
    const responseWords = C.countWords(text);

    STATE.currentActivity.ts_end = Date.now();
    STATE.currentActivity.response_chars = responseChars;
    STATE.currentActivity.response_words = responseWords;

    C.sendMessage({ type: "activity_final", activity: STATE.currentActivity });
    STATE.lastActivityId = STATE.currentActivity.id;
    STATE.currentActivity = null;
  }

  function watchAssistantResponse() {
    const node = findLatestAssistantMessage();
    if (!node) return;
    if (STATE.responseObserverDisconnect) STATE.responseObserverDisconnect();
    STATE.responseObserverDisconnect = C.stableObserver(node, 1200, () => finalizeFromAssistantNode(node));
  }

  function startTurn(promptText, meta) {
    const activity = C.buildBaseActivity();
    activity.prompt_chars = promptText.length;
    activity.prompt_words = C.countWords(promptText);
    activity.meta = meta || {};

    if (meta && meta.regenerate_of) activity.regenerate_of = meta.regenerate_of;

    STATE.currentActivity = activity;
    C.sendMessage({ type: "activity_partial", activity });

    setTimeout(watchAssistantResponse, 300);
  }

  function onSubmit() {
    const text = getComposerText().trim();
    if (!text) return;
    STATE.lastUserText = text;
    startTurn(text, {});
  }

  function setupComposerHooks() {
    const composer = C.findMainComposer();
    if (!composer) {
      setTimeout(setupComposerHooks, 800);
      return;
    }
    if (composer.__aiImpactBound) return;
    composer.__aiImpactBound = true;

    composer.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        setTimeout(onSubmit, 0);
      }
    });

    const sendBtn =
      document.querySelector("button[data-testid='send-button']") ||
      document.querySelector("button[type='submit']") ||
      document.querySelector("button[aria-label*='Send']") ||
      document.querySelector("button[aria-label*='Invia']");
    if (sendBtn) {
      sendBtn.addEventListener("click", () => setTimeout(onSubmit, 0));
    }

    const form =
      composer.closest("form") ||
      document.querySelector("form[data-type='unified-composer']") ||
      document.querySelector("form");
    if (form && !form.__aiImpactBound) {
      form.__aiImpactBound = true;
      form.addEventListener("submit", (e) => {
        try {
          if (e) e.preventDefault();
        } catch (_e) {}
        setTimeout(onSubmit, 0);
      });
    }
  }

  function setupMutationFallback() {
    const container = findChatContainer();
    const observer = new MutationObserver(() => {
      const userNode = findLatestUserMessage();
      if (userNode) {
        const text = C.getVisibleText(userNode);
        if (text && text !== STATE.lastUserText) {
          STATE.lastUserText = text;
          startTurn(text, {});
        }
      }
      const assistantNode = findLatestAssistantMessage();
      if (assistantNode) {
        // If we missed the submit event, infer a prompt from the latest user message.
        if (!STATE.currentActivity) {
          const inferredText = STATE.lastUserText || (userNode ? C.getVisibleText(userNode) : "");
          if (inferredText && inferredText !== STATE.lastPromptTrackedText) {
            STATE.lastPromptTrackedText = inferredText;
            startTurn(inferredText, { inferred_from_dom: true });
          }
        }
        watchAssistantResponse();
      }
    });
    observer.observe(container, { childList: true, subtree: true });
  }

  function setupMediaDetection() {
    const container = findChatContainer();
    const scanForImages = (rootEl) => {
      if (!rootEl) return;
      const isImageGenContainer = (el) => {
        if (!(el instanceof HTMLElement)) return false;
        if (el.id && el.id.startsWith("image-")) return true;
        const aria = (el.getAttribute("aria-label") || "").toLowerCase();
        if (aria.includes("generazione immagine")) return true;
        const cls = (el.className || "").toLowerCase();
        return cls.includes("imagegen-image");
      };
      const getFileIdFromSrc = (src) => {
        if (!src) return "";
        const m = src.match(/id=(file_[^&]+)/i);
        return m ? m[1] : "";
      };
      const pickPrimaryImg = (imgs) => {
        return (
          imgs
            .map((img) => {
              const w = img.naturalWidth || img.width || 0;
              const h = img.naturalHeight || img.height || 0;
              const rect = img.getBoundingClientRect();
              const rw = rect.width || 0;
              const rh = rect.height || 0;
              const area = Math.max(w * h, rw * rh);
              return { img, area };
            })
            .sort((a, b) => b.area - a.area)[0]?.img || imgs[0]
        );
      };

      const scanImageContainers = (scopeEl) => {
        if (!scopeEl || !(scopeEl instanceof HTMLElement)) return false;
        const containers = Array.from(
          scopeEl.querySelectorAll("div[id^='image-'], [class*='imagegen-image']")
        );
        if (!containers.length) return false;
        containers.forEach((el) => {
          const imgs = Array.from(el.querySelectorAll("img"));
          if (!imgs.length) return;
          const primaryImg = pickPrimaryImg(imgs);
          const primarySrc = primaryImg ? primaryImg.currentSrc || primaryImg.src : "";
          const fileId = getFileIdFromSrc(primarySrc);
          const key = el.id || fileId || primarySrc;
          if (key && STATE.seenImageKeys.has(key)) return;
          if (key) STATE.seenImageKeys.add(key);
          const w = primaryImg ? primaryImg.naturalWidth || primaryImg.width || null : null;
          const h = primaryImg ? primaryImg.naturalHeight || primaryImg.height || null : null;
          const activity = {
            id: C.uuid(),
            provider: "chatgpt",
            modality: "image",
            type: "image_gen",
            ts_start: Date.now(),
            ts_end: Date.now(),
            page_url: location.href,
            meta: {
              count: 1,
              resolution: w && h ? `${w}x${h}` : "unknown"
            }
          };
          C.sendMessage({ type: "activity_final", activity });
        });
        return true;
      };

      if (scanImageContainers(rootEl)) return;

      const found = Array.from(
        rootEl.querySelectorAll("[id^='image-'], [aria-label*='Generazione immagine'], [class*='imagegen-image']")
      );
      const candidates = new Set(found);
      if (!found.length) candidates.add(rootEl);

      candidates.forEach((el) => {
        if (!(el instanceof HTMLElement)) return;
        const imgs = C.extractGeneratedImages(el);
        if (!imgs.length) return;
        const primaryImg = pickPrimaryImg(imgs);
        const primarySrc = primaryImg ? primaryImg.currentSrc || primaryImg.src : "";
        const fileId = getFileIdFromSrc(primarySrc);
        const key = el.id || fileId || (el.getAttribute("aria-label") || "") || primarySrc;
        if (key && STATE.seenImageKeys.has(key)) return;
        if (key) STATE.seenImageKeys.add(key);
        const count = isImageGenContainer(el) ? 1 : imgs.length;
        const resolution = (() => {
          const target = isImageGenContainer(el) ? primaryImg : imgs[0];
          if (!target) return "unknown";
          const w = target.naturalWidth || target.width || null;
          const h = target.naturalHeight || target.height || null;
          return w && h ? `${w}x${h}` : "unknown";
        })();
        const activity = {
          id: C.uuid(),
          provider: "chatgpt",
          modality: "image",
          type: "image_gen",
          ts_start: Date.now(),
          ts_end: Date.now(),
          page_url: location.href,
          meta: {
            count,
            resolution
          }
        };
        C.sendMessage({ type: "activity_final", activity });
      });
    };

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        const nodes = Array.from(m.addedNodes || []);
        if (m.type === "attributes" && m.target && m.target instanceof HTMLElement) {
          nodes.push(m.target);
        }
        for (const n of nodes) {
          if (!(n instanceof HTMLElement)) continue;
          const assistantNode =
            n.closest && n.closest("[data-message-author-role='assistant']")
              ? n.closest("[data-message-author-role='assistant']")
              : (n.closest && n.closest("article[data-turn='assistant']")) ||
                findLatestAssistantMessage();
          const rootForImages = assistantNode || n;
          if (rootForImages) scanForImages(rootForImages);
          const videos = n.querySelectorAll("video");
          if (videos.length) {
            const durations = Array.from(videos).map((v) => (Number.isFinite(v.duration) ? v.duration : "unknown"));
            const resolutions = Array.from(videos).map((v) => {
              const w = v.videoWidth || null;
              const h = v.videoHeight || null;
              return w && h ? `${w}x${h}` : "unknown";
            });
            const activity = {
              id: C.uuid(),
              provider: "chatgpt",
              modality: "video",
              type: "video_gen",
              ts_start: Date.now(),
              ts_end: Date.now(),
              page_url: location.href,
              meta: {
                count: videos.length,
                duration_sec: durations.every((d) => typeof d === "number") ? durations.reduce((a, b) => a + b, 0) : 0,
                duration_meta: durations,
                resolution: resolutions
              }
            };
            C.sendMessage({ type: "activity_final", activity });
          }
        }
      }
    });
    observer.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ["src", "style", "class"] });

    // Initial scan in case images are already present when the script loads.
    setTimeout(() => {
      try {
        const assistantNode = findLatestAssistantMessage();
        if (assistantNode) scanForImages(assistantNode);
      } catch (_e) {}
    }, 1200);
  }

  function setupRegenerate() {
    const container = findChatContainer();
    const observer = new MutationObserver(() => {
      const regenBtn = document.querySelector("button[aria-label*='Regenerate']");
      if (regenBtn && !regenBtn.__aiImpactBound) {
        regenBtn.__aiImpactBound = true;
        regenBtn.addEventListener("click", () => {
          const text = STATE.lastUserText || "";
          if (!text) return;
          startTurn(text, { regenerate_of: STATE.lastActivityId || null });
        });
      }
    });
    observer.observe(container, { childList: true, subtree: true });
  }

  function init() {
    setupComposerHooks();
    setupMutationFallback();
    setupMediaDetection();
    setupRegenerate();
  }

  try {
    init();
  } catch (e) {
    C.log("chatgpt init error", e);
  }
})();
