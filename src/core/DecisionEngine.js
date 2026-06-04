/**
 * ONETO EUR/USD AI Tool — DecisionEngine
 * =========================================
 * Standalone 8-state signal decision engine.
 * Replaces the inline _decide() stub in SignalEngine.js
 * with a fully contract-compliant, independently callable module.
 *
 * Entry point:
 *   DecisionEngine.run(committeeOutput, accountProfile, currentPrice)
 *
 * Pipeline (Steps 0–7):
 *   0. Guard — validate committee output
 *   1. Drawdown pre-check — immediate NO_TRADE if account halted
 *   2. Resolve effective weights (regime-adjusted)
 *   3. Compute directional score (weighted, Risk agent excluded)
 *   4. Compute final confidence (base − risk penalty + MTF adjustment)
 *   5. Count agent agreement
 *   6. Run all 6 gates (MTF · confidence · RR · agreement · drawdown · regime)
 *   7. Map to 8-state strength + build full DecisionResult
 *
 * 8-state output:
 *   STRONG_BUY / BUY / WEAK_BUY / NEUTRAL /
 *   WEAK_SELL / SELL / STRONG_SELL / NO_TRADE
 *
 * Thresholds (authorised Architecture Freeze V4.0-R1):
 *   STRONG: dirScore > 75, confidence ≥ 75, agents ≥ 4
 *   SELL/BUY: dirScore > 65, confidence ≥ 65, agents ≥ 3
 *   WEAK:  dirScore > 58, confidence ≥ 55, agents ≥ 3
 *
 * Contract: run() NEVER throws. Always returns a valid DecisionResult.
 *
 * Interface Contract 4 compliant.
 * Architecture Freeze V4.0-R1 | Phase 3
 */

'use strict';

import {
  SIGNAL_STRENGTH,
  SIGNAL_DIRECTION,
  computePriceLevels,
  DEFAULT_PIPS,
} from '../types/Signal.js';

import {
  AGENT,
  VOTE_DIRECTION,
  DEFAULT_WEIGHTS,
  REGIME_WEIGHTS,
  countAgentsAgreeing,
  scoreToVote,
} from '../types/Vote.js';

import { detectSession } from '../types/MarketSnapshot.js';

// ─────────────────────────────────────────────
// GATE REASON CODES
// ─────────────────────────────────────────────

const NO_TRADE_REASON = Object.freeze({
  mtf_pass:             'MTF_NOT_ALIGNED',
  confidence_pass:      'LOW_CONFIDENCE',
  rr_pass:              'RR_TOO_LOW',
  agent_agreement_pass: 'AGENT_DISAGREEMENT',
  drawdown_pass:        'DRAWDOWN_HALT',
  regime_pass:          'VOLATILE_REGIME_BLOCKED',
  guard:                'INVALID_COMMITTEE_OUTPUT',
});

// ─────────────────────────────────────────────
// EXPLANATION COLORS
// ─────────────────────────────────────────────

const VOTE_COLORS = Object.freeze({
  SELL:    'var(--red,    #f87171)',
  BUY:     'var(--green,  #4ade80)',
  NEUTRAL: 'var(--text3,  #6b7280)',
});

const RISK_COLORS = Object.freeze({
  high:   'var(--red,   #f87171)',
  medium: 'var(--amber, #fbbf24)',
  low:    'var(--green, #4ade80)',
});

// ─────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────

/**
 * Runs the full 8-state decision pipeline.
 * Returns a complete DecisionResult — never throws.
 *
 * @param {CommitteeOutput}  committeeOutput  - from CommitteeEngine.run()
 * @param {AccountProfile}   accountProfile   - from AccountState.get()
 * @param {number}           currentPrice     - EUR/USD spot price
 * @returns {DecisionResult}
 */
export function run(committeeOutput, accountProfile, currentPrice) {
  try {
    return _run(committeeOutput, accountProfile, currentPrice);
  } catch (err) {
    console.error('[DecisionEngine] Unexpected error:', err.message);
    return _noTradeResult(NO_TRADE_REASON.guard, {}, 0, 'unknown', currentPrice ?? 0);
  }
}

// ─────────────────────────────────────────────
// CORE PIPELINE
// ─────────────────────────────────────────────

