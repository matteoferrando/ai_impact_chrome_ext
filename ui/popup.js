import {
  deriveUXFromAggregate,
  mergeStats,
  dateKey,
  lastNDateKeys,
  formatCo2,
  formatEnergy,
  formatWater,
  formatDistance,
  formatNumber,
  formatCompact,
  scoreColor,
  modalityLabel,
  providerLabel,
  providerFromHost,
  PROVIDERS
} from "../estimator/model.js";
import { PRESETS } from "../estimator/presets.js";

const $ = (id) => document.getElementById(id);
const RING_C = 2 * Math.PI * 33;
const SCOPE_KEY = "aiim_popup_scope";

const state = {
  scope: "session",
  tab: null,
  domain: null,
  provider: null,
  store: {}
};

try {
  const saved = localStorage.getItem(SCOPE_KEY);
  if (saved) state.scope = saved;
} catch (_e) {}

async function getActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab || null;
  } catch (_e) {
    return null;
  }
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch (_e) {
    return null;
  }
}

function statsForScope(scope) {
  const s = state.store;
  const days = s.day_stats_by_date || {};
  if (scope === "session") {
    if (!state.tab || state.tab.id == null) return null;
    return (s.session_stats_by_tab || {})[String(state.tab.id)] || null;
  }
  if (scope === "day") return days[dateKey()] || null;
  if (scope === "week") {
    const list = lastNDateKeys(7).map((k) => days[k]).filter(Boolean);
    return list.length ? mergeStats(list) : null;
  }
  return s.totals || (Object.keys(days).length ? mergeStats(Object.values(days)) : null);
}

function hasActivity(stats) {
  if (!stats || !stats.counts) return false;
  return Object.values(stats.counts).some((v) => v > 0);
}

