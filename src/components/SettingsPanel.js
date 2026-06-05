/**
 * ONETO EUR/USD AI Tool — SettingsPanel
 * ========================================
 * System settings component.
 * V4.3 additions: FRED key, Finnhub key, data source status panel.
 *
 * Sections:
 *   1. API Connection    — Twelve Data key + FRED key + Finnhub key
 *   2. Data Status       — per-service live/cached/stale/stub indicators
 *   3. Language          — ZH / EN toggle
 *   4. Account           — balance, risk profile, max drawdown, min confidence
 *   5. Decision params   — min confidence, min R/R
 *   6. System            — reset to defaults, version info
 *
 * V4.3 changes (additive):
 *   + FRED API Key input row  (localStorage: fred_api_key_v4)
 *   + Finnhub API Key input row (localStorage: finnhub_api_key_v4)
 *   + Data source status panel (per-service: ● live / ○ cached / ◌ stale / × stub)
 *   + Refresh data button now calls MemoryAggregator.refresh()
 *
 * All existing Twelve Data key logic, account settings, decision params,
 * language toggle, and system section: unchanged.
 *
 * Architecture Freeze V4.0-R1 | V4.3 STEP 5.5
 */

'use strict';

import * as AccountState      from '../state/AccountState.js';
import * as AppState          from '../state/AppState.js';
import * as DataProvider      from '../core/DataProvider.js';
import * as FREDService       from '../services/FREDService.js';
import * as FinnhubService    from '../services/FinnhubService.js';
import * as MemoryAggregator  from '../services/MemoryAggregator.js';
import { t, getLang, setLang } from '../i18n/i18n.js';

// localStorage keys
const STORAGE_KEY_TD      = 'td_api_key_eurusd';
const STORAGE_KEY_FRED    = 'fred_api_key_v4';
const STORAGE_KEY_FINNHUB = 'finnhub_api_key_v4';

// ─────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────

let _container      = null;
let _tdKeyInput     = '';
let _fredKeyInput   = '';
let _finnhubKeyInput= '';
let _testStatus     = null;    // null | 'testing' | 'ok' | 'fail'
let _testMessage    = '';
let _testTarget     = 'td';    // which service is being tested

// ─────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────

export function mount(container) {
  if (!container) return;
  _container = container;

  try { _tdKeyInput      = localStorage.getItem(STORAGE_KEY_TD)      ?? ''; } catch (_) {}
  try { _fredKeyInput    = localStorage.getItem(STORAGE_KEY_FRED)    ?? ''; } catch (_) {}
  try { _finnhubKeyInput = localStorage.getItem(STORAGE_KEY_FINNHUB) ?? ''; } catch (_) {}

  render();

  window.addEventListener('languagechange', () => render());
  window.addEventListener('profileUpdated', () => render());
}

export function render() {
  if (!_container) return;
  try {
    _container.innerHTML = _buildHTML();
    _attachEvents();
  } catch (err) {
    console.error('[SettingsPanel] Render error:', err.message);
  }
}

// ─────────────────────────────────────────────
// HTML
// ─────────────────────────────────────────────

function _buildHTML() {
  const profile = AccountState.get();
  const lang    = getLang();
  const hasTD   = DataProvider.hasApiKey();
  const hasFRED = FREDService.hasApiKey();
  const hasFinn = FinnhubService.hasApiKey();

  return `
    <div class="settings-panel">
      <div class="settings-header">
        <h2 class="panel-title">${t('settings.title')}</h2>
      </div>

      ${_buildApiSection(hasTD, hasFRED, hasFinn, lang)}
      ${_buildDataStatusSection(lang)}
      ${_buildLanguageSection(lang)}
      ${_buildAccountSection(profile, lang)}
      ${_buildDecisionSection(profile, lang)}
      ${_buildSystemSection(lang)}
    </div>
  `;
}

// ── API Connection (all 3 keys) ──────────────

