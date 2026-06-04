/**
 * ONETO EUR/USD AI Tool — CommitteeEngine
 * =========================================
 * Orchestrates the AI Committee: runs all 5 agents concurrently,
 * applies regime-adjusted weights, collects votes, and produces
 * the committee verdict.
 *
 * Updated committee weights (Phase 1 authorization):
 *   Technical:   30% (was 35%)
 *   Macro:       20% (unchanged)
 *   Positioning: 20% (was 10%)
 *   News:        15% (was 20%)
 *   Risk:        15% (unchanged)
 *
 * Rules:
 *   · Exactly 5 votes always returned (neutral fallback on agent error)
 *   · MTF result attached to output (pre-gate already run by SignalEngine)
 *   · Never throws — all errors caught per agent
 *
 * Architecture Freeze V4.0-R1 | Phase 1
 */

'use strict';

import {
  AGENT,
  VOTE_DIRECTION,
  DEFAULT_WEIGHTS,
  REGIME_WEIGHTS,
  createVote,
  createFallbackVote,
  aggregateVotes,
  countAgentsAgreeing,
  scoreToVote,
} from '../types/Vote.js';

// ─────────────────────────────────────────────
// MEMORY LAYER DEFAULTS (Phase 1–4 stubs)
// Phase 6: replaced by real CentralBankMemory / NewsMemory / COTMemory
// ─────────────────────────────────────────────

const DEFAULT_MEMORY = Object.freeze({
  cb_fed_stance_score:  60,       // hawkish
  cb_ecb_stance_score:   0,       // neutral
  news_net_score:        0,       // neutral
  cot_z_score:           0,       // neutral
  cot_signal:        'neutral',
  us_de_spread:          2.0,
  dxy_trend:         'rising',
  policy_momentum:       1,       // mild hawkish trend
  vix_level:            15.0,
  upcoming_event_risk:   false,   // no major event within 4h
});

// ─────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────

/**
 * Runs all 5 agents and returns votes + committee verdict.
 *
 * @param {CommitteeInput} input
 * @returns {CommitteeOutput}
 */
export function run(input) {
  const {
    candles,
    candles_1d = [],
    candles_1h = [],
    regime     = 'ranging',
    weights    = null,
    memoryLayer = {},
    mtfResult  = null,
    indicatorResult = {},
  } = input ?? {};

  // Merge memory with defaults (Phase 1 stubs)
  const memory = { ...DEFAULT_MEMORY, ...memoryLayer };

  // Determine effective weights (regime override > passed weights > defaults)
  const effectiveWeights = _resolveWeights(regime, weights);

  // Run all 5 agents — catch any individual agent failure
  const votes = [
    _runAgent(AGENT.TECHNICAL,   () => _technicalAgent(candles,    indicatorResult, regime,    effectiveWeights.technical)),
    _runAgent(AGENT.MACRO,       () => _macroAgent(memory,         regime,          effectiveWeights.macro)),
    _runAgent(AGENT.POSITIONING, () => _positioningAgent(memory,   indicatorResult, regime,    effectiveWeights.positioning)),
    _runAgent(AGENT.NEWS,        () => _newsAgent(memory,          regime,          effectiveWeights.news)),
    _runAgent(AGENT.RISK,        () => _riskAgent(candles,         memory,          indicatorResult, regime, effectiveWeights.risk)),
  ];

  const verdict = aggregateVotes(votes);

  return {
    votes,
    verdict,
    mtf_result: mtfResult,
    regime,
    weights:    effectiveWeights,
    timestamp:  Date.now(),
  };
}

// ─────────────────────────────────────────────
// AGENT IMPLEMENTATIONS
// ─────────────────────────────────────────────

/**
 * AGENT 1 — Technical Analyst (30%)
 *
 * Scores: MA alignment, RSI, MACD, Bollinger position, ADX trend strength.
 * Score 0–100: higher = more bearish EUR/USD.
 */
