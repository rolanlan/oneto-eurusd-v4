/**
 * ONETO EUR/USD AI Tool — SignalEngine
 * ======================================
 * The central decision pipeline.
 * Orchestrates the full signal generation cycle:
 *
 *   DataProvider → MarketSnapshot → CommitteeEngine
 *   → Decision (8-state) → RiskManager → Signal record
 *
 * 8-state output:
 *   STRONG_BUY / BUY / WEAK_BUY / NEUTRAL /
 *   WEAK_SELL / SELL / STRONG_SELL / NO_TRADE
 *
 * MTF gate runs first — NOT_ALIGNED → immediate NO_TRADE.
 *
 * Architecture Freeze V4.0-R1 | Phase 1
 */

'use strict';

import {
  createSignal,
  createNoTradeSignal,
  computePriceLevels,
  validateSignal,
  SIGNAL_STRENGTH,
  SIGNAL_DIRECTION,
  DEFAULT_PIPS,
} from '../types/Signal.js';

import {
  aggregateVotes,
  countAgentsAgreeing,
  VOTE_DIRECTION,
  AGENT,
} from '../types/Vote.js';

import * as CommitteeEngine      from './CommitteeEngine.js';
import * as RiskManager          from './RiskManager.js';
import * as MarketSnapshotEngine from './MarketSnapshotEngine.js';
import * as DataProvider         from './DataProvider.js';

// ─────────────────────────────────────────────
// MTF ENGINE (inline — Phase 2 extracts to MTFEngine.js)
// Full MTFEngine.js is a Phase 2 deliverable.
// This stub satisfies the gate contract for Phase 1.
// ─────────────────────────────────────────────

function _runMTF(candles4h, candles1d, candles1h) {
  // Minimal MTF stub: derive 4H bias from MA alignment
  const closes = candles4h.map(c => c.close);
  if (closes.length < 20) {
    return {
      mtf_score: 0, mtf_state: 'partially_aligned',
      bias_1d: 0, bias_4h: 0, bias_1h: 0,
      direction: 'NEUTRAL', confidence_adj: 0,
      gate_pass: true,
      description_en: 'Insufficient data — partial alignment assumed',
      description_zh: '数据不足 — 假定部分对齐',
    };
  }

  const ma20 = _smaN(closes, 20);
  const ma50 = _smaN(closes, Math.min(50, closes.length));
  const last  = closes[closes.length - 1];

  // 4H bias
  let bias4h = 0;
  if (last < ma20 && ma20 < ma50) bias4h = -55;
  else if (last < ma20)           bias4h = -25;
  else if (last > ma20 && ma20 > ma50) bias4h = 55;
  else if (last > ma20)           bias4h = 25;

  // 1D bias (from 1D candles if available, else mirror 4H with dampening)
  let bias1d = 0;
  if (candles1d.length >= 20) {
    const c1d   = candles1d.map(c => c.close);
    const m1d20 = _smaN(c1d, 20);
    const m1d50 = _smaN(c1d, Math.min(50, c1d.length));
    const l1d   = c1d[c1d.length - 1];
    if (l1d < m1d20 && m1d20 < m1d50) bias1d = -60;
    else if (l1d < m1d20)             bias1d = -28;
    else if (l1d > m1d20 && m1d20 > m1d50) bias1d = 60;
    else if (l1d > m1d20)             bias1d = 28;
  } else {
    bias1d = bias4h * 0.8;
  }

  // 1H bias
  let bias1h = 0;
  if (candles1h.length >= 10) {
    const c1h   = candles1h.map(c => c.close);
    const m1h20 = _smaN(c1h, Math.min(20, c1h.length));
    const l1h   = c1h[c1h.length - 1];
    bias1h = l1h < m1h20 ? -20 : l1h > m1h20 ? 20 : 0;
  } else {
    bias1h = bias4h * 0.4;
  }

  const mtf_score = bias1d * 0.50 + bias4h * 0.35 + bias1h * 0.15;
  const direction = mtf_score < -20 ? 'BEARISH' : mtf_score > 20 ? 'BULLISH' : 'NEUTRAL';

  let mtf_state, confidence_adj;
  const allSameDir = (bias1d < 0 && bias4h < 0 && bias1h < 0) ||
                     (bias1d > 0 && bias4h > 0 && bias1h > 0);
  const d1d4hSame  = (bias1d < 0 && bias4h < 0) || (bias1d > 0 && bias4h > 0);

  if (allSameDir && Math.abs(bias1d) > 30) {
    mtf_state = 'fully_aligned'; confidence_adj = 10;
  } else if (d1d4hSame) {
    mtf_state = 'partially_aligned'; confidence_adj = 5;
  } else if ((bias1d > 0 && bias4h < 0) || (bias1d < 0 && bias4h > 0)) {
    mtf_state = 'primary_only'; confidence_adj = -15;
  } else if (Math.abs(mtf_score) <= 20) {
    mtf_state = 'not_aligned'; confidence_adj = 0;
  } else {
    mtf_state = 'partially_aligned'; confidence_adj = 5;
  }

  const gate_pass = mtf_state !== 'not_aligned';

  const dirLabel  = direction === 'BEARISH' ? '偏空' : direction === 'BULLISH' ? '偏多' : '中性';
  const stateLabel = {
    fully_aligned: '三周期完全对齐', partially_aligned: '双周期对齐',
    primary_only: '逆势信号', not_aligned: '周期冲突',
  }[mtf_state] ?? mtf_state;

  return {
    mtf_score:    parseFloat(mtf_score.toFixed(2)),
    mtf_state,
    bias_1d:      parseFloat(bias1d.toFixed(2)),
    bias_4h:      parseFloat(bias4h.toFixed(2)),
    bias_1h:      parseFloat(bias1h.toFixed(2)),
    direction,
    confidence_adj,
    gate_pass,
    description_en: `MTF ${direction} (${mtf_state.replace('_',' ')}) · 1D:${bias1d.toFixed(0)} 4H:${bias4h.toFixed(0)} 1H:${bias1h.toFixed(0)}`,
    description_zh: `${dirLabel} · ${stateLabel} · 1D:${bias1d.toFixed(0)} 4H:${bias4h.toFixed(0)} 1H:${bias1h.toFixed(0)}`,
  };
}

