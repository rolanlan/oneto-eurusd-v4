# ONETO V5 Development Backlog

| Field | Value |
|-------|-------|
| **Baseline Version** | V4.6 (commit: 7f643b1) |
| **Document Created** | 2026-06-05 |
| **Purpose** | Complete task pool for V5.0 through V5.6 and beyond |
| **Status** | ACTIVE — tasks may be added; items are not removed, only marked DONE |

This document is the single source of truth for all unresolved issues, known risks, and future development items discovered or confirmed as of V4.6 Freeze. Every item references its source: audit finding, bug history, or architecture review.

---

## Part 1 — Critical Issues (Must Resolve Before Production Use)

### BACKLOG-001 — Decision Gate Too Restrictive for Current Data State

**Priority:** P0  
**Source:** V5.0 Signal Reality Audit, Audit F  
**Version target:** V5.2

**Problem:**
The confidence gate (`finalConf ≥ 65%`) blocks >80% of signals in the V4.6 data state (COT=stub, News coverage=low). `dirScore` typically falls 60–75, producing `baseConf = 20–50%`. The gate is calibrated for a fully-populated data state that does not yet exist.

**Impact:**
- Unusable signal frequency for end users
- Users see `NO_TRADE` on nearly every signal generation cycle
- No distinction between "market is genuinely unclear" and "we lack data to assess"

**Required work:**
1. Add `data_completeness_score` field to signal: count of agents with real (non-stub) data sources
2. When `data_completeness_score < 3`, set `effective_min_confidence = 50` (not 65)
3. Add new NO_TRADE reason: `INSUFFICIENT_DATA` (separate from `LOW_CONFIDENCE`)
4. Update `DecisionPanel._buildScoreDisplay()` to show different messages for these two cases:
   - `LOW_CONFIDENCE`: "Direction unclear — market is genuinely uncertain"
   - `INSUFFICIENT_DATA`: "Data missing — configure FRED/Finnhub keys or wait for COT"
5. Review `agent_agreement_pass` (≥3) — with stub agents trending neutral, this gate also blocks excessively. Consider `≥2` when data_completeness < 3.

**Files to modify:**
- `src/core/SignalEngine.js` (gate logic)
- `src/components/DecisionPanel.js` (display)
- `src/types/Signal.js` (new field)

---

### BACKLOG-002 — Finnhub News Coverage Zero on Free Tier

**Priority:** P0  
**Source:** V5.0 Signal Reality Audit, Audit C; BUG-04 history  
**Version target:** V5.1

**Problem:**
`category=general` with `RELEVANCE_KW` keyword filtering frequently produces `headline_count_24h = 0`. When count = 0, NewsAnalyst confidence multiplier = 0.49 and the agent contributes nothing to the committee.

**Root cause analysis:**
The general Finnhub news feed covers all sectors. EUR/USD-specific keywords (eur, usd, ecb, fed, fomc, cpi, gdp, nfp, payroll, rate, inflation, etc.) may not appear in enough general news articles during quiet market sessions.

**Required work — Option A (preferred, free):**
1. Expand `RELEVANCE_KW` to include broader financial terms: 'central bank', 'monetary', 'yield', 'bonds', 'treasury', 'jobless', 'pce', 'ism', 'markit'
2. Add `category=forex` as a secondary attempt: if `category=general` returns count=0, retry with `category=forex` (will 401 on free tier but document outcome)
3. Fetch from multiple Finnhub endpoints in parallel: `category=general` + `category=economics`
4. Lower the relevance filter to "at least one keyword match in headline OR source is Reuters/Bloomberg/WSJ"

**Required work — Option B (paid tier):**
1. Upgrade to Finnhub Basic ($0/month with higher limits) or paid tier
2. Reinstate `category=forex` endpoint access

**Files to modify:**
- `src/services/FinnhubService.js` (RELEVANCE_KW array, fetch logic)

---

### BACKLOG-003 — COT Data Missing

**Priority:** P1  
**Source:** V4.6 known issue, BUG-COT history  
**Version target:** V5.4

**Problem:**
PositioningAnalyst's COT z-score component (±30 points, largest single component in any agent) is permanently zero. The agent's 20% committee weight delivers <40% of its designed information content.

**Root cause:**
CFTC direct browser fetch causes CORS errors and 404s. COTService disabled in V4.6.

