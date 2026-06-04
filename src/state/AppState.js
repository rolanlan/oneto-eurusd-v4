/**
 * ONETO EUR/USD AI Tool — AppState
 * ==================================
 * Central in-memory runtime state store for the current session.
 * Single source of truth for candle arrays, current price,
 * last signal, active weights, and regime.
 *
 * Does NOT persist to localStorage (runtime state only).
 * AccountState.js handles all persistence.
 *
 * Event bus — components subscribe to:
 *   'stateUpdated'    — candles / price refreshed
 *   'signalGenerated' — new signal from SignalEngine
 *   'regimeChanged'   — regime classification changed
 *
 * Interface Contract 10 compliant.
 * Architecture Freeze V4.0-R1 | Phase 2
 */

'use strict';

import * as DataProvider from '../core/DataProvider.js';
import * as AccountState from './AccountState.js';
import { DEFAULT_WEIGHTS } from '../types/Vote.js';

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
 * @param {SignalEngineResult} result
 */
export function setSignalResult(result) {
  if (!result) return;

  const prevRegime = _state.lastRegime;

  _state.lastSignal  = result.signal  ?? null;
  _state.lastVotes   = result.votes   ?? [];
  _state.lastVerdict = result.verdict ?? null;
  _state.lastRegime  = result.regime  ?? null;

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
 */
