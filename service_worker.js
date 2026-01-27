const PREFIX = "[AI Impact Meter]";
const ACTIVITY_CAP = 500;
// SESSION MANAGEMENT PATCH
const sessionByTabProvider = {};

const PRESETS = {
  conservative: {
    key: "conservative",
    label: "Conservative",
    params: {
      chars_per_token: 4.5,
      kwh_per_1k_tokens_range: { min: 0.0002, mid: 0.0005, max: 0.001 },
      kwh_per_image_range: { min: 0.0001, mid: 0.0003, max: 0.0006 },
      kwh_per_video_sec_range: { min: 0.00002, mid: 0.00008, max: 0.0002 },
      grid_gco2e_per_kwh_range: { min: 150, mid: 300, max: 500 }
    }
  },
  typical: {
    key: "typical",
    label: "Typical",
    params: {
      chars_per_token: 4,
      kwh_per_1k_tokens_range: { min: 0.0005, mid: 0.001, max: 0.002 },
      kwh_per_image_range: { min: 0.0002, mid: 0.0006, max: 0.001 },
      kwh_per_video_sec_range: { min: 0.00005, mid: 0.0002, max: 0.0006 },
      grid_gco2e_per_kwh_range: { min: 200, mid: 400, max: 700 }
    }
  },
  aggressive: {
    key: "aggressive",
    label: "Aggressive",
    params: {
      chars_per_token: 3.5,
      kwh_per_1k_tokens_range: { min: 0.001, mid: 0.0025, max: 0.005 },
      kwh_per_image_range: { min: 0.0005, mid: 0.0012, max: 0.0025 },
      kwh_per_video_sec_range: { min: 0.0001, mid: 0.0004, max: 0.0012 },
      grid_gco2e_per_kwh_range: { min: 300, mid: 600, max: 900 }
    }
  }
};

function getDefaultPreset() {
  return PRESETS.typical;
}

function clonePresetParams(params) {
  return JSON.parse(JSON.stringify(params));
}

function estimateImpact(activity, preset) {
  const p = preset && preset.params ? preset.params : preset;
  if (!p) {
    return { kwh: { min: 0, mid: 0, max: 0 }, co2e_g: { min: 0, mid: 0, max: 0 } };
  }

  const rangeFromBase = (base, range) => {
    return {
      min: base * range.min,
      mid: base * range.mid,
      max: base * range.max
    };
  };

  let kwh = { min: 0, mid: 0, max: 0 };

  if (activity.type === "text_turn") {
    const chars = (activity.prompt_chars || 0) + (activity.response_chars || 0);
    const tokens = p.chars_per_token > 0 ? Math.ceil(chars / p.chars_per_token) : 0;
    const base = tokens / 1000;
    kwh = rangeFromBase(base, p.kwh_per_1k_tokens_range);
  } else if (activity.type === "image_gen") {
    const count = activity.meta && activity.meta.count ? activity.meta.count : 0;
    kwh = rangeFromBase(count, p.kwh_per_image_range);
  } else if (activity.type === "video_gen") {
    const secs = activity.meta && activity.meta.duration_sec ? activity.meta.duration_sec : 0;
    kwh = rangeFromBase(secs, p.kwh_per_video_sec_range);
  }

  const co2e_g = {
    min: kwh.min * p.grid_gco2e_per_kwh_range.min,
    mid: kwh.mid * p.grid_gco2e_per_kwh_range.mid,
    max: kwh.max * p.grid_gco2e_per_kwh_range.max
  };

  return { kwh, co2e_g };
}

const inMemory = {
  partialByTab: {}
};

function log(...args) {
  try {
    console.log(PREFIX, ...args);
  } catch (_e) {}
}

