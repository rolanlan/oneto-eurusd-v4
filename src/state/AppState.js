/**
 * ONETO EUR/USD AI Tool — AppState
 * ==================================
 * Central in-memory runtime state store for the current session.
 * Single source of truth for candle arrays, current price,
 * last signal, active weights, and regime.
 *
 * V5.2: Added signal history ring buffer (max 200 entries).
 *   - _state.signalHistory[] — compact SignalHistoryEntry records
 *   - getSignalHistory(n)    — exported read accessor
 *   - History written AFTER _dispatch() so history errors never block events
 *   - localStorage key: 'oneto_signal_history_v5' (separate from runtime state)
 *
 * FREEZE-RULE-012 compliant: agent_votes stores only { vote, score } per agent.
 * No reason strings, no full explanation arrays.
 *
 * Event bus — components subscribe to:
 *   'stateUpdated'    — candles / price refreshed
 *   'signalGenerated' — new signal from SignalEngine
 *   'regimeChanged'   — regime classification changed
 *
 * Interface Contract 10 compliant.
 * Architecture Freeze V4.0-R1 | Phase 2 | V5.2 signal history
 */

'use strict';

import * as DataProvider from '../core/DataProvider.js';
import * as AccountState from './AccountState.js';
import { DEFAULT_WEIGHTS } from '../types/Vote.js';

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────

const HISTORY_KEY      = 'oneto_signal_history_v5';
const HISTORY_MAX      = 200;   // ring buffer cap (FREEZE-RULE-012)

// ─────────────────────────────────────────────
// INTERNAL STATE
// ─────────────────────────────────────────────

const _state = {
  // ── Market Data ──
  candles_1h:   [],
  candles_4h:   [],
  candles_1d:   [],
  currentPrice: 0,
  prevClose:    0,
  isLive:       false,
  dataSource:   'simulated',     // 'live' | 'cached' | 'simulated'

  // ── Signal ──
  lastSignal:  null,
  lastVotes:   [],
  lastVerdict: null,

  // ── Signal History (V5.2) ──
  // Compact ring buffer — max HISTORY_MAX entries, newest first.
  // Loaded from localStorage at module init; persisted after each signal.
  signalHistory: _loadHistory(),

  // ── Regime ──
  lastRegime:  null,

  // ── Committee Weights ──
  weights: { ...DEFAULT_WEIGHTS },

  // ── Session Meta ──
  lastRefresh:   0,
  refreshCount:  0,
  isRefreshing:  false,
};

// Event listener registry
const _listeners = {
  stateUpdated:    [],
  signalGenerated: [],
  regimeChanged:   [],
};

// ─────────────────────────────────────────────
// READ-ONLY ACCESSORS
// ─────────────────────────────────────────────

/** @returns {Candle[]} */
export function getCandles(interval = '4H') {
  switch (interval?.toUpperCase()) {
    case '1H': return [..._state.candles_1h];
    case '1D': return [..._state.candles_1d];
    default:   return [..._state.candles_4h];
  }
}

/** @returns {number} */
export function getCurrentPrice() {
  return _state.currentPrice;
}

/** @returns {number} */
export function getPrevClose() {
  return _state.prevClose;
}

/** @returns {boolean} */
export function getIsLive() {
  return _state.isLive;
}

/** @returns {string} */
export function getDataSource() {
  return _state.dataSource;
}

/** @returns {Signal|null} */
export function getLastSignal() {
  return _state.lastSignal ? { ..._state.lastSignal } : null;
}

/** @returns {Vote[]} */
export function getLastVotes() {
  return [..._state.lastVotes];
}

/** @returns {CommitteeVerdict|null} */
export function getLastVerdict() {
  return _state.lastVerdict ? { ..._state.lastVerdict } : null;
}

/** @returns {string|null} */
export function getLastRegime() {
  return _state.lastRegime;
}

/** @returns {WeightConfig} */
export function getWeights() {
  return { ..._state.weights };
}

/** @returns {number}  UNIX ms of last successful refresh */
export function getLastRefresh() {
  return _state.lastRefresh;
}

/** @returns {boolean} */
export function isRefreshing() {
  return _state.isRefreshing;
}

