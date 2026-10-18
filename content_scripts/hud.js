(() => {
  const C = window.AIImpactCommon;
  if (!C || window.__aiimHud) return;
  window.__aiimHud = true;

  const HOST_ID = "ai-impact-meter-hud";
  const STATE = {
    enabled: true,
    closedForTab: false,
    expanded: false,
    generating: false,
    domain: C.getDomain(),
    tabId: null,
    stats: null,
    settings: null,
    model: null,
    host: null,
    root: null,
    pos: null,
    eqIndex: 0
  };

  const RING_C = 2 * Math.PI * 22;

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .wrap {
      font: 500 12px/1.35 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      color: #f4f7f5;
      -webkit-font-smoothing: antialiased;
      user-select: none;
    }
    .pill {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 7px 12px 7px 8px;
      border-radius: 999px;
      background: linear-gradient(135deg, rgba(16,24,22,.92), rgba(20,32,28,.88));
      border: 1px solid rgba(255,255,255,.1);
      box-shadow: 0 10px 30px rgba(0,0,0,.28), inset 0 1px 0 rgba(255,255,255,.06);
      backdrop-filter: blur(14px) saturate(140%);
      -webkit-backdrop-filter: blur(14px) saturate(140%);
      cursor: pointer;
      transition: transform .2s ease, box-shadow .2s ease;
    }
    .pill:hover { transform: translateY(-1px); box-shadow: 0 14px 34px rgba(0,0,0,.34); }
    .dot {
      position: relative; width: 22px; height: 22px; border-radius: 50%;
      display: grid; place-items: center;
      background: radial-gradient(circle at 30% 30%, #4ade80, #15803d);
      box-shadow: 0 0 0 3px rgba(74,222,128,.15);
      flex: none;
    }
    .dot svg { width: 13px; height: 13px; }
    .dot::after {
      content: ""; position: absolute; inset: -4px; border-radius: 50%;
      border: 2px solid var(--accent, #4ade80); opacity: 0;
    }
    .gen .dot::after { animation: ping 1.3s cubic-bezier(0,0,.2,1) infinite; }
    @keyframes ping { 0% { transform: scale(.8); opacity: .9; } 100% { transform: scale(1.6); opacity: 0; } }
    .pv { font-weight: 700; font-size: 13px; letter-spacing: -.01em; font-variant-numeric: tabular-nums; }
    .pu { opacity: .65; font-size: 11px; }
    .sep { width: 1px; height: 14px; background: rgba(255,255,255,.14); }
    .score { font-weight: 700; font-variant-numeric: tabular-nums; color: var(--accent, #4ade80); }

    .panel {
      width: 288px;
      border-radius: 18px;
      background: linear-gradient(160deg, rgba(14,22,20,.95), rgba(18,30,26,.92));
      border: 1px solid rgba(255,255,255,.09);
      box-shadow: 0 24px 60px rgba(0,0,0,.4), inset 0 1px 0 rgba(255,255,255,.06);
      backdrop-filter: blur(18px) saturate(150%);
      -webkit-backdrop-filter: blur(18px) saturate(150%);
      overflow: hidden;
      animation: pop .22s cubic-bezier(.2,.9,.3,1.2);
    }
    @keyframes pop { from { transform: translateY(6px) scale(.97); opacity: 0; } to { transform: none; opacity: 1; } }
    .head { display: flex; align-items: center; gap: 8px; padding: 10px 10px 8px 12px; cursor: grab; }
    .head:active { cursor: grabbing; }
    .title { flex: 1; font-weight: 700; font-size: 12px; letter-spacing: .01em; }
    .title small { display: block; font-weight: 500; opacity: .55; font-size: 10.5px; margin-top: 1px; }
    .ib {
      all: unset; width: 26px; height: 26px; border-radius: 8px; display: grid; place-items: center;
      color: rgba(255,255,255,.75); cursor: pointer; transition: background .15s;
    }
    .ib:hover { background: rgba(255,255,255,.1); color: #fff; }
    .ib:focus-visible { outline: 2px solid #4ade80; }
    .ib svg { width: 15px; height: 15px; }
    .hero { display: flex; align-items: center; gap: 12px; padding: 4px 14px 12px; }
    .ring { position: relative; width: 56px; height: 56px; flex: none; }
    .ring svg { width: 56px; height: 56px; transform: rotate(-90deg); }
    .ring .track { stroke: rgba(255,255,255,.08); }
    .ring .bar { stroke: var(--accent, #4ade80); stroke-linecap: round; transition: stroke-dashoffset .7s cubic-bezier(.2,.8,.2,1), stroke .4s; }
    .ring .num { position: absolute; inset: 0; display: grid; place-items: center; font-weight: 800; font-size: 15px; font-variant-numeric: tabular-nums; }
    .ring .num small { display:block; font-size: 8px; font-weight: 600; opacity: .55; text-align:center; margin-top:-2px; letter-spacing:.06em; }
    .big { font-size: 24px; font-weight: 800; letter-spacing: -.03em; font-variant-numeric: tabular-nums; line-height: 1.1; }
    .big span { font-size: 12px; font-weight: 600; opacity: .6; letter-spacing: 0; margin-left: 3px; }
    .range { font-size: 10.5px; opacity: .55; margin-top: 2px; font-variant-numeric: tabular-nums; }
    .badge { display: inline-flex; align-items: center; gap: 5px; margin-top: 5px; padding: 2px 8px; border-radius: 999px; font-size: 10.5px; font-weight: 700; background: color-mix(in srgb, var(--accent, #4ade80) 18%, transparent); color: var(--accent, #4ade80); }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; padding: 0 12px; }
    .tile { padding: 8px 10px; border-radius: 12px; background: rgba(255,255,255,.045); border: 1px solid rgba(255,255,255,.05); }
    .tl { font-size: 10px; opacity: .55; text-transform: uppercase; letter-spacing: .06em; font-weight: 700; }
    .tv { font-size: 14px; font-weight: 700; margin-top: 2px; font-variant-numeric: tabular-nums; }
    .tv span { font-size: 10.5px; opacity: .6; font-weight: 600; margin-left: 2px; }
    .eq { margin: 8px 12px 0; padding: 8px 10px; border-radius: 12px; background: rgba(74,222,128,.07); font-size: 11.5px; display: flex; gap: 8px; align-items: center; cursor: pointer; min-height: 34px; }
    .eq b { font-variant-numeric: tabular-nums; }
    .foot { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px 12px; font-size: 10.5px; opacity: .6; }
    .live { display: inline-flex; align-items: center; gap: 6px; }
    .live i { width: 6px; height: 6px; border-radius: 50%; background: #64748b; }
    .gen .live i { background: #4ade80; animation: blink 1s infinite; }
    @keyframes blink { 50% { opacity: .25; } }
    .toast {
      position: absolute; right: 8px; top: calc(100% + 6px);
      padding: 4px 10px; border-radius: 999px; font-weight: 700; font-size: 11.5px;
      background: #16a34a; color: #fff; box-shadow: 0 8px 20px rgba(22,163,74,.35);
      animation: rise 2.4s ease forwards; pointer-events: none; white-space: nowrap;
    }
    @keyframes rise { 0% { opacity: 0; transform: translateY(-6px); } 12% { opacity: 1; transform: none; } 80% { opacity: 1; } 100% { opacity: 0; transform: translateY(10px); } }
    .hidden { display: none !important; }
    @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
  `;

  const ICON = {
    leaf: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>',
    min: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M5 12h14"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>'
  };

  let M = null; // modulo estimator/model.js

  async function loadModel() {
    if (M) return M;
    try {
      M = await import(chrome.runtime.getURL("estimator/model.js"));
    } catch (e) {
      C.log("HUD: impossibile caricare il modello", e);
      M = null;
    }
    return M;
  }

  function el(html) {
    const t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  function build() {
    const host = document.createElement("div");
    host.id = HOST_ID;
    host.setAttribute("data-aiim-skip", "");
    host.style.cssText = "all: initial; position: fixed; z-index: 2147483646; right: 18px; top: 72px;";
    const root = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = CSS;
    root.appendChild(style);

    const wrap = el(`
      <div class="wrap" part="wrap">
        <div class="pill" role="button" tabindex="0" aria-label="AI Impact Meter: apri dettagli">
          <div class="dot">${ICON.leaf}</div>
          <div><span class="pv" data-k="pv">0</span> <span class="pu" data-k="pu">g CO₂e</span></div>
          <div class="sep"></div>
          <div class="score" data-k="pscore">100</div>
        </div>
        <div class="panel hidden" role="dialog" aria-label="AI Impact Meter">
          <div class="head" data-drag>
            <div class="dot">${ICON.leaf}</div>
            <div class="title">AI Impact Meter<small data-k="sub">Sessione in questo tab</small></div>
            <button class="ib" data-a="options" title="Impostazioni">${ICON.gear}</button>
            <button class="ib" data-a="min" title="Riduci">${ICON.min}</button>
            <button class="ib" data-a="close" title="Nascondi in questo tab">${ICON.close}</button>
          </div>
          <div class="hero">
            <div class="ring">
              <svg viewBox="0 0 56 56"><circle class="track" cx="28" cy="28" r="22" fill="none" stroke-width="6"/><circle class="bar" data-k="bar" cx="28" cy="28" r="22" fill="none" stroke-width="6" stroke-dasharray="${RING_C}" stroke-dashoffset="0"/></svg>
              <div class="num"><div><span data-k="score">100</span><small>ECO</small></div></div>
            </div>
            <div>
              <div class="big"><b data-k="co2">0</b><span data-k="co2u">g CO₂e</span></div>
              <div class="range" data-k="range">range --</div>
              <div class="badge" data-k="badge">🟢 Light</div>
            </div>
          </div>
          <div class="grid">
            <div class="tile"><div class="tl">Energia</div><div class="tv"><b data-k="energy">0</b><span data-k="energyu">Wh</span></div></div>
            <div class="tile"><div class="tl">Acqua</div><div class="tv"><b data-k="water">0</b><span data-k="wateru">mL</span></div></div>
            <div class="tile"><div class="tl">Turni</div><div class="tv"><b data-k="turns">0</b><span data-k="media"></span></div></div>
            <div class="tile"><div class="tl">Token stimati</div><div class="tv"><b data-k="tokens">0</b></div></div>
          </div>
          <div class="eq" data-k="eq" title="Clicca per un'altra equivalenza">--</div>
          <div class="foot"><span class="live"><i></i><span data-k="live">In attesa</span></span><span data-k="model"></span></div>
        </div>
      </div>
    `);
    root.appendChild(wrap);
    STATE.host = host;
    STATE.root = root;

    const pill = wrap.querySelector(".pill");
    const panel = wrap.querySelector(".panel");

    pill.addEventListener("click", (e) => {
      if (pill.__dragged) return;
      e.stopPropagation();
      setExpanded(true);
    });
    pill.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setExpanded(true);
      }
    });
    panel.querySelector("[data-a='min']").addEventListener("click", () => setExpanded(false));
    panel.querySelector("[data-a='options']").addEventListener("click", () => C.sendMessage({ type: "open_options" }));
    panel.querySelector("[data-a='close']").addEventListener("click", () => {
      STATE.closedForTab = true;
      unmount();
    });
    panel.querySelector("[data-k='eq']").addEventListener("click", () => {
      STATE.eqIndex++;
      render();
    });
    // Non lasciare che i tasti dentro l'HUD arrivino alle scorciatoie del sito.
    wrap.addEventListener("keydown", (e) => e.stopPropagation());

    makeDraggable(host, pill);
    makeDraggable(host, panel.querySelector("[data-drag]"));
    applyPos();
    return host;
  }

  function makeDraggable(host, handle) {
    let start = null;
    handle.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || (e.target instanceof Element && e.target.closest(".ib"))) return;
      const r = host.getBoundingClientRect();
      start = { x: e.clientX, y: e.clientY, right: window.innerWidth - r.right, top: r.top, moved: false };
      handle.__dragged = false;
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener("pointermove", (e) => {
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (!start.moved && Math.hypot(dx, dy) < 4) return;
      start.moved = true;
      handle.__dragged = true;
      STATE.pos = clampPos({ right: start.right - dx, top: start.top + dy });
      applyPos();
    });
    const end = (e) => {
      if (!start) return;
      try {
        handle.releasePointerCapture(e.pointerId);
      } catch (_e) {}
      if (start.moved) savePos();
      start = null;
      setTimeout(() => (handle.__dragged = false), 0);
    };
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }

  // Default in alto a destra: in basso c'è il composer con il pulsante Invia.
  const DEFAULT_POS = { right: 18, top: 72 };

  function clampPos(p) {
    const maxR = Math.max(0, window.innerWidth - 120);
    const maxT = Math.max(0, window.innerHeight - 50);
    const top = Number.isFinite(p.top) ? p.top : DEFAULT_POS.top;
    return { right: Math.min(Math.max(4, p.right), maxR), top: Math.min(Math.max(4, top), maxT) };
  }

  function applyPos() {
    if (!STATE.host) return;
    const p = clampPos(STATE.pos || DEFAULT_POS);
    STATE.host.style.right = `${p.right}px`;
    STATE.host.style.top = `${p.top}px`;
  }

  function savePos() {
    safeStorage((s) =>
      s.get(["hud_pos_by_domain"], (res) => {
        const map = (res && res.hud_pos_by_domain) || {};
        map[STATE.domain] = STATE.pos;
        s.set({ hud_pos_by_domain: map });
      })
    );
  }

  function setExpanded(v) {
    STATE.expanded = v;
    if (!STATE.root) return;
    STATE.root.querySelector(".pill").classList.toggle("hidden", v);
    STATE.root.querySelector(".panel").classList.toggle("hidden", !v);
    render();
  }

  function mount() {
    if (!STATE.enabled || STATE.closedForTab) return;
    if (STATE.host && STATE.host.isConnected) return;
    const host = STATE.host || build();
    (document.body || document.documentElement).appendChild(host);
    render();
  }

  function unmount() {
    if (STATE.host && STATE.host.isConnected) STATE.host.remove();
  }

  function q(k) {
    return STATE.root ? STATE.root.querySelector(`[data-k='${k}']`) : null;
  }

  function setText(k, v) {
    const n = q(k);
    if (n && n.textContent !== String(v)) n.textContent = String(v);
  }

  function render() {
    if (!STATE.root || !M) return;
    const stats = STATE.stats;
    const settings = STATE.settings || {};
    const ux = M.deriveUXFromAggregate(stats ? { ...stats, scope: "session" } : null, settings);
    const score = ux.ecoScore == null ? 100 : ux.ecoScore;
    const accent = M.scoreColor(score);
    const wrap = STATE.root.querySelector(".wrap");
    wrap.style.setProperty("--accent", accent);
    wrap.classList.toggle("gen", STATE.generating);

    const co2 = M.formatCo2(stats ? stats.co2e_g.mid : 0);
    const energy = M.formatEnergy(stats ? stats.kwh.mid : 0);
    const water = M.formatWater(ux.equivalents.water_ml);
    setText("pv", co2.value);
    setText("pu", co2.unit);
    setText("pscore", score);
    setText("co2", co2.value);
    setText("co2u", co2.unit);
    setText("score", score);
    const bar = q("bar");
    if (bar) bar.setAttribute("stroke-dashoffset", String(RING_C * (1 - score / 100)));
    setText(
      "range",
      stats ? `range ${M.formatNumber(stats.co2e_g.min)}–${M.formatNumber(stats.co2e_g.max)} g` : "Nessuna attività ancora"
    );
    setText("badge", `${ux.badge.emoji} ${ux.badge.label}`);
    setText("energy", energy.value);
    setText("energyu", energy.unit);
    setText("water", water.value);
    setText("wateru", water.unit);
    const counts = (stats && stats.counts) || {};
    setText("turns", counts.text_turn || 0);
    const media = [];
    if (stats && stats.images) media.push(`+${stats.images} img`);
    if (counts.video_gen) media.push(`+${counts.video_gen} video`);
    setText("media", media.join(" "));
    setText("tokens", M.formatCompact(stats ? stats.tokens || 0 : 0));

    const e = ux.equivalents;
    const eqs = [
      `📱 <b>${M.formatNumber(e.phone_charges)}</b> ricariche smartphone`,
      `🚗 <b>${M.formatDistance(e.car_meters).value} ${M.formatDistance(e.car_meters).unit}</b> in auto`,
      `📺 <b>${M.formatNumber(e.streaming_minutes)}</b> min di streaming video`,
      `💡 <b>${M.formatNumber(e.led_minutes)}</b> min di lampadina LED`,
      `💧 <b>${water.value} ${water.unit}</b> d'acqua per il raffreddamento`
    ];
    const eqEl = q("eq");
    if (eqEl) eqEl.innerHTML = eqs[STATE.eqIndex % eqs.length];
    setText("live", STATE.generating ? "Generazione in corso…" : stats ? "Aggiornato" : "In attesa del primo prompt");
    setText("model", STATE.model || "");
  }

  function toast(text) {
    if (!STATE.root) return;
    const wrap = STATE.root.querySelector(".wrap");
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = text;
    wrap.style.position = "relative";
    wrap.appendChild(t);
    setTimeout(() => t.remove(), 2500);
  }

  function safeStorage(fn) {
    if (!C.contextAlive()) return;
    try {
      fn(chrome.storage.local);
    } catch (_e) {}
  }

  function loadState() {
    safeStorage((s) =>
      s.get(["session_stats_by_tab", "settings", "hud_by_domain", "hud_pos_by_domain"], (res) => {
        if (!res) return;
        const hudMap = res.hud_by_domain || {};
        STATE.enabled = Object.prototype.hasOwnProperty.call(hudMap, STATE.domain) ? !!hudMap[STATE.domain] : true;
        STATE.pos = (res.hud_pos_by_domain || {})[STATE.domain] || null;
        STATE.settings = res.settings || null;
        STATE.stats = STATE.tabId != null ? (res.session_stats_by_tab || {})[String(STATE.tabId)] || null : null;
        if (STATE.enabled) mount();
        else unmount();
        applyPos();
        render();
      })
    );
  }

  async function init() {
    await loadModel();
    const res = await C.sendMessage({ type: "get_tab_id" });
    STATE.tabId = res && res.tabId != null ? res.tabId : null;
    loadState();

    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local") return;
        if (changes.session_stats_by_tab && STATE.tabId != null) {
          STATE.stats = (changes.session_stats_by_tab.newValue || {})[String(STATE.tabId)] || null;
        }
        if (changes.settings) STATE.settings = changes.settings.newValue || null;
        if (changes.hud_by_domain) {
          const map = changes.hud_by_domain.newValue || {};
          STATE.enabled = Object.prototype.hasOwnProperty.call(map, STATE.domain) ? !!map[STATE.domain] : true;
          if (STATE.enabled) {
            STATE.closedForTab = false;
            mount();
          } else unmount();
        }
        render();
      });

      chrome.runtime.onMessage.addListener((msg) => {
        if (!msg || !msg.type) return;
        if (msg.type === "hud_state") {
          STATE.enabled = !!msg.enabled;
          STATE.closedForTab = false;
          if (STATE.enabled) mount();
          else unmount();
        } else if (msg.type === "session_update") {
          STATE.stats = msg.session_stats || null;
          const a = msg.activity;
          if (a && a.impact && M) {
            const g = M.formatCo2(a.impact.co2e_g.mid);
            const what = a.type === "image_gen" ? "🖼️ " : a.type === "video_gen" ? "🎬 " : "";
            toast(`${what}+${g.value} ${g.unit}`);
          }
          render();
        }
      });
    } catch (_e) {}

    C.bus.on("turn_start", () => {
      STATE.generating = true;
      render();
    });
    C.bus.on("turn_end", (d) => {
      STATE.generating = false;
      if (d && d.activity && d.activity.meta && d.activity.meta.model) STATE.model = d.activity.meta.model;
      render();
    });

    window.addEventListener("resize", applyPos);
    // Alcune SPA sostituiscono il body: rimonta l'HUD se sparisce.
    setInterval(() => {
      if (!C.contextAlive()) {
        unmount();
        return;
      }
      if (STATE.enabled && !STATE.closedForTab && STATE.host && !STATE.host.isConnected) mount();
    }, 3000);
  }

  init();
})();
