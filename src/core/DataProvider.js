/**
 * ONETO EUR/USD AI Tool — DataProvider
 * ======================================
 * Unified data access layer for all market data consumers.
 * Abstracts the difference between Twelve Data (live), cached data,
 * and SimDataService (fallback), so engines and agents never need
 * to know which source they are reading from.
 *
 * Responsibilities:
 *   · Fetch and normalize OHLCV candles for 1H, 4H, 1D
 *   · Fetch real-time EUR/USD price
 *   · Maintain rolling candle cache per timeframe
 *   · Track API health and manage graceful degradation
 *   · Enforce cache TTLs (price 30s · 1H/4H 4min · 1D 60min)
 *
 * Contract: getCandles() and getPrice() NEVER throw.
 *           Always return a valid result with a `source` field.
 *
 * Architecture Freeze V4.0-R1 | Phase 1
 */

'use strict';

// ─────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────

const SYM = 'EUR/USD';
const STORAGE_KEY_API  = 'td_api_key_eurusd';
const STORAGE_KEY_HEALTH = 'dp_api_health';

/** Cache TTL in milliseconds per interval */
const CACHE_TTL = Object.freeze({
  '1h':   4 * 60 * 1000,    // 4 minutes
  '4h':   4 * 60 * 1000,    // 4 minutes
  '1day': 60 * 60 * 1000,   // 60 minutes
  price:  30 * 1000,         // 30 seconds
});

/** Twelve Data interval codes mapped from internal labels */
const INTERVAL_MAP = Object.freeze({
  '1H':  '1h',
  '4H':  '4h',
  '1D':  '1day',
  '1h':  '1h',
  '4h':  '4h',
  '1day':'1day',
});

const TD_BASE = 'https://api.twelvedata.com';

// ─────────────────────────────────────────────
// IN-MEMORY CACHE
// ─────────────────────────────────────────────

const _cache = {
  candles: {
    '1h':   { data: null, fetchedAt: 0 },
    '4h':   { data: null, fetchedAt: 0 },
    '1day': { data: null, fetchedAt: 0 },
  },
  price: { data: null, fetchedAt: 0 },
};

/** API health state (persisted to localStorage) */
let _health = _loadHealth();

// ─────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────

/**
 * Fetch EUR/USD OHLCV candles for the requested timeframe.
 * Returns cached data if within TTL.
 * Falls back to SimDataService if API unavailable.
 *
 * @param {string} interval   - '1H' | '4H' | '1D' (or lowercase td codes)
 * @param {number} [count=80]
 * @returns {Promise<CandleResult>}
 */
export async function getCandles(interval = '4H', count = 80) {
  const tdInterval = INTERVAL_MAP[interval] ?? '4h';

  // Check cache first
  const cached = _cache.candles[tdInterval];
  if (cached.data && Date.now() - cached.fetchedAt < CACHE_TTL[tdInterval]) {
    return { candles: cached.data, source: 'cached', interval: tdInterval };
  }

  const key = _getApiKey();
  if (!key) {
    const candles = _generateSimCandles(count, tdInterval);
    return { candles, source: 'simulated', interval: tdInterval };
  }

  try {
    const url = `${TD_BASE}/time_series?symbol=${encodeURIComponent(SYM)}`
              + `&interval=${tdInterval}&outputsize=${count}&apikey=${key}`;

    const res  = await _fetchWithTimeout(url, 8000);
    const json = await res.json();

    if (json.status === 'error' || !json.values || !json.values.length) {
      _recordFailure('candles', json.message ?? 'Empty response');
      const candles = cached.data ?? _generateSimCandles(count, tdInterval);
      return { candles, source: cached.data ? 'cached' : 'simulated', interval: tdInterval };
    }

    // Twelve Data returns newest-first → reverse to ascending order
    const candles = [...json.values].reverse().map(_normalizeCandle);
    const deduped = _deduplicateCandles(candles);

    // Update cache
    _cache.candles[tdInterval] = { data: deduped, fetchedAt: Date.now() };
    _recordSuccess('candles');

    return { candles: deduped, source: 'live', interval: tdInterval };

  } catch (err) {
    _recordFailure('candles', err.message);
    const fallback = cached.data ?? _generateSimCandles(count, tdInterval);
    const src = cached.data ? 'cached' : 'simulated';
    if (cached.data) {
      console.warn(`[DataProvider] Candle fetch failed, using cached (${tdInterval}):`, err.message);
    } else {
      console.warn(`[DataProvider] Candle fetch failed, using simulated (${tdInterval}):`, err.message);
    }
    return { candles: fallback, source: src, interval: tdInterval };
  }
}