/**
 * Returns the last N signal history entries, newest first.
 * Returns a shallow copy of each entry — callers must not mutate.
 *
 * @param {number} [n=50]  — number of entries to return (max HISTORY_MAX)
 * @returns {SignalHistoryEntry[]}
 */
export function getSignalHistory(n = 50) {
  const count = Math.min(Math.max(1, n), HISTORY_MAX);
  return _state.signalHistory.slice(0, count).map(e => ({ ...e }));
}

/**
 * Returns the total number of signals recorded in history.
 * @returns {number}
 */
export function getSignalCount() {
  return _state.signalHistory.length;
}

/**
 * Returns a snapshot of the full state (read-only copy).
 * @returns {AppStateSnapshot}
 */
export function getSnapshot() {
  return {
    candles_1h:   [..._state.candles_1h],
    candles_4h:   [..._state.candles_4h],
    candles_1d:   [..._state.candles_1d],
    currentPrice: _state.currentPrice,
    prevClose:    _state.prevClose,
    isLive:       _state.isLive,
    dataSource:   _state.dataSource,
    lastSignal:   _state.lastSignal ? { ..._state.lastSignal } : null,
    lastVotes:    [..._state.lastVotes],
    lastVerdict:  _state.lastVerdict ? { ..._state.lastVerdict } : null,
    lastRegime:   _state.lastRegime,
    weights:      { ..._state.weights },
    lastRefresh:  _state.lastRefresh,
    signalCount:  _state.signalHistory.length,
  };
}

// ─────────────────────────────────────────────
// REFRESH
// ─────────────────────────────────────────────

/**
 * Fetches fresh price + all candle timeframes from DataProvider.
 * Updates internal state and dispatches 'stateUpdated'.
 * Never throws.
 *
 * @returns {Promise<void>}
 */
export async function refreshAll() {
  if (_state.isRefreshing) return;   // debounce concurrent calls
  _state.isRefreshing = true;

  try {
    const [priceResult, c4h, c1d, c1h, prevClose] = await Promise.all([
      DataProvider.getPrice(),
      DataProvider.getCandles('4H', 80),
      DataProvider.getCandles('1D', 60),
      DataProvider.getCandles('1H', 80),
      DataProvider.getPrevClose(),
    ]);

    _state.candles_4h   = c4h.candles;
    _state.candles_1d   = c1d.candles;
    _state.candles_1h   = c1h.candles;
    _state.currentPrice = priceResult.price;
    _state.prevClose    = prevClose;
    _state.isLive       = priceResult.source === 'live';
    _state.dataSource   = priceResult.source;
    _state.lastRefresh  = Date.now();
    _state.refreshCount++;

    _dispatch('stateUpdated', {
      price:       _state.currentPrice,
      isLive:      _state.isLive,
      dataSource:  _state.dataSource,
      candleCount: _state.candles_4h.length,
      timestamp:   _state.lastRefresh,
    });

  } catch (err) {
    console.error('[AppState] refreshAll error:', err.message);
  } finally {
    _state.isRefreshing = false;
  }
}

// ─────────────────────────────────────────────
// WRITE — called by SignalEngine after a cycle
// ─────────────────────────────────────────────

/**
 * Stores the result of a completed signal generation cycle.
 * Dispatches 'signalGenerated' and (if regime changed) 'regimeChanged'.
 *
 * V5.2: After dispatching events, appends a compact history entry.
 * History operations are isolated in try/catch — they cannot block event dispatch.
 *
 * @param {SignalEngineResult} result
 */
export function setSignalResult(result) {
  if (!result) return;

  const prevRegime = _state.lastRegime;

  // ── 1. Update live state ────────────────────
  _state.lastSignal  = result.signal  ?? null;
  _state.lastVotes   = result.votes   ?? [];
  _state.lastVerdict = result.verdict ?? null;
  _state.lastRegime  = result.regime  ?? null;

  // ── 2. Dispatch events (MUST happen before history) ─────
  // If history throws, events have already fired — existing panels are safe.
  _dispatch('signalGenerated', {
    signal:    _state.lastSignal,
    votes:     _state.lastVotes,
    regime:    _state.lastRegime,
    timestamp: Date.now(),
  });

  if (result.regime && result.regime !== prevRegime) {
    _dispatch('regimeChanged', {
      prev:    prevRegime,
      current: result.regime,
    });
  }

  // ── 3. Append to signal history (V5.2, AFTER dispatch) ──
  // Wrapped in try/catch: history errors must NEVER affect signal pipeline.
  try {
    const entry = _buildHistoryEntry(result.signal, result.votes);
    if (entry) {
      _state.signalHistory.unshift(entry);
      // Enforce ring buffer cap
      if (_state.signalHistory.length > HISTORY_MAX) {
        _state.signalHistory.length = HISTORY_MAX;
      }
      _persistHistory();
    }
  } catch (histErr) {
    console.warn('[AppState] History write error (non-fatal):', histErr.message);
  }
}