// ─────────────────────────────────────────────
// REGIME ENGINE (inline stub — Phase 2 extracts to RegimeEngine.js)
// ─────────────────────────────────────────────

function _detectRegime(candles, ind) {
  if (!candles || candles.length < 20) return 'ranging';

  const atrRatio = ind.atr_ratio ?? 1.0;
  const adx      = ind.adx_14   ?? 0;
  const bbPct    = ind.bb_width_pct ?? 50;
  const price    = ind.price ?? candles[candles.length - 1].close;
  const ma20     = ind.ma20  ?? 0;
  const ma50     = ind.ma50  ?? 0;

  // Priority 1: volatile
  if (atrRatio > 1.8) return 'volatile';

  // Priority 2: trending
  if (adx > 25 && price < ma20 && ma20 < ma50 && bbPct > 50) return 'trending_bear';
  if (adx > 25 && price > ma20 && ma20 > ma50 && bbPct > 50) return 'trending_bull';

  // Priority 3: breakout
  if (ind.bb && price < ind.bb.lower && adx > 20) return 'breakout_down';
  if (ind.bb && price > ind.bb.upper && adx > 20) return 'breakout_up';

  // Default: ranging
  return 'ranging';
}

// ─────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────

/**
 * Runs the complete signal generation pipeline.
 * Returns a fully-formed Signal record.
 * Never throws.
 *
 * @param {SignalEngineParams} params
 * @returns {Promise<SignalEngineResult>}
 */
export async function run(params = {}) {
  try {
    return await _run(params);
  } catch (err) {
    console.error('[SignalEngine] Unexpected pipeline error:', err.message);
    return _emergencyNoTrade(err.message);
  }
}

/**
 * Runs a synchronous decision cycle using pre-loaded candles.
 * Used when candles are already available (no async fetch needed).
 *
 * @param {SignalEngineSyncParams} params
 * @returns {SignalEngineResult}
 */
export function runSync(params = {}) {
  try {
    return _runSync(params);
  } catch (err) {
    console.error('[SignalEngine] Sync error:', err.message);
    return _emergencyNoTrade(err.message);
  }
}