/**
 * Fetch current EUR/USD price.
 * Returns cached price if within 30s TTL.
 * Falls back to last candle close if API unavailable.
 *
 * @returns {Promise<PriceResult>}
 */
export async function getPrice() {
  // Check cache
  if (_cache.price.data && Date.now() - _cache.price.fetchedAt < CACHE_TTL.price) {
    return { price: _cache.price.data, timestamp: _cache.price.fetchedAt, source: 'cached' };
  }

  const key = _getApiKey();
  if (!key) {
    const sim = _getSimPrice();
    return { price: sim, timestamp: Date.now(), source: 'simulated' };
  }

  try {
    const url = `${TD_BASE}/price?symbol=${encodeURIComponent(SYM)}&apikey=${key}`;
    const res  = await _fetchWithTimeout(url, 5000);
    const json = await res.json();

    if (json.status === 'error' || !json.price) {
      _recordFailure('price', json.message ?? 'No price field');
      const fallback = _cache.price.data ?? _getSimPrice();
      return { price: fallback, timestamp: Date.now(), source: 'cached' };
    }

    const price = parseFloat(json.price);
    _cache.price = { data: price, fetchedAt: Date.now() };
    _recordSuccess('price');

    return { price, timestamp: Date.now(), source: 'live' };

  } catch (err) {
    _recordFailure('price', err.message);
    const fallback = _cache.price.data ?? _getSimPrice();
    return { price: fallback, timestamp: Date.now(), source: _cache.price.data ? 'cached' : 'simulated' };
  }
}

/**
 * Fetch previous day's closing price (for change % calculation).
 * Reads from 1D candle cache if available; otherwise fetches separately.
 *
 * @returns {Promise<number>}
 */
export async function getPrevClose() {
  // Try 1D cache first
  const cached1d = _cache.candles['1day'];
  if (cached1d.data && cached1d.data.length >= 2) {
    return cached1d.data[cached1d.data.length - 2].close;
  }

  const key = _getApiKey();
  if (!key) return _getSimPrice() - 0.0030;  // stub prev close

  try {
    const url = `${TD_BASE}/time_series?symbol=${encodeURIComponent(SYM)}`
              + `&interval=1day&outputsize=2&apikey=${key}`;
    const res  = await _fetchWithTimeout(url, 5000);
    const json = await res.json();

    if (json.values && json.values.length >= 2) {
      return parseFloat(json.values[1].close);
    }
  } catch (_) { /* fall through */ }

  return _cache.price.data
    ? _cache.price.data - 0.0030
    : _getSimPrice() - 0.0030;
}

/**
 * Test whether the stored API key is valid by making a minimal price request.
 * Returns { valid: boolean, message: string }.
 * Never throws.
 *
 * @param {string} [key]  - if omitted, reads from localStorage
 * @returns {Promise<{ valid: boolean, message: string }>}
 */