function _technicalAgent(candles, ind, regime, weight) {
  let score = 50;
  const reasons = [];

  // MA alignment
  if (ind.ma20 && ind.ma50 && ind.price) {
    const price = ind.price;
    if (price < ind.ma20 && ind.ma20 < ind.ma50) {
      score += 18;
      reasons.push('Price below MA20 < MA50 — bearish alignment');
    } else if (price < ind.ma20) {
      score += 9;
      reasons.push('Price below MA20 — short-term bearish');
    } else if (price > ind.ma20 && ind.ma20 > ind.ma50) {
      score -= 18;
      reasons.push('Price above MA20 > MA50 — bullish alignment');
    } else if (price > ind.ma20) {
      score -= 9;
      reasons.push('Price above MA20 — short-term bullish');
    }
  }

  // RSI
  const rsi = ind.rsi_14 ?? 50;
  if (rsi < 30)       { score -= 12; reasons.push(`RSI ${rsi} — oversold, potential reversal`); }
  else if (rsi < 45)  { score += 10; reasons.push(`RSI ${rsi} — bearish momentum`); }
  else if (rsi > 70)  { score += 12; reasons.push(`RSI ${rsi} — overbought, caution`); }
  else if (rsi > 55)  { score -= 10; reasons.push(`RSI ${rsi} — bullish momentum`); }

  // MACD
  const hist = ind.macd?.hist ?? 0;
  if      (hist < -0.0005) { score += 14; reasons.push('MACD dead cross — bearish'); }
  else if (hist < 0)       { score +=  5; reasons.push('MACD histogram negative'); }
  else if (hist > 0.0005)  { score -= 14; reasons.push('MACD golden cross — bullish'); }
  else if (hist > 0)       { score -=  5; }

  // Bollinger position
  if (ind.bb && ind.price) {
    const p = ind.price;
    if      (p < ind.bb.lower) { score -= 8; reasons.push('Price below BB lower — oversold'); }
    else if (p < ind.bb.mid)   { score += 7; }
    else if (p > ind.bb.upper) { score += 8; reasons.push('Price above BB upper — overbought'); }
    else if (p > ind.bb.mid)   { score -= 7; }
  }

  // ADX trend strength modifier
  const adx = ind.adx_14 ?? 0;
  if (adx > 30) score = _amplify(score, 1.2);  // strong trend: amplify signal
  if (adx < 20) score = _dampen(score, 0.7);   // weak trend: reduce signal

  score = _clamp(score);
  const vote = scoreToVote(score);
  const conf = Math.round(Math.abs(score - 50) * 2);

  return createVote({
    agent:      AGENT.TECHNICAL,
    score,
    vote,
    confidence: conf,
    weight,
    market_regime: regime,
    reason_1: reasons[0] ?? 'Technical indicators neutral',
    reason_2: reasons[1] ?? (adx > 25 ? `ADX ${adx.toFixed(1)} — strong trend` : `ADX ${adx.toFixed(1)} — weak trend`),
  });
}

/**
 * AGENT 2 — Macro Analyst (20%)
 *
 * Scores: Fed stance, ECB stance, yield spread direction, GDP/inflation.
 */
function _macroAgent(memory, regime, weight) {
  let score = 50;

  // Fed hawkishness (positive stance = USD bullish = bearish EUR)
  const fed = memory.cb_fed_stance_score ?? 0;
  score += _scaledContrib(fed, 0.28);  // max ±28 from this component

  // ECB dovishness (negative ECB stance = bearish EUR)
  const ecb = memory.cb_ecb_stance_score ?? 0;
  score -= _scaledContrib(ecb, 0.22);

  // Yield spread: US–DE spread widening is bearish EUR
  const spread = memory.us_de_spread ?? 0;
  if      (spread > 2.5) score += 16;
  else if (spread > 1.5) score +=  8;
  else if (spread < 0.5) score -= 12;

  // Policy momentum
  const mom = memory.policy_momentum ?? 0;
  score += mom * 4;  // ±12 from momentum

  // Upcoming event risk (reduce confidence if high-impact event within 4h)
  const eventRisk = memory.upcoming_event_risk ? -8 : 0;
  score += eventRisk;

  score = _clamp(score);
  const vote = scoreToVote(score);
  const conf = memory.upcoming_event_risk
    ? Math.round(Math.abs(score - 50) * 1.4)
    : Math.round(Math.abs(score - 50) * 2);

  const fedLabel = fed > 50 ? 'Very Hawkish' : fed > 25 ? 'Hawkish' : fed > -25 ? 'Neutral' : 'Dovish';
  const ecbLabel = ecb > 25 ? 'Hawkish' : ecb > -25 ? 'Neutral' : ecb > -50 ? 'Dovish' : 'Very Dovish';

  return createVote({
    agent:      AGENT.MACRO,
    score,
    vote,
    confidence: conf,
    weight,
    market_regime: regime,
    reason_1: `Fed ${fedLabel} (score ${fed}) · ECB ${ecbLabel} (score ${ecb})`,
    reason_2: `US-DE spread ${spread.toFixed(2)}% · DXY ${memory.dxy_trend}`,
  });
}

/**
 * AGENT 3 — Positioning Analyst (20%)
 *
 * Scores: COT net position trend, extreme positioning (contrarian),
 *         DXY correlation, yield spread direction.
 */
