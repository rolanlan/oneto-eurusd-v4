# ONETO Phase 5C — Pre-Integration Audit Report

**Date:** 2026-06  
**Audit type:** Data Authenticity — Static Code Analysis  
**Auditor:** Claude / ONETO  
**Purpose:** Baseline snapshot before V4.3 data integration coding begins.  
**Scope:** All data sources consumed by the 5 AI Committee agents.  

> This document records the state of all data connections at the start of Phase 5C.
> It is a frozen baseline — not a living document.
> After V4.3 coding is complete, a separate V4.3 Post-Integration Audit will be produced.

---

## Summary Table

| Module | Status | Reason |
|--------|--------|--------|
| TechnicalAnalyst — indicators | **REAL** | Calls live calcEMA/RSI/MACD/ADX/BB/ATR on real or sim candles |
| TechnicalAnalyst — candle data | **CONDITIONAL** | REAL with TD API key; MOCK (SimData random-walk) without key |
| MacroAnalyst — Fed/ECB/GDP/CPI | **MOCK** | All values hardcoded in DEFAULT_MEMORY |
| MacroAnalyst — DXY trend | **MOCK** | `dxy_trend: 'rising'` hardcoded string, never updated |
| MacroAnalyst — US-DE spread | **MOCK** | `us_de_spread: 2.0` hardcoded constant |
| PositioningAnalyst — COT data | **MOCK** | `cot_z_score_52w: 0, cot_signal: 'neutral'` hardcoded |
| PositioningAnalyst — COT trend | **MOCK** | `cot_trend_3w: 'flat'` hardcoded |
| NewsAnalyst — sentiment scores | **MOCK** | `news_net_score_24h: 30` hardcoded, never changes |
| NewsAnalyst — narrative shift | **MOCK** | `narrative_shift: false` hardcoded |
| RiskAnalyst — ATR calculation | **REAL** | `calcATR(highs, lows, closes, 14)` called live on candles |
| RiskAnalyst — VIX level | **MOCK** | `vix_level: 15.0` hardcoded constant |
| RiskAnalyst — event risk | **MOCK** | `upcoming_event_risk: false` hardcoded |
| SignalEngine — decision logic | **REAL** | 8-state mapping, gate checks, weight aggregation all live |
| SignalEngine — macro/news/COT inputs | **MOCK** | Upstream agents receive stubbed memoryLayer |

---

## Current REAL Modules

### `src/utils/indicators.js`
**Status: REAL**

All 9 indicator functions are genuine mathematical implementations:

| Function | Algorithm | Input |
|----------|-----------|-------|
| `calcMA(data, period)` | Simple Moving Average | close prices |
| `calcEMA(data, period)` | Exponential MA (Wilder smoothing) | close prices |
| `calcEMASeries(data, period)` | Full EMA array | close prices |
| `calcRSI(closes, 14)` | Wilder RSI, smoothed | close prices |
| `calcMACD(closes, 12, 26, 9)` | EMA diff + signal + histogram | close prices |
| `calcBB(closes, 20, 2)` | Bollinger Bands ±2σ | close prices |
| `calcATR(highs, lows, closes, 14)` | Average True Range | OHLC |
| `calcADX(highs, lows, closes, 14)` | Wilder ADX + DI+/DI− | OHLC |
| `calcStochastic(h, l, c, 14, 3)` | Fast %K + slow %D | OHLC |
| `percentileRank(value, series)` | Rank within array | any series |

These functions are pure, stateless, and produce correct results against any valid OHLCV input.

---

### `src/agents/TechnicalAnalyst.js`
**Status: REAL (computation) / CONDITIONAL (data)**

All 6 scoring components call live indicator functions:

- MA alignment: `calcMA(closes, 20)`, `calcMA(closes, 50)`
- RSI momentum: `calcRSI(closes, 14)`
- MACD signal: `calcMACD(closes)` histogram + crossover
- Bollinger position: `calcBB(closes, 20, 2)` price vs bands
- ADX trend strength: `calcADX(highs, lows, closes, 14)`
- Stochastic: `calcStochastic(highs, lows, closes, 14, 3)`

**Data dependency:** If `localStorage('td_api_key_eurusd')` is set, candles come from Twelve Data (real OHLCV). Without the key, `DataProvider` falls back to `_generateSimCandles()` (random-walk). The indicator math is identical in both cases.

---

### `src/agents/RiskAnalyst.js` — ATR component
**Status: REAL (ATR only)**

ATR is computed live:
```javascript
const atr14  = calcATR(highs, lows, closes, 14);
const atr30  = calcATR(highs, lows, closes, 30);
const atr_ratio = atr14 / (atr30 || atr14);
```
ATR-derived volatility score is genuine and changes with market conditions.

All other RiskAnalyst inputs are MOCK (see MOCK section below).

