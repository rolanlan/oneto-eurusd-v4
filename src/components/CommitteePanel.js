/**
 * ONETO EUR/USD AI Tool — CommitteePanel
 * ========================================
 * AI Committee page component.
 * Renders 5 agent cards with individual scores, vote badges,
 * weight bars, reasons, and the weighted committee verdict.
 *
 * Data sources:
 *   AppState.getLastVotes()    — array of 5 Vote objects
 *   AppState.getLastVerdict()  — CommitteeVerdict
 *   AppState.getLastSignal()   — for agents_agreeing count
 *
 * Events listened:
 *   window 'stateUpdated'    — re-render
 *   window 'signalGenerated' — re-render
 *   window 'languagechange'  — re-render
 *
 * CSS classes required (from styles/committee.css):
 *   .committee-panel, .committee-header, .verdict-bar,
 *   .verdict-direction, .verdict-confidence,
 *   .agents-grid, .agent-card, .agent-card.sell, .agent-card.buy, .agent-card.neutral,
 *   .agent-header, .agent-icon, .agent-name, .agent-role,
 *   .agent-score-ring, .agent-vote-badge, .agent-vote-badge.buy/.sell/.neutral,
 *   .agent-weight-bar, .agent-weight-fill, .agent-weight-label,
 *   .agent-reasons, .agent-reason-1, .agent-reason-2,
 *   .agent-confidence, .breakdown-grid, .breakdown-cell,
 *   .weight-summary
 *
 * Architecture Freeze V4.0-R1 | Phase 4B
 */

'use strict';

import * as AppState from '../state/AppState.js';
import { t, getLang } from '../i18n/i18n.js';
import { AGENT, AGENT_META } from '../types/Vote.js';
import { SIGNAL_STRENGTH } from '../types/Signal.js';
import * as MemoryAggregator from '../services/MemoryAggregator.js';

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────

const AGENT_ORDER = [AGENT.TECHNICAL, AGENT.MACRO, AGENT.POSITIONING, AGENT.NEWS, AGENT.RISK];

// Vote direction → CSS class and emoji
const VOTE_META = {
  SELL:    { cls: 'sell',    icon: '▼', color: 'var(--red,   #f87171)' },
  BUY:     { cls: 'buy',     icon: '▲', color: 'var(--green, #4ade80)' },
  NEUTRAL: { cls: 'neutral', icon: '—', color: 'var(--text3, #6b7280)' },
};

// ─────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────

let _container = null;

/**
 * Mounts the CommitteePanel and attaches event listeners.
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

/** Re-renders the panel into the mounted container. */
export function render() {
  if (!_container) return;
  try {
    _container.innerHTML = _buildHTML();
  } catch (err) {
    console.error('[CommitteePanel] Render error:', err.message);
  }
}

// ─────────────────────────────────────────────
// HTML BUILDERS
// ─────────────────────────────────────────────

function _buildHTML() {
  const votes   = AppState.getLastVotes();
  const verdict = AppState.getLastVerdict();
  const signal  = AppState.getLastSignal();
  const lang    = getLang();

  return `
    <div class="committee-panel">
      <div class="committee-header">
        <h2 class="panel-title">${t('agents.title')}</h2>
        ${_buildVerdictBar(verdict, signal, lang)}
      </div>
      <div class="agents-grid">
        ${AGENT_ORDER.map(a => _buildAgentCard(votes, a, lang)).join('')}
      </div>
      ${_buildWeightSummary(votes, lang)}
      ${_buildBreakdown(verdict, signal, lang)}
      ${_buildCommitteeMeta(signal, lang)}
    </div>
  `;
}

// ── Verdict bar at top ──────────────────────

