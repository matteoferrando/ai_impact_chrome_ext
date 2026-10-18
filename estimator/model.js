// Modello di stima condiviso da service worker, popup, options e HUD.
// Nessuna dipendenza: deve poter essere importato anche come web accessible resource.

const ZERO_RANGE = () => ({ min: 0, mid: 0, max: 0 });

function num(v, fallback = 0) {
  return Number.isFinite(v) ? v : fallback;
}

export function estimateTokens(chars, charsPerToken) {
  if (!charsPerToken || charsPerToken <= 0) return 0;
  return Math.ceil(num(chars) / charsPerToken);
}

export function activityTokens(activity, params) {
  if (!activity || activity.type !== "text_turn") return 0;
  const chars = num(activity.prompt_chars) + num(activity.response_chars);
  return estimateTokens(chars, params && params.chars_per_token);
}

export function videoSeconds(activity, params) {
  const meta = (activity && activity.meta) || {};
  const secs = num(meta.duration_sec);
  if (secs > 0) return secs;
  const count = Math.max(1, num(meta.count, 1));
  return count * num(params && params.default_video_sec, 8);
}

export function estimateImpact(activity, preset) {
  const p = preset && preset.params ? preset.params : preset;
  if (!p || !activity) {
    return { kwh: ZERO_RANGE(), co2e_g: ZERO_RANGE(), tokens: 0, video_sec: 0 };
  }

  const rangeFromBase = (base, range) => ({
    min: base * num(range && range.min),
    mid: base * num(range && range.mid),
    max: base * num(range && range.max)
  });

  let kwh = ZERO_RANGE();
  let tokens = 0;
  let video_sec = 0;

  if (activity.type === "text_turn") {
    tokens = activityTokens(activity, p);
    kwh = rangeFromBase(tokens / 1000, p.kwh_per_1k_tokens_range);
  } else if (activity.type === "image_gen") {
    const count = Math.max(0, num(activity.meta && activity.meta.count));
    kwh = rangeFromBase(count, p.kwh_per_image_range);
  } else if (activity.type === "video_gen") {
    video_sec = videoSeconds(activity, p);
    kwh = rangeFromBase(video_sec, p.kwh_per_video_sec_range);
  }

  const grid = p.grid_gco2e_per_kwh_range || {};
  const co2e_g = {
    min: kwh.min * num(grid.min),
    mid: kwh.mid * num(grid.mid),
    max: kwh.max * num(grid.max)
  };

  return { kwh, co2e_g, tokens, video_sec };
}

export function getDefaultUXSettings() {
  return {
    equivalences: {
      wh_per_phone_charge: 12,
      gco2_per_km_car: 171,
      gco2_per_min_streaming: 6,
      water_ml_per_wh: 1.1,
      led_bulb_watts: 10
    },
    ecoScore: {
      target_g_session: 10,
      target_g_day: 50
    },
    badge: {
      light_max_g: 5,
      work_max_g: 20,
      creative_max_g: 35
    }
  };
}

export function normalizeUXSettings(ux) {
  const d = getDefaultUXSettings();
  const src = ux || {};
  const merge = (def, val) => {
    const out = { ...def };
    for (const k of Object.keys(def)) {
      if (val && Number.isFinite(val[k]) && val[k] >= 0) out[k] = val[k];
    }
    return out;
  };
  return {
    equivalences: merge(d.equivalences, src.equivalences),
    ecoScore: merge(d.ecoScore, src.ecoScore),
    badge: merge(d.badge, src.badge)
  };
}

export function deriveEquivalents({ kwh_mid, co2e_mid_g }, uxFactors) {
  const eq = normalizeUXSettings(uxFactors).equivalences;
  const wh = num(kwh_mid) * 1000;
  const g = num(co2e_mid_g);
  return {
    phone_charges: eq.wh_per_phone_charge > 0 ? wh / eq.wh_per_phone_charge : 0,
    car_meters: eq.gco2_per_km_car > 0 ? (g / eq.gco2_per_km_car) * 1000 : 0,
    streaming_minutes: eq.gco2_per_min_streaming > 0 ? g / eq.gco2_per_min_streaming : 0,
    water_ml: wh * eq.water_ml_per_wh,
    led_minutes: eq.led_bulb_watts > 0 ? (wh / eq.led_bulb_watts) * 60 : 0
  };
}

export function scoreFromCo2e(co2e_mid_g, target_g) {
  if (!target_g || target_g <= 0) return 100;
  const ratio = num(co2e_mid_g) / target_g;
  const score = Math.round(100 - ratio * 100);
  return Math.max(0, Math.min(100, score));
}

export function topDriver(modality_breakdown_co2e_mid) {
  const entries = Object.entries(modality_breakdown_co2e_mid || {}).map(([k, v]) => [k, num(v)]);
  const total = entries.reduce((a, [, v]) => a + v, 0);
  if (!entries.length || total <= 0) return { modality: "unknown", pct: 0 };
  entries.sort((a, b) => b[1] - a[1]);
  const [modality, value] = entries[0];
  return { modality, pct: Math.round((value / total) * 100) };
}

