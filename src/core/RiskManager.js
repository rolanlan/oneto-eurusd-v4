/**
 * ONETO EUR/USD AI Tool — RiskManager
 * =====================================
 * Position sizing engine.
 * Reads account profile, signal SL/TP, and regime.
 * Applies 4 sequential multipliers to compute final lot size.
 * Manages system halt on drawdown breach.
 *
 * Multiplier chain (applied in order):
 *   1. Regime multiplier      (volatile=0.50, ranging=0.75, others=1.00)
 *   2. Drawdown multiplier    (based on consecutive_losses)
 *   3. Performance multiplier (based on recent win_rate)
 *   4. Risk score multiplier  (based on Risk Analyst score)
 *
 * Hard limits:
 *   min lot = 0.01
 *   max lot = account_balance / 2000
 *
 * Contract: calc() NEVER throws. Always returns a valid RiskResult.
 *
 * Architecture Freeze V4.0-R1 | Phase 1
 */

'use strict';

import { DEFAULT_PIPS } from '../types/Signal.js';

// ─────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────

/** Risk profile → risk percentage mapping */
const RISK_PCT = Object.freeze({
  conservative: 0.01,
  standard:     0.02,
  aggressive:   0.05,
});

/** Pip value for EUR/USD standard lot ($10 per pip) */
const PIP_VALUE_STD = 10.0;

/** Regime → position size multiplier */
const REGIME_MULTIPLIER = Object.freeze({
  trending_bull:  1.00,
  trending_bear:  1.00,
  ranging:        0.75,
  volatile:       0.50,
  breakout_up:    1.00,
  breakout_down:  1.00,
  unknown:        0.75,
});

/** Risk level thresholds (effective_risk_pct) */
const RISK_LEVELS = Object.freeze({
  LOW:      { max: 0.01,  color: '#4ade80', label_en: 'LOW RISK · Proceed',       label_zh: '低风险 · 建议执行'   },
  STANDARD: { max: 0.02,  color: '#fbbf24', label_en: 'STANDARD RISK · Proceed',  label_zh: '标准风险 · 可执行'   },
  ELEVATED: { max: 0.05,  color: '#f97316', label_en: 'ELEVATED RISK · Caution',  label_zh: '偏高风险 · 谨慎操作' },
  HIGH:     { max: Infinity, color: '#f87171', label_en: 'HIGH RISK · Warning',   label_zh: '高风险 · 警告'       },
});

// ─────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────

/**
 * Computes the complete risk/position specification for a trade.
 *
 * @param {RiskCalcParams} params
 * @returns {RiskResult}
 */
export function calc(params) {
  try {
    return _calc(params);
  } catch (err) {
    console.error('[RiskManager] Unexpected error:', err.message);
    return _errorResult(err.message);
  }
}

/**
 * Checks whether the system should halt due to drawdown limit breach.
 * Returns true if the account is in halt state.
 *
 * @param {AccountProfile} profile
 * @returns {{ halt: boolean, reason: string }}
 */
export function checkSystemHalt(profile) {
  if (!profile) return { halt: false, reason: '' };

  if (profile.current_drawdown >= profile.max_drawdown_limit) {
    return {
      halt:   true,
      reason: `Drawdown ${(profile.current_drawdown * 100).toFixed(1)}% ≥ limit ${(profile.max_drawdown_limit * 100).toFixed(1)}%`,
    };
  }
  if (profile.consecutive_losses >= profile.max_consecutive_losses) {
    return {
      halt:   true,
      reason: `${profile.consecutive_losses} consecutive losses ≥ limit ${profile.max_consecutive_losses}`,
    };
  }
  if (profile.daily_risk_used >= profile.max_risk_per_day) {
    return {
      halt:   false,   // soft halt — warn but don't fully block
      reason: `Daily risk ${(profile.daily_risk_used * 100).toFixed(1)}% ≥ daily limit ${(profile.max_risk_per_day * 100).toFixed(1)}%`,
    };
  }
  return { halt: false, reason: '' };
}