function _buildVerdictBar(verdict, signal, lang) {
  if (!verdict) {
    return `<div class="verdict-bar verdict-neutral">
      <span class="verdict-direction">—</span>
    </div>`;
  }

  const dir     = verdict.direction ?? 'NEUTRAL';
  const conf    = verdict.confidence ?? 0;
  const dirCls  = dir === 'SELL' ? 'sell' : dir === 'BUY' ? 'buy' : 'neutral';
  const dirLabel = t(`signal.${dir.toLowerCase()}`);
  const agreeing = signal?.agents_agreeing ?? 0;
  const agreeLabel = lang === 'zh'
    ? `${agreeing} ${t('agents.agreeing')}`
    : `${agreeing} ${t('agents.agreeing')}`;

  // Sell/buy weight bar widths
  const sellPct = Math.round((verdict.sell_weight ?? 0) * 100);
  const buyPct  = Math.round((verdict.buy_weight  ?? 0) * 100);

  return `
    <div class="verdict-bar verdict-${dirCls}">
      <div class="verdict-direction">${dirLabel}</div>
      <div class="verdict-confidence">${conf}% · ${agreeLabel}</div>
      <div class="verdict-weight-track">
        <div class="verdict-weight-sell" style="width:${sellPct}%"></div>
        <div class="verdict-weight-buy"  style="width:${buyPct}%"></div>
      </div>
      <div class="verdict-weight-labels">
        <span class="sell-label">${t('signal.sell')} ${sellPct}%</span>
        <span class="buy-label">${buyPct}% ${t('signal.buy')}</span>
      </div>
    </div>
  `;
}

// ── Agent card ───────────────────────────────

function _buildAgentCard(votes, agentKey, lang) {
  const vote = votes.find(v => v.agent === agentKey);
  const meta = AGENT_META[agentKey];

  if (!vote) {
    return `
      <div class="agent-card agent-card-neutral">
        <div class="agent-header">
          <span class="agent-icon">${meta.icon}</span>
          <div class="agent-name-group">
            <span class="agent-name">${lang === 'zh' ? meta.name_zh : meta.name_en}</span>
            <span class="agent-role">${lang === 'zh' ? meta.role_zh : meta.role_en}</span>
          </div>
        </div>
        <div class="agent-no-data">—</div>
      </div>
    `;
  }

  const voteMeta  = VOTE_META[vote.vote] ?? VOTE_META.NEUTRAL;
  const score     = vote.score    ?? 50;
  const conf      = vote.confidence ?? 0;
  const weightPct = Math.round((vote.weight ?? 0) * 100);

  return `
    <div class="agent-card agent-card-${voteMeta.cls}" style="border-color:${meta.color}20">
      <div class="agent-header">
        <span class="agent-icon">${meta.icon}</span>
        <div class="agent-name-group">
          <span class="agent-name">${lang === 'zh' ? meta.name_zh : meta.name_en}</span>
          <span class="agent-role">${lang === 'zh' ? meta.role_zh : meta.role_en}</span>
        </div>
        <span class="agent-vote-badge agent-vote-${voteMeta.cls}">
          ${voteMeta.icon} ${vote.vote}
        </span>
      </div>

      ${_buildScoreRow(score, conf, weightPct, meta.color, lang)}

      <div class="agent-weight-bar">
        <div class="agent-weight-fill"
             style="width:${weightPct}%; background:${meta.color}"></div>
        <span class="agent-weight-label">${weightPct}% ${t('agents.weight')}</span>
      </div>

      <div class="agent-reasons">
        ${vote.reason_1 ? `<p class="agent-reason-1">${vote.reason_1}</p>` : ''}
        ${vote.reason_2 ? `<p class="agent-reason-2">${vote.reason_2}</p>` : ''}
      </div>
    </div>
  `;
}

function _buildScoreRow(score, confidence, weightPct, color, lang) {
  // Score bar: 0=fully bullish (left), 50=neutral (mid), 100=fully bearish (right)
  const bearPct  = score;    // higher score = more bearish
  const confLabel = t('agents.confidence');
  const scoreLabel = t('agents.score');

  return `
    <div class="agent-score-row">
      <div class="agent-score-display">
        <span class="score-number" style="color:${color}">${score}</span>
        <span class="score-label">${scoreLabel}</span>
      </div>
      <div class="score-bar-track">
        <div class="score-bar-fill"
             style="width:${bearPct}%; background:${color}66"></div>
        <div class="score-bar-midline"></div>
      </div>
      <div class="agent-conf-display">
        <span class="conf-number">${confidence}%</span>
        <span class="conf-label">${confLabel}</span>
      </div>
    </div>
  `;
}