export const BADGES = {
  light: { key: "light", label: "Light", emoji: "🟢", level: 1, color: "#22c55e" },
  work: { key: "work", label: "Work", emoji: "🟡", level: 2, color: "#eab308" },
  creative: { key: "creative", label: "Creative", emoji: "🟠", level: 3, color: "#f97316" },
  intense: { key: "intense", label: "Intense", emoji: "🟠", level: 3, color: "#f97316" },
  heavy: { key: "heavy", label: "Heavy", emoji: "🔴", level: 4, color: "#ef4444" }
};

export function badgeFromStats({ co2e_mid_g, modality_breakdown_counts }, uxSettings) {
  const cfg = normalizeUXSettings(uxSettings).badge;
  const counts = modality_breakdown_counts || {};
  const g = num(co2e_mid_g);
  if (num(counts.video_gen) > 0 || g > cfg.creative_max_g) return { ...BADGES.heavy };
  if (num(counts.image_gen) > 0) return { ...BADGES.creative };
  if (g <= cfg.light_max_g) return { ...BADGES.light };
  if (g <= cfg.work_max_g) return { ...BADGES.work };
  return { ...BADGES.intense };
}

export function scoreColor(score) {
  if (score >= 75) return "#22c55e";
  if (score >= 50) return "#eab308";
  if (score >= 25) return "#f97316";
  return "#ef4444";
}

export function deriveUXFromAggregate(aggregate, settings) {
  const ux = normalizeUXSettings(settings && settings.ux ? settings.ux : settings);
  if (!aggregate) {
    return {
      equivalents: deriveEquivalents({ kwh_mid: 0, co2e_mid_g: 0 }, ux),
      ecoScore: 100,
      badge: { ...BADGES.light },
      topDriver: { modality: "unknown", pct: 0 },
      empty: true
    };
  }

  const co2e_mid_g = num(aggregate.co2e_g && aggregate.co2e_g.mid);
  const kwh_mid = num(aggregate.kwh && aggregate.kwh.mid);
  const equivalents = deriveEquivalents({ kwh_mid, co2e_mid_g }, ux);

  let target = ux.ecoScore.target_g_session;
  if (aggregate.scope === "day") target = ux.ecoScore.target_g_day;
  if (aggregate.scope === "week") target = ux.ecoScore.target_g_day * 7;
  const ecoScore = aggregate.scope === "total" ? null : scoreFromCo2e(co2e_mid_g, target);

  const modalityMid = {};
  for (const [k, v] of Object.entries(aggregate.by_modality || {})) {
    modalityMid[k] = num(v && v.co2e_g && v.co2e_g.mid);
  }
  const badge = badgeFromStats({ co2e_mid_g, modality_breakdown_counts: aggregate.counts || {} }, ux);

  return { equivalents, ecoScore, badge, topDriver: topDriver(modalityMid), empty: false };
}

// ---------- statistiche aggregate ----------

export function emptyRange() {
  return ZERO_RANGE();
}

export function emptyStats() {
  return {
    kwh: ZERO_RANGE(),
    co2e_g: ZERO_RANGE(),
    counts: { text_turn: 0, image_gen: 0, video_gen: 0 },
    tokens: 0,
    images: 0,
    video_sec: 0,
    by_provider: {},
    by_modality: {},
    first_ts: null,
    last_ts: null
  };
}

function addRange(a, b) {
  return {
    min: num(a && a.min) + num(b && b.min),
    mid: num(a && a.mid) + num(b && b.mid),
    max: num(a && a.max) + num(b && b.max)
  };
}

function bucket() {
  return { kwh: ZERO_RANGE(), co2e_g: ZERO_RANGE(), counts: { text_turn: 0, image_gen: 0, video_gen: 0 } };
}

export function applyActivityToStats(stats, activity) {
  const impact = activity.impact || {};
  const type = activity.type || "text_turn";
  stats.counts = { text_turn: 0, image_gen: 0, video_gen: 0, ...(stats.counts || {}) };
  stats.kwh = addRange(stats.kwh, impact.kwh);
  stats.co2e_g = addRange(stats.co2e_g, impact.co2e_g);
  stats.counts[type] = num(stats.counts[type]) + 1;
  stats.tokens = num(stats.tokens) + num(impact.tokens);
  if (type === "image_gen") stats.images = num(stats.images) + num(activity.meta && activity.meta.count);
  if (type === "video_gen") stats.video_sec = num(stats.video_sec) + num(impact.video_sec);
  const ts = num(activity.ts_end || activity.ts_start, Date.now());
  stats.first_ts = stats.first_ts ? Math.min(stats.first_ts, ts) : ts;
  stats.last_ts = stats.last_ts ? Math.max(stats.last_ts, ts) : ts;

  for (const [field, key] of [["by_provider", activity.provider || "unknown"], ["by_modality", activity.modality || "unknown"]]) {
    stats[field] = stats[field] || {};
    const b = stats[field][key] || bucket();
    b.counts = { text_turn: 0, image_gen: 0, video_gen: 0, ...(b.counts || {}) };
    b.kwh = addRange(b.kwh, impact.kwh);
    b.co2e_g = addRange(b.co2e_g, impact.co2e_g);
    b.counts[type] = num(b.counts[type]) + 1;
    stats[field][key] = b;
  }
  return stats;
}

