/**
 * ONETO EUR/USD AI Tool — Validators
 * =====================================
 * Pure validation functions. No side effects. No imports.
 * Each function returns { valid: boolean, errors: string[] }.
 * Never throws.
 *
 * Architecture Freeze V4.0-R1 | Phase 2
 */

'use strict';

// ─────────────────────────────────────────────
// PRICE / PIP VALIDATORS
// ─────────────────────────────────────────────

/**
 * @param {number} n
 * @returns {boolean}
 */
export function isValidPrice(n) {
  return typeof n === 'number' && isFinite(n) && n > 0 && n < 10;
}

/**
 * @param {number} n
 * @returns {boolean}
 */
export function isValidPips(n) {
  return typeof n === 'number' && isFinite(n) && n > 0 && n <= 1000;
}

/**
 * @param {number} n
 * @returns {boolean}
 */
export function isValidLot(n) {
  return typeof n === 'number' && isFinite(n) && n >= 0.01 && n <= 100;
}

/**
 * @param {number} n
 * @returns {boolean}
 */
export function isValidScore(n) {
  return typeof n === 'number' && isFinite(n) && n >= 0 && n <= 100;
}

// ─────────────────────────────────────────────
// SIGNAL VALIDATOR
// ─────────────────────────────────────────────

const VALID_STRENGTHS = [
  'STRONG_BUY','BUY','WEAK_BUY','NEUTRAL',
  'WEAK_SELL','SELL','STRONG_SELL','NO_TRADE',
];
const VALID_DIRECTIONS = ['BUY','SELL','NEUTRAL'];
const VALID_STATUSES   = ['generated','open','closed','cancelled','no_trade'];

/**
 * Validates a Signal record.
 * @param {object} signal
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateSignal(signal) {
  const errors = [];
  if (!signal || typeof signal !== 'object') {
    return { valid: false, errors: ['Signal must be an object'] };
  }
  if (!VALID_STRENGTHS.includes(signal.signal_strength)) {
    errors.push(`Invalid signal_strength: "${signal.signal_strength}"`);
  }
  if (!VALID_DIRECTIONS.includes(signal.direction)) {
    errors.push(`Invalid direction: "${signal.direction}"`);
  }
  const scoreFields = ['final_score','final_confidence','technical_score',
    'macro_score','positioning_score','news_score','risk_score'];
  for (const f of scoreFields) {
    if (!isValidScore(signal[f])) errors.push(`"${f}" must be 0–100`);
  }
  if (signal.signal_strength !== 'NO_TRADE' && signal.signal_strength !== 'NEUTRAL') {
    if (!isValidPrice(signal.entry_price)) errors.push('entry_price invalid');
    if (!isValidPrice(signal.stop_loss))   errors.push('stop_loss invalid');
    if (!isValidPips(signal.sl_pips))      errors.push('sl_pips invalid');
  }
  return { valid: errors.length === 0, errors };
}

// ─────────────────────────────────────────────
// TRADE INPUT VALIDATOR
// ─────────────────────────────────────────────

/**
 * Validates a paper trade submission input.
 * @param {object} input
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateTradeInput(input) {
  const errors = [];
  if (!input || typeof input !== 'object') {
    return { valid: false, errors: ['Trade input must be an object'] };
  }
  if (!['BUY','SELL'].includes(input.direction)) {
    errors.push('direction must be BUY or SELL');
  }
  if (!isValidPrice(input.entry_price)) errors.push('entry_price must be a valid EUR/USD price');
  if (!isValidPrice(input.stop_loss))   errors.push('stop_loss must be a valid EUR/USD price');
  if (input.lot_size !== undefined && !isValidLot(input.lot_size)) {
    errors.push('lot_size must be between 0.01 and 100');
  }
  if (typeof input.account_balance === 'number' && input.account_balance <= 0) {
    errors.push('account_balance must be positive');
  }
  return { valid: errors.length === 0, errors };
}

// ─────────────────────────────────────────────
// ACCOUNT PROFILE VALIDATOR
// ─────────────────────────────────────────────

const VALID_RISK_PROFILES = ['conservative','standard','aggressive'];

/**
 * Validates an AccountProfile object.
 * @param {object} profile
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateAccountProfile(profile) {
  const errors = [];
  if (!profile || typeof profile !== 'object') {
    return { valid: false, errors: ['Profile must be an object'] };
  }
  if (typeof profile.account_balance !== 'number' || profile.account_balance <= 0) {
    errors.push('account_balance must be a positive number');
  }
  if (!VALID_RISK_PROFILES.includes(profile.risk_profile)) {
    errors.push(`risk_profile must be one of: ${VALID_RISK_PROFILES.join(', ')}`);
  }
  if (typeof profile.max_drawdown_limit !== 'number' ||
      profile.max_drawdown_limit <= 0 || profile.max_drawdown_limit > 1) {
    errors.push('max_drawdown_limit must be between 0 and 1');
  }
  if (typeof profile.min_confidence !== 'number' ||
      profile.min_confidence < 0 || profile.min_confidence > 100) {
    errors.push('min_confidence must be 0–100');
  }
  return { valid: errors.length === 0, errors };
}

// ─────────────────────────────────────────────
// WEIGHT CONFIG VALIDATOR
// ─────────────────────────────────────────────

/**
 * Validates that a WeightConfig object has valid values summing to 1.00.
 * @param {object} weights
 * @returns {{ valid: boolean, errors: string[], sum: number }}
 */
export function validateWeightConfig(weights) {
  const errors = [];
  if (!weights || typeof weights !== 'object') {
    return { valid: false, errors: ['Weights must be an object'], sum: 0 };
  }
  const keys = ['technical','macro','positioning','news','risk'];
  let sum = 0;
  for (const k of keys) {
    const v = weights[k];
    if (typeof v !== 'number' || v < 0 || v > 1) {
      errors.push(`weights.${k} must be 0–1`);
    } else {
      sum += v;
    }
  }
  if (Math.abs(sum - 1.0) >= 0.001) {
    errors.push(`Weights must sum to 1.00, got ${sum.toFixed(4)}`);
  }
  return { valid: errors.length === 0, errors, sum: parseFloat(sum.toFixed(4)) };
}

// ─────────────────────────────────────────────
// CANDLE VALIDATOR
// ─────────────────────────────────────────────

/**
 * Validates a single Candle object.
 * @param {object} c
 * @returns {boolean}
 */
export function isValidCandle(c) {
  return c && typeof c === 'object'
    && typeof c.time  === 'number' && c.time > 0
    && typeof c.open  === 'number' && c.open  > 0
    && typeof c.high  === 'number' && c.high  >= c.open && c.high >= c.close
    && typeof c.low   === 'number' && c.low   <= c.open && c.low  <= c.close
    && typeof c.close === 'number' && c.close > 0;
}

/**
 * Validates a candle array — returns count of invalid candles.
 * @param {Array} candles
 * @returns {{ valid: boolean, total: number, invalid: number }}
 */
export function validateCandles(candles) {
  if (!Array.isArray(candles)) return { valid: false, total: 0, invalid: 0 };
  const invalid = candles.filter(c => !isValidCandle(c)).length;
  return { valid: invalid === 0, total: candles.length, invalid };
}
