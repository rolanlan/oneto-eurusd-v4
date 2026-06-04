/**
 * ONETO EUR/USD AI Tool — NewsAnalyst Agent
 * ===========================================
 * AI Committee Agent 4 (weight: 15% default, regime-adjusted).
 *
 * Analyses financial news sentiment across multiple time windows
 * to detect USD/EUR sentiment direction and narrative shifts.
 * Phase 1–5: rule-based model using memory layer stubs.
 * Phase 6+:  reads rolling aggregates from NewsMemory + NewsAPIService.
 *
 * Three scoring components:
 *   1. 24H sentiment window — immediate market narrative (max ±35)
 *   2. 7D sentiment trend   — medium-term direction     (max ±20)
 *   3. Narrative shift      — sudden narrative reversal  (penalty up to -20)
 *   Event proximity         — reduces confidence near releases
 *
 * Exponential decay architecture:
 *   Each article has a decay_hours parameter.
 *   Phase 6+ NewsMemory pre-computes decayed aggregates.
 *   This module reads the pre-computed windows (news_net_score_24h/7d).
 *
 * net_score convention:
 *   Positive = USD Bullish (e.g. strong NFP) = bearish EUR/USD
 *   Negative = EUR Bullish (e.g. ECB hawkish surprise) = bullish EUR/USD
 *   Range: -200 to +200 (sum of weighted article impacts)
 *
 * Score convention: 0–100. Higher = more bearish EUR/USD.
 *
 * Entry point:  NewsAnalyst.run(params)
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
  // Rolling sentiment aggregates (from NewsMemory in Phase 6+)
  // net_score: USD - EUR sentiment. Positive = USD bullish = bearish EUR
  news_net_score_24h:   30,     // mild USD bullish recent news
  news_net_score_7d:    15,     // mild USD bullish weekly trend
  news_net_score_30d:    5,     // near-neutral longer-term
  // Headline counts
  headline_count_24h:    8,
  high_impact_count_24h: 2,
  // Narrative analysis
  narrative_shift:       false, // true = sudden reversal of dominant theme
  narrative_shift_magnitude: 0, // 0–100: how violent the shift is
  dominant_theme:        null,  // e.g. 'Fed hawkish', 'recession fears'
  secondary_theme:       null,
  // Sentiment breakdown
  usd_sentiment_24h:     60,    // -100 to +100
  eur_sentiment_24h:     30,    // -100 to +100
  // Data quality
  data_source:        'stub',   // 'newsapi_live'|'finnhub_live'|'cached'|'stub'
  data_age_hours:        4,     // how old the latest batch is
});

// ─────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────

/**
 * Runs the News Analyst and returns a Vote.
 *
 * @param {NewsParams} params
 * @returns {Vote}
 */
export function run(params) {
  try {
    return _run(params);
  } catch (err) {
    console.warn('[NewsAnalyst] Error:', err.message);
    return createFallbackVote(AGENT.NEWS, err.message);
  }
}

// ─────────────────────────────────────────────
// CORE ANALYSIS
// ─────────────────────────────────────────────

