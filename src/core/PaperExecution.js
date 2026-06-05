/**
 * ONETO EUR/USD AI Tool — PaperExecution
 * =========================================
 * Paper trading execution layer.
 * Records, tracks, and closes simulated trades.
 * Writes outcomes back to signal records for Learning Engine.
 *
 * V5.2 (FREEZE-RULE-016): Trade records now include full signal context:
 *   market_regime, signal_strength, final_score, final_confidence,
 *   agents_agreeing, agent_votes, agent_scores, data_sources
 *
 * Migration: _loadTrades() applies _migrateTrade() to all existing records
 * so old paper_trades_v4 data loads cleanly with default fallback values.
 *
 * Validation gates: 100 → 300 → 500 → 1000 trades before live trading.
 *
 * Phase 1–4: Persisted to localStorage.
 * Phase 5+:  Written to paper_trades + signal_results Supabase tables.
 *
 * Interface Contract 6 compliant.
 * Architecture Freeze V4.0-R1 | Phase 1 | V5.2 context enrichment
 */

'use strict';

import { DEFAULT_PIPS } from '../types/Signal.js';

// ─────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────

const STORAGE_KEY      = 'paper_trades_v4';
const RESULTS_KEY      = 'paper_results_v4';
const PIP_VALUE_STD    = DEFAULT_PIPS.PIP_VALUE_STD;  // $10/pip per standard lot
const VALIDATION_GATES = [100, 300, 500, 1000];

// ─────────────────────────────────────────────
// IN-MEMORY STORE
// ─────────────────────────────────────────────

let _trades  = _loadTrades();
let _results = _loadResults();

// ─────────────────────────────────────────────
// PUBLIC API — TRADE LIFECYCLE
// ─────────────────────────────────────────────

/**
 * Records a new simulated trade.
 * Returns the created trade record or an error object.
 * Never throws.
 *
 * @param {TradeInput} tradeInput
 * @returns {PaperTradeRecord | ErrorResult}
 */
export function submitTrade(tradeInput) {
  try {
    return _submit(tradeInput);
  } catch (err) {
    console.error('[PaperExecution] submitTrade error:', err.message);
    return { error: 'submission_failed', message: err.message };
  }
}

/**
 * Closes an open paper trade and records the outcome.
 * Updates account stats (consecutive losses, daily risk).
 * Never throws.
 *
 * @param {string} tradeId
 * @param {number} exitPrice
 * @param {string} exitReason - 'tp1'|'tp2'|'sl'|'manual'|'timeout'
 * @returns {PaperTradeRecord | ErrorResult}
 */
export function closeTrade(tradeId, exitPrice, exitReason = 'manual') {
  try {
    return _close(tradeId, exitPrice, exitReason);
  } catch (err) {
    console.error('[PaperExecution] closeTrade error:', err.message);
    return { error: 'close_failed', message: err.message };
  }
}

/**
 * Returns all paper trades (open + closed), newest first.
 * @returns {PaperTradeRecord[]}
 */
export function getAll() {
  return [..._trades];
}

/**
 * Returns only open trades.
 * @returns {PaperTradeRecord[]}
 */
export function getOpen() {
  return _trades.filter(t => t.status === 'open');
}

/**
 * Returns only closed trades.
 * @returns {PaperTradeRecord[]}
 */
export function getClosed() {
  return _trades.filter(t => t.status === 'closed');
}

/**
 * Returns a single trade by ID, or null.
 * @param {string} id
 * @returns {PaperTradeRecord|null}
 */
export function getById(id) {
  return _trades.find(t => t.id === id) ?? null;
}

/**
 * Returns aggregate performance statistics.
 * @returns {TradingStats}
 */
