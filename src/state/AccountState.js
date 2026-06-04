/**
 * ONETO EUR/USD AI Tool — AccountState
 * ======================================
 * User account profile manager.
 * Single source of truth for capital, risk preferences,
 * drawdown tracking, and consecutive-loss counting.
 *
 * Compatibility contract (matches SignalEngine._defaultProfile + RiskManager.checkSystemHalt):
 *   account_balance         number    1000
 *   risk_profile            string    'standard'
 *   risk_pct_conservative   number    0.01
 *   risk_pct_standard       number    0.02
 *   risk_pct_aggressive     number    0.05
 *   max_drawdown_limit      number    0.10
 *   max_consecutive_losses  number    5
 *   min_confidence          number    65
 *   min_rr_ratio            number    2.0
 *   consecutive_losses      number    0
 *   current_drawdown        number    0
 *   daily_risk_used         number    0
 *   win_rate_20             number    0.5
 *   language                string    'zh'
 *   timezone                string    'Africa/Libreville'
 *
 * Phase 1–4: localStorage only.
 * Phase 5+:  Also syncs to Supabase account_profiles table.
 *
 * Interface Contract 11 compliant.
 * Architecture Freeze V4.0-R1 | Phase 2
 */

'use strict';

// ─────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────

const STORAGE_KEY     = 'account_profile_v4';
const STORAGE_KEY_LOG = 'account_daily_reset_v4';

// ─────────────────────────────────────────────
// FACTORY DEFAULT
// ─────────────────────────────────────────────

/**
 * Returns a fresh factory-default AccountProfile.
 * No state read — pure constant.
 * @returns {AccountProfile}
 */
