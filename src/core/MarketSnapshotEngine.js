/**
 * ONETO EUR/USD AI Tool — MarketSnapshotEngine
 * ==============================================
 * Captures a complete market state snapshot at the moment of each
 * signal generation cycle. Stores inline committee votes per
 * Phase 1 authorization.
 *
 * Stored fields per authorization:
 *   Price · DXY · US10Y · US02Y · VIX · ATR · Market Regime
 *   Committee Votes (inline snapshot array)
 *
 * Phase 1–4: Persisted to localStorage (ring buffer, last 200 snapshots).
 * Phase 5+:  Written to market_snapshots Supabase table.
 *
 * Architecture Freeze V4.0-R1 | Phase 1
 */

'use strict';

import {
  createMarketSnapshot,
  detectSession,
  toFeatureVector,
  validateSnapshot,
  PRICE_VS_MA,
  MTF_STATE,
} from '../types/MarketSnapshot.js';

// ─────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────

const STORAGE_KEY   = 'mse_snapshots_v4';
const MAX_SNAPSHOTS = 200;   // ring buffer — oldest evicted when full

// ─────────────────────────────────────────────
// IN-MEMORY STORE
// ─────────────────────────────────────────────

let _snapshots = _load();

// ─────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────

/**
 * Captures the current market state and returns a MarketSnapshot.
 * Does NOT persist automatically — call save() after capture.
 *
 * @param {object}  params
 * @param {object}  params.indicatorResult   - output of IndicatorService (or inline calc)
 * @param {string}  params.regime            - current market regime
 * @param {object}  params.mtfResult         - MTFEngine output
 * @param {Vote[]}  params.votes             - Committee agent votes (inline)
 * @param {number}  params.price             - current EUR/USD price
 * @param {string}  [params.signal_id]       - linked signal ID (set after signal created)
 * @param {string}  [params.data_source]     - 'live' | 'cached' | 'simulated'
 * @returns {MarketSnapshot}
 */
export function capture(params) {
  const {
    indicatorResult = {},
    regime          = 'ranging',
    mtfResult       = {},
    votes           = [],
    price           = 0,
    signal_id       = null,
    data_source     = 'simulated',
  } = params;

  const session = detectSession();

  const snap = createMarketSnapshot({
    signal_id,
    timestamp: Date.now(),

    // Price data
    price,
    spread: indicatorResult.spread ?? 0,
    bid:    price ? price - 0.00010 : 0,
    ask:    price ? price + 0.00010 : 0,
    timeframe: '4H',
    data_source,
    is_live: data_source === 'live',

    // Technical indicators
    atr_14:      indicatorResult.atr_14  ?? 0,
    atr_ratio:   indicatorResult.atr_ratio ?? 1,
    rsi_14:      indicatorResult.rsi_14  ?? 50,
    macd_line:   indicatorResult.macd?.macd   ?? 0,
    macd_signal: indicatorResult.macd?.signal ?? 0,
    macd_hist:   indicatorResult.macd?.hist   ?? 0,
    bb_upper:    indicatorResult.bb?.upper ?? 0,
    bb_mid:      indicatorResult.bb?.mid   ?? 0,
    bb_lower:    indicatorResult.bb?.lower ?? 0,
    bb_width:    indicatorResult.bb
      ? indicatorResult.bb.upper - indicatorResult.bb.lower
      : 0,
    bb_width_percentile: indicatorResult.bb_width_pct ?? 50,
    ma20:        indicatorResult.ma20  ?? 0,
    ma50:        indicatorResult.ma50  ?? 0,
    ma200:       indicatorResult.ma200 ?? 0,
    adx_14:      indicatorResult.adx_14 ?? 0,

    // Price structure
    price_vs_ma20: _priceVsMA(price, indicatorResult.ma20),
    price_vs_ma50: _priceVsMA(price, indicatorResult.ma50),

    // Regime & session
    market_regime: regime,
    session,

    // Institutional data stubs (populated by memory layer in Phase 6)
    dxy_level:         indicatorResult.dxy_level    ?? 104.5,
    us10y_yield:       indicatorResult.us10y_yield  ?? 4.5,
    us02y_yield:       indicatorResult.us02y_yield  ?? 4.8,
    de10y_yield:       indicatorResult.de10y_yield  ?? 2.5,
    us_de_spread:      indicatorResult.us_de_spread ?? 2.0,
    vix_level:         indicatorResult.vix_level    ?? 15.0,
    cot_net_position:  indicatorResult.cot_net      ?? 0,
    cot_change_weekly: indicatorResult.cot_chg      ?? 0,
    cot_extreme:       indicatorResult.cot_extreme  ?? false,
    news_sentiment_24h: indicatorResult.news_sentiment ?? 0,
    economic_state:    indicatorResult.economic_state  ?? 'neutral',
    risk_sentiment:    indicatorResult.risk_sentiment  ?? 'neutral',

    // MTF alignment
    mtf_1d_bias:        mtfResult.bias_1d        ?? 0,
    mtf_4h_bias:        mtfResult.bias_4h        ?? 0,
    mtf_1h_bias:        mtfResult.bias_1h        ?? 0,
    mtf_score:          mtfResult.mtf_score      ?? 0,
    mtf_state:          mtfResult.mtf_state      ?? MTF_STATE.NOT_ALIGNED,
    mtf_confidence_adj: mtfResult.confidence_adj ?? 0,

    // Committee votes stored inline (per Phase 1 authorization)
    committee_votes_snapshot: _simplifyVotes(votes),
  });

  return snap;
}

