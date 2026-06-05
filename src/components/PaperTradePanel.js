/**
 * ONETO EUR/USD AI Tool — PaperTradePanel
 * ==========================================
 * Paper trading UI component.
 * Wired to PaperExecution.js (the engine) for all trade logic.
 * This component is UI only — no trade math, no localStorage access.
 *
 * Sections:
 *   1. Submit form   — pre-filled from last signal, manual override
 *   2. Validation progress — 4-phase gate (100/300/500/1000)
 *   3. Performance stats — win rate, profit factor, P&L, avg R
 *   4. Open trades   — list with close buttons
 *   5. Trade history — closed trades with outcome badges
 *
 * Data sources:
 *   AppState.getLastSignal()    — pre-fill direction/prices/lot
 *   PaperExecution.getAll()     — trade list
 *   PaperExecution.getStats()   — performance metrics
 *   PaperExecution.submitTrade()
 *   PaperExecution.closeTrade()
 *
 * Events listened:
 *   window 'stateUpdated'      — re-render (price update)
 *   window 'signalGenerated'   — pre-fill form from new signal
 *   window 'paperTradeOpened'  — re-render
 *   window 'paperTradeClosed'  — re-render
 *   window 'languagechange'    — re-render
 *
 * CSS classes (from styles/paper-trade.css):
 *   .paper-panel, .paper-submit-form, .paper-dir-btn, .paper-dir-btn.active
 *   .paper-input-row, .paper-validation, .phase-progress-bar,
 *   .paper-stats-grid, .paper-trades-list, .trade-row,
 *   .trade-outcome.win / .loss / .open, .close-trade-btn
 *
 * BUG-05 fix: Removed local `function formatLot` (line 431 in prior version)
 * which shadowed the imported `formatLot` from i18n.js, causing
 * "Identifier 'formatLot' has already been declared" SyntaxError in strict mode.
 * The imported version from i18n.js is behaviourally identical and is used directly.
 *
 * Architecture Freeze V4.0-R1 | Phase 5B-Hotfix
 */

'use strict';

import * as AppState       from '../state/AppState.js';
import * as PaperExecution from '../core/PaperExecution.js';
import {
  t,
  getLang,
  formatPrice,
  formatPips,
  formatPct,
  formatLot,
  formatUSD,
  formatDate,
  formatDuration,
} from '../i18n/i18n.js';
import { isActionable, SIGNAL_DIRECTION } from '../types/Signal.js';

// ─────────────────────────────────────────────
// FORM STATE (survives re-renders)
// ─────────────────────────────────────────────

let _container = null;
let _form = {
  direction:   'BUY',
  entry_price: 0,
  stop_loss:   0,
  tp1:         0,
  tp2:         0,
  lot_size:    0.01,
};

// ─────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────

/**
 * @param {HTMLElement} container
 */
export function mount(container) {
  if (!container) return;
  _container = container;

  _syncFromSignal();
  render();

  AppState.subscribe('signalGenerated', () => { _syncFromSignal(); render(); });
  AppState.subscribe('stateUpdated',    () => render());
  window.addEventListener('paperTradeOpened', () => render());
  window.addEventListener('paperTradeClosed', () => render());
  window.addEventListener('languagechange',   () => render());
}

export function render() {
  if (!_container) return;
  try {
    _container.innerHTML = _buildHTML();
    _attachEvents();
  } catch (err) {
    console.error('[PaperTradePanel] Render error:', err.message);
  }
}

// ─────────────────────────────────────────────
// HTML
// ─────────────────────────────────────────────

function _buildHTML() {
  const stats = PaperExecution.getStats();
  const lang  = getLang();

  return `
    <div class="paper-panel">
      <div class="paper-header">
        <h2 class="panel-title">${t('paper.title')}</h2>
      </div>
      ${_buildValidationProgress(stats, lang)}
      ${_buildStats(stats, lang)}
      ${_buildSubmitForm(lang)}
      ${_buildOpenTrades(lang)}
      ${_buildTradeHistory(lang)}
    </div>
  `;
}

// ── Validation progress bar ──────────────────

