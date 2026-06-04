/**
 * ONETO EUR/USD AI Tool — Signal Type Definition
 * ================================================
 * Shared type / factory for all signal records produced by SignalEngine.
 * This is the canonical shape passed between engines, stored in DB,
 * and rendered by UI components.
 *
 * Architecture Freeze V4.0-R1 | Phase 1
 * Updated committee weights: Technical 30% · Macro 20% · Positioning 20%
 *                             News 15% · Risk 15%
 */

'use strict';

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────

/** All valid 8-state signal strength values */
export const SIGNAL_STRENGTH = Object.freeze({
  STRONG_BUY:  'STRONG_BUY',
  BUY:         'BUY',
  WEAK_BUY:    'WEAK_BUY',
  NEUTRAL:     'NEUTRAL',
  WEAK_SELL:   'WEAK_SELL',
  SELL:        'SELL',
  STRONG_SELL: 'STRONG_SELL',
  NO_TRADE:    'NO_TRADE',
});

/** Signal direction values */
export const SIGNAL_DIRECTION = Object.freeze({
  BUY:     'BUY',
  SELL:    'SELL',
  NEUTRAL: 'NEUTRAL',
});

/** Signal lifecycle status */
export const SIGNAL_STATUS = Object.freeze({
  GENERATED:  'generated',
  OPEN:       'open',
  CLOSED:     'closed',
  CANCELLED:  'cancelled',
  NO_TRADE:   'no_trade',
});

/** Default pip distances used when computing price levels */
export const DEFAULT_PIPS = Object.freeze({
  SL:  50,
  TP1: 80,
  TP2: 130,
  PIP_VALUE_STD: 10.0,   // USD per pip per standard lot (EUR/USD)
});

// ─────────────────────────────────────────────
// FACTORY FUNCTION
// ─────────────────────────────────────────────

/**
 * Creates a fully-formed Signal record.
 * Accepts a partial object and fills defaults for every missing field.
 * Never throws — returns a safe default signal on invalid input.
 *
 * @param {Partial<Signal>} fields
 * @returns {Signal}
 */
export function createSignal(fields = {}) {
  const now = Date.now();

  return Object.freeze({
    // ── Identity ──
    id:              fields.id              ?? generateId(),
    timestamp:       fields.timestamp       ?? now,
    created_at:      fields.created_at      ?? new Date(now).toISOString(),
    updated_at:      fields.updated_at      ?? new Date(now).toISOString(),

    // ── Classification ──
    signal_strength: fields.signal_strength ?? SIGNAL_STRENGTH.NO_TRADE,
    direction:       fields.direction       ?? SIGNAL_DIRECTION.NEUTRAL,
    status:          fields.status          ?? SIGNAL_STATUS.GENERATED,

    // ── Scores (0–100; higher = more bearish) ──
    final_score:       toInt(fields.final_score,       50),
    final_confidence:  toInt(fields.final_confidence,   0),
    technical_score:   toInt(fields.technical_score,   50),
    macro_score:       toInt(fields.macro_score,       50),
    positioning_score: toInt(fields.positioning_score, 50),
    news_score:        toInt(fields.news_score,        50),
    risk_score:        toInt(fields.risk_score,        50),
    agents_agreeing:   toInt(fields.agents_agreeing,    0),

    // ── Price Levels ──
    entry_price:   toFloat(fields.entry_price,   0),
    stop_loss:     toFloat(fields.stop_loss,     0),
    take_profit_1: toFloat(fields.take_profit_1, 0),
    take_profit_2: toFloat(fields.take_profit_2, 0),
    sl_pips:       toInt(fields.sl_pips,   DEFAULT_PIPS.SL),
    tp1_pips:      toInt(fields.tp1_pips,  DEFAULT_PIPS.TP1),
    tp2_pips:      toInt(fields.tp2_pips,  DEFAULT_PIPS.TP2),
    rr_ratio:      toFloat(fields.rr_ratio, 0),

    // ── Risk Manager Output ──
    lot_size:         toFloat(fields.lot_size,        0),
    max_loss_usd:     toFloat(fields.max_loss_usd,    0),
    expected_profit:  toFloat(fields.expected_profit, 0),
    effective_risk_pct: toFloat(fields.effective_risk_pct, 0),

    // ── Context ──
    timeframe:       fields.timeframe    ?? '4H',
    market_regime:   fields.market_regime ?? 'unknown',
    session:         fields.session       ?? 'unknown',
    mtf_state:       fields.mtf_state     ?? 'not_aligned',
    mtf_confidence_adj: toInt(fields.mtf_confidence_adj, 0),

    // ── Explanation (array of ExplanationItem) ──
    explanation: Array.isArray(fields.explanation) ? fields.explanation : [],

    // ── Gate Results ──
    gates: {
      mtf_pass:             fields.gates?.mtf_pass             ?? false,
      confidence_pass:      fields.gates?.confidence_pass      ?? false,
      rr_pass:              fields.gates?.rr_pass              ?? false,
      agent_agreement_pass: fields.gates?.agent_agreement_pass ?? false,
      drawdown_pass:        fields.gates?.drawdown_pass        ?? false,
      regime_pass:          fields.gates?.regime_pass          ?? false,
    },

    // ── No-trade reason (populated when signal_strength = NO_TRADE) ──
    no_trade_reason: fields.no_trade_reason ?? null,

    // ── References (populated after DB write in Phase 5) ──
    snapshot_id:      fields.snapshot_id      ?? null,
    macro_report_id:  fields.macro_report_id  ?? null,
  });
}

