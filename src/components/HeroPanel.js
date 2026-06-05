/**
 * ONETO EUR/USD AI Tool — HeroPanel
 * ====================================
 * Dashboard hero section.
 * Displays: EUR/USD price + change, signal direction arrow,
 * animated confidence ring, 5 mini agent score bars,
 * trade plan (entry · SL · TP · RR · lot), session + regime badges.
 *
 * Data sources:
 *   AppState.getCurrentPrice()    — live price
 *   AppState.getPrevClose()       — previous close for change %
 *   AppState.getLastSignal()      — signal record
 *   AppState.getLastVotes()       — agent votes for mini-bars
 *   AppState.getDataSource()      — live|cached|simulated badge
 *
 * Events listened:
 *   window 'stateUpdated'    — re-render on data refresh
 *   window 'signalGenerated' — re-render on new signal
 *   window 'languagechange'  — re-render with new locale
 *
 * CSS classes required (from styles/):
 *   .hero-panel, .hero-price, .price-value, .price-change,
 *   .price-change.positive, .price-change.negative,
 *   .signal-arrow, .signal-arrow.buy, .signal-arrow.sell,
 *   .signal-arrow.neutral, .confidence-ring, .ring-svg,
 *   .ring-track, .ring-fill, .ring-label, .ring-value,
 *   .mini-scores, .mini-score-bar, .mini-score-fill,
 *   .trade-plan, .trade-plan-row, .plan-label, .plan-value,
 *   .session-badge, .regime-badge, .data-source-badge,
 *   .signal-label, .no-trade-banner
 *
 * Architecture Freeze V4.0-R1 | Phase 4B
 */

'use strict';

import * as AppState from '../state/AppState.js';
import { t, getLang, formatPrice, formatPips, formatPct, formatLot, formatUSD } from '../i18n/i18n.js';
import { SIGNAL_STRENGTH, SIGNAL_DIRECTION, getStrengthLabel, isActionable } from '../types/Signal.js';
import { AGENT, AGENT_META } from '../types/Vote.js';
import * as MemoryAggregator from '../services/MemoryAggregator.js';

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────

const RING_RADIUS      = 52;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

// Agent display order in mini-bars
const AGENT_ORDER = [AGENT.TECHNICAL, AGENT.MACRO, AGENT.POSITIONING, AGENT.NEWS, AGENT.RISK];

// Signal strength → CSS direction class
const DIRECTION_CLASS = {
  STRONG_BUY:  'buy',   BUY:  'buy',  WEAK_BUY:  'buy',
  STRONG_SELL: 'sell',  SELL: 'sell', WEAK_SELL: 'sell',
  NEUTRAL:     'neutral', NO_TRADE: 'neutral',
};

// Session → human label
const SESSION_LABELS = {
  en: { london: 'London', newyork: 'New York', asian: 'Asian', overlap: 'London/NY Overlap', off: 'Off Hours' },
  zh: { london: '伦敦', newyork: '纽约', asian: '亚洲', overlap: '伦敦/纽约交叉', off: '非交易时段' },
};

// ─────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────

/**
 * Mounts the HeroPanel into a container element and starts listening
 * for state updates. Call once on page load.
 *
 * @param {HTMLElement} container
 */
export function mount(container) {
  if (!container) return;
  _container = container;

  // Initial render
  render();

  // Subscribe to AppState events
  AppState.subscribe('stateUpdated',    () => render());
  AppState.subscribe('signalGenerated', () => render());

  // Language changes
  window.addEventListener('languagechange', () => render());
}

/**
 * Renders the HeroPanel into the mounted container.
 * Safe to call multiple times — replaces innerHTML.
 */
export function render() {
  if (!_container) return;
  try {
    _container.innerHTML = _buildHTML();
    _attachEvents();
  } catch (err) {
    console.error('[HeroPanel] Render error:', err.message);
  }
}

// ─────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────

let _container = null;

// ─────────────────────────────────────────────
// HTML BUILDERS
// ─────────────────────────────────────────────

