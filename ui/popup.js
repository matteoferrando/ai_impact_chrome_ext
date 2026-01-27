import { deriveUXFromAggregate, getDefaultUXSettings } from "../estimator/model.js";

const $ = (id) => document.getElementById(id);

function formatRange(r, digits = 4) {
  if (!r) return "--";
  return `${r.min.toFixed(digits)}–${r.mid.toFixed(digits)}–${r.max.toFixed(digits)}`;
}

function formatMid(r, digits = 4) {
  if (!r || typeof r.mid !== "number") return "--";
  return r.mid.toFixed(digits);
}

function renderBreakdown(el, stats) {
  el.innerHTML = "";
  if (!stats) return;
  const byProvider = stats.by_provider || {};
  const byModality = stats.by_modality || {};

  const providerKeys = Object.keys(byProvider);
  if (providerKeys.length) {
    const title = document.createElement("div");
    title.className = "row";
    title.innerHTML = "<strong>Provider</strong><span></span>";
    el.appendChild(title);
    for (const k of providerKeys) {
      const row = document.createElement("div");
      row.className = "row";
      row.innerHTML = `<span>${k}</span><span>${formatMid(byProvider[k].co2e_g, 3)} g</span>`;
      el.appendChild(row);
    }
  }

  const modalityKeys = Object.keys(byModality);
  if (modalityKeys.length) {
    const title = document.createElement("div");
    title.className = "row";
    title.innerHTML = "<strong>Modality</strong><span></span>";
    el.appendChild(title);
    for (const k of modalityKeys) {
      const row = document.createElement("div");
      row.className = "row";
      row.innerHTML = `<span>${k}</span><span>${formatMid(byModality[k].co2e_g, 3)} g</span>`;
      el.appendChild(row);
    }
  }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function init() {
  const tab = await getActiveTab();
  const tabId = tab ? tab.id : null;
  const domain = tab ? new URL(tab.url).host : null;

  chrome.storage.local.get(["session_stats_by_tab", "day_stats_by_date", "hud_by_domain", "settings"], (res) => {
    const sessionMap = res.session_stats_by_tab || {};
    const sessionStats = tabId != null ? sessionMap[tabId] : null;
    const today = new Date();
    const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const dayStats = (res.day_stats_by_date || {})[key] || null;
    const settings = res.settings || {};
    if (!settings.ux) settings.ux = getDefaultUXSettings();

    $("session-kwh").textContent = formatMid(sessionStats?.kwh, 6);
    $("session-co2").textContent = formatMid(sessionStats?.co2e_g, 3);
    renderBreakdown($("session-breakdown"), sessionStats);

    $("day-kwh").textContent = formatMid(dayStats?.kwh, 6);
    $("day-co2").textContent = formatMid(dayStats?.co2e_g, 3);
    renderBreakdown($("day-breakdown"), dayStats);

    renderUX("session", sessionStats, settings);
    renderUX("day", dayStats, settings);

    const hudMap = res.hud_by_domain || {};
    if (domain && Object.prototype.hasOwnProperty.call(hudMap, domain)) {
      $("hud-toggle").checked = !!hudMap[domain];
    } else {
      $("hud-toggle").checked = true;
    }

    $("hud-toggle").addEventListener("change", () => {
      const enabled = $("hud-toggle").checked;
      const update = { hud_by_domain: { ...(hudMap || {}) } };
      if (domain) update.hud_by_domain[domain] = enabled;
      chrome.storage.local.set(update, () => {
        if (tabId != null) chrome.tabs.sendMessage(tabId, { type: "hud_state", enabled });
      });
    });
  });

  $("open-options").addEventListener("click", () => chrome.runtime.openOptionsPage());

  $("export-json").addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "export_json" }, (res) => {
      const blob = new Blob([JSON.stringify(res.data || [], null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      chrome.downloads.download({ url, filename: "ai-impact-meter.json" });
    });
  });

  $("export-csv").addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "export_csv" }, (res) => {
      const blob = new Blob([res.data || ""], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      chrome.downloads.download({ url, filename: "ai-impact-meter.csv" });
    });
  });
}

init();

function renderUX(scope, stats, settings) {
  const aggregate = stats ? { ...stats, scope } : null;
  const ux = deriveUXFromAggregate(aggregate, settings);
  const badge = ux.badge || { emoji: "🟢", label: "Light" };
  const highlight = `Eco-Score: ${ux.ecoScore}/100 · ${badge.emoji} ${badge.label}`;
  $(`${scope}-ux-highlight`).textContent = highlight;

  const eq = ux.equivalents || { phone_charges: 0, car_meters: 0, streaming_minutes: 0 };
  const eqLine = `Equivalenze (stima): ~${eq.phone_charges.toFixed(1)} ricariche smartphone · ~${Math.round(eq.car_meters)} m auto · ~${eq.streaming_minutes.toFixed(1)} min streaming`;
  $(`${scope}-equivalences`).textContent = eqLine;

  const driver = ux.topDriver || { modality: "unknown", pct: 0 };
  const driverText = driver.modality === "unknown" ? "Driver principale: --" : `Driver principale: ${labelModality(driver.modality)} (${driver.pct}%)`;
  $(`${scope}-driver`).textContent = driverText;
}

function labelModality(modality) {
  if (modality === "text") return "Testo";
  if (modality === "image") return "Immagini";
  if (modality === "video") return "Video";
  return modality;
}
