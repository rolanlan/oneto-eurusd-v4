/**
 * ONETO EUR/USD AI Tool — SignalEngine
 * ======================================
 * The central decision pipeline.
 * Orchestrates the full signal generation cycle:
 *
 *   DataProvider → MarketSnapshot → CommitteeOrchestrator
 *   → Decision (8-state) → RiskManager → Signal record
 *
 * 8-state output:
 *   STRONG_BUY / BUY / WEAK_BUY / NEUTRAL /
 *   WEAK_SELL / SELL / STRONG_SELL / NO_TRADE
 *
 * MTF gate is run inside CommitteeOrchestrator.
 * NOT_ALIGNED → immediate NO_TRADE.
 *
 * FIXES (Phase 5B-1):
 *   BUG-03: Replaced CommitteeEngine (Phase 1 inline monolith) with
 *           CommitteeOrchestrator (Phase 4A standalone agents).
 *           CommitteeOrchestrator internally runs RegimeEngine + MTFEngine
 *           + all 5 independent agent files.
 *
 *   BUG-04: Replaced CommitteeEngine._resolveWeights?.(regime, null)
 *           (private function, always undefined) with
 *           REGIME_WEIGHTS[regime] ?? DEFAULT_WEIGHTS
 *           imported directly from Vote.js — the single source of truth.
 *
 * Architecture Freeze V4.0-R1 | Phase 5B-1
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
  REGIME_WEIGHTS,
  DEFAULT_WEIGHTS,
} from '../types/Vote.js';

// BUG-03 FIX: Use CommitteeOrchestrator (standalone agents) instead of CommitteeEngine (inline monolith)
import * as CommitteeOrchestrator from '../agents/CommitteeOrchestrator.js';
import * as RiskManager           from './RiskManager.js';
import * as MarketSnapshotEngine  from './MarketSnapshotEngine.js';
import * as DataProvider          from './DataProvider.js';

// ─────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────

/**
 * Runs the complete signal generation pipeline.
 * Returns a fully-formed SignalEngineResult.
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

  // ── Step 1: Compute indicators (for snapshot + downstream use) ──
  const ind = MarketSnapshotEngine.computeIndicators(candles4h);
  if (currentPrice > 0) ind.price = currentPrice;
  else if (candles4h.length > 0) ind.price = candles4h[candles4h.length - 1].close;

  // ── Step 2: Run CommitteeOrchestrator ──
  // BUG-03 FIX: CommitteeOrchestrator internally runs:
  //   RegimeEngine.run() → classifies market regime
  //   MTFEngine.run()    → multi-timeframe alignment gate
  //   All 5 agent files  → TechnicalAnalyst, MacroAnalyst, PositioningAnalyst,
  //                        NewsAnalyst, RiskAnalyst
  // It returns committeeOutput containing: votes, verdict, mtf_result, regime,
  // weights (regime-adjusted), regime_result
  const committeeOutput = CommitteeOrchestrator.run({
    candles:         candles4h,
    candles_1d:      candles1d,
    candles_1h:      candles1h,
    weights,
    memoryLayer,
    indicatorResult: ind,
  });

  const { votes, verdict, mtf_result: mtfResult, regime, weights: effectiveWeights } = committeeOutput;

  // ── Step 3: MTF gate check (gate was run inside CommitteeOrchestrator) ──
  if (!mtfResult.gate_pass) {
    const snap = MarketSnapshotEngine.captureAndSave({
      indicatorResult: ind, regime, mtfResult, votes: [],
      price: ind.price, data_source: dataSource,
    });
    const signal = createNoTradeSignal('MTF_NOT_ALIGNED', {
      market_regime:      regime,
      mtf_state:          mtfResult.mtf_state,
      mtf_confidence_adj: 0,
      snapshot_id:        snap.snap.id,
      entry_price:        ind.price,
    });
    return { signal, votes: [], verdict: null, mtfResult, regime, snapshot: snap.snap };
  }

  // ── Step 4: Decision Engine (8-state mapping) ──
  const decisionResult = _decide(votes, verdict, mtfResult, regime, accountProfile, effectiveWeights);

  if (decisionResult.signal_strength === SIGNAL_STRENGTH.NO_TRADE) {
    const snap = MarketSnapshotEngine.captureAndSave({
      indicatorResult: ind, regime, mtfResult, votes,
      price: ind.price, data_source: dataSource,
    });
    const signal = createNoTradeSignal(decisionResult.no_trade_reason, {
      market_regime: regime,
      mtf_state:     mtfResult.mtf_state,
      snapshot_id:   snap.snap.id,
      entry_price:   ind.price,
      ...decisionResult,
    });
    return { signal, votes, verdict, mtfResult, regime, snapshot: snap.snap };
  }

  // ── Step 5: Compute price levels ──
  const priceLevels = computePriceLevels(
    ind.price,
    decisionResult.direction,
    DEFAULT_PIPS.SL,
    DEFAULT_PIPS.TP1,
    DEFAULT_PIPS.TP2,
  );

  // ── Step 6: Risk Manager ──
  const riskVote   = votes.find(v => v.agent === AGENT.RISK);
  const riskScore  = riskVote?.score ?? 50;
  const riskResult = RiskManager.calc({
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
      market_regime: regime,
      entry_price:   ind.price,
      snapshot_id:   snap.snap.id,
    });
    return { signal, votes, verdict, mtfResult, regime, snapshot: snap.snap };
  }

  // ── Step 7: Build explanation ──
  const explanation = _buildExplanation(votes, regime, mtfResult);

  // ── Step 8: Assemble final Signal ──
  const signal = createSignal({
    signal_strength:    decisionResult.signal_strength,
    direction:          decisionResult.direction,
    final_score:        decisionResult.final_score,
    final_confidence:   decisionResult.final_confidence,
    technical_score:    votes.find(v => v.agent === AGENT.TECHNICAL)?.score    ?? 50,
    macro_score:        votes.find(v => v.agent === AGENT.MACRO)?.score         ?? 50,
    positioning_score:  votes.find(v => v.agent === AGENT.POSITIONING)?.score   ?? 50,
    news_score:         votes.find(v => v.agent === AGENT.NEWS)?.score          ?? 50,
    risk_score:         riskScore,
    agents_agreeing:    decisionResult.agents_agreeing,
    ...priceLevels,
    lot_size:           riskResult.lot_size,
    max_loss_usd:       riskResult.max_loss_usd,
    expected_profit:    riskResult.expected_profit_usd,
    effective_risk_pct: riskResult.effective_risk_pct,
    timeframe:          '4H',
    market_regime:      regime,
    mtf_state:          mtfResult.mtf_state,
    mtf_confidence_adj: mtfResult.confidence_adj ?? 0,
    explanation,
    gates:              decisionResult.gates,
  });

  // ── Step 9: Capture snapshot ──
  const { snap } = MarketSnapshotEngine.captureAndSave({
    indicatorResult: ind,
    regime,
    mtfResult,
    votes,
    price:       ind.price,
    signal_id:   signal.id,
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

/**
 * Maps committee votes to an 8-state signal decision.
 * BUG-04 FIX: Weight resolution now reads directly from Vote.js REGIME_WEIGHTS
 * and DEFAULT_WEIGHTS — the single source of truth. No longer accesses the
 * private CommitteeEngine._resolveWeights function (which was always undefined).
 *
 * @param {Vote[]}          votes
 * @param {CommitteeVerdict} verdict
 * @param {MTFResult}       mtfResult
 * @param {string}          regime
 * @param {AccountProfile}  profile
 * @param {WeightConfig}    orchestratorWeights  - weights already resolved by CommitteeOrchestrator
 * @returns {DecisionSummary}
 */