/**
 * Saves a snapshot to the in-memory store and persists to localStorage.
 * Ring buffer: oldest snapshot evicted when MAX_SNAPSHOTS exceeded.
 *
 * @param {MarketSnapshot} snap
 * @returns {boolean}  true if saved successfully
 */
export function save(snap) {
  const { valid, errors } = validateSnapshot(snap);
  if (!valid) {
    console.warn('[MarketSnapshotEngine] Invalid snapshot, not saved:', errors);
    return false;
  }

  _snapshots.unshift(snap);
  if (_snapshots.length > MAX_SNAPSHOTS) {
    _snapshots = _snapshots.slice(0, MAX_SNAPSHOTS);
  }
  _persist();
  return true;
}

/**
 * Captures and immediately saves in one call.
 *
 * @param {object} params  - same as capture()
 * @returns {{ snap: MarketSnapshot, saved: boolean }}
 */
export function captureAndSave(params) {
  const snap  = capture(params);
  const saved = save(snap);
  return { snap, saved };
}

/**
 * Attaches a signal_id to the most recent snapshot that lacks one.
 * Called by SignalEngine after signal is generated.
 *
 * @param {string} signalId
 * @returns {boolean}  true if updated
 */
export function linkSignalId(signalId) {
  const idx = _snapshots.findIndex(s => s.signal_id === null);
  if (idx === -1) return false;
  // Snapshots are frozen — create a patched copy
  _snapshots[idx] = Object.freeze({ ..._snapshots[idx], signal_id: signalId });
  _persist();
  return true;
}

/**
 * Returns the most recent snapshot.
 * @returns {MarketSnapshot|null}
 */
export function getLatest() {
  return _snapshots[0] ?? null;
}

/**
 * Returns all stored snapshots (newest first).
 * @returns {MarketSnapshot[]}
 */
export function getAll() {
  return [..._snapshots];
}

/**
 * Returns snapshots linked to a specific signal_id.
 * @param {string} signalId
 * @returns {MarketSnapshot|null}
 */
export function getBySignalId(signalId) {
  return _snapshots.find(s => s.signal_id === signalId) ?? null;
}

/**
 * Returns the last N snapshots (newest first).
 * @param {number} n
 * @returns {MarketSnapshot[]}
 */
export function getLast(n) {
  return _snapshots.slice(0, n);
}

