/**
 * ONETO EUR/USD AI Tool — Technical Indicators
 * ==============================================
 * Pure mathematical functions for technical analysis.
 * No side effects. No imports. No browser APIs.
 * Runs in Node, browser, and test environments identically.
 *
 * All functions return 0 / safe default on insufficient data.
 * Never throws.
 *
 * Architecture Freeze V4.0-R1 | Phase 2
 */

'use strict';

// ─────────────────────────────────────────────
// MOVING AVERAGES
// ─────────────────────────────────────────────

/**
 * Simple Moving Average.
 * @param {number[]} data
 * @param {number}   period
 * @returns {number}
 */
export function calcMA(data, period) {
  if (!data || data.length < period) return 0;
  const slice = data.slice(-period);
  return parseFloat((slice.reduce((s, v) => s + v, 0) / period).toFixed(6));
}

/**
 * Exponential Moving Average (full series).
 * @param {number[]} data
 * @param {number}   period
 * @returns {number}  final EMA value
 */
export function calcEMA(data, period) {
  if (!data || data.length < period) return 0;
  const k = 2 / (period + 1);
  let ema = data.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < data.length; i++) {
    ema = data[i] * k + ema * (1 - k);
  }
  return parseFloat(ema.toFixed(6));
}

/**
 * EMA series (returns array of same length as input).
 * Useful for MACD cross detection.
 * @param {number[]} data
 * @param {number}   period
 * @returns {number[]}
 */
export function calcEMASeries(data, period) {
  if (!data || data.length < period) return data?.map(() => 0) ?? [];
  const k   = 2 / (period + 1);
  const out = new Array(data.length).fill(0);
  out[period - 1] = data.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < data.length; i++) {
    out[i] = data[i] * k + out[i - 1] * (1 - k);
  }
  return out;
}

// ─────────────────────────────────────────────
// RSI
// ─────────────────────────────────────────────

/**
 * Relative Strength Index (Wilder smoothing).
 * @param {number[]} closes
 * @param {number}   [period=14]
 * @returns {number}  0–100
 */
export function calcRSI(closes, period = 14) {
  if (!closes || closes.length < period + 1) return 50;

  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gains  += d;
    else        losses -= d;
  }

  const ag = gains  / period;
  const al = losses / period;
  if (al === 0) return ag === 0 ? 50 : 100;

  return parseFloat((100 - 100 / (1 + ag / al)).toFixed(2));
}

// ─────────────────────────────────────────────
// MACD
// ─────────────────────────────────────────────

/**
 * MACD (12,26,9).
 * @param {number[]} closes
 * @param {number}   [fast=12]
 * @param {number}   [slow=26]
 * @param {number}   [signal=9]
 * @returns {{ macd: number, signal: number, hist: number }}
 */
export function calcMACD(closes, fast = 12, slow = 26, signal = 9) {
  if (!closes || closes.length < slow + signal) {
    return { macd: 0, signal: 0, hist: 0 };
  }

  const ema12 = calcEMASeries(closes, fast);
  const ema26 = calcEMASeries(closes, slow);
  const macdLine = ema12.map((v, i) => v - ema26[i]);

  // Signal line: EMA(9) of macd line (only meaningful values)
  const meaningful = macdLine.slice(slow - 1);
  const sigLine    = calcEMASeries(meaningful, signal);
  const lastMacd   = macdLine[macdLine.length - 1];
  const lastSig    = sigLine[sigLine.length - 1];

  return {
    macd:   parseFloat(lastMacd.toFixed(6)),
    signal: parseFloat(lastSig.toFixed(6)),
    hist:   parseFloat((lastMacd - lastSig).toFixed(6)),
  };
}

// ─────────────────────────────────────────────
// BOLLINGER BANDS
// ─────────────────────────────────────────────

/**
 * Bollinger Bands (20, 2σ by default).
 * @param {number[]} closes
 * @param {number}   [period=20]
 * @param {number}   [mult=2]
 * @returns {{ upper: number, mid: number, lower: number, width: number }}
 */
export function calcBB(closes, period = 20, mult = 2) {
  if (!closes || closes.length < period) {
    return { upper: 0, mid: 0, lower: 0, width: 0 };
  }
  const slice = closes.slice(-period);
  const avg   = slice.reduce((s, v) => s + v, 0) / period;
  const sd    = Math.sqrt(slice.reduce((s, v) => s + (v - avg) ** 2, 0) / period);
  const upper = parseFloat((avg + mult * sd).toFixed(5));
  const lower = parseFloat((avg - mult * sd).toFixed(5));
  return {
    upper,
    mid:   parseFloat(avg.toFixed(5)),
    lower,
    width: parseFloat((upper - lower).toFixed(5)),
  };
}

/**
 * BB %B — position of price within the bands (0 = at lower, 1 = at upper).
 * @param {number} price
 * @param {{ upper: number, lower: number }} bb
 * @returns {number}  0–1 (can exceed bounds)
 */
