/**
 * ONETO EUR/USD AI Tool — DecisionPanel
 * ========================================
 * Decision Engine page component.
 * Renders:
 *   1. Decision pipeline flow diagram (5 steps → final signal)
 *   2. Multi-Timeframe alignment panel (3 bias bars + state)
 *   3. Signal explanation (why this signal — per category)
 *   4. Gate results table (6 pass/fail checks)
 *   5. Final score + confidence display
 *
 * Data sources:
 *   AppState.getLastSignal()  — DecisionResult fields
 *   AppState.getLastVotes()   — per-agent scores for pipeline nodes
 *
 * Events listened:
 *   window 'stateUpdated'    — re-render
 *   window 'signalGenerated' — re-render
 *   window 'languagechange'  — re-render
 *
 * CSS classes required (from styles/decision.css):
 *   .decision-panel, .decision-header,
 *   .pipeline-flow, .pipeline-node, .pipeline-node.active/.inactive,
 *   .pipeline-arrow, .pipeline-final,
 *   .mtf-panel, .mtf-bias-row, .mtf-bias-bar, .mtf-bias-fill,
 *   .mtf-state-badge,
 *   .explanation-list, .explanation-item, .explanation-category,
 *   .gates-table, .gate-row, .gate-pass, .gate-fail,
 *   .score-display, .final-score-ring, .conf-meter
 *
 * Architecture Freeze V4.0-R1 | Phase 4B
 */

'use strict';

import * as AppState from '../state/AppState.js';
import { t, getLang } from '../i18n/i18n.js';
import { AGENT } from '../types/Vote.js';
import { SIGNAL_STRENGTH, SIGNAL_DIRECTION } from '../types/Signal.js';
import * as MemoryAggregator from '../services/MemoryAggregator.js';

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────

const PIPELINE_STEPS = [
  { key: 'data',      icon: '📡', en: 'Market Data',        zh: '市场数据'   },
  { key: 'regime',    icon: '🌐', en: 'Market Regime',      zh: '市场状态'   },
  { key: 'mtf',       icon: '🔭', en: 'MTF Alignment',      zh: '多周期对齐' },
  { key: 'committee', icon: '🧠', en: 'AI Committee',       zh: 'AI委员会'   },
  { key: 'decision',  icon: '⚡', en: 'Decision Engine',    zh: '决策引擎'   },
];

const GATE_KEYS = [
  { field: 'mtf_pass',             i18nKey: 'decision.gates.mtf'          },
  { field: 'confidence_pass',      i18nKey: 'decision.gates.confidence'   },
  { field: 'rr_pass',              i18nKey: 'decision.gates.rr'           },
  { field: 'agent_agreement_pass', i18nKey: 'decision.gates.agentAgreement'},
  { field: 'drawdown_pass',        i18nKey: 'decision.gates.drawdown'     },
  { field: 'regime_pass',          i18nKey: 'decision.gates.regime'       },
];

// ─────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────

let _container = null;

/**
 * @param {HTMLElement} container
 */
export function mount(container) {
  if (!container) return;
  _container = container;
  render();
  AppState.subscribe('stateUpdated',    () => render());
  AppState.subscribe('signalGenerated', () => render());
  window.addEventListener('languagechange', () => render());
}

export function render() {
  if (!_container) return;
  try {
    _container.innerHTML = _buildHTML();
  } catch (err) {
    console.error('[DecisionPanel] Render error:', err.message);
  }
}

// ─────────────────────────────────────────────
// HTML BUILDERS
// ─────────────────────────────────────────────

function _buildHTML() {
  const signal = AppState.getLastSignal();
  const votes  = AppState.getLastVotes();
  const lang   = getLang();

  return `
    <div class="decision-panel">
      <div class="decision-header">
        <h2 class="panel-title">${t('decision.title')}</h2>
      </div>
      ${_buildPipelineFlow(signal, votes, lang)}
      ${_buildMTFPanel(signal, lang)}
      ${_buildGatesTable(signal, lang)}
      ${_buildScoreDisplay(signal, lang)}
      ${_buildExplanation(signal, lang)}
      ${_buildSignalAudit(signal, lang)}
    </div>
  `;
}

