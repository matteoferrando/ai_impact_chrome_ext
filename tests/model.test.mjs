import { test } from "node:test";
import assert from "node:assert/strict";
import {
  estimateImpact,
  applyActivityToStats,
  emptyStats,
  mergeStats,
  deriveUXFromAggregate,
  scoreFromCo2e,
  badgeFromStats,
  formatCo2,
  formatEnergy,
  formatNumber,
  lastNDateKeys,
  providerFromHost,
  normalizeUXSettings
} from "../estimator/model.js";
import { PRESETS, normalizeParams } from "../estimator/presets.js";

const typical = PRESETS.typical;

test("text turn: token stimati da caratteri e range coerenti", () => {
  const r = estimateImpact({ type: "text_turn", prompt_chars: 400, response_chars: 3600 }, typical);
  assert.equal(r.tokens, 1000);
  assert.ok(Math.abs(r.kwh.mid - 0.001) < 1e-12);
  assert.ok(Math.abs(r.co2e_g.mid - 0.4) < 1e-9);
  assert.ok(r.kwh.min <= r.kwh.mid && r.kwh.mid <= r.kwh.max);
  assert.ok(r.co2e_g.min <= r.co2e_g.mid && r.co2e_g.mid <= r.co2e_g.max);
});

test("immagini e video (con durata di default)", () => {
  const img = estimateImpact({ type: "image_gen", meta: { count: 2 } }, typical);
  assert.ok(Math.abs(img.kwh.mid - 0.0012) < 1e-12);
  const vid = estimateImpact({ type: "video_gen", meta: { count: 1, duration_sec: null } }, typical);
  assert.equal(vid.video_sec, 8);
  const vid2 = estimateImpact({ type: "video_gen", meta: { count: 1, duration_sec: 5 } }, typical);
  assert.equal(vid2.video_sec, 5);
});

test("input non validi non producono NaN", () => {
  const r = estimateImpact({ type: "text_turn", prompt_chars: "abc" }, { params: {} });
  assert.equal(r.kwh.mid, 0);
  assert.equal(estimateImpact(null, typical).co2e_g.mid, 0);
});

test("aggregazione statistiche e merge", () => {
  const s = emptyStats();
  const a = { type: "text_turn", provider: "chatgpt", modality: "text", prompt_chars: 40, response_chars: 360, ts_end: 1 };
  a.impact = estimateImpact(a, typical);
  const b = { type: "image_gen", provider: "gemini", modality: "image", meta: { count: 3 }, ts_end: 2 };
  b.impact = estimateImpact(b, typical);
  applyActivityToStats(s, a);
  applyActivityToStats(s, b);
  assert.equal(s.counts.text_turn, 1);
  assert.equal(s.counts.image_gen, 1);
  assert.equal(s.images, 3);
  assert.equal(s.tokens, 100);
  assert.deepEqual(Object.keys(s.by_provider).sort(), ["chatgpt", "gemini"]);
  const m = mergeStats([s, s]);
  assert.equal(m.counts.text_turn, 2);
  assert.ok(Math.abs(m.co2e_g.mid - 2 * s.co2e_g.mid) < 1e-12);
  assert.equal(m.first_ts, 1);
  assert.equal(m.last_ts, 2);
});

test("eco-score, badge e stato vuoto", () => {
  assert.equal(scoreFromCo2e(0, 10), 100);
  assert.equal(scoreFromCo2e(5, 10), 50);
  assert.equal(scoreFromCo2e(50, 10), 0);
  assert.equal(deriveUXFromAggregate(null, {}).ecoScore, 100);
  assert.equal(badgeFromStats({ co2e_mid_g: 1 }, {}).label, "Light");
  assert.equal(badgeFromStats({ co2e_mid_g: 10 }, {}).label, "Work");
  assert.equal(badgeFromStats({ co2e_mid_g: 25 }, {}).label, "Intense");
  assert.equal(badgeFromStats({ co2e_mid_g: 1, modality_breakdown_counts: { image_gen: 1 } }, {}).label, "Creative");
  assert.equal(badgeFromStats({ co2e_mid_g: 1, modality_breakdown_counts: { video_gen: 1 } }, {}).label, "Heavy");
  const total = deriveUXFromAggregate({ ...emptyStats(), scope: "total" }, {});
  assert.equal(total.ecoScore, null);
});

test("normalizzazione impostazioni legacy", () => {
  const legacy = { chars_per_token: 5, kwh_per_1k_tokens_range: { min: 1, mid: 2, max: 3 } };
  const p = normalizeParams(legacy, "typical");
  assert.equal(p.chars_per_token, 5);
  assert.equal(p.default_video_sec, 8);
  assert.deepEqual(p.grid_gco2e_per_kwh_range, PRESETS.typical.params.grid_gco2e_per_kwh_range);
  const ux = normalizeUXSettings({ equivalences: { wh_per_phone_charge: 15 } });
  assert.equal(ux.equivalences.wh_per_phone_charge, 15);
  assert.equal(ux.equivalences.water_ml_per_wh, 1.1);
});

test("formattazione", () => {
  assert.deepEqual(formatCo2(0.4), { value: "0.4", unit: "g CO₂e" });
  assert.deepEqual(formatCo2(1500), { value: "1.5", unit: "kg CO₂e" });
  assert.deepEqual(formatEnergy(0.0005), { value: "0.5", unit: "Wh" });
  assert.equal(formatNumber(0), "0");
  assert.equal(formatNumber(0.0001), "<0.001");
  assert.equal(lastNDateKeys(7).length, 7);
});

test("riconoscimento provider da host", () => {
  assert.equal(providerFromHost("chatgpt.com"), "chatgpt");
  assert.equal(providerFromHost("chat.openai.com"), "chatgpt");
  assert.equal(providerFromHost("claude.ai"), "claude");
  assert.equal(providerFromHost("gemini.google.com"), "gemini");
  assert.equal(providerFromHost("evilchatgpt.com"), null);
  assert.equal(providerFromHost(null), null);
});
