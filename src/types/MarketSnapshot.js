/**
 * ONETO EUR/USD AI Tool — MarketSnapshot Type Definition
 * ========================================================
 * Canonical shape for a complete market state record captured
 * at the moment of each signal generation.
 *
 * Stores: Price · DXY · US10Y · US02Y · VIX · ATR ·
 *         Market Regime · Committee Votes (per Phase 1 authorization)
 *
 * Used by: MarketSnapshotEngine (writer), LearningEngine (reader),
 *          BacktestEngine (reader), similarity scoring (Phase 7).
 *
 * Phase 1–4: Persisted to localStorage.
 * Phase 5+:  Written to market_snapshots Supabase table.
 *
 * Architecture Freeze V4.0-R1 | Phase 1
 */

'use strict';

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────

/** Trading session labels */
export const SESSION = Object.freeze({
  LONDON:   'london',
  NEWYORK:  'newyork',
  ASIAN:    'asian',
  OVERLAP:  'overlap',   // London + New York overlap
  OFF:      'off',
});

/** MTF alignment states (duplicated from Signal.js for self-contained import) */
export const MTF_STATE = Object.freeze({
  FULLY_ALIGNED:    'fully_aligned',
  PARTIALLY_ALIGNED:'partially_aligned',
  PRIMARY_ONLY:     'primary_only',
  NOT_ALIGNED:      'not_aligned',
});

/** Price position relative to a moving average */
export const PRICE_VS_MA = Object.freeze({
  ABOVE:    'above',
  BELOW:    'below',
  CROSSING: 'crossing',
});

/** Risk sentiment labels */
export const RISK_SENTIMENT = Object.freeze({
  RISK_ON:  'risk_on',
  RISK_OFF: 'risk_off',
  NEUTRAL:  'neutral',
});

// ─────────────────────────────────────────────
// FACTORY FUNCTION
// ─────────────────────────────────────────────

/**
 * Creates a fully-formed MarketSnapshot record.
 * Safe defaults for every missing field.
 * Never throws.
 *
 * @param {Partial<MarketSnapshot>} fields
 * @returns {MarketSnapshot}
 */
export function createMarketSnapshot(fields = {}) {
  const now = Date.now();

  return Object.freeze({
    // ── Identity ──
    id:         fields.id         ?? generateSnapshotId(),
    signal_id:  fields.signal_id  ?? null,
    timestamp:  fields.timestamp  ?? now,
    created_at: fields.created_at ?? new Date(now).toISOString(),

    // ── Price Data ──
    price:    toFloat(fields.price,  0),
    spread:   toFloat(fields.spread, 0),
    bid:      toFloat(fields.bid,    0),
    ask:      toFloat(fields.ask,    0),
    timeframe: fields.timeframe ?? '4H',

    // ── Technical Indicators ──
    atr_14:       toFloat(fields.atr_14,       0),
    atr_ratio:    toFloat(fields.atr_ratio,     1),   // current / 30d avg; 1.0 = average
    rsi_14:       toFloat(fields.rsi_14,       50),
    macd_line:    toFloat(fields.macd_line,     0),
    macd_signal:  toFloat(fields.macd_signal,   0),
    macd_hist:    toFloat(fields.macd_hist,     0),
    bb_upper:     toFloat(fields.bb_upper,      0),
    bb_mid:       toFloat(fields.bb_mid,        0),
    bb_lower:     toFloat(fields.bb_lower,      0),
    bb_width:     toFloat(fields.bb_width,      0),
    bb_width_percentile: toFloat(fields.bb_width_percentile, 50),
    ma20:         toFloat(fields.ma20,          0),
    ma50:         toFloat(fields.ma50,          0),
    ma200:        toFloat(fields.ma200,         0),
    adx_14:       toFloat(fields.adx_14,        0),

    // ── Price Structure ──
    price_vs_ma20: fields.price_vs_ma20 ?? PRICE_VS_MA.BELOW,
    price_vs_ma50: fields.price_vs_ma50 ?? PRICE_VS_MA.BELOW,

    // ── Market Regime ──
    market_regime: fields.market_regime ?? 'ranging',
    session:       fields.session        ?? SESSION.OFF,

    // ── Institutional Data (populated Phase 6+; stubs in Phase 1–4) ──
    dxy_level:         toFloat(fields.dxy_level,         104.5),  // DXY stub
    us10y_yield:       toFloat(fields.us10y_yield,         4.5),  // 10Y Treasury yield stub
    us02y_yield:       toFloat(fields.us02y_yield,         4.8),  // 2Y Treasury yield stub
    de10y_yield:       toFloat(fields.de10y_yield,         2.5),  // German Bund yield stub
    us_de_spread:      toFloat(fields.us_de_spread,        2.0),  // US10Y - DE10Y stub
    vix_level:         toFloat(fields.vix_level,          15.0),  // VIX stub
    cot_net_position:  toInt(fields.cot_net_position,       0),   // EUR futures net position
    cot_change_weekly: toInt(fields.cot_change_weekly,      0),
    cot_extreme:       fields.cot_extreme ?? false,

    // ── Sentiment ──
    news_sentiment_24h: toInt(fields.news_sentiment_24h,   0),    // -100 to +100
    economic_state:     fields.economic_state ?? 'neutral',       // expansion | contraction | neutral
    risk_sentiment:     fields.risk_sentiment  ?? RISK_SENTIMENT.NEUTRAL,

    // ── MTF Alignment (from MTFEngine) ──
    mtf_1d_bias:        toFloat(fields.mtf_1d_bias,  0),
    mtf_4h_bias:        toFloat(fields.mtf_4h_bias,  0),
    mtf_1h_bias:        toFloat(fields.mtf_1h_bias,  0),
    mtf_score:          toFloat(fields.mtf_score,    0),
    mtf_state:          fields.mtf_state           ?? MTF_STATE.NOT_ALIGNED,
    mtf_confidence_adj: toInt(fields.mtf_confidence_adj, 0),

    // ── Committee Votes Snapshot (stored inline per Phase 1 authorization) ──
    // Array of simplified vote records for fast retrieval without JOIN
    committee_votes_snapshot: Array.isArray(fields.committee_votes_snapshot)
      ? fields.committee_votes_snapshot
      : [],

    // ── Data Source Quality ──
    data_source: fields.data_source ?? 'simulated',   // 'live' | 'cached' | 'simulated'
    is_live:     fields.is_live     ?? false,
  });
}