function _decide(votes, verdict, mtfResult, regime, profile, orchestratorWeights) {
  const min_confidence = profile.min_confidence      ?? 65;
  const min_rr         = profile.min_rr_ratio        ?? 2.0;
  const min_agents     = 3;

  // BUG-04 FIX: Use REGIME_WEIGHTS[regime] ?? DEFAULT_WEIGHTS from Vote.js directly.
  // Priority: CommitteeOrchestrator already resolved the correct weights for this cycle;
  // use those if valid, otherwise fall back through the same hierarchy as Vote.js.
  const resolvedWeights = (orchestratorWeights && _weightsValid(orchestratorWeights))
    ? orchestratorWeights
    : (REGIME_WEIGHTS[regime] ?? DEFAULT_WEIGHTS);

  const riskWeight = resolvedWeights.risk ?? DEFAULT_WEIGHTS.risk;
  const wSum       = 1 - riskWeight;

  // Directional score: weighted average of directional agents (excludes Risk)
  let dirScore = 0;
  for (const v of votes) {
    if (v.agent !== AGENT.RISK) {
      // Use the weight that was actually applied by CommitteeOrchestrator for this agent
      const agentWeight = v.weight ?? (resolvedWeights[v.agent] ?? 0);
      dirScore += v.score * (wSum > 0 ? agentWeight / wSum : 0);
    }
  }
  dirScore = Math.max(0, Math.min(100, Math.round(dirScore)));

  // Confidence with adjustments
  const baseConf    = Math.abs(dirScore - 50) * 2;
  const riskVote    = votes.find(v => v.agent === AGENT.RISK);
  const riskScore   = riskVote?.score ?? 50;
  const riskPenalty = Math.max(0, (riskScore - 55) * 0.3);
  const confAdj     = mtfResult.confidence_adj ?? 0;
  const finalConf   = Math.max(0, Math.min(100, Math.round(baseConf - riskPenalty + confAdj)));

  // Direction
  const direction = dirScore > 55
    ? SIGNAL_DIRECTION.SELL
    : dirScore < 45
      ? SIGNAL_DIRECTION.BUY
      : SIGNAL_DIRECTION.NEUTRAL;

  // Agent agreement
  const agentsAgreeing = countAgentsAgreeing(votes, direction);

  // RR ratio (uses default pips for gate check — actual levels computed in Step 5)
  const rrRatio = DEFAULT_PIPS.TP2 / DEFAULT_PIPS.SL;

  // ── Gate checks ──
  const gates = {
    mtf_pass:             mtfResult.gate_pass !== false,
    confidence_pass:      finalConf   >= min_confidence,
    rr_pass:              rrRatio     >= min_rr,
    agent_agreement_pass: agentsAgreeing >= min_agents,
    drawdown_pass:        !_isDrawdownHalted(profile),
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
      signal_strength:  SIGNAL_STRENGTH.NO_TRADE,
      direction:        SIGNAL_DIRECTION.NEUTRAL,
      final_score:      dirScore,
      final_confidence: finalConf,
      agents_agreeing:  agentsAgreeing,
      no_trade_reason:  reasonMap[failedGate[0]],
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

  const isSell      = direction === SIGNAL_DIRECTION.SELL;
  const signalScore = isSell ? score : 100 - score;

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
      text_zh:  _translateReason(technical.reason_1),
    });
  }
  if (macro) {
    items.push({
      category: 'macro',
      color:    macro.vote === 'SELL' ? 'var(--red)' : macro.vote === 'BUY' ? 'var(--green)' : 'var(--amber)',
      text_en:  macro.reason_1 || 'Macro conditions assessed',
      text_zh:  _translateReason(macro.reason_1),
    });
  }
  if (positioning) {
    items.push({
      category: 'positioning',
      color:    positioning.vote === 'SELL' ? 'var(--red)' : positioning.vote === 'BUY' ? 'var(--green)' : 'var(--text3)',
      text_en:  positioning.reason_1 || 'Institutional positioning assessed',
      text_zh:  _translateReason(positioning.reason_1),
    });
  }
  if (news) {
    items.push({
      category: 'news',
      color:    news.vote === 'SELL' ? 'var(--red)' : news.vote === 'BUY' ? 'var(--green)' : 'var(--text3)',
      text_en:  news.reason_1 || 'News sentiment assessed',
      text_zh:  _translateReason(news.reason_1),
    });
  }
  if (risk) {
    items.push({
      category: 'risk',
      color:    risk.score > 70 ? 'var(--red)' : risk.score < 40 ? 'var(--green)' : 'var(--amber)',
      text_en:  risk.reason_1 || 'Risk conditions assessed',
      text_zh:  _translateReason(risk.reason_1),
    });
  }

  // MTF context
  if (mtfResult) {
    items.push({
      category: 'mtf',
      color:    mtfResult.mtf_state === 'fully_aligned'
        ? 'var(--green)'
        : mtfResult.mtf_state === 'not_aligned'
          ? 'var(--red)'
          : 'var(--purple)',
      text_en:  mtfResult.description_en ?? `MTF ${mtfResult.mtf_state}`,
      text_zh:  mtfResult.description_zh ?? mtfResult.description_en ?? mtfResult.mtf_state,
    });
  }

  return items;
}

