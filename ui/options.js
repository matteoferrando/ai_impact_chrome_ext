import { PRESETS, getDefaultPreset, clonePresetParams } from "../estimator/presets.js";
import { getDefaultUXSettings } from "../estimator/model.js";

const $ = (id) => document.getElementById(id);

const PARAMS_SCHEMA = [
  { key: "chars_per_token", label: "Chars per token" },
  { key: "kwh_per_1k_tokens_range", label: "kWh per 1k tokens" },
  { key: "kwh_per_image_range", label: "kWh per image" },
  { key: "kwh_per_video_sec_range", label: "kWh per video sec" },
  { key: "grid_gco2e_per_kwh_range", label: "gCO2e per kWh" }
];

function buildParamGrid(params) {
  const container = $("params");
  container.innerHTML = "";

  const grid = document.createElement("div");
  grid.className = "grid";

  grid.appendChild(cell(""));
  grid.appendChild(head("min"));
  grid.appendChild(head("mid"));
  grid.appendChild(head("max"));

  for (const p of PARAMS_SCHEMA) {
    grid.appendChild(cell(p.label));
    if (typeof params[p.key] === "number") {
      grid.appendChild(inputNumber(`${p.key}`, params[p.key]));
      grid.appendChild(cell(""));
      grid.appendChild(cell(""));
    } else {
      grid.appendChild(inputNumber(`${p.key}.min`, params[p.key].min));
      grid.appendChild(inputNumber(`${p.key}.mid`, params[p.key].mid));
      grid.appendChild(inputNumber(`${p.key}.max`, params[p.key].max));
    }
  }

  container.appendChild(grid);
}

function cell(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div;
}

function head(text) {
  const div = document.createElement("div");
  div.textContent = text;
  div.className = "head";
  return div;
}

function inputNumber(name, value) {
  const input = document.createElement("input");
  input.type = "number";
  input.step = "any";
  input.value = value;
  input.dataset.name = name;
  return input;
}

function readParamsFromForm() {
  const inputs = Array.from(document.querySelectorAll("input[data-name]"));
  const params = {};
  for (const input of inputs) {
    const name = input.dataset.name;
    const value = parseFloat(input.value);
    if (name.includes(".")) {
      const [key, sub] = name.split(".");
      params[key] = params[key] || {};
      params[key][sub] = Number.isFinite(value) ? value : 0;
    } else {
      params[name] = Number.isFinite(value) ? value : 0;
    }
  }
  return params;
}

async function loadSettings() {
  const res = await chrome.storage.local.get(["settings"]);
  if (!res.settings) {
    const preset = getDefaultPreset();
    const settings = {
      presetKey: preset.key,
      params: clonePresetParams(preset.params),
      ux: getDefaultUXSettings()
    };
    await chrome.storage.local.set({ settings });
    return settings;
  }
  const defaults = getDefaultUXSettings();
  if (!res.settings.ux) res.settings.ux = defaults;
  res.settings.ux = {
    equivalences: { ...defaults.equivalences, ...(res.settings.ux.equivalences || {}) },
    ecoScore: { ...defaults.ecoScore, ...(res.settings.ux.ecoScore || {}) },
    badge: { ...defaults.badge, ...(res.settings.ux.badge || {}) }
  };
  return res.settings;
}

async function init() {
  const presetSelect = $("preset-select");
  presetSelect.innerHTML = "";
  Object.values(PRESETS).forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.key;
    opt.textContent = p.label;
    presetSelect.appendChild(opt);
  });

  const settings = await loadSettings();
  const base = PRESETS[settings.presetKey] || getDefaultPreset();
  presetSelect.value = base.key;
  buildParamGrid(settings.params || clonePresetParams(base.params));
  fillUX(settings.ux || getDefaultUXSettings());

  presetSelect.addEventListener("change", () => {
    const preset = PRESETS[presetSelect.value] || getDefaultPreset();
    buildParamGrid(clonePresetParams(preset.params));
  });

  $("save").addEventListener("click", async () => {
    const params = readParamsFromForm();
    const ux = readUXFromForm();
    const settings = { presetKey: presetSelect.value, params, ux };
    await chrome.storage.local.set({ settings });
    alert("Salvato");
  });

  $("reset").addEventListener("click", async () => {
    const preset = PRESETS[presetSelect.value] || getDefaultPreset();
    buildParamGrid(clonePresetParams(preset.params));
    const ux = getDefaultUXSettings();
    fillUX(ux);
    const settings = { presetKey: preset.key, params: clonePresetParams(preset.params), ux };
    await chrome.storage.local.set({ settings });
  });
}

init();

function fillUX(ux) {
  $("wh_per_phone_charge").value = ux.equivalences.wh_per_phone_charge;
  $("gco2_per_km_car").value = ux.equivalences.gco2_per_km_car;
  $("gco2_per_min_streaming").value = ux.equivalences.gco2_per_min_streaming;
  $("target_g_session").value = ux.ecoScore.target_g_session;
  $("target_g_day").value = ux.ecoScore.target_g_day;
  $("badge_light_max_g").value = ux.badge.light_max_g;
  $("badge_work_max_g").value = ux.badge.work_max_g;
  $("badge_creative_max_g").value = ux.badge.creative_max_g;
}

function readUXFromForm() {
  const ux = getDefaultUXSettings();
  ux.equivalences.wh_per_phone_charge = parseFloat($("wh_per_phone_charge").value) || 0;
  ux.equivalences.gco2_per_km_car = parseFloat($("gco2_per_km_car").value) || 0;
  ux.equivalences.gco2_per_min_streaming = parseFloat($("gco2_per_min_streaming").value) || 0;
  ux.ecoScore.target_g_session = parseFloat($("target_g_session").value) || 0;
  ux.ecoScore.target_g_day = parseFloat($("target_g_day").value) || 0;
  ux.badge.light_max_g = parseFloat($("badge_light_max_g").value) || 0;
  ux.badge.work_max_g = parseFloat($("badge_work_max_g").value) || 0;
  ux.badge.creative_max_g = parseFloat($("badge_creative_max_g").value) || 0;
  return ux;
}