// SESSION MANAGEMENT PATCH
function getOrCreateSessionId(tabId, provider) {
  const key = `${tabId}:${provider || "unknown"}`;
  if (!sessionByTabProvider[key]) {
    let id = null;
    try {
      if (self.crypto && typeof self.crypto.randomUUID === "function") {
        id = self.crypto.randomUUID();
      }
    } catch (_e) {}
    if (!id) {
      id = `sess_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    }
    sessionByTabProvider[key] = id;
    log("SESSION CREATED", key, id);
  }
  return sessionByTabProvider[key];
}

function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function emptyRange() {
  return { min: 0, mid: 0, max: 0 };
}

function emptyCounts() {
  return { image_gen: 0, video_gen: 0 };
}

function mergeRange(a, b) {
  return {
    min: (a.min || 0) + (b.min || 0),
    mid: (a.mid || 0) + (b.mid || 0),
    max: (a.max || 0) + (b.max || 0)
  };
}

function ensureStatsBase() {
  return {
    kwh: emptyRange(),
    co2e_g: emptyRange(),
    counts: emptyCounts(),
    by_provider: {},
    by_modality: {}
  };
}

function applyActivityToStats(stats, activity) {
  stats.kwh = mergeRange(stats.kwh, activity.impact.kwh);
  stats.co2e_g = mergeRange(stats.co2e_g, activity.impact.co2e_g);
  if (activity.type !== "text_turn") {
    stats.counts[activity.type] = (stats.counts[activity.type] || 0) + 1;
  }

  const p = activity.provider || "unknown";
  if (!stats.by_provider[p]) stats.by_provider[p] = { kwh: emptyRange(), co2e_g: emptyRange(), counts: emptyCounts() };
  stats.by_provider[p].kwh = mergeRange(stats.by_provider[p].kwh, activity.impact.kwh);
  stats.by_provider[p].co2e_g = mergeRange(stats.by_provider[p].co2e_g, activity.impact.co2e_g);
  if (activity.type !== "text_turn") {
    stats.by_provider[p].counts[activity.type] = (stats.by_provider[p].counts[activity.type] || 0) + 1;
  }

  const m = activity.modality || "unknown";
  if (!stats.by_modality[m]) stats.by_modality[m] = { kwh: emptyRange(), co2e_g: emptyRange(), counts: emptyCounts() };
  stats.by_modality[m].kwh = mergeRange(stats.by_modality[m].kwh, activity.impact.kwh);
  stats.by_modality[m].co2e_g = mergeRange(stats.by_modality[m].co2e_g, activity.impact.co2e_g);
  if (activity.type !== "text_turn") {
    stats.by_modality[m].counts[activity.type] = (stats.by_modality[m].counts[activity.type] || 0) + 1;
  }
}

async function getSettings() {
  const res = await chrome.storage.local.get(["settings"]);
  if (!res.settings) {
    const preset = getDefaultPreset();
    const settings = {
      presetKey: preset.key,
      params: clonePresetParams(preset.params)
    };
    await chrome.storage.local.set({ settings });
    return settings;
  }
  return res.settings;
}

async function getPresetFromSettings() {
  const settings = await getSettings();
  const base = PRESETS[settings.presetKey] || getDefaultPreset();
  return { ...base, params: settings.params || clonePresetParams(base.params) };
}

async function addActivityFinal(activityFinal) {
  const preset = await getPresetFromSettings();
  activityFinal.assumptions_used = {
    presetKey: preset.key,
    params: preset.params
  };
  activityFinal.impact = estimateImpact(activityFinal, preset);

  const store = await chrome.storage.local.get(["activities", "session_stats_by_tab", "day_stats_by_date"]);
  const activities = store.activities || [];
  activities.push(activityFinal);
  while (activities.length > ACTIVITY_CAP) activities.shift();

  const sessionMap = store.session_stats_by_tab || {};
  const tabId = activityFinal.tab_id || "unknown";
  if (!sessionMap[tabId]) sessionMap[tabId] = ensureStatsBase();
  applyActivityToStats(sessionMap[tabId], activityFinal);

  const dayMap = store.day_stats_by_date || {};
  const key = todayKey();
  if (!dayMap[key]) dayMap[key] = ensureStatsBase();
  applyActivityToStats(dayMap[key], activityFinal);

  await chrome.storage.local.set({ activities, session_stats_by_tab: sessionMap, day_stats_by_date: dayMap });

  // push to content scripts in tab
  if (activityFinal.tab_id != null) {
    try {
      chrome.tabs.sendMessage(activityFinal.tab_id, { type: "session_update", session_stats: sessionMap[tabId] });
    } catch (e) {
      log("tabs.sendMessage failed", e);
    }
  }
}

async function recomputeDayAggregate(dateKey) {
  const store = await chrome.storage.local.get(["activities", "day_stats_by_date"]);
  const activities = store.activities || [];
  const dayStats = ensureStatsBase();
  for (const a of activities) {
    const d = new Date(a.ts_start || 0);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (key === dateKey && a.impact) applyActivityToStats(dayStats, a);
  }
  const dayMap = store.day_stats_by_date || {};
  dayMap[dateKey] = dayStats;
  await chrome.storage.local.set({ day_stats_by_date: dayMap });
  return dayStats;
}

function exportCSV(activities) {
  const headers = [
    "id",
    "provider",
    "type",
    "modality",
    "ts_start",
    "ts_end",
    "prompt_chars",
    "prompt_words",
    "response_chars",
    "response_words",
    "page_url",
    "tab_id",
    "session_id",
    "kwh_min",
    "kwh_mid",
    "kwh_max",
    "co2e_g_min",
    "co2e_g_mid",
    "co2e_g_max"
  ];
  const lines = [headers.join(",")];
  for (const a of activities) {
    const row = [
      a.id,
      a.provider,
      a.type,
      a.modality,
      a.ts_start,
      a.ts_end || "",
      a.prompt_chars || 0,
      a.prompt_words || 0,
      a.response_chars || 0,
      a.response_words || 0,
      JSON.stringify(a.page_url || ""),
      a.tab_id || "",
      a.session_id || "",
      a.impact?.kwh?.min || 0,
      a.impact?.kwh?.mid || 0,
      a.impact?.kwh?.max || 0,
      a.impact?.co2e_g?.min || 0,
      a.impact?.co2e_g?.mid || 0,
      a.impact?.co2e_g?.max || 0
    ];
    lines.push(row.join(","));
  }
  return lines.join("\n");
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;
  // SESSION MANAGEMENT PATCH
  const tabId = sender && sender.tab ? sender.tab.id : null;

  if (msg.type === "get_tab_id") {
    sendResponse({ tabId: tabId });
    return true;
  }

  if (msg.type === "activity_partial") {
    if (tabId == null) {
      log("activity_partial without sender.tab (ignored)");
      sendResponse({ ok: false });
      return true;
    }
    const activity = msg.activity || {};
    activity.meta = activity.meta || {};
    const provider = activity.provider || "unknown";
    const sessionId = getOrCreateSessionId(tabId, provider);
    activity.meta.tab_id = tabId;
    activity.meta.session_id = sessionId;
    inMemory.partialByTab[tabId] = activity;
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "activity_final") {
    if (tabId == null) {
      log("activity_final without sender.tab (ignored)");
      sendResponse({ ok: false });
      return true;
    }
    const activity = msg.activity || {};
    activity.meta = activity.meta || {};
    const provider = activity.provider || "unknown";
    const sessionId = getOrCreateSessionId(tabId, provider);
    activity.meta.tab_id = tabId;
    activity.meta.session_id = sessionId;
    activity.tab_id = tabId;
    activity.session_id = sessionId;

    addActivityFinal(activity).then(() => sendResponse({ ok: true })).catch((e) => {
      log("addActivityFinal error", e);
      sendResponse({ ok: false });
    });
    return true;
  }

  if (msg.type === "hud_toggle") {
    const domain = msg.domain;
    const enabled = !!msg.enabled;
    if (msg.tab_only) {
      if (tabId != null) {
        chrome.tabs.sendMessage(tabId, { type: "hud_state", enabled });
      }
      sendResponse({ ok: true });
      return true;
    }
    chrome.storage.local.get(["hud_by_domain"], (res) => {
      const map = res.hud_by_domain || {};
      map[domain] = enabled;
      chrome.storage.local.set({ hud_by_domain: map }, () => {
        if (tabId != null) chrome.tabs.sendMessage(tabId, { type: "hud_state", enabled });
        sendResponse({ ok: true });
      });
    });
    return true;
  }

  if (msg.type === "get_day_stats") {
    const key = msg.dateKey || todayKey();
    recomputeDayAggregate(key).then((stats) => sendResponse({ stats })).catch((_e) => sendResponse({ stats: ensureStatsBase() }));
    return true;
  }

  if (msg.type === "export_json") {
    chrome.storage.local.get(["activities"], (res) => {
      sendResponse({ data: res.activities || [] });
    });
    return true;
  }

  if (msg.type === "export_csv") {
    chrome.storage.local.get(["activities"], (res) => {
      sendResponse({ data: exportCSV(res.activities || []) });
    });
    return true;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  // SESSION MANAGEMENT PATCH
  Object.keys(sessionByTabProvider).forEach((key) => {
    if (key.startsWith(`${tabId}:`)) delete sessionByTabProvider[key];
  });
  chrome.storage.local.get(["session_stats_by_tab"], (res) => {
    const map = res.session_stats_by_tab || {};
    if (map[tabId]) {
      delete map[tabId];
      chrome.storage.local.set({ session_stats_by_tab: map });
    }
  });
});