function _factoryDefault() {
  return {
    // ── Identity ──
    id:           'local-default',
    profile_name: 'Default Account',
    is_active:    true,
    is_default:   true,
    account_type: 'paper',

    // ── Capital ──
    account_balance:  1000,
    account_currency: 'USD',
    broker_name:      null,

    // ── Risk Percentages ──
    risk_profile:          'standard',
    risk_pct_conservative: 0.01,
    risk_pct_standard:     0.02,
    risk_pct_aggressive:   0.05,

    // ── Limits ──
    max_risk_per_day:       0.06,
    max_risk_per_week:      0.10,
    max_drawdown_limit:     0.10,
    max_consecutive_losses: 5,
    max_lot_size:           1.00,
    min_lot_size:           0.01,
    max_open_trades:        1,

    // ── Decision Engine Parameters ──
    min_confidence:  65,
    min_rr_ratio:    2.0,

    // ── Session / Regime Preferences ──
    preferred_sessions:  ['london', 'newyork', 'overlap'],
    blocked_regimes:     ['volatile'],
    preferred_timeframes: ['4H', '1D'],

    // ── Performance Tracking ──
    total_trades:        0,
    total_pnl_r:         0,
    total_pnl_usd:       0,
    peak_balance:        1000,
    current_drawdown:    0,
    consecutive_losses:  0,
    daily_risk_used:     0,
    weekly_risk_used:    0,
    win_rate_20:         0.5,    // last 20 trades win rate (used by RiskManager)

    // ── UI Preferences ──
    language: 'zh',
    timezone: 'Africa/Libreville',

    // ── Timestamps ──
    last_reset_date: _todayStr(),
    created_at:      new Date().toISOString(),
    updated_at:      new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────
// IN-MEMORY CACHE
// ─────────────────────────────────────────────

let _profile = null;   // loaded lazily on first access

// ─────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────

/**
 * Returns the factory default profile (with localStorage override if exists).
 * Identical to get() — provided for Interface Contract 11 compatibility.
 * @returns {AccountProfile}
 */
export function getDefault() {
  return get();
}

/**
 * Returns the current active account profile.
 * Loads from localStorage on first call, falls back to factory defaults.
 * @returns {AccountProfile}
 */
export function get() {
  if (!_profile) {
    _profile = _load();
    _checkDailyReset(_profile);
  }
  return { ..._profile };
}

/**
 * Merges partial fields into the current profile and persists.
 * Dispatches 'profileUpdated' CustomEvent on window.
 *
 * @param {Partial<AccountProfile>} fields
 * @returns {AccountProfile}  updated profile
 */
export function update(fields) {
  if (!fields || typeof fields !== 'object') return get();
  if (!_profile) get();   // ensure loaded

  _profile = {
    ..._profile,
    ...fields,
    updated_at: new Date().toISOString(),
  };

  _persist(_profile);
  _emit('profileUpdated', _profile);
  return { ..._profile };
}

/**
 * Increments consecutive_losses by 1 and updates drawdown metrics.
 * Called by PaperExecution when a trade closes as 'loss'.
 * Dispatches 'drawdownWarning' if consecutive_losses reaches limit.
 *
 * @param {number} [riskPct=0.02]  - risk percentage of the losing trade
 */
export function incrementLoss(riskPct = 0.02) {
  if (!_profile) get();

  const newConsec  = (_profile.consecutive_losses ?? 0) + 1;
  const newDrawdown = Math.min(1.0,
    parseFloat(((_profile.current_drawdown ?? 0) + riskPct).toFixed(4))
  );
  const newDailyRisk = Math.min(1.0,
    parseFloat(((_profile.daily_risk_used ?? 0) + riskPct).toFixed(4))
  );
  const newWeeklyRisk = Math.min(1.0,
    parseFloat(((_profile.weekly_risk_used ?? 0) + riskPct).toFixed(4))
  );

  _profile = {
    ..._profile,
    consecutive_losses: newConsec,
    current_drawdown:   newDrawdown,
    daily_risk_used:    newDailyRisk,
    weekly_risk_used:   newWeeklyRisk,
    updated_at:         new Date().toISOString(),
  };

  _persist(_profile);

  if (newConsec >= (_profile.max_consecutive_losses ?? 5)) {
    _emit('drawdownWarning', {
      type:    'consecutive_loss_limit',
      count:   newConsec,
      limit:   _profile.max_consecutive_losses,
      profile: { ..._profile },
    });
  }

  if (newDrawdown >= (_profile.max_drawdown_limit ?? 0.10)) {
    _emit('drawdownWarning', {
      type:     'drawdown_limit',
      drawdown: newDrawdown,
      limit:    _profile.max_drawdown_limit,
      profile:  { ..._profile },
    });
  }
}

/**
 * Resets consecutive_losses to 0 after a winning trade.
 * Called by PaperExecution when a trade closes as 'win'.
 */
export function resetLossStreak() {
  if (!_profile) get();
  _profile = {
    ..._profile,
    consecutive_losses: 0,
    updated_at: new Date().toISOString(),
  };
  _persist(_profile);
}

/**
 * Records a completed trade's outcome, updating balance and peak tracking.
 * Called by PaperExecution after closing a trade.
 *
 * @param {{ outcome: 'win'|'loss'|'breakeven', pnl_usd: number, pnl_r: number, risk_pct: number }} result
 */
export function recordTradeOutcome(result) {
  if (!_profile) get();
  const { outcome, pnl_usd = 0, pnl_r = 0, risk_pct = 0 } = result ?? {};

  const newBalance   = parseFloat((_profile.account_balance + pnl_usd).toFixed(2));
  const newPeakBal   = Math.max(_profile.peak_balance ?? newBalance, newBalance);
  const newDrawdown  = newPeakBal > 0
    ? parseFloat(Math.max(0, (newPeakBal - newBalance) / newPeakBal).toFixed(4))
    : 0;
  const totalTrades  = (_profile.total_trades ?? 0) + 1;
  const totalPnlR    = parseFloat(((_profile.total_pnl_r ?? 0) + pnl_r).toFixed(2));
  const totalPnlUsd  = parseFloat(((_profile.total_pnl_usd ?? 0) + pnl_usd).toFixed(2));

  _profile = {
    ..._profile,
    account_balance:  newBalance,
    peak_balance:     newPeakBal,
    current_drawdown: newDrawdown,
    total_trades:     totalTrades,
    total_pnl_r:      totalPnlR,
    total_pnl_usd:    totalPnlUsd,
    updated_at:       new Date().toISOString(),
  };

  _persist(_profile);

  if (outcome === 'win') {
    resetLossStreak();
  } else if (outcome === 'loss') {
    incrementLoss(risk_pct);
  }
}

/**
 * Updates the win_rate_20 field from the last 20 closed paper trades.
 * Called by AppState after each trade close.
 *
 * @param {number} winRate  - 0–1
 */
export function updateWinRate(winRate) {
  if (!_profile) get();
  const clamped = Math.max(0, Math.min(1, isNaN(winRate) ? 0.5 : winRate));
  _profile = { ..._profile, win_rate_20: clamped, updated_at: new Date().toISOString() };
  _persist(_profile);
}

/**
 * Resets the entire profile to factory defaults.
 * Clears localStorage entry.
 */
export function reset() {
  _profile = _factoryDefault();
  _persist(_profile);
  _emit('profileUpdated', _profile);
}

// ─────────────────────────────────────────────
// DAILY RESET
// ─────────────────────────────────────────────

/**
 * Checks if daily_risk_used should be reset (new calendar day).
 * Also resets weekly_risk_used on Mondays.
 * @param {AccountProfile} profile
 */
function _checkDailyReset(profile) {
  const today    = _todayStr();
  const lastReset = profile.last_reset_date ?? '';

  if (today !== lastReset) {
    const updates = {
      daily_risk_used:  0,
      last_reset_date:  today,
    };

    // Reset weekly on Monday
    const dayOfWeek = new Date().getDay();   // 0=Sun, 1=Mon
    if (dayOfWeek === 1) {
      updates.weekly_risk_used = 0;
    }

    _profile = { ..._profile, ...updates, updated_at: new Date().toISOString() };
    _persist(_profile);
  }
}

// ─────────────────────────────────────────────
// PERSISTENCE
// ─────────────────────────────────────────────

function _load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const stored = JSON.parse(raw);
      // Merge with factory defaults to pick up any new fields added in updates
      return { ..._factoryDefault(), ...stored };
    }
  } catch (_) {}
  return _factoryDefault();
}

