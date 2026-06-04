/**
 * ONETO EUR/USD AI Tool — SimDataService
 * ========================================
 * Standalone simulated candle generator.
 * Permanent fallback — always available, no network required.
 * Called by DataProvider when API key is absent or API fails.
 *
 * Generates realistic random-walk EUR/USD OHLCV data.
 * Slight bearish drift (Math.random() - 0.47) per Architecture Freeze spec.
 *
 * Interface Contract 8 compliant.
 * Architecture Freeze V4.0-R1 | Phase 2
 */

'use strict';

// ─────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────

const DEFAULT_BASE      = 1.1720;
const DEFAULT_COUNT     = 80;
const DEFAULT_INTERVAL  = 4;   // hours
const DEFAULT_VOLATILITY = 0.0025;

// ─────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────

/**
 * Generates simulated EUR/USD OHLCV candles.
 * Always returns exactly `count` candles. Never throws.
 *
 * @param {number} [count=80]
 * @param {number} [basePrice=1.1720]
 * @param {number} [volatility=0.0025]   - pip range per candle
 * @param {number} [intervalHours=4]
 * @returns {Candle[]}  ascending time order
 */
export function getCandles(
  count        = DEFAULT_COUNT,
  basePrice    = DEFAULT_BASE,
  volatility   = DEFAULT_VOLATILITY,
  intervalHours = DEFAULT_INTERVAL,
) {
  const n       = Math.max(1, Math.min(500, Math.round(count)));
  const nowSec  = Math.floor(Date.now() / 1000);
  const stepSec = Math.round(intervalHours * 3600);

  let price = basePrice;
  const candles = [];

  for (let i = 0; i < n; i++) {
    const time  = nowSec - (n - i) * stepSec;
    const open  = price;
    // Slight bearish drift: mean (Math.random() - 0.47) is -0.03 * vol per bar
    const move  = (Math.random() - 0.47) * volatility;
    const close = parseFloat(Math.max(0.5, open + move).toFixed(5));
    const spread = Math.random() * volatility * 0.5;
    const high  = parseFloat((Math.max(open, close) + Math.random() * spread).toFixed(5));
    const low   = parseFloat((Math.min(open, close) - Math.random() * spread).toFixed(5));

    candles.push({ time, open, high, low, close });
    price = close;
  }

  return candles;
}

/**
 * Generates a single simulated price.
 * @param {number} [base=1.1720]
 * @returns {number}
 */
export function getPrice(base = DEFAULT_BASE) {
  return parseFloat((base + (Math.random() - 0.5) * 0.002).toFixed(5));
}

/**
 * Returns human-readable description of the data source.
 * @returns {{ source: 'simulated', label_en: string, label_zh: string }}
 */
export function getSourceInfo() {
  return {
    source:   'simulated',
    label_en: 'Simulated Data',
    label_zh: '模拟数据',
  };
}