function render() {
  const scope = state.scope;
  document.querySelectorAll(".seg button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.scope === scope)));

  const settings = state.store.settings || {};
  const preset = PRESETS[settings.presetKey] || PRESETS.typical;
  $("preset-chip").textContent = preset.label;

  const stats = statsForScope(scope);
  const active = hasActivity(stats);
  const ux = deriveUXFromAggregate(active ? { ...stats, scope } : null, settings);

  // stato vuoto
  $("empty").classList.toggle("hidden", active);
  for (const id of ["hero", "tiles", "eq-card", "breakdown-card"]) $(id).classList.toggle("hidden", !active);
  if (!active) {
    if (scope === "session" && !state.provider) {
      $("empty-title").textContent = "Questo tab non è un assistente AI";
      $("empty-text").textContent = "La sessione si misura sui tab di ChatGPT, Gemini e Claude. Guarda “Oggi” o “Totale” per lo storico.";
    } else if (scope === "session") {
      $("empty-title").textContent = `Pronto su ${providerLabel(state.provider)}`;
      $("empty-text").textContent = "Invia un prompt: la stima di questa sessione apparirà qui in tempo reale.";
    } else {
      $("empty-title").textContent = "Nessuna attività nel periodo";
      $("empty-text").textContent = "Usa ChatGPT, Gemini o Claude e torna qui per vedere il tuo impatto stimato.";
    }
  }

  if (active) {
    // hero
    const hero = $("hero");
    const score = ux.ecoScore;
    const color = score == null ? "#22c55e" : scoreColor(score);
    hero.style.setProperty("--score", color);
    hero.style.setProperty("--badge", ux.badge.color);
    if (score == null) {
      $("score").textContent = formatCompact((stats.counts.text_turn || 0) + (stats.counts.image_gen || 0) + (stats.counts.video_gen || 0));
      $("score-label").textContent = "ATTIVITÀ";
      $("ring-bar").style.strokeDashoffset = "0";
    } else {
      $("score").textContent = String(score);
      $("score-label").textContent = "ECO-SCORE";
      requestAnimationFrame(() => ($("ring-bar").style.strokeDashoffset = String(RING_C * (1 - score / 100))));
    }
    const co2 = formatCo2(stats.co2e_g.mid);
    $("co2").textContent = co2.value;
    $("co2-unit").textContent = co2.unit;
    $("co2-range").textContent = `range ${formatNumber(stats.co2e_g.min)} – ${formatNumber(stats.co2e_g.max)} g`;
    $("badge").textContent = `${ux.badge.emoji} ${ux.badge.label}`;

    // tile
    const energy = formatEnergy(stats.kwh.mid);
    $("energy").textContent = energy.value;
    $("energy-unit").textContent = energy.unit;
    const water = formatWater(ux.equivalents.water_ml);
    $("water").textContent = water.value;
    $("water-unit").textContent = water.unit;
    $("turns").textContent = formatCompact(stats.counts.text_turn || 0);
    const media = [];
    if (stats.images) media.push(`+${stats.images} img`);
    if (stats.counts.video_gen) media.push(`+${stats.counts.video_gen} video`);
    $("media").textContent = media.join(" ");
    $("tokens").textContent = formatCompact(stats.tokens || 0);

    renderEquivalences(ux.equivalents);
    renderBreakdown(stats, ux);
  }

  renderChart();
  renderSite();
}

function renderEquivalences(e) {
  const car = formatDistance(e.car_meters);
  const rows = [
    ["📱", `<b>${formatNumber(e.phone_charges)}</b> ricariche di smartphone`],
    ["🚗", `<b>${car.value} ${car.unit}</b> percorsi in auto`],
    ["📺", `<b>${formatNumber(e.streaming_minutes)}</b> min di streaming video`],
    ["💡", `<b>${formatNumber(e.led_minutes)}</b> min di lampadina LED accesa`]
  ];
  $("equivalences").innerHTML = rows.map(([i, t]) => `<li><span class="ico">${i}</span><span>${t}</span></li>`).join("");
}

function renderBreakdown(stats, ux) {
  const entries = Object.entries(stats.by_provider || {})
    .map(([k, v]) => [k, (v.co2e_g && v.co2e_g.mid) || 0])
    .sort((a, b) => b[1] - a[1]);
  const max = Math.max(...entries.map(([, v]) => v), 0) || 1;
  const box = $("breakdown");
  box.innerHTML = "";
  for (const [k, v] of entries) {
    const color = (PROVIDERS[k] && PROVIDERS[k].color) || "#94a3b8";
    const row = document.createElement("div");
    row.className = "bar-row";
    const c = formatCo2(v);
    row.innerHTML = `<span class="name"><i style="background:${color}"></i>${providerLabel(k)}</span>
      <span class="bar-track"><span class="bar-fill" style="background:${color}"></span></span>
      <span class="val">${c.value} ${c.unit.replace(" CO₂e", "")}</span>`;
    box.appendChild(row);
    requestAnimationFrame(() => (row.querySelector(".bar-fill").style.width = `${Math.max(3, (v / max) * 100)}%`));
  }
  const d = ux.topDriver;
  $("driver").textContent = d.modality === "unknown" ? "" : `Driver principale: ${modalityLabel(d.modality)} (${d.pct}%)`;
}

function renderChart() {
  const days = state.store.day_stats_by_date || {};
  const keys = lastNDateKeys(7);
  const vals = keys.map((k) => (days[k] && days[k].co2e_g ? days[k].co2e_g.mid : 0));
  const max = Math.max(...vals, 0);
  const today = dateKey();
  const fmt = new Intl.DateTimeFormat("it-IT", { weekday: "short" });
  const chart = $("chart");
  chart.innerHTML = "";
  keys.forEach((k, i) => {
    const [y, m, d] = k.split("-").map(Number);
    const col = document.createElement("div");
    col.className = `col${k === today ? " today" : ""}`;
    const b = document.createElement("div");
    b.className = "b";
    b.style.height = "3px";
    const c = formatCo2(vals[i]);
    b.dataset.v = `${c.value} ${c.unit}`;
    const lab = document.createElement("div");
    lab.className = "d";
    lab.textContent = fmt.format(new Date(y, m - 1, d)).replace(".", "");
    col.append(b, lab);
    chart.appendChild(col);
    requestAnimationFrame(() => (b.style.height = max > 0 ? `${Math.max(3, (vals[i] / max) * 72)}px` : "3px"));
  });
  const total = formatCo2(vals.reduce((a, v) => a + v, 0));
  $("week-total").textContent = `${total.value} ${total.unit}`;
}

function renderSite() {
  const supported = !!state.provider;
  $("site-supported").classList.toggle("hidden", !supported);
  $("site-unsupported").classList.toggle("hidden", supported);
  if (supported) {
    $("site-domain").textContent = state.domain;
    const map = state.store.hud_by_domain || {};
    $("hud-toggle").checked = Object.prototype.hasOwnProperty.call(map, state.domain) ? !!map[state.domain] : true;
  } else if (!$("provider-links").children.length) {
    for (const [, p] of Object.entries(PROVIDERS)) {
      const a = document.createElement("a");
      a.href = p.url;
      a.target = "_blank";
      a.rel = "noopener";
      a.innerHTML = `<i style="background:${p.color}"></i>${p.label}`;
      $("provider-links").appendChild(a);
    }
  }
}

async function loadStore() {
  state.store = await chrome.storage.local.get(["session_stats_by_tab", "day_stats_by_date", "totals", "hud_by_domain", "settings"]);
}

function download(content, type, ext) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0, 10);
  chrome.downloads.download({ url, filename: `ai-impact-meter-${stamp}.${ext}`, saveAs: false }, () => {
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  });
}

