/**
 * ONETO EUR/USD AI Tool — PositioningAnalyst Agent
 * ==================================================
 * AI Committee Agent 3 (weight: 20% default, regime-adjusted).
 *
 * Analyses institutional positioning in EUR/USD futures to identify
 * trend following, extreme crowded positions, and contrarian signals.
 * Phase 1–5: rule-based model with CFTC COT data stubs.
 * Phase 6+:  reads real data from COTService + COTMemory.
 *
 * Four scoring components:
 *   1. COT net direction  — trend follow vs contrarian    (max ±30)
 *   2. Extreme positioning — crowded trade = contrarian   (max ±25)
 *   3. DXY correlation    — USD index trend confirmation  (max ±20)
 *   4. Yield spread context — carry trade flows           (max ±15)
 *   Confidence dampener:   small position changes → low conviction
 *
 * Contrarian logic (critical feature):
 *   z_score_52w > +2.0  → extreme longs = SELL signal (contrarian)
 *   z_score_52w < -2.0  → extreme shorts = BUY signal (contrarian)
 *   1.5 < |z| < 2.0     → moderate extreme, follow with caution
 *
 * Score convention: 0–100. Higher = more bearish EUR/USD.
 *
 * COT data lag: 3 days (Tuesday published Friday 3:30 PM EST).
 * This is handled by conservative confidence scoring.
 *
 * Entry point:  PositioningAnalyst.run(params)
 * Never throws. Returns neutral fallback on error.
 *
 * Architecture Freeze V4.0-R1 | Phase 4A
 */

'use strict';

import {
  AGENT,
  createVote,
  createFallbackVote,
  scoreToVote,
  DEFAULT_WEIGHTS,
} from '../types/Vote.js';

// ─────────────────────────────────────────────
// DEFAULT MEMORY LAYER (Phase 1–5 stubs)
// ─────────────────────────────────────────────

const DEFAULT_MEMORY = Object.freeze({
  // CFTC COT — Non-commercial (speculative) net EUR futures position
  cot_net_position:    0,      // absolute contracts long minus short
  cot_change_weekly:   0,      // week-over-week change in net position
  cot_change_4week:    0,      // 4-week cumulative change
  cot_z_score_52w:     0,      // z-score vs 52-week mean (st. deviations)
  cot_z_score_26w:     0,      // z-score vs 26-week mean
  cot_signal:       'neutral', // 'bullish_eur'|'bearish_eur'|'neutral'|'contrarian_long'|'contrarian_short'
  cot_extreme:         false,  // true if |z_score_52w| > 2.0
  cot_trend_3w:     'flat',    // 'increasing'|'decreasing'|'flat'
  // DXY trend context
  dxy_trend:        'rising',  // 'rising'|'falling'|'ranging'
  dxy_level:         104.5,    // DXY index level
  // Yield spread (carry trade proxy)
  us_de_spread:        2.0,    // US 10Y minus DE 10Y
  // Data freshness
  data_age_days:       3,      // COT data is always 3 days old minimum
  data_source:      'stub',    // 'cftc_live'|'cached'|'stub'
});

// ─────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────

/**
 * Runs the Positioning Analyst and returns a Vote.
 *
 * @param {PositioningParams} params
 * @returns {Vote}
 */
export function run(params) {
  try {
    return _run(params);
  } catch (err) {
    console.warn('[PositioningAnalyst] Error:', err.message);
    return createFallbackVote(AGENT.POSITIONING, err.message);
  }
}

// ─────────────────────────────────────────────
// CORE ANALYSIS
// ─────────────────────────────────────────────

