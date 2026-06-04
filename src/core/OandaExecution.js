/**
 * ONETO EUR/USD AI Tool — OandaExecution
 * =========================================
 * OANDA execution interface — INTERFACE ONLY.
 * No live trading is wired in this version.
 *
 * This module defines the full contract that a live execution adapter
 * must implement. The ExecutionManager routes to this module only
 * when execution_mode = 'live' AND broker = 'oanda'.
 *
 * Current status: All methods return NOT_IMPLEMENTED.
 * Live activation requires:
 *   1. OANDA account verified (demo or live)
 *   2. OANDA API key configured in Settings
 *   3. Paper Trading validation complete (all 4 gates)
 *   4. Explicit opt-in from user
 *
 * NEVER activate live trading without explicit human decision.
 * This is mandated by the Architecture Freeze V4.0-R1.
 *
 * Architecture Freeze V4.0-R1 | Phase 1
 */

'use strict';

// ─────────────────────────────────────────────
// CONFIGURATION (not yet active)
// ─────────────────────────────────────────────

const OANDA_PRACTICE_BASE = 'https://api-fxpractice.oanda.com/v3';
const OANDA_LIVE_BASE     = 'https://api-fxtrade.oanda.com/v3';
const INSTRUMENT          = 'EUR_USD';

/**
 * Stub status returned by all methods until live trading is activated.
 */
const NOT_IMPLEMENTED = Object.freeze({
  status:  'not_implemented',
  message: 'OandaExecution: live trading is interface-only in this version. '
         + 'Complete paper trading validation before requesting live activation.',
  activated: false,
});

// ─────────────────────────────────────────────
// INTERFACE CONTRACT
// All methods below define the full live execution contract.
// Implementors must match these signatures exactly.
// ─────────────────────────────────────────────

/**
 * Tests the OANDA API connection with the stored credentials.
 * Returns connection status and account summary.
 *
 * @param {string} apiKey
 * @param {string} accountId
 * @param {'practice'|'live'} env
 * @returns {Promise<ConnectionResult>}
 */
export async function testConnection(apiKey, accountId, env = 'practice') {
  return _notImplemented('testConnection');
}

/**
 * Returns the current account balance and margin information.
 *
 * @returns {Promise<AccountSummary>}
 */
export async function getAccountSummary() {
  return _notImplemented('getAccountSummary');
}

/**
 * Returns the current EUR/USD bid/ask spread and price.
 *
 * @returns {Promise<PricingResult>}
 */
export async function getCurrentPricing() {
  return _notImplemented('getCurrentPricing');
}

/**
 * Submits a market order.
 *
 * @param {OrderParams} params
 * @returns {Promise<OrderResult>}
 */
export async function submitMarketOrder(params) {
  return _notImplemented('submitMarketOrder');
}

/**
 * Submits a limit order.
 *
 * @param {LimitOrderParams} params
 * @returns {Promise<OrderResult>}
 */
export async function submitLimitOrder(params) {
  return _notImplemented('submitLimitOrder');
}

/**
 * Closes an open trade.
 *
 * @param {string} tradeId
 * @param {number} [units]  - partial close if specified
 * @returns {Promise<CloseResult>}
 */
export async function closeTrade(tradeId, units) {
  return _notImplemented('closeTrade');
}

/**
 * Modifies the SL/TP of an existing trade.
 *
 * @param {string} tradeId
 * @param {ModifyParams} params
 * @returns {Promise<ModifyResult>}
 */
export async function modifyTrade(tradeId, params) {
  return _notImplemented('modifyTrade');
}

/**
 * Returns all open trades for the configured account.
 *
 * @returns {Promise<OpenTrade[]>}
 */
export async function getOpenTrades() {
  return _notImplemented('getOpenTrades');
}

/**
 * Returns trade history (closed trades).
 *
 * @param {number} [count=50]
 * @returns {Promise<ClosedTrade[]>}
 */
export async function getTradeHistory(count = 50) {
  return _notImplemented('getTradeHistory');
}

/**
 * Returns whether live trading is currently activated.
 * This will always return false until human opt-in.
 *
 * @returns {{ activated: boolean, reason: string }}
 */
export function isActivated() {
  return {
    activated: false,
    reason:    'Live trading requires explicit human authorization after paper trading validation.',
  };
}

