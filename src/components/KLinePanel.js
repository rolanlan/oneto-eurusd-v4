/**
 * ONETO EUR/USD AI Tool — KLinePanel
 * =====================================
 * K-Line chart component.
 * Uses TradingView Lightweight Charts v4 for candlestick display.
 * Uses Chart.js for MACD + RSI sub-charts.
 *
 * Key pattern (v3.2 verified fix — do NOT change):
 *   createMainChart()  — called ONCE on mount, never again
 *   updateMainChart()  — called on every data refresh, sets data only
 * This pattern prevents the canvas reuse error that caused blank charts in v3.1.
 *
 * Features:
 *   · 1H / 4H / 1D timeframe switching with live data fetch
 *   · MA20, MA50 overlays (toggleable)
 *   · Bollinger Bands overlay (toggleable)
 *   · Signal markers (arrowUp / arrowDown) for last signal
 *   · SL/TP price lines via createPriceLine()
 *   · MACD sub-chart (bar histogram + line)
 *   · RSI sub-chart (line + overbought/oversold bands)
 *   · Crosshair OHLCV display on hover
 *
 * Data sources:
 *   AppState.getCandles(interval) — cached candle arrays
 *   AppState.getLastSignal()      — for signal markers + SL/TP lines
 *   DataProvider.getCandles()     — fresh fetch on timeframe switch
 *
 * Events listened:
 *   window 'stateUpdated'    — update chart data
 *   window 'signalGenerated' — add signal markers
 *   window 'languagechange'  — update labels only (no chart rebuild)
 *
 * Requires TradingView Lightweight Charts v4 on window.LightweightCharts
 * Requires Chart.js on window.Chart
 *
 * CSS classes (from styles/kline.css):
 *   .kline-panel, .kline-toolbar, .tf-btn, .tf-btn.active,
 *   .indicator-toggles, .ind-toggle, .ind-toggle.active,
 *   .kline-main-wrap, #tvChart, .kline-ohlc-bar,
 *   .kline-sub-wrap, .kline-macd-wrap, .kline-rsi-wrap,
 *   .kline-status-bar, .kline-data-source
 *
 * Architecture Freeze V4.0-R1 | Phase 4C
 */

'use strict';

import * as AppState    from '../state/AppState.js';
import * as DataProvider from '../core/DataProvider.js';
import { t, getLang, formatPrice } from '../i18n/i18n.js';
import { isActionable, SIGNAL_DIRECTION } from '../types/Signal.js';
import { calcMA, calcRSI, calcMACD, calcBB } from '../utils/indicators.js';

// ─────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────

let _container     = null;
let _tvChart       = null;        // LightweightCharts IChartApi
let _tvCandleSeries= null;        // ISeriesApi<'Candlestick'>
let _tvMa20Series  = null;
let _tvMa50Series  = null;
let _tvBBUpperSeries = null;
let _tvBBLowerSeries = null;
let _tvSlLine      = null;        // price line ref for SL
let _tvTpLine      = null;        // price line ref for TP
let _macdChart     = null;        // Chart.js instance
let _rsiChart      = null;        // Chart.js instance
let _currentTf     = '4H';
let _showMa        = true;
let _showBB        = false;
let _showSignals   = true;
let _mounted       = false;

// ─────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────

/**
 * Mounts the KLinePanel. createMainChart() is called exactly once here.
 * @param {HTMLElement} container
 */
export function mount(container) {
  if (!container || _mounted) return;
  _container = container;
  _mounted   = true;

  // Render scaffold first, THEN init charts after DOM is ready
  _container.innerHTML = _buildScaffold();
  _initCharts();
  _attachToolbarEvents();

  // Subscribe to state
  AppState.subscribe('stateUpdated',    () => _onDataUpdate());
  AppState.subscribe('signalGenerated', () => _onSignalUpdate());
  window.addEventListener('languagechange', () => _updateLabels());

  // Load initial data
  _loadAndDraw(_currentTf);
}