function bind() {
  document.querySelectorAll(".seg button").forEach((b) =>
    b.addEventListener("click", () => {
      state.scope = b.dataset.scope;
      try {
        localStorage.setItem(SCOPE_KEY, state.scope);
      } catch (_e) {}
      render();
    })
  );

  $("hud-toggle").addEventListener("change", async () => {
    const enabled = $("hud-toggle").checked;
    await chrome.runtime.sendMessage({ type: "hud_toggle", domain: state.domain, enabled });
    if (state.tab && state.tab.id != null) chrome.tabs.sendMessage(state.tab.id, { type: "hud_state", enabled }).catch(() => {});
  });

  $("open-options").addEventListener("click", () => chrome.runtime.openOptionsPage());
  $("preset-chip").addEventListener("click", () => chrome.runtime.openOptionsPage());

  $("export-json").addEventListener("click", async () => {
    const res = await chrome.runtime.sendMessage({ type: "export_json" });
    download(JSON.stringify((res && res.data) || [], null, 2), "application/json", "json");
  });
  $("export-csv").addEventListener("click", async () => {
    const res = await chrome.runtime.sendMessage({ type: "export_csv" });
    download((res && res.data) || "", "text/csv", "csv");
  });

  let resetTimer = null;
  $("reset").addEventListener("click", async () => {
    const btn = $("reset");
    if (!btn.classList.contains("confirm")) {
      btn.classList.add("confirm");
      btn.textContent = "Confermi?";
      resetTimer = setTimeout(() => {
        btn.classList.remove("confirm");
        btn.textContent = "Reset";
      }, 3000);
      return;
    }
    clearTimeout(resetTimer);
    await chrome.runtime.sendMessage({ type: "reset_data", scope: "all" });
    btn.classList.remove("confirm");
    btn.textContent = "Fatto ✓";
    setTimeout(() => (btn.textContent = "Reset"), 1500);
  });

  chrome.storage.onChanged.addListener(async (_changes, area) => {
    if (area !== "local") return;
    await loadStore();
    render();
  });
}

async function init() {
  state.tab = await getActiveTab();
  state.domain = state.tab ? hostOf(state.tab.url || state.tab.pendingUrl || "") : null;
  state.provider = providerFromHost(state.domain);
  // Default sensato: se il tab non è un assistente, mostra "Oggi".
  if (state.scope === "session" && !state.provider) state.scope = "day";
  await loadStore();
  bind();
  render();
}

init();