export function calcBBPercent(price, bb) {
  const range = bb.upper - bb.lower;
  if (range === 0) return 0.5;
  return parseFloat(((price - bb.lower) / range).toFixed(4));
}

// ─────────────────────────────────────────────
// ATR
// ─────────────────────────────────────────────

/**
 * Average True Range.
 * @param {number[]} highs
 * @param {number[]} lows
 * @param {number[]} closes
 * @param {number}   [period=14]
 * @returns {number}
 */
export function calcATR(highs, lows, closes, period = 14) {
  if (!highs || highs.length < period + 1) return 0;
  const trs = [];
  for (let i = 1; i < highs.length; i++) {
    trs.push(Math.max(
      highs[i]  - lows[i],
      Math.abs(highs[i]  - closes[i - 1]),
      Math.abs(lows[i]   - closes[i - 1]),
    ));
  }
  const recent = trs.slice(-period);
  return parseFloat((recent.reduce((s, v) => s + v, 0) / period).toFixed(6));
}

// ─────────────────────────────────────────────
// ADX
// ─────────────────────────────────────────────

/**
 * Average Directional Index (simplified Wilder method).
 * @param {number[]} highs
 * @param {number[]} lows
 * @param {number[]} closes
 * @param {number}   [period=14]
 * @returns {{ adx: number, diPlus: number, diMinus: number }}
 */
export function calcADX(highs, lows, closes, period = 14) {
  if (!highs || highs.length < period * 2) {
    return { adx: 0, diPlus: 0, diMinus: 0 };
  }

  let posSum = 0, negSum = 0, trSum = 0;
  const start = highs.length - period;

  for (let i = start; i < highs.length; i++) {
    const upMove   = highs[i]   - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    const dmPos    = (upMove > downMove && upMove > 0) ? upMove : 0;
    const dmNeg    = (downMove > upMove && downMove > 0) ? downMove : 0;
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i]  - closes[i - 1]),
    );
    posSum += dmPos;
    negSum += dmNeg;
    trSum  += tr;
  }

  if (trSum === 0) return { adx: 0, diPlus: 0, diMinus: 0 };
  const diPlus  = parseFloat(((posSum / trSum) * 100).toFixed(2));
  const diMinus = parseFloat(((negSum / trSum) * 100).toFixed(2));
  const diSum   = diPlus + diMinus;
  const adx     = diSum === 0 ? 0
    : parseFloat((Math.abs(diPlus - diMinus) / diSum * 100).toFixed(2));

  return { adx, diPlus, diMinus };
}

// ─────────────────────────────────────────────
// STOCHASTIC
// ─────────────────────────────────────────────

/**
 * Stochastic Oscillator %K and %D.
 * @param {number[]} highs
 * @param {number[]} lows
 * @param {number[]} closes
 * @param {number}   [k=14]
 * @param {number}   [d=3]
 * @returns {{ k: number, d: number }}
 */
export function calcStochastic(highs, lows, closes, k = 14, d = 3) {
  if (!highs || highs.length < k) return { k: 50, d: 50 };

  const kValues = [];
  for (let i = k - 1; i < highs.length; i++) {
    const high = Math.max(...highs.slice(i - k + 1, i + 1));
    const low  = Math.min(...lows.slice(i - k + 1, i + 1));
    const kVal = high === low ? 50 : (closes[i] - low) / (high - low) * 100;
    kValues.push(kVal);
  }

  const lastK = kValues[kValues.length - 1];
  const dSlice = kValues.slice(-d);
  const lastD  = dSlice.reduce((s, v) => s + v, 0) / dSlice.length;

  return {
    k: parseFloat(lastK.toFixed(2)),
    d: parseFloat(lastD.toFixed(2)),
  };
}

// ─────────────────────────────────────────────
// SUPPORT / RESISTANCE (swing points)
// ─────────────────────────────────────────────

/**
 * Finds the most recent swing high and swing low.
 * Used for dynamic SL placement.
 *
 * @param {number[]} highs
 * @param {number[]} lows
 * @param {number}   [lookback=10]
 * @returns {{ swingHigh: number, swingLow: number }}
 */
export function calcSwingPoints(highs, lows, lookback = 10) {
  if (!highs || highs.length < lookback) {
    return { swingHigh: 0, swingLow: 0 };
  }
  const hSlice = highs.slice(-lookback);
  const lSlice = lows.slice(-lookback);
  return {
    swingHigh: parseFloat(Math.max(...hSlice).toFixed(5)),
    swingLow:  parseFloat(Math.min(...lSlice).toFixed(5)),
  };
}

// ─────────────────────────────────────────────
// PERCENTILE RANK
// ─────────────────────────────────────────────

/**
 * Returns the percentile rank of `value` within `series`.
 * 0 = lowest, 100 = highest.
 *
 * @param {number}   value
 * @param {number[]} series
 * @returns {number}  0–100
 */
export function percentileRank(value, series) {
  if (!series || series.length === 0) return 50;
  const below = series.filter(v => v <= value).length;
  return Math.round((below / series.length) * 100);
}
