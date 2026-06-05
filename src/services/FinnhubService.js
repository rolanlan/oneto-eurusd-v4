/**
 * ONETO EUR/USD AI Tool — FinnhubService
 * =========================================
 * Finnhub API client for forex news sentiment and economic calendar.
 * One API key covers both endpoints.
 *
 * BUG-04 FIX: /news?category=forex is a PREMIUM endpoint (401 on free tier).
 * Changed to /news?category=general (free tier) with keyword filtering.
 *
 * Circuit breaker:
 *   If 401 or 403 is received, set _authFailed = true.
 *   No further requests until clearAuthFailure() is called
 *   (happens automatically when key is updated via Settings).
 *
 * Cache strategy:
 *   News:     4h memory / 4h localStorage
 *   Calendar: 1h memory / 2h localStorage
 *
 * Never throws. Always returns bundles (live, cached, or stub).
 *
 * V4.3 Data Integration | STEP 3 | BUG-04 + V4.6 refresh fix
 */

'use strict';

// ─────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────

const FINNHUB_BASE     = 'https://finnhub.io/api/v1';
const STORAGE_KEY_API  = 'finnhub_api_key_v4';
const STORAGE_KEY_NEWS = 'oneto_news_v1';
const STORAGE_KEY_CAL  = 'oneto_calendar_v1';

const TTL = Object.freeze({
  NEWS_MEM: 4 * 60 * 60 * 1000,
  NEWS_LS:  4 * 60 * 60 * 1000,
  CAL_MEM:  1 * 60 * 60 * 1000,
  CAL_LS:   2 * 60 * 60 * 1000,
});

const USD_BULLISH_KW = [
  'fed hawkish', 'rate hike', 'rate increase', 'strong gdp', 'strong jobs',
  'nfp beat', 'payrolls beat', 'dxy rise', 'dollar strength', 'ecb dovish',
  'eu recession', 'eu slowdown', 'fomc hike', 'taper', 'cpi hot',
  'inflation surge', 'fed tighten', 'dollar rally', 'usd strength',
];

const USD_BEARISH_KW = [
  'fed dovish', 'rate cut', 'rate decrease', 'weak gdp', 'weak jobs',
  'nfp miss', 'payrolls miss', 'dollar weakness', 'ecb hike', 'ecb hawkish',
  'eu recovery', 'eu growth', 'soft landing', 'fomc cut', 'eur strength',
  'euro rally', 'cpi cool', 'inflation easing', 'fed pause', 'recession us',
];

const RELEVANCE_KW = [
  'eur', 'usd', 'euro', 'dollar', 'ecb', 'fed', 'federal reserve',
  'fomc', 'cpi', 'gdp', 'nfp', 'payroll', 'rate', 'inflation',
  'boj', 'forex', 'eurusd', 'eur/usd', 'fx', 'monetary policy',
  'interest rate', 'central bank', 'treasury',
];

const HIGH_IMPACT_EVENTS = [
  'nonfarm', 'nfp', 'fomc', 'federal open', 'cpi', 'consumer price',
  'gdp', 'gross domestic', 'rate decision', 'unemployment', 'pmi',
  'ecb', 'european central', 'inflation', 'payroll',
];

// ─────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────

let _newsCache     = { bundle: null, fetchedAt: 0 };
let _calendarCache = { bundle: null, fetchedAt: 0 };

// Circuit breaker
let _authFailed    = false;
let _authFailedKey = '';

// ─────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────

/**
 * Returns aggregated news sentiment bundle.
 * Uses cache if available. Respects circuit breaker.
 * Never throws.
 *
 * @returns {Promise<NewsBundle>}
 */
