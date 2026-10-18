(() => {
  if (window.AIImpactCommon) return;

  const PREFIX = "[AI Impact Meter]";
  let DEBUG = false;
  try {
    DEBUG = localStorage.getItem("aiim_debug") === "1";
  } catch (_e) {}

  function log(...args) {
    try {
      console.log(PREFIX, ...args);
    } catch (_e) {}
  }

  function debug(...args) {
    if (DEBUG) log(...args);
  }

  function uuid() {
    try {
      if (crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
    } catch (_e) {}
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function contextAlive() {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch (_e) {
      return false;
    }
  }

  function countWords(text) {
    if (!text) return 0;
    const m = text.trim().match(/\S+/g);
    return m ? m.length : 0;
  }

  function normalizeText(t) {
    return (t || "").replace(/[​-‍﻿]/g, "").replace(/\s+/g, " ").trim();
  }

  // Testo leggibile di un nodo, ignorando pulsanti, icone e testo solo per screen reader.
  const SKIP_SELECTOR = "button, script, style, noscript, svg, template, .sr-only, .visually-hidden, .cdk-visually-hidden, [data-aiim-skip], #ai-impact-meter-hud";
  function getVisibleText(el) {
    if (!el) return "";
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const p = node.parentElement;
        if (p && p.closest(SKIP_SELECTOR)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const parts = [];
    let node;
    while ((node = walker.nextNode())) {
      const t = node.textContent;
      if (t && t.trim()) parts.push(t);
    }
    return normalizeText(parts.join(" "));
  }

  function isShown(el) {
    if (!el || !(el instanceof Element)) return false;
    if (!el.isConnected) return false;
    if (el.getClientRects().length === 0) return false;
    const st = getComputedStyle(el);
    return st.visibility !== "hidden" && st.display !== "none";
  }

  function queryAllFirst(selectors, root = document) {
    for (const sel of selectors || []) {
      try {
        const nodes = root.querySelectorAll(sel);
        if (nodes.length) return Array.from(nodes);
      } catch (_e) {}
    }
    return [];
  }

  function matchesAny(el, selectors) {
    if (!el || !selectors) return false;
    for (const sel of selectors) {
      try {
        if (el.matches(sel)) return true;
      } catch (_e) {}
    }
    return false;
  }

  function closestAny(el, selectors) {
    if (!el || !selectors) return null;
    for (const sel of selectors) {
      try {
        const c = el.closest(sel);
        if (c) return c;
      } catch (_e) {}
    }
    return null;
  }

  function readEditable(el) {
    if (!el) return "";
    const tag = (el.tagName || "").toUpperCase();
    if (tag === "TEXTAREA" || tag === "INPUT") return normalizeText(el.value || "");
    return normalizeText(el.innerText || el.textContent || "");
  }

  function sendMessage(msg) {
    return new Promise((resolve) => {
      if (!contextAlive()) return resolve(null);
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          const err = chrome.runtime.lastError;
          if (err) debug("sendMessage error", err.message);
          resolve(res || null);
        });
      } catch (e) {
        debug("sendMessage exception", e);
        resolve(null);
      }
    });
  }

  function detectProvider() {
    const host = location.host;
    if (host === "chat.openai.com" || host === "chatgpt.com" || host.endsWith(".chatgpt.com")) return "chatgpt";
    if (host === "gemini.google.com") return "gemini";
    if (host === "claude.ai" || host.endsWith(".claude.ai")) return "claude";
    return "unknown";
  }

  function getDomain() {
    return location.host;
  }

  // ---------- event bus interno (provider -> HUD) ----------
  const listeners = {};
  const bus = {
    on(evt, fn) {
      (listeners[evt] = listeners[evt] || []).push(fn);
    },
    emit(evt, data) {
      for (const fn of listeners[evt] || []) {
        try {
          fn(data);
        } catch (e) {
          debug("bus listener error", e);
        }
      }
    }
  };

  // ---------- motore di tracciamento ----------
  const STOP_RE = /\b(stop|interrompi|ferma|detener|arr[eê]ter|stopp\w*|anhalten|parar|остановить)\b/i;
  const SEND_RE = /\b(send|invia|enviar|envoyer|senden|absenden|submit|inviare)\b/i;
  const REGEN_RE = /\b(regenerate|rigenera|retry|riprova|try again|reintentar|regenerar|réessayer|régénérer|erneut|neu generieren)\b/i;

  function labelOf(el) {
    if (!el) return "";
    return [
      el.getAttribute("aria-label"),
      el.getAttribute("title"),
      el.getAttribute("mattooltip"),
      el.getAttribute("data-tooltip"),
      el.getAttribute("data-testid")
    ]
      .filter(Boolean)
      .join(" ");
  }

  /**
   * cfg:
   *  provider, idleMs,
   *  composerSelectors, sendButtonSelectors, stopSelectors, regenerateSelectors,
   *  userSelectors, assistantSelectors | getAssistantNodes(), modelSelectors,
   *  scanMedia(node) -> [{ key, kind: "image"|"video", el }]
   */
  function createTracker(cfg) {
    const idleMs = cfg.idleMs || 1500;
    const S = {
      url: location.href,
      pending: null,
      turn: null,
      lastFinalizeTs: 0,
      lastFinal: null,
      stuckStreaming: false,
      firstTick: true,
      recentNodes: [],
      seenMedia: new Set(),
      pendingVideos: new Map(),
      timer: null,
      stopped: false
    };

    const getAssistantNodes = () => {
      try {
        return cfg.getAssistantNodes ? cfg.getAssistantNodes() : queryAllFirst(cfg.assistantSelectors);
      } catch (_e) {
        return [];
      }
    };
    const lastAssistant = () => {
      const nodes = getAssistantNodes();
      return nodes.length ? nodes[nodes.length - 1] : null;
    };
    const textOf = (node) => (node ? (cfg.textOf ? normalizeText(cfg.textOf(node)) : getVisibleText(node)) : "");

    function findComposer() {
      const candidates = queryAllFirst(cfg.composerSelectors);
      const active = document.activeElement;
      return (
        candidates.find((c) => active && (c === active || c.contains(active))) ||
        candidates.find((c) => isShown(c)) ||
        candidates[0] ||
        null
      );
    }

    function composerRegion(composer) {
      if (!composer) return null;
      const form = composer.closest("form, fieldset");
      if (form) return form;
      let el = composer;
      for (let i = 0; i < 6 && el.parentElement; i++) el = el.parentElement;
      return el;
    }

    function isStreaming() {
      for (const sel of cfg.stopSelectors || []) {
        try {
          const el = document.querySelector(sel);
          if (el && (el.matches("[data-is-streaming], [aria-busy]") || isShown(el))) return true;
        } catch (_e) {}
      }
      // Pulsante "Stop" generico vicino al composer (copre localizzazioni diverse).
      const region = composerRegion(findComposer());
      if (region) {
        for (const b of region.querySelectorAll("button")) {
          if (STOP_RE.test(labelOf(b)) && isShown(b)) return true;
        }
      }
      return false;
    }

    function detectModel() {
      for (const sel of cfg.modelSelectors || []) {
        try {
          const el = document.querySelector(sel);
          const t = el ? normalizeText(el.innerText || el.textContent || "") : "";
          if (t) return t.slice(0, 60);
        } catch (_e) {}
      }
      return null;
    }

    function latestUserText() {
      const nodes = queryAllFirst(cfg.userSelectors);
      return nodes.length ? textOf(nodes[nodes.length - 1]) : "";
    }

    function snapshotBaseline() {
      const node = lastAssistant();
      return { node, text: textOf(node) };
    }

    // ----- cattura invio -----
    function capturePending(source, editable, overrideText, extraMeta) {
      if (S.turn) {
        // Durante lo streaming l'invio non genera un nuovo turno, a meno che il segnale sia bloccato.
        const T = S.turn;
        const inferredEmpty = T.inferred && !T.node;
        if (!inferredEmpty && isStreaming() && !S.stuckStreaming && Date.now() - T.lastTextChange < 10000) return;
        if (!inferredEmpty && (T.node || T.prompt)) finalizeTurn("next_submit");
        else discardTurn("next_submit");
      }
      const text = overrideText != null ? normalizeText(overrideText) : readEditable(editable || findComposer());
      if (!text) return;
      const base = snapshotBaseline();
      S.pending = {
        text,
        ts: Date.now(),
        source,
        el: editable || findComposer(),
        confirmed: overrideText != null,
        baselineNode: base.node,
        baselineText: base.text,
        meta: extraMeta || {}
      };
      debug(cfg.provider, "pending", source, text.length);
    }

    function onKeyDown(e) {
      if (e.key !== "Enter" || e.shiftKey || e.isComposing || e.altKey || e.keyCode === 229) return;
      const target = e.target instanceof Element ? e.target : null;
      if (!target) return;
      const editable = target.closest("textarea, [contenteditable='true'], [contenteditable='plaintext-only']");
      if (!editable) return;
      const isComposer = matchesAny(editable, cfg.composerSelectors) || !!closestAny(editable, cfg.composerSelectors);
      const isEdit = !!closestAny(editable, cfg.userSelectors);
      if (!isComposer && !isEdit) return;
      capturePending(isEdit ? "edit_enter" : "enter", editable, null, isEdit ? { edit: true } : null);
    }

    function onClick(e) {
      const target = e.target instanceof Element ? e.target : null;
      if (!target) return;
      const btn = target.closest("button, [role='button'], [role='menuitem']");
      if (!btn || btn.disabled || btn.getAttribute("aria-disabled") === "true") return;
      const label = labelOf(btn);
      const composer = findComposer();
      const region = composerRegion(composer);

      if (matchesAny(btn, cfg.sendButtonSelectors) || (region && region.contains(btn) && SEND_RE.test(label))) {
        if (STOP_RE.test(label)) return;
        capturePending("click", composer);
        return;
      }
      // Pulsante "Invia/Salva" dentro un messaggio utente in modifica.
      const editHost = closestAny(btn, cfg.userSelectors);
      if (editHost && SEND_RE.test(`${label} ${btn.textContent || ""}`)) {
        const ed = editHost.querySelector("textarea, [contenteditable='true']");
        if (ed) capturePending("edit_click", ed, null, { edit: true });
        return;
      }
      const shortText = (btn.textContent || "").trim().slice(0, 40);
      if (matchesAny(btn, cfg.regenerateSelectors) || REGEN_RE.test(label) || (shortText.length < 30 && REGEN_RE.test(shortText))) {
        const prompt = latestUserText();
        if (prompt) capturePending("regenerate", null, prompt, { regenerate: true });
      }
    }

    // ----- ciclo turno -----
    function startTurn(prompt, source, baseline, meta) {
      const now = Date.now();
      S.turn = {
        id: uuid(),
        prompt,
        source,
        start: now,
        lastActivity: now,
        lastTextChange: now,
        baselineNode: baseline.node,
        baselineText: baseline.text,
        inferred: source === "streaming_detected" || source === "continuation",
        node: null,
        lastText: "",
        offsetChars: 0,
        offsetWords: 0,
        sawStreaming: false,
        model: detectModel(),
        meta: meta || {}
      };
      // La generazione riprende sullo stesso messaggio appena registrato: conta solo il delta.
      const LF = S.lastFinal;
      if (S.turn.inferred && LF && LF.node && LF.node === baseline.node && now - LF.ts < 60000) {
        S.turn.prompt = "";
        S.turn.node = LF.node;
        S.turn.lastText = baseline.text;
        S.turn.offsetChars = LF.text.length;
        S.turn.offsetWords = countWords(LF.text);
        S.turn.continuationPrefix = LF.text.slice(0, 40);
        S.turn.meta = { ...S.turn.meta, continuation: true };
      }
      S.pending = null;
      debug(cfg.provider, "turn start", source, prompt.length);
      bus.emit("turn_start", { provider: cfg.provider, source });
    }

    function finalizeTurn(reason) {
      const T = S.turn;
      if (!T) return;
      S.turn = null;
      S.lastFinalizeTs = Date.now();
      if (T.node) rememberNode(T.node);
      const response = T.lastText || "";
      if (T.meta.continuation && T.offsetChars && !response.startsWith(T.continuationPrefix || "")) {
        // Il testo è stato sostituito (rigenerazione sul posto), non esteso.
        T.offsetChars = 0;
        T.offsetWords = 0;
        T.prompt = latestUserText();
        T.meta = { ...T.meta, continuation: false, regenerate: true };
      }
      S.lastFinal = T.node ? { node: T.node, text: response, ts: Date.now() } : null;
      const responseChars = Math.max(0, response.length - T.offsetChars);
      if (!T.prompt && !responseChars) {
        bus.emit("turn_end", { provider: cfg.provider, discarded: true });
        return;
      }
      const activity = {
        id: T.id,
        provider: cfg.provider,
        page_url: location.href,
        domain: location.host,
        modality: "text",
        type: "text_turn",
        ts_start: T.start,
        ts_end: Date.now(),
        prompt_chars: T.prompt.length,
        prompt_words: countWords(T.prompt),
        response_chars: responseChars,
        response_words: Math.max(0, countWords(response) - T.offsetWords),
        meta: {
          source: T.source,
          finalize_reason: reason,
          saw_streaming: T.sawStreaming,
          inferred: T.inferred,
          duration_ms: Date.now() - T.start,
          model: T.model || detectModel(),
          ...T.meta
        }
      };
      sendMessage({ type: "activity_final", activity });
      log(`${cfg.provider}: turno registrato (${activity.prompt_chars}+${activity.response_chars} caratteri, ${reason})`);
      bus.emit("turn_end", { provider: cfg.provider, activity });
    }

    function discardTurn(reason) {
      debug(cfg.provider, "turn discarded", reason);
      S.turn = null;
      bus.emit("turn_end", { provider: cfg.provider, discarded: true });
    }

    function rememberNode(node) {
      if (!node) return;
      S.recentNodes = S.recentNodes.filter((n) => n !== node && n.isConnected).concat(node).slice(-12);
    }

    function stepTurn(now, streaming, last) {
      const T = S.turn;
      if (streaming) {
        T.sawStreaming = true;
        T.lastActivity = now;
      }

      // Il nodo seguito è stato rimosso (rerender o cambio chat).
      if (T.node && !T.node.isConnected) {
        const cand = last;
        const prefix = T.lastText.slice(0, 40);
        if (cand && prefix && textOf(cand).startsWith(prefix)) {
          T.node = cand;
        } else if (!streaming && T.lastText) {
          finalizeTurn("node_removed");
          return;
        } else {
          T.node = null;
        }
      }

      if (last) {
        const changed = last !== T.baselineNode || (T.baselineNode && textOf(last) !== T.baselineText);
        if (changed && T.node !== last) {
          T.node = last;
          rememberNode(last);
        }
      }

      if (T.node) {
        const t = textOf(T.node);
        if (t !== T.lastText) {
          T.lastText = t;
          T.lastActivity = now;
          T.lastTextChange = now;
        }
      }

      // Protezione da un indicatore di streaming rimasto bloccato (es. cambio UI del sito).
      if (streaming && now - T.lastTextChange > 120000) {
        S.stuckStreaming = true;
        if (T.node && T.lastText) finalizeTurn("stale_streaming");
        else discardTurn("stale_streaming");
        return;
      }
      if (streaming && T.inferred && !T.node && now - T.start > 30000) {
        S.stuckStreaming = true;
        discardTurn("stale_streaming");
        return;
      }

      const idle = now - T.lastActivity;
      if (T.node && !streaming) {
        if ((T.lastText && idle >= idleMs) || idle >= 60000) finalizeTurn(T.lastText ? "stable" : "empty_timeout");
        return;
      }
      if (!T.node && !streaming && now - T.start > (T.inferred ? 6000 : 90000)) {
        discardTurn("no_response");
        return;
      }
      if (now - T.start > 20 * 60000) finalizeTurn("hard_timeout");
    }

    // ----- media generati (immagini / video) -----
    function scanMedia(now, streaming) {
      if (!cfg.scanMedia) return;
      const nodes = new Set(S.recentNodes.filter((n) => n.isConnected));
      if (S.turn && S.turn.node) nodes.add(S.turn.node);
      if (S.turn || now - S.lastFinalizeTs < 180000) {
        const last = lastAssistant();
        if (last && (!S.turn || last !== S.turn.baselineNode || S.turn.node === last)) nodes.add(last);
      }
      if (!nodes.size) return;

      const newImages = [];
      for (const node of nodes) {
        let items = [];
        try {
          items = cfg.scanMedia(node) || [];
        } catch (_e) {
          items = [];
        }
        for (const it of items) {
          if (!it || !it.key || S.seenMedia.has(it.key)) continue;
          if (it.kind === "image") {
            S.seenMedia.add(it.key);
            newImages.push(it);
          } else if (it.kind === "video") {
            const v = it.el;
            const first = S.pendingVideos.get(it.key) || now;
            S.pendingVideos.set(it.key, first);
            const dur = v && Number.isFinite(v.duration) && v.duration > 0 ? v.duration : null;
            if (dur || now - first > 15000) {
              S.seenMedia.add(it.key);
              S.pendingVideos.delete(it.key);
              emitMedia("video_gen", [it], { duration_sec: dur ? Math.round(dur * 10) / 10 : null });
            }
          }
        }
      }
      if (newImages.length) emitMedia("image_gen", newImages, {});
    }

    function resolutionOf(el) {
      if (!el) return "unknown";
      const w = el.naturalWidth || el.videoWidth || el.width || 0;
      const h = el.naturalHeight || el.videoHeight || el.height || 0;
      return w && h ? `${w}x${h}` : "unknown";
    }

    function emitMedia(type, items, extra) {
      const now = Date.now();
      const activity = {
        id: uuid(),
        provider: cfg.provider,
        modality: type === "image_gen" ? "image" : "video",
        type,
        ts_start: now,
        ts_end: now,
        prompt_chars: 0,
        response_chars: 0,
        page_url: location.href,
        domain: location.host,
        meta: {
          count: items.length,
          resolution: items.map((i) => resolutionOf(i.el)).join(", "),
          model: detectModel(),
          source: "media_scan",
          ...extra
        }
      };
      sendMessage({ type: "activity_final", activity });
      log(`${cfg.provider}: ${type} registrato (${items.length})`);
      bus.emit("media", { provider: cfg.provider, activity });
    }

    // ----- loop principale -----
    function onUrlChange(prev, next) {
      debug(cfg.provider, "url change", prev, "->", next);
      if (!S.turn) {
        S.recentNodes = [];
        S.lastFinalizeTs = 0;
        S.lastFinal = null;
        S.pendingVideos.clear();
      }
    }

    function tick() {
      if (S.stopped) return;
      if (!contextAlive()) {
        stop();
        return;
      }
      const now = Date.now();
      if (location.href !== S.url) {
        const prev = S.url;
        S.url = location.href;
        onUrlChange(prev, S.url);
      }

      const rawStreaming = isStreaming();
      if (!rawStreaming) S.stuckStreaming = false;
      else if (S.firstTick) S.stuckStreaming = true; // indicatore già attivo al caricamento: non affidabile
      S.firstTick = false;
      const streaming = rawStreaming && !S.stuckStreaming;
      const last = lastAssistant();

      if (S.pending && !S.pending.confirmed) {
        const P = S.pending;
        const cur = P.el && P.el.isConnected ? readEditable(P.el) : "";
        if (cur !== P.text || streaming || (last && last !== P.baselineNode)) P.confirmed = true;
        else if (now - P.ts > 5000) S.pending = null;
      }
      if (S.pending && S.pending.confirmed && !S.turn) {
        const P = S.pending;
        startTurn(P.text, P.source, { node: P.baselineNode, text: P.baselineText }, P.meta);
      } else if (!S.turn && streaming) {
        // Generazione partita senza un invio intercettato (modifica, rigenera, scorciatoie...).
        startTurn(latestUserText(), "streaming_detected", { node: last, text: textOf(last) }, { inferred: true });
      } else if (!S.turn && !S.pending && S.lastFinal && last && last === S.lastFinal.node && now - S.lastFinal.ts < 60000) {
        // Il messaggio appena registrato continua a crescere (pausa di ragionamento, tool use...).
        const t = textOf(last);
        if (t.length > S.lastFinal.text.length + 20) {
          startTurn("", "continuation", { node: last, text: S.lastFinal.text }, {});
        }
      }
      if (S.pending && now - S.pending.ts > 30000) S.pending = null;

      if (S.turn) stepTurn(now, streaming, last);
      scanMedia(now, streaming);
    }

    function stop() {
      S.stopped = true;
      if (S.timer) clearInterval(S.timer);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("click", onClick, true);
    }

    function start() {
      window.addEventListener("keydown", onKeyDown, true);
      window.addEventListener("click", onClick, true);
      S.timer = setInterval(() => {
        try {
          tick();
        } catch (e) {
          debug("tick error", e);
        }
      }, cfg.tickMs || 400);
      log(`${cfg.provider}: tracker attivo`);
    }

    start();
    return { state: S, tick, stop, isStreaming, findComposer, getAssistantNodes };
  }

  window.AIImpactCommon = {
    log,
    debug,
    uuid,
    countWords,
    normalizeText,
    getVisibleText,
    isShown,
    queryAllFirst,
    readEditable,
    sendMessage,
    detectProvider,
    getDomain,
    contextAlive,
    createTracker,
    bus
  };
})();