**Required work:**
1. Register for Nasdaq Data Link free account (`data.nasdaq.com`)
2. Find CFTC EUR futures dataset (likely `CFTC/CO_FUT` or `CFTC/NAT_GAS` — need to verify EUR/USD futures contract identifier)
3. Rewrite `COTService._fetchCSV()` to use Nasdaq Data Link API:
   `https://data.nasdaq.com/api/v3/datasets/CFTC/{code}/data.json?api_key={key}&rows=55`
4. Add `nasdaq_data_link_key` to SettingsPanel API section
5. Add localStorage key `nasdaq_dl_api_key_v5`
6. Re-enable `COTService.getCOTBundle()` — remove early stub return
7. Test 52-week z-score computation with real history
8. Verify PositioningAnalyst contrarian signal fires at z > 2.0

**Files to modify:**
- `src/services/COTService.js` (full rewrite of fetch section)
- `src/components/SettingsPanel.js` (add API key input)
- `src/services/MemoryAggregator.js` (no change expected if interface preserved)

---

### BACKLOG-004 — Synthetic DXY Is EUR/USD Mirror

**Priority:** P1  
**Source:** V5.0 Signal Reality Audit, Audit A  
**Version target:** V5.3

**Problem:**
`synthetic_DXY = (1 / EUR_USD) × 1.0479 × 100` contains zero independent information. Real ICE DXY includes JPY (13.6%), GBP (11.9%), CAD (9.1%), SEK/CHF (7.8%). PositioningAnalyst and MacroAnalyst DXY components amplify the EUR/USD price signal rather than adding a genuinely independent factor.

**Required work — Option A (construct from ECB rates):**
ECB publishes daily reference rates for all major currencies free of charge (`https://www.ecb.europa.eu/stats/eurofxref/`). DXY basket can be approximated as:
```
DXY ≈ EUR_weight × f(EUR/USD)
    + JPY_weight × f(USD/JPY from EUR/JPY ÷ EUR/USD)
    + GBP_weight × f(GBP/USD from EUR/USD ÷ EUR/GBP)
    + CAD_weight × f(USD/CAD from EUR/CAD ÷ EUR/USD)
    + SEK_weight × f(USD/SEK from EUR/SEK ÷ EUR/USD)
    + CHF_weight × f(USD/CHF from EUR/CHF ÷ EUR/USD)
```
ECB provides EUR/JPY, EUR/GBP, EUR/CAD, EUR/SEK, EUR/CHF daily. Free, CORS-supported.

**Required work — Option B (Twelve Data paid):**
`DXY` or `DX-Y.NYB` on Twelve Data requires paid subscription. Confirm pricing.

**Files to modify:**
- `src/core/DataProvider.js` (replace synthetic formula)
- `src/services/MemoryAggregator.js` (if ECB requires its own service)
- Potentially new `src/services/ECBService.js`

---

## Part 2 — Signal Quality Improvements

### BACKLOG-005 — Agent Factor Overlap Reduction

**Priority:** P2  
**Source:** V5.0 Signal Reality Audit, Audit E  
**Version target:** V5.3–V5.4

**Problem:**
Multiple agents reference the same underlying data. `us_de_spread` appears in both MacroAnalyst and PositioningAnalyst. Synthetic DXY appears in both. When COT is live and DXY is real, this overlap diminishes naturally. Until then, the committee is computing the same factors multiple times.

**Required work:**
1. After V5.3 (real DXY): verify DXY in MacroAnalyst and PositioningAnalyst now reference different information (MacroAnalyst uses level/trend, PositioningAnalyst uses mean-reversion context)
2. After V5.4 (COT live): re-run factor correlation analysis to verify PositioningAnalyst now provides genuinely orthogonal information
3. Consider: should `us_de_spread` in PositioningAnalyst be replaced with a carry-trade specific metric (e.g., 3-month short-rate differential) rather than the 10Y bond spread? The carry trade is more relevant to positioning.
4. Document updated factor overlap matrix as part of V5.4 freeze review

---

### BACKLOG-006 — MacroAnalyst GDP EU Coverage Gap

**Priority:** P2  
**Source:** Code review  
**Version target:** V5.1

**Problem:**
`gdp_eu_qoq` is hardcoded at `0.2` in `FREDService._fetchAll()` with comment "No good FRED proxy — keep default". The FRED series `CLVMEURSCAB1GQEA19` (Euro area GDP QoQ) exists but was not implemented.