// ─────────────────────────────────────────────
// SESSION DETECTION
// ─────────────────────────────────────────────

/**
 * Determines the current trading session from a UTC timestamp.
 * Session hours (UTC):
 *   Asian:       23:00 – 08:00
 *   London:      07:00 – 16:00
 *   New York:    12:00 – 21:00
 *   Overlap:     12:00 – 16:00 (London + New York)
 *
 * @param {number} [timestampMs=Date.now()]
 * @returns {string}  one of SESSION values
 */
export function detectSession(timestampMs = Date.now()) {
  const d    = new Date(timestampMs);
  const hour = d.getUTCHours();
  const min  = d.getUTCMinutes();
  const t    = hour + min / 60;  // fractional hour UTC

  const inLondon  = t >= 7  && t < 16;
  const inNY      = t >= 12 && t < 21;
  const inAsian   = t >= 23 || t < 8;

  if (inLondon && inNY) return SESSION.OVERLAP;
  if (inLondon)         return SESSION.LONDON;
  if (inNY)             return SESSION.NEWYORK;
  if (inAsian)          return SESSION.ASIAN;
  return SESSION.OFF;
}

// ─────────────────────────────────────────────
// FEATURE VECTOR (for similarity scoring, Phase 7)
// ─────────────────────────────────────────────

/**
 * Extracts a normalized feature vector from a MarketSnapshot.
 * Used by LearningEngine for cosine similarity calculations (Phase 7).
 * Returned as a plain array of numbers, all normalized to [0, 1].
 *
 * Features:
 *   [0] rsi_14_norm          (rsi_14 / 100)
 *   [1] macd_hist_norm       (sigmoid of macd_hist × 1000)
 *   [2] bb_position          (0=at lower, 0.5=mid, 1=at upper)
 *   [3] adx_14_norm          (adx_14 / 50, capped at 1)
 *   [4] atr_ratio_norm       (atr_ratio / 3, capped at 1)
 *   [5] news_sentiment_norm  ((news_sentiment_24h + 100) / 200)
 *   [6] us_de_spread_norm    (spread / 5, capped at 1)
 *   [7] dxy_trend_code       (0=falling, 0.5=ranging, 1=rising)
 *
 * @param {MarketSnapshot} snap
 * @returns {number[]}  length-8 array, all values in [0, 1]
 */
