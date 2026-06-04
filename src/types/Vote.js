/**
 * ONETO EUR/USD AI Tool — Vote Type Definition
 * ==============================================
 * Canonical shape for a single AI Committee agent vote.
 * Used by CommitteeEngine, stored in committee_votes table (Phase 5),
 * and rendered by CommitteePanel.
 *
 * Updated committee weights (Phase 1 authorization):
 *   Technical 30% · Macro 20% · Positioning 20% · News 15% · Risk 15%
 *
 * Architecture Freeze V4.0-R1 | Phase 1
 */

'use strict';

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────

/** All valid agent identifiers */
export const AGENT = Object.freeze({
  TECHNICAL:   'technical',
  MACRO:       'macro',
  POSITIONING: 'positioning',
  NEWS:        'news',
  RISK:        'risk',
});

/** All valid vote directions */
export const VOTE_DIRECTION = Object.freeze({
  BUY:     'BUY',
  SELL:    'SELL',
  NEUTRAL: 'NEUTRAL',
});

/**
 * Factory default committee weights.
 * Updated per Phase 1 authorization:
 *   Technical:   30% (was 35%)
 *   Macro:       20% (unchanged)
 *   Positioning: 20% (was 10%)
 *   News:        15% (was 20%)
 *   Risk:        15% (unchanged)
 *
 * Sum must always equal 1.00.
 */
export const DEFAULT_WEIGHTS = Object.freeze({
  technical:   0.30,
  macro:       0.20,
  positioning: 0.20,
  news:        0.15,
  risk:        0.15,
});

/**
 * Regime-specific weight overrides.
 * Applied by CommitteeEngine before aggregating votes.
 * Each entry must sum to 1.00.
 */
export const REGIME_WEIGHTS = Object.freeze({
  trending_bull: Object.freeze({
    technical: 0.40, macro: 0.20, positioning: 0.15, news: 0.15, risk: 0.10,
  }),
  trending_bear: Object.freeze({
    technical: 0.40, macro: 0.20, positioning: 0.15, news: 0.15, risk: 0.10,
  }),
  ranging: Object.freeze({
    technical: 0.20, macro: 0.25, positioning: 0.20, news: 0.20, risk: 0.15,
  }),
  volatile: Object.freeze({
    technical: 0.25, macro: 0.15, positioning: 0.10, news: 0.20, risk: 0.30,
  }),
  breakout_up: Object.freeze({
    technical: 0.40, macro: 0.20, positioning: 0.15, news: 0.15, risk: 0.10,
  }),
  breakout_down: Object.freeze({
    technical: 0.40, macro: 0.20, positioning: 0.15, news: 0.15, risk: 0.10,
  }),
});

/** Agent display metadata (used by CommitteePanel) */
export const AGENT_META = Object.freeze({
  technical: Object.freeze({
    name_en: 'Technical Analyst',
    name_zh: '技术分析师',
    role_en: 'MA · RSI · MACD · BB · ADX',
    role_zh: '均线 · RSI · MACD · 布林带 · ADX',
    color:   'var(--blue)',
    icon:    '📊',
  }),
  macro: Object.freeze({
    name_en: 'Macro Analyst',
    name_zh: '宏观分析师',
    role_en: 'FED · ECB · GDP · CPI · Rate Differential',
    role_zh: '美联储 · 欧央行 · GDP · CPI · 利差',
    color:   'var(--amber)',
    icon:    '🏦',
  }),
  positioning: Object.freeze({
    name_en: 'Positioning Analyst',
    name_zh: '持仓分析师',
    role_en: 'COT · DXY · US10Y · Yield Spread',
    role_zh: 'COT持仓 · 美元指数 · 美债收益率',
    color:   'var(--purple)',
    icon:    '📐',
  }),
  news: Object.freeze({
    name_en: 'News Analyst',
    name_zh: '新闻分析师',
    role_en: 'Reuters · Bloomberg · ForexFactory',
    role_zh: '路透 · 彭博 · 外汇工厂',
    color:   'var(--green)',
    icon:    '📰',
  }),
  risk: Object.freeze({
    name_en: 'Risk Analyst',
    name_zh: '风险分析师',
    role_en: 'ATR · Volatility · Events · VIX',
    role_zh: 'ATR波动率 · 事件风险 · VIX',
    color:   'var(--red)',
    icon:    '🛡️',
  }),
});

