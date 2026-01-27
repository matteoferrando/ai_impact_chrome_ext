(() => {
  const C = window.AIImpactCommon;
  if (!C) return;

  const STATE = {
    enabled: true,
    domain: C.getDomain(),
    sessionStats: null,
    lastRenderKey: "",
    poller: null,
    initialized: false,
    uxModule: null,
    uxSettings: null
  };

  function createHUD() {
    const host = document.createElement("div");
    host.id = "ai-impact-meter-hud";
    host.style.all = "initial";
    host.style.position = "fixed";
    host.style.right = "16px";
    host.style.bottom = "16px";
    host.style.zIndex = "2147483647";
    host.style.fontFamily = "system-ui, -apple-system, Segoe UI, sans-serif";

    const shadow = host.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = `
      :host { all: initial; }
      .hud {
        background: rgba(20, 20, 20, 0.9);
        color: #fff;
        border-radius: 12px;
        padding: 10px 12px;
        min-width: 220px;
        box-shadow: 0 8px 20px rgba(0,0,0,0.25);
        font-size: 12px;
      }
      .row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
      .title { font-weight: 600; font-size: 12px; opacity: 0.9; }
      .value { font-weight: 600; }
      .muted { opacity: 0.7; }
      .buttons { display: flex; gap: 6px; }
      .btn {
        background: rgba(255,255,255,0.12);
        border: 0;
        color: #fff;
        border-radius: 8px;
        padding: 4px 6px;
        cursor: pointer;
        font-size: 12px;
      }
      .btn:hover { background: rgba(255,255,255,0.22); }
      .details { margin-top: 6px; display: none; }
      .details.show { display: block; }
      .line { display: flex; justify-content: space-between; }
    `;

    const wrap = document.createElement("div");
    wrap.className = "hud";
    wrap.innerHTML = `
      <div class="row">
        <div>
          <div class="title">AI Impact Meter</div>
          <div class="muted" id="aim-session">Sessione: --</div>
        </div>
        <div class="buttons">
          <button class="btn" id="aim-toggle">≡</button>
          <button class="btn" id="aim-close">×</button>
        </div>
      </div>
      <div class="row" id="aim-ux-line">Eco-Score: --</div>
      <div class="details" id="aim-details">
        <div class="line"><span>CO2e</span><span id="aim-co2">--</span></div>
      </div>
    `;

    shadow.appendChild(style);
    shadow.appendChild(wrap);

    wrap.querySelector("#aim-toggle").addEventListener("click", () => {
      const d = wrap.querySelector("#aim-details");
      d.classList.toggle("show");
    });

    wrap.querySelector("#aim-close").addEventListener("click", () => {
      host.remove();
      STATE.enabled = false;
      C.sendMessage({ type: "hud_toggle", enabled: false, domain: STATE.domain, tab_only: true });
    });

    return host;
  }

  function formatMid(r, digits = 4) {
    if (!r || typeof r.mid !== "number") return "--";
    return r.mid.toFixed(digits);
  }

  async function render() {
    const host = document.getElementById("ai-impact-meter-hud");
    if (!host) return;
    const shadow = host.shadowRoot;
    if (!shadow) return;
    const stats = STATE.sessionStats;
    if (!stats) return;

    const key = JSON.stringify(stats);
    if (key === STATE.lastRenderKey) return;
    STATE.lastRenderKey = key;

    const co2 = formatMid(stats.co2e_g, 4);
    const sessionEl = shadow.querySelector("#aim-session");
    sessionEl.textContent = `Sessione: ${co2} g CO2e`;
    shadow.querySelector("#aim-co2").textContent = `${co2} g`;
    const ux = await deriveUX(stats);
    if (ux) {
      const badge = ux.badge || { emoji: "🟢", label: "Light" };
      const eq = ux.equivalents || { phone_charges: 0 };
      shadow.querySelector("#aim-ux-line").textContent = `Eco-Score: ${ux.ecoScore}/100 · ${badge.emoji} ${badge.label}`;
    }
  }

  function ensureHUD() {
    if (!STATE.enabled) return;
    if (document.getElementById("ai-impact-meter-hud")) return;
    document.documentElement.appendChild(createHUD());
  }

  function updateFromStorage() {
    if (!chrome.runtime || !chrome.runtime.id) {
      if (STATE.poller) clearInterval(STATE.poller);
      return;
    }
    chrome.storage.local.get(["session_stats_by_tab", "settings"], (res) => {
      const tabId = STATE.tabId;
      const map = res.session_stats_by_tab || {};
      STATE.sessionStats = map[tabId] || null;
      STATE.uxSettings = res.settings?.ux || null;
      render();
    });
  }

  function handleMessage(msg) {
    if (!msg || !msg.type) return;
    if (msg.type === "hud_state") {
      STATE.enabled = !!msg.enabled;
      if (!STATE.enabled) {
        const el = document.getElementById("ai-impact-meter-hud");
        if (el) el.remove();
      } else {
        ensureHUD();
      }
    }
    if (msg.type === "session_update") {
      STATE.sessionStats = msg.session_stats;
      render();
    }
  }

  function init() {
    if (STATE.initialized) return;
    STATE.initialized = true;
    chrome.runtime.sendMessage({ type: "get_tab_id" }, (res) => {
      const err = chrome.runtime.lastError;
      if (err) {
        C.log("get_tab_id error", err);
        return;
      }
      STATE.tabId = res && res.tabId ? res.tabId : null;
      chrome.storage.local.get(["hud_by_domain"], (data) => {
        const map = data.hud_by_domain || {};
        if (Object.prototype.hasOwnProperty.call(map, STATE.domain)) {
          STATE.enabled = !!map[STATE.domain];
        }
        if (STATE.enabled) ensureHUD();
        updateFromStorage();
      });

      if (!STATE.poller) {
        STATE.poller = setInterval(updateFromStorage, 2000);
      }
    });

    chrome.runtime.onMessage.addListener((msg) => {
      try {
        handleMessage(msg);
      } catch (e) {
        C.log("hud message error", e);
      }
    });
  }

  init();

  async function ensureUXModule() {
    if (STATE.uxModule) return STATE.uxModule;
    try {
      if (!chrome.runtime || !chrome.runtime.id) return null;
      STATE.uxModule = await import(chrome.runtime.getURL("estimator/model.js"));
      return STATE.uxModule;
    } catch (e) {
      C.log("UX module load failed", e);
      return null;
    }
  }

  async function deriveUX(stats) {
    const mod = await ensureUXModule();
    if (!mod) return null;
    const settings = STATE.uxSettings || { ux: mod.getDefaultUXSettings() };
    return mod.deriveUXFromAggregate({ ...stats, scope: "session" }, settings);
  }
})();