function _positioningAgent(memory, ind, regime, weight) {
  let score = 50;

  // COT trend
  const cotZ = memory.cot_z_score ?? 0;
  const cotSig = memory.cot_signal ?? 'neutral';

  // Extreme positioning: contrarian signal
  if      (cotZ > 2.0)  { score -= 22; }   // crowded long → contrarian bearish
  else if (cotZ > 1.5)  { score -=  9; }
  else if (cotZ < -2.0) { score += 22; }   // crowded short → contrarian bullish
  else if (cotZ < -1.5) { score +=  9; }
  else {
    // Follow COT trend direction
    if      (cotSig === 'bearish_eur') score += 18;
    else if (cotSig === 'bullish_eur') score -= 18;
  }

  // DXY trend correlation
  const dxy = memory.dxy_trend ?? 'neutral';
  if      (dxy === 'rising')  score += 12;
  else if (dxy === 'falling') score -= 12;

  // Yield spread (same data, different lens)
  const spread = memory.us_de_spread ?? 0;
  if      (spread > 2.5) score += 10;
  else if (spread < 1.0) score -= 10;

  score = _clamp(score);
  const vote = scoreToVote(score);
  const conf = Math.round(Math.abs(score - 50) * 2);

  const contrarian = Math.abs(cotZ) > 1.5;
  return createVote({
    agent:      AGENT.POSITIONING,
    score,
    vote,
    confidence: conf,
    weight,
    market_regime: regime,
    reason_1: contrarian
      ? `COT z-score ${cotZ.toFixed(2)} — ${cotZ > 0 ? 'crowded longs, contrarian SELL' : 'crowded shorts, contrarian BUY'}`
      : `COT signal: ${cotSig} · z-score ${cotZ.toFixed(2)}`,
    reason_2: `DXY ${dxy} · US-DE spread ${spread.toFixed(2)}%`,
  });
}

/**
 * AGENT 4 — News Analyst (15%)
 *
 * Scores: 24h news sentiment window with decay.
 */
function _newsAgent(memory, regime, weight) {
  let score = 50;

  const netScore = memory.news_net_score ?? 0;  // -200 to +200 (USD - EUR sentiment)

  // Map news net score to agent score
  // Positive net = USD bullish = bearish EUR = higher agent score
  if      (netScore > 60)  score += 22;
  else if (netScore > 30)  score += 12;
  else if (netScore > 0)   score +=  5;
  else if (netScore < -60) score -= 22;
  else if (netScore < -30) score -= 12;
  else if (netScore < 0)   score -=  5;

  // Narrative shift penalty (from memory)
  if (memory.narrative_shift) {
    score = _dampen(score, 0.7);
  }

  score = _clamp(score);
  const vote = scoreToVote(score);
  const conf = memory.narrative_shift
    ? Math.round(Math.abs(score - 50) * 1.4)
    : Math.round(Math.abs(score - 50) * 2);

  const sentiment = netScore > 30 ? 'USD Bullish' : netScore < -30 ? 'EUR Bullish' : 'Neutral';
  return createVote({
    agent:      AGENT.NEWS,
    score,
    vote,
    confidence: conf,
    weight,
    market_regime: regime,
    reason_1: `News sentiment: ${sentiment} (net ${netScore > 0 ? '+' : ''}${netScore})`,
    reason_2: memory.narrative_shift
      ? 'Narrative shift detected — confidence reduced'
      : memory.dominant_theme ?? 'No dominant theme in recent headlines',
  });
}

/**
 * AGENT 5 — Risk Analyst (15%)
 *
 * Scores: ATR volatility, event proximity, regime risk, VIX.
 * NOTE: Risk Analyst mostly votes NEUTRAL — it adjusts SIZE not direction.
 * Only votes BUY/SELL on extreme readings.
 */