export function mergeStats(list) {
  const out = emptyStats();
  for (const s of list) {
    if (!s) continue;
    out.kwh = addRange(out.kwh, s.kwh);
    out.co2e_g = addRange(out.co2e_g, s.co2e_g);
    for (const k of Object.keys(out.counts)) out.counts[k] += num(s.counts && s.counts[k]);
    out.tokens += num(s.tokens);
    out.images += num(s.images);
    out.video_sec += num(s.video_sec);
    if (s.first_ts) out.first_ts = out.first_ts ? Math.min(out.first_ts, s.first_ts) : s.first_ts;
    if (s.last_ts) out.last_ts = out.last_ts ? Math.max(out.last_ts, s.last_ts) : s.last_ts;
    for (const field of ["by_provider", "by_modality"]) {
      for (const [k, v] of Object.entries(s[field] || {})) {
        const b = out[field][k] || bucket();
        b.kwh = addRange(b.kwh, v.kwh);
        b.co2e_g = addRange(b.co2e_g, v.co2e_g);
        for (const c of Object.keys(b.counts)) b.counts[c] += num(v.counts && v.counts[c]);
        out[field][k] = b;
      }
    }
  }
  return out;
}

export function dateKey(ts = Date.now()) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function lastNDateKeys(n, ts = Date.now()) {
  const keys = [];
  const d = new Date(ts);
  d.setHours(12, 0, 0, 0);
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(d);
    x.setDate(d.getDate() - i);
    keys.push(dateKey(x.getTime()));
  }
  return keys;
}

// ---------- formattazione ----------

function trimZeros(s) {
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}

export function formatNumber(v, maxDigits = 2) {
  const n = num(v);
  if (n === 0) return "0";
  const abs = Math.abs(n);
  let digits = maxDigits;
  if (abs >= 100) digits = 0;
  else if (abs >= 10) digits = Math.min(1, maxDigits);
  else if (abs < 0.01) digits = Math.max(maxDigits, 3);
  if (abs < 0.001) return "<0.001";
  return trimZeros(n.toFixed(digits)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

export function formatCo2(g) {
  const n = num(g);
  if (n >= 1000) return { value: formatNumber(n / 1000, 2), unit: "kg CO₂e" };
  return { value: formatNumber(n, 2), unit: "g CO₂e" };
}

export function formatEnergy(kwh) {
  const n = num(kwh);
  if (n >= 1) return { value: formatNumber(n, 2), unit: "kWh" };
  return { value: formatNumber(n * 1000, 2), unit: "Wh" };
}

export function formatWater(ml) {
  const n = num(ml);
  if (n >= 1000) return { value: formatNumber(n / 1000, 2), unit: "L" };
  return { value: formatNumber(n, 1), unit: "mL" };
}

export function formatDistance(m) {
  const n = num(m);
  if (n >= 1000) return { value: formatNumber(n / 1000, 2), unit: "km" };
  return { value: formatNumber(n, 1), unit: "m" };
}

export function formatCompact(n) {
  const v = num(n);
  if (v >= 1e6) return `${trimZeros((v / 1e6).toFixed(1))}M`;
  if (v >= 1e3) return `${trimZeros((v / 1e3).toFixed(1))}k`;
  return String(Math.round(v));
}

export const PROVIDERS = {
  chatgpt: { label: "ChatGPT", color: "#10a37f", url: "https://chatgpt.com/" },
  claude: { label: "Claude", color: "#d97757", url: "https://claude.ai/" },
  gemini: { label: "Gemini", color: "#4285f4", url: "https://gemini.google.com/" }
};

export function providerLabel(key) {
  return (PROVIDERS[key] && PROVIDERS[key].label) || key || "unknown";
}

export function modalityLabel(modality) {
  if (modality === "text") return "Testo";
  if (modality === "image") return "Immagini";
  if (modality === "video") return "Video";
  return modality || "--";
}

export function providerFromHost(host) {
  const h = host || "";
  if (h === "chat.openai.com" || h === "chatgpt.com" || h.endsWith(".chatgpt.com")) return "chatgpt";
  if (h === "gemini.google.com") return "gemini";
  if (h === "claude.ai" || h.endsWith(".claude.ai")) return "claude";
  return null;
}
