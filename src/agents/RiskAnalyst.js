/**
 * ONETO EUR/USD AI Tool — RiskAnalyst Agent
 * ===========================================
 * AI Committee Agent 5 (weight: 15% default, regime-adjusted).
 *
 * Assesses current market risk environment. Unlike the four directional
 * agents, the Risk Analyst's PRIMARY role is to size positions, not to
 * pick direction. It votes NEUTRAL in most conditions.
 *
 * Only votes BUY or SELL on extreme readings:
 *   score > 80  → SELL  (= "too risky to trade long")
 *   score < 35  → BUY   (= "very low risk, good entry conditions")
 *   otherwise   → NEUTRAL
 *
 * Four scoring components:
 *   1. ATR volatility ratio  — current vol vs 30-bar average (max ±35)
 *   2. Event proximity       — upcoming high-impact releases  (max ±25)
 *   3. Regime risk           — market structure risk level    (max ±20)
 *   4. VIX context           — cross-asset fear gauge         (max ±15)
 *   Spread monitoring        — abnormal spread = hidden risk
 *
 * Non-standard output field _size_multiplier:
 *   Attached to the Vote object for RiskManager.extractRiskMultiplierFromVotes().
 *   Range: 0.25 (very high risk) to 1.25 (very low risk).
 *
 * Score convention: 0–100. Higher = higher risk environment.
 *   > 55 = elevated risk (position size will be reduced).
 *   < 40 = benign risk (position size may be increased).
 *
 * Entry point:  RiskAnalyst.run(params)
 * Never throws. Returns neutral fallback on error.
 *
 * Architecture Freeze V4.0-R1 | Phase 4A
 */

'use strict';

import {
  calcATR,
} from '../utils/indicators.js';

import {
  AGENT,
  VOTE_DIRECTION,
  createVote,
  createFallbackVote,
  DEFAULT_WEIGHTS,
} from '../types/Vote.js';

// ─────────────────────────────────────────────
// DEFAULT MEMORY LAYER (Phase 1–5 stubs)
// ─────────────────────────────────────────────

const DEFAULT_MEMORY = Object.freeze({
  vix_level:            15.0,   // VIX stub (Phase 6+: live from Yahoo Finance / FRED)
  upcoming_event_risk:  false,  // high-impact event within 4h
  event_within_hours:   null,   // null = no event
  event_impact_level:  'low',  // 'high'|'medium'|'low'
  spread_current:       0.0002, // current bid-ask spread in price
  spread_normal:        0.00010,// typical spread for comparison
  // Thin liquidity flags (session context)
  is_thin_session:      false,  // Asian off-hours, holiday, etc.
  news_blackout:        false,  // within 2min of major news release
});

// ─────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────

/**
 * Runs the Risk Analyst and returns a Vote.
 *
 * @param {RiskAnalystParams} params
 * @returns {Vote}
 */
export function run(params) {
  try {
    return _run(params);
  } catch (err) {
    console.warn('[RiskAnalyst] Error:', err.message);
    return createFallbackVote(AGENT.RISK, err.message);
  }
}

// ─────────────────────────────────────────────
// CORE ANALYSIS
// ─────────────────────────────────────────────

