/**
 * ONETO EUR/USD AI Tool — ExecutionManager
 * ==========================================
 * Routes validated signals to the correct execution layer.
 * Enforces safety gates before any execution.
 *
 * Execution modes:
 *   'paper'  → PaperExecution (always available)
 *   'live'   → OandaExecution (interface only, requires explicit activation)
 *
 * Safety rules (mandated by Architecture Freeze V4.0-R1):
 *   · Default mode is always 'paper'
 *   · Live mode requires explicit human opt-in after full validation
 *   · System never switches to live mode automatically
 *   · Learning Engine recommendations NEVER trigger live trades
 *   · NO_TRADE signals are never executed
 *
 * Architecture Freeze V4.0-R1 | Phase 1
 */

'use strict';

import * as PaperExecution from './PaperExecution.js';
import * as OandaExecution from './OandaExecution.js';
import { SIGNAL_STRENGTH, SIGNAL_DIRECTION, isActionable } from '../types/Signal.js';

// ─────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────

const STORAGE_KEY_MODE = 'execution_mode_v4';

/** Internal execution mode — defaults to 'paper', never auto-switches */
let _mode = _loadMode();

/** Human-confirmed live activation flag — requires explicit call to activateLive() */
let _liveActivated = false;

// ─────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────

/**
 * Returns the current execution mode.
 * @returns {'paper'|'live'}
 */
export function getMode() {
  return _mode;
}

/**
 * Returns whether live trading is activated.
 * Always false unless explicitly activated by human.
 * @returns {boolean}
 */
export function isLiveActivated() {
  return _liveActivated && _mode === 'live';
}

/**
 * Sets execution mode to 'paper'.
 * Always safe to call.
 */
export function setPaperMode() {
  _mode = 'paper';
  _persistMode();
  _emit('executionModeChanged', { mode: 'paper' });
}

/**
 * Attempts to set execution mode to 'live'.
 * Requires all safety gates to pass.
 * Returns { success, reason }.
 *
 * @param {object} options
 * @param {TradingStats} options.paperStats  - from PaperExecution.getStats()
 * @param {string}  options.apiKey           - OANDA API key
 * @param {string}  options.accountId        - OANDA account ID
 * @param {boolean} options.humanConfirmed   - must be explicitly true
 * @returns {{ success: boolean, reason: string }}
 */
export function requestLiveMode(options = {}) {
  const { paperStats, apiKey, accountId, humanConfirmed } = options;

  // Gate 1: Explicit human confirmation
  if (!humanConfirmed) {
    return { success: false, reason: 'Human confirmation required. Set humanConfirmed: true.' };
  }

  // Gate 2: Paper trading validation
  if (!paperStats?.go_live_eligible) {
    return {
      success: false,
      reason: `Paper trading validation incomplete. Need: 100+ trades, win rate ≥60%, profit factor ≥1.5. `
            + `Current: ${paperStats?.closed ?? 0} trades, ${((paperStats?.win_rate ?? 0) * 100).toFixed(1)}% WR.`,
    };
  }

  // Gate 3: API credentials
  if (!apiKey || !accountId) {
    return { success: false, reason: 'OANDA API key and account ID required.' };
  }

  // Gate 4: OandaExecution not implemented yet
  const activation = OandaExecution.isActivated();
  if (!activation.activated) {
    return {
      success: false,
      reason: 'OandaExecution interface is not yet implemented. '
            + 'Live trading will be available in a future version.',
    };
  }

  _mode = 'live';
  _liveActivated = true;
  _persistMode();
  _emit('executionModeChanged', { mode: 'live' });
  return { success: true, reason: 'Live mode activated.' };
}

// ─────────────────────────────────────────────
// EXECUTION
// ─────────────────────────────────────────────

/**
 * Executes a signal through the current execution layer.
 * Pre-validates signal before routing.
 * Never throws.
 *
 * @param {Signal} signal
 * @param {ExecutionOptions} [options]
 * @returns {ExecutionResult}
 */
export function execute(signal, options = {}) {
  try {
    return _execute(signal, options);
  } catch (err) {
    console.error('[ExecutionManager] execute error:', err.message);
    return { success: false, error: err.message, trade: null };
  }
}