function _buildApiSection(hasTD, hasFRED, hasFinn, lang) {
  const testBadge = _testStatus === 'ok'
    ? `<span class="test-badge test-ok">✓ ${_testMessage}</span>`
    : _testStatus === 'fail'
      ? `<span class="test-badge test-fail">✗ ${_testMessage}</span>`
      : _testStatus === 'testing'
        ? `<span class="test-badge test-testing">⏳ ${lang === 'zh' ? '验证中...' : 'Testing...'}</span>`
        : '';

  const maskKey = (k) => k.length > 8
    ? k.slice(0, 4) + '•'.repeat(Math.min(20, k.length - 8)) + k.slice(-4)
    : k;

  return `
    <div class="settings-section">
      <div class="settings-section-title">${lang === 'zh' ? 'API 连接' : 'API Connection'}</div>

      <div class="api-status-row">
        ${testBadge}
      </div>

      <!-- Twelve Data Key -->
      <div class="settings-row">
        <label class="settings-label" for="td-key-input">
          Twelve Data
        </label>
        <span class="api-status-badge ${hasTD ? 'connected' : 'disconnected'}">
          ${hasTD ? t('settings.connected') : t('settings.notConnected')}
        </span>
      </div>
      <div class="settings-row">
        <input id="td-key-input" class="settings-input api-key-input"
               type="text" autocomplete="off"
               placeholder="${t('settings.apiKeyHint')}"
               value="${maskKey(_tdKeyInput)}">
      </div>
      <div class="settings-row settings-row-actions">
        <button class="settings-btn settings-btn-primary" id="btn-td-connect">
          ${hasTD ? t('settings.disconnect') : t('settings.connect')}
        </button>
        ${hasTD ? `<button class="settings-btn" id="btn-td-test">
          ${lang === 'zh' ? '测试' : 'Test'}
        </button>` : ''}
      </div>
      <p class="settings-hint">
        ${lang === 'zh'
          ? '<a href="https://twelvedata.com" target="_blank">twelvedata.com</a> — 免费 800 credits/天'
          : '<a href="https://twelvedata.com" target="_blank">twelvedata.com</a> — Free 800 credits/day'}
      </p>

      <!-- FRED Key -->
      <div class="settings-row" style="margin-top:var(--gap-md)">
        <label class="settings-label" for="fred-key-input">FRED API</label>
        <span class="api-status-badge ${hasFRED ? 'connected' : 'disconnected'}">
          ${hasFRED ? t('settings.connected') : t('settings.notConnected')}
        </span>
      </div>
      <div class="settings-row">
        <input id="fred-key-input" class="settings-input api-key-input"
               type="text" autocomplete="off"
               placeholder="${lang === 'zh' ? '输入 FRED API Key' : 'Enter FRED API Key'}"
               value="${maskKey(_fredKeyInput)}">
      </div>
      <div class="settings-row settings-row-actions">
        <button class="settings-btn settings-btn-primary" id="btn-fred-connect">
          ${hasFRED ? t('settings.disconnect') : t('settings.connect')}
        </button>
        ${hasFRED ? `<button class="settings-btn" id="btn-fred-test">
          ${lang === 'zh' ? '测试' : 'Test'}
        </button>` : ''}
      </div>
      <p class="settings-hint">
        ${lang === 'zh'
          ? '<a href="https://fred.stlouisfed.org/docs/api/api_key.html" target="_blank">stlouisfed.org</a> — 免费，无次数限制'
          : '<a href="https://fred.stlouisfed.org/docs/api/api_key.html" target="_blank">stlouisfed.org</a> — Free, unlimited'}
      </p>

      <!-- Finnhub Key -->
      <div class="settings-row" style="margin-top:var(--gap-md)">
        <label class="settings-label" for="finnhub-key-input">Finnhub API</label>
        <span class="api-status-badge ${hasFinn ? 'connected' : 'disconnected'}">
          ${hasFinn ? t('settings.connected') : t('settings.notConnected')}
        </span>
      </div>
      <div class="settings-row">
        <input id="finnhub-key-input" class="settings-input api-key-input"
               type="text" autocomplete="off"
               placeholder="${lang === 'zh' ? '输入 Finnhub API Key' : 'Enter Finnhub API Key'}"
               value="${maskKey(_finnhubKeyInput)}">
      </div>
      <div class="settings-row settings-row-actions">
        <button class="settings-btn settings-btn-primary" id="btn-finnhub-connect">
          ${hasFinn ? t('settings.disconnect') : t('settings.connect')}
        </button>
        ${hasFinn ? `<button class="settings-btn" id="btn-finnhub-test">
          ${lang === 'zh' ? '测试' : 'Test'}
        </button>` : ''}
      </div>
      <p class="settings-hint">
        ${lang === 'zh'
          ? '<a href="https://finnhub.io/register" target="_blank">finnhub.io</a> — 免费 60次/分钟（新闻 + 日历）'
          : '<a href="https://finnhub.io/register" target="_blank">finnhub.io</a> — Free 60 req/min (news + calendar)'}
      </p>
    </div>
  `;
}

