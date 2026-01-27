export function estimateImpact(activity, preset) {
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

export function getDefaultUXSettings() {
  return {
    equivalences: {
      wh_per_phone_charge: 12,
      gco2_per_km_car: 171,
      gco2_per_min_streaming: 6
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

export function deriveEquivalents({ kwh_mid, co2e_mid_g }, uxFactors) {
  const eq = (uxFactors && uxFactors.equivalences) ? uxFactors.equivalences : getDefaultUXSettings().equivalences;
  const phone = eq.wh_per_phone_charge > 0 ? (kwh_mid * 1000) / eq.wh_per_phone_charge : 0;
  const car = eq.gco2_per_km_car > 0 ? (co2e_mid_g / eq.gco2_per_km_car) * 1000 : 0;
  const streaming = eq.gco2_per_min_streaming > 0 ? co2e_mid_g / eq.gco2_per_min_streaming : 0;
  return {
    phone_charges: phone,
    car_meters: car,
    streaming_minutes: streaming
  };
}

export function scoreFromCo2e(co2e_mid_g, target_g) {
  if (!target_g || target_g <= 0) return 0;
  const ratio = co2e_mid_g / target_g;
  const score = Math.round(100 - ratio * 100);
  return Math.max(0, Math.min(100, score));
}

export function topDriver(modality_breakdown_co2e_mid) {
  const entries = Object.entries(modality_breakdown_co2e_mid || {}).map(([k, v]) => [k, v || 0]);
  if (!entries.length) return { modality: "unknown", pct: 0 };
  const total = entries.reduce((a, [, v]) => a + v, 0) || 0;
  if (total <= 0) return { modality: "unknown", pct: 0 };
  entries.sort((a, b) => b[1] - a[1]);
  const [modality, value] = entries[0];
  const pct = Math.round((value / total) * 100);
  return { modality, pct };
}

export function badgeFromStats({ co2e_mid_g, modality_breakdown_counts }, uxSettings) {
  const badgeCfg = (uxSettings && uxSettings.badge) ? uxSettings.badge : getDefaultUXSettings().badge;
  const counts = modality_breakdown_counts || {};
  const imageCount = counts.image_gen || 0;
  const videoCount = counts.video_gen || 0;

  if (videoCount > 0 || co2e_mid_g > badgeCfg.creative_max_g) {
    return { label: "Heavy", emoji: "\uD83D\uDD34", level: 4 };
  }
  if (imageCount > 0) {
    return { label: "Creative", emoji: "\uD83D\uDFE0", level: 3 };
  }
  if (co2e_mid_g <= badgeCfg.light_max_g) {
    return { label: "Light", emoji: "\uD83D\uDFE2", level: 1 };
  }
  if (co2e_mid_g <= badgeCfg.work_max_g) {
    return { label: "Work", emoji: "\uD83D\uDFE1", level: 2 };
  }
  return { label: "Work", emoji: "\uD83D\uDFE1", level: 2 };
}

export function deriveUXFromAggregate(aggregate, settings) {
  if (!aggregate) {
    return {
      equivalents: { phone_charges: 0, car_meters: 0, streaming_minutes: 0 },
      ecoScore: 0,
      badge: { label: "Light", emoji: "\uD83D\uDFE2", level: 1 },
      topDriver: { modality: "unknown", pct: 0 }
    };
  }

  const ux = (settings && settings.ux) ? settings.ux : (settings || getDefaultUXSettings());
  const co2e_mid_g = (aggregate && aggregate.co2e_g && aggregate.co2e_g.mid) ? aggregate.co2e_g.mid : 0;
  const kwh_mid = (aggregate && aggregate.kwh && aggregate.kwh.mid) ? aggregate.kwh.mid : 0;
  const equivalents = deriveEquivalents({ kwh_mid, co2e_mid_g }, ux);

  const target = (aggregate && aggregate.scope === "day")
    ? (ux.ecoScore ? ux.ecoScore.target_g_day : 0)
    : (ux.ecoScore ? ux.ecoScore.target_g_session : 0);
  const ecoScore = scoreFromCo2e(co2e_mid_g, target || 1);

  const modalityCounts = (aggregate && aggregate.counts) ? aggregate.counts : {};
  const modalityBreakdown = (aggregate && aggregate.by_modality) ? aggregate.by_modality : {};
  const modalityMid = {};
  for (const [k, v] of Object.entries(modalityBreakdown)) {
    modalityMid[k] = (v && v.co2e_g && v.co2e_g.mid) ? v.co2e_g.mid : 0;
  }
  const badge = badgeFromStats({ co2e_mid_g, modality_breakdown_counts: modalityCounts }, ux);
  const top = topDriver(modalityMid);

  return { equivalents, ecoScore, badge, topDriver: top };
}