// ─────────────────────────────────────────────
// FACTORY FUNCTION
// ─────────────────────────────────────────────

/**
 * Creates a fully-formed Vote record.
 * Fills safe defaults for every missing field.
 * Never throws.
 *
 * @param {Partial<Vote>} fields
 * @returns {Vote}
 */
export function createVote(fields = {}) {
  const agent  = fields.agent  ?? AGENT.TECHNICAL;
  const score  = clampScore(fields.score  ?? 50);
  const weight = fields.weight ?? DEFAULT_WEIGHTS[agent] ?? 0.20;

  return Object.freeze({
    // ── Identity ──
    id:        fields.id        ?? generateVoteId(),
    signal_id: fields.signal_id ?? null,
    timestamp: fields.timestamp ?? Date.now(),

    // ── Agent ──
    agent,

    // ── Scoring ──
    score,
    vote:       fields.vote       ?? scoreToVote(score),
    confidence: clampScore(fields.confidence ?? 0),

    // ── Weighting ──
    weight,
    weighted_contrib: parseFloat(((score * weight)).toFixed(4)),

    // ── Context ──
    market_regime: fields.market_regime ?? 'unknown',

    // ── Explanation ──
    reason_1: fields.reason_1 ?? '',
    reason_2: fields.reason_2 ?? '',

    // ── Post-trade tracking (set by DB trigger in Phase 5) ──
    was_correct: fields.was_correct ?? null,
  });
}

/**
 * Creates a neutral fallback vote for an agent that threw an error.
 * Used by CommitteeEngine to ensure exactly 5 votes always returned.
 *
 * @param {string} agent  - one of AGENT values
 * @param {string} [errorMsg]
 * @returns {Vote}
 */
export function createFallbackVote(agent, errorMsg = 'Agent error — neutral fallback') {
  return createVote({
    agent,
    score:      50,
    vote:       VOTE_DIRECTION.NEUTRAL,
    confidence: 0,
    reason_1:   errorMsg,
    reason_2:   '',
  });
}

// ─────────────────────────────────────────────
// WEIGHT UTILITIES
// ─────────────────────────────────────────────

/**
 * Returns the effective weight set for a given regime.
 * Falls back to DEFAULT_WEIGHTS if regime is unknown.
 *
 * @param {string} regime
 * @returns {WeightConfig}
 */
export function getWeightsForRegime(regime) {
  return REGIME_WEIGHTS[regime] ?? DEFAULT_WEIGHTS;
}

/**
 * Validates that a WeightConfig sums to 1.00 (within float tolerance).
 *
 * @param {WeightConfig} weights
 * @returns {{ valid: boolean, sum: number }}
 */
export function validateWeights(weights) {
  if (!weights || typeof weights !== 'object') {
    return { valid: false, sum: 0 };
  }
  const sum = (weights.technical   ?? 0)
            + (weights.macro       ?? 0)
            + (weights.positioning ?? 0)
            + (weights.news        ?? 0)
            + (weights.risk        ?? 0);
  const valid = Math.abs(sum - 1.0) < 0.001;
  return { valid, sum: parseFloat(sum.toFixed(4)) };
}

// ─────────────────────────────────────────────
// AGGREGATION UTILITIES
// ─────────────────────────────────────────────

/**
 * Aggregates an array of Vote objects into a CommitteeVerdict.
 * Risk Agent counted as 0.5 towards direction (it mostly votes NEUTRAL).
 *
 * @param {Vote[]} votes  - array of exactly 5 votes
 * @returns {CommitteeVerdict}
 */