/**
 * Creates a NO_TRADE signal with a reason code.
 * Used by Decision Engine when any gate fails.
 *
 * @param {string} reason  - human-readable reason code
 * @param {object} context - partial context fields to include
 * @returns {Signal}
 */
export function createNoTradeSignal(reason, context = {}) {
  return createSignal({
    ...context,
    signal_strength:  SIGNAL_STRENGTH.NO_TRADE,
    direction:        SIGNAL_DIRECTION.NEUTRAL,
    status:           SIGNAL_STATUS.NO_TRADE,
    final_confidence: 0,
    no_trade_reason:  reason,
    gates: {
      mtf_pass:             reason !== 'MTF_NOT_ALIGNED',
      confidence_pass:      reason !== 'LOW_CONFIDENCE',
      rr_pass:              reason !== 'RR_TOO_LOW',
      agent_agreement_pass: reason !== 'AGENT_DISAGREEMENT',
      drawdown_pass:        reason !== 'DRAWDOWN_HALT' && reason !== 'CONSECUTIVE_LOSS_LIMIT',
      regime_pass:          reason !== 'VOLATILE_REGIME_BLOCKED',
    },
  });
}

// ─────────────────────────────────────────────
// VALIDATION
// ─────────────────────────────────────────────

/**
 * Validates a Signal object for completeness and legal values.
 * Returns { valid: boolean, errors: string[] }.
 * Never throws.
 *
 * @param {Signal} signal
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateSignal(signal) {
  const errors = [];

  if (!signal || typeof signal !== 'object') {
    return { valid: false, errors: ['Signal is null or not an object'] };
  }

  // Strength must be one of 8 valid values
  if (!Object.values(SIGNAL_STRENGTH).includes(signal.signal_strength)) {
    errors.push(`Invalid signal_strength: "${signal.signal_strength}"`);
  }

  // Direction must be valid
  if (!Object.values(SIGNAL_DIRECTION).includes(signal.direction)) {
    errors.push(`Invalid direction: "${signal.direction}"`);
  }

  // Scores must be 0–100
  const scoreFields = [
    'final_score', 'final_confidence', 'technical_score',
    'macro_score', 'positioning_score', 'news_score', 'risk_score',
  ];
  for (const field of scoreFields) {
    const v = signal[field];
    if (typeof v !== 'number' || v < 0 || v > 100) {
      errors.push(`Score "${field}" must be 0–100, got: ${v}`);
    }
  }

  // Price levels must be positive when signal is tradeable
  if (signal.signal_strength !== SIGNAL_STRENGTH.NO_TRADE &&
      signal.signal_strength !== SIGNAL_STRENGTH.NEUTRAL) {
    if (signal.entry_price <= 0) errors.push('entry_price must be positive');
    if (signal.stop_loss   <= 0) errors.push('stop_loss must be positive');
    if (signal.take_profit_1 <= 0) errors.push('take_profit_1 must be positive');
    if (signal.take_profit_2 <= 0) errors.push('take_profit_2 must be positive');
    if (signal.sl_pips   <= 0) errors.push('sl_pips must be positive');
    if (signal.rr_ratio  <= 0) errors.push('rr_ratio must be positive');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Returns true if the signal is actionable (not NO_TRADE or NEUTRAL).
 * @param {Signal} signal
 * @returns {boolean}
 */
export function isActionable(signal) {
  return signal != null &&
    signal.signal_strength !== SIGNAL_STRENGTH.NO_TRADE &&
    signal.signal_strength !== SIGNAL_STRENGTH.NEUTRAL;
}

/**
 * Returns true if the signal direction is SELL or a SELL variant.
 * @param {Signal} signal
 * @returns {boolean}
 */
export function isBearish(signal) {
  return signal?.direction === SIGNAL_DIRECTION.SELL;
}

/**
 * Returns true if the signal direction is BUY or a BUY variant.
 * @param {Signal} signal
 * @returns {boolean}
 */
export function isBullish(signal) {
  return signal?.direction === SIGNAL_DIRECTION.BUY;
}

/**
 * Returns the display label for a signal strength in the requested language.
 * Falls back to the internal code if i18n is not available.
 *
 * @param {string} strength - one of SIGNAL_STRENGTH values
 * @param {'en'|'zh'} lang
 * @returns {string}
 */
