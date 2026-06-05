# ONETO EUR/USD AI Trading Platform
## Version Freeze: V4.6

| Field | Value |
|-------|-------|
| **Freeze Version** | V4.6 |
| **Freeze Date** | 2026-06-05 |
| **Git Commit** | 7f643b1 |
| **Status** | ENGINEERING STABLE BASELINE |
| **Next Version** | V5.0 (backlog: ONETO_V5_BACKLOG.md) |

This document is the authoritative record of the ONETO EUR/USD AI Trading Platform at its first engineering-stable version. All future development — V5.0 through V6 — must reference this document as its baseline. No core scoring formula, agent weight, or Signal Engine gate threshold may be changed without a new version upgrade document approved in advance.

---

## Section 1 — Platform Overview

### 1.1 Project Purpose

ONETO is a browser-based AI-assisted signal generation tool for the EUR/USD currency pair. It combines real-time technical analysis, macroeconomic data, news sentiment, and institutional positioning into a structured committee voting model to produce actionable trading signals.

It is built as a single-page application using plain ES6 JavaScript modules with no framework dependencies. All data processing runs client-side in the browser.

### 1.2 System Positioning

ONETO sits between a raw charting tool and a full algorithmic trading system. It:

- Fetches real market data from external APIs (Twelve Data, FRED, Finnhub)
- Runs a five-agent AI committee that votes on market direction
- Applies a multi-gate decision engine to filter low-quality signals
- Computes position sizing via a rule-based risk manager
- Supports paper trading for signal validation
- Does not execute live trades in V4.6 (execution adapter is designed but not implemented)

### 1.3 Target Users

The platform is designed for:

- Self-directed EUR/USD traders seeking a structured analytical framework
- Traders learning to combine technical and fundamental analysis
- Developers extending the platform toward semi-automated or automated trading

The language interface is Chinese / English bilingual (ZH/EN toggle). Primary development context is Libreville, Gabon (Africa/Libreville timezone default).

### 1.4 Core Features in V4.6

| Feature | Status |
|---------|--------|
| Real-time EUR/USD price via Twelve Data | ✅ Live |
| 4H/1H/1D K-line chart (TradingView) | ✅ Live |
| MACD / RSI sub-charts (Chart.js) | ✅ Live |
| 5-agent AI Committee | ✅ Live |
| Decision Engine (8-state output) | ✅ Live |
| Risk Manager (lot sizing, 4 multipliers) | ✅ Live |
| Paper Trading | ✅ Live |
| FRED macroeconomic data | ✅ Live (requires FRED API key) |
| Finnhub news sentiment | ✅ Live (requires Finnhub API key) |
| Synthetic DXY (EUR/USD derived) | ✅ Live (no API key needed) |
| COT institutional positioning | ⚠️ Stub (CFTC CORS, pending Nasdaq Data Link) |
| Live broker execution (OANDA/IC Markets) | ❌ Not implemented (ExecutionAdapter design only) |
| Signal history database | ❌ Not implemented (Phase 5 / Supabase) |
| Learning Engine | ❌ Not implemented (Phase 7) |

---

## Section 2 — System Architecture

### 2.1 Complete File Structure

```
oneto-eurusd-v4/
├── index.html                          Entry point, bootstrap module
├── styles/
│   ├── base.css                        CSS variables, reset, utilities
│   ├── layout.css                      App shell, sidebar, topbar, content grid
│   ├── components.css                  HeroPanel, SettingsPanel, shared UI
│   ├── committee.css                   CommitteePanel
│   ├── decision.css                    DecisionPanel
│   ├── kline.css                       KLinePanel
│   ├── paper-trade.css                 PaperTradePanel
│   └── risk-manager.css                RiskManagerPanel
└── src/
    ├── agents/
    │   ├── CommitteeOrchestrator.js    Runs all 5 agents, MTF gate, verdict
    │   ├── TechnicalAnalyst.js         Price/indicator analysis
    │   ├── MacroAnalyst.js             Fed/ECB/GDP/CPI/spread analysis
    │   ├── PositioningAnalyst.js       COT positioning + carry analysis
    │   ├── NewsAnalyst.js              News sentiment aggregation
    │   └── RiskAnalyst.js              ATR/VIX/event risk analysis
    ├── components/
    │   ├── HeroPanel.js                Dashboard: price, signal, confidence ring
    │   ├── CommitteePanel.js           AI Committee: 5 agent cards + verdict
    │   ├── DecisionPanel.js            Decision Engine: gates, scores, audit trail
    │   ├── RiskManagerPanel.js         Risk calculator: lot sizing, P&L
    │   ├── KLinePanel.js               K-line chart + MACD/RSI sub-charts
    │   ├── PaperTradePanel.js          Paper trading journal
    │   └── SettingsPanel.js            API keys, account, data status
    ├── core/
    │   ├── DataProvider.js             Twelve Data API + DXY synthetic
    │   ├── SignalEngine.js             Master pipeline orchestrator
    │   ├── DecisionEngine.js           8-state decision logic (imported by SignalEngine)
    │   ├── CommitteeEngine.js          Legacy (superseded by CommitteeOrchestrator)
    │   ├── MTFEngine.js                Multi-timeframe alignment gate
    │   ├── RegimeEngine.js             Market regime classifier (6 regimes)
    │   ├── RiskManager.js              Lot sizing with 4 multipliers
    │   ├── MarketSnapshotEngine.js     Snapshot capture for audit trail
    │   ├── PaperExecution.js           Paper trade storage/stats
    │   ├── OandaExecution.js           OANDA interface (NOT_IMPLEMENTED)
    │   └── ExecutionManager.js         Broker routing (NOT_IMPLEMENTED)
    ├── execution/
    │   └── ExecutionAdapter.js         Multi-broker interface contract (design only)
    ├── services/
    │   ├── MemoryAggregator.js         Aggregates all data services → memoryLayer
    │   ├── FREDService.js              FRED API client + circuit breaker
    │   ├── FinnhubService.js           Finnhub news/calendar + circuit breaker
    │   ├── COTService.js               COT client (disabled, returns stub)
    │   └── SimDataService.js           Simulated OHLCV fallback (no TD key)
    ├── state/
    │   ├── AppState.js                 Market data state, signal results, event bus
    │   └── AccountState.js             Account profile, risk limits, drawdown tracking
    ├── types/
    │   ├── Signal.js                   Signal record type, DEFAULT_PIPS, SIGNAL_STRENGTH
    │   ├── Vote.js                     Vote type, AGENT_META, REGIME_WEIGHTS, aggregateVotes
    │   └── MarketSnapshot.js           Snapshot type for audit trail
    ├── utils/
    │   ├── indicators.js               EMA, RSI, MACD, BB, ATR, ADX, Stochastic
    │   ├── formatters.js               Price/lot/pct/time formatters
    │   └── validators.js               Input validation helpers
    └── i18n/
        └── i18n.js                     ZH/EN translation strings (inlined JS objects)
```

