/**
 * ONETO EUR/USD AI Tool — MacroAnalyst Agent
 * ============================================
 * AI Committee Agent 2 (weight: 20% default, regime-adjusted).
 *
 * Analyses macroeconomic fundamentals driving EUR/USD directional bias.
 * Phase 1–5: hardcoded macro model with reasonable defaults.
 * Phase 6+:  reads real data from CentralBankMemory + FREDService.
 *
 * Five scoring components:
 *   1. Fed stance          — USD hawkishness → bearish EUR (max ±28)
 *   2. ECB stance          — EUR dovishness → bearish EUR  (max ±22)
 *   3. Yield spread        — US-DE 10Y spread direction    (max ±16)
 *   4. Policy momentum     — consecutive stance direction   (max ±12)
 *   5. Economic divergence — US vs EU growth/inflation gap  (max ±10)
 *   Event risk reduction   — confidence cut on upcoming events
 *
 * Score convention: 0–100. Higher = more bearish EUR/USD.
 *
 * Entry point:  MacroAnalyst.run(params)
 * Never throws. Returns neutral fallback on error.
 *
 * FRED integration points:
 *   memory.gdp_us_qoq       → US GDP QoQ growth rate
 *   memory.gdp_eu_qoq       → EU GDP QoQ growth rate
 *   memory.cpi_us_yoy       → US CPI YoY
 *   memory.cpi_eu_yoy       → EU CPI YoY
 *   memory.unemployment_us  → US unemployment rate
 *   memory.unemployment_eu  → EU unemployment rate
 *
 * Architecture Freeze V4.0-R1 | Phase 4A
 */

'use strict';

import {
  AGENT,
  createVote,
  createFallbackVote,
  scoreToVote,
  DEFAULT_WEIGHTS,
} from '../types/Vote.js';

// ─────────────────────────────────────────────
// DEFAULT MEMORY LAYER (Phase 1–5 stubs)
// ─────────────────────────────────────────────

const DEFAULT_MEMORY = Object.freeze({
  // Central bank stance: +100 = very hawkish, -100 = very dovish
  cb_fed_stance_score:  60,    // Fed hawkish — USD supportive
  cb_ecb_stance_score:   0,    // ECB neutral
  // Yield spread: US 10Y minus DE 10Y (basis points expressed as %)
  us_de_spread:          2.0,  // 200bp spread — USD yield advantage
  // Policy momentum: -3 to +3 (rolling direction of last 3 CB decisions)
  policy_momentum:       1,    // mild hawkish trend
  // DXY trend
  dxy_trend:          'rising',
  // Economic divergence (Phase 6+: from FRED)
  gdp_us_qoq:          0.6,   // US GDP QoQ %
  gdp_eu_qoq:          0.2,   // EU GDP QoQ %
  cpi_us_yoy:          3.1,   // US CPI YoY %
  cpi_eu_yoy:          2.4,   // EU CPI YoY %
  unemployment_us:     3.9,
  unemployment_eu:     6.0,
  // Event risk
  upcoming_event_risk:  false,
  event_within_hours:   null,  // null = no major event
  // Narrative / override
  macro_override_score: null,  // null = compute normally; number = use directly
  dominant_theme:       null,
});

// ─────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────

/**
 * Runs the Macro Analyst and returns a Vote.
 *
 * @param {MacroParams} params
 * @returns {Vote}
 */
export function run(params) {
  try {
    return _run(params);
  } catch (err) {
    console.warn('[MacroAnalyst] Error:', err.message);
    return createFallbackVote(AGENT.MACRO, err.message);
  }
}

// ─────────────────────────────────────────────
// CORE ANALYSIS
// ─────────────────────────────────────────────