**Required work:**
1. Add `CLVMEURSCAB1GQEA19` to `FREDService.SERIES`
2. Extract EU GDP QoQ from it (series returns QoQ % directly)
3. Replace hardcoded `0.2` fallback with real data

**Files to modify:** `src/services/FREDService.js`

---

### BACKLOG-007 — MacroAnalyst CPI YoY Approximation

**Priority:** P3  
**Source:** Code comment in FREDService  
**Version target:** V5.1

**Problem:**
`_computeYoY()` is called with `limit=3` observations (only 3 data points). For monthly CPI index, true YoY requires the value from 12 months ago. With only 3 points, the computation is a short-period annualized approximation, not a true 12-month YoY comparison.

**Required work:**
1. Change `_fetchSeries(SERIES.CPI_US.id, key, 3)` to `limit=14` to get 13 months of data
2. Update `_computeYoY()` to use `obs[0].value` vs `obs[12].value` (true 12-month comparison)
3. Apply same fix to EU CPI series

**Impact:** Low — the direction of the approximation is usually correct, but the magnitude may be off.

**Files to modify:** `src/services/FREDService.js`

---

### BACKLOG-008 — R/R Gate Is Static (Always Passes)

**Priority:** P2  
**Source:** V4.6 audit  
**Version target:** V5.2

**Problem:**
`rrRatio = DEFAULT_PIPS.TP2 / DEFAULT_PIPS.SL = 130 / 50 = 2.6`. This is a fixed calculation that always passes the 2.0 R/R gate. The gate provides no filtering. A real R/R gate should use dynamic SL/TP levels based on current ATR.

**Required work:**
1. In `_decide()`, receive `indicatorResult.atr` (already computed in pipeline)
2. Compute dynamic SL = `1.5 × ATR14_pips` (approximate)
3. Compute dynamic TP2 = `SL × 2.6` (maintain R/R ratio)
4. Gate: dynamic_rr ≥ 2.0
5. Update `createSignal()` and `computePriceLevels()` to accept dynamic pips

**Note:** This is a frozen component change — requires V5.2 upgrade document.

---

## Part 3 — Infrastructure and Architecture

### BACKLOG-009 — Supabase Integration (Signal History Database)

**Priority:** P1  
**Source:** ONETO architecture plan Phase 5  
**Version target:** V5.5

**Description:**
The `DATABASE_SCHEMA.md` doc defines a 40-table Supabase schema (DATABASE FREEZE V1.5 FINAL). Signal history, paper trade records, and learning engine data should be persisted to Supabase for cross-session continuity and accuracy tracking.

**Required work:**
1. Initialize Supabase connection (`@supabase/supabase-js`)
2. Implement `SignalRepository`: save each generated signal to `signals` table
3. Implement `TradeRepository`: sync paper trades from `PaperExecution.js` to Supabase
4. Signal outcome tracking: on each price refresh, check open signals for SL/TP hit
5. Query historical signals for accuracy dashboard

**Prerequisite:** ONETO GLOBAL platform `DATABASE FREEZE V1.5 FINAL` must remain locked (no schema changes).

---

### BACKLOG-010 — OANDA Practice Broker Integration

**Priority:** P2  
**Source:** `src/execution/ExecutionAdapter.js` design document  
**Version target:** After V5.5

**Description:**
`ExecutionAdapter.js` defines the interface. `OandaExecution.js` has the base URL and auth pattern documented but all methods return `NOT_IMPLEMENTED`.

**Required work:**
1. Implement `src/execution/adapters/OandaPracticeAdapter.js`
2. Methods: `submitOrder`, `closeOrder`, `modifySLTP`, `getPositions`, `getAccount`
3. OANDA v20 REST API: `https://api-fxpractice.oanda.com/v3`
4. Auth: Bearer token in Authorization header
5. Update `ExecutionManager` routing to use `OandaPracticeAdapter`
6. Gate: must complete 100 paper trade validations before OANDA Practice activation is unlocked
7. OANDA Live adapter: requires explicit secondary approval after Practice validation

**Files to create:** `src/execution/adapters/OandaPracticeAdapter.js`  
**Files to modify:** `src/core/ExecutionManager.js`

---

### BACKLOG-011 — Learning Engine

**Priority:** P3  
**Source:** V4.6 roadmap Section 8  
**Version target:** V5.6

**Description:**
Analyze historical signal accuracy to propose regime-specific weight adjustments.