---

### `src/core/SignalEngine.js`
**Status: REAL (logic) / DEPENDENT ON UPSTREAM DATA**

The decision pipeline is fully implemented and correct:
- 8-state mapping (STRONG_SELL → STRONG_BUY) with proper thresholds
- 6 gate checks (MTF, confidence, R/R, agent agreement, drawdown, regime)
- Weighted directional score computation (excludes Risk agent)
- Confidence adjustment: base ± MTF adj − risk penalty
- `REGIME_WEIGHTS[regime] ?? DEFAULT_WEIGHTS` (BUG-04 fixed)

The pipeline is only as accurate as its inputs. Because `memoryLayer = {}` is passed from `index.html`, all macro/news/COT scores are currently derived from DEFAULT_MEMORY hardcoded values.

---

### `src/core/MTFEngine.js`, `RegimeEngine.js`, `DecisionEngine.js`, `RiskManager.js`
**Status: REAL**

All pure computational engines. No external data dependencies beyond candles:
- MTF: bias computed from MA, RSI, MACD, price structure per timeframe
- Regime: ADX, ATR ratio, BB width, MA alignment classification
- Decision: 8-state mapping with gates (standalone, no API deps)
- RiskManager: 4-multiplier lot sizing (standalone, no API deps)

---

### `src/core/DataProvider.js` — EUR/USD feeds
**Status: REAL (with API key) / MOCK (without key)**

With `td_api_key_eurusd` set:
- `getPrice()` → live Twelve Data `/price` endpoint
- `getCandles('4H', 80)` → live Twelve Data `/time_series`
- `getCandles('1D', 60)` → live Twelve Data `/time_series`
- `getCandles('1H', 80)` → live Twelve Data `/time_series`

Without key: all return `_generateSimCandles()` output with `source: 'simulated'`.

DXY functions (`getDXYPrice`, `getDXYCandles`, `computeDXYTrend`) do **not yet exist** — to be added in STEP 1.

---

## Current MOCK Modules

### `CommitteeOrchestrator.js` — DEFAULT_MEMORY
**Status: MOCK (all non-technical fields)**

The `DEFAULT_MEMORY` constant provides hardcoded fallback values for all macro, news, COT, and risk fields:

```javascript
const DEFAULT_MEMORY = Object.freeze({
  cb_fed_stance_score:   60,     // MOCK: hardcoded hawkish
  cb_ecb_stance_score:    0,     // MOCK: hardcoded neutral
  cot_net_position:       0,     // MOCK: hardcoded zero
  cot_z_score_52w:        0,     // MOCK: hardcoded neutral
  cot_signal:         'neutral', // MOCK: hardcoded
  cot_trend_3w:       'flat',    // MOCK: hardcoded
  cot_extreme:            false, // MOCK: hardcoded
  news_net_score_24h:    30,     // MOCK: hardcoded mild USD bullish
  news_net_score_7d:     15,     // MOCK: hardcoded
  news_net_score_30d:     5,     // MOCK: hardcoded
  narrative_shift:        false, // MOCK: never triggers
  us_de_spread:           2.0,   // MOCK: hardcoded constant
  dxy_trend:          'rising',  // MOCK: always 'rising'
  dxy_level:            104.5,   // MOCK: hardcoded
  policy_momentum:        1,     // MOCK: mildly hawkish
  vix_level:             15.0,   // MOCK: below-average vol
  upcoming_event_risk:    false, // MOCK: no events ever
  event_within_hours:     null,  // MOCK: null
  event_impact_level:  'low',    // MOCK: always low
  data_source:         'stub',   // marker: all MOCK
});
```

**Effect on signal quality:** Because DEFAULT_MEMORY is static, the `MacroAnalyst` score is effectively locked at a fixed value per session. `NewsAnalyst` always sees mild USD bullishness (net_24h=30). `PositioningAnalyst` always sees neutral COT. `RiskAnalyst` never sees event risk.

---

### `src/agents/MacroAnalyst.js`
**Status: MOCK**

All scoring inputs from `memoryLayer` are hardcoded:
- `m.cb_fed_stance_score = 60` → constant hawkish Fed score
- `m.cb_ecb_stance_score = 0` → constant neutral ECB
- `m.us_de_spread = 2.0` → constant yield spread
- `m.gdp_us_qoq = 0.6, m.gdp_eu_qoq = 0.2` → constant GDP divergence
- `m.cpi_us_yoy = 3.1, m.cpi_eu_yoy = 2.4` → constant CPI divergence
- `m.dxy_trend = 'rising'` → constant DXY direction
- `m.policy_momentum = 1` → mildly hawkish constant

MacroAnalyst score is deterministic and never reflects actual market macro conditions.

---

### `src/agents/NewsAnalyst.js`
**Status: MOCK**