// ── Weight summary ───────────────────────────

function _buildWeightSummary(votes, lang) {
  if (!votes || votes.length === 0) return '';

  const rows = AGENT_ORDER.map(agentKey => {
    const vote = votes.find(v => v.agent === agentKey);
    const meta = AGENT_META[agentKey];
    const w    = Math.round((vote?.weight ?? 0) * 100);
    const s    = vote?.score ?? 50;
    const vDir = vote?.vote  ?? 'NEUTRAL';
    return `
      <div class="weight-summary-row">
        <span class="ws-icon">${meta.icon}</span>
        <span class="ws-name">${lang === 'zh' ? meta.name_zh : meta.name_en}</span>
        <span class="ws-weight">${w}%</span>
        <span class="ws-contrib">${Math.round(s * (vote?.weight ?? 0))}</span>
        <span class="ws-vote ws-vote-${(VOTE_META[vDir] ?? VOTE_META.NEUTRAL).cls}">
          ${vDir}
        </span>
      </div>
    `;
  }).join('');

  return `
    <div class="weight-summary">
      <div class="weight-summary-header">
        <span>${lang === 'zh' ? '代理' : 'Agent'}</span>
        <span>${t('agents.weight')}</span>
        <span>${lang === 'zh' ? '贡献' : 'Contrib'}</span>
        <span>${lang === 'zh' ? '投票' : 'Vote'}</span>
      </div>
      ${rows}
    </div>
  `;
}

// ── Breakdown totals ─────────────────────────

function _buildBreakdown(verdict, signal, lang) {
  if (!verdict) return '';

  const sells = Math.round((verdict.sell_weight    ?? 0) * 100);
  const buys  = Math.round((verdict.buy_weight     ?? 0) * 100);
  const neuts = Math.round((verdict.neutral_weight ?? 0) * 100);
  const conf  = verdict.confidence ?? 0;
  const agree = signal?.agents_agreeing ?? 0;

  return `
    <div class="breakdown-grid">
      <div class="breakdown-cell">
        <span class="bc-value bc-sell">${sells}%</span>
        <span class="bc-label">${t('signal.sell')}</span>
      </div>
      <div class="breakdown-cell">
        <span class="bc-value bc-buy">${buys}%</span>
        <span class="bc-label">${t('signal.buy')}</span>
      </div>
      <div class="breakdown-cell">
        <span class="bc-value">${neuts}%</span>
        <span class="bc-label">${t('signal.neutral')}</span>
      </div>
      <div class="breakdown-cell">
        <span class="bc-value">${conf}%</span>
        <span class="bc-label">${t('signal.confidence')}</span>
      </div>
      <div class="breakdown-cell">
        <span class="bc-value">${agree}</span>
        <span class="bc-label">${t('agents.agreeing')}</span>
      </div>
    </div>
  `;
}

// ── Committee meta footer (transparency) ──────────────
// Shows per-agent data source, signal timestamp, memory layer status.
// V4.3 Data Transparency Patch