**Total source: ~14,006 lines across 39 JS files + 8 CSS files**

### 2.2 Full Data Flow / Call Chain

```
════════════════════════════════════════════════════════════════════
TRIGGER: AppState.stateUpdated event (every 4 minutes via startAutoRefresh)
         OR: manual "Generate Signal" button click
════════════════════════════════════════════════════════════════════

index.html: generateSignal()
│
├─ MemoryAggregator.getMemoryLayer()               [2-min aggregate cache]
│   ├─ FREDService.getMacroBundle()
│   │   └─ api.stlouisfed.org/fred  (8 series, 72h cache)
│   │       DGS10, IRLTLT01DEM156N, A191RL1Q225SBEA,
│   │       CPIAUCSL, CP0000EZ19M086NEST, VIXCLS,
│   │       UNRATE, LRHUTTTTEZQ156S
│   │   circuit breaker: stops on 400/401/403
│   │
│   ├─ DataProvider.getDXYPrice() + getDXYCandles()
│   │   └─ Synthetic: DXY = (1 / EUR_USD) × 1.0479 × 100
│   │       No API call. Derived from current EUR/USD price.
│   │
│   ├─ FinnhubService.getNewsBundle()
│   │   └─ finnhub.io/api/v1/news?category=general  (4h cache)
│   │       keyword-filtered for EUR/USD relevance
│   │   circuit breaker: stops on 401/403
│   │
│   ├─ FinnhubService.getCalendarBundle()
│   │   └─ finnhub.io/api/v1/calendar/economic  (1h cache)
│   │       filtered: country=[US,EU,DE,FR], impact=high
│   │
│   └─ COTService.getCOTBundle()
│       └─ Returns stub immediately. No network call.
│           (CFTC CORS blocked. Pending Nasdaq Data Link.)
│
└─ SignalEngine.run({ accountProfile, memoryLayer })
    │
    ├─ DataProvider.getPrice()      EUR/USD spot (30s cache)
    ├─ DataProvider.getCandles(4H)  80 candles (4min cache)
    ├─ DataProvider.getCandles(1D)  60 candles (60min cache)
    ├─ DataProvider.getCandles(1H)  80 candles (4min cache)
    │
    ├─ MarketSnapshotEngine.computeIndicators(candles4h)
    │   └─ EMA9/21, MA20/50/200, RSI14, MACD(12,26,9),
    │       BB(20,2), ATR14/30, ADX14, Stochastic(14,3)
    │
    ├─ CommitteeOrchestrator.run({ candles, memoryLayer, ... })
    │   ├─ RegimeEngine.run()
    │   │   └─ Classifies: volatile | breakout_up | breakout_down |
    │   │                   ranging | trending_bull | trending_bear
    │   │
    │   ├─ MTFEngine.run(candles1D, candles4H, candles1H)
    │   │   └─ States: fully_aligned(+10) | partially_aligned(+5) |
    │   │              primary_only(-15) | not_aligned(0,gate_fail)
    │   │
    │   ├─ REGIME_WEIGHTS[regime] → effectiveWeights
    │   │
    │   ├─ TechnicalAnalyst.run(candles, indicatorResult, regime, weight)
    │   ├─ MacroAnalyst.run(memoryLayer, regime, weight)
    │   ├─ PositioningAnalyst.run(memoryLayer, indicatorResult, regime, weight)
    │   ├─ NewsAnalyst.run(memoryLayer, regime, weight)
    │   └─ RiskAnalyst.run(candles, memoryLayer, indicatorResult, regime, weight)
    │
    ├─ [MTF Gate]: if not_aligned → NO_TRADE (votes still returned for UI)
    │
    ├─ _decide(votes, verdict, mtfResult, regime, accountProfile, weights)
    │   ├─ dirScore = Σ(agent.score × agent.weight / wSum)  [excl. Risk]
    │   ├─ direction: >55 SELL, <45 BUY, else NEUTRAL
    │   ├─ baseConf = |dirScore - 50| × 2
    │   ├─ finalConf = baseConf - riskPenalty + MTFadj
    │   │
    │   └─ Gate checks:
    │       mtf_pass:             mtf_state ≠ 'not_aligned'
    │       confidence_pass:      finalConf ≥ 65 (default)
    │       rr_pass:              TP2/SL = 130/50 = 2.6 ≥ 2.0  [always passes]
    │       agent_agreement_pass: agentsAgreeing ≥ 3
    │       drawdown_pass:        no drawdown/consec-loss halt
    │       regime_pass:          not (volatile AND riskScore > 80)
    │
    ├─ 8-state mapping (if all gates pass):
    │   STRONG_SELL/BUY: signalScore>75 & conf≥75 & agents≥4
    │   SELL/BUY:        signalScore>65 & conf≥65 & agents≥3
    │   WEAK_SELL/BUY:   signalScore>58 & conf≥55 & agents≥3
    │   NEUTRAL:         direction is NEUTRAL
    │
    ├─ RiskManager.calc(balance, profile, sl_pips, tp_pips, regime, ...)
    │   └─ lot_size = (balance × risk_pct) / (SL_pips × $10) × m1×m2×m3×m4
    │
    └─ createSignal() → AppState.setSignalResult(result)
        └─ dispatches 'signalGenerated'
            └─ HeroPanel, CommitteePanel, DecisionPanel,
               RiskManagerPanel, PaperTradePanel all re-render
```

---