**Required work:**
1. Requires BACKLOG-009 (Supabase) to be complete first — needs signal history
2. Compute per-agent accuracy: for each agent, what % of its SELL votes were followed by price increase (correct), in each regime?
3. Propose new `REGIME_WEIGHTS` based on observed accuracy
4. Implement `AccountState.proposeLearningWeights(proposal)` — stores proposal for user review
5. User must approve any weight change before `AccountState.setWeights()` is called
6. Store weight history in Supabase
7. Constraint: no weight < 0.05, no weight > 0.55, sum must = 1.0

**Frozen component warning:** Changes to `REGIME_WEIGHTS` require a V5.6 upgrade document per Section 10 of the Freeze document.

---

### BACKLOG-012 — Signal Accuracy Review Dashboard

**Priority:** P2  
**Source:** V4.6 roadmap Section 8 (V5.5)  
**Version target:** V5.5

**Description:**
A UI page (or CommitteePanel section) showing historical signal accuracy metrics.

**Required fields:**
- Win rate by signal strength (STRONG_BUY, BUY, WEAK_BUY, etc.)
- Win rate by regime
- Win rate by agent agreement count
- Per-agent accuracy (% of votes in the correct direction)
- Average R achieved vs R targeted
- Maximum adverse excursion (MAE) histogram

**Prerequisite:** BACKLOG-009 (Supabase), BACKLOG-010 (or manual outcome entry)

---

## Part 4 — UI and UX Improvements

### BACKLOG-013 — Agent Card Expand-to-Detail

**Priority:** P3  
**Source:** V4.6 roadmap Section 6 (architecture design)  
**Version target:** V5.1

**Description:**
CommitteePanel agent cards currently show name, score, vote, weight, and 2 reason lines. Full analytical details are hidden.

**Proposed expand-to-detail content:**

| Agent | Expanded detail |
|-------|----------------|
| TechnicalAnalyst | EMA values, RSI reading, MACD histogram, BB position, ADX value, scoring breakdown per component |
| MacroAnalyst | Current FRED values (DGS10, CPI, GDP), Fed/ECB stance scores, spread value, policy momentum direction |
| NewsAnalyst | Top 3 headlines, score per headline, keyword matches, 7D trend comparison |
| PositioningAnalyst | COT z-score (or stub note), DXY level/trend, spread carry value, staleness warning |
| RiskAnalyst | ATR14 vs ATR30, VIX reading, event proximity (hours), regime risk score |

**Implementation:** Each agent card gets an expand button. On click, render a `_buildAgentDetail()` section below the existing card content. No new page needed.

**Files to modify:** `src/components/CommitteePanel.js`

---

### BACKLOG-014 — Settings Page API Status Enhancement

**Priority:** P3  
**Source:** User experience review  
**Version target:** V5.1

**Current state:**
Settings page shows LIVE/CACHE/STUB per service with minimal detail.

**Required additions:**
1. Show `fetched_at` timestamp per service in human-readable format
2. Show circuit breaker status: if `auth_failed = true`, show red "AUTH FAILED — re-enter key" banner for that service
3. FRED: show which 8 series were successfully fetched and their latest values
4. Finnhub: show `headline_count_24h` and `dominant_theme` from last fetch
5. COT: show "Disabled — pending Nasdaq Data Link integration" with link to registration

**Files to modify:** `src/components/SettingsPanel.js`

---

### BACKLOG-015 — Paper Trading Validation Progress Tracker

**Priority:** P2  
**Source:** Architecture plan — validation phases  
**Version target:** V5.2

**Current state:**
`PaperTradePanel` has a validation progress section but the phase targets may not reflect realistic validation requirements.

**Required work:**
1. Define clear validation criteria for each phase:
   - Phase 1 (25 trades): basic functionality confirmed, ≥50% win rate
   - Phase 2 (50 trades): consistent results across different regimes, ≥55% win rate
   - Phase 3 (75 trades): validated in both trending and ranging conditions
   - Phase 4 (100 trades): production-ready, ≥60% win rate, max drawdown < 10%
2. Auto-evaluate phase completion based on `PaperExecution.getStats()`
3. Gate OANDA Practice activation behind Phase 4 completion

**Files to modify:** `src/components/PaperTradePanel.js`, `src/core/PaperExecution.js`

---

## Part 5 — Technical Debt

