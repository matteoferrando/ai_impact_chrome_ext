import { PRESETS, getDefaultPreset, clonePresetParams, normalizeParams } from "../estimator/presets.js";
import {
  getDefaultUXSettings,
  normalizeUXSettings,
  estimateImpact,
  formatNumber,
  formatCo2
} from "../estimator/model.js";

const $ = (id) => document.getElementById(id);

const PARAMS_SCHEMA = [
  { key: "chars_per_token", label: "Caratteri per token", hint: "~4 per l'inglese, ~3,5–4,5 per l'italiano" },
  { key: "kwh_per_1k_tokens_range", label: "kWh per 1.000 token", hint: "Energia di inferenza per il testo" },
  { key: "kwh_per_image_range", label: "kWh per immagine", hint: "Per ogni immagine generata" },
  { key: "kwh_per_video_sec_range", label: "kWh per secondo di video", hint: "Per secondo di video generato" },
  { key: "grid_gco2e_per_kwh_range", label: "g CO₂e per kWh", hint: "Intensità carbonica della rete" },
  { key: "default_video_sec", label: "Durata video di default (s)", hint: "Se la durata non è leggibile" }
];

const UX_FIELDS = {
  wh_per_phone_charge: ["equivalences", "wh_per_phone_charge"],
  gco2_per_km_car: ["equivalences", "gco2_per_km_car"],
  gco2_per_min_streaming: ["equivalences", "gco2_per_min_streaming"],
  water_ml_per_wh: ["equivalences", "water_ml_per_wh"],
  led_bulb_watts: ["equivalences", "led_bulb_watts"],
  target_g_session: ["ecoScore", "target_g_session"],
  target_g_day: ["ecoScore", "target_g_day"],
  badge_light_max_g: ["badge", "light_max_g"],
  badge_work_max_g: ["badge", "work_max_g"],
  badge_creative_max_g: ["badge", "creative_max_g"]
};

const SAMPLE_TURN = { type: "text_turn", prompt_chars: 300, response_chars: 2000 };

let saved = null; // impostazioni salvate
let presetKey = getDefaultPreset().key;

// ---------- caricamento ----------
async function loadSettings() {
  const res = await chrome.storage.local.get(["settings"]);
  const raw = res.settings || {};
  const key = PRESETS[raw.presetKey] ? raw.presetKey : getDefaultPreset().key;
  return { presetKey: key, params: normalizeParams(raw.params, key), ux: normalizeUXSettings(raw.ux) };
}

// ---------- scenario ----------
function wattHoursPerTurn(params) {
  return estimateImpact(SAMPLE_TURN, { params }).kwh.mid * 1000;
}

function buildPresets() {
  const box = $("presets");
  box.innerHTML = "";
  for (const p of Object.values(PRESETS)) {
    const b = document.createElement("button");
    b.className = "preset";
    b.type = "button";
    b.setAttribute("role", "radio");
    b.dataset.key = p.key;
    b.innerHTML = `<b>${p.label}</b><span>${p.description}</span><em>≈ ${formatNumber(wattHoursPerTurn(p.params))} Wh per turno tipico</em>`;
    b.addEventListener("click", () => {
      presetKey = p.key;
      buildParamGrid(clonePresetParams(p.params));
      syncPresetSelection();
      onChange();
    });
    box.appendChild(b);
  }
}

function syncPresetSelection() {
  document.querySelectorAll(".preset").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.key === presetKey)));
}

// ---------- parametri ----------
function buildParamGrid(params) {
  const box = $("params");
  box.innerHTML = "";
  box.append(cell(""), head("min"), head("mid"), head("max"));
  for (const p of PARAMS_SCHEMA) {
    const label = document.createElement("div");
    label.className = "label";
    label.innerHTML = `<b>${p.label}</b><small>${p.hint}</small>`;
    box.appendChild(label);
    if (typeof params[p.key] === "number") {
      const inp = inputNumber(p.key, params[p.key]);
      inp.classList.add("single");
      box.appendChild(inp);
    } else {
      for (const sub of ["min", "mid", "max"]) box.appendChild(inputNumber(`${p.key}.${sub}`, params[p.key][sub]));
    }
    const err = document.createElement("div");
    err.className = "err hidden";
    err.dataset.err = p.key;
    box.appendChild(err);
  }
}

function cell(text) {
  const d = document.createElement("div");
  d.textContent = text;
  return d;
}

function head(text) {
  const d = cell(text);
  d.className = "h";
  return d;
}

function inputNumber(name, value) {
  const input = document.createElement("input");
  input.type = "number";
  input.step = "any";
  input.min = "0";
  input.value = String(value);
  input.dataset.name = name;
  input.setAttribute("aria-label", name);
  input.addEventListener("input", onChange);
  return input;
}

function readParamsFromForm() {
  const params = {};
  for (const input of document.querySelectorAll("#params input[data-name]")) {
    const v = parseFloat(input.value);
    const val = Number.isFinite(v) ? v : NaN;
    const [key, sub] = input.dataset.name.split(".");
    if (sub) {
      params[key] = params[key] || {};
      params[key][sub] = val;
    } else {
      params[key] = val;
    }
  }
  return params;
}

function validateParams(params) {
  let ok = true;
  for (const p of PARAMS_SCHEMA) {
    const v = params[p.key];
    let msg = "";
    if (typeof v === "number") {
      if (!Number.isFinite(v) || v < 0) msg = "Inserisci un numero ≥ 0.";
      else if (p.key === "chars_per_token" && v === 0) msg = "Deve essere maggiore di 0.";
    } else if (v) {
      if (![v.min, v.mid, v.max].every((x) => Number.isFinite(x) && x >= 0)) msg = "Inserisci numeri ≥ 0.";
      else if (!(v.min <= v.mid && v.mid <= v.max)) msg = "Deve valere min ≤ mid ≤ max.";
    }
    const err = document.querySelector(`[data-err='${p.key}']`);
    err.textContent = msg;
    err.classList.toggle("hidden", !msg);
    document.querySelectorAll(`#params input[data-name^='${p.key}']`).forEach((i) => i.classList.toggle("invalid", !!msg));
    if (msg) ok = false;
  }
  return ok;
}