## Section 3 — Data Sources

### 3.1 Twelve Data (EUR/USD)

| Field | Value |
|-------|-------|
| **Base URL** | `https://api.twelvedata.com` |
| **Key Storage** | `localStorage('td_api_key_eurusd')` |
| **Status** | LIVE (when key configured) / SIM (no key) |
| **Endpoints used** | `/price`, `/time_series` |
| **Symbols** | `EUR/USD` |
| **Candle intervals** | `1H` (80 bars), `4H` (80 bars), `1D` (60 bars) |
| **Price cache TTL** | 30 seconds in-memory |
| **4H/1H cache TTL** | 4 minutes in-memory |
| **1D cache TTL** | 60 minutes in-memory |
| **Fallback** | `SimDataService._generateSimCandles()` — random-walk OHLCV |
| **Free tier** | 800 credits/day. Current usage: ~81 credits/day (EUR/USD only) |

### 3.2 FRED (St. Louis Federal Reserve)

| Field | Value |
|-------|-------|
| **Base URL** | `https://api.stlouisfed.org/fred/series/observations` |
| **Key Storage** | `localStorage('fred_api_key_v4')` |
| **Status** | LIVE (when key configured) / CACHED (within 72h TTL) / STUB (no key) |
| **Series fetched** | DGS10, IRLTLT01DEM156N, A191RL1Q225SBEA, CPIAUCSL, CP0000EZ19M086NEST, VIXCLS, UNRATE, LRHUTTTTEZQ156S |
| **Cache TTL — memory** | 24h (SLOW series: GDP/CPI/UNRATE), 4h (MEDIUM: rates, VIX) |
| **Cache TTL — localStorage** | 72h (SLOW), 24h (MEDIUM: DGS10/DE10Y), 12h (FAST: VIX) |
| **Storage key** | `localStorage('oneto_fred_v1')` |
| **Circuit breaker** | `_authFailed = true` on 400/401/403; no retry until `clearAuthFailure()` |
| **Free tier** | No stated rate limit. Effectively unlimited. |

### 3.3 Finnhub (News + Calendar)

| Field | Value |
|-------|-------|
| **Base URL** | `https://finnhub.io/api/v1` |
| **Key Storage** | `localStorage('finnhub_api_key_v4')` |
| **Status (news)** | LIVE / CACHED / STUB |
| **Status (calendar)** | LIVE / CACHED / STUB |
| **News endpoint** | `/news?category=general` (free tier) |
| **Calendar endpoint** | `/calendar/economic?from=&to=` |
| **News cache TTL** | 4h memory + 4h localStorage |
| **Calendar cache TTL** | 1h memory + 2h localStorage |
| **Storage keys** | `oneto_news_v1`, `oneto_calendar_v1` |
| **Circuit breaker** | Same pattern as FREDService: stops on 401/403 |
| **Important note** | `/news?category=forex` is a PREMIUM endpoint → 401 on free keys. V4.6 uses `category=general` with EUR/USD keyword filtering |
| **Free tier** | 60 requests/minute |

### 3.4 Synthetic DXY

| Field | Value |
|-------|-------|
| **Source** | EUR/USD current price via Twelve Data |
| **Formula** | `synthetic_DXY = (1 / EUR_USD) × 1.0479 × 100` |
| **Status** | DERIVED (real market price, not an independent index) |
| **Cache TTL** | 15 minutes in-memory |
| **Storage key** | `oneto_dxy_price_v1` |
| **Trend computation** | `computeDXYTrend(candles)`: MA5 vs MA20 + 3-day slope velocity |
| **Known limitation** | Real ICE DXY is a 6-currency basket (EUR 57.6%, JPY 13.6%, GBP 11.9%, CAD 9.1%, SEK 4.2%, CHF 3.6%). Synthetic DXY uses only the EUR component. Non-EUR currencies (42.4% of real DXY) are not represented. |

### 3.5 COT (CFTC Commitments of Traders)

| Field | Value |
|-------|-------|
| **Intended source** | `https://www.cftc.gov/dea/futures/deacmesf.zip` |
| **Status** | **STUB** — service disabled |
| **Reason** | CFTC direct browser fetch caused CORS errors and 404s in console on every page load |
| **Current behavior** | `COTService.getCOTBundle()` returns a stub immediately with `cot_z_score_52w = 0, cot_signal = 'neutral'`. Zero network requests. |
| **Impact** | PositioningAnalyst COT scoring component (±30 points) contributes zero. |
| **Resolution path** | Replace with Nasdaq Data Link API (`data.nasdaq.com/data/CFTC`). CORS-supported. Planned for V5.4. |

---

## Section 4 — AI Committee Model

The committee runs once per `generateSignal()` call. All five agents receive the same `memoryLayer` object assembled by `MemoryAggregator`. Agent weights are determined by the current market regime.

### 4.1 Agent Weights by Regime

Defined in `src/types/Vote.js → REGIME_WEIGHTS`:

| Regime | Technical | Macro | Positioning | News | Risk |
|--------|-----------|-------|-------------|------|------|
| `trending_bull` | 0.40 | 0.20 | 0.15 | 0.15 | 0.10 |
| `trending_bear` | 0.40 | 0.20 | 0.15 | 0.15 | 0.10 |
| `ranging` | 0.20 | 0.25 | 0.20 | 0.20 | 0.15 |
| `volatile` | 0.25 | 0.15 | 0.10 | 0.20 | 0.30 |
| `breakout_up` | 0.40 | 0.20 | 0.15 | 0.15 | 0.10 |
| `breakout_down` | 0.40 | 0.20 | 0.15 | 0.15 | 0.10 |
| `DEFAULT` | 0.30 | 0.20 | 0.20 | 0.15 | 0.15 |

**Note:** Risk agent weight is excluded from the `dirScore` calculation in the Decision Engine. `wSum = 1 - risk_weight`. Risk agent weight is used only as a confidence penalty source.

### 4.2 TechnicalAnalyst

**Source file:** `src/agents/TechnicalAnalyst.js`

**Inputs:** `candles` (4H OHLCV), `indicatorResult` (pre-computed), `regime`, `weight`

**Components and score ranges:**