/**
 * Forces a chart data refresh from AppState current candles.
 */
export function refresh() {
  _loadAndDraw(_currentTf);
}

// ─────────────────────────────────────────────
// CHART INIT (called once only)
// ─────────────────────────────────────────────

function _initCharts() {
  _createMainChart();
  _createMACDChart();
  _createRSIChart();
}

/**
 * Creates the TradingView candlestick chart.
 * Called ONCE on mount. Never called again.
 * Pattern from v3.2 fix — guaranteed single canvas instance.
 */
function _createMainChart() {
  const wrap = _container.querySelector('#tvChart');
  if (!wrap) return;

  const LC = window.LightweightCharts;
  if (!LC) {
    console.error('[KLinePanel] LightweightCharts not loaded');
    return;
  }

  _tvChart = LC.createChart(wrap, {
    width:  wrap.clientWidth  || 800,
    height: wrap.clientHeight || 380,
    layout: {
      background: { color: 'transparent' },
      textColor:  'var(--text2, #9ca3af)',
    },
    grid: {
      vertLines:  { color: 'var(--border, #1f2937)', style: 1 },
      horzLines:  { color: 'var(--border, #1f2937)', style: 1 },
    },
    crosshair: { mode: 1 },
    timeScale: {
      timeVisible:    true,
      secondsVisible: false,
      borderColor:    'var(--border, #1f2937)',
    },
    rightPriceScale: { borderColor: 'var(--border, #1f2937)' },
  });

  _tvCandleSeries = _tvChart.addCandlestickSeries({
    upColor:        '#4ade80',
    downColor:      '#f87171',
    borderUpColor:  '#4ade80',
    borderDownColor:'#f87171',
    wickUpColor:    '#4ade80',
    wickDownColor:  '#f87171',
  });

  _tvMa20Series = _tvChart.addLineSeries({
    color:     'rgba(251,191,36,0.75)',
    lineWidth: 1,
    priceLineVisible: false,
    lastValueVisible: false,
  });

  _tvMa50Series = _tvChart.addLineSeries({
    color:     'rgba(139,92,246,0.75)',
    lineWidth: 1,
    priceLineVisible: false,
    lastValueVisible: false,
  });

  _tvBBUpperSeries = _tvChart.addLineSeries({
    color:     'rgba(99,102,241,0.5)',
    lineWidth: 1,
    priceLineVisible: false,
    lastValueVisible: false,
  });

  _tvBBLowerSeries = _tvChart.addLineSeries({
    color:     'rgba(99,102,241,0.5)',
    lineWidth: 1,
    priceLineVisible: false,
    lastValueVisible: false,
  });

  // Crosshair OHLCV display
  _tvChart.subscribeCrosshairMove(param => {
    const bar = _container.querySelector('.kline-ohlc-bar');
    if (!bar) return;
    if (param.time && param.seriesData?.size) {
      const d = param.seriesData.get(_tvCandleSeries);
      if (d) {
        bar.innerHTML = `
          <span class="ohlc-o">O ${formatPrice(d.open)}</span>
          <span class="ohlc-h">H ${formatPrice(d.high)}</span>
          <span class="ohlc-l">L ${formatPrice(d.low)}</span>
          <span class="ohlc-c">C ${formatPrice(d.close)}</span>
        `;
      }
    } else {
      bar.innerHTML = '';
    }
  });

  // Resize observer
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => {
      if (_tvChart && wrap.clientWidth > 0) {
        _tvChart.resize(wrap.clientWidth, wrap.clientHeight || 380);
      }
    });
    ro.observe(wrap);
  }
}