/**
 * Updates the active committee weights.
 * Used by Settings UI when user approves a Learning Engine proposal.
 *
 * @param {WeightConfig} weights
 */
export function setWeights(weights) {
  if (!weights) return;
  _state.weights = { ...DEFAULT_WEIGHTS, ...weights };
}

/**
 * Clears the signal history (both in-memory and localStorage).
 * Use with caution — this is permanent for the current session.
 */
export function clearSignalHistory() {
  _state.signalHistory = [];
  try { localStorage.removeItem(HISTORY_KEY); } catch (_) {}
}

// ─────────────────────────────────────────────
// EVENT BUS
// ─────────────────────────────────────────────

/**
 * Subscribes to an AppState event.
 * Returns an unsubscribe function.
 *
 * @param {'stateUpdated'|'signalGenerated'|'regimeChanged'} eventName
 * @param {Function} callback
 * @returns {Function}  call to unsubscribe
 */
export function subscribe(eventName, callback) {
  if (!_listeners[eventName]) return () => {};
  _listeners[eventName].push(callback);
  return () => {
    _listeners[eventName] = _listeners[eventName].filter(fn => fn !== callback);
  };
}

/**
 * Removes all subscribers for all events.
 * Useful for cleanup in tests.
 */
export function clearSubscribers() {
  for (const key of Object.keys(_listeners)) {
    _listeners[key] = [];
  }
}

// ─────────────────────────────────────────────
// AUTO-REFRESH TIMER
// ─────────────────────────────────────────────

let _refreshTimer = null;

/**
 * Starts an automatic refresh interval.
 * Refreshes candles + price on the given interval.
 *
 * @param {number} [intervalMs=240000]  - default 4 minutes (matches 4H candle TTL)
 */
export function startAutoRefresh(intervalMs = 240_000) {
  stopAutoRefresh();
  refreshAll();   // immediate first load
  _refreshTimer = setInterval(() => refreshAll(), intervalMs);
}

/**
 * Stops the auto-refresh timer.
 */
export function stopAutoRefresh() {
  if (_refreshTimer) {
    clearInterval(_refreshTimer);
    _refreshTimer = null;
  }
}

// ─────────────────────────────────────────────
// LANGUAGE CHANGE HANDLER
// ─────────────────────────────────────────────

/**
 * Listens for language changes and dispatches stateUpdated
 * so all panels re-render with new locale strings.
 */
try {
  window.addEventListener('languagechange', () => {
    _dispatch('stateUpdated', { reason: 'languagechange', timestamp: Date.now() });
  });
} catch (_) {}

// ─────────────────────────────────────────────
// SIGNAL HISTORY — INTERNAL HELPERS (V5.2)
// ─────────────────────────────────────────────

/**
 * Builds a compact SignalHistoryEntry from a signal and votes array.
 * Per FREEZE-RULE-012: agent_votes stores only { vote, score } — no reason strings.
 *
 * @param {Signal|null} signal
 * @param {Vote[]} votes
 * @returns {SignalHistoryEntry|null}
 */