// ── Pipeline flow ────────────────────────────

function _buildPipelineFlow(signal, votes, lang) {
  const strength = signal?.signal_strength ?? SIGNAL_STRENGTH.NO_TRADE;
  const noTrade  = strength === SIGNAL_STRENGTH.NO_TRADE;
  const gates    = signal?.gates ?? {};

  // Map each step to active/inactive based on whether it passed
  const stepActive = {
    data:      true,
    regime:    true,
    mtf:       gates.mtf_pass !== false,
    committee: gates.mtf_pass !== false,
    decision:  !noTrade,
  };

  const nodes = PIPELINE_STEPS.map((step, i) => {
    const active = stepActive[step.key];
    const label  = lang === 'zh' ? step.zh : step.en;
    const score  = _stepScore(step.key, signal, votes);

    return `
      <div class="pipeline-node ${active ? 'active' : 'inactive'}">
        <div class="pipeline-node-icon">${step.icon}</div>
        <div class="pipeline-node-label">${label}</div>
        ${score !== null ? `<div class="pipeline-node-score">${score}</div>` : ''}
      </div>
      ${i < PIPELINE_STEPS.length - 1
        ? `<div class="pipeline-arrow ${active ? 'active' : 'inactive'}">→</div>`
        : ''}
    `;
  }).join('');

  const finalCls = _signalClass(strength);
  const finalLabel = t(`signal.strength.${strength}`);

  return `
    <div class="pipeline-section">
      <div class="pipeline-flow">${nodes}</div>
      <div class="pipeline-final pipeline-final-${finalCls}">
        ${finalLabel}
      </div>
    </div>
  `;
}

function _stepScore(stepKey, signal, votes) {
  if (!signal) return null;
  switch (stepKey) {
    case 'committee': {
      const s = signal.final_score ?? 50;
      return `${s}`;
    }
    case 'decision': return `${signal.final_confidence ?? 0}%`;
    default: return null;
  }
}

// ── MTF alignment panel ──────────────────────

function _buildMTFPanel(signal, lang) {
  // MTF data stored on signal — extract what we have
  const mtfState = signal?.mtf_state ?? 'not_aligned';
  const confAdj  = signal?.mtf_confidence_adj ?? 0;

  // Bias values are stored on snapshot; we display what we can from signal
  // Full bias values require snapshot lookup — show state + conf_adj here
  const stateLabel   = t(`mtf.${mtfState}`);
  const stateCls     = mtfState.replace('_', '-');
  const adjSign      = confAdj >= 0 ? '+' : '';
  const adjLabel     = `${adjSign}${confAdj}`;

  const biasBars = [
    { label: t('mtf.bias1d'), key: '1D' },
    { label: t('mtf.bias4h'), key: '4H' },
    { label: t('mtf.bias1h'), key: '1H' },
  ].map(({ label }) => `
    <div class="mtf-bias-row">
      <span class="mtf-bias-label">${label}</span>
      <div class="mtf-bias-track">
        <div class="mtf-bias-midline"></div>
      </div>
    </div>
  `).join('');

  return `
    <div class="mtf-panel">
      <div class="mtf-header">
        <span class="mtf-title">${t('mtf.title')}</span>
        <span class="mtf-state-badge mtf-state-${stateCls}">${stateLabel}</span>
        <span class="mtf-conf-adj" title="${t('mtf.confAdj')}">${adjLabel}</span>
      </div>
      <div class="mtf-bias-list">${biasBars}</div>
    </div>
  `;
}

// ── Gate results table ───────────────────────