/**
 * Returns the Risk Analyst's position size multiplier from a Vote array.
 * Defaults to 1.00 if risk agent vote not found or has no metadata.
 *
 * @param {Vote[]} votes
 * @returns {number}
 */
export function extractRiskMultiplierFromVotes(votes) {
  if (!Array.isArray(votes)) return 1.00;
  const riskVote = votes.find(v => v.agent === 'risk');
  return riskVote?._size_multiplier ?? 1.00;
}

// ─────────────────────────────────────────────
// CORE CALCULATION
// ─────────────────────────────────────────────

function _calc(params) {
  const {
    account_balance    = 1000,
    risk_profile       = 'standard',
    sl_pips            = DEFAULT_PIPS.SL,
    tp_pips            = DEFAULT_PIPS.TP2,
    regime             = 'ranging',
    risk_score         = 50,
    consecutive_losses = 0,
    win_rate_20        = 0.5,
  } = params ?? {};

  // ── Guard: invalid inputs ──
  if (account_balance <= 0) {
    return _haltResult('Account balance must be positive');
  }
  if (sl_pips <= 0) {
    return _haltResult('Stop loss pips must be positive');
  }

  // ── Step 1: Base calculation ──
  const risk_pct    = RISK_PCT[risk_profile] ?? RISK_PCT.standard;
  const risk_amount = account_balance * risk_pct;
  const base_lot    = risk_amount / (sl_pips * PIP_VALUE_STD);

  // ── Step 2: Apply multipliers sequentially ──
  const m1 = _regimeMultiplier(regime);
  const m2 = _drawdownMultiplier(consecutive_losses);
  const m3 = _performanceMultiplier(win_rate_20);
  const m4 = _riskScoreMultiplier(risk_score);

  const final_lot_raw = base_lot * m1 * m2 * m3 * m4;

  // ── Step 3: Hard caps ──
  const min_lot = 0.01;
  const max_lot = parseFloat((account_balance / 2000).toFixed(2));
  const lot_size = Math.max(min_lot, Math.min(max_lot, parseFloat(final_lot_raw.toFixed(2))));

  // ── Step 4: Compute P&L estimates ──
  const max_loss_usd    = parseFloat((lot_size * sl_pips * PIP_VALUE_STD).toFixed(2));
  const expected_profit = parseFloat((lot_size * tp_pips * PIP_VALUE_STD).toFixed(2));
  const rr_ratio        = parseFloat((tp_pips / sl_pips).toFixed(2));
  const effective_risk_pct = parseFloat((max_loss_usd / account_balance).toFixed(4));

  // ── Step 5: Risk level ──
  const { level, color, label_en, label_zh } = _riskLevel(effective_risk_pct);

  // ── Step 6: Halt check ──
  const drawdown_warning = consecutive_losses >= 3;
  const system_halt      = false;   // Full halt check done by checkSystemHalt()

  return Object.freeze({
    // Primary outputs
    lot_size,
    base_lot_size:       parseFloat(base_lot.toFixed(4)),
    max_loss_usd,
    expected_profit_usd: expected_profit,
    rr_ratio,
    effective_risk_pct,

    // Multipliers (for transparency display)
    regime_multiplier:       m1,
    drawdown_multiplier:     m2,
    performance_multiplier:  m3,
    risk_score_multiplier:   m4,

    // Risk level
    risk_level:     level,
    level_color:    color,
    level_text_en:  label_en,
    level_text_zh:  label_zh,

    // Flags
    drawdown_warning,
    system_halt,

    // Input echo (for display)
    account_balance,
    risk_profile,
    sl_pips,
    tp_pips,
    regime,
    risk_score,
  });
}

// ─────────────────────────────────────────────
// MULTIPLIER FUNCTIONS
// ─────────────────────────────────────────────

function _regimeMultiplier(regime) {
  return REGIME_MULTIPLIER[regime] ?? 0.75;
}