function _run(params) {
  const {
    memoryLayer = {},
    regime      = 'ranging',
    weight      = DEFAULT_WEIGHTS.news,
  } = params ?? {};

  const m = { ...DEFAULT_MEMORY, ...memoryLayer };

  let score    = 50;
  const r1List = [];
  const r2List = [];
  let   confidenceMult = 1.0;

  // ── 1. 24H Sentiment (±35) ─────────────────
  // Primary window — most recent news is most market-moving
  const net24h = _clampRange(m.news_net_score_24h ?? 0, -200, 200);

  if      (net24h > 100) { score += 30; r1List.push(`News strongly USD bullish (24h net: +${net24h})`); }
  else if (net24h > 50)  { score += 22; r1List.push(`News USD bullish (24h net: +${net24h})`); }
  else if (net24h > 20)  { score += 14; r1List.push(`News mildly USD bullish (24h net: +${net24h})`); }
  else if (net24h > 5)   { score +=  7; }
  else if (net24h < -100){ score -= 30; r1List.push(`News strongly EUR bullish (24h net: ${net24h})`); }
  else if (net24h < -50) { score -= 22; r1List.push(`News EUR bullish (24h net: ${net24h})`); }
  else if (net24h < -20) { score -= 14; r1List.push(`News mildly EUR bullish (24h net: ${net24h})`); }
  else if (net24h < -5)  { score -=  7; }

  // High-impact event density: more high-impact news → higher signal reliability
  const highImpact = m.high_impact_count_24h ?? 0;
  if (highImpact >= 4)       { confidenceMult *= 1.15; r2List.push(`${highImpact} high-impact events driving sentiment`); }
  else if (highImpact <= 0)  { confidenceMult *= 0.75; r2List.push('Low news density — thin signal'); }

  // Low headline volume → unreliable sentiment
  const headlines = m.headline_count_24h ?? 0;
  if (headlines < 3) {
    confidenceMult *= 0.65;
    r2List.push('Very few headlines — sentiment unreliable');
  }

  // ── 2. 7D Trend confirmation (±20) ─────────
  // Medium-term trend helps confirm or contradict 24H reading
  const net7d  = _clampRange(m.news_net_score_7d ?? 0, -200, 200);
  const sameDir = Math.sign(net24h) === Math.sign(net7d);

  if (Math.abs(net7d) > 40) {
    if (sameDir) {
      // 7D confirms 24H direction
      const add = net7d > 0 ? 14 : -14;
      score += add;
      r2List.push(`7D trend confirms: ${net7d > 0 ? 'USD' : 'EUR'} bullish (net7d: ${net7d > 0 ? '+' : ''}${net7d})`);
    } else {
      // 7D contradicts 24H — mixed signals, reduce confidence
      confidenceMult *= 0.80;
      r2List.push(`7D trend contradicts 24H — mixed news signals`);
    }
  } else if (Math.abs(net7d) > 15) {
    const add = net7d > 0 ? 7 : -7;
    score += add;
  }

  // ── 3. Narrative shift penalty ──────────────
  if (m.narrative_shift) {
    const mag = _clampRange(m.narrative_shift_magnitude ?? 50, 0, 100);
    // Strong narrative shift = don't trust current direction
    const penaltyMult = 1.0 - (mag / 100) * 0.45;
    score = _dampToNeutral(score, penaltyMult);
    confidenceMult *= (0.55 + (1 - mag / 100) * 0.30);
    r1List.push(`Narrative shift detected (magnitude: ${mag}) — direction unreliable`);
  }

  // ── 4. 30D baseline context ─────────────────
  // 30D provides longer-term anchor to detect 24H anomalies
  const net30d = _clampRange(m.news_net_score_30d ?? 0, -200, 200);
  if (Math.abs(net24h - net30d) > 80) {
    // Extreme divergence from 30D baseline
    if (net24h > net30d + 80) {
      r2List.push(`Unusually bullish USD news vs 30D baseline (${net30d})`);
    } else {
      r2List.push(`Unusually bearish USD news vs 30D baseline (${net30d})`);
    }
    confidenceMult *= 0.85;   // Mean reversion risk
  }

  // ── 5. Data staleness ───────────────────────
  const ageHours = m.data_age_hours ?? 4;
  if      (ageHours > 12)  { confidenceMult *= 0.55; r2List.push('News data >12h old — stale'); }
  else if (ageHours > 6)   { confidenceMult *= 0.70; }
  else if (ageHours > 4)   { confidenceMult *= 0.85; }

  if (m.data_source === 'stub') {
    confidenceMult *= 0.65;
    r2List.push('Sentiment: model stub — real NewsAPI Phase 6+');
  } else if (m.data_source === 'cached') {
    confidenceMult *= 0.85;
  }

  // ── 6. Regime context ───────────────────────
  if (regime === 'volatile') {
    // In volatile market, news signals are unreliable (knee-jerk reactions)
    score = _dampToNeutral(score, 0.75);
    confidenceMult *= 0.80;
  }

  score = _clamp(score);
  const vote       = scoreToVote(score);
  const baseConf   = Math.round(Math.abs(score - 50) * 2);
  const confidence = Math.min(100, Math.round(baseConf * confidenceMult));

  // Dominant theme from memory
  const themeStr = m.dominant_theme ?? (net24h > 20 ? 'USD Bullish' : net24h < -20 ? 'EUR Bullish' : 'Mixed sentiment');
  const r1 = r1List[0] ?? `News sentiment: ${themeStr} (24h net: ${net24h > 0 ? '+' : ''}${net24h})`;
  const r2 = r1List[1] ?? r2List[0] ?? (m.secondary_theme ?? `7D net: ${net7d > 0 ? '+' : ''}${net7d} · 30D net: ${net30d > 0 ? '+' : ''}${net30d}`);

  return createVote({
    agent:         AGENT.NEWS,
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

function _clamp(n)               { return Math.max(0, Math.min(100, Math.round(n))); }
function _clampRange(n, lo, hi)  { return Math.max(lo, Math.min(hi, n ?? 0)); }
function _dampToNeutral(s, f)    { return 50 + (s - 50) * f; }

// ─────────────────────────────────────────────
// JSDoc typedefs
// ─────────────────────────────────────────────

/**
 * @typedef {Object} NewsParams
 * @property {object} [memoryLayer]  - news sentiment data (Phase 6+: from NewsMemory)
 * @property {string} [regime]
 * @property {number} [weight]
 */