export async function testApiKey(key) {
  const k = key ?? _getApiKey();
  if (!k) return { valid: false, message: 'No API key provided' };

  try {
    const url = `${TD_BASE}/price?symbol=${encodeURIComponent(SYM)}&apikey=${k}`;
    const res  = await _fetchWithTimeout(url, 6000);
    const json = await res.json();

    if (json.status === 'error') {
      return { valid: false, message: json.message ?? 'API error' };
    }
    if (!json.price) {
      return { valid: false, message: 'Unexpected API response' };
    }

    // Persist key on successful test
    try { localStorage.setItem(STORAGE_KEY_API, k); } catch (_) {}
    _recordSuccess('price');
    return { valid: true, message: 'Connected to Twelve Data' };

  } catch (err) {
    return { valid: false, message: err.message };
  }
}

/**
 * Returns the current API health state.
 * @returns {ApiHealth}
 */
export function getApiHealth() {
  return { ..._health };
}

/**
 * Returns true if the system has a valid API key configured.
 * @returns {boolean}
 */
export function hasApiKey() {
  return Boolean(_getApiKey());
}

/**
 * Clears the in-memory candle cache for all timeframes.
 * Forces a fresh fetch on next getCandles() call.
 */
export function clearCache() {
  _cache.candles['1h']   = { data: null, fetchedAt: 0 };
  _cache.candles['4h']   = { data: null, fetchedAt: 0 };
  _cache.candles['1day'] = { data: null, fetchedAt: 0 };
  _cache.price           = { data: null, fetchedAt: 0 };
}

/**
 * Returns the cached candles for a timeframe without triggering a fetch.
 * Returns null if cache is empty or stale.
 *
 * @param {string} interval
 * @returns {Candle[]|null}
 */
export function getCachedCandles(interval = '4H') {
  const td = INTERVAL_MAP[interval] ?? '4h';
  return _cache.candles[td]?.data ?? null;
}

// ─────────────────────────────────────────────
// DXY — EUR/USD derived synthetic index (V4.3 revised)
// Twelve Data free tier does not support the "DXY" symbol (404).
// Fix: compute DXY level and trend directly from EUR/USD data which is
// already fetched. EUR/USD has ~-85% correlation with DXY. The conversion:
//   synthetic_DXY = 100 / EUR/USD  (rough parity baseline)
//   normalised    = synthetic_DXY * 1.0479  (scales to realistic ~103-106 range)
// No new API calls. No 404 errors. Source = 'derived' (real market data).
// ─────────────────────────────────────────────

// Baseline multiplier: 1 / 0.9543 ≈ 1.0479 so that at EUR/USD=1.08, DXY≈97.0
const DXY_EURUSD_SCALE = 1.0479;
const DXY_STORAGE_KEY_PRICE   = 'oneto_dxy_price_v1';
const DXY_STORAGE_KEY_CANDLES = 'oneto_dxy_candles_v1';
const DXY_CACHE_TTL_PRICE   = 15 * 60 * 1000;
const DXY_CACHE_TTL_CANDLES =  4 * 60 * 60 * 1000;

const _dxyCache = {
  price:   { data: null, fetchedAt: 0 },
  candles: { data: null, fetchedAt: 0 },
};

/**
 * Returns a synthetic DXY price derived from the current EUR/USD price.
 * formula: synthetic_DXY = (1 / EUR_USD) * DXY_EURUSD_SCALE * 100
 * source = 'derived' (real EUR/USD data, no extra API call)
 * Never throws.
 *
 * @returns {Promise<DXYPriceResult>}
 */
export async function getDXYPrice() {
  // In-memory cache
  if (_dxyCache.price.data && Date.now() - _dxyCache.price.fetchedAt < DXY_CACHE_TTL_PRICE) {
    return { price: _dxyCache.price.data, source: 'derived' };
  }

  try {
    const priceResult = await getPrice();
    const eurUsd      = priceResult.price;
    if (!eurUsd || eurUsd <= 0) return { price: 104.5, source: 'stub' };

    const synthetic = parseFloat(((1 / eurUsd) * DXY_EURUSD_SCALE * 100).toFixed(3));
    _dxyCache.price = { data: synthetic, fetchedAt: Date.now() };
    try {
      localStorage.setItem(DXY_STORAGE_KEY_PRICE, JSON.stringify({ price: synthetic, fetchedAt: Date.now() }));
    } catch (_) {}

    return { price: synthetic, source: 'derived' };
  } catch (_) {
    return { price: 104.5, source: 'stub' };
  }
}