function _buildHistoryEntry(signal, votes) {
  if (!signal) return null;

  // Build compact agent_votes: { agentName: { vote, score } }
  // No reason_1, reason_2, or explanation (FREEZE-RULE-012)
  const agent_votes = {};
  if (Array.isArray(votes)) {
    for (const v of votes) {
      if (v?.agent) {
        agent_votes[v.agent] = {
          vote:  v.vote  ?? 'NEUTRAL',
          score: v.score ?? 50,
        };
      }
    }
  }

  return Object.freeze({
    // Identity
    id:               signal.id,
    timestamp:        signal.timestamp ?? Date.now(),

    // Classification
    signal_strength:  signal.signal_strength  ?? 'NO_TRADE',
    direction:        signal.direction         ?? 'NEUTRAL',
    no_trade_reason:  signal.no_trade_reason   ?? null,

    // Scores
    final_score:      signal.final_score      ?? 50,
    final_confidence: signal.final_confidence ?? 0,

    // Price levels (key fields for performance attribution)
    entry_price:      signal.entry_price   ?? 0,
    stop_loss:        signal.stop_loss     ?? 0,
    take_profit_2:    signal.take_profit_2 ?? 0,
    sl_pips:          signal.sl_pips       ?? 0,
    tp2_pips:         signal.tp2_pips      ?? 0,
    lot_size:         signal.lot_size      ?? 0,
    effective_risk_pct: signal.effective_risk_pct ?? 0,

    // Context
    market_regime:    signal.market_regime  ?? 'unknown',
    mtf_state:        signal.mtf_state      ?? 'unknown',
    timeframe:        signal.timeframe      ?? '4H',

    // Gate results (all 6)
    gates: signal.gates ? {
      mtf_pass:             signal.gates.mtf_pass             ?? false,
      confidence_pass:      signal.gates.confidence_pass      ?? false,
      rr_pass:              signal.gates.rr_pass              ?? false,
      agent_agreement_pass: signal.gates.agent_agreement_pass ?? false,
      drawdown_pass:        signal.gates.drawdown_pass        ?? false,
      regime_pass:          signal.gates.regime_pass          ?? false,
    } : {},

    // Agent votes — compact only (FREEZE-RULE-012)
    agent_votes,
  });
}

/**
 * Loads signal history from localStorage.
 * Returns an empty array if nothing is stored or parsing fails.
 * Called once at module initialization.
 *
 * @returns {SignalHistoryEntry[]}
 */
function _loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Enforce cap on load in case a previous version stored more
    return parsed.slice(0, HISTORY_MAX);
  } catch (_) {
    return [];
  }
}

/**
 * Persists the current in-memory signal history to localStorage.
 * Silent on failure — localStorage may be unavailable or full.
 */
function _persistHistory() {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(_state.signalHistory));
  } catch (_) {
    // localStorage full or unavailable — non-fatal, history stays in memory
  }
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function _dispatch(eventName, data) {
  // Internal listeners
  const fns = _listeners[eventName] ?? [];
  for (const fn of fns) {
    try { fn(data); } catch (err) {
      console.warn(`[AppState] Listener error (${eventName}):`, err.message);
    }
  }
  // Also dispatch as window CustomEvent for components using addEventListener
  try {
    window.dispatchEvent(new CustomEvent(eventName, { detail: data }));
  } catch (_) {}
}

// ─────────────────────────────────────────────
// JSDoc typedefs
// ─────────────────────────────────────────────

/**
 * @typedef {Object} AppStateSnapshot
 * @property {Candle[]}           candles_1h
 * @property {Candle[]}           candles_4h
 * @property {Candle[]}           candles_1d
 * @property {number}             currentPrice
 * @property {number}             prevClose
 * @property {boolean}            isLive
 * @property {string}             dataSource
 * @property {Signal|null}        lastSignal
 * @property {Vote[]}             lastVotes
 * @property {CommitteeVerdict|null} lastVerdict
 * @property {string|null}        lastRegime
 * @property {WeightConfig}       weights
 * @property {number}             lastRefresh
 * @property {number}             signalCount
 */

/**
 * @typedef {Object} SignalHistoryEntry
 * @property {string}   id
 * @property {number}   timestamp
 * @property {string}   signal_strength
 * @property {string}   direction
 * @property {string|null} no_trade_reason
 * @property {number}   final_score
 * @property {number}   final_confidence
 * @property {number}   entry_price
 * @property {number}   stop_loss
 * @property {number}   take_profit_2
 * @property {number}   sl_pips
 * @property {number}   tp2_pips
 * @property {number}   lot_size
 * @property {number}   effective_risk_pct
 * @property {string}   market_regime
 * @property {string}   mtf_state
 * @property {string}   timeframe
 * @property {object}   gates
 * @property {object}   agent_votes  — compact { agentName: { vote, score } }
 */