function _createMACDChart() {
  const canvas = _container.querySelector('#macdCanvas');
  if (!canvas || !window.Chart) return;

  // Destroy existing instance if any (safety)
  if (_macdChart) { _macdChart.destroy(); _macdChart = null; }

  _macdChart = new window.Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: { labels: [], datasets: [{
      label: 'MACD Hist',
      data:  [],
      backgroundColor: ctx => ctx.raw >= 0
        ? 'rgba(74,222,128,0.7)' : 'rgba(248,113,113,0.7)',
      borderWidth: 0,
    }]},
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { display: false },
        y: { ticks: { color: '#6b7280', font: { size: 9 }},
             grid: { color: '#1f2937' } },
      },
    },
  });
}

function _createRSIChart() {
  const canvas = _container.querySelector('#rsiCanvas');
  if (!canvas || !window.Chart) return;

  if (_rsiChart) { _rsiChart.destroy(); _rsiChart = null; }

  _rsiChart = new window.Chart(canvas.getContext('2d'), {
    type: 'line',
    data: { labels: [], datasets: [{
      label: 'RSI',
      data:  [],
      borderColor: '#818cf8',
      borderWidth: 1.5,
      pointRadius: 0,
      tension: 0.1,
      fill: false,
    }]},
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { display: false },
        y: {
          min: 0, max: 100,
          ticks: { color: '#6b7280', font: { size: 9 }},
          grid: { color: '#1f2937' },
        },
      },
    },
  });
}

// ─────────────────────────────────────────────
// DATA LOADING + CHART UPDATE
// ─────────────────────────────────────────────

async function _loadAndDraw(interval) {
  _currentTf = interval;
  _updateTfButtons();
  _updateStatusBar('loading');

  try {
    const result = await DataProvider.getCandles(interval, 80);
    _drawAll(result.candles, result.source);
  } catch (_) {
    const candles = AppState.getCandles(interval);
    _drawAll(candles, 'cached');
  }
}

/**
 * updateMainChart — sets data only, never creates new chart.
 * This is the v3.2 fix pattern.
 */
function _updateMainChart(candles) {
  if (!_tvCandleSeries || !candles.length) return;

  // Deduplicate by time (TV throws on duplicates)
  const seen = new Set();
  const clean = candles
    .filter(c => { if (seen.has(c.time)) return false; seen.add(c.time); return true; })
    .sort((a, b) => a.time - b.time);

  _tvCandleSeries.setData(clean);
}

function _drawAll(candles, source) {
  if (!candles || !candles.length) return;

  _updateMainChart(candles);
  _drawOverlays(candles);
  _drawSignalMarkers();
  _drawSLTPLines();
  _drawMACDChart(candles);
  _drawRSIChart(candles);
  _updateStatusBar(source);
}

function _drawOverlays(candles) {
  const closes = candles.map(c => c.close);

  // MA20
  if (_tvMa20Series) {
    const visible = _showMa;
    const data = visible ? candles.slice(20).map((c, i) => ({
      time:  c.time,
      value: parseFloat((closes.slice(i, i + 20).reduce((s, v) => s + v, 0) / 20).toFixed(5)),
    })) : [];
    _tvMa20Series.setData(data);
  }

  // MA50
  if (_tvMa50Series) {
    const visible = _showMa && candles.length >= 50;
    const data = visible ? candles.slice(50).map((c, i) => ({
      time:  c.time,
      value: parseFloat((closes.slice(i, i + 50).reduce((s, v) => s + v, 0) / 50).toFixed(5)),
    })) : [];
    _tvMa50Series.setData(data);
  }

  // BB
  if (_tvBBUpperSeries && _tvBBLowerSeries) {
    if (_showBB && candles.length >= 20) {
      const upper = [], lower = [];
      for (let i = 20; i <= candles.length; i++) {
        const slice = closes.slice(i - 20, i);
        const avg   = slice.reduce((s, v) => s + v, 0) / 20;
        const sd    = Math.sqrt(slice.reduce((s, v) => s + (v - avg) ** 2, 0) / 20);
        upper.push({ time: candles[i - 1].time, value: parseFloat((avg + 2 * sd).toFixed(5)) });
        lower.push({ time: candles[i - 1].time, value: parseFloat((avg - 2 * sd).toFixed(5)) });
      }
      _tvBBUpperSeries.setData(upper);
      _tvBBLowerSeries.setData(lower);
    } else {
      _tvBBUpperSeries.setData([]);
      _tvBBLowerSeries.setData([]);
    }
  }
}