/**
 * Returns feature vectors for all snapshots that have a linked signal_id.
 * Used by LearningEngine similarity scoring (Phase 7).
 *
 * @returns {Array<{ id: string, signal_id: string, vector: number[] }>}
 */
export function getFeatureVectors() {
  return _snapshots
    .filter(s => s.signal_id !== null)
    .map(s => ({
      id:        s.id,
      signal_id: s.signal_id,
      vector:    toFeatureVector(s),
    }));
}

/**
 * Computes a quick summary of the current market snapshot for display.
 * Used by UI panels to show regime, session, and key indicator values.
 *
 * @returns {SnapshotSummary|null}
 */
export function getSummary() {
  const snap = _snapshots[0];
  if (!snap) return null;

  return {
    price:          snap.price,
    regime:         snap.market_regime,
    session:        snap.session,
    rsi_14:         snap.rsi_14,
    macd_hist:      snap.macd_hist,
    atr_ratio:      snap.atr_ratio,
    adx_14:         snap.adx_14,
    mtf_state:      snap.mtf_state,
    us_de_spread:   snap.us_de_spread,
    vix_level:      snap.vix_level,
    data_source:    snap.data_source,
    timestamp:      snap.timestamp,
    agents_snapshot: snap.committee_votes_snapshot,
  };
}

/**
 * Clears all stored snapshots (useful for testing / reset).
 */
export function clearAll() {
  _snapshots = [];
  try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
}

// ─────────────────────────────────────────────
// INDICATOR COMPUTATION HELPER
// ─────────────────────────────────────────────

/**
 * Computes all indicators needed for a MarketSnapshot from raw candles.
 * This is a convenience wrapper — engines may call this before capture().
 *
 * Returns an indicatorResult object compatible with capture()'s
 * `indicatorResult` parameter.
 *
 * @param {Candle[]} candles  - ascending time order, minimum 50 items
 * @returns {IndicatorResult}
 */
export function computeIndicators(candles) {
  if (!candles || candles.length < 20) {
    return _emptyIndicators();
  }

  const closes = candles.map(c => c.close);
  const highs  = candles.map(c => c.high);
  const lows   = candles.map(c => c.low);
  const last   = closes[closes.length - 1];

  // MA
  const ma20  = _sma(closes, 20);
  const ma50  = _sma(closes, 50);
  const ma200 = _sma(closes, 200);

  // RSI
  const rsi_14 = _rsi(closes, 14);

  // MACD
  const macd = _macd(closes);

  // Bollinger Bands
  const bb = _bollingerBands(closes, 20, 2);

  // ATR (14)
  const atr_14  = _atr(highs, lows, closes, 14);
  // ATR ratio: compare to 30-period average ATR
  const atr30   = _atrAvg(highs, lows, closes, 30);
  const atr_ratio = atr30 > 0 ? parseFloat((atr_14 / atr30).toFixed(3)) : 1.0;

  // ADX (14)
  const adx_14 = _adx(highs, lows, closes, 14);

  // BB width percentile (simple: current width vs last 30 values)
  const bb_width_pct = _bbWidthPercentile(closes, 30);

  return {
    ma20,
    ma50,
    ma200,
    rsi_14,
    macd,
    bb,
    atr_14,
    atr_ratio,
    adx_14,
    bb_width_pct,
    spread: 0,
    // Institutional data stubs (Phase 6 will populate from APIs)
    dxy_level:     104.5,
    us10y_yield:     4.5,
    us02y_yield:     4.8,
    de10y_yield:     2.5,
    us_de_spread:    2.0,
    vix_level:      15.0,
    cot_net:         0,
    cot_chg:         0,
    cot_extreme:     false,
    news_sentiment:  0,
    economic_state:  'neutral',
    risk_sentiment:  'neutral',
  };
}

// ─────────────────────────────────────────────
// INDICATOR MATH (self-contained, no external deps)
// ─────────────────────────────────────────────