// ─────────────────────────────────────────────
// ASYNC PIPELINE
// ─────────────────────────────────────────────

async function _run(params) {
  const {
    accountProfile,
    memoryLayer  = {},
    weights      = null,
    forceRefresh = false,
  } = params;

  // ── Step A: Fetch market data ──
  const [priceResult, candles4hResult, candles1dResult, candles1hResult] = await Promise.all([
    DataProvider.getPrice(),
    DataProvider.getCandles('4H', 80),
    DataProvider.getCandles('1D', 60),
    DataProvider.getCandles('1H', 80),
  ]);

  return _runSync({
    candles4h:     candles4hResult.candles,
    candles1d:     candles1dResult.candles,
    candles1h:     candles1hResult.candles,
    currentPrice:  priceResult.price,
    dataSource:    priceResult.source,
    accountProfile,
    memoryLayer,
    weights,
  });
}

// ─────────────────────────────────────────────
// SYNCHRONOUS PIPELINE
// ─────────────────────────────────────────────

function _runSync(params) {
  const {
    candles4h      = [],
    candles1d      = [],
    candles1h      = [],
    currentPrice   = 0,
    dataSource     = 'simulated',
    accountProfile = _defaultProfile(),
    memoryLayer    = {},
    weights        = null,
  } = params;

  // ── Step 1: Compute indicators ──
  const ind = MarketSnapshotEngine.computeIndicators(candles4h);
  if (currentPrice > 0) ind.price = currentPrice;
  else if (candles4h.length > 0) ind.price = candles4h[candles4h.length - 1].close;

  // ── Step 2: Detect regime ──
  const regime = _detectRegime(candles4h, ind);

  // ── Step 3: MTF alignment gate ──
  const mtfResult = _runMTF(candles4h, candles1d, candles1h);

  if (!mtfResult.gate_pass) {
    const snap = MarketSnapshotEngine.captureAndSave({
      indicatorResult: ind, regime, mtfResult, votes: [],
      price: ind.price, data_source: dataSource,
    });
    const signal = createNoTradeSignal('MTF_NOT_ALIGNED', {
      market_regime: regime, mtf_state: mtfResult.mtf_state,
      mtf_confidence_adj: 0, snapshot_id: snap.snap.id,
      entry_price: ind.price,
    });
    return { signal, votes: [], verdict: null, mtfResult, regime, snapshot: snap.snap };
  }

  // ── Step 4: Run AI Committee ──
  const committeeOutput = CommitteeEngine.run({
    candles:   candles4h,
    candles_1d: candles1d,
    candles_1h: candles1h,
    regime,
    weights,
    memoryLayer,
    mtfResult,
    indicatorResult: ind,
  });

  const { votes, verdict } = committeeOutput;

  // ── Step 5: Decision Engine (8-state mapping) ──
  const decisionResult = _decide(votes, verdict, mtfResult, regime, accountProfile, ind);

  if (decisionResult.signal_strength === SIGNAL_STRENGTH.NO_TRADE) {
    const snap = MarketSnapshotEngine.captureAndSave({
      indicatorResult: ind, regime, mtfResult, votes,
      price: ind.price, data_source: dataSource,
    });
    const signal = createNoTradeSignal(decisionResult.no_trade_reason, {
      market_regime: regime, mtf_state: mtfResult.mtf_state,
      snapshot_id: snap.snap.id, entry_price: ind.price,
      ...decisionResult,
    });
    return { signal, votes, verdict, mtfResult, regime, snapshot: snap.snap };
  }

  // ── Step 6: Compute price levels ──
  const priceLevels = computePriceLevels(
    ind.price,
    decisionResult.direction,
    DEFAULT_PIPS.SL,
    DEFAULT_PIPS.TP1,
    DEFAULT_PIPS.TP2,
  );

  // ── Step 7: Risk Manager ──
  const riskVote    = votes.find(v => v.agent === AGENT.RISK);
  const riskScore   = riskVote?.score ?? 50;
  const riskResult  = RiskManager.calc({
    account_balance:    accountProfile.account_balance,
    risk_profile:       accountProfile.risk_profile,
    sl_pips:            priceLevels.sl_pips,
    tp_pips:            priceLevels.tp2_pips,
    regime,
    risk_score:         riskScore,
    consecutive_losses: accountProfile.consecutive_losses ?? 0,
    win_rate_20:        accountProfile.win_rate_20        ?? 0.5,
  });

  // System halt check
  const haltCheck = RiskManager.checkSystemHalt(accountProfile);
  if (haltCheck.halt) {
    const snap = MarketSnapshotEngine.captureAndSave({
      indicatorResult: ind, regime, mtfResult, votes,
      price: ind.price, data_source: dataSource,
    });
    const signal = createNoTradeSignal('DRAWDOWN_HALT', {
      market_regime: regime, entry_price: ind.price,
      snapshot_id: snap.snap.id,
    });
    return { signal, votes, verdict, mtfResult, regime, snapshot: snap.snap };
  }

  // ── Step 8: Build explanation ──
  const explanation = _buildExplanation(votes, regime, mtfResult);

  // ── Step 9: Assemble final Signal ──
  const signal = createSignal({
    signal_strength:  decisionResult.signal_strength,
    direction:        decisionResult.direction,
    final_score:      decisionResult.final_score,
    final_confidence: decisionResult.final_confidence,
    technical_score:  votes.find(v => v.agent === AGENT.TECHNICAL)?.score   ?? 50,
    macro_score:      votes.find(v => v.agent === AGENT.MACRO)?.score        ?? 50,
    positioning_score:votes.find(v => v.agent === AGENT.POSITIONING)?.score  ?? 50,
    news_score:       votes.find(v => v.agent === AGENT.NEWS)?.score         ?? 50,
    risk_score:       riskScore,
    agents_agreeing:  decisionResult.agents_agreeing,
    ...priceLevels,
    lot_size:          riskResult.lot_size,
    max_loss_usd:      riskResult.max_loss_usd,
    expected_profit:   riskResult.expected_profit_usd,
    effective_risk_pct: riskResult.effective_risk_pct,
    timeframe:   '4H',
    market_regime: regime,
    mtf_state:     mtfResult.mtf_state,
    mtf_confidence_adj: mtfResult.confidence_adj,
    explanation,
    gates: decisionResult.gates,
  });

  // ── Step 10: Capture snapshot ──
  const { snap } = MarketSnapshotEngine.captureAndSave({
    indicatorResult: ind,
    regime,
    mtfResult,
    votes,
    price: ind.price,
    signal_id: signal.id,
    data_source: dataSource,
  });

  return {
    signal,
    votes,
    verdict,
    mtfResult,
    regime,
    riskResult,
    snapshot: snap,
  };
}