- `m.news_net_score_24h = 30` → constant mild USD bullish
- `m.high_impact_count_24h` not provided → defaults to 0
- `m.narrative_shift = false` → never triggers ±15 point swing
- `m.data_source = 'stub'` → triggers ×0.65 confidence penalty on every signal

NewsAnalyst confidence is permanently reduced by 35% due to forced stub penalty.

---

### `src/agents/PositioningAnalyst.js`
**Status: MOCK**

- `m.cot_z_score_52w = 0` → always neutral, no extreme signal
- `m.cot_signal = 'neutral'` → never triggers contrarian logic
- `m.cot_trend_3w = 'flat'` → no accumulation signal
- `m.cot_extreme = false` → extreme positioning logic never fires
- `m.data_source = 'stub'` → triggers ×0.70 confidence penalty

PositioningAnalyst effectively contributes neutral votes at reduced confidence on every signal.

---

### `src/agents/RiskAnalyst.js` — non-ATR fields
**Status: MOCK**

- `m.vix_level = 15.0` → constant below-average volatility
- `m.upcoming_event_risk = false` → no event risk ever
- `m.event_within_hours = null` → no event timing
- `m.news_blackout` not provided → false
- `m.spread_current = 0.0002, m.spread_normal = 0.0001` → constant spread

RiskAnalyst never triggers high-volatility warnings or pre-event position reduction.

---

### `src/core/OandaExecution.js`
**Status: MOCK (interface only)**

All 9 methods return `NOT_IMPLEMENTED`:
```javascript
const NOT_IMPLEMENTED = Object.freeze({
  status:  'not_implemented',
  message: 'OandaExecution: live trading is interface-only...',
  activated: false,
});
```

Methods: `testConnection`, `getAccountSummary`, `getCurrentPricing`,
`submitMarketOrder`, `submitLimitOrder`, `closeTrade`, `modifyTrade`,
`getOpenTrades`, `getTradeHistory`

`isActivated()` always returns `{ activated: false }`.

---

## Current MISSING Modules

The following files are designed in the architecture but do not yet exist on disk:

### Services
| File | Required For | Created In |
|------|-------------|-----------|
| `src/services/FREDService.js` | MacroAnalyst real macro data | STEP 2 |
| `src/services/FinnhubService.js` | NewsAnalyst + RiskAnalyst event data | STEP 3 |
| `src/services/COTService.js` | PositioningAnalyst real positioning | STEP 4 |
| `src/services/MemoryAggregator.js` | All agents — aggregated real data | STEP 5 |

### Memory Layer (Phase 6 — not V4.3 scope)
| File | Status |
|------|--------|
| `src/memory/CentralBankMemory.js` | MISSING — Phase 6 |
| `src/memory/NewsMemory.js` | MISSING — Phase 6 |
| `src/memory/COTMemory.js` | MISSING — Phase 6 |
| `src/memory/EconomicMemory.js` | MISSING — Phase 6 |

### Execution (design only in V4.3)
| File | Status |
|------|--------|
| `src/execution/ExecutionAdapter.js` | MISSING — to be created in STEP 6 (stubs only) |
| `src/execution/adapters/OandaPracticeAdapter.js` | MISSING — future |
| `src/execution/adapters/OandaLiveAdapter.js` | MISSING — future |
| `src/execution/adapters/ICMarketsAdapter.js` | MISSING — future |
| `src/execution/adapters/ExnessAdapter.js` | MISSING — future |

---

## Twelve Data Status

**Status: CONDITIONALLY CONNECTED**

```
Connection type:   Browser-side fetch to api.twelvedata.com
Authentication:    Bearer API key from localStorage('td_api_key_eurusd')
Current symbols:   EUR/USD only (price + 1H/4H/1D candles)
New symbols (V4.3 STEP 1): DXY (price + 1D candles)

Without API key:
  All price and candle data → SimDataService random-walk
  data_source = 'simulated'
  TechnicalAnalyst indicators run on synthetic data

With API key:
  EUR/USD price, 1H, 4H, 1D candles → real Twelve Data feed
  data_source = 'live' or 'cached'
  TechnicalAnalyst indicators run on real OHLCV

Credit usage (EUR/USD, current): ~81 credits/day
Credit usage (+ DXY, V4.3):     ~183 credits/day (23% of 800 free limit)

Cache TTLs:
  Price:    30 seconds
  1H/4H:    4 minutes
  1D:       60 minutes
  DXY price (new): 15 minutes
  DXY 1D (new):    4 hours
```

---

## OANDA Status

**Status: NOT CONNECTED — Interface Only**