function _drawdownMultiplier(consecutiveLosses) {
  if (consecutiveLosses >= 5) return 0.25;
  if (consecutiveLosses === 4) return 0.50;
  if (consecutiveLosses === 3) return 0.75;
  return 1.00;
}

function _performanceMultiplier(winRate20) {
  // No bonus on good performance — conservative by design
  return winRate20 < 0.40 ? 0.75 : 1.00;
}

function _riskScoreMultiplier(riskScore) {
  if (riskScore > 85) return 0.25;
  if (riskScore > 70) return 0.50;
  if (riskScore > 55) return 0.75;
  if (riskScore < 40) return 1.25;
  return 1.00;
}

// ─────────────────────────────────────────────
// RISK LEVEL CLASSIFICATION
// ─────────────────────────────────────────────

function _riskLevel(effectiveRiskPct) {
  if (effectiveRiskPct < RISK_LEVELS.LOW.max) {
    return { level: 'LOW', color: RISK_LEVELS.LOW.color, label_en: RISK_LEVELS.LOW.label_en, label_zh: RISK_LEVELS.LOW.label_zh };
  }
  if (effectiveRiskPct < RISK_LEVELS.STANDARD.max) {
    return { level: 'STANDARD', color: RISK_LEVELS.STANDARD.color, label_en: RISK_LEVELS.STANDARD.label_en, label_zh: RISK_LEVELS.STANDARD.label_zh };
  }
  if (effectiveRiskPct < RISK_LEVELS.ELEVATED.max) {
    return { level: 'ELEVATED', color: RISK_LEVELS.ELEVATED.color, label_en: RISK_LEVELS.ELEVATED.label_en, label_zh: RISK_LEVELS.ELEVATED.label_zh };
  }
  return { level: 'HIGH', color: RISK_LEVELS.HIGH.color, label_en: RISK_LEVELS.HIGH.label_en, label_zh: RISK_LEVELS.HIGH.label_zh };
}

// ─────────────────────────────────────────────
// ERROR RESULTS
// ─────────────────────────────────────────────

function _haltResult(reason) {
  return Object.freeze({
    lot_size: 0, base_lot_size: 0,
    max_loss_usd: 0, expected_profit_usd: 0, rr_ratio: 0,
    effective_risk_pct: 0,
    regime_multiplier: 1, drawdown_multiplier: 1,
    performance_multiplier: 1, risk_score_multiplier: 1,
    risk_level: 'HIGH', level_color: '#f87171',
    level_text_en: 'HALTED — ' + reason,
    level_text_zh: '已暂停 — ' + reason,
    drawdown_warning: true, system_halt: true,
    error: reason,
  });
}

function _errorResult(msg) {
  return _haltResult(msg ?? 'Unknown error');
}

// ─────────────────────────────────────────────
// JSDoc typedefs
// ─────────────────────────────────────────────

/**
 * @typedef {Object} RiskCalcParams
 * @property {number} account_balance
 * @property {string} risk_profile          - 'conservative'|'standard'|'aggressive'
 * @property {number} sl_pips
 * @property {number} tp_pips
 * @property {string} regime
 * @property {number} risk_score            - 0–100, from Risk Analyst vote
 * @property {number} consecutive_losses
 * @property {number} win_rate_20           - 0–1
 */

/**
 * @typedef {Object} RiskResult
 * @property {number}  lot_size
 * @property {number}  base_lot_size
 * @property {number}  max_loss_usd
 * @property {number}  expected_profit_usd
 * @property {number}  rr_ratio
 * @property {number}  effective_risk_pct
 * @property {number}  regime_multiplier
 * @property {number}  drawdown_multiplier
 * @property {number}  performance_multiplier
 * @property {number}  risk_score_multiplier
 * @property {string}  risk_level
 * @property {string}  level_color
 * @property {string}  level_text_en
 * @property {string}  level_text_zh
 * @property {boolean} drawdown_warning
 * @property {boolean} system_halt
 * @property {string}  [error]
 */