### BACKLOG-016 — CommitteeEngine.js Is Dead Code

**Priority:** P3  
**Source:** Code review  
**Version target:** Any

**Description:**
`src/core/CommitteeEngine.js` exists as legacy Phase 1 code. `CommitteeOrchestrator.js` superseded it in Phase 4A (BUG-03 fix). `CommitteeEngine.js` is no longer imported anywhere.

**Required work:** Delete `src/core/CommitteeEngine.js`

---

### BACKLOG-017 — OandaExecution.js Methods Mismatch ExecutionAdapter Contract

**Priority:** P2  
**Source:** Code review  
**Version target:** V5 OANDA implementation

**Description:**
`OandaExecution.js` defines 9 methods: `testConnection`, `getAccountSummary`, `getCurrentPricing`, `submitMarketOrder`, `submitLimitOrder`, `closeTrade`, `modifyTrade`, `getOpenTrades`, `getTradeHistory`.

`ExecutionAdapter.js` defines 5 methods: `submitOrder`, `closeOrder`, `modifySLTP`, `getPositions`, `getAccount`.

The method names and signatures do not match. When implementing `OandaPracticeAdapter.js`, the adapter must conform to the `ExecutionAdapter` interface, not `OandaExecution.js`.

**Required work:** `OandaExecution.js` should either be deleted or refactored to implement `ExecutionAdapter`'s interface. Do not use it as a reference for the new adapter.

---

### BACKLOG-018 — i18n Coverage Gaps

**Priority:** P3  
**Source:** Code review  
**Version target:** V5.1

**Description:**
`src/i18n/i18n.js` contains ZH/EN translations but several UI strings added in V4.3–V4.6 (data transparency panel, new Settings sections, NO_TRADE reason labels, DXY synthetic labels) use inline template literals rather than `t()` keys. This means language toggle does not affect them.

**Required work:**
1. Audit all components for hardcoded string literals that appear in both ZH and EN
2. Add `t()` keys for: data source status labels, audit panel titles, NO_TRADE reason labels, DXY description text
3. Add corresponding entries to `src/i18n/i18n.js` EN and ZH objects

---

### BACKLOG-019 — AppState Has No Signal History Array

**Priority:** P2  
**Source:** Architecture review  
**Version target:** V5.5

**Description:**
`AppState._state.lastSignal` holds only the most recently generated signal. There is no in-memory history array. This means the Committee and Decision panels cannot show trend information ("compared to previous signal"). Win rate calculation relies on `PaperExecution.getStats()` rather than signal history.

**Required work:**
1. Add `_state.signalHistory: Signal[]` (max 100 entries, ring buffer)
2. Update `setSignalResult()` to append to history
3. Export `getSignalHistory()` function
4. Use history for: confidence trend chart in HeroPanel, accuracy trend in CommitteePanel

---

### BACKLOG-020 — No Test Suite

**Priority:** P2  
**Source:** Engineering standards  
**Version target:** V5.0

**Description:**
The entire codebase has zero automated tests. All verification is manual (browser console checks). The 14,006-line codebase has no unit tests for: indicator math, agent scoring, SignalEngine gate logic, RiskManager calculations, or data service caching.

**Required work:**
1. Set up Vitest or Jest with ES module support
2. Priority test targets:
   - `src/utils/indicators.js` — all 9 functions, verify against known values
   - `src/core/SignalEngine.js` — gate logic, confidence formula, 8-state mapping
   - `src/core/RiskManager.js` — lot sizing formula, multipliers
   - `src/services/FREDService.js` — cache logic, circuit breaker state
   - `src/services/FinnhubService.js` — same
3. Minimum coverage target: 80% for core/ and utils/

---

## Part 6 — Risk Register

### RISK-001 — Twelve Data API Key Exhaustion

**Risk level:** Medium  
**Description:** Current credit consumption: ~81 credits/day (EUR/USD only). Budget: 800/day. If signal generation frequency increases or candle requests multiply, the free tier could be exhausted. At 800 credits/day, with ~81 per cycle, the budget allows ~9.8 refresh cycles per day — the current 4-minute interval (360 cycles/day) relies heavily on caching.

**Mitigation:** Cache hit rates are high (30s price TTL produces ~45 real requests/day, not 360). Monitor actual credit consumption after V5 data additions. Budget DXY candles at 4h TTL (6 credits/day) — well within budget.

---

### RISK-002 — FRED Monthly Data Latency