export async function getNewsBundle() {
  const key = _getApiKey();

  // 1. Memory cache
  if (_newsCache.bundle && Date.now() - _newsCache.fetchedAt < TTL.NEWS_MEM) {
    return { ..._newsCache.bundle, data_source: 'cached' };
  }

  // 2. localStorage cache
  const stored = _loadCache(STORAGE_KEY_NEWS);
  if (stored?.bundle && Date.now() - stored.fetchedAt < TTL.NEWS_LS) {
    _newsCache = { bundle: stored.bundle, fetchedAt: stored.fetchedAt };
    return { ...stored.bundle, data_source: 'cached' };
  }

  // 3. No valid cache — check if we should make a live request
  if (!key) {
    if (stored?.bundle) return { ...stored.bundle, data_source: 'stale' };
    return _stubNewsBundle();
  }

  // Circuit breaker
  if (_authFailed && _authFailedKey === key) {
    if (stored?.bundle) return { ...stored.bundle, data_source: 'stale' };
    return _stubNewsBundle();
  }

  // 4. Live fetch
  try {
    const articles = await _fetchNews(key);
    const bundle   = _aggregateSentiment(articles);
    _newsCache = { bundle, fetchedAt: Date.now() };
    _saveCache(STORAGE_KEY_NEWS, bundle);
    _authFailed    = false;
    _authFailedKey = '';
    return { ...bundle, data_source: 'live' };
  } catch (err) {
    if (_isAuthError(err)) {
      _authFailed    = true;
      _authFailedKey = key;
      console.warn('[FinnhubService] Auth failed — news requests paused:', err.message);
    } else {
      console.warn('[FinnhubService] News fetch failed:', err.message);
    }
    if (stored?.bundle) return { ...stored.bundle, data_source: 'stale' };
    return _stubNewsBundle();
  }
}

/**
 * Returns economic calendar bundle.
 * Uses cache if available. Respects circuit breaker.
 * Never throws.
 *
 * @returns {Promise<CalendarBundle>}
 */