function _run(committeeOutput, accountProfile, currentPrice) {
  const profile  = accountProfile  ?? _defaultProfile();
  const price    = typeof currentPrice === 'number' && currentPrice > 0
    ? currentPrice
    : 0;

  // ── Step 0: Guard ──
  if (!committeeOutput || !Array.isArray(committeeOutput.votes) ||
      committeeOutput.votes.length === 0) {
    return _noTradeResult(NO_TRADE_REASON.guard, {}, 0, 'unknown', price);
  }

  const { votes, mtf_result: mtfResult, regime = 'ranging' } = committeeOutput;
  const mtf = mtfResult ?? { gate_pass: true, mtf_state: 'partially_aligned', confidence_adj: 0 };
  const session = detectSession();

  // ── Step 1: Drawdown pre-check ──
  if (_isDrawdownHalted(profile)) {
    return _noTradeResult(NO_TRADE_REASON.drawdown_pass, _allGates(false, false, false, false, false, false), 0, regime, price, session);
  }

  // ── Step 2: Resolve effective weights ──
  const weights   = _resolveWeights(regime, committeeOutput.weights);
  const riskWeight = weights.risk ?? DEFAULT_WEIGHTS.risk;
  const dirWeightSum = 1 - riskWeight;

  // ── Step 3: Directional score (excludes Risk agent) ──
  let dirScore = 0;
  for (const v of votes) {
    if (v.agent !== AGENT.RISK) {
      // Use regime-adjusted weight from vote if available, else fall back to resolved config
      const w = v.weight ?? (weights[v.agent] ?? 0);
      dirScore += v.score * (dirWeightSum > 0 ? w / dirWeightSum : 0);
    }
  }
  dirScore = Math.max(0, Math.min(100, Math.round(dirScore)));

  // ── Step 4: Confidence ──
  const riskVote    = votes.find(v => v.agent === AGENT.RISK);
  const riskScore   = riskVote?.score ?? 50;
  const baseConf    = Math.abs(dirScore - 50) * 2;
  const riskPenalty = Math.max(0, (riskScore - 55) * 0.3);
  const mtfAdj      = mtf.confidence_adj ?? 0;
  const finalConf   = Math.max(0, Math.min(100, Math.round(baseConf - riskPenalty + mtfAdj)));

  // ── Step 5: Direction + agent agreement ──
  const direction = dirScore > 55
    ? SIGNAL_DIRECTION.SELL
    : dirScore < 45
      ? SIGNAL_DIRECTION.BUY
      : SIGNAL_DIRECTION.NEUTRAL;

  const agentsAgreeing = countAgentsAgreeing(votes, direction);

  // ── Step 6: Price levels (needed for RR gate) ──
  const priceLevels = price > 0
    ? computePriceLevels(price, direction, DEFAULT_PIPS.SL, DEFAULT_PIPS.TP1, DEFAULT_PIPS.TP2)
    : _zeroPriceLevels(price);

  // ── Step 6: Gate checks ──
  const gates = {
    mtf_pass:             mtf.gate_pass !== false,
    confidence_pass:      finalConf   >= (profile.min_confidence ?? 65),
    rr_pass:              priceLevels.rr_ratio >= (profile.min_rr_ratio ?? 2.0),
    agent_agreement_pass: agentsAgreeing >= 3,
    drawdown_pass:        !_isDrawdownHalted(profile),
    regime_pass:          !(regime === 'volatile' && riskScore > 80),
  };

  // First failing gate → NO_TRADE
  const failedEntry = Object.entries(gates).find(([, v]) => !v);
  if (failedEntry) {
    const reason = NO_TRADE_REASON[failedEntry[0]] ?? 'NO_TRADE';
    return _noTradeResult(reason, gates, finalConf, regime, price, session, {
      final_score:      dirScore,
      agents_agreeing:  agentsAgreeing,
      mtf_state:        mtf.mtf_state,
      mtf_confidence_adj: mtfAdj,
      price_levels:     priceLevels,
      explanation:      _buildExplanation(votes, regime, mtf),
    });
  }

  // ── Step 7: 8-state mapping ──
  const signal_strength = direction === SIGNAL_DIRECTION.NEUTRAL
    ? SIGNAL_STRENGTH.NEUTRAL
    : _mapStrength(dirScore, finalConf, agentsAgreeing, direction);

  const explanation = _buildExplanation(votes, regime, mtf);

  return Object.freeze({
    // Classification
    signal_strength,
    direction,

    // Scores
    final_score:       dirScore,
    final_confidence:  finalConf,

    // Supporting metrics
    agents_agreeing:   agentsAgreeing,
    mtf_state:         mtf.mtf_state   ?? 'partially_aligned',
    mtf_confidence_adj: mtfAdj,

    // Price levels
    price_levels:      priceLevels,

    // Per-agent scores (for Signal record assembly)
    agent_scores: {
      technical:   votes.find(v => v.agent === AGENT.TECHNICAL)?.score   ?? 50,
      macro:       votes.find(v => v.agent === AGENT.MACRO)?.score        ?? 50,
      positioning: votes.find(v => v.agent === AGENT.POSITIONING)?.score  ?? 50,
      news:        votes.find(v => v.agent === AGENT.NEWS)?.score         ?? 50,
      risk:        riskScore,
    },

    // Risk score (for RiskManager.calc())
    risk_score: riskScore,

    // Explanation
    explanation,

    // Gate results
    gates,

    // No-trade reason (null when trade is actionable)
    no_trade_reason: null,

    // Context
    regime,
    session,
    timestamp: Date.now(),
  });
}