function _run(params) {
  const {
    memoryLayer     = {},
    regime          = 'ranging',
    weight          = DEFAULT_WEIGHTS.positioning,
    indicatorResult = {},
  } = params ?? {};

  const m = { ...DEFAULT_MEMORY, ...memoryLayer };

  let score    = 50;
  const r1List = [];
  const r2List = [];
  let   confidenceMult = 1.0;

  const cotZ    = m.cot_z_score_52w ?? 0;
  const cotSig  = m.cot_signal ?? 'neutral';
  const extreme = Math.abs(cotZ) > 2.0;
  const moderate= Math.abs(cotZ) > 1.5;

  // ── 1. COT net direction + contrarian (±30) ─
  if (extreme) {
    // Crowded positioning → contrarian signal
    if (cotZ > 2.0) {
      // Too many longs = crowded = contrarian SELL (bearish EUR)
      score += 22 + Math.min(8, (cotZ - 2.0) * 6);
      r1List.push(`COT extreme longs (z=${cotZ.toFixed(2)}) — crowded, contrarian SELL signal`);
    } else {
      // Too many shorts = crowded = contrarian BUY (bullish EUR)
      score -= 22 + Math.min(8, Math.abs(cotZ + 2.0) * 6);
      r1List.push(`COT extreme shorts (z=${cotZ.toFixed(2)}) — crowded, contrarian BUY signal`);
    }
  } else if (moderate) {
    // Moderately extreme — follow contrarian with lower confidence
    if (cotZ > 1.5) {
      score += 14;
      r1List.push(`COT approaching extreme longs (z=${cotZ.toFixed(2)}) — mild contrarian bear`);
    } else {
      score -= 14;
      r1List.push(`COT approaching extreme shorts (z=${cotZ.toFixed(2)}) — mild contrarian bull`);
    }
    confidenceMult *= 0.75;
  } else {
    // Non-extreme: follow COT trend direction
    switch (cotSig) {
      case 'bearish_eur':      score += 20; r1List.push(`COT bearish EUR signal · z=${cotZ.toFixed(2)}`);  break;
      case 'bullish_eur':      score -= 20; r1List.push(`COT bullish EUR signal · z=${cotZ.toFixed(2)}`);  break;
      case 'contrarian_short': score -= 16; r1List.push(`COT contrarian BUY (short squeeze risk)`); break;
      case 'contrarian_long':  score += 16; r1List.push(`COT contrarian SELL (long squeeze risk)`); break;
      default:
        // Neutral COT: small contributions from weekly change direction
        if (m.cot_change_4week > 5000)       { score += 8;  r2List.push('COT 4-week accumulation of shorts'); }
        else if (m.cot_change_4week < -5000)  { score -= 8;  r2List.push('COT 4-week accumulation of longs'); }
    }
  }

  // COT 3-week trend momentum
  if (m.cot_trend_3w === 'decreasing' && !extreme) {
    // Specs becoming more short = bearish EUR momentum
    score += 8;
    r2List.push('COT 3-week trend: increasing short exposure');
  } else if (m.cot_trend_3w === 'increasing' && !extreme) {
    score -= 8;
    r2List.push('COT 3-week trend: increasing long exposure');
  }

  // ── 2. DXY correlation (±20) ───────────────
  // EUR/USD has -0.85 correlation with DXY — when DXY rises, EUR falls
  const dxy = m.dxy_trend ?? 'neutral';
  if      (dxy === 'rising')  { score += 16; r2List.push(`DXY rising — EUR/USD negative correlation`); }
  else if (dxy === 'falling') { score -= 16; r2List.push(`DXY falling — EUR/USD positive correlation`); }

  // DXY level context: high DXY = USD expensive = potential reversal
  const dxyLevel = m.dxy_level ?? 104;
  if      (dxyLevel > 108) { score -= 4; r2List.push('DXY elevated — USD mean-reversion risk'); }
  else if (dxyLevel < 100) { score += 4; r2List.push('DXY depressed — USD recovery potential'); }

  // ── 3. Yield spread carry (±15) ────────────
  const spread = m.us_de_spread ?? 2.0;
  if      (spread > 2.5) { score += 12; r2List.push(`Carry spread ${spread.toFixed(2)}% — USD carry advantage`); }
  else if (spread > 1.5) { score +=  7; }
  else if (spread < 0.5) { score -= 12; r2List.push(`Carry spread ${spread.toFixed(2)}% — EUR carry competitive`); }
  else if (spread < 1.0) { score -=  6; }

  // ── 4. Data staleness penalty ───────────────
  const dataAge = m.data_age_days ?? 3;
  if (dataAge > 7)       confidenceMult *= 0.60;
  else if (dataAge > 5)  confidenceMult *= 0.75;
  else if (dataAge > 3)  confidenceMult *= 0.90;

  if (m.data_source === 'stub') {
    confidenceMult *= 0.70;
    r2List.push('COT data: model stub — real CFTC data Phase 6+');
  } else if (m.data_source === 'cached') {
    confidenceMult *= 0.85;
  }

  score = _clamp(score);
  const vote       = scoreToVote(score);
  const baseConf   = Math.round(Math.abs(score - 50) * 2);
  const confidence = Math.min(100, Math.round(baseConf * confidenceMult));

  const r1 = r1List[0] ?? `COT z=${cotZ.toFixed(2)}, signal: ${cotSig}`;
  const r2 = r1List[1] ?? r2List[0] ?? `DXY ${dxy} · Spread ${spread.toFixed(2)}% · Trend ${m.cot_trend_3w}`;

  return createVote({
    agent:         AGENT.POSITIONING,
    score,
    vote,
    confidence,
    weight,
    market_regime: regime,
    reason_1:      r1,
    reason_2:      r2,
  });
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function _clamp(n) { return Math.max(0, Math.min(100, Math.round(n))); }

// ─────────────────────────────────────────────
// JSDoc typedefs
// ─────────────────────────────────────────────

/**
 * @typedef {Object} PositioningParams
 * @property {object} [memoryLayer]   - COT data (Phase 6+: from COTService + COTMemory)
 * @property {string} [regime]
 * @property {number} [weight]
 * @property {object} [indicatorResult]
 */