/**
 * Closes a trade by ID through the active execution layer.
 * Never throws.
 *
 * @param {string} tradeId
 * @param {number} exitPrice
 * @param {string} [exitReason]
 * @returns {ExecutionResult}
 */
export function closePosition(tradeId, exitPrice, exitReason = 'manual') {
  try {
    if (_mode === 'live' && _liveActivated) {
      return { success: false, error: 'Live close not implemented', trade: null };
    }
    const result = PaperExecution.closeTrade(tradeId, exitPrice, exitReason);
    if (result?.error) return { success: false, error: result.message, trade: null };
    return { success: true, trade: result, mode: 'paper' };
  } catch (err) {
    return { success: false, error: err.message, trade: null };
  }
}

/**
 * Returns all open positions from the active execution layer.
 * @returns {Array}
 */
export function getOpenPositions() {
  if (_mode === 'paper') {
    return PaperExecution.getOpen();
  }
  return [];
}

/**
 * Returns trade statistics from the paper execution layer.
 * Always reads from paper trades regardless of mode.
 * @returns {TradingStats}
 */
export function getStats() {
  return PaperExecution.getStats();
}

/**
 * Returns activation requirements for live trading.
 * @returns {ActivationRequirements}
 */
export function getLiveRequirements() {
  const stats = PaperExecution.getStats();
  return OandaExecution.getActivationRequirements(stats);
}

// ─────────────────────────────────────────────
// INTERNAL
// ─────────────────────────────────────────────

function _execute(signal, options) {
  // ── Safety Gate 1: Never execute NO_TRADE ──
  if (!isActionable(signal)) {
    return {
      success: false,
      error:   `Signal strength "${signal?.signal_strength}" is not actionable`,
      trade:   null,
      mode:    _mode,
    };
  }

  // ── Safety Gate 2: Confidence minimum ──
  const minConf = options.min_confidence ?? 65;
  if ((signal.final_confidence ?? 0) < minConf) {
    return {
      success: false,
      error:   `Signal confidence ${signal.final_confidence} below minimum ${minConf}`,
      trade:   null,
      mode:    _mode,
    };
  }

  // ── Safety Gate 3: Valid price levels ──
  if (!signal.entry_price || !signal.stop_loss || !signal.take_profit_2) {
    return {
      success: false,
      error:   'Signal has invalid price levels',
      trade:   null,
      mode:    _mode,
    };
  }

  // ── Route to execution layer ──
  if (_mode === 'live' && _liveActivated) {
    // Live path (not yet implemented)
    return { success: false, error: 'Live execution not implemented', trade: null, mode: 'live' };
  }

  // Paper execution (default)
  const trade = PaperExecution.submitTrade({
    direction:       signal.direction,
    entry_price:     signal.entry_price,
    stop_loss:       signal.stop_loss,
    take_profit_1:   signal.take_profit_1,
    take_profit_2:   signal.take_profit_2,
    lot_size:        signal.lot_size,
    account_balance: options.account_balance ?? 1000,
    risk_pct:        signal.effective_risk_pct ?? 0.02,
    signal_id:       signal.id,
  });

  if (trade?.error) {
    return { success: false, error: trade.message, trade: null, mode: 'paper' };
  }

  _emit('tradeExecuted', { trade, signal, mode: 'paper' });
  return { success: true, trade, mode: 'paper' };
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function _loadMode() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_MODE);
    return stored === 'live' ? 'live' : 'paper';  // default to paper
  } catch (_) {
    return 'paper';
  }
}

function _persistMode() {
  try { localStorage.setItem(STORAGE_KEY_MODE, _mode); } catch (_) {}
}

function _emit(eventName, data) {
  try {
    window.dispatchEvent(new CustomEvent(eventName, { detail: data }));
  } catch (_) {}
}

// ─────────────────────────────────────────────
// JSDoc typedefs
// ─────────────────────────────────────────────

/**
 * @typedef {Object} ExecutionOptions
 * @property {number}  [min_confidence]
 * @property {number}  [account_balance]
 */

/**
 * @typedef {Object} ExecutionResult
 * @property {boolean} success
 * @property {object|null} trade
 * @property {string}  mode      - 'paper'|'live'
 * @property {string}  [error]
 */