function _buildHTML() {
  const signal     = AppState.getLastSignal();
  const votes      = AppState.getLastVotes();
  const price      = AppState.getCurrentPrice();
  const prevClose  = AppState.getPrevClose();
  const dataSource = AppState.getDataSource();
  const lang       = getLang();

  return `
    <div class="hero-panel">
      ${_buildPriceSection(price, prevClose, dataSource, signal, lang)}
      ${_buildSignalSection(signal, lang)}
      ${_buildMiniScores(votes, lang)}
      ${_buildTradePlan(signal, lang)}
      ${_buildBadges(signal, lang)}
      ${_buildSignalMeta(signal, lang)}
    </div>
  `;
}

function _buildPriceSection(price, prevClose, dataSource, signal, lang) {
  const priceStr = price > 0 ? formatPrice(price) : '—.—————';
  const change   = (price > 0 && prevClose > 0)
    ? price - prevClose
    : 0;
  const changePips   = Math.round(change / 0.0001);
  const changePct    = prevClose > 0 ? (change / prevClose * 100) : 0;
  const changeClass  = change >= 0 ? 'positive' : 'negative';
  const changeSign   = change >= 0 ? '+' : '';
  const sourceLabel  = _dataSourceLabel(dataSource, lang);
  const sourceCls    = `data-source-badge data-source-${dataSource}`;

  return `
    <div class="hero-price">
      <div class="price-pair-label">EUR / USD</div>
      <div class="price-value">${priceStr}</div>
      <div class="price-change ${changeClass}">
        ${changeSign}${changePips} ${t('signal.pips')}
        (${changeSign}${changePct.toFixed(3)}%)
      </div>
      <div class="${sourceCls}">${sourceLabel}</div>
    </div>
  `;
}

function _buildSignalSection(signal, lang) {
  const strength  = signal?.signal_strength ?? SIGNAL_STRENGTH.NO_TRADE;
  const conf      = signal?.final_confidence ?? 0;
  const dirClass  = DIRECTION_CLASS[strength] ?? 'neutral';
  const label     = t(`signal.strength.${strength}`);
  const noTrade   = strength === SIGNAL_STRENGTH.NO_TRADE;
  const neutral   = strength === SIGNAL_STRENGTH.NEUTRAL;

  return `
    <div class="signal-section">
      <div class="signal-arrow ${dirClass}" aria-label="${label}">
        ${_arrowSVG(dirClass)}
      </div>
      <div class="signal-label signal-label-${dirClass}">${label}</div>
      ${_buildConfidenceRing(conf, dirClass)}
      ${noTrade ? `<div class="no-trade-banner">${_noTradeReason(signal, lang)}</div>` : ''}
    </div>
  `;
}

function _buildConfidenceRing(conf, dirClass) {
  const pct    = Math.max(0, Math.min(100, conf));
  const offset = RING_CIRCUMFERENCE * (1 - pct / 100);
  const confLabel = t('signal.confidence');

  return `
    <div class="confidence-ring">
      <svg class="ring-svg" viewBox="0 0 120 120" aria-hidden="true">
        <circle class="ring-track"
          cx="60" cy="60" r="${RING_RADIUS}"
          fill="none" stroke-width="8"/>
        <circle class="ring-fill ring-fill-${dirClass}"
          cx="60" cy="60" r="${RING_RADIUS}"
          fill="none" stroke-width="8"
          stroke-dasharray="${RING_CIRCUMFERENCE}"
          stroke-dashoffset="${offset.toFixed(2)}"
          transform="rotate(-90 60 60)"/>
        <text class="ring-value" x="60" y="55" text-anchor="middle">${pct}%</text>
        <text class="ring-label" x="60" y="72" text-anchor="middle">${confLabel}</text>
      </svg>
    </div>
  `;
}