function _sma(data, period) {
  if (data.length < period) return 0;
  const slice = data.slice(-period);
  return parseFloat((slice.reduce((s, v) => s + v, 0) / period).toFixed(5));
}

function _rsi(data, period = 14) {
  if (data.length < period + 1) return 50;
  let gains = 0, losses = 0;
  const start = data.length - period;
  for (let i = start; i < data.length; i++) {
    const diff = data[i] - data[i - 1];
    if (diff > 0) gains += diff;
    else          losses -= diff;
  }
  const ag = gains / period;
  const al = losses / period;
  if (al === 0) return 100;
  return parseFloat((100 - 100 / (1 + ag / al)).toFixed(2));
}

function _ema(data, period) {
  if (!data.length) return 0;
  const k = 2 / (period + 1);
  return data.reduce((prev, val, i) => i === 0 ? val : val * k + prev * (1 - k), data[0]);
}

function _macd(data) {
  if (data.length < 26) return { macd: 0, signal: 0, hist: 0 };
  const k12 = 2 / 13, k26 = 2 / 27, k9 = 2 / 10;

  let e12 = data[0], e26 = data[0];
  const macdLine = [];
  for (let i = 1; i < data.length; i++) {
    e12 = data[i] * k12 + e12 * (1 - k12);
    e26 = data[i] * k26 + e26 * (1 - k26);
    macdLine.push(e12 - e26);
  }

  let sig = macdLine[0];
  for (let i = 1; i < macdLine.length; i++) {
    sig = macdLine[i] * k9 + sig * (1 - k9);
  }
  const last = macdLine[macdLine.length - 1];
  return {
    macd:   parseFloat(last.toFixed(6)),
    signal: parseFloat(sig.toFixed(6)),
    hist:   parseFloat((last - sig).toFixed(6)),
  };
}

function _bollingerBands(data, period = 20, stdMult = 2) {
  if (data.length < period) return { upper: 0, mid: 0, lower: 0 };
  const slice = data.slice(-period);
  const avg   = slice.reduce((s, v) => s + v, 0) / period;
  const sd    = Math.sqrt(slice.reduce((s, v) => s + (v - avg) ** 2, 0) / period);
  return {
    upper: parseFloat((avg + stdMult * sd).toFixed(5)),
    mid:   parseFloat(avg.toFixed(5)),
    lower: parseFloat((avg - stdMult * sd).toFixed(5)),
  };
}

function _atr(highs, lows, closes, period = 14) {
  if (highs.length < period + 1) return 0;
  const trs = [];
  for (let i = 1; i < highs.length; i++) {
    trs.push(Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i]  - closes[i - 1]),
    ));
  }
  const recent = trs.slice(-period);
  return parseFloat((recent.reduce((s, v) => s + v, 0) / period).toFixed(5));
}

function _atrAvg(highs, lows, closes, period = 30) {
  // Average ATR over the last `period` bars (used for ratio)
  return _atr(highs, lows, closes, period);
}

function _adx(highs, lows, closes, period = 14) {
  if (highs.length < period * 2) return 0;
  let posSum = 0, negSum = 0, trSum = 0;
  for (let i = 1; i <= period; i++) {
    const idx = highs.length - period + i - 1;
    const upMove   = highs[idx]  - highs[idx - 1];
    const downMove = lows[idx - 1] - lows[idx];
    const dmPos = (upMove > downMove && upMove > 0) ? upMove : 0;
    const dmNeg = (downMove > upMove && downMove > 0) ? downMove : 0;
    const tr = Math.max(
      highs[idx] - lows[idx],
      Math.abs(highs[idx] - closes[idx - 1]),
      Math.abs(lows[idx]  - closes[idx - 1]),
    );
    posSum += dmPos;
    negSum += dmNeg;
    trSum  += tr;
  }
  if (trSum === 0) return 0;
  const diPos = (posSum / trSum) * 100;
  const diNeg = (negSum / trSum) * 100;
  const diSum = diPos + diNeg;
  if (diSum === 0) return 0;
  return parseFloat((Math.abs(diPos - diNeg) / diSum * 100).toFixed(2));
}