export function aggregateVotes(votes) {
  if (!Array.isArray(votes) || votes.length === 0) {
    return {
      direction:      VOTE_DIRECTION.NEUTRAL,
      confidence:     0,
      sell_weight:    0,
      buy_weight:     0,
      neutral_weight: 1,
    };
  }

  let sell_weight    = 0;
  let buy_weight     = 0;
  let neutral_weight = 0;

  for (const v of votes) {
    const w = v.agent === AGENT.RISK ? v.weight * 0.5 : v.weight;
    if (v.vote === VOTE_DIRECTION.SELL)    sell_weight    += w;
    else if (v.vote === VOTE_DIRECTION.BUY) buy_weight   += w;
    else                                    neutral_weight += w;
  }

  const direction = sell_weight > buy_weight
    ? VOTE_DIRECTION.SELL
    : buy_weight > sell_weight
      ? VOTE_DIRECTION.BUY
      : VOTE_DIRECTION.NEUTRAL;

  const confidence = Math.round(Math.max(sell_weight, buy_weight) * 100);

  return {
    direction,
    confidence,
    sell_weight:    parseFloat(sell_weight.toFixed(4)),
    buy_weight:     parseFloat(buy_weight.toFixed(4)),
    neutral_weight: parseFloat(neutral_weight.toFixed(4)),
  };
}

/**
 * Counts how many agents voted in the same direction as the final verdict.
 * Risk agent counted as 0.5 if voting NEUTRAL.
 *
 * @param {Vote[]} votes
 * @param {string} direction - 'BUY' | 'SELL'
 * @returns {number}
 */
export function countAgentsAgreeing(votes, direction) {
  if (!Array.isArray(votes)) return 0;
  return votes.reduce((count, v) => {
    if (v.vote === direction) return count + 1;
    if (v.agent === AGENT.RISK && v.vote === VOTE_DIRECTION.NEUTRAL) return count + 0.5;
    return count;
  }, 0);
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

/**
 * Maps a 0–100 score to a vote direction.
 * Score > 55 → SELL (bearish), Score < 45 → BUY (bullish), else NEUTRAL.
 *
 * @param {number} score
 * @returns {'BUY'|'SELL'|'NEUTRAL'}
 */
export function scoreToVote(score) {
  if (score > 55) return VOTE_DIRECTION.SELL;
  if (score < 45) return VOTE_DIRECTION.BUY;
  return VOTE_DIRECTION.NEUTRAL;
}

/** Clamp a score value to [0, 100] */
function clampScore(v) {
  const n = parseFloat(v);
  if (isNaN(n)) return 50;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Generates a client-side unique vote ID */
function generateVoteId() {
  const ts  = Date.now().toString(36);
  const rnd = Math.random().toString(36).slice(2, 7);
  return `vote-${ts}-${rnd}`;
}

// ─────────────────────────────────────────────
// JSDoc typedefs
// ─────────────────────────────────────────────

/**
 * @typedef {Object} Vote
 * @property {string}       id
 * @property {string|null}  signal_id
 * @property {number}       timestamp          - UNIX ms
 * @property {string}       agent              - one of AGENT values
 * @property {number}       score              - 0–100
 * @property {string}       vote               - BUY | SELL | NEUTRAL
 * @property {number}       confidence         - 0–100
 * @property {number}       weight             - 0–1, regime-adjusted
 * @property {number}       weighted_contrib   - score × weight
 * @property {string}       market_regime
 * @property {string}       reason_1
 * @property {string}       reason_2
 * @property {boolean|null} was_correct        - set by DB trigger (Phase 5)
 */

/**
 * @typedef {Object} WeightConfig
 * @property {number} technical
 * @property {number} macro
 * @property {number} positioning
 * @property {number} news
 * @property {number} risk
 */

/**
 * @typedef {Object} CommitteeVerdict
 * @property {string} direction        - BUY | SELL | NEUTRAL
 * @property {number} confidence       - 0–100
 * @property {number} sell_weight
 * @property {number} buy_weight
 * @property {number} neutral_weight
 */