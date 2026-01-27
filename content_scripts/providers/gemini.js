// content_scripts/providers/gemini.js
(() => {
  const AIIM = globalThis.AIIM || {};
  const PROVIDER = "gemini";

  // ---------- helpers (fallback-safe) ----------
  const log = (...a) => (AIIM.log ? AIIM.log(...a) : console.log("[AI Impact Meter]", ...a));
  const now = () => Date.now();
  const uuid = () =>
    (AIIM.uuid ? AIIM.uuid() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

  const estimateWords = (txt) => {
    if (AIIM.estimateWords) return AIIM.estimateWords(txt);
    const s = (txt || "").trim();
    if (!s) return 0;
    return s.split(/\s+/).length;
  };

  const safeText = (el) => {
    if (!el) return "";
    if (AIIM.getVisibleText) return AIIM.getVisibleText(el);
    return (el.innerText || el.textContent || "").trim();
  };

  const sendToSW = (type, payload) => {
    if (AIIM.sendToSW) return AIIM.sendToSW(type, payload);
    try {
      chrome.runtime.sendMessage({ type, ...payload });
    } catch (e) {
      // ignore
    }
  };

  const stableObserver = (targetEl, idleMs, onDone) => {
    if (AIIM.stableObserver) return AIIM.stableObserver(targetEl, idleMs, onDone);

    // Minimal fallback stable observer
    if (!targetEl) return;
    let timer = null;
    const mo = new MutationObserver(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        mo.disconnect();
        onDone?.();
      }, idleMs);
    });
    mo.observe(targetEl, { subtree: true, childList: true, characterData: true });
    timer = setTimeout(() => {
      mo.disconnect();
      onDone?.();
    }, idleMs);
  };

  const findMainComposer = () => {
    if (AIIM.findMainComposer) return AIIM.findMainComposer();

    // fallback: try multiple selectors in priority order and return the first visible element
    const selectors = [
      ".ql-editor[contenteditable='true']",
      "div[contenteditable='true'][aria-label*='prompt' i]",
      "rich-textarea [contenteditable='true']",
      "textarea",
      "[contenteditable='true']",
    ];
    for (const sel of selectors) {
      const el = [...document.querySelectorAll(sel)].find((x) => x && x.offsetParent !== null);
      if (el) return el;
    }
    return null;
  };

  const getComposerText = () => {
    const c = findMainComposer();
    if (!c) return "";
    const tag = (c.tagName || "").toUpperCase();
    if (tag === "TEXTAREA" || tag === "INPUT") return (c.value || "").trim();
    return (c.innerText || c.textContent || "").trim();
  };

  const extractGeneratedImages = (rootEl) => {
    if (AIIM.extractGeneratedImages) return AIIM.extractGeneratedImages(rootEl);

    // fallback: only large, visible images within rootEl
    if (!rootEl) return [];
    const imgs = Array.from(rootEl.querySelectorAll("img"));
    return imgs.filter((img) => {
      try {
        const r = img.getBoundingClientRect();
        if (!r || r.width <= 0 || r.height <= 0) return false;

        // Avoid UI icons/avatars: require meaningful size
        if (r.width < 120 && r.height < 120) return false;

        const cls = (img.className || "").toLowerCase();
        const alt = (img.getAttribute("alt") || "").toLowerCase();
        const src = (img.currentSrc || img.src || "").toLowerCase();

        // Common UI exclusions
        if (cls.includes("avatar") || cls.includes("icon") || cls.includes("logo")) return false;
        if (alt.includes("avatar") || alt.includes("icon") || alt.includes("logo")) return false;
        if (src.includes("gstatic") && (r.width < 200 && r.height < 200)) return false;

        return true;
      } catch {
        return false;
      }
    });
  };

  const extractGeneratedVideos = (rootEl) => {
    if (AIIM.extractGeneratedVideos) return AIIM.extractGeneratedVideos(rootEl);
    if (!rootEl) return [];
    const vids = Array.from(rootEl.querySelectorAll("video"));
    return vids.filter((v) => {
      try {
        const r = v.getBoundingClientRect();
        if (!r || r.width <= 0 || r.height <= 0) return false;
        if (r.width < 160 && r.height < 160) return false;
        return true;
      } catch {
        return false;
      }
    });
  };

  // ---------- state ----------
  const STATE = {
    tabSessionId: uuid(),
    currentActivity: null,
    lastUserMsgText: "",
    lastAssistantMsgText: "",
    lastAssistantNode: null,
    lastAssistantNodeKey: "",
    lastSubmitTs: 0,
    lastUserNodeKey: "",

    hooksBound: false,
    watchersStarted: false,

    seenImageKeys: new Set(),
    seenVideoKeys: new Set(),
  };

  // ---------- DOM heuristics ----------
  // Gemini DOM changes often; we rely on flexible heuristics:
  // - A "user message" is typically near an element with contenteditable/textarea submit, but not always.
  // - A "model response" typically appears as a block of selectable text, often with code blocks, etc.

  function isProbablyComposer(el) {
    if (!el) return false;
    const tag = (el.tagName || "").toUpperCase();
    if (tag === "TEXTAREA" || tag === "INPUT") return true;
    const ce = el.getAttribute && el.getAttribute("contenteditable");
    if (ce === "true") return true;
    return false;
  }

  function findSendButtonNearComposer(composer) {
    // Try to find a send-like button in the same form/container
    const candidates = [];

    // 1) Common aria-labels (case-insensitive) and other known button selectors
    candidates.push(
      ...document.querySelectorAll("button[aria-label*='Send' i]"),
      ...document.querySelectorAll("button[aria-label*='Invia' i]"),
      ...document.querySelectorAll("button.send-button"),
      ...document.querySelectorAll("button[mattooltip*='Send' i]"),
      ...document.querySelectorAll("button[aria-label='Submit' i]")
    );

    // 2) submit button
    candidates.push(...document.querySelectorAll("button[type='submit']"));

    // 3) nearest container buttons (search only within reasonable container)
    if (composer && composer.closest) {
      const container = composer.closest("form") || composer.closest("div");
      if (container) candidates.push(...container.querySelectorAll("button"));
    }

    // Return first visible and enabled button
    return candidates.find((b) => b && !b.disabled && b.offsetParent !== null) || null;
  }

  function findMessageRoot() {
    // Try to locate a stable scrollable conversation region
    // (best-effort: biggest scrollable container)
    const candidates = Array.from(document.querySelectorAll("main, section, div")).filter((el) => {
      const st = getComputedStyle(el);
      const overflowY = st.overflowY;
      if (overflowY !== "auto" && overflowY !== "scroll") return false;
      const r = el.getBoundingClientRect();
      return r.width > 300 && r.height > 300;
    });

    // Pick the largest by area
    candidates.sort((a, b) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      return rb.width * rb.height - ra.width * ra.height;
    });

    return candidates[0] || document.body;
  }

  function pickLatestTextBlocks(root, limit = 40) {
    // Gather candidate blocks with meaningful text (avoid nav/menus)
    const els = Array.from(root.querySelectorAll("div, article, section")).slice(-200);
    const blocks = [];

    for (const el of els) {
      if (!el || el.offsetParent === null) continue;
      const t = safeText(el);
      if (!t || t.length < 20) continue;

      // Avoid giant containers (whole page)
      const r = el.getBoundingClientRect();
      if (r.width < 250 || r.height < 40) continue;

      // Prefer leaf-ish nodes
      const childDivs = el.querySelectorAll("div, article, section");
      if (childDivs.length > 25) continue;

      blocks.push({ el, t, area: r.width * r.height });
    }

    // Keep last few (roughly near bottom)
    return blocks.slice(-limit);
  }

  function detectLatestUserAndAssistant(root) {
    // Prefer Gemini-specific containers inside the current chat root.
    try {
      const scope = root || document.body;
      const userNodes = Array.from(
        scope.querySelectorAll("user-query-content .query-text, user-query .query-text, .user-query-bubble-with-background")
      ).filter((n) => {
        try {
          return n && n.offsetParent !== null;
        } catch {
          return true;
        }
      });
      const assistantNodes = Array.from(
        scope.querySelectorAll("message-content .markdown, message-content, structured-content-container, model-response")
      ).filter((n) => {
        try {
          return n && n.offsetParent !== null;
        } catch {
          return true;
        }
      });
      const user = userNodes.length ? userNodes[userNodes.length - 1] : null;
      const assistant = assistantNodes.length ? assistantNodes[assistantNodes.length - 1] : null;
      if (user || assistant) return { user, assistant };
    } catch (e) {
      // ignore and fall back to heuristics
    }

    // Heuristic fallback: last blocks in conversation area.
    // We'll treat "assistant" as the most recent large-ish block that changed after submit.
    const rootEl = root || document.body;
    const blocks = pickLatestTextBlocks(rootEl, 60);
    if (blocks.length === 0) return { user: null, assistant: null };

    let user = null;
    let assistant = null;
    const tail = blocks.slice(-6);
    assistant = tail[tail.length - 1]?.el || null;
    const assistantText = safeText(assistant);
    for (let i = tail.length - 2; i >= 0; i--) {
      const el = tail[i].el;
      const t = safeText(el);
      if (t && t !== assistantText) {
        user = el;
        break;
      }
    }
    return { user, assistant };
  }

  // ---------- activity lifecycle ----------
  function startTurn(promptText, source = "unknown") {
    if (STATE.currentActivity) return; // prevent duplicates

    const ptxt = (promptText || "").trim();
    if (!ptxt) return;

    const activity = {
      id: uuid(),
      provider: PROVIDER,
      modality: "text",
      type: "text_turn",
      ts_start: now(),
      ts_end: null,
      prompt_chars: ptxt.length,
      prompt_words: estimateWords(ptxt),
      response_chars: 0,
      response_words: 0,
      page_url: location.href,
      meta: {
        session_id: STATE.tabSessionId,
        source,
      },
    };

    STATE.currentActivity = activity;
    STATE.lastSubmitTs = activity.ts_start;
    STATE.lastUserMsgText = ptxt;

    sendToSW("activity_partial", { activity });
    log("gemini: startTurn", { source, prompt_chars: activity.prompt_chars });
  }

  function finalizeTurn(responseText, assistantEl) {
    if (!STATE.currentActivity) return;

    const rtxt = (responseText || "").trim();
    const act = STATE.currentActivity;

    act.ts_end = now();
    act.response_chars = rtxt.length;
    act.response_words = estimateWords(rtxt);

    // attach some meta
    act.meta = act.meta || {};
    act.meta.assistant_node_key = makeNodeKey(assistantEl);

    STATE.currentActivity = null;

    sendToSW("activity_final", { activity: act });
    log("gemini: finalizeTurn", { response_chars: act.response_chars });

    // After finalizing text, do a best-effort media scan on the same assistant node
    if (assistantEl) {
      detectMediaInAssistant(assistantEl);
    }
  }

  function makeNodeKey(el) {
    if (!el) return "";
    try {
      // stable-ish signature
      const r = el.getBoundingClientRect();
      const t = safeText(el).slice(0, 80);
      return `${Math.round(r.top)}:${Math.round(r.left)}:${Math.round(r.width)}:${Math.round(
        r.height
      )}:${t}`;
    } catch {
      return "";
    }
  }

  // ---------- media detection ----------
  function detectMediaInAssistant(assistantEl) {
    // Only consider media that appears inside the assistant message element (not whole page).
    if (!assistantEl) return;

    // Images
    const imgs = extractGeneratedImages(assistantEl);
    if (imgs && imgs.length) {
      const key = imgs
        .map((i) => i.currentSrc || i.src || "")
        .filter(Boolean)
        .join("|")
        .slice(0, 5000);

      if (key && !STATE.seenImageKeys.has(key)) {
        STATE.seenImageKeys.add(key);

        const activity = {
          id: uuid(),
          provider: PROVIDER,
          modality: "image",
          type: "image_gen",
          ts_start: now(),
          ts_end: now(),
          prompt_chars: 0,
          response_chars: 0,
          meta: {
            session_id: STATE.tabSessionId,
            count: imgs.length,
            resolution: "unknown",
            source: "assistant_scan",
          },
        };

        sendToSW("activity_final", { activity });
        log("gemini: image_gen detected", { count: imgs.length });
      }
    }

    // Videos
    const vids = extractGeneratedVideos(assistantEl);
    if (vids && vids.length) {
      const key = vids
        .map((v) => v.currentSrc || v.src || "")
        .filter(Boolean)
        .join("|")
        .slice(0, 5000);

      if (key && !STATE.seenVideoKeys.has(key)) {
        STATE.seenVideoKeys.add(key);

        // best-effort duration
        let durationSec = "unknown";
        try {
          const d = vids[0].duration;
          if (typeof d === "number" && isFinite(d) && d > 0) durationSec = Math.round(d);
        } catch { }

        const activity = {
          id: uuid(),
          provider: PROVIDER,
          modality: "video",
          type: "video_gen",
          ts_start: now(),
          ts_end: now(),
          prompt_chars: 0,
          response_chars: 0,
          meta: {
            session_id: STATE.tabSessionId,
            count: vids.length,
            duration_sec: durationSec,
            resolution: "unknown",
            source: "assistant_scan",
          },
        };

        sendToSW("activity_final", { activity });
        log("gemini: video_gen detected", { count: vids.length, durationSec });
      }
    }
  }

  // ---------- submit hooks ----------
  function bindComposerHooksRetry() {
    if (STATE.hooksBound) return;

    const composer = findMainComposer();
    const sendBtn = findSendButtonNearComposer(composer);

    let boundAny = false;

    if (composer && isProbablyComposer(composer) && !composer.__aiimBound) {
      composer.__aiimBound = true;

      composer.addEventListener(
        "keydown",
        (e) => {
          // Enter to submit (but not Shift+Enter)
          if (e.key === "Enter" && !e.shiftKey) {
            setTimeout(() => {
              const text = getComposerText();
              if (text) startTurn(text, "composer_keydown");
            }, 0);
          }
        },
        true
      );

      boundAny = true;
      log("gemini: composer hook bound");
    }

    if (sendBtn && !sendBtn.__aiimBound) {
      sendBtn.__aiimBound = true;
      sendBtn.addEventListener(
        "click",
        () => {
          setTimeout(() => {
            const text = getComposerText();
            if (text) startTurn(text, "send_click");
          }, 0);
        },
        true
      );
      boundAny = true;
      log("gemini: send button hook bound");
    }

    if (boundAny) {
      // We still want watchers; mark hooksBound so we don't keep attaching
      STATE.hooksBound = true;
      return;
    }

    // Retry until UI appears
    setTimeout(bindComposerHooksRetry, 800);
  }

  // ---------- mutation-based fallback ----------
  function startWatchers() {
    if (STATE.watchersStarted) return;

    // Prefer the chat history container to avoid sidebar thumbnails.
    const root =
      document.querySelector("#chat-history") ||
      document.querySelector("[data-test-id='chat-history-container']") ||
      document.querySelector(".conversation-container") ||
      document.querySelector("response-container") ||
      document.querySelector("main") ||
      findMessageRoot();
    if (!root) {
      setTimeout(startWatchers, 800);
      return;
    }
    STATE.watchersStarted = true;
    log("gemini: watcher root", root);

    // Observe conversation area for changes to detect assistant streaming completion
    const mo = new MutationObserver(() => {
      try {
        const { user, assistant } = detectLatestUserAndAssistant(root);
        if (!assistant) return;

        const assistantKey = makeNodeKey(assistant);
        const assistantText = safeText(assistant);

        // If we have an in-flight activity, track assistant node and finalize when stable
        if (STATE.currentActivity) {
          // Update last assistant pointer
          STATE.lastAssistantNode = assistant;
          STATE.lastAssistantNodeKey = assistantKey;

          // Streaming can change text; when it stabilizes, finalize
          stableObserver(assistant, 2200, () => {
            // ensure we're finalizing the same node we observed last
            if (!STATE.currentActivity) return;

            const curKey = makeNodeKey(STATE.lastAssistantNode);
            if (STATE.lastAssistantNodeKey && curKey !== STATE.lastAssistantNodeKey) {
              // assistant node changed; wait for next cycle
              return;
            }

            // Grab the visible text and check for media. Some Gemini responses
            // may consist solely of images or videos without text. In such
            // cases, we still want to finalize the text turn (with empty text)
            // so that the subsequent media detection runs.
            const finalText = safeText(STATE.lastAssistantNode);
            let hasMedia = false;
            try {
              const imgs = extractGeneratedImages(STATE.lastAssistantNode);
              const vids = extractGeneratedVideos(STATE.lastAssistantNode);
              hasMedia = (imgs && imgs.length > 0) || (vids && vids.length > 0);
            } catch {
              // ignore
            }

            // Avoid finalizing if no text and no media detected
            if (!finalText && !hasMedia) return;

            // avoid finalizing if response equals last assistant text and looks unchanged
            if (finalText && finalText === STATE.lastAssistantMsgText) return;

            STATE.lastAssistantMsgText = finalText || "";
            finalizeTurn(finalText || "", STATE.lastAssistantNode);
          });
          return;
        }

        // If we do NOT have an in-flight activity, we can still
        // detect user submit by seeing a new user-like block after typing.
        // But be conservative: only auto-start if we see a new user block that differs from lastUserMsgText.
        if (!STATE.currentActivity && user) {
          const userText = safeText(user);
          const userKey = makeNodeKey(user);
          if (
            userText &&
            userText.length >= 2 &&
            userText !== STATE.lastUserMsgText &&
            userKey !== STATE.lastUserNodeKey
          ) {
            STATE.lastUserMsgText = userText;
            STATE.lastUserNodeKey = userKey;
            STATE.lastSubmitTs = now();
            startTurn(userText, "mutation_user_block");
          }
        }
        // Fallback: if assistant appears without a tracked activity, infer a session
        if (!STATE.currentActivity && assistant) {
          const inferred = STATE.lastUserMsgText || "";
          if (inferred && inferred.length >= 2) {
            startTurn(inferred, "assistant_seen");
          }
        }
      } catch (e) {
        // never break observers
      }
    });

    mo.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["src", "style", "class"] });

    // Also run once shortly after start
    setTimeout(() => {
      try {
        const { assistant } = detectLatestUserAndAssistant(root);
        if (assistant) STATE.lastAssistantMsgText = safeText(assistant);
      } catch { }
    }, 1200);

    // Separate watcher for media additions. Scan each added node for images or videos and
    // send image_gen/video_gen activities immediately. This avoids relying on the
    // assistant container, which may not contain the media elements (e.g. Gemini
    // sometimes places generated images outside of the main response wrapper).
    const mediaMo = new MutationObserver((muts) => {
      try {
        for (const m of muts) {
          const nodes = Array.from(m.addedNodes || []);
          if (m.type === "attributes" && m.target && m.target instanceof HTMLElement) {
            nodes.push(m.target);
          }
          for (const n of nodes) {
            if (!(n instanceof HTMLElement)) continue;
            if (!root.contains(n)) continue;
            const inResponse =
              n.closest("model-response, message-content, structured-content-container, response-container") ||
              n.querySelector?.("model-response, message-content, structured-content-container, response-container");
            if (!inResponse) continue;
            // Find images within this node
            let imgs = [];
            try {
              imgs = extractGeneratedImages(n);
            } catch {
              imgs = [];
            }
            if (imgs && imgs.length) {
              // Build a key from image sources to avoid duplicates
              const key = imgs
                .map((img) => img.currentSrc || img.src || "")
                .filter(Boolean)
                .join("|")
                .slice(0, 5000);
              if (key && !STATE.seenImageKeys.has(key)) {
                STATE.seenImageKeys.add(key);
                // Compute resolutions (if known)
                const resolutions = imgs.map((img) => {
                  const w = img.naturalWidth || img.width || null;
                  const h = img.naturalHeight || img.height || null;
                  return w && h ? `${w}x${h}` : "unknown";
                });
                const activity = {
                  id: uuid(),
                  provider: PROVIDER,
                  modality: "image",
                  type: "image_gen",
                  ts_start: now(),
                  ts_end: now(),
                  prompt_chars: 0,
                  response_chars: 0,
                  page_url: location.href,
                  meta: {
                    count: imgs.length,
                    resolution: resolutions.join(", ") || "unknown",
                    source: "mutation_scan",
                  },
                };
                sendToSW("activity_final", { activity });
                log("gemini: image_gen (mutation)", { count: imgs.length });
              }
            }

            // Find videos within this node
            const vids = Array.from(n.querySelectorAll("video"));
            if (vids && vids.length) {
              const key = vids
                .map((v) => v.currentSrc || v.src || "")
                .filter(Boolean)
                .join("|")
                .slice(0, 5000);
              if (key && !STATE.seenVideoKeys.has(key)) {
                STATE.seenVideoKeys.add(key);
                // Duration and resolution
                let durationSec = 0;
                const durations = [];
                const resolutions = [];
                for (const v of vids) {
                  try {
                    const d = v.duration;
                    if (typeof d === "number" && isFinite(d)) {
                      durations.push(d);
                      durationSec += d;
                    } else {
                      durations.push("unknown");
                    }
                    const w = v.videoWidth || null;
                    const h = v.videoHeight || null;
                    resolutions.push(w && h ? `${w}x${h}` : "unknown");
                  } catch {
                    durations.push("unknown");
                    resolutions.push("unknown");
                  }
                }
                const activity = {
                  id: uuid(),
                  provider: PROVIDER,
                  modality: "video",
                  type: "video_gen",
                  ts_start: now(),
                  ts_end: now(),
                  prompt_chars: 0,
                  response_chars: 0,
                  page_url: location.href,
                  meta: {
                    count: vids.length,
                    duration_sec: typeof durationSec === "number" && durationSec > 0 ? Math.round(durationSec) : 0,
                    duration_meta: durations,
                    resolution: resolutions.join(", ") || "unknown",
                    source: "mutation_scan",
                  },
                };
                sendToSW("activity_final", { activity });
                log("gemini: video_gen (mutation)", { count: vids.length, durationSec });
              }
            }
          }
        }
      } catch {
        // never break observers
      }
    });

    mediaMo.observe(document.body, { subtree: true, childList: true });

    log("gemini: watchers started");
  }

  // ---------- init ----------
  function init() {
    if (!location.host.includes("gemini.google.com")) return;

    log("gemini adapter loaded", location.href);

    // bind submit hooks even if composer appears late
    bindComposerHooksRetry();

    // start watchers for streaming & fallback
    startWatchers();
  }

  // Run after load
  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(init, 50);
  } else {
    window.addEventListener("DOMContentLoaded", () => setTimeout(init, 50), { once: true });
  }
})();