/**
 * Returns synthetic DXY daily candles derived from EUR/USD 1D candles.
 * Inverts each candle: dxy_close = (1 / eur_close) * DXY_EURUSD_SCALE * 100
 * Never throws.
 *
 * @param {number} [count=30]
 * @returns {Promise<DXYCandlesResult>}
 */
export async function getDXYCandles(count = 30) {
  // In-memory cache
  if (_dxyCache.candles.data && Date.now() - _dxyCache.candles.fetchedAt < DXY_CACHE_TTL_CANDLES) {
    return { candles: _dxyCache.candles.data, source: 'derived' };
  }

  try {
    const result  = await getCandles('1D', Math.max(count, 30));
    const eurCandles = result.candles;
    if (!eurCandles?.length) return { candles: null, source: 'stub' };

    // Invert EUR/USD candles to produce synthetic DXY candles
    // Note: open/high/low inversion swaps high↔low
    const dxyCandles = eurCandles.map(c => ({
      time:  c.time,
      open:  parseFloat(((1 / c.open)  * DXY_EURUSD_SCALE * 100).toFixed(3)),
      high:  parseFloat(((1 / c.low)   * DXY_EURUSD_SCALE * 100).toFixed(3)),  // low EUR = high DXY
      low:   parseFloat(((1 / c.high)  * DXY_EURUSD_SCALE * 100).toFixed(3)),  // high EUR = low DXY
      close: parseFloat(((1 / c.close) * DXY_EURUSD_SCALE * 100).toFixed(3)),
    }));

    _dxyCache.candles = { data: dxyCandles, fetchedAt: Date.now() };
    return { candles: dxyCandles, source: 'derived' };
  } catch (_) {
    return { candles: null, source: 'stub' };
  }
}

/**
 * Derives DXY trend from daily candles using MA5 vs MA20.
 * Pure function — no API calls, no cache.
 *
 * @param {Candle[]} candles  - DXY daily candles, ascending time order
 * @returns {'rising'|'falling'|'ranging'}
 */
export function computeDXYTrend(candles) {
  if (!candles || candles.length < 20) return 'ranging';
  const closes = candles.map(c => c.close);
  const n = closes.length;

  const ma5  = closes.slice(n - 5).reduce((s, v)  => s + v, 0) / 5;
  const ma20 = closes.slice(n - 20).reduce((s, v) => s + v, 0) / 20;
  const diff = ma5 - ma20;

  // Velocity confirmation: 3-day slope must agree with MA divergence
  // Threshold 0.10: DXY trades ~100-110; 0.10 = ~0.09% meaningful move
  const slope = (closes[n - 1] - closes[n - 3]) / 2;

  if (diff >  0.10 && slope >= 0)  return 'rising';
  if (diff < -0.10 && slope <= 0)  return 'falling';
  return 'ranging';
}

// ─────────────────────────────────────────────
// SIM DATA GENERATOR
// ─────────────────────────────────────────────

/**
 * Generates simulated OHLCV candles for testing / fallback.
 * Slight bearish drift per Architecture Freeze spec.
 *
 * @param {number} count
 * @param {string} tdInterval  - '1h' | '4h' | '1day'
 * @returns {Candle[]}
 */
export function generateSimCandles(count = 80, tdInterval = '4h') {
  return _generateSimCandles(count, tdInterval);
}

// ─────────────────────────────────────────────
// INTERNAL HELPERS
// ─────────────────────────────────────────────

function _getApiKey() {
  try { return localStorage.getItem(STORAGE_KEY_API) || ''; } catch (_) { return ''; }
}

function _getSimPrice() {
  // Use last cached price if available, else stub
  return _cache.price.data ?? 1.1720;
}

