/**
 * ONETO EUR/USD AI Tool — CommitteeOrchestrator
 * ===============================================
 * Orchestrates the full AI Committee pipeline.
 *
 * Execution order:
 *   1. Run RegimeEngine → classify market environment
 *   2. Resolve effective weights (regime-adjusted from Vote.js)
 *   3. Run MTFEngine → multi-timeframe alignment gate
 *   4. Run all 5 agents with regime-adjusted weights
 *   5. Aggregate votes → verdict
 *   6. Return CommitteeOutput
 *
 * Rules (non-negotiable):
 *   · Exactly 5 votes always returned — never fewer
 *   · Any individual agent failure → neutral fallback vote (not propagated)
 *   · MTF not_aligned does NOT stop the committee — DecisionEngine handles it
 *   · Never throws — all errors caught at per-agent level
 *
 * Relationship to CommitteeEngine.js:
 *   CommitteeEngine is the Phase 1 monolithic implementation (inline agents).
 *   CommitteeOrchestrator is the Phase 4A modular implementation.
 *   CommitteeOrchestrator imports standalone agent files.
 *   CommitteeEngine imports nothing — agents are private functions.
 *   SignalEngine should prefer CommitteeOrchestrator for Phase 4A+.
 *
 * Interface Contract 3 compliant.
 * Architecture Freeze V4.0-R1 | Phase 4A
 */

'use strict';

import * as TechnicalAnalyst    from './TechnicalAnalyst.js';
import * as MacroAnalyst        from './MacroAnalyst.js';
import * as PositioningAnalyst  from './PositioningAnalyst.js';
import * as NewsAnalyst         from './NewsAnalyst.js';
import * as RiskAnalyst         from './RiskAnalyst.js';

import * as MTFEngine            from '../core/MTFEngine.js';
import * as RegimeEngine         from '../core/RegimeEngine.js';
import * as MarketSnapshotEngine from '../core/MarketSnapshotEngine.js';

import {
  AGENT,
  DEFAULT_WEIGHTS,
  REGIME_WEIGHTS,
  createFallbackVote,
  aggregateVotes,
  getWeightsForRegime,
} from '../types/Vote.js';

// ─────────────────────────────────────────────
// DEFAULT MEMORY LAYER (Phase 1–5 stubs)
// ─────────────────────────────────────────────

const DEFAULT_MEMORY = Object.freeze({
  // Central bank
  cb_fed_stance_score:   60,
  cb_ecb_stance_score:    0,
  // COT positioning
  cot_net_position:       0,
  cot_z_score_52w:        0,
  cot_signal:         'neutral',
  cot_trend_3w:       'flat',
  cot_extreme:            false,
  // News sentiment
  news_net_score_24h:    30,
  news_net_score_7d:     15,
  news_net_score_30d:     5,
  narrative_shift:        false,
  // Macro context
  us_de_spread:           2.0,
  dxy_trend:          'rising',
  dxy_level:            104.5,
  policy_momentum:        1,
  // Risk context
  vix_level:             15.0,
  upcoming_event_risk:    false,
  event_within_hours:     null,
  event_impact_level:  'low',
  // Data quality
  data_source:         'stub',
});

// ─────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────

/**
 * Runs the full AI Committee pipeline.
 *
 * @param {CommitteeInput} input
 * @returns {CommitteeOutput}
 */
export function run(input) {
  try {
    return _run(input);
  } catch (err) {
    console.error('[CommitteeOrchestrator] Pipeline error:', err.message);
    return _emergencyOutput(err.message);
  }
}

// ─────────────────────────────────────────────
// CORE PIPELINE
// ─────────────────────────────────────────────

function _run(input) {
  const {
    candles       = [],
    candles_1d    = [],
    candles_1h    = [],
    weights       = null,
    memoryLayer   = {},
    indicatorResult = {},
    // Allow pre-computed regime to skip RegimeEngine (performance optimisation)
    regime: inputRegime = null,
  } = input ?? {};

  // Merge memory with defaults
  const memory = { ...DEFAULT_MEMORY, ...memoryLayer };

  // ── Step 1: Regime classification ──────────
  const regimeResult = inputRegime
    ? { regime: inputRegime, weight_adjustment: REGIME_WEIGHTS[inputRegime] ?? DEFAULT_WEIGHTS }
    : RegimeEngine.run(candles);

  const regime = regimeResult.regime ?? 'ranging';

  // ── Step 2: Effective weights ───────────────
  // Priority: caller-passed weights → regime override → defaults
  const effectiveWeights = _resolveWeights(regime, weights);

  // ── Step 3: MTF alignment gate ──────────────
  const mtfResult = MTFEngine.run(candles_1d, candles, candles_1h);

  // Build shared indicatorResult for agents that can reuse it
  // MarketSnapshotEngine.computeIndicators is the source of truth
  const ind = (indicatorResult && Object.keys(indicatorResult).length > 0)
    ? indicatorResult
    : _computeBasicIndicators(candles);

  // ── Step 4: Run all 5 agents ─────────────────
  const votes = [
    _runAgent(AGENT.TECHNICAL,   () =>
      TechnicalAnalyst.run({
        candles,
        regime,
        weight:          effectiveWeights.technical,
        indicatorResult: ind,
      })
    ),
    _runAgent(AGENT.MACRO,       () =>
      MacroAnalyst.run({
        memoryLayer: memory,
        regime,
        weight: effectiveWeights.macro,
      })
    ),
    _runAgent(AGENT.POSITIONING, () =>
      PositioningAnalyst.run({
        memoryLayer:     memory,
        regime,
        weight:          effectiveWeights.positioning,
        indicatorResult: ind,
      })
    ),
    _runAgent(AGENT.NEWS,        () =>
      NewsAnalyst.run({
        memoryLayer: memory,
        regime,
        weight:      effectiveWeights.news,
      })
    ),
    _runAgent(AGENT.RISK,        () =>
      RiskAnalyst.run({
        candles,
        memoryLayer:     memory,
        regime,
        weight:          effectiveWeights.risk,
        indicatorResult: ind,
      })
    ),
  ];

  // ── Step 5: Aggregate ───────────────────────
  const verdict = aggregateVotes(votes);

  return Object.freeze({
    votes,
    verdict,
    mtf_result:    mtfResult,
    regime,
    weights:       effectiveWeights,
    regime_result: regimeResult,
    timestamp:     Date.now(),
  });
}