function _bbWidthPercentile(data, period = 30) {
  if (data.length < period + 20) return 50;
  const widths = [];
  for (let i = 20; i <= period + 20 && i <= data.length; i++) {
    const bb = _bollingerBands(data.slice(0, i), 20, 2);
    widths.push(bb.upper - bb.lower);
  }
  if (!widths.length) return 50;
  const current = widths[widths.length - 1];
  const sorted  = [...widths].sort((a, b) => a - b);
  const rank    = sorted.filter(w => w <= current).length;
  return Math.round((rank / sorted.length) * 100);
}

// ─────────────────────────────────────────────
// VOTE SIMPLIFICATION
// ─────────────────────────────────────────────

/**
 * Strips vote objects down to essential fields for inline storage.
 * Avoids bloating the snapshot with full vote objects.
 *
 * @param {Vote[]} votes
 * @returns {object[]}
 */
function _simplifyVotes(votes) {
  if (!Array.isArray(votes)) return [];
  return votes.map(v => ({
    agent:      v.agent,
    score:      v.score,
    vote:       v.vote,
    weight:     v.weight,
    confidence: v.confidence,
    reason_1:   v.reason_1,
  }));
}

function _priceVsMA(price, ma) {
  if (!price || !ma) return PRICE_VS_MA.BELOW;
  const diff = Math.abs(price - ma);
  if (diff < 0.0003) return PRICE_VS_MA.CROSSING;
  return price > ma ? PRICE_VS_MA.ABOVE : PRICE_VS_MA.BELOW;
}

function _emptyIndicators() {
  return {
    ma20: 0, ma50: 0, ma200: 0, rsi_14: 50,
    macd: { macd: 0, signal: 0, hist: 0 },
    bb:   { upper: 0, mid: 0, lower: 0 },
    atr_14: 0, atr_ratio: 1, adx_14: 0, bb_width_pct: 50,
    spread: 0, dxy_level: 104.5, us10y_yield: 4.5, us02y_yield: 4.8,
    de10y_yield: 2.5, us_de_spread: 2.0, vix_level: 15.0,
    cot_net: 0, cot_chg: 0, cot_extreme: false,
    news_sentiment: 0, economic_state: 'neutral', risk_sentiment: 'neutral',
  };
}

// ─────────────────────────────────────────────
// PERSISTENCE
// ─────────────────────────────────────────────

function _load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch (_) {}
  return [];
}

function _persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_snapshots));
  } catch (_) {}
}

// ─────────────────────────────────────────────
// JSDoc typedefs
// ─────────────────────────────────────────────

/**
 * @typedef {Object} IndicatorResult
 * @property {number} ma20
 * @property {number} ma50
 * @property {number} ma200
 * @property {number} rsi_14
 * @property {{ macd:number, signal:number, hist:number }} macd
 * @property {{ upper:number, mid:number, lower:number }} bb
 * @property {number} atr_14
 * @property {number} atr_ratio
 * @property {number} adx_14
 * @property {number} bb_width_pct
 * @property {number} spread
 * @property {number} dxy_level
 * @property {number} us10y_yield
 * @property {number} us02y_yield
 * @property {number} de10y_yield
 * @property {number} us_de_spread
 * @property {number} vix_level
 * @property {number} cot_net
 * @property {number} cot_chg
 * @property {boolean} cot_extreme
 * @property {number} news_sentiment
 * @property {string} economic_state
 * @property {string} risk_sentiment
 */

/**
 * @typedef {Object} SnapshotSummary
 * @property {number} price
 * @property {string} regime
 * @property {string} session
 * @property {number} rsi_14
 * @property {number} macd_hist
 * @property {number} atr_ratio
 * @property {number} adx_14
 * @property {string} mtf_state
 * @property {number} us_de_spread
 * @property {number} vix_level
 * @property {string} data_source
 * @property {number} timestamp
 * @property {Array}  agents_snapshot
 */