```
File exists:       src/core/OandaExecution.js  ✓
Methods defined:   9 methods  ✓
Methods implemented: 0 of 9
All methods return: NOT_IMPLEMENTED object

isActivated():     { activated: false }
requestLiveMode(): fails at Gate 4 — "OandaExecution interface is not yet implemented"

V4.3 action:
  ExecutionAdapter.js will be created (STEP 6) as an interface contract
  defining submitOrder(), closeOrder(), modifySLTP(), getPositions(), getAccount()
  No actual OANDA implementation in V4.3.

Future brokers designed (not implemented):
  OANDA Practice, OANDA Live, IC Markets, Exness
```

---

## News API Status

**Status: NOT CONNECTED — Service Missing**

```
NewsAPIService.js:   Does not exist
FinnhubService.js:   Does not exist (to be created in STEP 3)

Current state:
  NewsAnalyst reads ONLY from DEFAULT_MEMORY hardcoded values:
    news_net_score_24h = 30  (constant mild USD bullish)
    news_net_score_7d  = 15  (constant)
    news_net_score_30d =  5  (constant)
    narrative_shift    = false (never changes)
    data_source        = 'stub'

  Confidence penalty: ×0.65 applied on every signal (stub penalty)

V4.3 fix (STEP 3):
  FinnhubService.js created
  /news?category=forex → sentiment aggregation
  /calendar/economic   → event detection
  Decay-weighted net scores replace hardcoded values
  data_source changes to 'live'
  Stub confidence penalty removed
```

---

## COT Data Status

**Status: NOT CONNECTED — Service Missing**

```
COTService.js:       Does not exist (to be created in STEP 4)
CFTC source:         https://www.cftc.gov/dea/futures/deacmesf.zip (public)

Current state:
  PositioningAnalyst reads ONLY from DEFAULT_MEMORY:
    cot_z_score_52w  = 0       (constant neutral)
    cot_signal       = 'neutral'
    cot_trend_3w     = 'flat'
    cot_extreme      = false
    data_source      = 'stub'

  Confidence penalty: ×0.70 applied on every signal (stub penalty)
  Contrarian signals: never triggered (z-score always 0)

V4.3 fix (STEP 4):
  COTService.js created
  CFTC CSV parsed → net position extracted → z-score computed
  52-week history maintained in localStorage
  Real z-score replaces 0
  Contrarian signals activate when |z| > 2.0
  Stub penalty removed
```

---

## FRED Status

**Status: NOT CONNECTED — Service Missing**

```
FREDService.js:      Does not exist (to be created in STEP 2)
FRED API:            https://api.stlouisfed.org/fred/ (free, requires key)

Current state:
  MacroAnalyst reads ONLY from DEFAULT_MEMORY:
    cb_fed_stance_score  = 60   (constant hawkish)
    cb_ecb_stance_score  =  0   (constant neutral)
    us_de_spread         = 2.0  (constant)
    gdp_us_qoq           = 0.6  (constant)
    gdp_eu_qoq           = 0.2  (constant)
    cpi_us_yoy           = 3.1  (constant)
    cpi_eu_yoy           = 2.4  (constant)
    policy_momentum      =  1   (mildly hawkish)
    data_source          = 'stub'

  RiskAnalyst:
    vix_level            = 15.0 (constant below-average)

  MacroAnalyst score is deterministic — never reflects real conditions

V4.3 fix (STEP 2):
  FREDService.js created with 8 series:
    DGS10, IRLTLT01DEM156N, A191RL1Q225SBEA, CPIAUCSL,
    CP0000EZ19M086NEST, VIXCLS, UNRATE, LRHUTTTTEZQ156S
  Real GDP/CPI/rates/VIX replace all hardcoded macro values
  cb_fed_stance_score derived from rate trend
  us_de_spread computed live (DGS10 − DE10Y)
  MacroAnalyst score begins reflecting actual macro divergence
```

---

## V4.3 Expected Outcome

After all STEP 1–7 completions, the audit will show:

| Module | Before V4.3 | After V4.3 |
|--------|-------------|-----------|
| TechnicalAnalyst candles | CONDITIONAL | REAL (with TD key) |
| MacroAnalyst macro data | MOCK | REAL (FRED) |
| MacroAnalyst DXY | MOCK | REAL (Twelve Data ICE DXY) |
| NewsAnalyst sentiment | MOCK | REAL (Finnhub) |
| RiskAnalyst VIX | MOCK | REAL (FRED VIXCLS) |
| RiskAnalyst event risk | MOCK | REAL (Finnhub calendar) |
| PositioningAnalyst COT | MOCK | REAL (CFTC) |
| OANDA execution | NOT CONNECTED | NOT CONNECTED (ExecutionAdapter stub only) |

---

*Report version: Phase 5C Baseline | Date: 2026-06*  
*Status: FROZEN — this document records pre-V4.3 state and will not be updated.*  
*Post-integration audit to be produced after STEP 7 completes.*