// ─────────────────────────────────────────────
// 8-STATE STRENGTH MAPPING
// ─────────────────────────────────────────────

/**
 * Maps directional score + confidence + agreement count to a signal strength.
 * Normalises score direction so logic is identical for BUY and SELL.
 *
 * Thresholds (Architecture Freeze V4.0-R1):
 *   STRONG:  raw score > 75, confidence ≥ 75, agents ≥ 4
 *   NORMAL:  raw score > 65, confidence ≥ 65, agents ≥ 3
 *   WEAK:    raw score > 58, confidence ≥ 55, agents ≥ 3
 *   else     NEUTRAL
 *
 * @param {number} dirScore    0–100, higher = more bearish
 * @param {number} confidence  0–100
 * @param {number} agents      count of agents agreeing
 * @param {string} direction   'BUY'|'SELL'
 * @returns {string}  one of SIGNAL_STRENGTH values
 */
function _mapStrength(dirScore, confidence, agents, direction) {
  const isSell = direction === SIGNAL_DIRECTION.SELL;
  // Normalise: for SELL, score is already bearish (>50). For BUY, invert.
  const strength = isSell ? dirScore : 100 - dirScore;

  if (strength > 75 && confidence >= 75 && agents >= 4) {
    return isSell ? SIGNAL_STRENGTH.STRONG_SELL : SIGNAL_STRENGTH.STRONG_BUY;
  }
  if (strength > 65 && confidence >= 65 && agents >= 3) {
    return isSell ? SIGNAL_STRENGTH.SELL : SIGNAL_STRENGTH.BUY;
  }
  if (strength > 58 && confidence >= 55 && agents >= 3) {
    return isSell ? SIGNAL_STRENGTH.WEAK_SELL : SIGNAL_STRENGTH.WEAK_BUY;
  }
  return SIGNAL_STRENGTH.NEUTRAL;
}

// ─────────────────────────────────────────────
// EXPLANATION BUILDER
// ─────────────────────────────────────────────

/**
 * Builds the array of ExplanationItem records for the UI.
 * One entry per major signal driver: technical, macro, news, risk, mtf.
 *
 * @param {Vote[]} votes
 * @param {string} regime
 * @param {object} mtf
 * @returns {ExplanationItem[]}
 */
