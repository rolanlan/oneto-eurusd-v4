/**
 * ONETO EUR/USD AI Tool — SettingsPanel
 * ========================================
 * System settings component.
 * Handles: API key management, account profile editing,
 * Decision Engine parameters, language toggle, system reset.
 *
 * Sections:
 *   1. API Connection  — Twelve Data key input + connect/test button
 *   2. Language        — ZH / EN toggle
 *   3. Account         — balance, risk profile, max drawdown, min confidence
 *   4. Decision params — min confidence, min R/R, session/regime prefs
 *   5. System          — reset to defaults, version info
 *
 * Data sources:
 *   AccountState.get()    — load current settings
 *   AccountState.update() — save changes
 *   DataProvider.testApiKey() — validate API key
 *   DataProvider.hasApiKey()  — check connection status
 *   setLang() from i18n   — language switch
 *
 * Events dispatched:
 *   window 'profileUpdated'  — on save
 *   window 'languagechange'  — on language toggle
 *
 * Events listened:
 *   window 'languagechange'  — re-render
 *   window 'profileUpdated'  — re-render
 *
 * CSS classes (from styles/components.css):
 *   .settings-panel, .settings-section, .settings-section-title,
 *   .settings-row, .settings-label, .settings-input,
 *   .settings-btn, .settings-btn-primary, .settings-btn-danger,
 *   .api-status-badge, .api-status-badge.connected/.disconnected,
 *   .lang-toggle-group, .lang-btn, .lang-btn.active,
 *   .risk-profile-group, .rp-btn, .rp-btn.active,
 *   .settings-feedback
 *
 * Architecture Freeze V4.0-R1 | Phase 4C
 */

'use strict';

import * as AccountState from '../state/AccountState.js';
import * as AppState     from '../state/AppState.js';
import * as DataProvider from '../core/DataProvider.js';
import { t, getLang, setLang, formatPct } from '../i18n/i18n.js';

// localStorage key for API key (same as DataProvider)
const STORAGE_KEY_API = 'td_api_key_eurusd';

// ─────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────

let _container    = null;
let _apiKeyInput  = '';
let _testStatus   = null;    // null | 'testing' | 'ok' | 'fail'
let _testMessage  = '';

// ─────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────

/**
 * @param {HTMLElement} container
 */
export function mount(container) {
  if (!container) return;
  _container = container;

  // Load saved API key for display
  try { _apiKeyInput = localStorage.getItem(STORAGE_KEY_API) ?? ''; } catch (_) {}

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
  const hasKey  = DataProvider.hasApiKey();

  return `
    <div class="settings-panel">
      <div class="settings-header">
        <h2 class="panel-title">${t('settings.title')}</h2>
      </div>

      ${_buildApiSection(hasKey, lang)}
      ${_buildLanguageSection(lang)}
      ${_buildAccountSection(profile, lang)}
      ${_buildDecisionSection(profile, lang)}
      ${_buildSystemSection(lang)}
    </div>
  `;
}

// ── API Connection ───────────────────────────

function _buildApiSection(hasKey, lang) {
  const statusCls   = hasKey ? 'connected' : 'disconnected';
  const statusLabel = hasKey
    ? t('settings.connected')
    : t('settings.notConnected');

  const masked = _apiKeyInput.length > 8
    ? _apiKeyInput.slice(0, 4) + '•'.repeat(Math.min(20, _apiKeyInput.length - 8)) + _apiKeyInput.slice(-4)
    : _apiKeyInput;

  const testBadge = _testStatus === 'ok'   ? `<span class="test-badge test-ok">✓ ${_testMessage}</span>`
    : _testStatus === 'fail'  ? `<span class="test-badge test-fail">✗ ${_testMessage}</span>`
    : _testStatus === 'testing'? `<span class="test-badge test-testing">⏳ ${lang === 'zh' ? '验证中...' : 'Testing...'}</span>`
    : '';

  return `
    <div class="settings-section">
      <div class="settings-section-title">${lang === 'zh' ? 'API 连接' : 'API Connection'}</div>

      <div class="api-status-row">
        <span class="api-status-badge ${statusCls}">${statusLabel}</span>
        ${testBadge}
      </div>

      <div class="settings-row">
        <label class="settings-label" for="api-key-input">${t('settings.apiKey')}</label>
        <input id="api-key-input" class="settings-input api-key-input"
               type="text" autocomplete="off"
               placeholder="${t('settings.apiKeyHint')}"
               value="${masked}">
      </div>
      <div class="settings-row settings-row-actions">
        <button class="settings-btn settings-btn-primary" id="btn-connect">
          ${hasKey ? t('settings.disconnect') : t('settings.connect')}
        </button>
        ${hasKey ? `<button class="settings-btn" id="btn-test-key">
          ${lang === 'zh' ? '测试连接' : 'Test Connection'}
        </button>` : ''}
        ${hasKey ? `<button class="settings-btn" id="btn-refresh-data">
          ${t('common.refresh')}
        </button>` : ''}
      </div>
      <p class="settings-hint">
        ${lang === 'zh'
          ? '免费获取 API Key：<a href="https://twelvedata.com" target="_blank">twelvedata.com</a>'
          : 'Get free API key at <a href="https://twelvedata.com" target="_blank">twelvedata.com</a>'}
      </p>
    </div>
  `;
}