function _buildGatesTable(signal, lang) {
  if (!signal) {
    return `<div class="gates-table gates-empty">—</div>`;
  }

  const gates = signal.gates ?? {};

  const rows = GATE_KEYS.map(({ field, i18nKey }) => {
    const passed = gates[field] !== false;
    const cls    = passed ? 'gate-pass' : 'gate-fail';
    const icon   = passed ? '✓' : '✗';
    const label  = passed ? t('decision.passed') : t('decision.failed');

    return `
      <div class="gate-row ${cls}">
        <span class="gate-icon">${icon}</span>
        <span class="gate-name">${t(i18nKey)}</span>
        <span class="gate-result">${label}</span>
      </div>
    `;
  }).join('');

  const allPassed = GATE_KEYS.every(({ field }) => gates[field] !== false);
  const summaryLabel = allPassed
    ? (lang === 'zh' ? '全部通过 ✓' : 'All gates passed ✓')
    : (lang === 'zh' ? '有门控未通过 ✗' : 'Gate(s) failed ✗');
  const summaryCls = allPassed ? 'gates-summary-pass' : 'gates-summary-fail';

  return `
    <div class="gates-section">
      <div class="gates-title">${t('decision.gateResults')}</div>
      <div class="gates-table">${rows}</div>
      <div class="gates-summary ${summaryCls}">${summaryLabel}</div>
    </div>
  `;
}

// ── Final score display ──────────────────────

function _buildScoreDisplay(signal, lang) {
  if (!signal) return '';

  const score = signal.final_score      ?? 50;
  const conf  = signal.final_confidence ?? 0;
  const agree = signal.agents_agreeing  ?? 0;

  // Determine score direction label
  const direction = score > 55 ? t('signal.sell') : score < 45 ? t('signal.buy') : t('signal.neutral');
  const scoreCls  = score > 55 ? 'bear' : score < 45 ? 'bull' : 'neutral';

  return `
    <div class="score-display">
      <div class="score-block">
        <div class="score-number score-number-${scoreCls}">${score}</div>
        <div class="score-direction">${direction}</div>
        <div class="score-sublabel">${t('decision.finalScore')}</div>
      </div>
      <div class="score-block">
        <div class="conf-number">${conf}%</div>
        <div class="conf-sublabel">${t('signal.confidence')}</div>
        <div class="conf-meter-track">
          <div class="conf-meter-fill conf-${_confLevel(conf)}"
               style="width:${conf}%"></div>
        </div>
      </div>
      <div class="score-block">
        <div class="agree-number">${agree}</div>
        <div class="agree-sublabel">${t('agents.agreeing')}</div>
      </div>
    </div>
  `;
}

function _confLevel(conf) {
  if (conf >= 75) return 'high';
  if (conf >= 55) return 'medium';
  return 'low';
}

// ── Signal explanation ───────────────────────