function _run(params) {
  const {
    candles         = [],
    memoryLayer     = {},
    regime          = 'ranging',
    weight          = DEFAULT_WEIGHTS.risk,
    indicatorResult = {},
  } = params ?? {};

  const m = { ...DEFAULT_MEMORY, ...memoryLayer };

  let riskScore = 50;   // 50 = average risk; we build UP from here
  const r1List  = [];
  const r2List  = [];

  // ── 1. ATR Volatility Ratio (±35) ──────────
  // Compute live if indicatorResult not available
  let atrRatio = indicatorResult.atr_ratio ?? 1.0;
  if (atrRatio === 1.0 && candles.length >= 30) {
    const highs  = candles.map(c => c.high);
    const lows   = candles.map(c => c.low);
    const closes = candles.map(c => c.close);
    const atr14  = calcATR(highs, lows, closes, 14);
    const atr30  = calcATR(highs, lows, closes, 30);
    atrRatio = atr30 > 0 ? parseFloat((atr14 / atr30).toFixed(3)) : 1.0;
  }

  if      (atrRatio > 2.5) { riskScore += 32; r1List.push(`ATR ratio ${atrRatio.toFixed(2)}× — extremely elevated volatility`); }
  else if (atrRatio > 2.0) { riskScore += 26; r1List.push(`ATR ratio ${atrRatio.toFixed(2)}× — very high volatility`); }
  else if (atrRatio > 1.8) { riskScore += 20; r1List.push(`ATR ratio ${atrRatio.toFixed(2)}× — high volatility`); }
  else if (atrRatio > 1.4) { riskScore += 12; r1List.push(`ATR ratio ${atrRatio.toFixed(2)}× — elevated volatility`); }
  else if (atrRatio > 1.2) { riskScore +=  6; }
  else if (atrRatio < 0.6) { riskScore -= 12; r2List.push(`ATR ratio ${atrRatio.toFixed(2)}× — very low volatility, compressed range`); }
  else if (atrRatio < 0.8) { riskScore -=  6; r2List.push(`ATR ratio ${atrRatio.toFixed(2)}× — low volatility`); }

  // ── 2. Event Proximity (±25) ───────────────
  const eventRisk = m.upcoming_event_risk || false;
  const hoursOut  = m.event_within_hours ?? null;
  const impact    = m.event_impact_level ?? 'low';

  if (eventRisk) {
    const h = hoursOut ?? 4;
    if      (impact === 'high' && h < 0.5) { riskScore += 30; r1List.push(`High-impact event in ${_hLabel(h)} — DO NOT TRADE`); }
    else if (impact === 'high' && h < 1.0) { riskScore += 25; r1List.push(`High-impact event in ${_hLabel(h)} — very high risk`); }
    else if (impact === 'high' && h < 2.0) { riskScore += 18; r1List.push(`High-impact event in ${_hLabel(h)} — elevated risk`); }
    else if (impact === 'high' && h < 4.0) { riskScore += 12; r1List.push(`High-impact event in ${_hLabel(h)} — caution`); }
    else if (impact === 'medium' && h < 2.0){ riskScore += 10; r2List.push(`Medium-impact event in ${_hLabel(h)}`); }
    else if (impact === 'medium')           { riskScore +=  6; r2List.push(`Medium-impact event today`); }
    else                                    { riskScore +=  4; }
  }

  // News blackout zone (within 2min of release)
  if (m.news_blackout) {
    riskScore += 25;
    r1List.push('NEWS BLACKOUT — within 2 minutes of release, do not trade');
  }

  // ── 3. Regime Risk (±20) ───────────────────
  const regimeRisk = {
    volatile:      22,
    breakout_up:   10,
    breakout_down: 10,
    ranging:        4,
    trending_bull:  0,
    trending_bear:  0,
  }[regime] ?? 4;

  riskScore += regimeRisk;

  if      (regime === 'volatile')                         r1List.push('Volatile regime — position size heavily reduced');
  else if (regime === 'breakout_up' || regime === 'breakout_down') r2List.push(`${regime} — breakout risk of failed move`);
  else if (regime === 'ranging')                          r2List.push('Ranging regime — smaller size appropriate');

  // ── 4. VIX Context (±15) ───────────────────
  const vix = m.vix_level ?? 15;
  if      (vix > 35) { riskScore += 18; r1List.push(`VIX ${vix} — severe risk-off, markets in fear`); }
  else if (vix > 28) { riskScore += 12; r1List.push(`VIX ${vix} — elevated fear, risk-off environment`); }
  else if (vix > 22) { riskScore +=  8; r2List.push(`VIX ${vix} — moderate caution`); }
  else if (vix > 18) { riskScore +=  4; }
  else if (vix < 12) { riskScore -=  8; r2List.push(`VIX ${vix} — complacency, watch for sudden spike`); }

  // ── 5. Spread monitoring ────────────────────
  const spreadCurrent = m.spread_current ?? 0.0002;
  const spreadNormal  = m.spread_normal  ?? 0.0001;
  const spreadRatio   = spreadNormal > 0 ? spreadCurrent / spreadNormal : 1;

  if      (spreadRatio > 4) { riskScore += 15; r1List.push(`Spread ${(spreadCurrent * 10000).toFixed(1)} pips — abnormally wide (${spreadRatio.toFixed(1)}× normal)`); }
  else if (spreadRatio > 2) { riskScore +=  8; r2List.push(`Spread elevated (${spreadRatio.toFixed(1)}× normal)`); }
  else if (spreadRatio > 1.5){ riskScore += 4; }

  // Thin session penalty
  if (m.is_thin_session) {
    riskScore += 10;
    r2List.push('Thin session — liquidity reduced');
  }

  // ── Clamp risk score ────────────────────────
  riskScore = Math.max(0, Math.min(100, Math.round(riskScore)));

  // ── Vote direction (mostly NEUTRAL) ─────────
  // Risk Analyst votes directionally ONLY on extreme readings
  const vote = riskScore > 80
    ? VOTE_DIRECTION.SELL     // = "don't trade" (high risk)
    : riskScore < 30
      ? VOTE_DIRECTION.BUY    // = "good conditions" (low risk)
      : VOTE_DIRECTION.NEUTRAL;

  // Confidence is 0 when NEUTRAL — Risk Analyst doesn't add directional conviction
  const confidence = vote === VOTE_DIRECTION.NEUTRAL
    ? 0
    : Math.round(Math.abs(riskScore - 55) * 2);

  // Position size multiplier (consumed by RiskManager)
  const sizeMultiplier = riskScore > 85 ? 0.25
    : riskScore > 70 ? 0.50
    : riskScore > 55 ? 0.75
    : riskScore < 30 ? 1.25
    : 1.00;

  const r1 = r1List[0] ?? `ATR ratio ${atrRatio.toFixed(2)}× · VIX ${vix} · Risk score ${riskScore}`;
  const r2 = r1List[1] ?? r2List[0] ?? `Size multiplier: ${sizeMultiplier}× · ${eventRisk ? 'Event risk active' : 'No imminent events'}`;

  // Build the Vote — attach _size_multiplier as non-standard metadata
  const vote_obj = createVote({
    agent:         AGENT.RISK,
    score:         riskScore,
    vote,
    confidence,
    weight,
    market_regime: regime,
    reason_1:      r1,
    reason_2:      r2,
  });

  // Attach size multiplier for RiskManager to read
  // (Object.freeze in createVote — must spread to re-freeze with extra field)
  return Object.freeze({ ...vote_obj, _size_multiplier: sizeMultiplier });
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function _hLabel(h) {
  if (h < 1) return `${Math.round(h * 60)}m`;
  return `${h.toFixed(1)}h`;
}

// ─────────────────────────────────────────────
// JSDoc typedefs
// ─────────────────────────────────────────────

/**
 * @typedef {Object} RiskAnalystParams
 * @property {Candle[]} [candles]
 * @property {object}   [memoryLayer]
 * @property {string}   [regime]
 * @property {number}   [weight]
 * @property {object}   [indicatorResult]
 */