// ── Language ─────────────────────────────────

function _buildLanguageSection(lang) {
  return `
    <div class="settings-section">
      <div class="settings-section-title">${t('settings.language')}</div>
      <div class="lang-toggle-group">
        <button class="lang-btn ${lang === 'zh' ? 'active' : ''}" data-lang="zh">
          中文
        </button>
        <button class="lang-btn ${lang === 'en' ? 'active' : ''}" data-lang="en">
          English
        </button>
      </div>
    </div>
  `;
}

// ── Account settings ─────────────────────────

function _buildAccountSection(profile, lang) {
  const riskProfiles = ['conservative', 'standard', 'aggressive'];

  const rpBtns = riskProfiles.map(rp => `
    <button class="rp-btn ${profile.risk_profile === rp ? 'active' : ''}"
            data-rp="${rp}">
      ${t(`risk.${rp}`)}
    </button>
  `).join('');

  return `
    <div class="settings-section">
      <div class="settings-section-title">${t('settings.account')}</div>

      <div class="settings-row">
        <label class="settings-label" for="st-balance">${t('settings.balance')}</label>
        <input id="st-balance" class="settings-input" type="number"
               min="100" max="10000000" step="100"
               value="${profile.account_balance}">
      </div>

      <div class="settings-row">
        <label class="settings-label">${t('settings.riskProfile')}</label>
        <div class="risk-profile-group">${rpBtns}</div>
      </div>

      <div class="settings-row">
        <label class="settings-label" for="st-max-dd">
          ${t('settings.maxDrawdown')}
        </label>
        <input id="st-max-dd" class="settings-input" type="number"
               min="1" max="50" step="1"
               value="${Math.round((profile.max_drawdown_limit ?? 0.10) * 100)}">
        <span class="settings-unit">%</span>
      </div>

      <div class="settings-row">
        <label class="settings-label" for="st-max-consec">
          ${t('settings.maxConsecLoss')}
        </label>
        <input id="st-max-consec" class="settings-input" type="number"
               min="2" max="20" step="1"
               value="${profile.max_consecutive_losses ?? 5}">
      </div>

      <div class="settings-row">
        <label class="settings-label" for="st-timezone">
          ${t('settings.timezone')}
        </label>
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
        <label class="settings-label" for="st-min-conf">
          ${t('settings.minConf')}
        </label>
        <input id="st-min-conf" class="settings-input" type="number"
               min="40" max="95" step="5"
               value="${profile.min_confidence ?? 65}">
        <span class="settings-unit">%</span>
      </div>

      <div class="settings-row">
        <label class="settings-label" for="st-min-rr">
          ${t('settings.minRR')}
        </label>
        <input id="st-min-rr" class="settings-input" type="number"
               min="1" max="5" step="0.1"
               value="${(profile.min_rr_ratio ?? 2.0).toFixed(1)}">
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
    ? (lang === 'zh' ? `连续成功: ${health.consecutive_successes}` : `Consecutive successes: ${health.consecutive_successes}`)
    : (lang === 'zh' ? '等待连接' : 'Awaiting connection');

  return `
    <div class="settings-section settings-section-system">
      <div class="settings-section-title">${lang === 'zh' ? '系统' : 'System'}</div>

      <div class="settings-info-row">
        <span class="info-label">${lang === 'zh' ? '版本' : 'Version'}</span>
        <span class="info-value">v4.0</span>
      </div>
      <div class="settings-info-row">
        <span class="info-label">Twelve Data</span>
        <span class="info-value">${health.status ?? 'unknown'} · ${uptime}</span>
      </div>
      <div class="settings-info-row">
        <span class="info-label">${lang === 'zh' ? '数据模式' : 'Data mode'}</span>
        <span class="info-value">${AppState.getDataSource()}</span>
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
    btn.addEventListener('click', () => {
      setLang(btn.dataset.lang);
    });
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

  // API key input — track raw value
  const apiInput = _container.querySelector('#api-key-input');
  if (apiInput) {
    apiInput.addEventListener('focus', () => {
      // Show actual key on focus for editing
      apiInput.value = _apiKeyInput;
    });
    apiInput.addEventListener('blur', () => {
      _apiKeyInput = apiInput.value.trim();
    });
  }

  // Connect / disconnect
  const connectBtn = _container.querySelector('#btn-connect');
  if (connectBtn) {
    connectBtn.addEventListener('click', async () => {
      const hasKey = DataProvider.hasApiKey();
      if (hasKey) {
        // Disconnect: remove key
        try { localStorage.removeItem(STORAGE_KEY_API); } catch (_) {}
        _apiKeyInput = '';
        _testStatus  = null;
        render();
      } else {
        // Connect: save key and test
        if (!_apiKeyInput) {
          const k = _container.querySelector('#api-key-input')?.value?.trim();
          if (k) _apiKeyInput = k;
        }
        if (_apiKeyInput) {
          try { localStorage.setItem(STORAGE_KEY_API, _apiKeyInput); } catch (_) {}
          await _testKey(_apiKeyInput);
        }
      }
    });
  }

  // Test key
  const testBtn = _container.querySelector('#btn-test-key');
  if (testBtn) {
    testBtn.addEventListener('click', async () => {
      await _testKey(_apiKeyInput);
    });
  }

  // Refresh data
  const refreshBtn = _container.querySelector('#btn-refresh-data');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      await AppState.refreshAll();
      _showFeedback('account-feedback', getLang() === 'zh' ? '数据已刷新' : 'Data refreshed', true);
    });
  }

  // Save account
  const saveAccountBtn = _container.querySelector('#btn-save-account');
  if (saveAccountBtn) {
    saveAccountBtn.addEventListener('click', () => {
      const balance    = parseFloat(_container.querySelector('#st-balance')?.value) || 1000;
      const maxDD      = parseFloat(_container.querySelector('#st-max-dd')?.value) || 10;
      const maxConsec  = parseInt(_container.querySelector('#st-max-consec')?.value, 10) || 5;
      const timezone   = _container.querySelector('#st-timezone')?.value?.trim() || 'Africa/Libreville';
      const riskProfile = _container.querySelector('.rp-btn.active')?.dataset.rp ?? AccountState.get().risk_profile;

      AccountState.update({
        account_balance:        balance,
        risk_profile:           riskProfile,
        max_drawdown_limit:     maxDD / 100,
        max_consecutive_losses: maxConsec,
        timezone,
      });
      _showFeedback('account-feedback', t('settings.saved'), true);
    });
  }

  // Save decision params
  const saveDecisionBtn = _container.querySelector('#btn-save-decision');
  if (saveDecisionBtn) {
    saveDecisionBtn.addEventListener('click', () => {
      const minConf = parseInt(_container.querySelector('#st-min-conf')?.value, 10) || 65;
      const minRR   = parseFloat(_container.querySelector('#st-min-rr')?.value)     || 2.0;

      AccountState.update({
        min_confidence: minConf,
        min_rr_ratio:   minRR,
      });
      _showFeedback('decision-feedback', t('settings.saved'), true);
    });
  }

  // Reset profile
  const resetBtn = _container.querySelector('#btn-reset-profile');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      const lang = getLang();
      const confirmed = window.confirm(
        lang === 'zh'
          ? '确定要重置所有设置为默认值吗？'
          : 'Reset all settings to factory defaults?'
      );
      if (confirmed) {
        AccountState.reset();
        render();
      }
    });
  }
}

// ─────────────────────────────────────────────
// API KEY TEST
// ─────────────────────────────────────────────

async function _testKey(key) {
  _testStatus  = 'testing';
  _testMessage = '';
  render();

  try {
    const result = await DataProvider.testApiKey(key);
    _testStatus  = result.valid ? 'ok'   : 'fail';
    _testMessage = result.message;
    if (result.valid) {
      await AppState.refreshAll();
    }
  } catch (err) {
    _testStatus  = 'fail';
    _testMessage = err.message;
  }

  render();

  // Auto-clear test status after 5 seconds
  setTimeout(() => { _testStatus = null; render(); }, 5000);
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
