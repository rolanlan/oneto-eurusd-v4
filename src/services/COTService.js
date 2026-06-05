/**
 * ONETO EUR/USD AI Tool — COTService
 * =====================================
 * CFTC Commitments of Traders (COT) data client.
 *
 * STATUS: DISABLED — returns stub immediately.
 *
 * Reason: CFTC direct fetch (https://www.cftc.gov/dea/futures/deacmesf.zip)
 * causes CORS errors and 404s in the browser console on every page load.
 * The data would provide value but the noise it creates in the console
 * (repeated failing network requests) degrades the development experience.
 *
 * Resolution path (future):
 *   Replace CFTC direct fetch with Nasdaq Data Link (Quandl) API:
 *   https://data.nasdaq.com/data/CFTC/
 *   Nasdaq Data Link supports CORS and provides a clean REST API.
 *   When implemented, re-enable by removing the early return in getCOTBundle().
 *
 * COT data structure (preserved for future use):
 *   cot_net_position:  non-commercial net (long - short)
 *   cot_z_score_52w:   z-score vs 52-week history
 *   cot_signal:        extreme_long|long|neutral|short|extreme_short
 *   cot_trend_3w:      increasing|decreasing|flat
 *
 * V4.3 Data Integration | BUG-COT disabled V4.6
 */

'use strict';

const STORAGE_KEY_BUNDLE  = 'oneto_cot_v1';
const STORAGE_KEY_HISTORY = 'oneto_cot_history_v1';

/**
 * Returns a stub COT bundle immediately.
 * No network requests are made.
 * COT data integration is pending Nasdaq Data Link implementation.
 *
 * @returns {Promise<COTBundle>}
 */
export async function getCOTBundle() {
  // BUG-COT FIX: Return stub immediately — no CFTC fetch, no CORS errors.
  // Future: replace with Nasdaq Data Link API (data.nasdaq.com/data/CFTC)
  return _stubBundle();
}

/**
 * Returns the stored COT history array (empty until real data source added).
 * @returns {COTWeek[]}
 */
export function getHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_HISTORY);
    return raw ? JSON.parse(raw) : [];
  } catch (_) { return []; }
}

/**
 * Clears all COT caches.
 */
export function clearCache() {
  try { localStorage.removeItem(STORAGE_KEY_BUNDLE);  } catch (_) {}
  try { localStorage.removeItem(STORAGE_KEY_HISTORY); } catch (_) {}
}

// ─────────────────────────────────────────────
// STUB
// ─────────────────────────────────────────────

function _stubBundle() {
  return {
    cot_net_position:  0,
    cot_z_score_52w:   0,
    cot_z_score_26w:   0,
    cot_signal:        'neutral',
    cot_trend_3w:      'flat',
    cot_extreme:       false,
    cot_change_weekly: 0,
    cot_change_4week:  0,
    data_age_days:     7,
    report_date:       new Date().toISOString().slice(0, 10),
    fetched_at:        0,
    data_source:       'stub',
  };
}

// ─────────────────────────────────────────────
// JSDoc typedefs
// ─────────────────────────────────────────────

/**
 * @typedef {Object} COTBundle
 * @property {number}  cot_net_position
 * @property {number}  cot_z_score_52w
 * @property {number}  cot_z_score_26w
 * @property {string}  cot_signal        extreme_long|long|neutral|short|extreme_short
 * @property {string}  cot_trend_3w      increasing|decreasing|flat
 * @property {boolean} cot_extreme
 * @property {number}  cot_change_weekly
 * @property {number}  cot_change_4week
 * @property {number}  data_age_days
 * @property {string}  report_date
 * @property {number}  fetched_at
 * @property {string}  data_source       always 'stub' until Nasdaq Data Link integrated
 */

/**
 * @typedef {Object} COTWeek
 * @property {string} date  ISO date
 * @property {number} net   non-commercial net position
 */