// ─────────────────────────────────────────────
// WEIGHT RESOLUTION
// ─────────────────────────────────────────────

/**
 * Resolves effective committee weights.
 * Priority: regime override (Vote.js REGIME_WEIGHTS) > caller-passed > defaults.
 *
 * @param {string}           regime
 * @param {WeightConfig|null} passedWeights
 * @returns {WeightConfig}
 */
function _resolveWeights(regime, passedWeights) {
  // Regime overrides always win — single source of truth in Vote.js
  const regimeW = REGIME_WEIGHTS[regime];
  if (regimeW) return regimeW;

  // Caller-passed (from committee_weights table, Phase 5+)
  if (passedWeights && _weightsValid(passedWeights)) return passedWeights;

  return DEFAULT_WEIGHTS;
}

function _weightsValid(w) {
  if (!w || typeof w !== 'object') return false;
  const sum = (w.technical ?? 0) + (w.macro ?? 0) + (w.positioning ?? 0)
            + (w.news ?? 0) + (w.risk ?? 0);
  return Math.abs(sum - 1.0) < 0.001;
}

// ─────────────────────────────────────────────
// SAFE AGENT RUNNER
// ─────────────────────────────────────────────

/**
 * Runs an agent function and catches any error.
 * Returns a neutral fallback vote if the agent throws.
 * Guarantees exactly 1 vote returned per agent call.
 *
 * @param {string}   agent
 * @param {Function} agentFn
 * @returns {Vote}
 */
function _runAgent(agent, agentFn) {
  try {
    const result = agentFn();
    if (!result || typeof result.score !== 'number') {
      console.warn(`[CommitteeOrchestrator] Agent "${agent}" returned invalid vote`);
      return createFallbackVote(agent, 'Invalid vote structure returned');
    }
    return result;
  } catch (err) {
    console.warn(`[CommitteeOrchestrator] Agent "${agent}" threw:`, err.message);
    return createFallbackVote(agent, err.message);
  }
}

// ─────────────────────────────────────────────
// BASIC INDICATOR COMPUTATION
// ─────────────────────────────────────────────

/**
 * Computes a minimal indicator set when no pre-computed result is available.
 * TechnicalAnalyst can compute its own, but this avoids redundant work.
 *
 * @param {Candle[]} candles
 * @returns {object}
 */
function _computeBasicIndicators(candles) {
  if (!candles || candles.length < 10) {
    return {};
  }
  try {
    return MarketSnapshotEngine.computeIndicators(candles);
  } catch (_) {
    // Graceful degradation: agents compute their own indicators internally
    return { price: candles[candles.length - 1]?.close ?? 0 };
  }
}

// ─────────────────────────────────────────────
// EMERGENCY FALLBACK
// ─────────────────────────────────────────────

/**
 * Returns a safe CommitteeOutput with 5 neutral votes.
 * Called if the outer try/catch triggers.
 */
function _emergencyOutput(errorMsg) {
  const fallbackVotes = [
    createFallbackVote(AGENT.TECHNICAL,   errorMsg),
    createFallbackVote(AGENT.MACRO,       errorMsg),
    createFallbackVote(AGENT.POSITIONING, errorMsg),
    createFallbackVote(AGENT.NEWS,        errorMsg),
    createFallbackVote(AGENT.RISK,        errorMsg),
  ];

  return Object.freeze({
    votes:         fallbackVotes,
    verdict:       aggregateVotes(fallbackVotes),
    mtf_result:    { gate_pass: true, mtf_state: 'partially_aligned', confidence_adj: 0,
                     mtf_score: 0, bias_1d: 0, bias_4h: 0, bias_1h: 0,
                     direction: 'NEUTRAL', description_en: errorMsg, description_zh: errorMsg },
    regime:        'ranging',
    weights:       DEFAULT_WEIGHTS,
    regime_result: { regime: 'ranging', confidence: 0 },
    timestamp:     Date.now(),
  });
}

// ─────────────────────────────────────────────
// JSDoc typedefs
// ─────────────────────────────────────────────

/**
 * @typedef {Object} CommitteeInput
 * @property {Candle[]}     candles          - 4H primary timeframe
 * @property {Candle[]}     [candles_1d]     - 1D for MTF
 * @property {Candle[]}     [candles_1h]     - 1H for MTF
 * @property {WeightConfig} [weights]        - caller override (Phase 5+)
 * @property {object}       [memoryLayer]    - macro/news/COT data
 * @property {object}       [indicatorResult]- pre-computed indicators
 * @property {string}       [regime]         - pre-computed regime (skip RegimeEngine)
 */

/**
 * @typedef {Object} CommitteeOutput
 * @property {Vote[]}           votes         - exactly 5
 * @property {CommitteeVerdict} verdict
 * @property {MTFResult}        mtf_result
 * @property {string}           regime
 * @property {WeightConfig}     weights
 * @property {RegimeResult}     regime_result
 * @property {number}           timestamp
 */
