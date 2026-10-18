// Scenari di stima. Tutti i valori sono assunzioni configurabili (range min/mid/max).
// Riferimenti indicativi (vedi Options > Metodologia):
// - Google (2025): prompt testuale mediano Gemini ≈ 0.24 Wh
// - OpenAI / S. Altman (2025): query media ChatGPT ≈ 0.34 Wh
// - Epoch AI (2025): query tipica GPT-4o ≈ 0.3 Wh
// - Luccioni et al. (2023): generazione immagini ≈ 0.5–3 Wh per immagine
export const PRESETS = {
  conservative: {
    key: "conservative",
    label: "Conservative",
    description: "Data center efficienti e rete a bassa intensità di carbonio.",
    params: {
      chars_per_token: 4.5,
      kwh_per_1k_tokens_range: { min: 0.0002, mid: 0.0005, max: 0.001 },
      kwh_per_image_range: { min: 0.0001, mid: 0.0003, max: 0.0006 },
      kwh_per_video_sec_range: { min: 0.00002, mid: 0.00008, max: 0.0002 },
      grid_gco2e_per_kwh_range: { min: 150, mid: 300, max: 500 },
      default_video_sec: 8
    }
  },
  typical: {
    key: "typical",
    label: "Typical",
    description: "Stima centrale basata sulla letteratura pubblica più recente.",
    params: {
      chars_per_token: 4,
      kwh_per_1k_tokens_range: { min: 0.0005, mid: 0.001, max: 0.002 },
      kwh_per_image_range: { min: 0.0002, mid: 0.0006, max: 0.001 },
      kwh_per_video_sec_range: { min: 0.00005, mid: 0.0002, max: 0.0006 },
      grid_gco2e_per_kwh_range: { min: 200, mid: 400, max: 700 },
      default_video_sec: 8
    }
  },
  aggressive: {
    key: "aggressive",
    label: "Aggressive",
    description: "Modelli grandi con ragionamento esteso e rete fossile.",
    params: {
      chars_per_token: 3.5,
      kwh_per_1k_tokens_range: { min: 0.001, mid: 0.0025, max: 0.005 },
      kwh_per_image_range: { min: 0.0005, mid: 0.0012, max: 0.0025 },
      kwh_per_video_sec_range: { min: 0.0001, mid: 0.0004, max: 0.0012 },
      grid_gco2e_per_kwh_range: { min: 300, mid: 600, max: 900 },
      default_video_sec: 8
    }
  }
};

export function getDefaultPreset() {
  return PRESETS.typical;
}

export function clonePresetParams(params) {
  return JSON.parse(JSON.stringify(params));
}

// Completa parametri salvati da versioni precedenti con i default del preset.
export function normalizeParams(params, presetKey) {
  const base = (PRESETS[presetKey] || getDefaultPreset()).params;
  const out = clonePresetParams(base);
  if (!params || typeof params !== "object") return out;
  for (const [k, v] of Object.entries(base)) {
    const src = params[k];
    if (typeof v === "number") {
      if (Number.isFinite(src) && src >= 0) out[k] = src;
    } else if (src && typeof src === "object") {
      for (const sub of ["min", "mid", "max"]) {
        if (Number.isFinite(src[sub]) && src[sub] >= 0) out[k][sub] = src[sub];
      }
    }
  }
  return out;
}