function _persist(profile) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch (_) {}
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function _todayStr() {
  return new Date().toISOString().slice(0, 10);   // "YYYY-MM-DD"
}

function _emit(eventName, data) {
  try {
    window.dispatchEvent(new CustomEvent(eventName, { detail: data }));
  } catch (_) {}
}

// ─────────────────────────────────────────────
// JSDoc typedef
// ─────────────────────────────────────────────

/**
 * @typedef {Object} AccountProfile
 * @property {string}   id
 * @property {string}   profile_name
 * @property {boolean}  is_active
 * @property {boolean}  is_default
 * @property {string}   account_type
 * @property {number}   account_balance
 * @property {string}   account_currency
 * @property {string}   risk_profile
 * @property {number}   risk_pct_conservative
 * @property {number}   risk_pct_standard
 * @property {number}   risk_pct_aggressive
 * @property {number}   max_risk_per_day
 * @property {number}   max_risk_per_week
 * @property {number}   max_drawdown_limit
 * @property {number}   max_consecutive_losses
 * @property {number}   max_lot_size
 * @property {number}   min_lot_size
 * @property {number}   max_open_trades
 * @property {number}   min_confidence
 * @property {number}   min_rr_ratio
 * @property {string[]} preferred_sessions
 * @property {string[]} blocked_regimes
 * @property {string[]} preferred_timeframes
 * @property {number}   total_trades
 * @property {number}   total_pnl_r
 * @property {number}   total_pnl_usd
 * @property {number}   peak_balance
 * @property {number}   current_drawdown
 * @property {number}   consecutive_losses
 * @property {number}   daily_risk_used
 * @property {number}   weekly_risk_used
 * @property {number}   win_rate_20
 * @property {string}   language
 * @property {string}   timezone
 * @property {string}   last_reset_date
 * @property {string}   created_at
 * @property {string}   updated_at
 */
