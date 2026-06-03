# ONETO EUR/USD AI Tool — V4.0 Architecture Freeze

**Status:** APPROVED  
**Revision:** 1 (Final)  
**Approved by:** Rolan / ONETO  
**Date:** 2026-06  
**Document version:** 1.0  

> This document is the single source of truth for V4.0 architecture.  
> No implementation decision may contradict this document without an explicit revision being created and approved.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [System Architecture Diagram](#2-system-architecture-diagram)
3. [Module Architecture](#3-module-architecture)
4. [Data Flow](#4-data-flow)
5. [Decision Flow](#5-decision-flow)
6. [Risk Flow](#6-risk-flow)
7. [AI Committee Flow](#7-ai-committee-flow)
8. [Market Regime Flow](#8-market-regime-flow)
9. [Learning Engine Flow](#9-learning-engine-flow)
10. [ZH/EN Internationalization Strategy](#10-zhen-internationalization-strategy)
11. [Future Scalability Strategy](#11-future-scalability-strategy)

---

## 1. System Overview

ONETO EUR/USD AI Tool v4.0 transforms the v3.2 signal display tool into a full institutional-grade AI trading research system.

The system is a **closed-loop decision pipeline**:

```
Market Data → Memory → Regime → MTF → Committee → Decision → Risk → Signal
→ Storage → Learning → Backtest → Paper Trading
```

Every signal generated passes through all layers in sequence.  
No signal is published that has not been validated by the full pipeline.

### Core Principles

| Principle | Description |
|-----------|-------------|
| **Closed loop** | Every signal feeds back into the learning system |
| **Graceful degradation** | Any API failure falls back, never crashes |
| **Human approval gate** | Weight changes require manual confirmation |
| **Immutable audit trail** | All system events are permanently logged |
| **Language agnostic** | All UI strings come from i18n layer |

---

## 2. System Architecture Diagram

```
╔══════════════════════════════════════════════════════════════════╗
║                      MARKET DATA LAYER                           ║
║   Twelve Data · FRED · NewsAPI · CFTC COT · ForexFactory RSS     ║
║   SimDataService (fallback of last resort)                       ║
╚══════════════════════════════════════════════════════════════════╝
                               ↓
╔══════════════════════════════════════════════════════════════════╗
║                       MEMORY LAYER                               ║
║   Central Bank Memory  ·  News Memory  ·  Economic Memory        ║
║   COT History          ·  Regime History                         ║
╚══════════════════════════════════════════════════════════════════╝
                               ↓
╔══════════════════════════════════════════════════════════════════╗
║                 MARKET REGIME ENGINE                             ║
║   trending_bull · trending_bear · ranging                        ║
║   volatile · breakout_up · breakout_down                         ║
║   → Outputs: regime label + weight_adjustment JSON               ║
╚══════════════════════════════════════════════════════════════════╝
                               ↓
╔══════════════════════════════════════════════════════════════════╗
║           MULTI-TIMEFRAME ALIGNMENT ENGINE (MTF)                 ║
║   1D bias · 4H bias · 1H bias → MTF Score → Alignment Gate      ║
║   NOT_ALIGNED → immediate NO_TRADE (pipeline stops here)         ║
╚══════════════════════════════════════════════════════════════════╝
                               ↓
╔══════════════════════════════════════════════════════════════════╗
║                     AI COMMITTEE                                 ║
║   Agent 1: Technical Analyst      (35%)                          ║
║   Agent 2: Macro Analyst          (20%)                          ║
║   Agent 3: Positioning Analyst    (10%)                          ║
║   Agent 4: News Analyst           (20%)                          ║
║   Agent 5: Risk Analyst           (15%)                          ║
║   → Each outputs: score · vote · confidence · reason × 2         ║
╚══════════════════════════════════════════════════════════════════╝
                               ↓
╔══════════════════════════════════════════════════════════════════╗
║                    DECISION ENGINE                               ║
║   Weighted aggregation of 5 agent scores                         ║
║   Regime-adjusted weights from committee_weights table           ║
║   Confidence filtering · Agent agreement gate · RR gate          ║
║   → Output: STRONG_BUY / BUY / WEAK_BUY / NEUTRAL /             ║
║             WEAK_SELL / SELL / STRONG_SELL / NO_TRADE            ║
╚══════════════════════════════════════════════════════════════════╝
                               ↓
╔══════════════════════════════════════════════════════════════════╗
║                     RISK MANAGER                                 ║
║   Reads: account_profile · regime · risk_score · drawdown        ║
║   Computes: lot_size · max_loss · expected_profit · RR           ║
║   Applies: regime multiplier · drawdown multiplier               ║
║            performance multiplier · risk_score multiplier        ║
║   → Output: complete position specification                      ║
╚══════════════════════════════════════════════════════════════════╝
                               ↓
╔══════════════════════════════════════════════════════════════════╗
║                   SIGNAL GENERATION                              ║
║   Assembles final signal record                                  ║
║   Attaches: AI Macro Report (ZH + EN)                            ║
║   Attaches: Per-agent explanation (ZH + EN)                      ║
║   → Published to UI · Written to database · Written to audit log ║
╚══════════════════════════════════════════════════════════════════╝
                               ↓
╔══════════════════════════════════════════════════════════════════╗
║              HISTORICAL DATABASE (Supabase PostgreSQL)           ║
║   17 tables · Row-Level Security · Immutable audit log           ║
║   signals · committee_votes · market_snapshots                   ║
║   account_profiles · api_health · signal_audit_log               ║
║   committee_weights · cot_history · macro_reports                ║
╚══════════════════════════════════════════════════════════════════╝
                               ↓
╔══════════════════════════════════════════════════════════════════╗
║                    LEARNING ENGINE                               ║
║   Runs after every 10 closed trades                              ║
║   Computes: win_rate · profit_factor · sharpe · expectancy       ║
║   Per-agent accuracy from committee_votes                        ║
║   Proposes weight adjustments (manual approval required)         ║
║   Historical similarity scoring via cosine similarity            ║
╚══════════════════════════════════════════════════════════════════╝
                               ↓
╔══════════════════════════════════════════════════════════════════╗
║                   BACKTEST ENGINE                                ║
║   Replays historical signals against stored market_snapshots     ║
║   Clickable records with full context expansion                  ║
║   Regime-stratified · Session-stratified · Per-agent breakdown   ║
╚══════════════════════════════════════════════════════════════════╝
                               ↓
╔══════════════════════════════════════════════════════════════════╗
║                PAPER TRADING ENGINE                              ║
║   Validation gates: 100 · 300 · 500 · 1000 trades               ║
║   Tracks: entry · SL · TP · P&L · duration · drawdown           ║
║   Writes results to signal_results → feeds Learning Engine       ║
╚══════════════════════════════════════════════════════════════════╝
```

---

## 3. Module Architecture

### 3.1 Core Engines

| Module | File | Responsibility | Phase |
|--------|------|----------------|-------|
| Decision Engine | `src/core/DecisionEngine.js` | 8-state signal from weighted committee scores | 3 |
| MTF Engine | `src/core/MTFEngine.js` | 3-timeframe bias alignment pre-gate | 2 |
| Risk Manager | `src/core/RiskManager.js` | Position sizing, dynamic rules, drawdown protection | 3 |
| Regime Engine | `src/core/RegimeEngine.js` | Regime classification, weight adjustment output | 2 |
| Learning Engine | `src/core/LearningEngine.js` | Win rate analytics, weight proposals | 7 |

### 3.2 AI Committee Agents

| Agent | File | Weight | Primary Data Source | Phase |
|-------|------|--------|---------------------|-------|
| Technical Analyst | `src/agents/TechnicalAnalyst.js` | 35% | OHLCV candles | 2 |
| Macro Analyst | `src/agents/MacroAnalyst.js` | 20% | Central Bank Memory, FRED | 2 |
| Positioning Analyst | `src/agents/PositioningAnalyst.js` | 10% | COT history, DXY | 2 |
| News Analyst | `src/agents/NewsAnalyst.js` | 20% | News memory, news events | 2 |
| Risk Analyst | `src/agents/RiskAnalyst.js` | 15% | ATR, regime, economic events | 2 |
| Orchestrator | `src/agents/CommitteeOrchestrator.js` | — | All agents | 2 |

### 3.3 Memory Layer

| Module | File | Stores | Phase |
|--------|------|--------|-------|
| Central Bank Memory | `src/memory/CentralBankMemory.js` | Fed/ECB stance history, policy momentum | 6 |
| News Memory | `src/memory/NewsMemory.js` | Rolling 24h/7d/30d sentiment windows | 6 |
| Economic Memory | `src/memory/EconomicMemory.js` | Surprise score history, forecast vs actual | 6 |
| COT Memory | `src/memory/COTMemory.js` | Weekly CFTC positioning, z-scores | 6 |

### 3.4 Services

| Service | File | Purpose | Phase |
|---------|------|---------|-------|
| Twelve Data | `src/services/TwelveDataService.js` | Real-time price + OHLCV | 1 |
| FRED | `src/services/FREDService.js` | Macro economic data | 6 |
| News API | `src/services/NewsAPIService.js` | Financial headlines | 6 |
| COT | `src/services/COTService.js` | CFTC positioning data | 6 |
| Calendar | `src/services/CalendarService.js` | Economic events | 6 |
| Sim Data | `src/services/SimDataService.js` | Fallback simulation | 1 |
| Normalizer | `src/services/DataNormalizer.js` | Unified format conversion | 6 |

---

## 4. Data Flow

```
External APIs
    ↓
DataNormalizer.js
  └─ Standardizes all external data to internal formats
    ↓
AppState.js (in-memory cache)
  └─ Single source of truth for runtime state
    ↓
Memory Layer
  └─ CB memory · News memory · COT history
  └─ Provides contextual intelligence beyond single data point
    ↓
RegimeEngine.run(candles)
  └─ Outputs: regime label + weight_adjustment JSON
  └─ Writes to: market_regime_history
    ↓
MTFEngine.run(candles_1d, candles_4h, candles_1h)
  └─ Outputs: mtf_score + mtf_state + confidence_adj
  └─ If NOT_ALIGNED: pipeline stops, NO_TRADE returned
    ↓
CommitteeOrchestrator.run(appState)
  └─ Runs all 5 agents with regime-adjusted weights
  └─ Collects votes + computes verdict
  └─ Writes to: committee_votes
    ↓
DecisionEngine.run(votes, regime, mtf)
  └─ Weighted aggregation + confidence calculation
  └─ Applies all gates (confidence, RR, agents, MTF, drawdown)
  └─ Outputs: 8-state signal_strength + full signal spec
    ↓
RiskManager.calc(signal, profile)
  └─ Reads: account_profile · regime · risk_score
  └─ Applies: 4 sequential multipliers
  └─ Outputs: lot_size + max_loss + expected_profit
    ↓
SignalGenerator.assemble()
  └─ Attaches AI Macro Report (EN + ZH)
  └─ Attaches per-agent explanation
  └─ Assembles complete signal record
    ↓
Database write
  └─ signals table
  └─ committee_votes table
  └─ market_snapshots table
  └─ signal_audit_log (immutable)
    ↓
UI render
  └─ All panels update from AppState
    ↓
Paper Trading Engine (if user submits)
  └─ paper_trades record created
  └─ On close: signal_results written
    ↓
LearningEngine.analyze()
  └─ Reads signal_results + committee_votes
  └─ Computes metrics + proposals
  └─ Writes to: learning_snapshots
```

---

## 5. Decision Flow

```
INPUT: 5 agent scores (0–100, higher = more bearish EUR/USD)
       + regime (from RegimeEngine)
       + mtf_result (from MTFEngine)
       + account_profile (from AccountState)

STEP 0 — MTF Pre-Gate
  IF mtf_state = 'not_aligned'
    → output: NO_TRADE
    → log to signal_audit_log
    → STOP (do not proceed)

STEP 1 — Apply regime-adjusted weights
  Read active row from committee_weights table
  Apply regime override from regime_weights JSONB if regime matches
  Validate weights sum to 1.00

STEP 2 — Compute directional score (excluding Risk agent)
  directional_score = (tech × w_tech + macro × w_macro +
                       pos × w_pos + news × w_news)
                      / (1 - w_risk)
  Range: 0–100 (>50 = bearish, <50 = bullish)

STEP 3 — Compute final confidence with adjustments
  base_confidence = |directional_score - 50| × 2
  risk_penalty    = max(0, (risk_score - 55) × 0.3)
  mtf_adjustment  = +10 (fully_aligned)
                  | +5  (partially_aligned)
                  | -15 (primary_only / counter-trend)
                  | 0   (not_aligned → already stopped)
  final_confidence = clamp(base_confidence - risk_penalty + mtf_adjustment, 0, 100)

STEP 4 — Count agent agreement
  agents_agreeing = count of agents whose vote matches directional direction
  (Risk Analyst vote = NEUTRAL counts as 0.5)

STEP 5 — Map to 8-state output
  directional_score > 75  AND confidence ≥ 75  AND agents ≥ 4 → STRONG_SELL
  directional_score 65–75 AND confidence ≥ 65  AND agents ≥ 3 → SELL
  directional_score 58–65 AND confidence ≥ 55  AND agents ≥ 3 → WEAK_SELL
  directional_score 45–58                                      → NEUTRAL
  directional_score 35–42 AND confidence ≥ 55  AND agents ≥ 3 → WEAK_BUY
  directional_score 25–35 AND confidence ≥ 65  AND agents ≥ 3 → BUY
  directional_score < 25  AND confidence ≥ 75  AND agents ≥ 4 → STRONG_BUY
  confidence < min_threshold OR agents < 3                     → NO_TRADE

STEP 6 — Hard gates (any failure → NO_TRADE)
  final_confidence < min_confidence_threshold  → NO_TRADE
  rr_ratio < 1.5                               → NO_TRADE
  regime = 'volatile' AND risk_score > 80      → NO_TRADE
  account_profile.consecutive_losses ≥ 5       → NO_TRADE + alert
  account_profile.current_drawdown ≥ limit     → NO_TRADE + system halt

OUTPUT:
{
  signal_strength:   string,   // 8-state enum
  direction:         string,   // 'BUY' | 'SELL' | 'NEUTRAL'
  final_score:       number,   // 0–100
  final_confidence:  number,   // 0–100
  agents_agreeing:   number,
  explanation:       array,    // per-category reasons EN + ZH
  gate_results:      object,   // which gates passed/failed
  price_levels:      object    // entry, sl, tp1, tp2, pips, rr
}
```

---

## 6. Risk Flow

```
INPUT:
  account_balance     from account_profiles
  risk_profile        conservative(1%) | standard(2%) | aggressive(5%)
  sl_pips             from Decision Engine output
  tp_pips             tp2_pips from Decision Engine output
  regime              from RegimeEngine
  risk_score          from Risk Analyst (0–100)
  consecutive_losses  from account_profiles
  win_rate_20         last 20 trades win rate from learning_snapshots

STEP 1 — Base calculation
  risk_amount      = account_balance × risk_pct
  pip_value        = $10 per pip per standard lot (EUR/USD)
  base_lot_size    = risk_amount / (sl_pips × pip_value)
  max_loss         = base_lot_size × sl_pips × pip_value
  expected_profit  = base_lot_size × tp_pips × pip_value
  rr_ratio         = tp_pips / sl_pips

STEP 2 — Apply multipliers (in sequence, each reduces previous result)

  regime_multiplier:
    trending_bull / trending_bear  → 1.00
    ranging                        → 0.75
    volatile                       → 0.50
    breakout_up / breakout_down    → 1.00

  drawdown_multiplier:
    consecutive_losses 0–2         → 1.00
    consecutive_losses 3           → 0.75
    consecutive_losses 4           → 0.50
    consecutive_losses ≥ 5         → 0.25 + alert triggered

  performance_multiplier:
    win_rate_20 < 0.40             → 0.75 (underperforming)
    win_rate_20 0.40–0.70          → 1.00 (standard)
    win_rate_20 ≥ 0.70             → 1.00 (no bonus — conservative)

  risk_score_multiplier:
    risk_score < 40                → 1.25
    risk_score 40–55               → 1.00
    risk_score 55–70               → 0.75
    risk_score 70–85               → 0.50
    risk_score > 85                → 0.25

STEP 3 — Final lot size
  final_lot = base_lot_size × all four multipliers
  round to nearest 0.01
  clamp: min = 0.01, max = account_balance / 2000

STEP 4 — Risk level classification
  effective_risk = (final_lot × sl_pips × pip_value) / account_balance
  < 1.0%  → LOW      (green)
  1–2%    → STANDARD (amber)
  2–5%    → ELEVATED (orange)
  > 5%    → HIGH     (red + warning)

STEP 5 — System halt check
  IF account_profile.current_drawdown ≥ max_drawdown_limit
    → system_halt = true
    → output NO_TRADE
    → display alert in UI
    → log to signal_audit_log (severity: critical)
```

---

## 7. AI Committee Flow

```
FOR each agent IN [technical, macro, positioning, news, risk]:

  agent.run(candles, appState, memoryLayer)

  Returns:
  {
    score:      number,    // 0–100 (higher = more bearish)
    vote:       string,    // 'BUY' | 'SELL' | 'NEUTRAL'
    confidence: number,    // 0–100
    reason_1:   string,    // primary reason (EN, displayed via i18n)
    reason_2:   string     // secondary reason
  }

  Written to committee_votes table.

CommitteeOrchestrator:

  sell_weight = sum(weight of agents voting 'SELL')
  buy_weight  = sum(weight of agents voting 'BUY')
  neutral_weight = remainder

  direction   = sell_weight > buy_weight ? 'SELL' : 'BUY'
  confidence  = max(sell_weight, buy_weight) × 100

  Returns:
  {
    votes:   VoteObject[5],
    verdict: { direction, confidence, sell_weight, buy_weight }
  }

Weight validation:
  Sum of all weights must equal 1.00 (enforced by committee_weights trigger)
  If any agent throws: use score = 50 (NEUTRAL fallback), log warning
  All 5 votes always returned — never fewer
```

---

## 8. Market Regime Flow

```
RegimeEngine.run(candles):

STEP 1 — Compute classification indicators
  ADX(14)    — trend strength
  ATR(14)    — absolute volatility
  ATR_ratio  — ATR(14) / ATR_30d_avg
  BB_width   — Bollinger Band width
  BB_width_percentile — vs 30-day range
  MA20, MA50 — moving averages
  price_vs_MA20, price_vs_MA50

STEP 2 — Classify regime (evaluated in priority order)

  VOLATILE:
    ATR_ratio > 1.8 OR VIX > 28 OR spread > 3× normal
    OR major news event within 2 hours
    → priority classification (safety first)

  BREAKOUT_UP:
    price closes above BB_upper
    AND ADX rising from below 25
    AND previous 5 candles were RANGING

  BREAKOUT_DOWN:
    price closes below BB_lower
    AND ADX rising from below 25
    AND previous 5 candles were RANGING

  TRENDING_BEAR:
    price < MA20 < MA50
    AND ADX > 25
    AND BB_width expanding (percentile > 50)

  TRENDING_BULL:
    price > MA20 > MA50
    AND ADX > 25
    AND BB_width expanding (percentile > 50)

  RANGING:
    ADX < 20
    AND BB_width contracting (percentile < 30)
    (default if no other condition met)

STEP 3 — Output weight_adjustment JSON
  Each regime maps to specific agent weights
  Volatile: risk weight raised to 0.30
  Trending: technical weight raised to 0.45
  Ranging: macro + positioning weights raised

STEP 4 — Output position_size_multiplier
  trending:   1.00
  ranging:    0.75
  volatile:   0.50
  breakout:   1.00

STEP 5 — Write to market_regime_history
  One row per regime change
  One snapshot every 4H regardless

STEP 6 — Return to Decision Engine
  Decision Engine reads weight_adjustment before aggregating votes
```

---

## 9. Learning Engine Flow

```
TRIGGER: Every 10 closed trades (paper or live)

STEP 1 — Compute performance metrics
  Source: signal_results table (all closed trades)

  win_rate      = count(outcome='win') / count(all closed)
  profit_factor = sum(profit_r where win) / abs(sum(profit_r where loss))
  sharpe_ratio  = mean(daily_r) / std(daily_r) × sqrt(252)
  max_drawdown  = max peak-to-trough loss in R
  expectancy    = (win_rate × avg_win_r) - (loss_rate × avg_loss_r)
  avg_rr        = mean(profit_r / risk_r) where win

STEP 2 — Per-agent accuracy
  Source: committee_votes WHERE was_correct IS NOT NULL
  GROUP BY agent
  agent_win_rate[agent] = AVG(was_correct::int)

STEP 3 — Run optimization rules

  RULE 1 — Technical dominance
    IF agent_win_rate['technical'] > 0.70 for last 20 trades
    AND agent_win_rate['macro'] < 0.55
    THEN propose: technical_weight += 0.05, macro_weight -= 0.05

  RULE 2 — News noise reduction
    IF agent_win_rate['news'] < 0.50 for last 15 trades
    THEN propose: news_weight -= 0.05, risk_weight += 0.05

  RULE 3 — Confidence threshold lift
    IF win_rate of signals with confidence < 65% < 0.50
    THEN propose: raise min_confidence_default to 70

  RULE 4 — Volatile regime block
    IF win_rate of volatile regime signals < 0.40 for 10+ volatile trades
    THEN propose: add 'volatile' to account_profile.blocked_regimes

  RULE 5 — RR distance optimization
    IF avg_rr_achieved < 1.8 (target = 2.6)
    THEN propose: reduce tp2_pips to 100 (from 130) for next 20 trades

STEP 4 — Write to learning_snapshots
  proposed_changes = { ... } JSONB
  changes_approved = false (requires user action)
  All metrics written for historical record

STEP 5 — Historical similarity scoring (per new signal)
  Build feature vector from market_snapshots for new signal:
    [rsi_14, macd_hist_norm, bb_position, adx_14, atr_ratio,
     news_sentiment_24h, us_de_spread, dxy_trend_code]
  Compute cosine_similarity vs last 300 closed signals
  Take top 10 with similarity > 0.85
  Compute win_rate of those 10 trades
  Apply confidence adjustment:
    top_10_win_rate ≥ 0.70  → confidence += 5%
    top_10_win_rate 0.50–0.70 → no change
    top_10_win_rate < 0.40  → confidence -= 10%
    sample < 5 similar      → no adjustment
```

---

## 10. ZH/EN Internationalization Strategy

### Principle
**English is the source of truth. Chinese is the display layer.**

### File Structure
```
src/i18n/
  en.json   ← All keys defined here first. This file is authoritative.
  zh.json   ← Mirror of all keys in en.json. Chinese values.
  i18n.js   ← t(key), setLang(lang), getLang(), locale formatters
```

### Rules (non-negotiable)

1. Zero hardcoded strings in any component, engine, or agent file
2. All user-visible text uses `t('namespace.key')`
3. AI Macro Reports stored in both `summary_en` and `summary_zh` columns
4. Agent `reason_1` and `reason_2` generated in EN; ZH templates in `i18n/zh.json`
5. Language state persisted in `localStorage` and `AccountState`
6. Language switch triggers full UI re-render via custom DOM event — no page reload
7. Central Bank `key_quote` stored in EN only; displayed with `原文` (original text) label
8. Number formatting uses locale-aware formatters from `i18n.js`
9. Date/time formatting respects `account_profile.timezone`

### Key Namespaces
```
nav.*         Navigation labels
signal.*      Signal direction labels (BUY, SELL, STRONG_BUY, etc.)
risk.*        Risk Manager labels
agents.*      Agent names, roles, and reason templates
regime.*      Regime classification labels
decision.*    Decision Engine labels
mtf.*         MTF Engine labels and states
paper.*       Paper Trading labels
settings.*    Settings page labels
calendar.*    Economic calendar labels
news.*        News impact labels
errors.*      Error messages
common.*      Shared labels (loading, save, cancel, apply, etc.)
```

### Future Language Expansion
To add French (for West/Central Africa expansion):
1. Create `src/i18n/fr.json` (copy `en.json`, translate values)
2. Add `'fr'` to supported languages array in `i18n.js`
3. Add `summary_fr` column to `macro_reports` table
4. No engine, agent, or component file changes required

---

## 11. Future Scalability Strategy

### Frontend Scalability
```
Phase 1–4: Single HTML file + modular ES6 JS + CSS files
Phase 5+:  Supabase integration (no framework change needed)
Phase 8+:  Potential Next.js migration if SSR or mobile app needed
Mobile:    Responsive CSS from Phase 1 onwards
           Claude iOS app compatible via localStorage API key
```

### Database Scalability
```
Supabase PostgreSQL handles 10M+ rows without configuration
Partition signals + signal_results by month after 10,000 rows
Partition signal_audit_log by month after 6 months
Archive audit events older than 1 year (keep signal lifecycle forever)
After 5,000 market_snapshots: compute feature vectors in
  snapshot_vectors table for faster cosine similarity queries
```

### Multi-User Scalability
```
account_profiles supports unlimited profiles per user
Row-Level Security isolates all data per user
committee_weights are per-user (future: shared institutional configs)
Signal history queryable per-user with fast indexes
```

### API Scalability
```
api_health table enables intelligent fallback management
Rate limit tracking prevents quota exhaustion automatically
Service layer is pluggable:
  Swap Twelve Data for Polygon with one service file change
  Add Finnhub alongside NewsAPI with one service file addition
DataNormalizer.js ensures all services return identical formats
```

### Learning Engine Scalability
```
Regime-stratified learning prevents overfitting to one market condition
Weight change approval requirement prevents runaway optimization
Historical similarity uses pre-computed vectors after 500 signals
Agent win rates computed via indexed SQL queries — O(1) at scale
```

---

## Revision History

| Revision | Date | Changes | Approved By |
|----------|------|---------|-------------|
| 0 (Draft) | 2026-06 | Initial architecture design | — |
| 1 (Final) | 2026-06 | Added: account_profiles, api_health, signal_audit_log, committee_weights tables; MTF Engine; 5th Positioning Agent | Rolan/ONETO |

---

*Last updated: 2026-06*  
*Next revision required if: any module scope changes, new table added, interface contract changes, or agent weight defaults change.*
