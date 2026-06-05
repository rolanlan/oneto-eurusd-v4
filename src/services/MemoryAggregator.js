/**
 * ONETO EUR/USD AI Tool — MemoryAggregator
 * ==========================================
 * Single entry point for all live market data services.
 * Aggregates FREDService, FinnhubService, COTService, and DataProvider (DXY)
 * into the memoryLayer object consumed by CommitteeOrchestrator.
 *
 * V4.6 refresh fix:
 *   refresh() no longer calls clearCache() on services — that was causing
 *   "有CACHE仍然请求API" because the cache was nuked before getMemoryLayer().
 *
 *   New behaviour:
 *     refresh()          → clears in-memory caches ONLY (not localStorage),
 *                           then calls getMemoryLayer().
 *     Each service decides independently whether to use localStorage cache
 *     or fetch live, based on its own TTL.
 *
 *   smartRefresh(opts)   → for the "刷新所有数据" button:
 *                           only fetches services whose cache has actually expired.
 *                           CACHE → keep using. STUB/STALE → re-fetch.
 *                           LIVE → keep using.
 *                           authFailed → skip entirely (no console error).
 *
 * Public API:
 *   getMemoryLayer()   → Promise<memoryLayer>
 *   refresh()          → Promise<void>  (clears in-memory, re-fetches)
 *   smartRefresh()     → Promise<void>  (skips valid caches, skips auth failures)
 *   getStatus()        → AggregatorStatus
 *
 * Never throws. Always returns a complete memoryLayer object.
 *
 * V4.3 Data Integration | STEP 5 | V4.6 refresh fix
 */

'use strict';

import * as FREDService    from './FREDService.js';
import * as FinnhubService from './FinnhubService.js';
import * as COTService     from './COTService.js';
import * as DataProvider   from '../core/DataProvider.js';

// ─────────────────────────────────────────────
// DEFAULT_MEMORY BASELINE
// ─────────────────────────────────────────────

const DEFAULT_MEMORY = Object.freeze({
  cb_fed_stance_score:   60,
  cb_ecb_stance_score:    0,
  cot_net_position:       0,
  cot_z_score_52w:        0,
  cot_signal:         'neutral',
  cot_trend_3w:       'flat',
  cot_extreme:            false,
  news_net_score_24h:    30,
  news_net_score_7d:     15,
  news_net_score_30d:     5,
  narrative_shift:        false,
  us_de_spread:           2.0,
  dxy_trend:          'rising',
  dxy_level:            104.5,
  policy_momentum:        1,
  vix_level:             15.0,
  upcoming_event_risk:    false,
  event_within_hours:     null,
  event_impact_level:  'low',
  data_source:         'stub',
});

// ─────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────

let _lastStatus    = null;
let _lastFetchedAt = 0;

// In-memory cache for the aggregated result (not per-service)
let _memLayer     = null;
let _memLayerAt   = 0;
const MEM_TTL_MS  = 2 * 60 * 1000;  // 2 minutes — signal runs every 4 min, so usually cache hits

// ─────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────

/**
 * Returns a complete memoryLayer object for CommitteeOrchestrator.
 * Uses a short in-memory aggregate cache (2 min) to avoid re-fetching
 * all services on every signal generation cycle.
 * Never throws.
 *
 * @returns {Promise<memoryLayer>}
 */
export async function getMemoryLayer() {
  // Short aggregate cache — prevents hammering services on rapid signal calls
  if (_memLayer && Date.now() - _memLayerAt < MEM_TTL_MS) {
    return { ..._memLayer };
  }
  return _fetchAll();
}

/**
 * Clears the 2-minute aggregate in-memory cache and re-fetches all services.
 * Each service still uses its own localStorage cache if it is valid.
 * Does NOT call clearCache() on services — that would bypass valid caches.
 * Never throws.
 *
 * @returns {Promise<void>}
 */
