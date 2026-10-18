import { PRESETS, getDefaultPreset, clonePresetParams, normalizeParams } from "./estimator/presets.js";
import {
  estimateImpact,
  applyActivityToStats,
  mergeStats,
  emptyStats,
  dateKey,
  normalizeUXSettings,
  deriveUXFromAggregate,
  providerFromHost
} from "./estimator/model.js";

const PREFIX = "[AI Impact Meter]";
const ACTIVITY_CAP = 3000;
const DAY_RETENTION = 400;
const MAX_CHARS = 2_000_000;

function log(...args) {
  try {
    console.log(PREFIX, ...args);
  } catch (_e) {}
}

// ---------- coda di scrittura ----------
// Tutte le operazioni read-modify-write sullo storage passano da qui, così due
// attività che arrivano insieme (es. testo + immagine) non si sovrascrivono.
let writeQueue = Promise.resolve();
function enqueue(fn) {
  const run = writeQueue.then(fn, fn);
  writeQueue = run.catch((e) => log("queue error", e));
  return run;
}

// ---------- sessioni (sopravvivono al riavvio del service worker) ----------
async function getOrCreateSessionId(tabId, provider) {
  const key = `${tabId}:${provider || "unknown"}`;
  const res = await chrome.storage.session.get(["session_ids"]);
  const map = res.session_ids || {};
  if (!map[key]) {
    map[key] = self.crypto && self.crypto.randomUUID ? self.crypto.randomUUID() : `sess_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    await chrome.storage.session.set({ session_ids: map });
    log("session created", key, map[key]);
  }
  return map[key];
}

async function dropSessionIds(tabId) {
  const res = await chrome.storage.session.get(["session_ids"]);
  const map = res.session_ids || {};
  let changed = false;
  for (const k of Object.keys(map)) {
    if (k.startsWith(`${tabId}:`)) {
      delete map[k];
      changed = true;
    }
  }
  if (changed) await chrome.storage.session.set({ session_ids: map });
}

// ---------- impostazioni ----------
async function getSettings() {
  const res = await chrome.storage.local.get(["settings"]);
  const raw = res.settings || {};
  const presetKey = PRESETS[raw.presetKey] ? raw.presetKey : getDefaultPreset().key;
  const settings = {
    presetKey,
    params: normalizeParams(raw.params, presetKey),
    ux: normalizeUXSettings(raw.ux)
  };
  if (!res.settings) await chrome.storage.local.set({ settings });
  return settings;
}

// ---------- sanitizzazione input dai content script ----------
const TYPES = new Set(["text_turn", "image_gen", "video_gen"]);
const MODALITY_BY_TYPE = { text_turn: "text", image_gen: "image", video_gen: "video" };

function clampInt(v, max = MAX_CHARS) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, max);
}

function sanitizeActivity(raw, sender) {
  const a = raw && typeof raw === "object" ? raw : {};
  const type = TYPES.has(a.type) ? a.type : "text_turn";
  const url = (sender && sender.tab && sender.tab.url) || (sender && sender.url) || a.page_url || "";
  let host = "";
  try {
    host = new URL(url).host;
  } catch (_e) {}
  const provider = providerFromHost(host) || (typeof a.provider === "string" ? a.provider.slice(0, 32) : "unknown");
  const meta = a.meta && typeof a.meta === "object" ? { ...a.meta } : {};
  if (type === "image_gen") meta.count = Math.max(1, clampInt(meta.count, 64));
  if (type === "video_gen") {
    meta.count = Math.max(1, clampInt(meta.count, 16));
    const d = Number(meta.duration_sec);
    meta.duration_sec = Number.isFinite(d) && d > 0 ? Math.min(d, 600) : null;
  }
  const now = Date.now();
  const tsStart = Number(a.ts_start);
  const tsEnd = Number(a.ts_end);
  return {
    id: typeof a.id === "string" && a.id ? a.id.slice(0, 64) : self.crypto.randomUUID(),
    provider,
    type,
    modality: MODALITY_BY_TYPE[type],
    ts_start: Number.isFinite(tsStart) && tsStart > 0 ? tsStart : now,
    ts_end: Number.isFinite(tsEnd) && tsEnd > 0 ? tsEnd : now,
    prompt_chars: clampInt(a.prompt_chars),
    prompt_words: clampInt(a.prompt_words),
    response_chars: clampInt(a.response_chars),
    response_words: clampInt(a.response_words),
    page_url: String(url).slice(0, 500),
    domain: host,
    meta
  };
}

// ---------- registrazione attività ----------
async function addActivityFinal(activity, tabId) {
  const settings = await getSettings();
  const preset = { key: settings.presetKey, params: settings.params };
  activity.assumptions_used = { presetKey: preset.key, params: preset.params };
  activity.impact = estimateImpact(activity, preset);

  const store = await chrome.storage.local.get(["activities", "session_stats_by_tab", "day_stats_by_date", "totals"]);
  const activities = store.activities || [];
  if (activities.some((x) => x.id === activity.id)) {
    log("duplicate activity ignored", activity.id);
    return null;
  }
  activities.push(activity);
  if (activities.length > ACTIVITY_CAP) activities.splice(0, activities.length - ACTIVITY_CAP);

  const sessionMap = store.session_stats_by_tab || {};
  const tabKey = tabId != null ? String(tabId) : "unknown";
  sessionMap[tabKey] = applyActivityToStats(sessionMap[tabKey] || emptyStats(), activity);

  const dayMap = store.day_stats_by_date || {};
  const key = dateKey(activity.ts_end || Date.now());
  dayMap[key] = applyActivityToStats(dayMap[key] || emptyStats(), activity);
  const keys = Object.keys(dayMap).sort();
  while (keys.length > DAY_RETENTION) delete dayMap[keys.shift()];

  const totals = applyActivityToStats(store.totals || emptyStats(), activity);

  await chrome.storage.local.set({ activities, session_stats_by_tab: sessionMap, day_stats_by_date: dayMap, totals });
  log("activity recorded", activity.type, activity.provider, activity.impact.co2e_g.mid.toFixed(4), "g");

  if (tabId != null) {
    notifyTab(tabId, { type: "session_update", session_stats: sessionMap[tabKey], activity });
    updateBadge(tabId, sessionMap[tabKey], settings);
  }
  return activity;
}

function notifyTab(tabId, msg) {
  try {
    const p = chrome.tabs.sendMessage(tabId, msg);
    if (p && typeof p.catch === "function") p.catch(() => {});
  } catch (_e) {}
}

function badgeText(g) {
  if (!g || g <= 0) return "";
  if (g < 10) return g.toFixed(1);
  if (g < 1000) return String(Math.round(g));
  return `${Math.round(g / 1000)}k`;
}

async function updateBadge(tabId, stats, settings) {
  try {
    const s = settings || (await getSettings());
    const g = stats && stats.co2e_g ? stats.co2e_g.mid : 0;
    const ux = deriveUXFromAggregate(stats ? { ...stats, scope: "session" } : null, s);
    await chrome.action.setBadgeText({ tabId, text: badgeText(g) });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: ux.badge.color || "#22c55e" });
    if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ tabId, color: "#ffffff" });
    await chrome.action.setTitle({ tabId, title: g > 0 ? `AI Impact Meter · sessione: ${g.toFixed(3)} g CO₂e` : "AI Impact Meter" });
  } catch (_e) {
    // tab chiuso nel frattempo
  }
}

async function refreshBadgeForTab(tabId) {
  const res = await chrome.storage.local.get(["session_stats_by_tab"]);
  const stats = (res.session_stats_by_tab || {})[String(tabId)] || null;
  await updateBadge(tabId, stats);
}

// ---------- export ----------
function csvCell(v) {
  if (v == null) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportCSV(activities) {
  const headers = [
    "id", "provider", "type", "modality", "ts_start", "ts_end", "datetime",
    "prompt_chars", "prompt_words", "response_chars", "response_words", "tokens_est",
    "media_count", "video_sec", "resolution", "model", "source",
    "page_url", "tab_id", "session_id", "preset",
    "kwh_min", "kwh_mid", "kwh_max", "co2e_g_min", "co2e_g_mid", "co2e_g_max"
  ];
  const lines = [headers.join(",")];
  for (const a of activities) {
    const m = a.meta || {};
    const row = [
      a.id, a.provider, a.type, a.modality, a.ts_start, a.ts_end || "",
      a.ts_start ? new Date(a.ts_start).toISOString() : "",
      a.prompt_chars || 0, a.prompt_words || 0, a.response_chars || 0, a.response_words || 0,
      a.impact?.tokens || 0,
      m.count || "", a.impact?.video_sec || "", m.resolution || "", m.model || "", m.source || "",
      a.page_url || "", a.tab_id ?? "", a.session_id || "", a.assumptions_used?.presetKey || "",
      a.impact?.kwh?.min || 0, a.impact?.kwh?.mid || 0, a.impact?.kwh?.max || 0,
      a.impact?.co2e_g?.min || 0, a.impact?.co2e_g?.mid || 0, a.impact?.co2e_g?.max || 0
    ];
    lines.push(row.map(csvCell).join(","));
  }
  return lines.join("\n");
}

// ---------- reset ----------
async function resetData(scope) {
  if (scope === "today") {
    const store = await chrome.storage.local.get(["activities", "day_stats_by_date", "totals"]);
    const key = dateKey();
    const activities = (store.activities || []).filter((a) => dateKey(a.ts_end || a.ts_start) !== key);
    const dayMap = store.day_stats_by_date || {};
    const removed = dayMap[key];
    delete dayMap[key];
    let totals = store.totals || emptyStats();
    if (removed) {
      // ricostruisce i totali dalla somma dei giorni rimasti
      totals = mergeStats(Object.values(dayMap));
    }
    await chrome.storage.local.set({ activities, day_stats_by_date: dayMap, totals, session_stats_by_tab: {} });
  } else {
    await chrome.storage.local.set({ activities: [], day_stats_by_date: {}, totals: emptyStats(), session_stats_by_tab: {} });
  }
  const tabs = await chrome.tabs.query({});
  for (const t of tabs) {
    if (t.id == null) continue;
    notifyTab(t.id, { type: "session_update", session_stats: null });
    chrome.action.setBadgeText({ tabId: t.id, text: "" }).catch(() => {});
  }
}

// ---------- messaggi ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return false;
  const tabId = sender && sender.tab ? sender.tab.id : null;
  const fromExtensionPage = sender && sender.url && sender.url.startsWith(chrome.runtime.getURL(""));

  const reply = (p) => {
    Promise.resolve(p)
      .then((r) => sendResponse(r))
      .catch((e) => {
        log(msg.type, "error", e);
        sendResponse({ ok: false, error: String(e && e.message ? e.message : e) });
      });
    return true;
  };

  switch (msg.type) {
    case "get_tab_id":
      if (tabId != null) refreshBadgeForTab(tabId).catch(() => {});
      sendResponse({ tabId });
      return false;

    case "activity_partial":
      sendResponse({ ok: tabId != null });
      return false;

    case "activity_final": {
      if (tabId == null) {
        sendResponse({ ok: false });
        return false;
      }
      return reply(
        (async () => {
          const activity = sanitizeActivity(msg.activity, sender);
          const sessionId = await getOrCreateSessionId(tabId, activity.provider);
          activity.tab_id = tabId;
          activity.session_id = sessionId;
          activity.meta.tab_id = tabId;
          activity.meta.session_id = sessionId;
          const saved = await enqueue(() => addActivityFinal(activity, tabId));
          return { ok: true, recorded: !!saved };
        })()
      );
    }

    case "open_options":
      chrome.runtime.openOptionsPage();
      sendResponse({ ok: true });
      return false;

    case "hud_toggle": {
      const enabled = !!msg.enabled;
      if (msg.tab_only) {
        sendResponse({ ok: true });
        return false;
      }
      return reply(
        enqueue(async () => {
          const res = await chrome.storage.local.get(["hud_by_domain"]);
          const map = res.hud_by_domain || {};
          if (msg.domain) map[msg.domain] = enabled;
          await chrome.storage.local.set({ hud_by_domain: map });
          return { ok: true };
        })
      );
    }

    case "get_day_stats":
      return reply(
        chrome.storage.local.get(["day_stats_by_date"]).then((res) => ({
          stats: (res.day_stats_by_date || {})[msg.dateKey || dateKey()] || emptyStats()
        }))
      );

    case "export_json":
      return reply(chrome.storage.local.get(["activities"]).then((res) => ({ data: res.activities || [] })));

    case "export_csv":
      return reply(chrome.storage.local.get(["activities"]).then((res) => ({ data: exportCSV(res.activities || []) })));

    case "reset_data":
      if (!fromExtensionPage) {
        sendResponse({ ok: false });
        return false;
      }
      return reply(enqueue(() => resetData(msg.scope)).then(() => ({ ok: true })));

    default:
      return false;
  }
});

// ---------- ciclo di vita ----------
chrome.tabs.onRemoved.addListener((tabId) => {
  dropSessionIds(tabId).catch(() => {});
  enqueue(async () => {
    const res = await chrome.storage.local.get(["session_stats_by_tab"]);
    const map = res.session_stats_by_tab || {};
    if (map[String(tabId)]) {
      delete map[String(tabId)];
      await chrome.storage.local.set({ session_stats_by_tab: map });
    }
  });
});

// Gli ID dei tab non sopravvivono al riavvio del browser: le sessioni vecchie vanno rimosse.
chrome.runtime.onStartup.addListener(() => {
  enqueue(() => chrome.storage.local.set({ session_stats_by_tab: {} }));
});

chrome.runtime.onInstalled.addListener((details) => {
  enqueue(async () => {
    const settings = await getSettings();
    await chrome.storage.local.set({ settings });
    const res = await chrome.storage.local.get(["totals", "day_stats_by_date"]);
    if (!res.totals && res.day_stats_by_date) {
      await chrome.storage.local.set({ totals: mergeStats(Object.values(res.day_stats_by_date)) });
    }
    log("installed", details.reason, chrome.runtime.getManifest().version);
  });
  if (details.reason === "install") chrome.runtime.openOptionsPage();
});

// esposto per debug dalla console del service worker
self.AIIM_DEBUG = { getSettings, exportCSV, resetData, clonePresetParams };