// ── Data Status Panel ────────────────────────

function _buildDataStatusSection(lang) {
  const status   = MemoryAggregator.getStatus();
  const tdSource = AppState.getDataSource();

  // ── DXY detail row (prominent — STEP 1 feature) ──
  const dxyStatus    = status.dxy?.status ?? 'not_fetched';
  const dxyPrice     = status.dxy?.price;
  const dxyTrend     = status.dxy?.trend ?? '—';
  const dxyFetchedAt = status.dxy?.fetched_at ?? 0;

  const dxyBadgeColor = dxyStatus === 'live'    ? 'var(--green)'
                      : dxyStatus === 'cached'  ? 'var(--amber-dim)'
                      : dxyStatus === 'stale'   ? '#f97316'
                      : 'var(--text4)';
  const dxyBadgeLabel = dxyStatus === 'live'    ? 'LIVE'
                      : dxyStatus === 'derived' ? 'DERIVED'
                      : dxyStatus === 'cached'  ? 'CACHE'
                      : dxyStatus === 'stale'   ? 'STALE'
                      : dxyStatus === 'stub'    ? 'STUB'
                      : '—';
  const dxyAge = dxyFetchedAt
    ? _formatAge(Date.now() - dxyFetchedAt, lang)
    : '';
  const dxyTrendArrow = dxyTrend === 'rising'  ? ' ↑'
                      : dxyTrend === 'falling' ? ' ↓'
                      : dxyTrend === 'ranging' ? ' →' : '';

  const dxyBlock = `
    <div class="settings-info-row" style="align-items:flex-start;flex-direction:column;gap:4px;padding:var(--gap-sm) 0;border-bottom:1px solid var(--border)">
      <div style="display:flex;align-items:center;gap:var(--gap-sm);width:100%">
        <span class="info-label" style="font-weight:700;color:var(--text1)">
          ${lang === 'zh' ? 'DXY（合成/EUR推导）' : 'DXY (Synthetic, EUR-derived)'}
        </span>
        <span style="font-size:0.68rem;font-weight:700;padding:1px 7px;border-radius:999px;
                     background:${dxyBadgeColor === 'var(--green)' ? 'var(--green-bg)' : dxyBadgeColor === 'var(--amber-dim)' ? 'var(--amber-bg)' : 'var(--bg3)'};
                     color:${dxyBadgeColor};border:1px solid currentColor">
          ${dxyBadgeLabel}
        </span>
        ${dxyAge ? `<span style="font-size:0.68rem;color:var(--text4)">${dxyAge}</span>` : ''}
      </div>
      ${dxyPrice ? `
      <div style="display:flex;gap:var(--gap-md);align-items:center">
        <span style="font-family:var(--font-num);font-size:1.1rem;font-weight:700;color:var(--text1)">
          ${dxyPrice.toFixed(3)}
        </span>
        <span style="font-size:0.8rem;font-weight:600;
                     color:${dxyTrend === 'rising' ? 'var(--green)' : dxyTrend === 'falling' ? 'var(--red)' : 'var(--amber-dim)'}">
          ${dxyTrendArrow} ${dxyTrend.toUpperCase()}
        </span>
        <span style="font-size:0.68rem;color:var(--text3)">
          ${lang === 'zh' ? 'EUR/USD推导 · MA5/MA20趋势' : 'EUR/USD derived · MA5/MA20 trend'}
        </span>
      </div>` : `
      <div style="font-size:0.78rem;color:var(--text4)">
        ${lang === 'zh' ? '未连接 — 请配置 Twelve Data Key' : 'Not connected — configure Twelve Data key'}
      </div>`}
    </div>`;

  // ── Other services summary rows ──
  const rows = [
    { label: 'EUR/USD',
      src:   tdSource,
      extra: '' },
    { label: lang === 'zh' ? 'FRED 宏观（CACHE=真实数据缓存）' : 'FRED Macro (CACHE = real data cached)',
      src:   status.fred?.status ?? 'not_fetched',
      extra: status.fred?.spread != null ? ` · Spread ${status.fred.spread.toFixed(2)}%` : '' },
    { label: lang === 'zh' ? '新闻情绪' : 'News',
      src:   status.news?.status ?? 'not_fetched',
      extra: status.news?.score_24h != null ? ` · ${status.news.score_24h > 0 ? '+' : ''}${status.news.score_24h}` : '' },
    { label: lang === 'zh' ? '经济日历' : 'Calendar',
      src:   status.calendar?.status ?? 'not_fetched',
      extra: status.calendar?.next_event_hours != null
        ? ` · Next ${status.calendar.next_event_hours.toFixed(1)}h`
        : '' },
    { label: 'COT',
      src:   status.cot?.status ?? 'not_fetched',
      extra: status.cot?.z_score != null ? ` · z=${status.cot.z_score.toFixed(2)}` : '' },
  ].map(({ label, src, extra }) => {
    const badgeLabel = src === 'live'   ? 'LIVE'
                     : src === 'cached' ? 'CACHE'
                     : src === 'stale'  ? 'STALE'
                     : src === 'stub'   ? 'STUB'
                     : '—';
    const color = src === 'live'   ? 'var(--green)'
                : src === 'cached' ? 'var(--amber-dim)'
                : src === 'stale'  ? '#f97316'
                : 'var(--text4)';
    const bg    = src === 'live'   ? 'var(--green-bg)'
                : src === 'cached' ? 'var(--amber-bg)'
                : 'var(--bg3)';
    return `
      <div class="settings-info-row">
        <span class="info-label">${label}</span>
        <div style="display:flex;align-items:center;gap:var(--gap-xs)">
          <span style="font-size:0.65rem;font-weight:700;padding:1px 6px;border-radius:999px;
                       background:${bg};color:${color};border:1px solid currentColor">
            ${badgeLabel}
          </span>
          <span class="info-value" style="color:var(--text3)">${extra}</span>
        </div>
      </div>`;
  }).join('');

  return `
    <div class="settings-section">
      <div class="settings-section-title">${lang === 'zh' ? '数据来源状态' : 'Data Source Status'}</div>
      ${dxyBlock}
      ${rows}
      <div class="settings-row settings-row-actions" style="margin-top:var(--gap-sm)">
        <button class="settings-btn" id="btn-refresh-all">
          ${lang === 'zh' ? '⟳ 刷新所有数据' : '⟳ Refresh All Data'}
        </button>
      </div>
      <span class="settings-feedback" id="refresh-feedback"></span>
    </div>
  `;
}