// ---------- metriche UX ----------
function fillUX(ux) {
  for (const [id, [group, key]] of Object.entries(UX_FIELDS)) $(id).value = String(ux[group][key]);
}

function readUXFromForm() {
  const ux = getDefaultUXSettings();
  for (const [id, [group, key]] of Object.entries(UX_FIELDS)) {
    const v = parseFloat($(id).value);
    ux[group][key] = Number.isFinite(v) && v >= 0 ? v : ux[group][key];
  }
  return ux;
}

// ---------- stato / anteprima ----------
function currentSettings() {
  return { presetKey, params: readParamsFromForm(), ux: readUXFromForm() };
}

function isDirty() {
  return JSON.stringify(currentSettings()) !== JSON.stringify(saved);
}

function updatePreview(settings) {
  const params = normalizeParams(settings.params, settings.presetKey);
  const turn = estimateImpact(SAMPLE_TURN, { params });
  const img = estimateImpact({ type: "image_gen", meta: { count: 1 } }, { params });
  $("pv-wh").textContent = formatNumber(turn.kwh.mid * 1000);
  $("pv-g").textContent = formatNumber(turn.co2e_g.mid);
  $("pv-ml").textContent = formatNumber(turn.kwh.mid * 1000 * settings.ux.equivalences.water_ml_per_wh);
  $("pv-img").textContent = formatNumber(img.kwh.mid * 1000);
}

function onChange() {
  const s = currentSettings();
  const valid = validateParams(s.params);
  updatePreview(s);
  const bar = $("savebar");
  const dirty = isDirty();
  bar.classList.toggle("show", dirty || !valid);
  bar.classList.toggle("error", !valid);
  $("savebar-msg").textContent = valid ? "Modifiche non salvate" : "Correggi i valori evidenziati";
  $("save").disabled = !valid;
}

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("show"), 2000);
}

function applySettingsToForm(settings) {
  presetKey = settings.presetKey;
  syncPresetSelection();
  buildParamGrid(settings.params);
  fillUX(settings.ux);
  onChange();
}

// ---------- dati ----------
async function refreshDataStats() {
  const res = await chrome.storage.local.get(["activities", "day_stats_by_date", "totals"]);
  $("d-activities").textContent = String((res.activities || []).length);
  $("d-days").textContent = String(Object.keys(res.day_stats_by_date || {}).length);
  const total = formatCo2(res.totals && res.totals.co2e_g ? res.totals.co2e_g.mid : 0);
  $("d-total").textContent = total.value;
  $("d-total-u").textContent = `${total.unit} totali`;
  try {
    const bytes = await chrome.storage.local.getBytesInUse(null);
    $("d-bytes").textContent = bytes > 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
  } catch (_e) {
    $("d-bytes").textContent = "--";
  }
}

function download(content, type, ext) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ai-impact-meter-${new Date().toISOString().slice(0, 10)}.${ext}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function confirmButton(btn, action) {
  const original = btn.textContent;
  let armed = false;
  let timer = null;
  btn.addEventListener("click", async () => {
    if (!armed) {
      armed = true;
      btn.classList.add("confirm");
      btn.textContent = "Clicca di nuovo per confermare";
      timer = setTimeout(() => {
        armed = false;
        btn.classList.remove("confirm");
        btn.textContent = original;
      }, 3500);
      return;
    }
    clearTimeout(timer);
    armed = false;
    btn.classList.remove("confirm");
    btn.textContent = original;
    await action();
  });
}

// ---------- init ----------
async function init() {
  buildPresets();
  saved = await loadSettings();
  applySettingsToForm(saved);
  for (const id of Object.keys(UX_FIELDS)) $(id).addEventListener("input", onChange);

  $("save").addEventListener("click", async () => {
    const s = currentSettings();
    if (!validateParams(s.params)) return;
    s.params = normalizeParams(s.params, s.presetKey);
    await chrome.storage.local.set({ settings: s });
    saved = s;
    onChange();
    toast("Impostazioni salvate ✓");
  });

  $("discard").addEventListener("click", () => applySettingsToForm(saved));

  $("reset").addEventListener("click", () => {
    const preset = getDefaultPreset();
    applySettingsToForm({ presetKey: preset.key, params: clonePresetParams(preset.params), ux: getDefaultUXSettings() });
  });

  $("export-json").addEventListener("click", async () => {
    const res = await chrome.runtime.sendMessage({ type: "export_json" });
    download(JSON.stringify((res && res.data) || [], null, 2), "application/json", "json");
  });
  $("export-csv").addEventListener("click", async () => {
    const res = await chrome.runtime.sendMessage({ type: "export_csv" });
    download((res && res.data) || "", "text/csv", "csv");
  });
  confirmButton($("reset-today"), async () => {
    await chrome.runtime.sendMessage({ type: "reset_data", scope: "today" });
    toast("Dati di oggi cancellati");
  });
  confirmButton($("reset-all"), async () => {
    await chrome.runtime.sendMessage({ type: "reset_data", scope: "all" });
    toast("Tutti i dati cancellati");
  });

  window.addEventListener("beforeunload", (e) => {
    if (isDirty()) e.preventDefault();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.activities || changes.totals || changes.day_stats_by_date) refreshDataStats();
  });
  refreshDataStats();
}

init();