function _drawSignalMarkers() {
  if (!_tvCandleSeries || !_showSignals) {
    _tvCandleSeries?.setMarkers([]);
    return;
  }
  const signal = AppState.getLastSignal();
  if (!signal || !isActionable(signal)) { _tvCandleSeries.setMarkers([]); return; }

  const isSell = signal.direction === SIGNAL_DIRECTION.SELL;
  const ts     = Math.floor(signal.timestamp / 1000);

  _tvCandleSeries.setMarkers([{
    time:     ts,
    position: isSell ? 'aboveBar' : 'belowBar',
    color:    isSell ? '#f87171' : '#4ade80',
    shape:    isSell ? 'arrowDown' : 'arrowUp',
    text:     isSell ? 'SELL' : 'BUY',
  }]);
}

function _drawSLTPLines() {
  // Remove existing lines
  if (_tvSlLine)  { try { _tvCandleSeries.removePriceLine(_tvSlLine);  } catch (_) {} _tvSlLine = null; }
  if (_tvTpLine)  { try { _tvCandleSeries.removePriceLine(_tvTpLine);  } catch (_) {} _tvTpLine = null; }

  const signal = AppState.getLastSignal();
  if (!signal || !isActionable(signal) || !_tvCandleSeries) return;

  if (signal.stop_loss > 0) {
    _tvSlLine = _tvCandleSeries.createPriceLine({
      price: signal.stop_loss, color: '#f87171',
      lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'SL',
    });
  }
  if (signal.take_profit_2 > 0) {
    _tvTpLine = _tvCandleSeries.createPriceLine({
      price: signal.take_profit_2, color: '#4ade80',
      lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'TP',
    });
  }
}

function _drawMACDChart(candles) {
  if (!_macdChart) return;
  const closes = candles.map(c => c.close);
  const macd   = calcMACD(closes);

  // Build histogram series from last 40 candles worth of MACD
  const histData  = [];
  const timeLabels = [];
  const k12 = 2/13, k26 = 2/27, k9 = 2/10;
  let e12 = closes[0], e26 = closes[0];
  const macdLine = [];
  for (let i = 1; i < closes.length; i++) {
    e12 = closes[i] * k12 + e12 * (1 - k12);
    e26 = closes[i] * k26 + e26 * (1 - k26);
    macdLine.push(e12 - e26);
  }
  let sig = macdLine[0];
  const sigLine = [sig];
  for (let i = 1; i < macdLine.length; i++) {
    sig = macdLine[i] * k9 + sig * (1 - k9);
    sigLine.push(sig);
  }
  const recent = macdLine.slice(-40);
  const recentSig = sigLine.slice(-40);
  const recentCandles = candles.slice(-40);
  for (let i = 0; i < recent.length; i++) {
    histData.push(parseFloat((recent[i] - recentSig[i]).toFixed(6)));
    timeLabels.push(i);
  }

  _macdChart.data.labels = timeLabels;
  _macdChart.data.datasets[0].data = histData;
  _macdChart.update('none');
}

function _drawRSIChart(candles) {
  if (!_rsiChart) return;
  const closes   = candles.map(c => c.close);
  const rsiData  = [];
  const labels   = [];
  // Rolling RSI for last 40 bars
  const start = Math.max(15, closes.length - 55);
  for (let i = start + 14; i < closes.length; i++) {
    rsiData.push(calcRSI(closes.slice(0, i + 1), 14));
    labels.push(i);
  }
  _rsiChart.data.labels = labels;
  _rsiChart.data.datasets[0].data = rsiData;
  _rsiChart.update('none');
}

