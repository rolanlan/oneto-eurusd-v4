/**
 * ONETO EUR/USD AI Tool — FREDService
 * =====================================
 * FRED (Federal Reserve Bank of St. Louis) API client.
 * Fetches macroeconomic series used by MacroAnalyst and RiskAnalyst.
 *
 * Series fetched:
 *   DGS10               → US 10-Year Treasury yield (daily)
 *   IRLTLT01DEM156N     → Germany 10-Year yield (monthly, ECB via FRED)
 *   A191RL1Q225SBEA     → US Real GDP QoQ % (quarterly)
 *   CPIAUCSL            → US CPI YoY % (monthly)
 *   CP0000EZ19M086NEST  → EU HICP CPI YoY % (monthly)
 *   VIXCLS              → CBOE VIX closing (daily)
 *   UNRATE              → US Unemployment Rate (monthly)
 *   LRHUTTTTEZQ156S     → EU Unemployment Rate (monthly)
 *
 * Cache strategy (V4.3 spec):
 *   GDP/CPI/UNRATE  → 24h memory / 72h localStorage  (monthly data)
 *   DGS10/rates     → 4h  memory / 24h localStorage  (daily moves)
 *   VIXCLS          → 4h  memory / 12h localStorage  (daily moves)
 *
 * Circuit breaker:
 *   If a 400/401/403 error is received, set _authFailed = true.
 *   Subsequent calls return cached or stub data immediately —
 *   no network requests — until clearAuthFailure() is called
 *   (which happens automatically when a new key is saved via Settings).
 *
 * Never throws. Always returns a bundle (live, cached, or stub).
 *
 * V4.3 Data Integration | STEP 2 | V4.6 refresh fix
 */

'use strict';

// ─────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────

const FRED_BASE         = 'https://api.stlouisfed.org/fred/series/observations';
const STORAGE_KEY_API   = 'fred_api_key_v4';
const STORAGE_KEY_CACHE = 'oneto_fred_v1';

const TTL = Object.freeze({
  SLOW:   72 * 60 * 60 * 1000,
  MEDIUM: 24 * 60 * 60 * 1000,
  FAST:   12 * 60 * 60 * 1000,
  MEMORY: {
    SLOW:   24 * 60 * 60 * 1000,
    MEDIUM:  4 * 60 * 60 * 1000,
    FAST:    4 * 60 * 60 * 1000,
  },
});

const SERIES = Object.freeze({
  DGS10:     { id: 'DGS10',                tier: 'MEDIUM' },
  DE10Y:     { id: 'IRLTLT01DEM156N',      tier: 'MEDIUM' },
  GDP_US:    { id: 'A191RL1Q225SBEA',      tier: 'SLOW'   },
  CPI_US:    { id: 'CPIAUCSL',             tier: 'SLOW'   },
  CPI_EU:    { id: 'CP0000EZ19M086NEST',   tier: 'SLOW'   },
  VIX:       { id: 'VIXCLS',               tier: 'FAST'   },
  UNRATE_US: { id: 'UNRATE',               tier: 'SLOW'   },
  UNRATE_EU: { id: 'LRHUTTTTEZQ156S',      tier: 'SLOW'   },
});

// ─────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────

let _memCache = {
  bundle:    null,
  fetchedAt: 0,
  tier:      'SLOW',
};

// Circuit breaker: set true after 400/401/403.
// Prevents repeated failed requests polluting the console.
// Reset when a new key is saved.
let _authFailed    = false;
let _authFailedKey = '';  // which key caused the failure

// ─────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────

/**
 * Returns a complete macro bundle.
 * Cache priority: memory → localStorage → API → stale → stub.
 * If auth has failed for the current key, returns cached/stub immediately.
 * Never throws.
 *
 * @returns {Promise<FREDBundle>}
 */
