(() => {
  const C = window.AIImpactCommon;
  if (!C || C.detectProvider() !== "claude") return;

  const STATE = {
    lastAssistantText: "",
    lastUserText: "",
    currentActivity: null,
    lastActivityId: null,
    responseObserverDisconnect: null
  };

  function getComposerText() {
    const composer = C.findMainComposer();
    if (!composer) return "";
    if (composer.tagName === "TEXTAREA" || composer.tagName === "INPUT") return composer.value || "";
    return composer.innerText || "";
  }

  function findChatContainer() {
    return document.querySelector("main") || document.body;
  }

  function findLatestUserMessage() {
    const node = document.querySelector("[data-testid*='user']") || document.querySelector("[data-message-author='user']");
    if (node) return node;
    return findLatestByHeuristic("user");
  }

  function findLatestAssistantMessage() {
    const node = document.querySelector("[data-testid*='assistant']") || document.querySelector("[data-message-author='assistant']");
    if (node) return node;
    return findLatestByHeuristic("assistant");
  }

  function findLatestByHeuristic(roleHint) {
    const container = findChatContainer();
    const candidates = Array.from(container.querySelectorAll("article, div, section"))
      .filter((el) => el instanceof HTMLElement)
      .filter((el) => {
        const t = C.getVisibleText(el);
        if (!t || t.length < 10) return false;
        if (el.closest("[contenteditable='true']")) return false;
        const cls = (el.className || "").toString().toLowerCase();
        const aria = (el.getAttribute("aria-label") || "").toLowerCase();
        if (roleHint === "user" && (cls.includes("user") || aria.includes("you"))) return true;
        if (roleHint === "assistant" && (cls.includes("assistant") || aria.includes("assistant") || aria.includes("claude"))) return true;
        return false;
      });
    if (candidates.length) return candidates[candidates.length - 1];
    return null;
  }

  function finalizeFromAssistantNode(node) {
    if (!node || !STATE.currentActivity) return;
    const text = C.getVisibleText(node);
    if (!text) return;
    STATE.currentActivity.ts_end = Date.now();
    STATE.currentActivity.response_chars = text.length;
    STATE.currentActivity.response_words = C.countWords(text);
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
    activity.provider = "claude";
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
    if (!composer) return;
    composer.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) setTimeout(onSubmit, 0);
    });
    const sendBtn = document.querySelector("button[aria-label*='Send']") || document.querySelector("button[type='submit']");
    if (sendBtn) sendBtn.addEventListener("click", () => setTimeout(onSubmit, 0));
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
      watchAssistantResponse();
    });
    observer.observe(container, { childList: true, subtree: true });
  }

  function setupMediaDetection() {
    const container = findChatContainer();
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const n of m.addedNodes) {
          if (!(n instanceof HTMLElement)) continue;
          const assistantNode = findLatestAssistantMessage();
          const imgs = assistantNode ? C.extractGeneratedImages(assistantNode) : [];
          if (imgs.length) {
            const activity = {
              id: C.uuid(),
              provider: "claude",
              modality: "image",
              type: "image_gen",
              ts_start: Date.now(),
              ts_end: Date.now(),
              page_url: location.href,
              meta: {
                count: imgs.length,
                resolution: Array.from(imgs).map((img) => {
                  const w = img.naturalWidth || img.width || null;
                  const h = img.naturalHeight || img.height || null;
                  return w && h ? `${w}x${h}` : "unknown";
                })
              }
            };
            C.sendMessage({ type: "activity_final", activity });
          }
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
              provider: "claude",
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
    observer.observe(container, { childList: true, subtree: true });
  }

  function setupRegenerate() {
    const container = findChatContainer();
    const observer = new MutationObserver(() => {
      const regenBtn = document.querySelector("button[aria-label*='Regenerate']") || document.querySelector("button[aria-label*='Retry']");
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
    C.log("claude init error", e);
  }
})();