export function getStrengthLabel(strength, lang = 'zh') {
  const labels = {
    en: {
      STRONG_BUY:  'Strong Buy',
      BUY:         'Buy',
      WEAK_BUY:    'Weak Buy',
      NEUTRAL:     'Neutral',
      WEAK_SELL:   'Weak Sell',
      SELL:        'Sell',
      STRONG_SELL: 'Strong Sell',
      NO_TRADE:    'No Trade',
    },
    zh: {
      STRONG_BUY:  '强烈做多',
      BUY:         '做多',
      WEAK_BUY:    '轻仓做多',
      NEUTRAL:     '中性观望',
      WEAK_SELL:   '轻仓做空',
      SELL:        '做空',
      STRONG_SELL: '强烈做空',
      NO_TRADE:    '不操作',
    },
  };
  return (labels[lang] ?? labels.en)[strength] ?? strength;
}

// ─────────────────────────────────────────────
// PRICE LEVEL COMPUTATION
// ─────────────────────────────────────────────

/**
 * Computes entry, stop-loss, and take-profit price levels from
 * the current price and pip distances.
 *
 * @param {number} currentPrice
 * @param {'BUY'|'SELL'} direction
 * @param {number} [slPips=50]
 * @param {number} [tp1Pips=80]
 * @param {number} [tp2Pips=130]
 * @returns {PriceLevels}
 */
export function computePriceLevels(
  currentPrice,
  direction,
  slPips  = DEFAULT_PIPS.SL,
  tp1Pips = DEFAULT_PIPS.TP1,
  tp2Pips = DEFAULT_PIPS.TP2,
) {
  const PIP = 0.0001;
  const sign = direction === SIGNAL_DIRECTION.SELL ? 1 : -1;

  const entry_price   = round5(currentPrice);
  const stop_loss     = round5(currentPrice + sign * slPips  * PIP);
  const take_profit_1 = round5(currentPrice - sign * tp1Pips * PIP);
  const take_profit_2 = round5(currentPrice - sign * tp2Pips * PIP);
  const rr_ratio      = parseFloat((tp2Pips / slPips).toFixed(2));

  return {
    entry_price,
    stop_loss,
    take_profit_1,
    take_profit_2,
    sl_pips:  slPips,
    tp1_pips: tp1Pips,
    tp2_pips: tp2Pips,
    rr_ratio,
  };
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

/**
 * Generates a simple unique identifier (no external dependency).
 * Format: timestamp-randomhex (not RFC UUID but unique enough for client-side).
 * Phase 5 will replace with proper UUIDs from Supabase.
 *
 * @returns {string}
 */
export function generateId() {
  const ts  = Date.now().toString(36);
  const rnd = Math.random().toString(36).slice(2, 9);
  return `sig-${ts}-${rnd}`;
}

/** Safely parse integer with fallback */
function toInt(val, fallback = 0) {
  const n = parseInt(val, 10);
  return isNaN(n) ? fallback : n;
}

/** Safely parse float with fallback */
function toFloat(val, fallback = 0) {
  const n = parseFloat(val);
  return isNaN(n) ? fallback : n;
}

/** Round to 5 decimal places (pip precision) */
function round5(n) {
  return parseFloat(n.toFixed(5));
}

// ─────────────────────────────────────────────
// JSDoc typedefs (for IDE support; no runtime cost)
// ─────────────────────────────────────────────

/**
 * @typedef {Object} Signal
 * @property {string}  id
 * @property {number}  timestamp              - UNIX ms
 * @property {string}  created_at
 * @property {string}  updated_at
 * @property {string}  signal_strength        - 8-state enum
 * @property {string}  direction              - BUY | SELL | NEUTRAL
 * @property {string}  status
 * @property {number}  final_score            - 0–100
 * @property {number}  final_confidence       - 0–100
 * @property {number}  technical_score
 * @property {number}  macro_score
 * @property {number}  positioning_score
 * @property {number}  news_score
 * @property {number}  risk_score
 * @property {number}  agents_agreeing
 * @property {number}  entry_price
 * @property {number}  stop_loss
 * @property {number}  take_profit_1
 * @property {number}  take_profit_2
 * @property {number}  sl_pips
 * @property {number}  tp1_pips
 * @property {number}  tp2_pips
 * @property {number}  rr_ratio
 * @property {number}  lot_size
 * @property {number}  max_loss_usd
 * @property {number}  expected_profit
 * @property {number}  effective_risk_pct
 * @property {string}  timeframe
 * @property {string}  market_regime
 * @property {string}  session
 * @property {string}  mtf_state
 * @property {number}  mtf_confidence_adj
 * @property {Array}   explanation
 * @property {Object}  gates
 * @property {string|null} no_trade_reason
 * @property {string|null} snapshot_id
 * @property {string|null} macro_report_id
 */

/**
 * @typedef {Object} PriceLevels
 * @property {number} entry_price
 * @property {number} stop_loss
 * @property {number} take_profit_1
 * @property {number} take_profit_2
 * @property {number} sl_pips
 * @property {number} tp1_pips
 * @property {number} tp2_pips
 * @property {number} rr_ratio
 */

/**
 * @typedef {Object} ExplanationItem
 * @property {string} category  - 'technical'|'macro'|'news'|'risk'|'historical'
 * @property {string} color     - CSS color value
 * @property {string} text_en
 * @property {string} text_zh
 */