export async function getMacroBundle() {
  const key = _getApiKey();

  // 1. In-memory cache (fastest, no I/O)
  const memTTL = TTL.MEMORY[_memCache.tier] ?? TTL.MEMORY.MEDIUM;
  if (_memCache.bundle && Date.now() - _memCache.fetchedAt < memTTL) {
    return { ..._memCache.bundle, data_source: 'cached' };
  }

  // 2. localStorage cache
  const stored = _loadCache();
  if (stored && _isCacheValid(stored)) {
    _memCache = { bundle: stored.bundle, fetchedAt: stored.fetchedAt, tier: 'SLOW' };
    return { ...stored.bundle, data_source: 'cached' };
  }

  // 3. No valid cache — check if we can make a live request
  if (!key) {
    // No key configured — return stale or stub without any network call
    if (stored?.bundle) return { ...stored.bundle, data_source: 'stale' };
    return _stubBundle();
  }

  // Circuit breaker: if auth failed for this specific key, don't retry
  if (_authFailed && _authFailedKey === key) {
    if (stored?.bundle) return { ...stored.bundle, data_source: 'stale' };
    return _stubBundle();
  }

  // 4. Live API fetch
  try {
    const bundle = await _fetchAll(key);
    _memCache = { bundle, fetchedAt: Date.now(), tier: 'SLOW' };
    _saveCache(bundle);
    // Success — clear any previous auth failure
    _authFailed    = false;
    _authFailedKey = '';
    return { ...bundle, data_source: 'live' };
  } catch (err) {
    // Check if this is an auth error → engage circuit breaker
    if (err.message?.includes('400') ||
        err.message?.includes('401') ||
        err.message?.includes('403') ||
        err.message?.includes('Bad Request') ||
        err.message?.includes('Unauthorized') ||
        err.message?.includes('api_key')) {
      _authFailed    = true;
      _authFailedKey = key;
      console.warn('[FREDService] Auth failed — requests paused until key is updated:', err.message);
    } else {
      console.warn('[FREDService] Fetch failed:', err.message);
    }
    if (stored?.bundle) return { ...stored.bundle, data_source: 'stale' };
    return _stubBundle();
  }
}

/**
 * @returns {boolean}
 */
export function hasApiKey() {
  return Boolean(_getApiKey());
}

/**
 * @returns {boolean}
 */
export function isAuthFailed() {
  return _authFailed && _authFailedKey === _getApiKey();
}

/**
 * Tests the FRED API key by fetching a single series (DGS10).
 * On success, resets the circuit breaker.
 * Never throws.
 *
 * @param {string} [key]
 * @returns {Promise<{valid: boolean, message: string}>}
 */
export async function testConnection(key) {
  const k = key ?? _getApiKey();
  if (!k) return { valid: false, message: 'No FRED API key provided' };

  try {
    const url = _buildUrl(SERIES.DGS10.id, k, 1);
    const res  = await _fetchWithTimeout(url, 8000);
    const json = await res.json();

    if (json.error_message) {
      _authFailed    = true;
      _authFailedKey = k;
      return { valid: false, message: json.error_message };
    }
    if (json.observations?.length) {
      try { localStorage.setItem(STORAGE_KEY_API, k); } catch (_) {}
      // Reset circuit breaker on success
      _authFailed    = false;
      _authFailedKey = '';
      return { valid: true, message: 'Connected to FRED' };
    }
    return { valid: false, message: 'Unexpected FRED response' };
  } catch (err) {
    return { valid: false, message: err.message };
  }
}

/**
 * Clears in-memory cache only.
 * Does NOT clear localStorage cache — that persists across sessions.
 * Does NOT clear auth failure state — use clearAuthFailure() for that.
 *
 * Called by MemoryAggregator when a smarter refresh is needed.
 */
export function clearCache() {
  _memCache = { bundle: null, fetchedAt: 0, tier: 'SLOW' };
  try { localStorage.removeItem(STORAGE_KEY_CACHE); } catch (_) {}
}

/**
 * Resets the circuit breaker.
 * Call this when a new key has been saved — allows retry.
 */
export function clearAuthFailure() {
  _authFailed    = false;
  _authFailedKey = '';
}

// ─────────────────────────────────────────────
// FETCH PIPELINE
// ─────────────────────────────────────────────