function _buildValidationProgress(stats, lang) {
  const gates  = [100, 300, 500, 1000];
  const closed = stats.closed;

  const bars = gates.map((gate, idx) => {
    const prev = gates[idx - 1] ?? 0;
    const done = closed >= gate;
    const curr = !done && closed >= prev;
    const pct  = curr
      ? Math.round(((closed - prev) / (gate - prev)) * 100)
      : done ? 100 : 0;
    const cls  = done ? 'phase-done' : curr ? 'phase-active' : 'phase-pending';

    return `
      <div class="phase-block ${cls}">
        <div class="phase-label">${t('paper.phase')} ${idx + 1}</div>
        <div class="phase-progress-bar">
          <div class="phase-progress-fill" style="width:${pct}%"></div>
        </div>
        <div class="phase-count">${done ? gate : curr ? `${closed}/${gate}` : `0/${gate}`} ${t('paper.trades')}</div>
      </div>
    `;
  }).join('');

  const eligible = stats.go_live_eligible;
  return `
    <div class="paper-validation">
      <div class="validation-title">${t('paper.validation')}</div>
      <div class="validation-phases">${bars}</div>
      ${eligible
        ? `<div class="go-live-badge">${t('paper.goLive')} ✓</div>`
        : `<div class="not-eligible-badge">${t('paper.notEligible')}</div>`}
    </div>
  `;
}

// ── Performance stats ────────────────────────

function _buildStats(stats, lang) {
  if (stats.closed === 0) {
    return `<div class="paper-stats-empty">${lang === 'zh' ? '暂无交易记录' : 'No trades yet'}</div>`;
  }

  const winRateColor = stats.win_rate >= 0.6 ? 'var(--green,#4ade80)'
    : stats.win_rate >= 0.5 ? 'var(--amber,#fbbf24)' : 'var(--red,#f87171)';

  const pfColor = stats.profit_factor >= 1.5 ? 'var(--green,#4ade80)'
    : stats.profit_factor >= 1.0 ? 'var(--amber,#fbbf24)' : 'var(--red,#f87171)';

  const cells = [
    [t('paper.winRate'),      `${(stats.win_rate * 100).toFixed(1)}%`,                 winRateColor],
    [t('paper.profitFactor'), stats.profit_factor.toFixed(2),                          pfColor],
    [t('paper.totalPnlR'),    `${stats.total_pnl_r > 0 ? '+' : ''}${stats.total_pnl_r.toFixed(2)}R`,
      stats.total_pnl_r >= 0 ? 'var(--green,#4ade80)' : 'var(--red,#f87171)'],
    [t('paper.totalPnl'),     formatUSD(stats.total_pnl_usd),
      stats.total_pnl_usd >= 0 ? 'var(--green,#4ade80)' : 'var(--red,#f87171)'],
    [t('paper.avgWin'),       `+${stats.avg_win_r.toFixed(2)}R`,                       'var(--green,#4ade80)'],
    [t('paper.avgLoss'),      `${stats.avg_loss_r.toFixed(2)}R`,                       'var(--red,#f87171)'],
    [t('paper.maxConsecLoss'),stats.max_consec_loss.toString(),
      stats.max_consec_loss >= 4 ? 'var(--red,#f87171)' : 'var(--text1,#f9fafb)'],
    [lang === 'zh' ? '总交易' : 'Total', `${stats.closed}/${stats.total}`,             'var(--text2,#9ca3af)'],
  ].map(([label, value, color]) => `
    <div class="paper-stat-cell">
      <span class="stat-label">${label}</span>
      <span class="stat-value" style="color:${color}">${value}</span>
    </div>
  `).join('');

  return `<div class="paper-stats-grid">${cells}</div>`;
}

// ── Submit form ──────────────────────────────

function _buildSubmitForm(lang) {
  const isBuy     = _form.direction === 'BUY';
  const signal    = AppState.getLastSignal();
  const hasSignal = signal && isActionable(signal);

  return `
    <div class="paper-submit-form">
      <div class="form-title">${t('paper.submit')}</div>

      <div class="paper-dir-row">
        <button class="paper-dir-btn ${isBuy ? 'active buy-btn' : ''}" data-dir="BUY">
          ▲ ${t('signal.buy')}
        </button>
        <button class="paper-dir-btn ${!isBuy ? 'active sell-btn' : ''}" data-dir="SELL">
          ▼ ${t('signal.sell')}
        </button>
      </div>

      <div class="paper-input-grid">
        ${_formInput('pt-entry', t('signal.entry'), _form.entry_price, 0.00001)}
        ${_formInput('pt-sl',    t('signal.sl'),    _form.stop_loss,   0.00001)}
        ${_formInput('pt-tp1',   t('signal.tp1'),   _form.tp1,         0.00001)}
        ${_formInput('pt-tp2',   t('signal.tp2'),   _form.tp2,         0.00001)}
        ${_formInput('pt-lot',   t('risk.lot'),     _form.lot_size,    0.01, 'lot')}
      </div>

      ${hasSignal ? `
        <button class="paper-fill-btn" id="pt-fill-signal">
          ⚡ ${lang === 'zh' ? '使用信号值' : 'Use signal values'}
        </button>
      ` : ''}

      <button class="paper-submit-btn" id="pt-submit">
        ${t('paper.submit')}
      </button>

      <div class="paper-submit-feedback" id="pt-feedback"></div>
    </div>
  `;
}