/**
 * Formats a millisecond age into a human-readable string.
 * @param {number} ageMs
 * @param {string} lang
 * @returns {string}
 */
function _formatAge(ageMs, lang) {
  if (!ageMs || ageMs < 0) return '';
  const mins = Math.floor(ageMs / 60000);
  const hrs  = Math.floor(mins / 60);
  if (lang === 'zh') {
    if (hrs > 0) return `${hrs}小时前`;
    if (mins > 0) return `${mins}分钟前`;
    return '刚刚';
  }
  if (hrs > 0) return `${hrs}h ago`;
  if (mins > 0) return `${mins}m ago`;
  return 'just now';
}

// ── Language ─────────────────────────────────

function _buildLanguageSection(lang) {
  return `
    <div class="settings-section">
      <div class="settings-section-title">${t('settings.language')}</div>
      <div class="lang-toggle-group">
        <button class="lang-btn ${lang === 'zh' ? 'active' : ''}" data-lang="zh">中文</button>
        <button class="lang-btn ${lang === 'en' ? 'active' : ''}" data-lang="en">English</button>
      </div>
    </div>
  `;
}

// ── Account settings ─────────────────────────

function _buildAccountSection(profile, lang) {
  const riskProfiles = ['conservative', 'standard', 'aggressive'];
  const rpBtns = riskProfiles.map(rp => `
    <button class="rp-btn ${profile.risk_profile === rp ? 'active' : ''}" data-rp="${rp}">
      ${t(`risk.${rp}`)}
    </button>`).join('');

  return `
    <div class="settings-section">
      <div class="settings-section-title">${t('settings.account')}</div>

      <div class="settings-row">
        <label class="settings-label" for="st-balance">${t('settings.balance')}</label>
        <input id="st-balance" class="settings-input" type="number"
               min="100" max="10000000" step="100" value="${profile.account_balance}">
      </div>
      <div class="settings-row">
        <label class="settings-label">${t('settings.riskProfile')}</label>
        <div class="risk-profile-group">${rpBtns}</div>
      </div>
      <div class="settings-row">
        <label class="settings-label" for="st-max-dd">${t('settings.maxDrawdown')}</label>
        <input id="st-max-dd" class="settings-input" type="number" min="1" max="50" step="1"
               value="${Math.round((profile.max_drawdown_limit ?? 0.10) * 100)}">
        <span class="settings-unit">%</span>
      </div>
      <div class="settings-row">
        <label class="settings-label" for="st-max-consec">${t('settings.maxConsecLoss')}</label>
        <input id="st-max-consec" class="settings-input" type="number" min="2" max="20" step="1"
               value="${profile.max_consecutive_losses ?? 5}">
      </div>
      <div class="settings-row">
        <label class="settings-label" for="st-timezone">${t('settings.timezone')}</label>
        <input id="st-timezone" class="settings-input" type="text"
               value="${profile.timezone ?? 'Africa/Libreville'}">
      </div>
      <button class="settings-btn settings-btn-primary" id="btn-save-account">
        ${t('settings.save')}
      </button>
      <span class="settings-feedback" id="account-feedback"></span>
    </div>
  `;
}