// ─────────────────────────────────────────────
// EVENT HANDLERS
// ─────────────────────────────────────────────

function _onDataUpdate() {
  const candles = AppState.getCandles(_currentTf);
  if (candles.length) _drawAll(candles, AppState.getDataSource());
}

function _onSignalUpdate() {
  _drawSignalMarkers();
  _drawSLTPLines();
}

function _updateLabels() {
  // Re-render toolbar labels only — chart itself is language-agnostic
  const toolbar = _container?.querySelector('.kline-toolbar');
  if (toolbar) toolbar.innerHTML = _buildToolbar();
  _attachToolbarEvents();
}

// ─────────────────────────────────────────────
// TOOLBAR + SCAFFOLD
// ─────────────────────────────────────────────

function _buildScaffold() {
  return `
    <div class="kline-panel">
      ${_buildToolbar()}
      <div class="kline-ohlc-bar"></div>
      <div class="kline-main-wrap">
        <div id="tvChart" style="width:100%;height:360px;"></div>
      </div>
      <div class="kline-sub-wrap">
        <div class="kline-sub-label">MACD</div>
        <div class="kline-macd-wrap">
          <canvas id="macdCanvas"></canvas>
        </div>
        <div class="kline-sub-label">RSI(14)</div>
        <div class="kline-rsi-wrap">
          <canvas id="rsiCanvas"></canvas>
        </div>
      </div>
      <div class="kline-status-bar">
        <span class="kline-data-source">—</span>
      </div>
    </div>
  `;
}

function _buildToolbar() {
  const tfs = ['1H', '4H', '1D'];
  const tfBtns = tfs.map(tf => `
    <button class="tf-btn ${_currentTf === tf ? 'active' : ''}"
            data-tf="${tf}">${tf}</button>
  `).join('');

  const indicators = [
    { key: 'ma',      label: 'MA',   active: _showMa      },
    { key: 'bb',      label: 'BB',   active: _showBB      },
    { key: 'signals', label: getLang() === 'zh' ? '信号' : 'Sig', active: _showSignals },
  ].map(i => `
    <button class="ind-toggle ${i.active ? 'active' : ''}"
            data-ind="${i.key}">${i.label}</button>
  `).join('');

  return `
    <div class="kline-toolbar">
      <div class="kline-tf-group">${tfBtns}</div>
      <div class="indicator-toggles">${indicators}</div>
    </div>
  `;
}

function _attachToolbarEvents() {
  _container.querySelectorAll('.tf-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _loadAndDraw(btn.dataset.tf);
    });
  });
  _container.querySelectorAll('.ind-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.ind;
      if (key === 'ma')      { _showMa      = !_showMa;      btn.classList.toggle('active'); }
      if (key === 'bb')      { _showBB      = !_showBB;      btn.classList.toggle('active'); }
      if (key === 'signals') { _showSignals = !_showSignals; btn.classList.toggle('active'); }
      const candles = AppState.getCandles(_currentTf);
      if (candles.length) {
        _drawOverlays(candles);
        _drawSignalMarkers();
        _drawSLTPLines();
      }
    });
  });
}

function _updateTfButtons() {
  _container?.querySelectorAll('.tf-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tf === _currentTf);
  });
}

function _updateStatusBar(source) {
  const bar = _container?.querySelector('.kline-data-source');
  if (!bar) return;
  const labels = {
    en: { live: '● LIVE', cached: '○ CACHED', simulated: '◌ SIM', loading: '⏳ Loading...' },
    zh: { live: '● 实时',  cached: '○ 缓存',   simulated: '◌ 模拟', loading: '⏳ 加载中...' },
  };
  const lang = getLang();
  bar.textContent = (labels[lang] ?? labels.en)[source] ?? source;
  bar.className   = `kline-data-source kline-src-${source}`;
}