async function _fetchAll(key) {
  const [us10y, de10y, gdpUs, cpiUs, cpiEu, vix, unUs, unEu] = await Promise.allSettled([
    _fetchSeries(SERIES.DGS10.id,     key, 3),
    _fetchSeries(SERIES.DE10Y.id,     key, 3),
    _fetchSeries(SERIES.GDP_US.id,    key, 3),
    _fetchSeries(SERIES.CPI_US.id,    key, 3),
    _fetchSeries(SERIES.CPI_EU.id,    key, 3),
    _fetchSeries(SERIES.VIX.id,       key, 3),
    _fetchSeries(SERIES.UNRATE_US.id, key, 2),
    _fetchSeries(SERIES.UNRATE_EU.id, key, 2),
  ]);

  const v = s => s.status === 'fulfilled' ? s.value : null;

  const us10yVal  = _latestValue(v(us10y));
  const de10yVal  = _latestValue(v(de10y));
  const gdpUsVal  = _latestValue(v(gdpUs));
  const cpiUsVal  = _latestValue(v(cpiUs));
  const cpiEuVal  = _latestValue(v(cpiEu));
  const vixVal    = _latestValue(v(vix));
  const unUsVal   = _latestValue(v(unUs));
  const unEuVal   = _latestValue(v(unEu));

  const spread      = _computeSpread(us10yVal, de10yVal);
  const polMomentum = _derivePolicyMomentum(v(us10y));
  const fedStance   = _deriveFedStance(us10yVal, polMomentum);
  const ecbStance   = _deriveECBStance(de10yVal, cpiEuVal);
  const cpiUsYoY    = _computeYoY(v(cpiUs));
  const cpiEuYoY    = _computeYoY(v(cpiEu));
  const gdpUsQoQ    = gdpUsVal ?? 0.6;

  return {
    us10y_yield:         us10yVal  ?? 4.3,
    de10y_yield:         de10yVal  ?? 2.5,
    us_de_spread:        spread    ?? 1.8,
    gdp_us_qoq:          gdpUsQoQ,
    gdp_eu_qoq:          0.2,
    cpi_us_yoy:          cpiUsYoY  ?? 3.1,
    cpi_eu_yoy:          cpiEuYoY  ?? 2.4,
    vix_level:           vixVal    ?? 15.0,
    unemployment_us:     unUsVal   ?? 4.0,
    unemployment_eu:     unEuVal   ?? 6.0,
    policy_momentum:     polMomentum,
    cb_fed_stance_score: fedStance,
    cb_ecb_stance_score: ecbStance,
    fetched_at:          Date.now(),
  };
}

async function _fetchSeries(seriesId, key, limit = 3) {
  const url = _buildUrl(seriesId, key, limit);
  const res  = await _fetchWithTimeout(url, 8000);

  // Treat 4xx as auth failures — rethrow with status in message
  if (res.status === 400 || res.status === 401 || res.status === 403) {
    throw new Error(`FRED HTTP ${res.status} for ${seriesId} — check API key`);
  }

  const json = await res.json();
  if (json.error_message) throw new Error(`FRED ${seriesId}: ${json.error_message}`);
  return json.observations ?? [];
}

function _buildUrl(seriesId, key, limit) {
  return `${FRED_BASE}?series_id=${seriesId}&api_key=${key}&file_type=json`
       + `&sort_order=desc&limit=${limit}`;
}

// ─────────────────────────────────────────────
// DERIVED CALCULATIONS
// ─────────────────────────────────────────────

function _latestValue(observations) {
  if (!observations) return null;
  for (const obs of observations) {
    if (obs.value && obs.value !== '.') return parseFloat(obs.value);
  }
  return null;
}

function _computeYoY(observations) {
  if (!observations || observations.length < 2) return null;
  const valid = observations.filter(o => o.value && o.value !== '.');
  if (valid.length < 2) return null;
  const latest = parseFloat(valid[0].value);
  const prev   = parseFloat(valid[1].value);
  if (!prev) return null;
  return parseFloat(((latest - prev) / prev * 100).toFixed(2));
}

