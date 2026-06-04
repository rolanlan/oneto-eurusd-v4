/**
 * ONETO EUR/USD AI Tool — Formatters
 * =====================================
 * Locale-aware display formatting utilities.
 * All formatters are re-exported from i18n.js for convenience,
 * with additional financial display helpers here.
 *
 * Architecture Freeze V4.0-R1 | Phase 2
 */

'use strict';

import { getLang } from '../i18n/i18n.js';

// Re-export all base formatters from i18n for single import convenience
export {
  formatPrice,
  formatPips,
  formatPct,
  formatLot,
  formatUSD,
  formatDate,
  formatDuration,
  formatConf,
} from '../i18n/i18n.js';

// ─────────────────────────────────────────────
// ADDITIONAL FINANCIAL FORMATTERS
// ─────────────────────────────────────────────

/**
 * Formats a P&L value with sign and color hint.
 * @param {number} n        - P&L in USD
 * @param {'usd'|'r'} unit
 * @returns {{ text: string, positive: boolean }}
 */
export function formatPnL(n, unit = 'usd') {
  if (isNaN(n)) return { text: '—', positive: false };
  const sign = n >= 0 ? '+' : '';
  const text = unit === 'r'
    ? `${sign}${n.toFixed(2)}R`
    : `${sign}$${Math.abs(n).toFixed(2)}`;
  return { text: n < 0 ? `-$${Math.abs(n).toFixed(2)}` : text, positive: n >= 0 };
}

/**
 * Formats an R/R ratio.
 * @param {number} n
 * @returns {string}  e.g. "1:2.60"
 */
export function formatRR(n) {
  if (isNaN(n) || n <= 0) return '—';
  return `1:${n.toFixed(2)}`;
}

/**
 * Formats an agent score (0–100) with directional label.
 * >55 = bearish, <45 = bullish, else neutral.
 * @param {number} score
 * @returns {{ text: string, direction: 'bearish'|'bullish'|'neutral' }}
 */
export function formatAgentScore(score) {
  if (isNaN(score)) return { text: '50', direction: 'neutral' };
  const direction = score > 55 ? 'bearish' : score < 45 ? 'bullish' : 'neutral';
  return { text: String(Math.round(score)), direction };
}

/**
 * Formats a weight as a percentage string.
 * @param {number} n  - 0–1
 * @returns {string}  e.g. "30%"
 */
export function formatWeight(n) {
  if (isNaN(n)) return '—';
  return `${Math.round(n * 100)}%`;
}

/**
 * Formats a price change as pips with sign.
 * @param {number} current
 * @param {number} previous
 * @returns {{ text: string, positive: boolean }}
 */
export function formatPriceChange(current, previous) {
  if (!current || !previous) return { text: '—', positive: false };
  const diff  = current - previous;
  const pips  = Math.round(diff / 0.0001);
  const sign  = pips >= 0 ? '+' : '';
  const unit  = getLang() === 'zh' ? '点' : ' pips';
  return { text: `${sign}${pips}${unit}`, positive: pips >= 0 };
}

/**
 * Formats a validation phase progress string.
 * @param {number} progress  - trades completed in current phase
 * @param {number} target    - target for current phase
 * @param {number} phase     - phase number 1–4
 * @returns {string}
 */
export function formatValidationProgress(progress, target, phase) {
  const lang = getLang();
  if (lang === 'zh') {
    return `第${phase}阶段: ${progress} / ${target} 笔`;
  }
  return `Phase ${phase}: ${progress} / ${target} trades`;
}

/**
 * Formats the data source indicator for UI display.
 * @param {'live'|'cached'|'simulated'} source
 * @returns {{ text: string, color: string }}
 */
export function formatDataSource(source) {
  const lang = getLang();
  const map = {
    live:      { en: 'LIVE',      zh: '实时',   color: 'var(--green)' },
    cached:    { en: 'CACHED',    zh: '缓存',   color: 'var(--amber)' },
    simulated: { en: 'SIMULATED', zh: '模拟',   color: 'var(--text3)' },
  };
  const entry = map[source] ?? map.simulated;
  return { text: entry[lang] ?? entry.en, color: entry.color };
}

/**
 * Formats a regime label with appropriate color.
 * @param {string} regime
 * @returns {{ text: string, color: string }}
 */
export function formatRegime(regime) {
  const lang = getLang();
  const map = {
    trending_bull:  { en: 'Trending Bull',  zh: '上升趋势', color: 'var(--green)'  },
    trending_bear:  { en: 'Trending Bear',  zh: '下降趋势', color: 'var(--red)'    },
    ranging:        { en: 'Ranging',        zh: '震荡区间', color: 'var(--amber)'  },
    volatile:       { en: 'Volatile',       zh: '高度波动', color: 'var(--red)'    },
    breakout_up:    { en: 'Breakout Up',    zh: '向上突破', color: 'var(--green)'  },
    breakout_down:  { en: 'Breakout Down',  zh: '向下突破', color: 'var(--red)'    },
  };
  const entry = map[regime] ?? { en: regime, zh: regime, color: 'var(--text3)' };
  return { text: entry[lang] ?? entry.en, color: entry.color };
}