// ── Decision Engine parameters ───────────────

function _buildDecisionSection(profile, lang) {
  return `
    <div class="settings-section">
      <div class="settings-section-title">${t('settings.decisionParams')}</div>
      <div class="settings-row">
        <label class="settings-label" for="st-min-conf">${t('settings.minConf')}</label>
        <input id="st-min-conf" class="settings-input" type="number"
               min="40" max="95" step="5" value="${profile.min_confidence ?? 65}">
        <span class="settings-unit">%</span>
      </div>
      <div class="settings-row">
        <label class="settings-label" for="st-min-rr">${t('settings.minRR')}</label>
        <input id="st-min-rr" class="settings-input" type="number"
               min="1" max="5" step="0.1" value="${(profile.min_rr_ratio ?? 2.0).toFixed(1)}">
      </div>
      <button class="settings-btn settings-btn-primary" id="btn-save-decision">
        ${t('settings.save')}
      </button>
      <span class="settings-feedback" id="decision-feedback"></span>
    </div>
  `;
}

// ── System section ───────────────────────────

function _buildSystemSection(lang) {
  const health = DataProvider.getApiHealth();
  const uptime = health.consecutive_successes > 0
    ? (lang === 'zh' ? `连续成功: ${health.consecutive_successes}` : `Successes: ${health.consecutive_successes}`)
    : (lang === 'zh' ? '等待连接' : 'Awaiting connection');

  return `
    <div class="settings-section settings-section-system">
      <div class="settings-section-title">${lang === 'zh' ? '系统' : 'System'}</div>
      <div class="settings-info-row">
        <span class="info-label">${lang === 'zh' ? '版本' : 'Version'}</span>
        <span class="info-value">v4.0 · V4.3</span>
      </div>
      <div class="settings-info-row">
        <span class="info-label">Twelve Data</span>
        <span class="info-value">${health.status ?? 'unknown'} · ${uptime}</span>
      </div>
      <div class="settings-row settings-row-actions">
        <button class="settings-btn settings-btn-danger" id="btn-reset-profile">
          ${t('settings.reset')}
        </button>
      </div>
    </div>
  `;
}