| Component | Range | Indicator |
|-----------|-------|-----------|
| 1. MA Alignment | ±30 | MA20, MA50, MA200 cross |
| 2. EMA Crossover | ±18 | EMA9 vs EMA21 |
| 3. RSI | ±20 | RSI14 (oversold/overbought) |
| 4. MACD | ±22 | MACD(12,26,9) histogram + crossover |
| 5. Bollinger Bands | ±18 | BB(20,2) position + width |
| 6. ADX/Stochastic | ±16 | ADX14 trend strength, Stochastic(14,3) |

**Output:** `Vote { agent: 'technical', score: 0–100, vote: BUY|SELL|NEUTRAL, confidence, weight, reason_1, reason_2 }`

**Score interpretation:** `> 55` → SELL (bearish EUR/USD), `< 45` → BUY (bullish EUR/USD), `45–55` → NEUTRAL

**Data source:** EUR/USD 4H OHLCV candles (LIVE when TD key configured, SIM otherwise). Completely independent of `memoryLayer`.

### 4.3 MacroAnalyst

**Source file:** `src/agents/MacroAnalyst.js`

**Inputs:** `memoryLayer` (FRED + DXY), `regime`, `weight`

**Components and score ranges:**

| Component | Range | Source |
|-----------|-------|--------|
| 1. Fed stance | ±28 | `cb_fed_stance_score` from DGS10 yield level |
| 2. ECB stance | ±22 | `cb_ecb_stance_score` from DE10Y yield level |
| 3. Yield spread | ±16 | `us_de_spread` (DGS10 − DE10Y, from FRED) |
| 4. Policy momentum | ±12 | 3-period DGS10 slope direction |
| 5. Economic divergence | ±10 | GDP diff + CPI diff (FRED) |
| 6. Event risk | confidence multiplier | `upcoming_event_risk` from Finnhub calendar |
| 7. DXY context | ±6 | `dxy_trend` from synthetic DXY |

**Known issue:** Component 7 (DXY ±6) is derived from EUR/USD price — the same data TechnicalAnalyst uses. This creates minor double-counting (~1.2 weighted points).

**Output:** Same Vote structure. Score `> 55` → USD bullish (bearish EUR/USD).

### 4.4 PositioningAnalyst

**Source file:** `src/agents/PositioningAnalyst.js`

**Inputs:** `memoryLayer` (COT + DXY + spread), `indicatorResult`, `regime`, `weight`

**Components and score ranges:**

| Component | Range | Source |
|-----------|-------|--------|
| 1. COT z-score + contrarian | ±30 | `cot_z_score_52w` (STUB in V4.6, always 0) |
| 2. DXY correlation | ±16 | `dxy_trend` synthetic DXY |
| 3. Yield spread carry | ±12 | `us_de_spread` from FRED |
| 4. Data staleness penalty | confidence multiplier | `data_age_days`, `data_source` |

**V4.6 limitation:** Component 1 (COT, ±30) is always zero due to STUB status. Component 2 (DXY, ±16) duplicates EUR/USD price information. Only Component 3 (spread, ±12 from FRED) contributes independent information in V4.6.

**Confidence penalty:** `data_source === 'stub'` → `× 0.70`

### 4.5 NewsAnalyst

**Source file:** `src/agents/NewsAnalyst.js`

**Inputs:** `memoryLayer` (Finnhub news), `regime`, `weight`

**Components and score ranges:**

| Component | Range | Source |
|-----------|-------|--------|
| 1. 24H sentiment | ±30 | `news_net_score_24h` (decay-weighted keyword scoring) |
| 2. High-impact density | confidence multiplier | `high_impact_count_24h` |
| 3. Headline count | confidence multiplier | `headline_count_24h` (< 3 → ×0.65) |
| 4. 7D trend confirmation | ±14 | `news_net_score_7d` |
| 5. Narrative shift penalty | score damp + confidence reduction | `narrative_shift` flag |
| 6. 30D baseline anomaly | diagnostic | `news_net_score_30d` |

**Finnhub sentiment formula:** `score_i = keyword_score(headline + summary) × exp(−age_hours / 24)`. USD-bullish keywords score `+10` each; USD-bearish keywords score `−10` each. Net sum gives `news_net_score_24h`.

**V4.6 limitation:** When `headline_count_24h = 0` (no relevant articles after `category=general` filtering), confidence multiplier falls to `0.75 × 0.65 = 0.49`. NewsAnalyst effectively outputs NEUTRAL with near-zero confidence.

**Confidence penalty:** `data_source === 'stub'` → `× 0.65`

### 4.6 RiskAnalyst

**Source file:** `src/agents/RiskAnalyst.js`

**Inputs:** `candles`, `memoryLayer` (VIX + event risk), `indicatorResult`, `regime`, `weight`

**Components and score ranges:**

| Component | Range | Source |
|-----------|-------|--------|
| 1. ATR volatility ratio | ±35 | `calcATR(14) / calcATR(30)` — real-time computation |
| 2. Event proximity | ±30 | `upcoming_event_risk`, `event_within_hours` (Finnhub) |
| 3. Regime risk | +0 to +22 | `regime` classification |
| 4. VIX context | ±18 | `vix_level` from FRED VIXCLS |
| 5. News blackout | +25 | `news_blackout` flag |
| 6. Spread volatility | ±8 | `spread_current` vs `spread_normal` |

**Score interpretation:** RiskAnalyst score represents risk level, not direction. Score is used as a **confidence penalty** in the Decision Engine: `riskPenalty = max(0, (riskScore − 55) × 0.3)`. High risk score reduces signal confidence; it does not determine direction.

**V4.6 limitation:** VIX is LIVE when FRED key configured; otherwise defaults to `15.0`. Event risk is LIVE when Finnhub key configured; otherwise always `false`.

---

## Section 5 — Signal Engine

**Source file:** `src/core/SignalEngine.js`

### 5.1 Direction Score Formula

```
wSum     = 1 − risk_weight  (Risk agent excluded from direction calculation)

dirScore = round( Σ (agent.score × agent.weight / wSum) )
           for all agents EXCEPT Risk

Scale: 0 = extreme BUY, 50 = neutral, 100 = extreme SELL
Threshold: > 55 → SELL, < 45 → BUY, 45–55 → NEUTRAL
```