function _formInput(id, label, value, step, type = 'price') {
  const displayVal = type === 'lot'
    ? (value || 0.01).toFixed(2)
    : (value || 0).toFixed(5);
  return `
    <div class="paper-input-row">
      <label class="paper-input-label" for="${id}">${label}</label>
      <input id="${id}" class="paper-input" type="number"
             step="${step}" min="${step}" value="${displayVal}">
    </div>
  `;
}

// ── Open trades ──────────────────────────────

function _buildOpenTrades(lang) {
  const open = PaperExecution.getOpen();
  if (!open.length) {
    return `<div class="paper-open-empty">
      ${lang === 'zh' ? '当前无持仓' : 'No open trades'}
    </div>`;
  }

  const rows = open.map(trade => _buildTradeRow(trade, lang, true)).join('');

  return `
    <div class="paper-open-section">
      <div class="section-title">${t('paper.openTrades')} (${open.length})</div>
      <div class="paper-trades-list">${rows}</div>
    </div>
  `;
}

// ── Trade history ────────────────────────────

function _buildTradeHistory(lang) {
  const closed = PaperExecution.getClosed().slice(0, 30);
  if (!closed.length) return '';

  const rows = closed.map(trade => _buildTradeRow(trade, lang, false)).join('');

  return `
    <div class="paper-history-section">
      <div class="section-title">${t('paper.tradeHistory')}</div>
      <div class="paper-trades-list paper-trades-history">${rows}</div>
    </div>
  `;
}

function _buildTradeRow(trade, lang, showClose) {
  const isBuy    = trade.direction === 'BUY';
  const dirCls   = isBuy ? 'trade-buy' : 'trade-sell';
  const dirLabel = isBuy ? t('signal.buy') : t('signal.sell');
  const isOpen   = trade.status === 'open';

  const outcomeCls = isOpen ? 'open'
    : trade.outcome === 'win' ? 'win' : 'loss';

  const outcomeLabel = isOpen
    ? t('paper.outcome.open')
    : trade.outcome === 'win'
      ? t('paper.outcome.win')
      : trade.outcome === 'breakeven'
        ? t('paper.outcome.breakeven')
        : t('paper.outcome.loss');

  const pnl = isOpen
    ? ''
    : `<span class="trade-pnl ${(trade.pnl_r ?? 0) >= 0 ? 'pnl-pos' : 'pnl-neg'}">
        ${(trade.pnl_r ?? 0) >= 0 ? '+' : ''}${(trade.pnl_r ?? 0).toFixed(2)}R
        (${formatUSD(trade.pnl_usd)})
       </span>`;

  const exitInfo = !isOpen && trade.exit_reason
    ? `<span class="trade-exit">${t(`paper.exitReason.${trade.exit_reason}`)}</span>`
    : '';

  return `
    <div class="trade-row trade-row-${dirCls}">
      <div class="trade-main">
        <span class="trade-dir ${dirCls}">${dirLabel}</span>
        <span class="trade-entry">${formatPrice(trade.entry_price)}</span>
        <span class="trade-lot">${formatLot(trade.lot_size)}</span>
        <span class="trade-outcome trade-outcome-${outcomeCls}">${outcomeLabel}</span>
        ${pnl}
        ${exitInfo}
      </div>
      <div class="trade-meta">
        <span class="trade-time">${formatDate(new Date(trade.opened_at).getTime())}</span>
        ${!isOpen && trade.duration_minutes
          ? `<span class="trade-dur">${formatDuration(trade.duration_minutes)}</span>`
          : ''}
        ${showClose
          ? `<button class="close-trade-btn" data-id="${trade.id}">${t('paper.close')}</button>`
          : ''}
      </div>
    </div>
  `;
}

// ─────────────────────────────────────────────
// EVENT WIRING
// ─────────────────────────────────────────────