// ─────────────────────────────────────────────
// DECISION ENGINE — 8-STATE MAPPING
// ─────────────────────────────────────────────

function _decide(votes, verdict, mtfResult, regime, profile, ind) {
  const min_confidence = profile.min_confidence     ?? 65;
  const min_rr         = profile.min_rr_ratio       ?? 2.0;
  const min_agents     = 3;

  // Directional score: weighted average of directional agents (excl. Risk)
  const effectiveWeights = CommitteeEngine._resolveWeights?.(regime, null) ??
    { technical: 0.30, macro: 0.20, positioning: 0.20, news: 0.15, risk: 0.15 };
  const wSum = 1 - (effectiveWeights.risk ?? 0.15);

  let dirScore = 0;
  for (const v of votes) {
    if (v.agent !== AGENT.RISK) {
      dirScore += v.score * (v.weight / wSum);
    }
  }
  dirScore = Math.round(dirScore);

  // Confidence with adjustments
  const baseConf  = Math.abs(dirScore - 50) * 2;
  const riskVote  = votes.find(v => v.agent === AGENT.RISK);
  const riskScore = riskVote?.score ?? 50;
  const riskPenalty = Math.max(0, (riskScore - 55) * 0.3);
  const confAdj   = mtfResult.confidence_adj ?? 0;
  const finalConf = Math.max(0, Math.min(100, Math.round(baseConf - riskPenalty + confAdj)));

  // Direction
  const direction = dirScore > 55
    ? SIGNAL_DIRECTION.SELL
    : dirScore < 45
      ? SIGNAL_DIRECTION.BUY
      : SIGNAL_DIRECTION.NEUTRAL;

  // Agent agreement
  const agentsAgreeing = countAgentsAgreeing(votes, direction);

  // RR ratio
  const rrRatio = DEFAULT_PIPS.TP2 / DEFAULT_PIPS.SL;

  // ── Gate checks ──
  const gates = {
    mtf_pass:             mtfResult.gate_pass,
    confidence_pass:      finalConf >= min_confidence,
    rr_pass:              rrRatio   >= min_rr,
    agent_agreement_pass: agentsAgreeing >= min_agents,
    drawdown_pass:        true,
    regime_pass:          !(regime === 'volatile' && riskScore > 80),
  };

  // Any gate failure → NO_TRADE
  const failedGate = Object.entries(gates).find(([, v]) => !v);
  if (failedGate) {
    const reasonMap = {
      mtf_pass:             'MTF_NOT_ALIGNED',
      confidence_pass:      'LOW_CONFIDENCE',
      rr_pass:              'RR_TOO_LOW',
      agent_agreement_pass: 'AGENT_DISAGREEMENT',
      drawdown_pass:        'DRAWDOWN_HALT',
      regime_pass:          'VOLATILE_REGIME_BLOCKED',
    };
    return {
      signal_strength: SIGNAL_STRENGTH.NO_TRADE,
      direction:       SIGNAL_DIRECTION.NEUTRAL,
      final_score:     dirScore,
      final_confidence: finalConf,
      agents_agreeing: agentsAgreeing,
      no_trade_reason: reasonMap[failedGate[0]],
      gates,
    };
  }

  // ── 8-state mapping ──
  const strength = _mapToStrength(dirScore, finalConf, agentsAgreeing, direction);

  return {
    signal_strength:  strength,
    direction,
    final_score:      dirScore,
    final_confidence: finalConf,
    agents_agreeing:  agentsAgreeing,
    no_trade_reason:  null,
    gates,
  };
}