### 5.2 Confidence Formula

```
baseConf    = |dirScore − 50| × 2
riskPenalty = max(0, (riskScore − 55) × 0.3)
MTFadj      = confidence_adj from MTFEngine:
                fully_aligned:     +10
                partially_aligned: +5
                primary_only:      −15
                not_aligned:       0 (gate fails before reaching here)

finalConf = clamp(0, 100, round(baseConf − riskPenalty + MTFadj))
```

### 5.3 MTF Gate

**Engine:** `src/core/MTFEngine.js`

The MTF gate checks whether the 1D, 4H, and 1H timeframes are biased in the same direction. Classification is based on composite bias score from MA alignment, RSI, and MACD across timeframes.

| MTF State | Gate | confidence_adj |
|-----------|------|----------------|
| `fully_aligned` | PASS | +10 |
| `partially_aligned` | PASS | +5 |
| `primary_only` | PASS | −15 |
| `not_aligned` | **FAIL → NO_TRADE** | 0 |

**V4.6 fix (BUG-10):** When MTF gate fails, the full `votes` array is still returned to `AppState` so CommitteePanel can display all 5 agent scores. Previously `votes: []` was returned, causing blank CommitteePanel.

### 5.4 Agent Agreement Gate

```
agentsAgreeing = count of agents (excluding Risk) whose vote matches direction
Gate: agentsAgreeing ≥ 3
```

At DEFAULT_WEIGHTS (5 agents minus Risk = 4 directional agents), this requires 3 of 4 to agree. In practice, with COT stub and News stub both trending to NEUTRAL, achieving 3/4 agreement is structurally difficult.

### 5.5 R/R Gate

```
rrRatio = DEFAULT_PIPS.TP2 / DEFAULT_PIPS.SL = 130 / 50 = 2.6
Gate: rrRatio ≥ 2.0 (default min_rr_ratio)

Status: ALWAYS PASSES in V4.6 (fixed pip values, not dynamic)
```

### 5.6 Confidence Gate

```
Gate: finalConf ≥ min_confidence (default: 65%)

Typical range when COT/News are STUB:
  dirScore ≈ 60–75 → baseConf ≈ 20–50% → below 65% gate
  This is the primary cause of frequent NO_TRADE outputs.
```

### 5.7 Regime Gate

```
Gate: NOT (regime === 'volatile' AND riskScore > 80)
```

### 5.8 8-State Output Mapping

Once all gates pass, `_mapToStrength()` maps to one of 8 states:

| State | signalScore threshold | conf threshold | agents threshold |
|-------|----------------------|----------------|-----------------|
| STRONG_SELL / STRONG_BUY | > 75 | ≥ 75 | ≥ 4 |
| SELL / BUY | > 65 | ≥ 65 | ≥ 3 |
| WEAK_SELL / WEAK_BUY | > 58 | ≥ 55 | ≥ 3 |
| NEUTRAL | direction == NEUTRAL | — | — |

`signalScore` for SELL direction = `dirScore`; for BUY direction = `100 − dirScore`.

### 5.9 Risk Manager — Lot Sizing

**Source file:** `src/core/RiskManager.js`

```
Base lot = (account_balance × risk_pct) / (SL_pips × pip_value)

pip_value (EUR/USD standard lot) = $10/pip

Risk percent by profile:
  conservative: 1.0% of balance
  standard:     2.0% of balance
  aggressive:   5.0% of balance

Four multipliers applied sequentially:
  m1 = regime multiplier   (volatile: ×0.50, trending: ×1.10, ranging: ×0.85)
  m2 = drawdown multiplier (3 consec losses: ×0.70, 5+: ×0.50)
  m3 = performance multiplier (win_rate < 40%: ×0.75)
  m4 = risk score multiplier (riskScore > 80: ×0.60, < 30: ×1.15)

final_lot = base_lot × m1 × m2 × m3 × m4
  hard min: 0.01 lots
  hard max: account_balance / 2000 lots
```

**Default TP/SL (V4.6 frozen values):**

| Parameter | Value |
|-----------|-------|
| SL | 50 pips |
| TP1 | 80 pips |
| TP2 | 130 pips |
| R/R ratio (TP2/SL) | 2.6 |

---

## Section 6 — Confirmed Bug Fixes

### BUG-01 — K-Line Page Blank (CLOSED)

**Root cause:** `KLinePanel` is a singleton ES module with `_mounted` guard. `KLinePanel.mount()` was called twice — once at startup for the dashboard and once on K-Line page navigation — causing the second call to be silently blocked. The K-Line page container was always empty.

**Fix:** `index.html` `showPage()` now captures `_klineDashParent` once at init time. When navigating to K-Line page, `klinePageSlot.appendChild(klineNode)` physically moves the already-mounted chart node. `KLinePanel.forceResize()` is called after the move.

**Files changed:** `index.html`, `src/components/KLinePanel.js` (added `forceResize()` export)

---

### BUG-03 — FRED in Console ReferenceError (CLOSED)

**Root cause:** ES module exports are not bound to `window`. Typing `FREDService.getMacroBundle()` in browser console failed with `ReferenceError: FREDService is not defined`.

**Fix:** `index.html` imports `FREDService` and `FinnhubService` and exposes them on `window.__oneto = { FRED, Finnhub, Memory, AppState, generate }`. Now `window.__oneto.FRED.getMacroBundle()` works in console.

**Files changed:** `index.html`

---

### BUG-04 — Finnhub 401 Unauthorized (CLOSED)

**Root cause:** `FinnhubService` was calling `/news?category=forex`, which is a Finnhub Premium endpoint. Free-tier API keys return 401 on this endpoint.

**Fix:** Changed to `/news?category=general` (free tier). Added keyword filtering (`RELEVANCE_KW` array) to extract EUR/USD relevant articles from the general feed. Added explicit 401/403/429 HTTP status checks with descriptive error messages.

**Secondary fix:** Added circuit breaker (`_authFailed` flag) in both `FREDService` and `FinnhubService`. After a 401/403, no further network requests are made for that key until `clearAuthFailure()` is called (which happens automatically on successful `testConnection()`).