function _attachEvents() {
  // Direction buttons
  _container.querySelectorAll('.paper-dir-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _form.direction = btn.dataset.dir;
      render();
    });
  });

  // Price inputs
  const inputMap = {
    'pt-entry': 'entry_price',
    'pt-sl':    'stop_loss',
    'pt-tp1':   'tp1',
    'pt-tp2':   'tp2',
    'pt-lot':   'lot_size',
  };
  Object.entries(inputMap).forEach(([id, key]) => {
    const el = _container.querySelector(`#${id}`);
    if (el) el.addEventListener('change', () => {
      _form[key] = parseFloat(el.value) || 0;
    });
  });

  // Fill from signal
  const fillBtn = _container.querySelector('#pt-fill-signal');
  if (fillBtn) fillBtn.addEventListener('click', () => {
    _syncFromSignal();
    render();
  });

  // Submit trade
  const submitBtn = _container.querySelector('#pt-submit');
  if (submitBtn) submitBtn.addEventListener('click', () => _handleSubmit());

  // Close trade buttons
  _container.querySelectorAll('.close-trade-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id     = btn.dataset.id;
      const price  = AppState.getCurrentPrice() || 0;
      const result = PaperExecution.closeTrade(id, price, 'manual');
      if (result?.error) {
        _showFeedback(result.message, false);
      } else {
        _showFeedback(getLang() === 'zh' ? '已平仓' : 'Trade closed', true);
      }
    });
  });
}

function _handleSubmit() {
  // V5.2 (FREEZE-RULE-016): read signal context from AppState and pass to
  // PaperExecution so trade records store full signal metadata.
  const sig   = AppState.getLastSignal();
  const votes = AppState.getLastVotes();

  // Build compact agent_votes { agentName: { vote, score } }
  // and agent_scores { agentName: score } from current votes array.
  const agent_votes  = {};
  const agent_scores = {};
  if (Array.isArray(votes)) {
    for (const v of votes) {
      if (v?.agent) {
        agent_votes[v.agent]  = { vote: v.vote ?? 'NEUTRAL', score: v.score ?? 50 };
        agent_scores[v.agent] = v.score ?? 50;
      }
    }
  }

  const result = PaperExecution.submitTrade({
    // Core trade fields
    direction:     _form.direction,
    entry_price:   _form.entry_price || AppState.getCurrentPrice(),
    stop_loss:     _form.stop_loss,
    take_profit_1: _form.tp1,
    take_profit_2: _form.tp2,
    lot_size:      _form.lot_size || 0.01,
    account_balance: 1000,
    risk_pct:      0.02,

    // Signal context (FREEZE-RULE-016)
    signal_id:       sig?.id              ?? null,
    market_regime:   sig?.market_regime   ?? 'unknown',
    signal_strength: sig?.signal_strength ?? 'UNKNOWN',
    final_score:     sig?.final_score     ?? 50,
    final_confidence: sig?.final_confidence ?? 0,
    agents_agreeing: sig?.agents_agreeing ?? 0,
    agent_votes,
    agent_scores,
    // data_sources injected into signal by generateSignal() via Fix-1
    data_sources:    sig?.data_sources    ?? {},
  });

  if (result?.error) {
    _showFeedback(result.message, false);
  } else {
    _showFeedback(getLang() === 'zh' ? '交易已提交' : 'Trade submitted', true);
    render();
  }
}

function _showFeedback(msg, success) {
  const el = _container?.querySelector('#pt-feedback');
  if (!el) return;
  el.textContent = msg;
  el.className   = `paper-submit-feedback ${success ? 'feedback-ok' : 'feedback-err'}`;
  setTimeout(() => { if (el) el.textContent = ''; }, 3000);
}

// ─────────────────────────────────────────────
// SYNC HELPERS
// ─────────────────────────────────────────────

function _syncFromSignal() {
  const signal = AppState.getLastSignal();
  if (!signal || !isActionable(signal)) return;
  _form.direction   = signal.direction === SIGNAL_DIRECTION.SELL ? 'SELL' : 'BUY';
  _form.entry_price = signal.entry_price    ?? 0;
  _form.stop_loss   = signal.stop_loss      ?? 0;
  _form.tp1         = signal.take_profit_1  ?? 0;
  _form.tp2         = signal.take_profit_2  ?? 0;
  _form.lot_size    = signal.lot_size       ?? 0.01;
}