function _buildExplanation(signal, lang) {
  if (!signal || !Array.isArray(signal.explanation) || signal.explanation.length === 0) {
    return '';
  }

  const items = signal.explanation.map(item => {
    const text = lang === 'zh' && item.text_zh ? item.text_zh : item.text_en;
    return `
      <div class="explanation-item" style="border-left-color:${item.color ?? 'var(--text3)'}">
        <span class="explanation-category">${item.category}</span>
        <span class="explanation-text">${text}</span>
      </div>
    `;
  }).join('');

  // No-trade reason override
  if (signal.signal_strength === 'NO_TRADE' && signal.no_trade_reason) {
    return `
      <div class="explanation-section">
        <div class="explanation-title">${t('decision.noTradeReason')}</div>
        <div class="explanation-list">
          <div class="explanation-item explanation-item-notrade">
            <span class="explanation-text">${signal.no_trade_reason}</span>
          </div>
        </div>
      </div>
    `;
  }

  return `
    <div class="explanation-section">
      <div class="explanation-title">${t('decision.explanation')}</div>
      <div class="explanation-list">${items}</div>
    </div>
  `;
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function _signalClass(strength) {
  const s = strength ?? '';
  if (s.includes('BUY'))  return 'buy';
  if (s.includes('SELL')) return 'sell';
  if (s === 'NO_TRADE')   return 'notrade';
  return 'neutral';
}

// ── Signal audit panel (transparency) ──────────────────
// Full signal provenance: ID, timestamp, data sources, memory layer.
// V4.3 Data Transparency Patch

function _buildSignalAudit(signal, lang) {
  const memStatus  = MemoryAggregator.getStatus();
  const lastRefresh = AppState.getLastRefresh();

  if (!signal) {
    return `<div style="margin-top:var(--gap-lg);padding:var(--gap-md);
                        background:var(--bg2);border:1px solid var(--border);
                        border-radius:var(--radius-md);font-size:0.8rem;color:var(--text4)">
              ${lang === 'zh' ? '等待信号生成...' : 'Awaiting signal generation...'}
            </div>`;
  }

  const _ts = (ms) => {
    if (!ms) return '—';
    const d = new Date(ms);
    const date = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const time = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
    return `${date} ${time}`;
  };

  const _age = (ms) => {
    if (!ms) return '';
    const s = Math.floor((Date.now() - ms) / 1000);
    if (s < 60)  return lang === 'zh' ? `(${s}秒前)` : `(${s}s ago)`;
    const m = Math.floor(s / 60);
    if (m < 60)  return lang === 'zh' ? `(${m}分前)` : `(${m}m ago)`;
    return lang === 'zh' ? `(${Math.floor(m/60)}小时前)` : `(${Math.floor(m/60)}h ago)`;
  };

  const srcBadge = (src, small = false) => {
    const label = src === 'live'   ? 'LIVE'
                : src === 'cached' ? 'CACHE'
                : src === 'stale'  ? 'STALE'
                : src === 'stub'   ? 'STUB' : '—';
    const color = src === 'live'   ? 'var(--green)'
                : src === 'cached' ? 'var(--amber-dim)'
                : src === 'stale'  ? '#f97316'
                : 'var(--text4)';
    const bg    = src === 'live'   ? 'var(--green-bg)'
                : src === 'cached' ? 'var(--amber-bg)'
                : 'var(--bg3)';
    const sz    = small ? '0.60rem' : '0.65rem';
    return `<span style="font-size:${sz};font-weight:700;padding:1px 6px;border-radius:999px;
                         background:${bg};color:${color};border:1px solid currentColor">${label}</span>`;
  };

  // Full signal ID and shorthand
  const signalId  = signal.id ?? '—';
  const shortId   = signalId !== '—' ? signalId.slice(-12).toUpperCase() : '—';
  const signalTs  = signal.timestamp ?? null;
  const dataSource = AppState.getDataSource();
  const timeframe  = signal.timeframe ?? '4H';
  const regime     = signal.market_regime ?? '—';
  const mtfState   = signal.mtf_state ?? '—';
  const memAgg     = memStatus?.last_aggregated ?? 0;

  const infoRows = [
    { k: lang === 'zh' ? '完整信号ID' : 'Full Signal ID',
      v: `<span style="font-family:var(--font-mono);font-size:0.72rem;
                       word-break:break-all;color:var(--text2)">${signalId}</span>` },
    { k: lang === 'zh' ? '信号生成时间' : 'Signal generated',
      v: `<span style="font-family:var(--font-num)">${_ts(signalTs)} ${_age(signalTs)}</span>` },
    { k: lang === 'zh' ? '数据刷新时间' : 'Data refreshed',
      v: `<span style="font-family:var(--font-num)">${_ts(lastRefresh)} ${_age(lastRefresh)}</span>` },
    { k: lang === 'zh' ? '宏观层刷新' : 'Memory layer refresh',
      v: `<span style="font-family:var(--font-num)">${memAgg ? _ts(memAgg) + ' ' + _age(memAgg) : '—'}</span>` },
    { k: lang === 'zh' ? '价格数据源' : 'Price data source',
      v: srcBadge(dataSource) },
    { k: lang === 'zh' ? '分析时间框' : 'Analysis timeframe',
      v: `<span style="font-family:var(--font-num)">${timeframe}</span>` },
    { k: lang === 'zh' ? '市场状态' : 'Market regime',
      v: `<span style="font-family:var(--font-num)">${regime}</span>` },
    { k: lang === 'zh' ? 'MTF状态' : 'MTF state',
      v: `<span style="font-family:var(--font-num)">${mtfState}</span>` },
  ];

  const serviceRows = [
    { label: lang === 'zh' ? '技术面（K线）' : 'Technical (candles)',
      src: dataSource },
    { label: lang === 'zh' ? '宏观 (FRED)'   : 'Macro (FRED)',
      src: memStatus?.fred?.status ?? 'stub',
      detail: memStatus?.fred?.spread != null ? `Spread ${memStatus.fred.spread.toFixed(2)}%` : null },
    { label: lang === 'zh' ? 'DXY 指数 (TD)' : 'DXY index (TD)',
      src: memStatus?.dxy?.status ?? 'stub',
      detail: memStatus?.dxy?.price ? `${memStatus.dxy.price.toFixed(3)} ${memStatus.dxy.trend ?? ''}` : null },
    { label: lang === 'zh' ? '新闻情绪'      : 'News sentiment',
      src: memStatus?.news?.status ?? 'stub',
      detail: memStatus?.news?.score_24h != null ? `Net24h: ${memStatus.news.score_24h > 0 ? '+' : ''}${memStatus.news.score_24h}` : null },
    { label: lang === 'zh' ? '经济日历'      : 'Economic calendar',
      src: memStatus?.calendar?.status ?? 'stub',
      detail: memStatus?.calendar?.event_risk ? (lang === 'zh' ? '⚠ 有高影响事件' : '⚠ High impact event') : null },
    { label: 'COT positioning',
      src: memStatus?.cot?.status ?? 'stub',
      detail: memStatus?.cot?.z_score != null ? `z=${memStatus.cot.z_score.toFixed(2)} (${memStatus.cot.signal ?? '—'})` : null },
  ].map(s => `
    <tr style="border-bottom:1px solid var(--border)">
      <td style="padding:4px var(--gap-sm);font-size:0.75rem;color:var(--text3);
                 white-space:nowrap">${s.label}</td>
      <td style="padding:4px var(--gap-sm)">${srcBadge(s.src, true)}</td>
      <td style="padding:4px var(--gap-sm);font-size:0.72rem;
                 font-family:var(--font-num);color:var(--text2)">${s.detail ?? ''}</td>
    </tr>`).join('');

  const infoHtml = infoRows.map(r => `
    <div style="display:flex;align-items:baseline;gap:var(--gap-md);
                padding:4px 0;border-bottom:1px solid var(--border);font-size:0.78rem">
      <span style="min-width:140px;color:var(--text3);flex-shrink:0">${r.k}</span>
      <span style="color:var(--text1)">${r.v}</span>
    </div>`).join('');

  const title = lang === 'zh' ? '信号溯源 · 数据可审计性' : 'Signal Provenance · Data Auditability';

  return `
    <div style="margin-top:var(--gap-xl);background:var(--bg2);
                border:1px solid var(--border);border-radius:var(--radius-md);padding:var(--gap-lg)">

      <div style="font-size:0.65rem;font-weight:700;text-transform:uppercase;
                  letter-spacing:0.10em;color:var(--text4);margin-bottom:var(--gap-md)">
        ${title}
      </div>

      <!-- Signal metadata -->
      <div style="margin-bottom:var(--gap-md)">${infoHtml}</div>

      <!-- Per-service data sources -->
      <div style="font-size:0.65rem;font-weight:700;text-transform:uppercase;
                  letter-spacing:0.08em;color:var(--text4);
                  margin-bottom:var(--gap-xs);margin-top:var(--gap-md)">
        ${lang === 'zh' ? '各模块数据来源' : 'Per-Module Data Sources'}
      </div>
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="border-bottom:1px solid var(--border2)">
            <th style="text-align:left;font-size:0.65rem;font-weight:600;color:var(--text4);
                       padding:3px var(--gap-sm);text-transform:uppercase;
                       letter-spacing:0.06em">${lang === 'zh' ? '模块' : 'Module'}</th>
            <th style="text-align:left;font-size:0.65rem;font-weight:600;color:var(--text4);
                       padding:3px var(--gap-sm);text-transform:uppercase;
                       letter-spacing:0.06em">${lang === 'zh' ? '状态' : 'Status'}</th>
            <th style="text-align:left;font-size:0.65rem;font-weight:600;color:var(--text4);
                       padding:3px var(--gap-sm);text-transform:uppercase;
                       letter-spacing:0.06em">${lang === 'zh' ? '数值' : 'Value'}</th>
          </tr>
        </thead>
        <tbody>${serviceRows}</tbody>
      </table>
    </div>
  `;
}