**Files changed:** `src/services/FinnhubService.js`, `src/services/FREDService.js`

---

### BUG-05 — DXY Hardcoded 104.5 (CLOSED)

**Root cause:** `getDXYPrice()` was calling Twelve Data with `symbol=DXY`. Twelve Data free tier does not support the `DXY` symbol (404). The function fell back to returning `{ price: 104.5, source: 'stub' }` — a hardcoded constant that never changed.

**Fix:** `getDXYPrice()` now computes a synthetic DXY from the current EUR/USD price: `(1 / EUR_USD) × 1.0479 × 100`. No Twelve Data DXY API call. `data_source = 'derived'`. The value is real-market-derived and changes with EUR/USD.

**Files changed:** `src/core/DataProvider.js`

---

### BUG-10 — AI Committee Shows All `—` on MTF Gate Failure (CLOSED)

**Root cause:** When the MTF gate failed, `SignalEngine._runSync()` returned `{ signal, votes: [], verdict: null }`. `AppState.setSignalResult()` stored `votes: []`. `CommitteePanel._buildAgentCard()` called `votes.find(v => v.agent === agentKey)` which returned `undefined` for all 5 agents, causing every agent card to display `—`.

**Fix:** MTF gate failure now returns the real `votes` array: `return { signal, votes, verdict, mtfResult, regime, snapshot }`. CommitteeOrchestrator runs all 5 agents before the MTF gate check, so the votes are available regardless of gate outcome.

**Files changed:** `src/core/SignalEngine.js`

---

### BUG-COT — CFTC CORS Errors in Console (CLOSED)

**Root cause:** `COTService.getCOTBundle()` attempted to fetch `https://www.cftc.gov/dea/futures/deacmesf.zip` and `deacmesf.txt` on every call where no valid cache existed. CFTC server returned 404 or CORS errors, polluting the browser console on every page load.

**Fix:** `COTService.getCOTBundle()` now returns the stub bundle immediately with zero network requests. All CFTC fetch code is preserved in the file but not called. The service is disabled pending migration to Nasdaq Data Link API.

**Files changed:** `src/services/COTService.js`

---

### Refresh Loop — "有CACHE仍然重复请求API" (CLOSED)

**Root cause:** `MemoryAggregator.refresh()` called `FREDService.clearCache()` and `FinnhubService.clearCache()` before calling `getMemoryLayer()`. `clearCache()` wiped both in-memory and localStorage caches. With both cache layers empty, the subsequent `getMacroBundle()` call had no cache to use and made a live API request — even if the data was only minutes old.

**Fix:**
1. `MemoryAggregator.refresh()` no longer calls `clearCache()` on services. It only clears the 2-minute aggregate in-memory cache (`_memLayer = null`).
2. `MemoryAggregator.smartRefresh()` added — this is what the Settings "刷新所有数据" button calls. It respects each service's own TTL: if FRED cache is valid (within 72h), no FRED request is made.
3. When a new key is saved and `testConnection()` succeeds, the Settings panel calls `service.clearAuthFailure()` and `service.clearCache()` explicitly for that specific service before `smartRefresh()`. This ensures the new key triggers a live fetch only for the service whose key changed.

**Files changed:** `src/services/MemoryAggregator.js`, `src/components/SettingsPanel.js`

---

### Circuit Breaker — 401 Retry Loop (CLOSED)

**Root cause:** No error state was persisted between `getMacroBundle()` calls. Each call was independent. If a key was invalid, every call would attempt a network request and get a 401, producing repeated red errors in the console.

**Fix:** Both `FREDService` and `FinnhubService` now implement circuit breakers:
- `_authFailed: boolean` + `_authFailedKey: string` module-level state
- On 400/401/403: set `_authFailed = true`, `_authFailedKey = currentKey`
- Subsequent calls check: if `_authFailed && key === _authFailedKey` → return cached/stub immediately, zero network call
- Reset on successful `testConnection()` or when a different key is provided

**Files changed:** `src/services/FREDService.js`, `src/services/FinnhubService.js`

---

## Section 7 — Known Issues (Confirmed, Unfixed in V4.6)

### Issue 1 — Synthetic DXY is EUR/USD Mirror

**Classification:** Data quality — low-severity model integrity issue

**Description:** The current DXY implementation computes `(1 / EUR_USD) × 1.0479 × 100`. This is a mathematical identity transformation of EUR/USD. It carries zero independent information. The real ICE DXY includes JPY (13.6%), GBP (11.9%), CAD (9.1%), SEK (4.2%), and CHF (3.6%) which are completely absent. PositioningAnalyst and MacroAnalyst both reference this synthetic DXY, effectively re-using EUR/USD price information as if it were an independent factor.

**Quantified impact:** Double-counting contributes approximately ±4.4 weighted direction-score points (MacroAnalyst DXY ±6 × weight 0.235 ≈ ±1.4; PositioningAnalyst DXY ±16 × weight 0.235 ≈ ±3.8). At a 100-point direction scale, this is ~4.4%.

**Resolution:** V5.3 — integrate real DXY feed (Twelve Data paid tier, or construct from ECB FX reference rates for GBP/EUR, JPY/EUR, etc.)

---

### Issue 2 — Finnhub News Coverage Low on Free Tier

**Classification:** Data quality — medium-severity signal quality issue

**Description:** `category=general` on Finnhub's free tier returns broad financial news. After `RELEVANCE_KW` filtering for EUR/USD-specific content, many sessions produce `headline_count_24h = 0`. When count = 0, NewsAnalyst's confidence multiplier drops to `0.75 × 0.65 = 0.49`. NewsAnalyst effectively outputs NEUTRAL with ~0% confidence, contributing near-zero information to the committee.

**Quantified impact:** In sessions with count = 0, NewsAnalyst (weight 0.15–0.20 depending on regime) is functionally absent from the committee.

**Resolution:** V5.1 — broader keyword net; V5.2 or paid Finnhub tier for `category=forex`

---

### Issue 3 — COT Data Missing

**Classification:** Feature gap — medium-severity