function _buildMiniScores(votes, lang) {
  if (!votes || votes.length === 0) {
    return `<div class="mini-scores mini-scores-empty">—</div>`;
  }

  const bars = AGENT_ORDER.map(agentKey => {
    const vote  = votes.find(v => v.agent === agentKey);
    const meta  = AGENT_META[agentKey];
    const score = vote?.score ?? 50;
    const vDir  = vote?.vote  ?? 'NEUTRAL';
    const name  = lang === 'zh' ? meta.name_zh : meta.name_en;
    const pct   = score;  // 0=fully bull, 100=fully bear, 50=neutral
    const barCls = vDir === 'SELL' ? 'bear' : vDir === 'BUY' ? 'bull' : 'neutral';

    return `
      <div class="mini-score-bar" title="${name}: ${score}">
        <div class="mini-score-label">${meta.icon}</div>
        <div class="mini-score-track">
          <div class="mini-score-fill mini-score-fill-${barCls}"
               style="width:${pct}%"></div>
          <div class="mini-score-midline"></div>
        </div>
        <div class="mini-score-value">${score}</div>
      </div>
    `;
  }).join('');

  return `
    <div class="mini-scores">
      <div class="mini-scores-title">${t('agents.title')}</div>
      ${bars}
    </div>
  `;
}

function _buildTradePlan(signal, lang) {
  if (!signal || !isActionable(signal)) {
    return `<div class="trade-plan trade-plan-empty">
      <span>${t('signal.noTrade')}</span>
    </div>`;
  }

  const dir = signal.direction === SIGNAL_DIRECTION.SELL ? 'sell' : 'buy';

  const rows = [
    [t('signal.entry'),  formatPrice(signal.entry_price)],
    [t('signal.sl'),     `${formatPrice(signal.stop_loss)} (${formatPips(signal.sl_pips)})`],
    [t('signal.tp1'),    `${formatPrice(signal.take_profit_1)} (${formatPips(signal.tp1_pips)})`],
    [t('signal.tp2'),    `${formatPrice(signal.take_profit_2)} (${formatPips(signal.tp2_pips)})`],
    [t('signal.rr'),     `1:${signal.rr_ratio?.toFixed(2) ?? '—'}`],
    [t('risk.lot'),      formatLot(signal.lot_size)],
    [t('risk.maxLoss'),  formatUSD(signal.max_loss_usd)],
  ].map(([label, value]) => `
    <div class="trade-plan-row">
      <span class="plan-label">${label}</span>
      <span class="plan-value">${value}</span>
    </div>
  `).join('');

  return `
    <div class="trade-plan trade-plan-${dir}">
      ${rows}
    </div>
  `;
}