function _mapToStrength(score, conf, agents, direction) {
  if (direction === SIGNAL_DIRECTION.NEUTRAL) return SIGNAL_STRENGTH.NEUTRAL;

  const isSell = direction === SIGNAL_DIRECTION.SELL;
  const signalScore = isSell ? score : 100 - score;  // normalize to "strength" regardless of direction

  if (signalScore > 75 && conf >= 75 && agents >= 4) {
    return isSell ? SIGNAL_STRENGTH.STRONG_SELL : SIGNAL_STRENGTH.STRONG_BUY;
  }
  if (signalScore > 65 && conf >= 65 && agents >= 3) {
    return isSell ? SIGNAL_STRENGTH.SELL : SIGNAL_STRENGTH.BUY;
  }
  if (signalScore > 58 && conf >= 55 && agents >= 3) {
    return isSell ? SIGNAL_STRENGTH.WEAK_SELL : SIGNAL_STRENGTH.WEAK_BUY;
  }
  return SIGNAL_STRENGTH.NEUTRAL;
}

// ─────────────────────────────────────────────
// EXPLANATION BUILDER
// ─────────────────────────────────────────────

function _buildExplanation(votes, regime, mtfResult) {
  const items = [];

  const technical   = votes.find(v => v.agent === AGENT.TECHNICAL);
  const macro       = votes.find(v => v.agent === AGENT.MACRO);
  const positioning = votes.find(v => v.agent === AGENT.POSITIONING);
  const news        = votes.find(v => v.agent === AGENT.NEWS);
  const risk        = votes.find(v => v.agent === AGENT.RISK);

  if (technical) {
    items.push({
      category: 'technical',
      color:    technical.vote === 'SELL' ? 'var(--red)' : technical.vote === 'BUY' ? 'var(--green)' : 'var(--text3)',
      text_en:  technical.reason_1 || 'Technical indicators assessed',
      text_zh:  _translateReason(technical.reason_1, 'technical'),
    });
  }
  if (macro) {
    items.push({
      category: 'macro',
      color:    macro.vote === 'SELL' ? 'var(--red)' : macro.vote === 'BUY' ? 'var(--green)' : 'var(--amber)',
      text_en:  macro.reason_1 || 'Macro conditions assessed',
      text_zh:  _translateReason(macro.reason_1, 'macro'),
    });
  }
  if (news) {
    items.push({
      category: 'news',
      color:    news.vote === 'SELL' ? 'var(--red)' : news.vote === 'BUY' ? 'var(--green)' : 'var(--text3)',
      text_en:  news.reason_1 || 'News sentiment assessed',
      text_zh:  _translateReason(news.reason_1, 'news'),
    });
  }
  if (risk) {
    items.push({
      category: 'risk',
      color:    risk.score > 70 ? 'var(--red)' : risk.score < 40 ? 'var(--green)' : 'var(--amber)',
      text_en:  risk.reason_1 || 'Risk conditions assessed',
      text_zh:  _translateReason(risk.reason_1, 'risk'),
    });
  }

  // MTF context
  items.push({
    category: 'mtf',
    color:    mtfResult.mtf_state === 'fully_aligned' ? 'var(--green)' : 'var(--purple)',
    text_en:  mtfResult.description_en,
    text_zh:  mtfResult.description_zh,
  });

  return items;
}