**Description:** `PositioningAnalyst`'s COT scoring component (±30 points, the single largest component in the agent) is permanently zero in V4.6. `cot_z_score_52w = 0, cot_signal = 'neutral'`. The PositioningAnalyst's 20% committee weight delivers near-zero independent information.

**Resolution:** V5.4 — Nasdaq Data Link API (`data.nasdaq.com/data/CFTC`), CORS-supported, free tier available

---

### Issue 4 — Factor Overlap Between Agents

**Classification:** Model design — low-severity

**Description:** Multiple agents reference the same underlying data:

| Overlap | Severity | Shared Factor |
|---------|----------|---------------|
| Technical ↔ Positioning | High | DXY (synthetic from EUR/USD price) |
| Macro ↔ Positioning | High | `us_de_spread` (both reference this FRED field) |
| Technical ↔ Risk | Medium | ATR derived from EUR/USD OHLCV |
| Macro ↔ Positioning | High | `dxy_trend` (both reference synthetic DXY) |

In a strong trending market, EUR/USD price information influences Technical (direct), Macro (DXY ±6), Positioning (DXY ±16), and Risk (ATR). The same signal is effectively amplified by the committee structure.

**Resolution:** V5.3 (real DXY) + V5.4 (COT) will significantly reduce overlap by introducing truly independent data sources.

---

### Issue 5 — Decision Gate Confidence Threshold Too Strict for Current Data State

**Classification:** Calibration issue — high-severity (functional impact)

**Description:** The confidence gate (`finalConf ≥ 65%`) requires `|dirScore − 50| ≥ 32.5` before risk penalties. With COT = stub, News = low coverage, and many sessions in ranging regime, `dirScore` typically falls in the 55–75 range, yielding `baseConf = 10–50%`. The gate blocks >80% of signals in the current data state.

This is architecturally correct behavior (the system correctly identifies it lacks confidence), but from a user experience perspective it produces an unusable signal frequency.

**Quantified:** To pass the 65% gate, `dirScore` must exceed 82.5 (SELL) or be below 17.5 (BUY). Under current agent weighting and data quality, this requires near-unanimous strong directional agreement across all agents.

**Resolution:** V5.2 — gate calibration review; dynamic threshold by data completeness; separate "insufficient data" from "direction unclear" as NO_TRADE reason categories

---

## Section 8 — V5 Upgrade Roadmap

### V5.1 — Macro Event Engine

**Objective:** Improve news data coverage and introduce structured macro event impact modeling.

**Scope:**
- Broaden Finnhub keyword filter to improve `headline_count_24h > 0` frequency
- Evaluate paid Finnhub tier for `category=forex` endpoint access
- Add structured macro event impact: NFP, FOMC, CPI, ECB decisions with pre-configured score adjustments
- MacroAnalyst: replace `upcoming_event_risk` boolean with graduated event-type impact scoring

---

### V5.2 — Decision Gate Calibration

**Objective:** Reduce NO_TRADE rate to a productive level while maintaining signal quality.

**Scope:**
- Implement dynamic confidence threshold: when COT = stub AND news coverage = 0, lower threshold to 50%
- Add `NO_TRADE_REASON` distinction: `INSUFFICIENT_DATA` (data quality issue) vs `LOW_CONVICTION` (genuine market uncertainty)
- Display to user: when NO_TRADE is due to INSUFFICIENT_DATA, show which data sources are missing rather than generic "low confidence"
- Consider regime-specific gate thresholds (volatile regime may warrant lower confidence requirement)

---

### V5.3 — Real DXY Feed

**Objective:** Replace synthetic EUR/USD-derived DXY with a real multi-currency basket.

**Scope:**
- Evaluate Twelve Data paid tier for `DXY` or `DX-Y.NYB` symbol access
- Alternative: construct basket DXY from individual ECB reference rates (GBP/EUR, JPY/EUR, CAD/EUR, SEK/EUR, CHF/EUR) — all freely available
- Update `DataProvider.getDXYPrice()` and `getDXYCandles()` to use real source
- Update PositioningAnalyst DXY component to reflect that DXY is now independent of EUR/USD price
- Reduce factor overlap score in internal audit

---

### V5.4 — Real COT Data

**Objective:** Connect PositioningAnalyst to real CFTC institutional positioning data.

**Scope:**
- Replace `COTService` CFTC direct fetch with Nasdaq Data Link API
  (`https://data.nasdaq.com/api/v3/datasets/CFTC/`)
- Nasdaq Data Link: CORS-supported, free tier available (50 requests/day)
- Implement 52-week z-score rolling calculation and localStorage history
- Re-enable PositioningAnalyst COT scoring component (±30 points)
- Expected impact: PositioningAnalyst becomes the most information-rich agent in non-trending regimes

---

### V5.5 — Signal Accuracy Review System

**Objective:** Build a feedback loop to measure whether historical signals were accurate.

**Scope:**
- Connect to Supabase (DATABASE_SCHEMA.md, 40-table design already exists)
- Store each signal with entry price, direction, SL/TP levels, and timestamp
- On each price refresh, check all open signals against current price: SL hit, TP hit, or still open
- Weekly accuracy report: win rate by signal strength, regime, agent configuration
- Surface `win_rate_20` metric for RiskManager performance multiplier calibration

---

### V5.6 — Learning Engine

**Objective:** Allow the committee weights to adapt based on historical signal accuracy.

**Scope:**
- Analyze which agents predicted direction correctly over the past N signals
- Propose weight adjustments via `AccountState.setWeights()` (infrastructure already exists)
- Require user approval before any weight change is applied
- Store weight history in Supabase for audit trail
- Constraint: weights must remain normalized (sum = 1.0) and no single agent weight may exceed 0.60

---

## Section 9 — Model Reality Audit Results

*Based on V5.0 Signal Reality Audit conducted 2026-06-05 via static code analysis of V4.6 HEAD.*

### Audit A — DXY Reality

**Rating: ⚠️ WARNING**

Synthetic DXY is a mathematical identity of EUR/USD. `DXY = (1 / EUR_USD) × 1.0479 × 100`. The real ICE DXY basket includes JPY (13.6%), GBP (11.9%), CAD (9.1%), SEK/CHF (7.8%) — none of which are captured. EUR/USD price information is counted three times in the committee: directly via TechnicalAnalyst, indirectly via MacroAnalyst DXY component (±6), and again via PositioningAnalyst DXY component (±16). Weighted double-counting impact: approximately ±4.4 direction-score points.