**Risk level:** Low  
**Description:** FRED VIXCLS updates daily at ~3:30pm ET. Monthly series (GDP, CPI, UNRATE) update once per month. The 72h localStorage cache means signals can run for 3 days on stale data without the system detecting it as expired.

**Mitigation:** VIXCLS TTL set to 12h localStorage — acceptable. For monthly series, 3-day staleness is negligible given the data updates monthly anyway.

---

### RISK-003 — Finnhub Free Tier Rate Limit

**Risk level:** Low  
**Description:** 60 requests/minute on Finnhub free tier. Current usage: ~30 requests/day. No risk of hitting rate limits at current scale.

**Escalation:** At >1,000 users/day, the 4h cache means each user triggers up to 6 Finnhub calls/day. At 1,000 users: 6,000 calls/day = 4.2 calls/minute. Well within 60/minute limit. Risk emerges above ~10,000 users.

---

### RISK-004 — EUR/USD Historical Candle Availability

**Risk level:** Medium  
**Description:** `getCandles('1D', 60)` requests 60 daily candles (~3 months). `getCandles('4H', 80)` requests 80 × 4H candles (~13 days). MTFEngine and RegimeEngine rely on adequate candle history. If Twelve Data returns fewer candles (weekends, holidays, data gaps), regime classification may default to 'ranging' more often than expected.

**Mitigation:** `_generateSimCandles()` fallback exists. RegimeEngine handles insufficient candle count gracefully.

---

### RISK-005 — Signal Quality Without Real COT (Ongoing)

**Risk level:** High  
**Description:** The PositioningAnalyst's largest component is disabled. The agent's 20% weight in ranging markets contributes minimal independent information. In EUR/USD, institutional positioning data is often the leading indicator for multi-week trends. Without it, the model is technically and macro-oriented but blind to positioning extremes.

**Mitigation:** V5.4 COT integration is the highest-value data addition in the roadmap.

---

### RISK-006 — No Live Execution Safety Net

**Risk level:** High (if user attempts manual execution based on signals)  
**Description:** The platform produces BUY/SELL signals. If a user manually executes based on these signals without understanding the current data quality issues (COT missing, News low coverage, high NO_TRADE rate), they may over-trust the signal reliability.

**Mitigation:** 
- V4.6 data transparency panel shows STUB/LIVE status per service
- NO_TRADE reason is displayed clearly (post BUG-07 fix)
- Settings page shows `FRED Macro (CACHE = real data cached)` note
- V5.2 (BACKLOG-001) will add `INSUFFICIENT_DATA` reason to make data gaps explicit
- Paper trading validation (BACKLOG-015) gates live execution

---

## Summary: Task Counts by Priority

| Priority | Count | Description |
|----------|-------|-------------|
| P0 | 2 | Must resolve before production signal reliability (BACKLOG-001, 002) |
| P1 | 3 | High-impact improvements (BACKLOG-003, 004, 009) |
| P2 | 8 | Important quality and infrastructure items |
| P3 | 7 | Quality-of-life and completeness items |
| **Total** | **20** | |

---

## Version Assignment Summary

| Version | Primary Backlog Items |
|---------|----------------------|
| V5.0 | BACKLOG-020 (test suite), BACKLOG-016 (dead code) |
| V5.1 | BACKLOG-002 (news coverage), BACKLOG-006 (EU GDP), BACKLOG-007 (CPI YoY), BACKLOG-013 (agent detail), BACKLOG-014 (settings), BACKLOG-018 (i18n) |
| V5.2 | BACKLOG-001 (gate calibration), BACKLOG-008 (dynamic R/R), BACKLOG-015 (paper validation) |
| V5.3 | BACKLOG-004 (real DXY), BACKLOG-005 (factor overlap) |
| V5.4 | BACKLOG-003 (COT), BACKLOG-005 (continued) |
| V5.5 | BACKLOG-009 (Supabase), BACKLOG-012 (accuracy dashboard), BACKLOG-019 (signal history) |
| V5.6 | BACKLOG-011 (learning engine) |
| Post V5.5 | BACKLOG-010 (OANDA Practice), BACKLOG-017 (adapter refactor) |

---

*Document version: V5-BACKLOG-001 | Created: 2026-06-05 | Baseline: V4.6 commit 7f643b1*  
*This document is a living task pool. Items are added but never deleted — only marked DONE with completion date.*
