export const PRESETS = {
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

export function getDefaultPreset() {
  return PRESETS.typical;
}

export function clonePresetParams(params) {
  return JSON.parse(JSON.stringify(params));
}