export async function getCalendarBundle() {
  const key = _getApiKey();

  // 1. Memory cache
  if (_calendarCache.bundle && Date.now() - _calendarCache.fetchedAt < TTL.CAL_MEM) {
    return { ..._calendarCache.bundle, data_source: 'cached' };
  }

  // 2. localStorage cache
  const stored = _loadCache(STORAGE_KEY_CAL);
  if (stored?.bundle && Date.now() - stored.fetchedAt < TTL.CAL_LS) {
    _calendarCache = { bundle: stored.bundle, fetchedAt: stored.fetchedAt };
    return { ...stored.bundle, data_source: 'cached' };
  }

  // 3. No valid cache
  if (!key) {
    if (stored?.bundle) return { ...stored.bundle, data_source: 'stale' };
    return _stubCalendarBundle();
  }

  // Circuit breaker
  if (_authFailed && _authFailedKey === key) {
    if (stored?.bundle) return { ...stored.bundle, data_source: 'stale' };
    return _stubCalendarBundle();
  }

  // 4. Live fetch
  try {
    const events = await _fetchCalendar(key);
    const bundle = _processCalendar(events);
    _calendarCache = { bundle, fetchedAt: Date.now() };
    _saveCache(STORAGE_KEY_CAL, bundle);
    return { ...bundle, data_source: 'live' };
  } catch (err) {
    if (_isAuthError(err)) {
      _authFailed    = true;
      _authFailedKey = key;
      console.warn('[FinnhubService] Auth failed — calendar requests paused:', err.message);
    } else {
      console.warn('[FinnhubService] Calendar fetch failed:', err.message);
    }
    if (stored?.bundle) return { ...stored.bundle, data_source: 'stale' };
    return _stubCalendarBundle();
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
 * Tests the Finnhub API key using the general news endpoint (free tier).
 * On success, resets the circuit breaker.
 * Never throws.
 *
 * @param {string} [key]
 * @returns {Promise<{valid: boolean, message: string}>}
 */
export async function testConnection(key) {
  const k = key ?? _getApiKey();
  if (!k) return { valid: false, message: 'No Finnhub API key provided' };

  try {
    const url = `${FINNHUB_BASE}/news?category=general&token=${k}`;
    const res  = await _fetchWithTimeout(url, 8000);

    if (res.status === 401) {
      _authFailed    = true;
      _authFailedKey = k;
      return { valid: false, message: 'Invalid API key (401 Unauthorized)' };
    }
    if (res.status === 403) {
      return { valid: false, message: 'Access forbidden (403) — check plan permissions' };
    }

    const json = await res.json();
    if (json.error) {
      _authFailed    = true;
      _authFailedKey = k;
      return { valid: false, message: json.error };
    }
    if (Array.isArray(json)) {
      try { localStorage.setItem(STORAGE_KEY_API, k); } catch (_) {}
      // Reset circuit breaker on success
      _authFailed    = false;
      _authFailedKey = '';
      return { valid: true, message: `Connected to Finnhub (${json.length} articles)` };
    }
    return { valid: false, message: 'Unexpected Finnhub response format' };
  } catch (err) {
    return { valid: false, message: err.message };
  }
}

/**
 * Clears in-memory and localStorage caches.
 */
export function clearCache() {
  _newsCache     = { bundle: null, fetchedAt: 0 };
  _calendarCache = { bundle: null, fetchedAt: 0 };
  try { localStorage.removeItem(STORAGE_KEY_NEWS); } catch (_) {}
  try { localStorage.removeItem(STORAGE_KEY_CAL);  } catch (_) {}
}

/**
 * Resets the circuit breaker. Call when a new key has been saved.
 */
export function clearAuthFailure() {
  _authFailed    = false;
  _authFailedKey = '';
}

// ─────────────────────────────────────────────
// NEWS FETCHING
// ─────────────────────────────────────────────

async function _fetchNews(key) {
  // BUG-04 FIX: category=general is free tier.
  // category=forex requires premium → 401.
  const url = `${FINNHUB_BASE}/news?category=general&token=${key}`;
  const res  = await _fetchWithTimeout(url, 8000);

  if (res.status === 401) throw new Error('Finnhub 401 Unauthorized');
  if (res.status === 403) throw new Error('Finnhub 403 Forbidden');
  if (res.status === 429) throw new Error('Finnhub 429 Rate limited');

  const json = await res.json();
  if (json.error) throw new Error(`Finnhub: ${json.error}`);
  if (!Array.isArray(json)) throw new Error('Non-array news response');
  return json;
}

function _aggregateSentiment(articles) {
  const now      = Date.now();
  const relevant = articles.filter(a => _isRelevant(a));

  let net24h = 0, net7d = 0, net30d = 0;
  let count24h = 0, highImpact24h = 0;
  let prevScore24h = 0;
  const themes = {};

  for (const a of relevant) {
    const ageMs    = now - (a.datetime * 1000);
    const ageHours = ageMs / 3600000;
    const score    = _scoreHeadline(a.headline + ' ' + (a.summary ?? ''));
    const weight   = Math.exp(-ageHours / 24);
    const weighted = score * weight;

    if (ageHours < 24)  { net24h += weighted; count24h++; if (Math.abs(score) >= 15) highImpact24h++; }
    if (ageHours < 168) { net7d  += weighted * (ageHours < 24 ? 1 : 0.5); }
    if (ageHours < 720) { net30d += weighted * (ageHours < 24 ? 1 : ageHours < 168 ? 0.5 : 0.2); }

    _extractTheme(a.headline, themes);
  }

  const prev24hArticles = relevant.filter(a => {
    const ageH = (now - a.datetime * 1000) / 3600000;
    return ageH >= 24 && ageH < 48;
  });
  for (const a of prev24hArticles) {
    prevScore24h += _scoreHeadline(a.headline + ' ' + (a.summary ?? ''));
  }

  const narrativeShift = Math.abs(net24h - prevScore24h) > 40;
  const shiftMagnitude = Math.min(100, Math.abs(net24h - prevScore24h));
  const dominantTheme  = _topTheme(themes);

  const mostRecent   = relevant[0];
  const dataAgeHours = mostRecent
    ? Math.round((now - mostRecent.datetime * 1000) / 3600000)
    : 24;

  const veryRecent   = relevant.find(a => (now - a.datetime * 1000) < 2 * 60 * 1000);
  const newsBlackout = Boolean(veryRecent && Math.abs(_scoreHeadline(veryRecent.headline)) >= 15);

  return {
    news_net_score_24h:        Math.round(net24h),
    news_net_score_7d:         Math.round(net7d * 0.3),
    news_net_score_30d:        Math.round(net30d * 0.1),
    headline_count_24h:        count24h,
    high_impact_count_24h:     highImpact24h,
    narrative_shift:           narrativeShift,
    narrative_shift_magnitude: Math.round(shiftMagnitude),
    dominant_theme:            dominantTheme,
    secondary_theme:           null,
    data_age_hours:            dataAgeHours,
    news_blackout:             newsBlackout,
    fetched_at:                now,
  };
}

function _isRelevant(article) {
  const text = (article.headline + ' ' + (article.summary ?? '')).toLowerCase();
  return RELEVANCE_KW.some(kw => text.includes(kw));
}

function _scoreHeadline(text) {
  const lower = text.toLowerCase();
  let score = 0;
  for (const kw of USD_BULLISH_KW) { if (lower.includes(kw)) score += 10; }
  for (const kw of USD_BEARISH_KW) { if (lower.includes(kw)) score -= 10; }
  return Math.max(-100, Math.min(100, score));
}

function _extractTheme(headline, themes) {
  const lower = headline.toLowerCase();
  const groups = {
    'USD Strength': ['dollar rally', 'usd strength', 'dollar strength'],
    'Fed Hawkish':  ['fed hike', 'rate hike', 'fomc hike', 'hawkish'],
    'ECB Dovish':   ['ecb cut', 'ecb dovish', 'eu slowdown'],
    'ECB Hawkish':  ['ecb hike', 'ecb hawkish'],
    'Fed Dovish':   ['fed cut', 'rate cut', 'fed dovish', 'soft landing'],
    'Inflation':    ['inflation', 'cpi', 'price index'],
    'Growth':       ['gdp', 'growth', 'recession'],
    'Jobs':         ['nfp', 'payroll', 'unemployment', 'jobs'],
  };
  for (const [theme, kws] of Object.entries(groups)) {
    if (kws.some(kw => lower.includes(kw))) {
      themes[theme] = (themes[theme] ?? 0) + 1;
    }
  }
}

function _topTheme(themes) {
  const entries = Object.entries(themes);
  if (!entries.length) return 'Mixed sentiment';
  return entries.sort((a, b) => b[1] - a[1])[0][0];
}

// ─────────────────────────────────────────────
// CALENDAR FETCHING
// ─────────────────────────────────────────────

async function _fetchCalendar(key) {
  const today    = new Date();
  const fromDate = _formatDate(today);
  const toDate   = _formatDate(new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000));
  const url      = `${FINNHUB_BASE}/calendar/economic?from=${fromDate}&to=${toDate}&token=${key}`;
  const res      = await _fetchWithTimeout(url, 8000);

  if (res.status === 401) throw new Error('Finnhub calendar 401 Unauthorized');
  if (res.status === 403) throw new Error('Finnhub calendar 403 Forbidden');

  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json.economicCalendar ?? [];
}

function _processCalendar(events) {
  const now      = Date.now();
  const relevant = events.filter(e => _isRelevantEvent(e));

  const upcoming = relevant
    .filter(e => new Date(e.time).getTime() > now)
    .sort((a, b) => new Date(a.time) - new Date(b.time));

  const nextEvent      = upcoming[0] ?? null;
  const hoursUntil     = nextEvent
    ? Math.max(0, (new Date(nextEvent.time).getTime() - now) / 3600000)
    : null;
  const withinWindow   = hoursUntil !== null && hoursUntil < 4;
  const impactLevel    = nextEvent ? (nextEvent.impact ?? 'low').toLowerCase() : 'low';
  const confirmedHigh  = nextEvent && _isHighImpactEvent(nextEvent.event ?? '');

  const next24h = upcoming
    .filter(e => (new Date(e.time).getTime() - now) < 24 * 3600000)
    .slice(0, 5)
    .map(e => ({ time: e.time, event: e.event, country: e.country, impact: e.impact }));

  return {
    upcoming_event_risk:  withinWindow && confirmedHigh,
    event_within_hours:   hoursUntil !== null ? parseFloat(hoursUntil.toFixed(1)) : null,
    event_impact_level:   confirmedHigh ? 'high' : impactLevel,
    news_blackout:        false,
    next_events_24h:      next24h,
    fetched_at:           now,
  };
}

function _isRelevantEvent(event) {
  const country = (event.country ?? '').toUpperCase();
  const impact  = (event.impact  ?? '').toLowerCase();
  return ['US', 'EU', 'DE', 'FR', 'EMU'].includes(country) && impact === 'high';
}

function _isHighImpactEvent(eventName) {
  return HIGH_IMPACT_EVENTS.some(kw => eventName.toLowerCase().includes(kw));
}

// ─────────────────────────────────────────────
// STUBS
// ─────────────────────────────────────────────

function _stubNewsBundle() {
  return {
    news_net_score_24h:        30,
    news_net_score_7d:         15,
    news_net_score_30d:         5,
    headline_count_24h:         0,
    high_impact_count_24h:      0,
    narrative_shift:           false,
    narrative_shift_magnitude:  0,
    dominant_theme:            'Mixed sentiment',
    secondary_theme:           null,
    data_age_hours:            24,
    news_blackout:             false,
    fetched_at:                0,
    data_source:               'stub',
  };
}

function _stubCalendarBundle() {
  return {
    upcoming_event_risk:  false,
    event_within_hours:   null,
    event_impact_level:   'low',
    news_blackout:        false,
    next_events_24h:      [],
    fetched_at:           0,
    data_source:          'stub',
  };
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function _isAuthError(err) {
  const msg = err.message ?? '';
  return msg.includes('401') || msg.includes('403') ||
         msg.includes('Unauthorized') || msg.includes('Forbidden');
}

function _getApiKey() {
  try { return localStorage.getItem(STORAGE_KEY_API) || ''; } catch (_) { return ''; }
}

function _loadCache(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (_) { return null; }
}

function _saveCache(key, bundle) {
  try {
    localStorage.setItem(key, JSON.stringify({ bundle, fetchedAt: Date.now() }));
  } catch (_) {}
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

function _formatDate(d) {
  return d.toISOString().slice(0, 10);
}

/**
 * @typedef {Object} NewsBundle
 * @property {number}  news_net_score_24h
 * @property {number}  news_net_score_7d
 * @property {number}  news_net_score_30d
 * @property {number}  headline_count_24h
 * @property {number}  high_impact_count_24h
 * @property {boolean} narrative_shift
 * @property {number}  narrative_shift_magnitude
 * @property {string}  dominant_theme
 * @property {string|null} secondary_theme
 * @property {number}  data_age_hours
 * @property {boolean} news_blackout
 * @property {number}  fetched_at
 * @property {string}  data_source
 */

/**
 * @typedef {Object} CalendarBundle
 * @property {boolean}     upcoming_event_risk
 * @property {number|null} event_within_hours
 * @property {string}      event_impact_level
 * @property {boolean}     news_blackout
 * @property {object[]}    next_events_24h
 * @property {number}      fetched_at
 * @property {string}      data_source
 */