/**
 * Returns the conditions required before live trading can be activated.
 * Used by ExecutionManager and UI to display readiness status.
 *
 * @param {TradingStats} paperStats
 * @returns {ActivationRequirements}
 */
export function getActivationRequirements(paperStats) {
  const stats = paperStats ?? {};
  return {
    requirements: [
      {
        label:     'Paper trading Phase 1 complete (100 trades)',
        met:       (stats.closed ?? 0) >= 100,
        current:   stats.closed ?? 0,
        target:    100,
      },
      {
        label:     'Win rate ≥ 60%',
        met:       (stats.win_rate ?? 0) >= 0.60,
        current:   `${((stats.win_rate ?? 0) * 100).toFixed(1)}%`,
        target:    '60%',
      },
      {
        label:     'Profit factor ≥ 1.5',
        met:       (stats.profit_factor ?? 0) >= 1.50,
        current:   stats.profit_factor ?? 0,
        target:    1.50,
      },
      {
        label:     'Max drawdown ≤ 10%',
        met:       true,   // tracked by AccountState
        current:   'See account profile',
        target:    '10%',
      },
      {
        label:     'OANDA API key configured',
        met:       false,  // always false until explicitly set
        current:   'Not configured',
        target:    'Required',
      },
      {
        label:     'Human opt-in confirmed',
        met:       false,  // always false — must be explicitly set
        current:   'Not confirmed',
        target:    'Explicit approval required',
      },
    ],
    all_met: false,
    message: 'Complete all requirements and obtain explicit authorization before live trading.',
  };
}

// ─────────────────────────────────────────────
// FUTURE IMPLEMENTATION NOTES
// ─────────────────────────────────────────────

/**
 * When implementing live trading:
 *
 * 1. OANDA Practice API first:
 *    Base URL: https://api-fxpractice.oanda.com/v3
 *    Headers: Authorization: Bearer {apiKey}
 *             Content-Type: application/json
 *
 * 2. Key endpoints:
 *    GET  /accounts/{accountId}/summary
 *    GET  /accounts/{accountId}/pricing?instruments=EUR_USD
 *    POST /accounts/{accountId}/orders
 *    GET  /accounts/{accountId}/trades
 *    PUT  /accounts/{accountId}/trades/{tradeId}/orders
 *    PUT  /accounts/{accountId}/trades/{tradeId}/close
 *
 * 3. Order body for market order:
 *    {
 *      "order": {
 *        "type":        "MARKET",
 *        "instrument":  "EUR_USD",
 *        "units":       "10000",    // positive=BUY, negative=SELL
 *        "timeInForce": "FOK",
 *        "stopLossOnFill":   { "price": "1.17000" },
 *        "takeProfitOnFill": { "price": "1.15200" }
 *      }
 *    }
 *
 * 4. Unit conversion:
 *    lot_size 0.10 (mini lot) = 10,000 units
 *    lot_size 0.01 (micro lot) = 1,000 units
 *    lot_size 1.00 (standard) = 100,000 units
 *    units = Math.round(lot_size * 100000)
 *    BUY = positive units, SELL = negative units
 *
 * 5. Rate limits:
 *    120 requests/second (practice)
 *    Monitor rate_limit headers in responses
 *
 * 6. Always test on practice account first.
 *    Never connect live account without 500+ paper trade history.
 */

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function _notImplemented(method) {
  return Promise.resolve({
    ...NOT_IMPLEMENTED,
    method,
  });
}

// ─────────────────────────────────────────────
// JSDoc typedefs
// ─────────────────────────────────────────────

/**
 * @typedef {Object} ConnectionResult
 * @property {string}  status
 * @property {string}  message
 * @property {boolean} activated
 * @property {string}  [method]
 */

/**
 * @typedef {Object} OrderParams
 * @property {string} direction    - 'BUY'|'SELL'
 * @property {number} lot_size
 * @property {number} stop_loss
 * @property {number} take_profit_1
 * @property {number} take_profit_2
 * @property {string} [signal_id]
 */

/**
 * @typedef {Object} ActivationRequirements
 * @property {Array}   requirements
 * @property {boolean} all_met
 * @property {string}  message
 */