export async function refresh() {
  // Clear only the aggregate in-memory cache
  _memLayer   = null;
  _memLayerAt = 0;
  await _fetchAll();
}

/**
 * Smart refresh: skips services that have valid caches or have auth failures.
 * This is the correct function to call from the "刷新所有数据" button.
 *
 * Logic per service:
 *   - auth failed → skip (no request, no console error)
 *   - has valid cache → skip (return cached data)
 *   - no cache / expired → fetch live
 *
 * Never throws.
 *
 * @returns {Promise<void>}
 */
export async function smartRefresh() {
  // Clear aggregate in-memory cache to force re-merge
  _memLayer   = null;
  _memLayerAt = 0;
  // Each individual service will use its own cache logic:
  // - FRED: if in-memory or localStorage valid → returns cached, no network call
  // - Finnhub: same
  // - Circuit breakers prevent requests if auth has failed
  await _fetchAll();
}

/**
 * Returns the status of each data service from the last fetch cycle.
 * @returns {AggregatorStatus}
 */
export function getStatus() {
  return _lastStatus ?? _emptyStatus();
}

// ─────────────────────────────────────────────
// CORE AGGREGATION
// ─────────────────────────────────────────────

async function _fetchAll() {
  const [fredResult, dxyResult, newsResult, calResult, cotResult] = await Promise.allSettled([
    _safeFetch(() => FREDService.getMacroBundle()),
    _safeFetch(() => _getDXYBundle()),
    _safeFetch(() => FinnhubService.getNewsBundle()),
    _safeFetch(() => FinnhubService.getCalendarBundle()),
    _safeFetch(() => COTService.getCOTBundle()),
  ]);

  const fred     = fredResult.status   === 'fulfilled' ? fredResult.value   : null;
  const dxy      = dxyResult.status    === 'fulfilled' ? dxyResult.value    : null;
  const news     = newsResult.status   === 'fulfilled' ? newsResult.value   : null;
  const calendar = calResult.status    === 'fulfilled' ? calResult.value    : null;
  const cot      = cotResult.status    === 'fulfilled' ? cotResult.value    : null;

  const merged = {
    ...DEFAULT_MEMORY,
    ..._pickFREDFields(fred),
    ..._pickDXYFields(dxy),
    ..._pickNewsFields(news),
    ..._pickCalendarFields(calendar),
    ..._pickCOTFields(cot),
  };

  merged.data_source = _computeOverallSource([fred, dxy, news, calendar, cot]);

  // Store aggregate in-memory cache
  _memLayer   = merged;
  _memLayerAt = Date.now();

  _lastStatus    = _buildStatus(fred, dxy, news, calendar, cot);
  _lastFetchedAt = Date.now();

  return merged;
}

async function _safeFetch(fn) {
  try {
    return await fn();
  } catch (err) {
    // Only warn — never throw. Each service is independently optional.
    console.warn('[MemoryAggregator] Service error:', err.message);
    return null;
  }
}

// ─────────────────────────────────────────────
// DXY VIA DATA PROVIDER (EUR/USD derived)
// ─────────────────────────────────────────────

async function _getDXYBundle() {
  const [priceResult, candlesResult] = await Promise.allSettled([
    DataProvider.getDXYPrice(),
    DataProvider.getDXYCandles(30),
  ]);

  const dxyPrice   = priceResult.status   === 'fulfilled' ? priceResult.value   : null;
  const dxyCandles = candlesResult.status === 'fulfilled' ? candlesResult.value : null;

  if (!dxyPrice?.price) return null;

  const trend = (dxyCandles?.candles?.length >= 20)
    ? DataProvider.computeDXYTrend(dxyCandles.candles)
    : DEFAULT_MEMORY.dxy_trend;

  return {
    dxy_level:   parseFloat(dxyPrice.price.toFixed(3)),
    dxy_trend:   trend,
    data_source: dxyPrice.source ?? 'derived',
    fetched_at:  Date.now(),
  };
}