### Audit B — FRED Reality

**Rating: ✅ PASS**

FRED data pipeline is complete and functional. `FREDService → MemoryAggregator._pickFREDFields() → memoryLayer → CommitteeOrchestrator → MacroAnalyst + RiskAnalyst` chain is verified. CACHE status means real FRED data was previously fetched and is being served within the 72-hour TTL — it is not DEFAULT_MEMORY. Spread at 1.80% (vs DEFAULT_MEMORY 2.0) confirms real API data. Fed stance score, yield spread, VIX, and GDP/CPI all flow correctly through to agent scoring.

### Audit C — News Reality

**Rating: ⚠️ WARNING**

Finnhub `category=general` with keyword filtering produces low EUR/USD article coverage. When `headline_count_24h = 0`, NewsAnalyst confidence multiplier falls to 0.49, rendering the agent effectively neutral with near-zero confidence. The news channel is connected but under-delivering due to free-tier endpoint limitations. Net24h = 0 does not indicate broken integration — it indicates no matching articles in the current news cycle.

### Audit D — COT Missing Impact

**Rating: ⚠️ WARNING**

PositioningAnalyst's largest scoring component (COT z-score, ±30 points) is permanently zero in V4.6. The agent's 20% committee weight contributes only via: yield spread carry (FRED, ±12 points, real data) and synthetic DXY (±16 points, EUR/USD mirror). Of the three components, only one provides independent real-world information. PositioningAnalyst functions as a secondary macro carry indicator rather than a positioning indicator in V4.6.

### Audit E — Committee Factor Overlap

**Rating: ⚠️ WARNING**

Factor overlap matrix:

| Pair | Shared Factor | Overlap Level |
|------|---------------|---------------|
| Technical ↔ Macro | Synthetic DXY (EUR/USD) | Medium |
| Technical ↔ Positioning | Synthetic DXY (EUR/USD) | High |
| Technical ↔ Risk | ATR from EUR/USD OHLCV | Medium |
| Macro ↔ Positioning | `us_de_spread` (both read this field) + Synthetic DXY | High |
| Macro ↔ News | `upcoming_event_risk` (shared) | Low |
| Positioning ↔ News | None | Low |

Truly independent data sources in V4.6: EUR/USD price action (TechnicalAnalyst), FRED macroeconomic fundamentals (MacroAnalyst, partial), Finnhub news sentiment (NewsAnalyst, when available). COT and real DXY are missing, which are the two primary independent sources for PositioningAnalyst.

### Audit F — Decision Gate Assessment

**Rating: ⚠️ WARNING**

The confidence gate (≥65%) is structurally over-restrictive given current data quality. Under stub COT and low-coverage news: `dirScore` typically reaches 60–75, yielding `baseConf = 20–50%`. Estimated NO_TRADE rate: >80% of signals in current data state. The R/R gate always passes (fixed pip values produce constant 2.6 ratio). The MTF gate blocks additional signals in ranging markets. The combination produces very low actionable signal frequency. The gate design is architecturally sound but calibrated for a fully-populated data state (COT live + news live + real DXY) that V4.6 has not yet reached.

---

## Section 10 — Freeze Rules

The following rules take effect from V4.6 as the base version. They govern all subsequent development.

### 10.1 Frozen Components

The following components are frozen as of commit `7f643b1` and **must not be modified** except through an approved version upgrade document:

| Component | File | Frozen Elements |
|-----------|------|----------------|
| Signal direction formula | `src/core/SignalEngine.js` | `dirScore` weighted sum formula |
| Confidence formula | `src/core/SignalEngine.js` | `baseConf`, `riskPenalty`, `MTFadj` formula |
| 8-state thresholds | `src/core/SignalEngine.js` | All `_mapToStrength` thresholds |
| Gate thresholds | `src/core/SignalEngine.js` | `min_confidence=65`, `min_rr=2.0`, `min_agents=3` |
| Agent weights | `src/types/Vote.js` | `REGIME_WEIGHTS` and `DEFAULT_WEIGHTS` |
| Default pips | `src/types/Signal.js` | `SL=50, TP1=80, TP2=130` |
| Risk profiles | `src/core/RiskManager.js` | `RISK_PCT: conservative=1%, standard=2%, aggressive=5%` |
| CommitteeOrchestrator | `src/agents/CommitteeOrchestrator.js` | Agent invocation order and DEFAULT_MEMORY |
| All 5 agent scoring logic | `src/agents/*.js` | Component weights and formulas |

### 10.2 Modification Protocol

To change any frozen component in a future version:

1. Create a version upgrade document: `docs/V{X.Y}_UPGRADE.md`
2. Document: what is changing, why, expected impact on signal quality
3. Include before/after formula comparison
4. Get explicit approval before any code change
5. Reference the freeze document as the baseline

### 10.3 Allowed Changes Without Version Upgrade

The following changes may be made without a version upgrade document:

- Bug fixes that do not change scoring formulas or gate thresholds
- UI/CSS changes
- API endpoint updates (e.g., Finnhub URL changes)
- Cache TTL adjustments
- New data service integrations that add fields to `memoryLayer` without modifying existing field names
- `SettingsPanel.js` UI additions

### 10.4 Version History

| Version | Date | Key Changes |
|---------|------|-------------|
| V4.0 | — | Initial architecture: 5 agents, SignalEngine, Phase 0–4D |
| V4.1 | — | UI Refactor: light theme (TradingView/Stripe/Linear/Notion) |
| V4.2 | — | Data Authenticity Audit |
| V4.3 | — | Data Integration: FREDService, FinnhubService, COTService, MemoryAggregator, ExecutionAdapter |
| V4.6 | 2026-06-05 | BUG-01/03/04/05/10/COT fixes; Circuit Breaker; SmartRefresh; Data Transparency Patch; **FREEZE** |

---

*Document version: V4.6-FREEZE | Frozen: 2026-06-05 | Commit: 7f643b1*
*This document is immutable. Do not edit. Create a new version document for any changes.*