export function getStats() {
  const closed = getClosed();
  const wins   = closed.filter(t => t.outcome === 'win');
  const losses = closed.filter(t => t.outcome === 'loss');

  const totalPnlR   = closed.reduce((s, t) => s + (t.pnl_r ?? 0), 0);
  const totalPnlUsd = closed.reduce((s, t) => s + (t.pnl_usd ?? 0), 0);
  const avgWinR     = wins.length  ? wins.reduce((s, t) => s + (t.pnl_r ?? 0), 0)  / wins.length  : 0;
  const avgLossR    = losses.length ? losses.reduce((s, t) => s + (t.pnl_r ?? 0), 0) / losses.length : 0;

  const grossProfit  = wins.reduce((s, t) => s + (t.pnl_r ?? 0), 0);
  const grossLoss    = Math.abs(losses.reduce((s, t) => s + (t.pnl_r ?? 0), 0));
  const profitFactor = grossLoss > 0 ? parseFloat((grossProfit / grossLoss).toFixed(2)) : 0;

  const winRate = closed.length > 0 ? parseFloat((wins.length / closed.length).toFixed(3)) : 0;

  // Validation phase
  const totalClosed  = closed.length;
  const currentGate  = VALIDATION_GATES.find(g => totalClosed < g) ?? VALIDATION_GATES[VALIDATION_GATES.length - 1];
  const prevGate     = VALIDATION_GATES[VALIDATION_GATES.indexOf(currentGate) - 1] ?? 0;
  const phaseProgress = totalClosed - prevGate;
  const phaseTarget  = currentGate - prevGate;
  const currentPhase = VALIDATION_GATES.indexOf(currentGate) + 1;

  // Max consecutive losses
  let maxConsec = 0, curConsec = 0;
  for (const t of closed) {
    if (t.outcome === 'loss') { curConsec++; maxConsec = Math.max(maxConsec, curConsec); }
    else curConsec = 0;
  }

  return {
    total:           _trades.length,
    open:            getOpen().length,
    closed:          totalClosed,
    wins:            wins.length,
    losses:          losses.length,
    win_rate:        winRate,
    total_pnl_r:     parseFloat(totalPnlR.toFixed(2)),
    total_pnl_usd:   parseFloat(totalPnlUsd.toFixed(2)),
    avg_win_r:       parseFloat(avgWinR.toFixed(2)),
    avg_loss_r:      parseFloat(avgLossR.toFixed(2)),
    profit_factor:   profitFactor,
    max_consec_loss: maxConsec,
    current_phase:   currentPhase,
    phase_progress:  phaseProgress,
    phase_target:    phaseTarget,
    validation_complete: totalClosed >= VALIDATION_GATES[VALIDATION_GATES.length - 1],
    go_live_eligible: _checkGoLive(winRate, profitFactor, totalClosed),
  };
}

/**
 * Returns the last N closed trades' win rates for Learning Engine.
 * @param {number} n
 * @returns {number}  win rate 0–1
 */
export function getRecentWinRate(n = 20) {
  const recent = getClosed().slice(0, n);
  if (!recent.length) return 0.5;
  const wins = recent.filter(t => t.outcome === 'win').length;
  return parseFloat((wins / recent.length).toFixed(3));
}

/**
 * Returns the outcome records for Learning Engine consumption.
 * @returns {TradeResult[]}
 */
export function getResultsForLearning() {
  return [..._results];
}

/**
 * Clears all paper trade history (use with caution).
 */
export function clearAll() {
  _trades  = [];
  _results = [];
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(RESULTS_KEY);
  } catch (_) {}
}

// ─────────────────────────────────────────────
// INTERNAL — SUBMIT
// ─────────────────────────────────────────────

function _submit(input) {
  const {
    // ── Core trade fields (required / always-present) ──
    direction,
    entry_price,
    stop_loss,
    take_profit_1,
    take_profit_2,
    lot_size        = 0.01,
    account_balance = 1000,
    risk_pct        = 0.02,
    signal_id       = null,

    // ── Signal context fields (V5.2 — FREEZE-RULE-016) ──
    // Passed from PaperTradePanel._handleSubmit() via AppState.getLastSignal()
    // and AppState.getLastVotes(). Default to safe fallbacks if not provided
    // (e.g. manual trades without a signal context).
    market_regime    = 'unknown',
    signal_strength  = 'UNKNOWN',
    final_score      = 50,
    final_confidence = 0,
    agents_agreeing  = 0,
    // agent_votes: { agentName: { vote, score } } — compact per FREEZE-RULE-012
    agent_votes      = {},
    // agent_scores: { agentName: score } — convenience flat map
    agent_scores     = {},
    // data_sources: { fred, finnhub, dxy, cot } — LIVE/CACHE/STUB/DERIVED
    data_sources     = {},
  } = input ?? {};

  // ── Validation ──────────────────────────────
  if (!['BUY', 'SELL'].includes(direction)) {
    return { error: 'validation_failed', message: 'direction must be BUY or SELL' };
  }
  if (entry_price <= 0) return { error: 'validation_failed', message: 'entry_price must be positive' };
  if (stop_loss   <= 0) return { error: 'validation_failed', message: 'stop_loss must be positive' };
  if (lot_size    < 0.01) return { error: 'validation_failed', message: 'lot_size minimum is 0.01' };

  const sl_pips  = Math.round(Math.abs(entry_price - stop_loss)  / 0.0001);
  const tp1_pips = Math.round(Math.abs(entry_price - (take_profit_1 ?? entry_price)) / 0.0001);
  const tp2_pips = Math.round(Math.abs(entry_price - (take_profit_2 ?? entry_price)) / 0.0001);

  const trade = Object.freeze({
    // ── Identity ──
    id:               _generateId(),
    opened_at:        new Date().toISOString(),
    validation_phase: _currentPhase(),

    // ── Trade specification ──
    direction,
    entry_price:      _r5(entry_price),
    stop_loss:        _r5(stop_loss),
    take_profit_1:    _r5(take_profit_1 ?? 0),
    take_profit_2:    _r5(take_profit_2 ?? 0),
    sl_pips,
    tp1_pips,
    tp2_pips,
    lot_size:         parseFloat(lot_size.toFixed(2)),
    account_balance:  parseFloat(account_balance.toFixed(2)),
    risk_amount_usd:  parseFloat((account_balance * risk_pct).toFixed(2)),
    risk_pct:         parseFloat(risk_pct.toFixed(4)),

    // ── Signal context (V5.2 — FREEZE-RULE-016) ──
    signal_id,
    market_regime,
    signal_strength,
    final_score,
    final_confidence,
    agents_agreeing,
    agent_votes,    // { agentName: { vote, score } }
    agent_scores,   // { agentName: score }
    data_sources,   // { fred, finnhub, dxy, cot }

    // ── Lifecycle (populated on close) ──
    status:           'open',
    closed_at:        null,
    exit_price:       null,
    pnl_pips:         null,
    pnl_r:            null,
    pnl_usd:          null,
    exit_reason:      null,
    outcome:          null,
    duration_minutes: null,
  });

  _trades.unshift(trade);
  _persistTrades();

  _emit('paperTradeOpened', trade);
  return trade;
}