// ─────────────────────────────────────────────
// EVENTS
// ─────────────────────────────────────────────

function _attachEvents() {
  // Language toggle
  _container.querySelectorAll('.lang-btn').forEach(btn => {
    btn.addEventListener('click', () => setLang(btn.dataset.lang));
  });

  // Risk profile buttons
  let _selectedRp = AccountState.get().risk_profile;
  _container.querySelectorAll('.rp-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _selectedRp = btn.dataset.rp;
      _container.querySelectorAll('.rp-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.rp === _selectedRp)
      );
    });
  });

  // ── Twelve Data key ──
  const tdInput = _container.querySelector('#td-key-input');
  if (tdInput) {
    tdInput.addEventListener('focus', () => { tdInput.value = _tdKeyInput; });
    tdInput.addEventListener('blur',  () => { _tdKeyInput = tdInput.value.trim(); });
  }
  _container.querySelector('#btn-td-connect')?.addEventListener('click', async () => {
    if (DataProvider.hasApiKey()) {
      try { localStorage.removeItem(STORAGE_KEY_TD); } catch (_) {}
      _tdKeyInput = '';
      _testStatus = null;
      render();
    } else {
      const k = _container.querySelector('#td-key-input')?.value?.trim() || _tdKeyInput;
      if (k) {
        _tdKeyInput = k;
        try { localStorage.setItem(STORAGE_KEY_TD, k); } catch (_) {}
        await _testKey('td', k);
      }
    }
  });
  _container.querySelector('#btn-td-test')?.addEventListener('click', async () => {
    await _testKey('td', _tdKeyInput);
  });

  // ── FRED key ──
  const fredInput = _container.querySelector('#fred-key-input');
  if (fredInput) {
    fredInput.addEventListener('focus', () => { fredInput.value = _fredKeyInput; });
    fredInput.addEventListener('blur',  () => { _fredKeyInput = fredInput.value.trim(); });
  }
  _container.querySelector('#btn-fred-connect')?.addEventListener('click', async () => {
    if (FREDService.hasApiKey()) {
      try { localStorage.removeItem(STORAGE_KEY_FRED); } catch (_) {}
      _fredKeyInput = '';
      _testStatus   = null;
      render();
    } else {
      const k = _container.querySelector('#fred-key-input')?.value?.trim() || _fredKeyInput;
      if (k) {
        _fredKeyInput = k;
        try { localStorage.setItem(STORAGE_KEY_FRED, k); } catch (_) {}
        await _testKey('fred', k);
      }
    }
  });
  _container.querySelector('#btn-fred-test')?.addEventListener('click', async () => {
    await _testKey('fred', _fredKeyInput);
  });

  // ── Finnhub key ──
  const finnhubInput = _container.querySelector('#finnhub-key-input');
  if (finnhubInput) {
    finnhubInput.addEventListener('focus', () => { finnhubInput.value = _finnhubKeyInput; });
    finnhubInput.addEventListener('blur',  () => { _finnhubKeyInput = finnhubInput.value.trim(); });
  }
  _container.querySelector('#btn-finnhub-connect')?.addEventListener('click', async () => {
    if (FinnhubService.hasApiKey()) {
      try { localStorage.removeItem(STORAGE_KEY_FINNHUB); } catch (_) {}
      _finnhubKeyInput = '';
      _testStatus      = null;
      render();
    } else {
      const k = _container.querySelector('#finnhub-key-input')?.value?.trim() || _finnhubKeyInput;
      if (k) {
        _finnhubKeyInput = k;
        try { localStorage.setItem(STORAGE_KEY_FINNHUB, k); } catch (_) {}
        await _testKey('finnhub', k);
      }
    }
  });
  _container.querySelector('#btn-finnhub-test')?.addEventListener('click', async () => {
    await _testKey('finnhub', _finnhubKeyInput);
  });

  // ── Refresh all data ──
  _container.querySelector('#btn-refresh-all')?.addEventListener('click', async () => {
    const btn = _container.querySelector('#btn-refresh-all');
    if (btn) { btn.disabled = true; btn.textContent = getLang() === 'zh' ? '刷新中...' : 'Refreshing...'; }
    await Promise.allSettled([
      AppState.refreshAll(),
      MemoryAggregator.smartRefresh(),
    ]);
    _showFeedback('refresh-feedback', getLang() === 'zh' ? '数据已刷新' : 'Data refreshed', true);
    render();
  });

  // ── Save account ──
  _container.querySelector('#btn-save-account')?.addEventListener('click', () => {
    const balance    = parseFloat(_container.querySelector('#st-balance')?.value) || 1000;
    const maxDD      = parseFloat(_container.querySelector('#st-max-dd')?.value)  || 10;
    const maxConsec  = parseInt(_container.querySelector('#st-max-consec')?.value, 10) || 5;
    const timezone   = _container.querySelector('#st-timezone')?.value?.trim() || 'Africa/Libreville';
    const riskProfile= _container.querySelector('.rp-btn.active')?.dataset.rp ?? AccountState.get().risk_profile;
    AccountState.update({
      account_balance: balance, risk_profile: riskProfile,
      max_drawdown_limit: maxDD / 100, max_consecutive_losses: maxConsec, timezone,
    });
    _showFeedback('account-feedback', t('settings.saved'), true);
  });

  // ── Save decision params ──
  _container.querySelector('#btn-save-decision')?.addEventListener('click', () => {
    const minConf = parseInt(_container.querySelector('#st-min-conf')?.value, 10) || 65;
    const minRR   = parseFloat(_container.querySelector('#st-min-rr')?.value)     || 2.0;
    AccountState.update({ min_confidence: minConf, min_rr_ratio: minRR });
    _showFeedback('decision-feedback', t('settings.saved'), true);
  });

  // ── Reset profile ──
  _container.querySelector('#btn-reset-profile')?.addEventListener('click', () => {
    const lang = getLang();
    const confirmed = window.confirm(
      lang === 'zh' ? '确定要重置所有设置为默认值吗？' : 'Reset all settings to factory defaults?'
    );
    if (confirmed) { AccountState.reset(); render(); }
  });
}