function _buildExplanation(votes, regime, mtf) {
  const items = [];

  const byAgent = {};
  for (const v of votes) byAgent[v.agent] = v;

  // ── Technical ──
  const tech = byAgent[AGENT.TECHNICAL];
  if (tech) {
    items.push({
      category: 'technical',
      color:    VOTE_COLORS[tech.vote] ?? VOTE_COLORS.NEUTRAL,
      text_en:  tech.reason_1 || 'Technical indicators assessed',
      text_zh:  _zhReason(tech.reason_1, 'technical'),
    });
  }

  // ── Macro ──
  const macro = byAgent[AGENT.MACRO];
  if (macro) {
    items.push({
      category: 'macro',
      color:    macro.vote === VOTE_DIRECTION.SELL
        ? VOTE_COLORS.SELL
        : macro.vote === VOTE_DIRECTION.BUY
          ? VOTE_COLORS.BUY
          : 'var(--amber, #fbbf24)',
      text_en:  macro.reason_1 || 'Macro conditions assessed',
      text_zh:  _zhReason(macro.reason_1, 'macro'),
    });
  }

  // ── Positioning ──
  const pos = byAgent[AGENT.POSITIONING];
  if (pos) {
    items.push({
      category: 'positioning',
      color:    VOTE_COLORS[pos.vote] ?? VOTE_COLORS.NEUTRAL,
      text_en:  pos.reason_1 || 'Institutional positioning assessed',
      text_zh:  _zhReason(pos.reason_1, 'positioning'),
    });
  }

  // ── News ──
  const news = byAgent[AGENT.NEWS];
  if (news) {
    items.push({
      category: 'news',
      color:    VOTE_COLORS[news.vote] ?? VOTE_COLORS.NEUTRAL,
      text_en:  news.reason_1 || 'News sentiment assessed',
      text_zh:  _zhReason(news.reason_1, 'news'),
    });
  }

  // ── Risk ──
  const risk = byAgent[AGENT.RISK];
  if (risk) {
    const riskColor = risk.score > 70
      ? RISK_COLORS.high
      : risk.score < 40
        ? RISK_COLORS.low
        : RISK_COLORS.medium;
    items.push({
      category: 'risk',
      color:    riskColor,
      text_en:  risk.reason_1 || 'Risk conditions assessed',
      text_zh:  _zhReason(risk.reason_1, 'risk'),
    });
  }

  // ── MTF ──
  if (mtf?.description_en) {
    const mtfColor = mtf.mtf_state === 'fully_aligned'
      ? 'var(--green,  #4ade80)'
      : mtf.mtf_state === 'not_aligned'
        ? 'var(--red,   #f87171)'
        : 'var(--purple, #a78bfa)';
    items.push({
      category: 'mtf',
      color:    mtfColor,
      text_en:  mtf.description_en,
      text_zh:  mtf.description_zh ?? mtf.description_en,
    });
  }

  return items;
}

// ─────────────────────────────────────────────
// ZH REASON TRANSLATION (lightweight, no external dep)
// Phase 6 replaces with Claude API translations.
// ─────────────────────────────────────────────

const ZH_PATTERNS = [
  [/\bstrong buy\b/gi,    '强烈看多'],
  [/\bstrong sell\b/gi,   '强烈看空'],
  [/\bbearish\b/gi,       '偏空'],
  [/\bbullish\b/gi,       '偏多'],
  [/\bneutral\b/gi,       '中性'],
  [/\bhawkish\b/gi,       '鹰派'],
  [/\bdovish\b/gi,        '鸽派'],
  [/\brising\b/gi,        '上升'],
  [/\bfalling\b/gi,       '下降'],
  [/\bspread\b/gi,        '利差'],
  [/\bmomentum\b/gi,      '动能'],
  [/\boverbought\b/gi,    '超买'],
  [/\boversold\b/gi,      '超卖'],
  [/\balignment\b/gi,     '对齐'],
  [/\btrend\b/gi,         '趋势'],
  [/\bvolatile\b/gi,      '波动'],
  [/\branging\b/gi,       '震荡'],
  [/\bbreakout\b/gi,      '突破'],
  [/\bcontrarian\b/gi,    '逆向'],
  [/\bcrowded\b/gi,       '拥挤'],
  [/\bnarrative shift\b/gi, '叙事转变'],
  [/\bconfidence reduced\b/gi, '置信度已降低'],
  [/\bAlignment\b/gi,     '对齐'],
  [/\bMA cross\b/gi,      '均线交叉'],
];

