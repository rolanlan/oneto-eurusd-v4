/**
 * ONETO EUR/USD AI Tool — i18n Module
 * =====================================
 * Runtime internationalization layer.
 * EN = source of truth. ZH = display layer.
 * Dispatches 'languagechange' event on window — no page reload needed.
 *
 * Interface Contract 9 compliant.
 * Architecture Freeze V4.0-R1 | Phase 2
 */

'use strict';

import EN from './en.json' assert { type: 'json' };
import ZH from './zh.json' assert { type: 'json' };

const SUPPORTED   = ['en', 'zh'];
const STORAGE_KEY = 'language';
const DEFAULT_LANG = 'zh';

const LOCALES = { en: EN, zh: ZH };

// Current language (read from localStorage on init)
let _lang = _readLang();

// ─────────────────────────────────────────────
// CORE FUNCTIONS
// ─────────────────────────────────────────────

/**
 * Returns the localized string for a dot-notation key.
 * Falls back: ZH key → EN key → key itself.
 * Supports {{param}} interpolation.
 *
 * @param {string} key       - e.g. 'signal.sell', 'risk.level.LOW'
 * @param {object} [params]  - e.g. { n: 0.04, pct: '2%' }
 * @returns {string}
 */
export function t(key, params) {
  const str = _resolve(_lang, key) ?? _resolve('en', key) ?? key;
  if (!params) return str;
  return str.replace(/\{\{(\w+)\}\}/g, (_, k) =>
    params[k] !== undefined ? String(params[k]) : `{{${k}}}`
  );
}

/**
 * Sets the active language and dispatches 'languagechange' event.
 * @param {'en'|'zh'} lang
 */
export function setLang(lang) {
  if (!SUPPORTED.includes(lang)) return;
  _lang = lang;
  try { localStorage.setItem(STORAGE_KEY, lang); } catch (_) {}
  try {
    window.dispatchEvent(new CustomEvent('languagechange', { detail: { lang } }));
  } catch (_) {}
}

/**
 * Returns the current language code.
 * @returns {'en'|'zh'}
 */
export function getLang() {
  return _lang;
}

/**
 * Returns true if current language is Chinese.
 * @returns {boolean}
 */
export function isZH() {
  return _lang === 'zh';
}

// ─────────────────────────────────────────────
// NUMBER / DATE FORMATTERS
// ─────────────────────────────────────────────

/**
 * Formats a EUR/USD price to 5 decimal places.
 * @param {number} n
 * @returns {string}
 */
export function formatPrice(n) {
  if (isNaN(n) || n === 0) return '—';
  return parseFloat(n).toFixed(5);
}

/**
 * Formats pips with locale-aware unit suffix.
 * @param {number} n
 * @returns {string}  e.g. "50点" (ZH) or "50 pips" (EN)
 */
export function formatPips(n) {
  if (isNaN(n)) return '—';
  const unit = _lang === 'zh' ? '点' : ' pips';
  return `${Math.round(n)}${unit}`;
}

/**
 * Formats a 0–1 ratio as a percentage string.
 * @param {number} n  - 0–1 scale
 * @returns {string}  e.g. "2.0%"
 */
export function formatPct(n) {
  if (isNaN(n)) return '—';
  return `${(n * 100).toFixed(1)}%`;
}

/**
 * Formats a lot size.
 * @param {number} n
 * @returns {string}  e.g. "0.04手" (ZH) or "0.04 lot" (EN)
 */
export function formatLot(n) {
  if (isNaN(n) || n === 0) return '—';
  const unit = _lang === 'zh' ? '手' : ' lot';
  return `${parseFloat(n).toFixed(2)}${unit}`;
}

/**
 * Formats a USD amount.
 * @param {number} n
 * @returns {string}  e.g. "$20.00"
 */
export function formatUSD(n) {
  if (isNaN(n)) return '—';
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

/**
 * Formats a UNIX ms timestamp as a short datetime string.
 * @param {number} ts  - UNIX ms
 * @returns {string}
 */
export function formatDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  if (_lang === 'zh') {
    return `${d.getMonth() + 1}月${d.getDate()}日 ${_pad(d.getHours())}:${_pad(d.getMinutes())}`;
  }
  return d.toLocaleString('en-GB', {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/**
 * Formats a duration in minutes.
 * @param {number} minutes
 * @returns {string}  e.g. "2h 30m" or "2小时30分"
 */
export function formatDuration(minutes) {
  if (isNaN(minutes) || minutes < 0) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (_lang === 'zh') {
    return h > 0 ? `${h}小时${m}分` : `${m}分钟`;
  }
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/**
 * Formats a confidence value (0–100) as a string.
 * @param {number} n
 * @returns {string}  e.g. "72%" or "72%"
 */
export function formatConf(n) {
  if (isNaN(n)) return '—';
  return `${Math.round(n)}%`;
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

/**
 * Resolves a dot-notation key against a locale object.
 * Returns undefined if key not found.
 *
 * @param {'en'|'zh'} lang
 * @param {string} key
 * @returns {string|undefined}
 */
function _resolve(lang, key) {
  const locale = LOCALES[lang];
  if (!locale) return undefined;
  const parts = key.split('.');
  let node = locale;
  for (const part of parts) {
    if (node === null || typeof node !== 'object') return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
}

function _readLang() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (SUPPORTED.includes(stored)) return stored;
  } catch (_) {}
  return DEFAULT_LANG;
}

function _pad(n) {
  return String(n).padStart(2, '0');
}