export function toFeatureVector(snap) {
  const bbRange  = (snap.bb_upper - snap.bb_lower) || 1;
  const bbPos    = (snap.price - snap.bb_lower) / bbRange;

  // Sigmoid helper for MACD normalization
  const sig = (x) => 1 / (1 + Math.exp(-x));

  // DXY trend: below 103 = 0 (falling), 103–106 = 0.5, above 106 = 1
  const dxyCode = snap.dxy_level < 103 ? 0
    : snap.dxy_level > 106 ? 1
    : 0.5;

  return [
    clamp01(snap.rsi_14 / 100),
    sig(snap.macd_hist * 1000),
    clamp01(bbPos),
    clamp01(snap.adx_14 / 50),
    clamp01(snap.atr_ratio / 3),
    clamp01((snap.news_sentiment_24h + 100) / 200),
    clamp01(snap.us_de_spread / 5),
    dxyCode,
  ];
}

/**
 * Computes cosine similarity between two feature vectors.
 * Returns value in [-1, 1]; 1 = identical direction, -1 = opposite.
 *
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number}
 */
export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot  += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : parseFloat((dot / denom).toFixed(6));
}

// ─────────────────────────────────────────────
// VALIDATION
// ─────────────────────────────────────────────

/**
 * Validates a MarketSnapshot for required fields and legal ranges.
 *
 * @param {MarketSnapshot} snap
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateSnapshot(snap) {
  const errors = [];
  if (!snap || typeof snap !== 'object') {
    return { valid: false, errors: ['Snapshot is null or not an object'] };
  }
  if (snap.price <= 0) errors.push('price must be positive');
  if (snap.rsi_14 < 0 || snap.rsi_14 > 100) errors.push('rsi_14 must be 0–100');
  if (snap.atr_ratio < 0) errors.push('atr_ratio must be non-negative');
  if (!Object.values(SESSION).includes(snap.session)) {
    errors.push(`Invalid session: "${snap.session}"`);
  }
  if (!Object.values(MTF_STATE).includes(snap.mtf_state)) {
    errors.push(`Invalid mtf_state: "${snap.mtf_state}"`);
  }
  return { valid: errors.length === 0, errors };
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function toFloat(val, fallback = 0) {
  const n = parseFloat(val);
  return isNaN(n) ? fallback : n;
}

function toInt(val, fallback = 0) {
  const n = parseInt(val, 10);
  return isNaN(n) ? fallback : n;
}

function clamp01(v) {
  return Math.max(0, Math.min(1, isNaN(v) ? 0 : v));
}

function generateSnapshotId() {
  const ts  = Date.now().toString(36);
  const rnd = Math.random().toString(36).slice(2, 9);
  return `snap-${ts}-${rnd}`;
}

// ─────────────────────────────────────────────
// JSDoc typedefs
// ─────────────────────────────────────────────

/**
 * @typedef {Object} MarketSnapshot
 * @property {string}      id
 * @property {string|null} signal_id
 * @property {number}      timestamp
 * @property {string}      created_at
 * @property {number}      price
 * @property {number}      spread
 * @property {number}      bid
 * @property {number}      ask
 * @property {string}      timeframe
 * @property {number}      atr_14
 * @property {number}      atr_ratio
 * @property {number}      rsi_14
 * @property {number}      macd_line
 * @property {number}      macd_signal
 * @property {number}      macd_hist
 * @property {number}      bb_upper
 * @property {number}      bb_mid
 * @property {number}      bb_lower
 * @property {number}      bb_width
 * @property {number}      bb_width_percentile
 * @property {number}      ma20
 * @property {number}      ma50
 * @property {number}      ma200
 * @property {number}      adx_14
 * @property {string}      price_vs_ma20
 * @property {string}      price_vs_ma50
 * @property {string}      market_regime
 * @property {string}      session
 * @property {number}      dxy_level
 * @property {number}      us10y_yield
 * @property {number}      us02y_yield
 * @property {number}      de10y_yield
 * @property {number}      us_de_spread
 * @property {number}      vix_level
 * @property {number}      cot_net_position
 * @property {number}      cot_change_weekly
 * @property {boolean}     cot_extreme
 * @property {number}      news_sentiment_24h
 * @property {string}      economic_state
 * @property {string}      risk_sentiment
 * @property {number}      mtf_1d_bias
 * @property {number}      mtf_4h_bias
 * @property {number}      mtf_1h_bias
 * @property {number}      mtf_score
 * @property {string}      mtf_state
 * @property {number}      mtf_confidence_adj
 * @property {Array}       committee_votes_snapshot
 * @property {string}      data_source
 * @property {boolean}     is_live
 */