/**
 * ONETO EUR/USD AI Tool — TechnicalAnalyst Agent
 * ================================================
 * AI Committee Agent 1 (weight: 30% default, regime-adjusted).
 *
 * Analyses EUR/USD price action using six technical indicator groups:
 *   1. MA Alignment   — structural trend context      (±30 max contribution)
 *   2. EMA Crossover  — short-term momentum shift     (±18)
 *   3. RSI            — momentum + overbought/oversold(±20)
 *   4. MACD           — trend acceleration + crossover(±22)
 *   5. Bollinger Bands — mean-reversion context       (±18)
 *   6. ADX            — trend strength amplifier/damper
 *
 * Score convention: 0–100. Higher = more bearish EUR/USD.
 *   > 55 → SELL  |  < 45 → BUY  |  45–55 → NEUTRAL
 *
 * Entry point:  TechnicalAnalyst.run(params)
 * Never throws. Returns neutral fallback on error.
 *
 * Architecture Freeze V4.0-R1 | Phase 4A
 */

'use strict';

import {
  calcMA,
  calcEMA,
  calcRSI,
  calcMACD,
  calcBB,
  calcATR,
  calcADX,
  calcStochastic,
} from '../utils/indicators.js';

import {
  AGENT,
  VOTE_DIRECTION,
  createVote,
  createFallbackVote,
  scoreToVote,
  DEFAULT_WEIGHTS,
} from '../types/Vote.js';

// ─────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────

/**
 * Runs the Technical Analyst and returns a Vote.
 *
 * @param {TechnicalParams} params
 * @returns {Vote}
 */
export function run(params) {
  try {
    return _run(params);
  } catch (err) {
    console.warn('[TechnicalAnalyst] Error:', err.message);
    return createFallbackVote(AGENT.TECHNICAL, err.message);
  }
}

// ─────────────────────────────────────────────
// CORE ANALYSIS
// ─────────────────────────────────────────────