function _buildCommitteeMeta(signal, lang) {
  const memStatus  = MemoryAggregator.getStatus();
  const signalTs   = signal?.timestamp ?? null;
  const signalId   = signal?.id ?? null;
  const regime     = signal?.market_regime ?? AppState.getLastRegime() ?? '—';

  const _ts = (ms) => {
    if (!ms) return '—';
    const d = new Date(ms);
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
  };

  const srcBadge = (src) => {
    const label = src === 'live'   ? (lang === 'zh' ? '实时' : 'LIVE')
                : src === 'cached' ? (lang === 'zh' ? '缓存' : 'CACHE')
                : src === 'stale'  ? (lang === 'zh' ? '过期' : 'STALE')
                : src === 'stub'   ? (lang === 'zh' ? '默认' : 'STUB')
                :                    (lang === 'zh' ? '未知' : '—');
    const color = src === 'live'   ? 'var(--green)'
                : src === 'cached' ? 'var(--amber-dim)'
                : src === 'stale'  ? '#f97316'
                : 'var(--text4)';
    const bg    = src === 'live'   ? 'var(--green-bg)'
                : src === 'cached' ? 'var(--amber-bg)'
                : 'var(--bg3)';
    return `<span style="display:inline-block;font-size:0.62rem;font-weight:700;
                         padding:1px 6px;border-radius:999px;
                         background:${bg};color:${color};border:1px solid currentColor">
              ${label}
            </span>`;
  };

  const services = [
    { label: lang === 'zh' ? '技术面（K线）' : 'Tech (candles)',
      src: AppState.getDataSource() },
    { label: lang === 'zh' ? '宏观 (FRED)'   : 'Macro (FRED)',
      src: memStatus?.fred?.status     ?? 'stub' },
    { label: lang === 'zh' ? 'DXY 指数'      : 'DXY (TD)',
      src: memStatus?.dxy?.status      ?? 'stub',
      detail: memStatus?.dxy?.price    ? memStatus.dxy.price.toFixed(3) + ' ' + (memStatus.dxy.trend ?? '') : null },
    { label: lang === 'zh' ? '新闻情绪'      : 'News',
      src: memStatus?.news?.status     ?? 'stub' },
    { label: lang === 'zh' ? '经济日历'      : 'Calendar',
      src: memStatus?.calendar?.status ?? 'stub' },
    { label: 'COT',
      src: memStatus?.cot?.status      ?? 'stub' },
  ];

  const serviceRows = services.map(s => `
    <div style="display:flex;align-items:center;gap:var(--gap-sm);padding:3px 0;
                border-bottom:1px solid var(--border);font-size:0.75rem">
      <span style="min-width:110px;color:var(--text3)">${s.label}</span>
      ${srcBadge(s.src)}
      ${s.detail ? `<span style="font-family:var(--font-num);font-size:0.72rem;color:var(--text2)">${s.detail}</span>` : ''}
    </div>`).join('');

  const lastAgg = memStatus?.last_aggregated
    ? _ts(memStatus.last_aggregated)
    : '—';

  const shortId = signalId ? signalId.slice(-8).toUpperCase() : '—';

  const labels = lang === 'zh'
    ? { title: '数据来源审计', id: '信号ID', gen: '生成', regime: '市场状态', mem: '宏观刷新' }
    : { title: 'Data Source Audit', id: 'Signal', gen: 'Generated', regime: 'Regime', mem: 'Macro refresh' };

  return `
    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius-md);
                padding:var(--gap-md);margin-top:var(--gap-lg)">
      <div style="font-size:0.65rem;font-weight:700;text-transform:uppercase;letter-spacing:0.10em;
                  color:var(--text4);margin-bottom:var(--gap-sm)">${labels.title}</div>
      <div style="display:flex;gap:var(--gap-xl);margin-bottom:var(--gap-sm);flex-wrap:wrap">
        <div style="font-size:0.75rem">
          <span style="color:var(--text3)">${labels.id}: </span>
          <span style="font-family:var(--font-num);color:var(--text2)" title="${signalId ?? ''}">${shortId}</span>
        </div>
        <div style="font-size:0.75rem">
          <span style="color:var(--text3)">${labels.gen}: </span>
          <span style="font-family:var(--font-num);color:var(--text2)">${_ts(signalTs)}</span>
        </div>
        <div style="font-size:0.75rem">
          <span style="color:var(--text3)">${labels.regime}: </span>
          <span style="font-family:var(--font-num);color:var(--text2)">${regime}</span>
        </div>
        <div style="font-size:0.75rem">
          <span style="color:var(--text3)">${labels.mem}: </span>
          <span style="font-family:var(--font-num);color:var(--text2)">${lastAgg}</span>
        </div>
      </div>
      ${serviceRows}
    </div>
  `;
}