function _zhReason(text, _category) {
  if (!text) return '';
  let out = text;
  for (const [pattern, replacement] of ZH_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

// ─────────────────────────────────────────────
// WEIGHT RESOLUTION
// ─────────────────────────────────────────────

/**
 * Resolves effective weights.
 * Priority: committeeOutput.weights → regime override → DEFAULT_WEIGHTS.
 *
 * @param {string}           regime
 * @param {WeightConfig|null} passedWeights  - from committeeOutput.weights
 * @returns {WeightConfig}
 */
function _resolveWeights(regime, passedWeights) {
  // Regime override always wins when available
  const regimeW = REGIME_WEIGHTS[regime];
  if (regimeW) return regimeW;

  // Caller-passed weights (from committee_weights table, Phase 5+)
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
// DRAWDOWN HALT CHECK
// ─────────────────────────────────────────────

function _isDrawdownHalted(profile) {
  if (!profile) return false;
  return (profile.current_drawdown  ?? 0) >= (profile.max_drawdown_limit      ?? 0.10)
      || (profile.consecutive_losses ?? 0) >= (profile.max_consecutive_losses  ?? 5);
}

// ─────────────────────────────────────────────
// RESULT BUILDERS
// ─────────────────────────────────────────────

/**
 * Builds a complete NO_TRADE DecisionResult.
 * All gates default to the provided `gates` object or false.
 *
 * @param {string} reason
 * @param {object} gates
 * @param {number} finalConf
 * @param {string} regime
 * @param {number} price
 * @param {string} [session]
 * @param {object} [extra]   - optional overrides (final_score, explanation, etc.)
 * @returns {DecisionResult}
 */
function _noTradeResult(reason, gates, finalConf, regime, price, session, extra = {}) {
  const priceLevels = extra.price_levels ?? _zeroPriceLevels(price);
  return Object.freeze({
    signal_strength:   SIGNAL_STRENGTH.NO_TRADE,
    direction:         SIGNAL_DIRECTION.NEUTRAL,
    final_score:       extra.final_score       ?? 50,
    final_confidence:  finalConf,
    agents_agreeing:   extra.agents_agreeing   ?? 0,
    mtf_state:         extra.mtf_state         ?? 'not_aligned',
    mtf_confidence_adj: extra.mtf_confidence_adj ?? 0,
    price_levels:      priceLevels,
    agent_scores: {
      technical: 50, macro: 50, positioning: 50, news: 50, risk: 50,
    },
    risk_score:        50,
    explanation:       extra.explanation ?? [],
    gates:             _allGates(
      gates.mtf_pass             ?? false,
      gates.confidence_pass      ?? false,
      gates.rr_pass              ?? false,
      gates.agent_agreement_pass ?? false,
      gates.drawdown_pass        ?? false,
      gates.regime_pass          ?? false,
    ),
    no_trade_reason: reason,
    regime,
    session:   session  ?? detectSession(),
    timestamp: Date.now(),
  });
}

function _allGates(mtf, conf, rr, agents, drawdown, regime) {
  return { mtf_pass: mtf, confidence_pass: conf, rr_pass: rr,
           agent_agreement_pass: agents, drawdown_pass: drawdown, regime_pass: regime };
}

function _zeroPriceLevels(price) {
  return { entry_price: price, stop_loss: 0, take_profit_1: 0, take_profit_2: 0,
           sl_pips: DEFAULT_PIPS.SL, tp1_pips: DEFAULT_PIPS.TP1,
           tp2_pips: DEFAULT_PIPS.TP2, rr_ratio: DEFAULT_PIPS.TP2 / DEFAULT_PIPS.SL };
}

function _defaultProfile() {
  return {
    account_balance: 1000, risk_profile: 'standard',
    min_confidence: 65, min_rr_ratio: 2.0,
    max_drawdown_limit: 0.10, max_consecutive_losses: 5,
    consecutive_losses: 0, current_drawdown: 0,
    daily_risk_used: 0, win_rate_20: 0.5,
  };
}

// ─────────────────────────────────────────────
// JSDoc typedefs
// ─────────────────────────────────────────────

/**
 * @typedef {Object} DecisionResult
 * @property {string}  signal_strength      - 8-state enum
 * @property {string}  direction            - BUY|SELL|NEUTRAL
 * @property {number}  final_score          - 0–100 directional composite
 * @property {number}  final_confidence     - 0–100 after adjustments
 * @property {number}  agents_agreeing
 * @property {string}  mtf_state
 * @property {number}  mtf_confidence_adj
 * @property {PriceLevels} price_levels
 * @property {object}  agent_scores         - per-agent score map
 * @property {number}  risk_score
 * @property {ExplanationItem[]} explanation
 * @property {object}  gates
 * @property {string|null} no_trade_reason
 * @property {string}  regime
 * @property {string}  session
 * @property {number}  timestamp
 */