// ─────────────────────────────────────────────
// FIELD EXTRACTORS
// ─────────────────────────────────────────────

function _pickFREDFields(fred) {
  if (!fred) return {};
  const out = {};
  if (fred.cb_fed_stance_score  !== undefined) out.cb_fed_stance_score  = fred.cb_fed_stance_score;
  if (fred.cb_ecb_stance_score  !== undefined) out.cb_ecb_stance_score  = fred.cb_ecb_stance_score;
  if (fred.us_de_spread         !== undefined) out.us_de_spread         = fred.us_de_spread;
  if (fred.policy_momentum      !== undefined) out.policy_momentum      = fred.policy_momentum;
  if (fred.gdp_us_qoq           !== undefined) out.gdp_us_qoq           = fred.gdp_us_qoq;
  if (fred.gdp_eu_qoq           !== undefined) out.gdp_eu_qoq           = fred.gdp_eu_qoq;
  if (fred.cpi_us_yoy           !== undefined) out.cpi_us_yoy           = fred.cpi_us_yoy;
  if (fred.cpi_eu_yoy           !== undefined) out.cpi_eu_yoy           = fred.cpi_eu_yoy;
  if (fred.vix_level            !== undefined) out.vix_level            = fred.vix_level;
  if (fred.unemployment_us      !== undefined) out.unemployment_us      = fred.unemployment_us;
  if (fred.unemployment_eu      !== undefined) out.unemployment_eu      = fred.unemployment_eu;
  return out;
}

function _pickDXYFields(dxy) {
  if (!dxy) return {};
  const out = {};
  if (dxy.dxy_level !== undefined) out.dxy_level = dxy.dxy_level;
  if (dxy.dxy_trend !== undefined) out.dxy_trend = dxy.dxy_trend;
  return out;
}

function _pickNewsFields(news) {
  if (!news) return {};
  const out = {};
  if (news.news_net_score_24h        !== undefined) out.news_net_score_24h        = news.news_net_score_24h;
  if (news.news_net_score_7d         !== undefined) out.news_net_score_7d         = news.news_net_score_7d;
  if (news.news_net_score_30d        !== undefined) out.news_net_score_30d        = news.news_net_score_30d;
  if (news.headline_count_24h        !== undefined) out.headline_count_24h        = news.headline_count_24h;
  if (news.high_impact_count_24h     !== undefined) out.high_impact_count_24h     = news.high_impact_count_24h;
  if (news.narrative_shift           !== undefined) out.narrative_shift           = news.narrative_shift;
  if (news.narrative_shift_magnitude !== undefined) out.narrative_shift_magnitude = news.narrative_shift_magnitude;
  if (news.dominant_theme            !== undefined) out.dominant_theme            = news.dominant_theme;
  if (news.secondary_theme           !== undefined) out.secondary_theme           = news.secondary_theme;
  if (news.data_age_hours            !== undefined) out.data_age_hours            = news.data_age_hours;
  if (news.news_blackout             !== undefined) out.news_blackout             = news.news_blackout;
  return out;
}

function _pickCalendarFields(calendar) {
  if (!calendar) return {};
  const out = {};
  if (calendar.upcoming_event_risk !== undefined) out.upcoming_event_risk = calendar.upcoming_event_risk;
  if (calendar.event_within_hours  !== undefined) out.event_within_hours  = calendar.event_within_hours;
  if (calendar.event_impact_level  !== undefined) out.event_impact_level  = calendar.event_impact_level;
  if (calendar.news_blackout && !out.news_blackout) out.news_blackout = calendar.news_blackout;
  return out;
}