/**
 * Lightweight reason translation for Phase 1–5.
 * Phase 6 replaces with Claude API translations.
 * @param {string} reason_en
 * @returns {string}
 */
function _translateReason(reason_en) {
  if (!reason_en) return '';
  const patterns = [
    [/\bstrong buy\b/gi,   '强烈看多'],
    [/\bstrong sell\b/gi,  '强烈看空'],
    [/\bbearish\b/gi,      '偏空'],
    [/\bbullish\b/gi,      '偏多'],
    [/\bneutral\b/gi,      '中性'],
    [/\bhawkish\b/gi,      '鹰派'],
    [/\bdovish\b/gi,       '鸽派'],
    [/\brising\b/gi,       '上升'],
    [/\bfalling\b/gi,      '下降'],
    [/\bspread\b/gi,       '利差'],
    [/\bmomentum\b/gi,     '动能'],
    [/\boverbought\b/gi,   '超买'],
    [/\boversold\b/gi,     '超卖'],
    [/\balignment\b/gi,    '对齐'],
    [/\btrend\b/gi,        '趋势'],
    [/\bvolatile\b/gi,     '波动'],
    [/\branging\b/gi,      '震荡'],
    [/\bbreakout\b/gi,     '突破'],
    [/\bcontrarian\b/gi,   '逆向'],
    [/\bcrowded\b/gi,      '拥挤'],
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

function _weightsValid(w) {
  if (!w || typeof w !== 'object') return false;
  const sum = (w.technical   ?? 0) + (w.macro    ?? 0) + (w.positioning ?? 0)
            + (w.news        ?? 0) + (w.risk     ?? 0);
  return Math.abs(sum - 1.0) < 0.001;
}

function _isDrawdownHalted(profile) {
  if (!profile) return false;
  return (profile.current_drawdown   ?? 0) >= (profile.max_drawdown_limit      ?? 0.10)
      || (profile.consecutive_losses ?? 0) >= (profile.max_consecutive_losses  ?? 5);
}

function _defaultProfile() {
  return {
    account_balance:        1000,
    risk_profile:           'standard',
    min_confidence:         65,
    min_rr_ratio:           2.0,
    max_drawdown_limit:     0.10,
    max_consecutive_losses: 5,
    consecutive_losses:     0,
    current_drawdown:       0,
    daily_risk_used:        0,
    win_rate_20:            0.5,
  };
}

function _emergencyNoTrade(errorMsg) {
  return {
    signal:    createNoTradeSignal('SYSTEM_ERROR', { no_trade_reason: errorMsg }),
    votes:     [],
    verdict:   null,
    mtfResult: { gate_pass: false, mtf_state: 'not_aligned', confidence_adj: 0 },
    regime:    'unknown',
    snapshot:  null,
    error:     errorMsg,
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
 * @property {Signal}              signal
 * @property {Vote[]}              votes
 * @property {CommitteeVerdict|null} verdict
 * @property {MTFResult}           mtfResult
 * @property {string}              regime
 * @property {RiskResult}          [riskResult]
 * @property {MarketSnapshot}      [snapshot]
 * @property {string}              [error]
 */

/**
 * @typedef {Object} DecisionSummary
 * @property {string}  signal_strength
 * @property {string}  direction
 * @property {number}  final_score
 * @property {number}  final_confidence
 * @property {number}  agents_agreeing
 * @property {string|null} no_trade_reason
 * @property {object}  gates
 */