// ─────────────────────────────────────────────
// KEY TESTING
// ─────────────────────────────────────────────

async function _testKey(service, key) {
  _testStatus  = 'testing';
  _testTarget  = service;
  _testMessage = '';
  render();

  try {
    let result;
    if      (service === 'td')      result = await DataProvider.testApiKey(key);
    else if (service === 'fred')    result = await FREDService.testConnection(key);
    else if (service === 'finnhub') result = await FinnhubService.testConnection(key);
    else                            result = { valid: false, message: 'Unknown service' };

    _testStatus  = result.valid ? 'ok' : 'fail';
    _testMessage = result.message;

    if (result.valid) {
      // After any key validates successfully, clear caches and refresh data
      // so the new key takes effect immediately without requiring a page reload.
      if (service === 'td') {
        await AppState.refreshAll();
      }
      // For FRED and Finnhub: clear circuit breaker + caches so new key triggers live fetch.
      if (service === 'fred') {
        FREDService.clearAuthFailure?.();
        FREDService.clearCache?.();
        await MemoryAggregator.smartRefresh();
        render();
      }
      if (service === 'finnhub') {
        FinnhubService.clearAuthFailure?.();
        FinnhubService.clearCache?.();
        await MemoryAggregator.smartRefresh();
        render();
      }
    }
  } catch (err) {
    _testStatus  = 'fail';
    _testMessage = err.message;
  }

  render();
  setTimeout(() => { _testStatus = null; render(); }, 6000);
}

// ─────────────────────────────────────────────
// FEEDBACK
// ─────────────────────────────────────────────

function _showFeedback(feedbackId, msg, success) {
  const el = _container?.querySelector(`#${feedbackId}`);
  if (!el) return;
  el.textContent = msg;
  el.className   = `settings-feedback ${success ? 'feedback-ok' : 'feedback-err'}`;
  setTimeout(() => { if (el) { el.textContent = ''; el.className = 'settings-feedback'; } }, 3000);
}