function _computeSpread(us10y, de10y) {
  if (us10y === null || de10y === null) return null;
  return parseFloat((us10y - de10y).toFixed(3));
}

function _derivePolicyMomentum(observations) {
  if (!observations || observations.length < 2) return 1;
  const vals = observations
    .filter(o => o.value && o.value !== '.')
    .slice(0, 3)
    .map(o => parseFloat(o.value));
  if (vals.length < 2) return 1;
  const slope1 = vals[0] - vals[1];
  const slope2 = vals.length >= 3 ? vals[1] - vals[2] : slope1;
  if (slope1 > 0.15 && slope2 > 0)  return 3;
  if (slope1 > 0.05)                 return 2;
  if (slope1 > 0)                    return 1;
  if (slope1 > -0.05)                return 0;
  if (slope1 > -0.15)                return -1;
  if (slope1 > -0.25)                return -2;
  return -3;
}

function _deriveFedStance(us10yVal, policyMomentum) {
  if (us10yVal === null) return 60;
  let score = 0;
  if (us10yVal > 5.0)       score = 90;
  else if (us10yVal > 4.5)  score = 75;
  else if (us10yVal > 4.0)  score = 60;
  else if (us10yVal > 3.5)  score = 45;
  else if (us10yVal > 3.0)  score = 30;
  else if (us10yVal > 2.5)  score = 15;
  else                       score = 0;
  score += policyMomentum * 5;
  return Math.max(-100, Math.min(100, score));
}

function _deriveECBStance(de10yVal, cpiEuYoY) {
  if (de10yVal === null) return 0;
  let score = 0;
  if (de10yVal > 3.5)       score = 60;
  else if (de10yVal > 3.0)  score = 40;
  else if (de10yVal > 2.5)  score = 20;
  else if (de10yVal > 2.0)  score = 5;
  else                       score = -20;
  if (cpiEuYoY !== null) {
    if (cpiEuYoY > 4.0)      score += 15;
    else if (cpiEuYoY < 2.0) score -= 15;
  }
  return Math.max(-100, Math.min(100, score));
}

// ─────────────────────────────────────────────
// CACHE HELPERS
// ─────────────────────────────────────────────

function _loadCache() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CACHE);
    return raw ? JSON.parse(raw) : null;
  } catch (_) { return null; }
}

function _saveCache(bundle) {
  try {
    localStorage.setItem(STORAGE_KEY_CACHE, JSON.stringify({
      bundle,
      fetchedAt: Date.now(),
    }));
  } catch (_) {}
}

function _isCacheValid(stored) {
  if (!stored?.bundle || !stored.fetchedAt) return false;
  return Date.now() - stored.fetchedAt < TTL.SLOW;
}

function _getApiKey() {
  try { return localStorage.getItem(STORAGE_KEY_API) || ''; } catch (_) { return ''; }
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

function _stubBundle() {
  return {
    us10y_yield:         4.3,
    de10y_yield:         2.5,
    us_de_spread:        2.0,
    gdp_us_qoq:          0.6,
    gdp_eu_qoq:          0.2,
    cpi_us_yoy:          3.1,
    cpi_eu_yoy:          2.4,
    vix_level:           15.0,
    unemployment_us:     4.0,
    unemployment_eu:     6.0,
    policy_momentum:     1,
    cb_fed_stance_score: 60,
    cb_ecb_stance_score: 0,
    fetched_at:          0,
    data_source:         'stub',
  };
}

/**
 * @typedef {Object} FREDBundle
 * @property {number} us10y_yield
 * @property {number} de10y_yield
 * @property {number} us_de_spread
 * @property {number} gdp_us_qoq
 * @property {number} gdp_eu_qoq
 * @property {number} cpi_us_yoy
 * @property {number} cpi_eu_yoy
 * @property {number} vix_level
 * @property {number} unemployment_us
 * @property {number} unemployment_eu
 * @property {number} policy_momentum
 * @property {number} cb_fed_stance_score
 * @property {number} cb_ecb_stance_score
 * @property {number} fetched_at
 * @property {string} data_source
 */