// ─────────────────────────────────────────────
// INTERNAL — CLOSE
// ─────────────────────────────────────────────

function _close(tradeId, exitPrice, exitReason) {
  const idx = _trades.findIndex(t => t.id === tradeId);
  if (idx === -1) return { error: 'not_found', message: `Trade ${tradeId} not found` };

  const trade = _trades[idx];
  if (trade.status !== 'open') {
    return { error: 'already_closed', message: `Trade ${tradeId} is already closed` };
  }

  const exit     = parseFloat(exitPrice) || trade.entry_price;
  const openedMs = new Date(trade.opened_at).getTime();
  const duration = Math.round((Date.now() - openedMs) / 60000);  // minutes

  // P&L calculation
  const pipSign  = trade.direction === 'SELL'
    ? trade.entry_price - exit
    : exit - trade.entry_price;
  const pnl_pips = Math.round(pipSign / 0.0001);
  const pnl_usd  = parseFloat((trade.lot_size * pnl_pips * PIP_VALUE_STD).toFixed(2));
  const pnl_r    = trade.sl_pips > 0
    ? parseFloat((pnl_pips / trade.sl_pips).toFixed(2))
    : 0;

  const outcome = pnl_pips > 0 ? 'win' : pnl_pips < 0 ? 'loss' : 'breakeven';

  const closed = Object.freeze({
    ...trade,
    status:           'closed',
    exit_price:       _r5(exit),
    pnl_pips,
    pnl_r,
    pnl_usd,
    exit_reason:      exitReason,
    outcome,
    closed_at:        new Date().toISOString(),
    duration_minutes: duration,
  });

  _trades[idx] = closed;

  // Store result for Learning Engine
  // Includes regime and data_sources from trade context (V5.2)
  const result = {
    trade_id:     closed.id,
    signal_id:    closed.signal_id,
    outcome,
    profit_pips:  pnl_pips,
    profit_r:     pnl_r,
    profit_usd:   pnl_usd,
    exit_reason:  exitReason,
    regime:       closed.market_regime ?? 'unknown',
    data_sources: closed.data_sources  ?? {},
    closed_at:    closed.closed_at,
  };
  _results.unshift(result);

  _persistTrades();
  _persistResults();

  _emit('paperTradeClosed', closed);
  return closed;
}

// ─────────────────────────────────────────────
// GO-LIVE ELIGIBILITY CHECK
// ─────────────────────────────────────────────