/**
 * Simple reason translation for Phase 1.
 * Phase 6 replaces this with Claude API translations.
 *
 * @param {string} reason_en
 * @param {string} category
 * @returns {string}
 */
function _translateReason(reason_en, category) {
  if (!reason_en) return '';

  const patterns = [
    [/bearish/gi,    '偏空'],
    [/bullish/gi,    '偏多'],
    [/neutral/gi,    '中性'],
    [/hawkish/gi,    '鹰派'],
    [/dovish/gi,     '鸽派'],
    [/rising/gi,     '上升'],
    [/falling/gi,    '下降'],
    [/spread/gi,     '利差'],
    [/momentum/gi,   '动能'],
    [/overbought/gi, '超买'],
    [/oversold/gi,   '超卖'],
    [/alignment/gi,  '对齐'],
    [/trend/gi,      '趋势'],
    [/volatile/gi,   '波动'],
    [/ranging/gi,    '震荡'],
  ];

  let result = reason_en;
  for (const [pattern, replacement] of patterns) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function _smaN(data, n) {
  if (!data.length || n <= 0) return 0;
  const slice = data.slice(-n);
  return slice.reduce((s, v) => s + v, 0) / slice.length;
}

function _defaultProfile() {
  return {
    account_balance:       1000,
    risk_profile:          'standard',
    min_confidence:        65,
    min_rr_ratio:          2.0,
    max_drawdown_limit:    0.10,
    max_consecutive_losses: 5,
    consecutive_losses:    0,
    current_drawdown:      0,
    daily_risk_used:       0,
    win_rate_20:           0.5,
  };
}

function _emergencyNoTrade(errorMsg) {
  return {
    signal:   createNoTradeSignal('SYSTEM_ERROR', { no_trade_reason: errorMsg }),
    votes:    [],
    verdict:  null,
    mtfResult: { gate_pass: false, mtf_state: 'not_aligned' },
    regime:   'unknown',
    snapshot: null,
    error:    errorMsg,
  };
}

// ─────────────────────────────────────────────
// JSDoc typedefs
// ─────────────────────────────────────────────

/**
 * @typedef {Object} SignalEngineParams
 * @property {AccountProfile} [accountProfile]
 * @property {object}         [memoryLayer]
 * @property {WeightConfig}   [weights]
 * @property {boolean}        [forceRefresh]
 */

/**
 * @typedef {Object} SignalEngineSyncParams
 * @property {Candle[]}       candles4h
 * @property {Candle[]}       [candles1d]
 * @property {Candle[]}       [candles1h]
 * @property {number}         currentPrice
 * @property {string}         [dataSource]
 * @property {AccountProfile} [accountProfile]
 * @property {object}         [memoryLayer]
 * @property {WeightConfig}   [weights]
 */

/**
 * @typedef {Object} SignalEngineResult
 * @property {Signal}           signal
 * @property {Vote[]}           votes
 * @property {CommitteeVerdict|null} verdict
 * @property {object}           mtfResult
 * @property {string}           regime
 * @property {RiskResult}       [riskResult]
 * @property {MarketSnapshot}   [snapshot]
 * @property {string}           [error]
 */