function _riskAgent(candles, memory, ind, regime, weight) {
  let score = 50;

  // ATR volatility
  const atrRatio = ind.atr_ratio ?? 1.0;
  if      (atrRatio > 2.0) score += 28;
  else if (atrRatio > 1.5) score += 18;
  else if (atrRatio > 1.2) score +=  8;
  else if (atrRatio < 0.5) score -=  8;

  // Upcoming event risk
  if (memory.upcoming_event_risk) score += 18;

  // Regime risk
  const regimeRisk = {
    volatile:      18,
    breakout_up:    8,
    breakout_down:  8,
    ranging:        4,
    trending_bull:  0,
    trending_bear:  0,
  }[regime] ?? 0;
  score += regimeRisk;

  // VIX
  const vix = memory.vix_level ?? 15;
  if      (vix > 30) score += 14;
  else if (vix > 20) score +=  7;

  score = _clamp(score);

  // Risk Analyst: vote NEUTRAL unless risk is extreme
  const vote = score > 80 ? VOTE_DIRECTION.SELL    // extreme risk = don't trade (SELL = stay out)
             : score < 35 ? VOTE_DIRECTION.BUY      // very low risk = proceed
             :              VOTE_DIRECTION.NEUTRAL;

  const conf = vote === VOTE_DIRECTION.NEUTRAL ? 0 : Math.round(Math.abs(score - 50) * 2);

  // Position size multiplier (returned as metadata, used by RiskManager)
  const sizeMultiplier = score > 85 ? 0.25
                        : score > 70 ? 0.50
                        : score > 55 ? 0.75
                        : score < 40 ? 1.25
                        : 1.00;

  return createVote({
    agent:      AGENT.RISK,
    score,
    vote,
    confidence: conf,
    weight,
    market_regime: regime,
    reason_1: `ATR ratio ${atrRatio.toFixed(2)}× · VIX ${vix.toFixed(1)} · Risk score ${score}`,
    reason_2: `Position size multiplier: ${sizeMultiplier}× · ${memory.upcoming_event_risk ? 'High-impact event nearby' : 'No imminent event risk'}`,
    // Attach size multiplier as non-standard field for RiskManager to read
    _size_multiplier: sizeMultiplier,
  });
}

// ─────────────────────────────────────────────
// WEIGHT RESOLUTION
// ─────────────────────────────────────────────

/**
 * Resolves the effective weight configuration.
 * Priority: regime override > passed weights > Phase 1 defaults.
 *
 * @param {string} regime
 * @param {WeightConfig|null} overrideWeights
 * @returns {WeightConfig}
 */
function _resolveWeights(regime, overrideWeights) {
  // If caller passes explicit weights (from committee_weights table), use them
  if (overrideWeights && _weightsValid(overrideWeights)) {
    // Still apply regime override on top if available
    const regimeW = REGIME_WEIGHTS[regime];
    return regimeW ?? overrideWeights;
  }
  return REGIME_WEIGHTS[regime] ?? DEFAULT_WEIGHTS;
}

function _weightsValid(w) {
  if (!w) return false;
  const sum = (w.technical ?? 0) + (w.macro ?? 0) + (w.positioning ?? 0) + (w.news ?? 0) + (w.risk ?? 0);
  return Math.abs(sum - 1.0) < 0.001;
}

// ─────────────────────────────────────────────
// SAFE AGENT RUNNER
// ─────────────────────────────────────────────

/**
 * Runs an agent function and catches any error.
 * Returns a neutral fallback vote if the agent throws.
 *
 * @param {string} agent
 * @param {Function} agentFn
 * @returns {Vote}
 */
function _runAgent(agent, agentFn) {
  try {
    const result = agentFn();
    return result ?? createFallbackVote(agent, 'Agent returned null');
  } catch (err) {
    console.warn(`[CommitteeEngine] Agent "${agent}" threw:`, err.message);
    return createFallbackVote(agent, err.message);
  }
}

// ─────────────────────────────────────────────
// MATH HELPERS
// ─────────────────────────────────────────────

/** Clamp score to [0, 100] */
function _clamp(n) {
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Amplify signal away from midpoint (50) */
function _amplify(score, factor) {
  return 50 + (score - 50) * factor;
}

/** Dampen signal toward midpoint (50) */
function _dampen(score, factor) {
  return 50 + (score - 50) * factor;
}

/**
 * Scale a stance score (-100 to +100) to a contribution within maxContrib.
 * Linear mapping: stanceScore / 100 * maxContrib
 */
function _scaledContrib(stanceScore, maxContrib) {
  return (stanceScore / 100) * maxContrib * 100;
}

// ─────────────────────────────────────────────
// JSDoc typedefs
// ─────────────────────────────────────────────

/**
 * @typedef {Object} CommitteeInput
 * @property {Candle[]}     candles
 * @property {Candle[]}     [candles_1d]
 * @property {Candle[]}     [candles_1h]
 * @property {string}       regime
 * @property {WeightConfig} [weights]
 * @property {object}       [memoryLayer]
 * @property {object}       [mtfResult]
 * @property {object}       [indicatorResult]
 */

/**
 * @typedef {Object} CommitteeOutput
 * @property {Vote[]}           votes       - exactly 5
 * @property {CommitteeVerdict} verdict
 * @property {object|null}      mtf_result
 * @property {string}           regime
 * @property {WeightConfig}     weights
 * @property {number}           timestamp
 */