function _run(params) {
  const {
    memoryLayer = {},
    regime      = 'ranging',
    weight      = DEFAULT_WEIGHTS.macro,
  } = params ?? {};

  // Merge with defaults — real data overlays stubs
  const m = { ...DEFAULT_MEMORY, ...memoryLayer };

  // Optional direct override (used by Phase 6 macro report engine)
  if (typeof m.macro_override_score === 'number') {
    const score    = _clamp(m.macro_override_score);
    const vote     = scoreToVote(score);
    const confidence = Math.round(Math.abs(score - 50) * 2);
    return createVote({
      agent: AGENT.MACRO, score, vote, confidence, weight,
      market_regime: regime,
      reason_1: m.dominant_theme ?? 'Macro override applied',
      reason_2: `Override score: ${score}`,
    });
  }

  let score    = 50;
  const r1List = [];
  const r2List = [];

  // ── 1. Fed stance (±28) ────────────────────
  // Fed hawkishness = USD strength = bearish EUR
  const fed = _clampRange(m.cb_fed_stance_score, -100, 100);
  const fedContrib = (fed / 100) * 28;
  score += fedContrib;

  if      (fed > 60)  r1List.push(`Fed very hawkish (${fed}) — USD bullish`);
  else if (fed > 25)  r1List.push(`Fed hawkish (${fed}) — USD supportive`);
  else if (fed < -50) r1List.push(`Fed very dovish (${fed}) — USD bearish`);
  else if (fed < -20) r1List.push(`Fed dovish (${fed}) — USD under pressure`);

  // ── 2. ECB stance (±22) ────────────────────
  // ECB hawkishness = EUR strength = bullish EUR
  const ecb = _clampRange(m.cb_ecb_stance_score, -100, 100);
  const ecbContrib = (ecb / 100) * 22;
  score -= ecbContrib;   // ECB hawkish = USD/EUR bearish = score DOWN

  if      (ecb > 50)  r1List.push(`ECB hawkish (${ecb}) — EUR supportive`);
  else if (ecb > 20)  r1List.push(`ECB mildly hawkish — EUR mildly supported`);
  else if (ecb < -50) r1List.push(`ECB very dovish (${ecb}) — EUR bearish`);
  else if (ecb < -20) r1List.push(`ECB dovish — EUR under pressure`);

  // ── 3. Yield spread US–DE (±16) ────────────
  // Wider spread = more USD yield advantage = bearish EUR
  const spread = m.us_de_spread ?? 2.0;
  if      (spread > 3.0) { score += 16; r2List.push(`US-DE spread ${spread.toFixed(2)}% — wide, USD yield dominant`); }
  else if (spread > 2.0) { score += 10; r2List.push(`US-DE spread ${spread.toFixed(2)}%`); }
  else if (spread > 1.0) { score +=  5; }
  else if (spread < 0.0) { score -= 14; r2List.push(`US-DE spread ${spread.toFixed(2)}% — negative, EUR yield advantage`); }
  else if (spread < 0.5) { score -= 10; r2List.push(`US-DE spread ${spread.toFixed(2)}% — narrow, EUR competitive`); }

  // ── 4. Policy momentum (±12) ───────────────
  // +3 = 3 consecutive hawkish moves (USD bullish = bearish EUR)
  // -3 = 3 consecutive dovish moves  (USD bearish = bullish EUR)
  const mom = _clampRange(m.policy_momentum, -3, 3);
  score += mom * 4;
  if (Math.abs(mom) >= 2) {
    const dir = mom > 0 ? 'hawkish trajectory' : 'dovish trajectory';
    r2List.push(`Fed ${dir} (${mom > 0 ? '+' : ''}${mom} consecutive)`);
  }

  // ── 5. Economic divergence (±10) ───────────
  // US outperformance vs EU = USD bullish = bearish EUR
  const gdpDiv = (m.gdp_us_qoq ?? 0) - (m.gdp_eu_qoq ?? 0);
  const cpiDiv = (m.cpi_us_yoy ?? 0) - (m.cpi_eu_yoy ?? 0);

  if      (gdpDiv > 0.8) { score += 8; r2List.push(`US GDP outperformance +${gdpDiv.toFixed(1)}% QoQ`); }
  else if (gdpDiv > 0.3) { score += 4; }
  else if (gdpDiv < -0.8){ score -= 8; r2List.push(`EU GDP outperformance, US lagging ${gdpDiv.toFixed(1)}%`); }
  else if (gdpDiv < -0.3){ score -= 4; }

  // US CPI higher than EU = Fed stays higher for longer = bearish EUR
  if      (cpiDiv > 1.5) { score += 5; r2List.push(`US CPI ${m.cpi_us_yoy}% vs EU ${m.cpi_eu_yoy}% — Fed constraint`); }
  else if (cpiDiv < -1.5){ score -= 5; r2List.push(`EU CPI ${m.cpi_eu_yoy}% outpaces US — ECB pressure`); }

  // Unemployment divergence: higher EU unemployment = ECB pressure to ease = bearish EUR
  const unempDiv = (m.unemployment_eu ?? 0) - (m.unemployment_us ?? 0);
  if      (unempDiv > 2.5) { score += 4; r2List.push(`EU unemployment ${m.unemployment_eu}% well above US — ECB dovish pressure`); }
  else if (unempDiv < -1.0){ score -= 4; }

  // ── 6. Event risk adjustment ────────────────
  let confidenceMultiplier = 1.0;
  if (m.upcoming_event_risk) {
    const hoursOut = m.event_within_hours ?? 4;
    if (hoursOut < 1)       { confidenceMultiplier = 0.40; r2List.push('High-impact event <1h — confidence very low'); }
    else if (hoursOut < 2)  { confidenceMultiplier = 0.55; r2List.push('High-impact event <2h — confidence low'); }
    else if (hoursOut < 4)  { confidenceMultiplier = 0.70; r2List.push('High-impact event <4h — confidence reduced'); }
    else                    { confidenceMultiplier = 0.85; r2List.push('High-impact event today — mild confidence reduction'); }
  }

  // ── 7. DXY context ─────────────────────────
  const dxy = m.dxy_trend ?? 'neutral';
  if      (dxy === 'rising')  { score += 6; r2List.push('DXY rising — USD momentum'); }
  else if (dxy === 'falling') { score -= 6; r2List.push('DXY falling — USD weakness'); }

  score = _clamp(score);
  const vote       = scoreToVote(score);
  const baseConf   = Math.round(Math.abs(score - 50) * 2);
  const confidence = Math.round(baseConf * confidenceMultiplier);

  const fedLabel = fed > 50 ? 'Very Hawkish' : fed > 20 ? 'Hawkish' : fed > -20 ? 'Neutral' : fed > -50 ? 'Dovish' : 'Very Dovish';
  const ecbLabel = ecb > 20 ? 'Hawkish' : ecb > -20 ? 'Neutral' : 'Dovish';

  const reason_1 = r1List[0] ?? `Fed ${fedLabel} · ECB ${ecbLabel} · Spread ${spread.toFixed(2)}%`;
  const reason_2 = r1List[1] ?? r2List[0] ?? `Policy mom ${mom > 0 ? '+' : ''}${mom} · DXY ${dxy}`;

  return createVote({
    agent:         AGENT.MACRO,
    score,
    vote,
    confidence,
    weight,
    market_regime: regime,
    reason_1,
    reason_2,
  });
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function _clamp(n)               { return Math.max(0, Math.min(100, Math.round(n))); }
function _clampRange(n, lo, hi)  { return Math.max(lo, Math.min(hi, n ?? 0)); }

// ─────────────────────────────────────────────
// JSDoc typedefs
// ─────────────────────────────────────────────

/**
 * @typedef {Object} MacroParams
 * @property {object} [memoryLayer]   - macro data (Phase 6+: from FRED + CB Memory)
 * @property {string} [regime]
 * @property {number} [weight]
 */