function _run(params) {
  const {
    candles       = [],
    regime        = 'ranging',
    weight        = DEFAULT_WEIGHTS.technical,
    indicatorResult = {},
  } = params ?? {};

  if (!candles || candles.length < 10) {
    return createFallbackVote(AGENT.TECHNICAL, 'Insufficient candle data');
  }

  const closes = candles.map(c => c.close);
  const highs  = candles.map(c => c.high);
  const lows   = candles.map(c => c.low);
  const last   = closes[closes.length - 1];

  // Use pre-computed indicators when available (from MarketSnapshotEngine),
  // otherwise compute fresh. This avoids duplicate work in CommitteeOrchestrator.
  const ma20  = indicatorResult.ma20  || calcMA(closes, 20)  || last;
  const ma50  = indicatorResult.ma50  || calcMA(closes, Math.min(50, closes.length)) || last;
  const ma200 = indicatorResult.ma200 || (closes.length >= 200 ? calcMA(closes, 200) : 0);
  const ema9  = calcEMA(closes, 9);
  const ema21 = calcEMA(closes, Math.min(21, closes.length));
  const rsi   = indicatorResult.rsi_14 || calcRSI(closes, 14);
  const macd  = indicatorResult.macd  || calcMACD(closes);
  const bb    = indicatorResult.bb    || calcBB(closes, 20, 2);
  const adx   = indicatorResult.adx_14 || calcADX(highs, lows, closes, 14).adx;
  const atr   = indicatorResult.atr_14 || calcATR(highs, lows, closes, 14);
  const stoch = calcStochastic(highs, lows, closes, 14, 3);

  let score    = 50;
  const r1List = [];   // primary reasons
  const r2List = [];   // secondary reasons

  // ── 1. MA Alignment (±30) ──────────────────
  if (ma20 > 0 && ma50 > 0) {
    if (last < ma20 && ma20 < ma50) {
      score += 22;
      r1List.push(`Price below MA20 < MA50 — bearish structure`);
      if (ma200 > 0 && last < ma200) { score += 8; r2List.push('Below MA200 — long-term bear'); }
    } else if (last > ma20 && ma20 > ma50) {
      score -= 22;
      r1List.push(`Price above MA20 > MA50 — bullish structure`);
      if (ma200 > 0 && last > ma200) { score -= 8; r2List.push('Above MA200 — long-term bull'); }
    } else if (last < ma20 && last > ma50) {
      score += 10;
      r1List.push('Price between MA20 and MA50 — mild bearish');
    } else if (last > ma20 && last < ma50) {
      score -= 10;
      r1List.push('Price between MA20 and MA50 — mild bullish');
    }
  }

  // ── 2. EMA Crossover (±18) ─────────────────
  if (ema9 > 0 && ema21 > 0) {
    if (ema9 < ema21 && last < ema9) {
      score += 14;
      r1List.push(`EMA9 ${ema9.toFixed(5)} < EMA21 ${ema21.toFixed(5)} — bearish cross`);
    } else if (ema9 > ema21 && last > ema9) {
      score -= 14;
      r1List.push(`EMA9 ${ema9.toFixed(5)} > EMA21 ${ema21.toFixed(5)} — bullish cross`);
    } else if (last < ema9) {
      score += 6;
    } else if (last > ema9) {
      score -= 6;
    }
  }

  // ── 3. RSI (±20) ───────────────────────────
  if (rsi > 0) {
    if      (rsi < 25)        { score -= 18; r1List.push(`RSI ${rsi} — deeply oversold, bullish reversal likely`); }
    else if (rsi < 35)        { score -= 12; r1List.push(`RSI ${rsi.toFixed(1)} — oversold zone`); }
    else if (rsi < 45)        { score += 10; r2List.push(`RSI ${rsi.toFixed(1)} — bearish momentum`); }
    else if (rsi > 75)        { score += 18; r1List.push(`RSI ${rsi.toFixed(1)} — deeply overbought, bearish reversal likely`); }
    else if (rsi > 65)        { score += 12; r1List.push(`RSI ${rsi.toFixed(1)} — overbought zone`); }
    else if (rsi > 55)        { score -= 10; r2List.push(`RSI ${rsi.toFixed(1)} — bullish momentum`); }

    // RSI divergence proxy: RSI direction vs price direction
    if (closes.length >= 5) {
      const prevClose = closes[closes.length - 5];
      const prevRSI   = calcRSI(closes.slice(0, -4), 14);
      if (last > prevClose && rsi < prevRSI && rsi < 50) {
        score += 6;   // bearish RSI divergence
        r2List.push('Potential bearish RSI divergence');
      } else if (last < prevClose && rsi > prevRSI && rsi > 50) {
        score -= 6;   // bullish RSI divergence
        r2List.push('Potential bullish RSI divergence');
      }
    }
  }

  // ── 4. MACD (±22) ──────────────────────────
  if (macd && atr > 0) {
    const hist    = macd.hist;
    const relHist = hist / atr;   // normalise against ATR

    if      (relHist < -0.20) { score -= 18; r1List.push(`MACD golden cross — strong bullish (hist ${hist.toFixed(6)})`); }
    else if (relHist < -0.08) { score -= 12; r1List.push(`MACD histogram positive — bullish acceleration`); }
    else if (relHist < -0.02) { score -=  6; r2List.push('MACD mildly bullish'); }
    else if (relHist >  0.20) { score += 18; r1List.push(`MACD dead cross — strong bearish (hist ${hist.toFixed(6)})`); }
    else if (relHist >  0.08) { score += 12; r1List.push(`MACD histogram negative — bearish acceleration`); }
    else if (relHist >  0.02) { score +=  6; r2List.push('MACD mildly bearish'); }

    // MACD line vs signal line cross
    const crossDir = macd.macd > macd.signal ? 'golden' : 'dead';
    if (crossDir === 'dead' && hist > 0) {
      r2List.push('MACD death cross confirmed');
    } else if (crossDir === 'golden' && hist < 0) {
      r2List.push('MACD golden cross confirmed');
    }
  }

  // ── 5. Bollinger Bands (±18) ───────────────
  if (bb && bb.upper > bb.lower) {
    const bbPct   = (last - bb.lower) / (bb.upper - bb.lower);
    const bbWidth = bb.upper - bb.lower;

    if      (bbPct < 0.05) { score -= 16; r1List.push(`Price at BB lower (${last.toFixed(5)}) — oversold bounce zone`); }
    else if (bbPct < 0.25) { score -=  8; r2List.push(`Price in lower BB quarter — support zone`); }
    else if (bbPct > 0.95) { score += 16; r1List.push(`Price at BB upper (${last.toFixed(5)}) — overbought resistance`); }
    else if (bbPct > 0.75) { score +=  8; r2List.push(`Price in upper BB quarter — resistance zone`); }

    // Squeeze detection: narrow BB = volatility compression = breakout pending
    const bbWidthPct = indicatorResult.bb_width_pct ?? 50;
    if (bbWidthPct < 15) {
      r2List.push('BB squeeze — low volatility, breakout imminent');
    }
  }

  // ── 6. Stochastic confirmation (±8) ────────
  if (stoch) {
    if      (stoch.k < 20 && stoch.d < 20) { score -= 6; r2List.push(`Stoch %K${stoch.k.toFixed(0)} — oversold`); }
    else if (stoch.k > 80 && stoch.d > 80) { score += 6; r2List.push(`Stoch %K${stoch.k.toFixed(0)} — overbought`); }
  }

  // ── 7. ADX trend strength modifier ─────────
  // Strong trend: amplify signal away from neutral
  // Weak trend: dampen signal toward neutral
  if (adx > 40)       score = _amplify(score, 1.25);
  else if (adx > 30)  score = _amplify(score, 1.15);
  else if (adx < 15)  score = _dampen(score, 0.60);
  else if (adx < 20)  score = _dampen(score, 0.75);

  // ── 8. Regime context modifier ─────────────
  if (regime === 'volatile') {
    // In volatile regime, dampen strong signals — conviction is lower
    score = _dampen(score, 0.85);
    r2List.push('Volatile regime — confidence dampened');
  } else if (regime === 'ranging') {
    // In ranging regime, amplify mean-reversion signals
    if (score > 60 || score < 40) score = _amplify(score, 1.1);
    r2List.push(`${regime} regime — mean-reversion bias`);
  } else if (regime === 'trending_bear' || regime === 'trending_bull') {
    // In trending regime, amplify trend-following signals
    score = _amplify(score, 1.1);
    r2List.push(`${regime} — trend-following bias amplified`);
  }

  score = _clamp(score);
  const vote       = scoreToVote(score);
  const confidence = Math.round(Math.abs(score - 50) * 2);

  // Build reason strings — prefer most signal-bearing reasons
  const reason_1 = r1List[0]
    ?? (adx > 25 ? `ADX ${adx.toFixed(1)} — strong trend, score ${score}` : `Score ${score} — mixed signals`);
  const reason_2 = r1List[1]
    ?? r2List[0]
    ?? (adx > 25
      ? `${adx.toFixed(1)} ADX · MA20 ${ma20.toFixed(4)} · MA50 ${ma50.toFixed(4)}`
      : `RSI ${rsi?.toFixed(1)} · MACD hist ${macd?.hist?.toFixed(6) ?? '0'}`);

  return createVote({
    agent:         AGENT.TECHNICAL,
    score,
    vote,
    confidence,
    weight,
    market_regime: regime,
    reason_1,
    reason_2,
  });
}

// ─────────────────────────────────────────────
// MATH HELPERS
// ─────────────────────────────────────────────

function _clamp(n)           { return Math.max(0, Math.min(100, Math.round(n))); }
function _amplify(s, f)      { return 50 + (s - 50) * f; }
function _dampen(s, f)       { return 50 + (s - 50) * f; }

// ─────────────────────────────────────────────
// JSDoc typedefs
// ─────────────────────────────────────────────

/**
 * @typedef {Object} TechnicalParams
 * @property {Candle[]} candles
 * @property {string}   [regime]
 * @property {number}   [weight]
 * @property {object}   [indicatorResult]
 */