function _checkGoLive(winRate, profitFactor, totalClosed) {
  return totalClosed >= 100
    && winRate      >= 0.60
    && profitFactor >= 1.50;
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function _currentPhase() {
  const closed = getClosed().length;
  for (let i = 0; i < VALIDATION_GATES.length; i++) {
    if (closed < VALIDATION_GATES[i]) return i + 1;
  }
  return VALIDATION_GATES.length;
}

function _r5(n) { return parseFloat(parseFloat(n).toFixed(5)); }

function _generateId() {
  return `pt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function _emit(eventName, data) {
  try {
    window.dispatchEvent(new CustomEvent(eventName, { detail: data }));
  } catch (_) {}
}

// ─────────────────────────────────────────────
// MIGRATION — V5.2
// ─────────────────────────────────────────────

/**
 * Applies default values for V5.2 context fields to a trade record
 * that was stored before V5.2 (i.e. missing market_regime, agent_votes, etc.).
 * Called on every record loaded from localStorage.
 *
 * Safe to call on already-migrated records (existing values are preserved).
 *
 * @param {object} trade - raw record from localStorage
 * @returns {object}     - record with all V5.2 fields present
 */
function _migrateTrade(trade) {
  return {
    ...trade,
    market_regime:    trade.market_regime    ?? 'unknown',
    signal_strength:  trade.signal_strength  ?? 'UNKNOWN',
    final_score:      trade.final_score      ?? 50,
    final_confidence: trade.final_confidence ?? 0,
    agents_agreeing:  trade.agents_agreeing  ?? 0,
    agent_votes:      trade.agent_votes      ?? {},
    agent_scores:     trade.agent_scores     ?? {},
    data_sources:     trade.data_sources     ?? {},
  };
}

// ─────────────────────────────────────────────
// PERSISTENCE
// ─────────────────────────────────────────────

function _loadTrades() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Apply V5.2 migration to every loaded record
    return parsed.map(_migrateTrade);
  } catch (_) { return []; }
}

function _loadResults() {
  try {
    const raw = localStorage.getItem(RESULTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (_) { return []; }
}

function _persistTrades() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(_trades)); } catch (_) {}
}

function _persistResults() {
  try { localStorage.setItem(RESULTS_KEY, JSON.stringify(_results)); } catch (_) {}
}

// ─────────────────────────────────────────────
// JSDoc typedefs
// ─────────────────────────────────────────────

/**
 * @typedef {Object} TradeInput
 * @property {string}      direction
 * @property {number}      entry_price
 * @property {number}      stop_loss
 * @property {number}      [take_profit_1]
 * @property {number}      [take_profit_2]
 * @property {number}      [lot_size]
 * @property {number}      [account_balance]
 * @property {number}      [risk_pct]
 * @property {string|null} [signal_id]
 * @property {string}      [market_regime]
 * @property {string}      [signal_strength]
 * @property {number}      [final_score]
 * @property {number}      [final_confidence]
 * @property {number}      [agents_agreeing]
 * @property {object}      [agent_votes]     { agentName: { vote, score } }
 * @property {object}      [agent_scores]    { agentName: score }
 * @property {object}      [data_sources]    { fred, finnhub, dxy, cot }
 */

/**
 * @typedef {Object} PaperTradeRecord
 * @property {string}       id
 * @property {string}       opened_at
 * @property {number}       validation_phase
 * @property {string}       direction
 * @property {number}       entry_price
 * @property {number}       stop_loss
 * @property {number}       take_profit_1
 * @property {number}       take_profit_2
 * @property {number}       sl_pips
 * @property {number}       tp1_pips
 * @property {number}       tp2_pips
 * @property {number}       lot_size
 * @property {number}       account_balance
 * @property {number}       risk_amount_usd
 * @property {number}       risk_pct
 * @property {string|null}  signal_id
 * @property {string}       market_regime
 * @property {string}       signal_strength
 * @property {number}       final_score
 * @property {number}       final_confidence
 * @property {number}       agents_agreeing
 * @property {object}       agent_votes
 * @property {object}       agent_scores
 * @property {object}       data_sources
 * @property {string}       status           'open'|'closed'
 * @property {string|null}  closed_at
 * @property {number|null}  exit_price
 * @property {number|null}  pnl_pips
 * @property {number|null}  pnl_r
 * @property {number|null}  pnl_usd
 * @property {string|null}  exit_reason
 * @property {string|null}  outcome
 * @property {number|null}  duration_minutes
 */

/**
 * @typedef {Object} TradingStats
 * @property {number}  total
 * @property {number}  open
 * @property {number}  closed
 * @property {number}  wins
 * @property {number}  losses
 * @property {number}  win_rate
 * @property {number}  total_pnl_r
 * @property {number}  total_pnl_usd
 * @property {number}  avg_win_r
 * @property {number}  avg_loss_r
 * @property {number}  profit_factor
 * @property {number}  max_consec_loss
 * @property {number}  current_phase
 * @property {number}  phase_progress
 * @property {number}  phase_target
 * @property {boolean} validation_complete
 * @property {boolean} go_live_eligible
 */

/**
 * @typedef {Object} ErrorResult
 * @property {string} error
 * @property {string} message
 */