function _pickCOTFields(cot) {
  if (!cot) return {};
  const out = {};
  if (cot.cot_net_position  !== undefined) out.cot_net_position  = cot.cot_net_position;
  if (cot.cot_z_score_52w   !== undefined) out.cot_z_score_52w   = cot.cot_z_score_52w;
  if (cot.cot_z_score_26w   !== undefined) out.cot_z_score_26w   = cot.cot_z_score_26w;
  if (cot.cot_signal        !== undefined) out.cot_signal        = cot.cot_signal;
  if (cot.cot_trend_3w      !== undefined) out.cot_trend_3w      = cot.cot_trend_3w;
  if (cot.cot_extreme       !== undefined) out.cot_extreme       = cot.cot_extreme;
  if (cot.cot_change_weekly !== undefined) out.cot_change_weekly = cot.cot_change_weekly;
  if (cot.cot_change_4week  !== undefined) out.cot_change_4week  = cot.cot_change_4week;
  if (cot.data_age_days     !== undefined) out.data_age_days     = cot.data_age_days;
  return out;
}

// ─────────────────────────────────────────────
// DATA SOURCE AGGREGATION
// ─────────────────────────────────────────────

function _computeOverallSource(bundles) {
  const sources = bundles
    .filter(Boolean)
    .map(b => b.data_source ?? 'stub');

  if (sources.includes('stub'))    return 'stub';
  if (sources.includes('stale'))   return 'stale';
  if (sources.includes('cached'))  return 'cached';
  if (sources.includes('derived')) return 'live';   // derived counts as live
  if (sources.includes('live'))    return 'live';
  return 'stub';
}

// ─────────────────────────────────────────────
// STATUS BUILDER
// ─────────────────────────────────────────────

function _buildStatus(fred, dxy, news, calendar, cot) {
  return {
    fred: {
      status:     fred?.data_source  ?? 'missing',
      fetched_at: fred?.fetched_at   ?? 0,
      vix:        fred?.vix_level    ?? null,
      spread:     fred?.us_de_spread ?? null,
      auth_failed: FREDService.isAuthFailed?.() ?? false,
    },
    dxy: {
      status:     dxy?.data_source ?? 'missing',
      price:      dxy?.dxy_level   ?? null,
      trend:      dxy?.dxy_trend   ?? null,
      fetched_at: dxy?.fetched_at  ?? 0,
    },
    news: {
      status:     news?.data_source        ?? 'missing',
      score_24h:  news?.news_net_score_24h ?? null,
      count_24h:  news?.headline_count_24h ?? null,
      fetched_at: news?.fetched_at         ?? 0,
      auth_failed: FinnhubService.isAuthFailed?.() ?? false,
    },
    calendar: {
      status:           calendar?.data_source        ?? 'missing',
      next_event_hours: calendar?.event_within_hours ?? null,
      event_risk:       calendar?.upcoming_event_risk ?? false,
      fetched_at:       calendar?.fetched_at         ?? 0,
    },
    cot: {
      status:      cot?.data_source     ?? 'missing',
      z_score:     cot?.cot_z_score_52w ?? null,
      signal:      cot?.cot_signal      ?? null,
      report_date: cot?.report_date     ?? null,
      fetched_at:  cot?.fetched_at      ?? 0,
    },
    last_aggregated: _lastFetchedAt,
  };
}

function _emptyStatus() {
  return {
    fred:     { status: 'not_fetched', auth_failed: false },
    dxy:      { status: 'not_fetched' },
    news:     { status: 'not_fetched', auth_failed: false },
    calendar: { status: 'not_fetched' },
    cot:      { status: 'not_fetched' },
    last_aggregated: 0,
  };
}

/**
 * @typedef {Object} AggregatorStatus
 * @property {{ status, fetched_at, vix, spread, auth_failed }}     fred
 * @property {{ status, price, trend, fetched_at }}                  dxy
 * @property {{ status, score_24h, count_24h, fetched_at, auth_failed }} news
 * @property {{ status, next_event_hours, event_risk, fetched_at }}  calendar
 * @property {{ status, z_score, signal, report_date, fetched_at }}  cot
 * @property {number} last_aggregated
 */
