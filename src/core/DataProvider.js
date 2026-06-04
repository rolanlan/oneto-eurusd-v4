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