function _buildBadges(signal, lang) {
  const regime  = signal?.market_regime ?? AppState.getLastRegime() ?? 'ranging';
  const session = signal?.session ?? 'off';
  const regimeLabel  = t(`regime.${regime}`);
  const sessionLabel = (SESSION_LABELS[lang] ?? SESSION_LABELS.en)[session] ?? session;

  return `
    <div class="hero-badges">
      <span class="regime-badge regime-${regime}">${regimeLabel}</span>
      <span class="session-badge">${sessionLabel}</span>
    </div>
  `;
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function _arrowSVG(dir) {
  if (dir === 'buy') {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
      <polyline points="18 15 12 9 6 15"/>
    </svg>`;
  }
  if (dir === 'sell') {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
      <polyline points="6 9 12 15 18 9"/>
    </svg>`;
  }
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
    <line x1="5" y1="12" x2="19" y2="12"/>
  </svg>`;
}

function _noTradeReason(signal, lang) {
  const reasonMap = {
    en: {
      MTF_NOT_ALIGNED:          'Timeframes not aligned',
      LOW_CONFIDENCE:           'Signal confidence too low',
      RR_TOO_LOW:               'Risk/reward below minimum',
      AGENT_DISAGREEMENT:       'Agents disagree — no consensus',
      DRAWDOWN_HALT:            'System halted — drawdown limit',
      CONSECUTIVE_LOSS_LIMIT:   'Consecutive loss limit reached',
      VOLATILE_REGIME_BLOCKED:  'Volatile regime — trading suspended',
      SYSTEM_ERROR:             'Pipeline error',
    },
    zh: {
      MTF_NOT_ALIGNED:          '多周期未对齐',
      LOW_CONFIDENCE:           '信号置信度过低',
      RR_TOO_LOW:               '盈亏比低于最低标准',
      AGENT_DISAGREEMENT:       '代理分歧 — 无共识',
      DRAWDOWN_HALT:            '系统已暂停 — 已达回撤限制',
      CONSECUTIVE_LOSS_LIMIT:   '已达连续亏损上限',
      VOLATILE_REGIME_BLOCKED:  '高度波动 — 交易暂停',
      SYSTEM_ERROR:             '流程错误',
    },
  };
  const map = reasonMap[lang] ?? reasonMap.en;
  return map[signal?.no_trade_reason] ?? t('signal.noTrade');
}

function _dataSourceLabel(source, lang) {
  const map = {
    en: { live: '● LIVE', cached: '○ CACHED', simulated: '◌ SIMULATED' },
    zh: { live: '● 实时',  cached: '○ 缓存',   simulated: '◌ 模拟'      },
  };
  return (map[lang] ?? map.en)[source] ?? source;
}

function _attachEvents() {
  // No internal DOM events needed on this panel — all updates come from AppState
}

// ── Signal meta bar (transparency) ──────────
// Shows: Signal ID · Generated time · Data source · Last refresh
// V4.3 Data Transparency Patch

function _buildSignalMeta(signal, lang) {
  const lastRefresh = AppState.getLastRefresh();
  const dataSource  = AppState.getDataSource();
  const memStatus   = MemoryAggregator.getStatus();

  // Format data source badge
  const srcBadge = dataSource === 'live'
    ? `<span class="meta-badge meta-live">● ${lang === 'zh' ? '实时' : 'LIVE'}</span>`
    : dataSource === 'cached'
      ? `<span class="meta-badge meta-cache">○ ${lang === 'zh' ? '缓存' : 'CACHE'}</span>`
      : `<span class="meta-badge meta-stub">◌ ${lang === 'zh' ? '模拟' : 'SIM'}</span>`;

  // Format memory layer status (worst-case)
  const memSrc = memStatus?.last_aggregated > 0
    ? (memStatus.fred?.status === 'live' || memStatus.dxy?.status === 'live' ? 'live' : 'stub')
    : 'stub';
  const memBadge = memSrc === 'live'
    ? `<span class="meta-badge meta-live">● ${lang === 'zh' ? '宏观实时' : 'MACRO LIVE'}</span>`
    : `<span class="meta-badge meta-stub">◌ ${lang === 'zh' ? '宏观默认' : 'MACRO DEFAULT'}</span>`;

  // Signal info
  const signalId   = signal?.id    ?? null;
  const signalTs   = signal?.timestamp ?? null;
  const shortId    = signalId ? signalId.slice(-8).toUpperCase() : '—';
  const genTime    = signalTs  ? _fmtTime(signalTs,  lang) : '—';
  const refreshTime= lastRefresh ? _fmtTime(lastRefresh, lang) : '—';

  const labels = lang === 'zh'
    ? { id: '信号ID', gen: '生成时间', refresh: '数据刷新', src: '价格源', mem: '宏观源' }
    : { id: 'Signal', gen: 'Generated', refresh: 'Data refresh', src: 'Price', mem: 'Macro' };

  return `
    <div class="hero-meta-bar">
      <div class="meta-row">
        <span class="meta-item">
          <span class="meta-label">${labels.id}</span>
          <span class="meta-value meta-id" title="${signalId ?? ''}">${shortId}</span>
        </span>
        <span class="meta-item">
          <span class="meta-label">${labels.gen}</span>
          <span class="meta-value">${genTime}</span>
        </span>
        <span class="meta-item">
          <span class="meta-label">${labels.refresh}</span>
          <span class="meta-value">${refreshTime}</span>
        </span>
        <span class="meta-item">${srcBadge}</span>
        <span class="meta-item">${memBadge}</span>
      </div>
    </div>
  `;
}

function _fmtTime(tsMs, lang) {
  if (!tsMs) return '—';
  const d    = new Date(tsMs);
  const hhmm = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
  const ageMs  = Date.now() - tsMs;
  const ageSec = Math.floor(ageMs / 1000);
  const ageMin = Math.floor(ageSec / 60);
  if (ageSec < 10)  return lang === 'zh' ? `${hhmm} (刚刚)` : `${hhmm} (just now)`;
  if (ageSec < 60)  return lang === 'zh' ? `${hhmm} (${ageSec}秒前)` : `${hhmm} (${ageSec}s ago)`;
  if (ageMin < 60)  return lang === 'zh' ? `${hhmm} (${ageMin}分前)` : `${hhmm} (${ageMin}m ago)`;
  return hhmm;
}