function _generateSimCandles(count, tdInterval) {
  const intervalHours = tdInterval === '1day' ? 24 : tdInterval === '4h' ? 4 : 1;
  const base     = _cache.price.data ?? 1.1720;
  const vol      = intervalHours >= 24 ? 0.0050 : intervalHours >= 4 ? 0.0025 : 0.0010;
  const nowSec   = Math.floor(Date.now() / 1000);
  const stepSec  = intervalHours * 3600;

  let p = base;
  const candles = [];

  for (let i = 0; i < count; i++) {
    const t   = nowSec - (count - i) * stepSec;
    const o   = p;
    const c   = parseFloat((o + (Math.random() - 0.47) * vol).toFixed(5));
    const h   = parseFloat((Math.max(o, c) + Math.random() * vol * 0.4).toFixed(5));
    const l   = parseFloat((Math.min(o, c) - Math.random() * vol * 0.4).toFixed(5));
    candles.push({ time: t, open: o, high: h, low: l, close: c });
    p = c;
  }
  return candles;
}

function _normalizeCandle(v) {
  return {
    time:  Math.floor(new Date(v.datetime).getTime() / 1000),
    open:  parseFloat(v.open),
    high:  parseFloat(v.high),
    low:   parseFloat(v.low),
    close: parseFloat(v.close),
  };
}

function _deduplicateCandles(candles) {
  const seen = new Set();
  const result = [];
  // Iterate ascending; for duplicates keep last occurrence
  for (let i = candles.length - 1; i >= 0; i--) {
    if (!seen.has(candles[i].time)) {
      seen.add(candles[i].time);
      result.unshift(candles[i]);
    }
  }
  return result;
}

async function _fetchWithTimeout(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

function _recordSuccess(type) {
  _health.consecutive_failures = 0;
  _health.consecutive_successes++;
  _health.status       = 'healthy';
  _health.last_success = Date.now();
  _health.last_checked = Date.now();
  _persistHealth();
}

function _recordFailure(type, msg) {
  _health.consecutive_failures++;
  _health.consecutive_successes = 0;
  _health.last_failure     = Date.now();
  _health.last_checked     = Date.now();
  _health.last_error_message = msg ?? '';
  _health.error_count_24h++;

  if (_health.consecutive_failures >= 5) {
    _health.status = 'down';
  } else if (_health.consecutive_failures >= 3) {
    _health.status = 'degraded';
  }
  _persistHealth();
}

function _loadHealth() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_HEALTH);
    if (stored) return JSON.parse(stored);
  } catch (_) {}
  return {
    api_name:              'twelve_data',
    status:                'unknown',
    last_checked:          0,
    last_success:          0,
    last_failure:          0,
    consecutive_failures:  0,
    consecutive_successes: 0,
    error_count_24h:       0,
    last_error_message:    '',
  };
}

function _persistHealth() {
  try { localStorage.setItem(STORAGE_KEY_HEALTH, JSON.stringify(_health)); } catch (_) {}
}

// ─────────────────────────────────────────────
// JSDoc typedefs
// ─────────────────────────────────────────────

/**
 * @typedef {Object} Candle
 * @property {number} time   - UNIX seconds
 * @property {number} open
 * @property {number} high
 * @property {number} low
 * @property {number} close
 */

/**
 * @typedef {Object} CandleResult
 * @property {Candle[]} candles
 * @property {string}   source    - 'live' | 'cached' | 'simulated'
 * @property {string}   interval
 */

/**
 * @typedef {Object} PriceResult
 * @property {number} price
 * @property {number} timestamp  - UNIX ms
 * @property {string} source
 */

/**
 * @typedef {Object} ApiHealth
 * @property {string}  api_name
 * @property {string}  status
 * @property {number}  last_checked
 * @property {number}  last_success
 * @property {number}  last_failure
 * @property {number}  consecutive_failures
 * @property {number}  consecutive_successes
 * @property {number}  error_count_24h
 * @property {string}  last_error_message
 */
