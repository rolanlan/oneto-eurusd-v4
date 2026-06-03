# ONETO EUR/USD AI Tool — Interface Contracts

**Version:** V4.0 | Frozen  
**Rule:** Interfaces cannot change without a documented revision to this file and explicit approval.  
**Last Updated:** 2026-06  

---

## Table of Contents

1. [Contract 1: MTFEngine](#contract-1-mtfengine)
2. [Contract 2: RegimeEngine](#contract-2-regimeengine)
3. [Contract 3: CommitteeOrchestrator](#contract-3-committeeorchestrator)
4. [Contract 4: DecisionEngine](#contract-4-decisionengine)
5. [Contract 5: RiskManager](#contract-5-riskmanager)
6. [Contract 6: PaperTradingEngine](#contract-6-papertradingengine)
7. [Contract 7: TwelveDataService](#contract-7-twelvedataservice)
8. [Contract 8: SimDataService](#contract-8-simdataservice)
9. [Contract 9: i18n Module](#contract-9-i18n-module)
10. [Contract 10: AppState](#contract-10-appstate)
11. [Contract 11: AccountState](#contract-11-accountstate)
12. [Shared Type Definitions](#shared-type-definitions)
13. [Revision History](#revision-history)

---

## Shared Type Definitions

These types are referenced throughout all contracts.

```typescript
// Candle — OHLCV data point
type Candle = {
  time:  number;   // UNIX timestamp in seconds
  open:  number;
  high:  number;
  low:   number;
  close: number;
}

// AgentVote — output of a single AI Committee agent
type AgentVote = {
  agent:      string;   // 'technical'|'macro'|'positioning'|'news'|'risk'
  score:      number;   // 0–100 (higher = more bearish EUR/USD)
  vote:       string;   // 'BUY'|'SELL'|'NEUTRAL'
  confidence: number;   // 0–100
  weight:     number;   // regime-adjusted weight applied (0–1)
  contrib:    number;   // score × weight (weighted contribution)
  reason_1:   string;   // primary reason (EN)
  reason_2:   string;   // secondary reason (EN)
}

// CommitteeVerdict — aggregated result from all agents
type CommitteeVerdict = {
  direction:      string;   // 'BUY'|'SELL'
  confidence:     number;   // 0–100
  sell_weight:    number;   // sum of sell-voting agent weights
  buy_weight:     number;   // sum of buy-voting agent weights
  neutral_weight: number;
}

// PriceLevels — signal entry, exit, and measurement
type PriceLevels = {
  entry_price:   number;
  stop_loss:     number;
  take_profit_1: number;
  take_profit_2: number;
  sl_pips:       number;
  tp1_pips:      number;
  tp2_pips:      number;
  rr_ratio:      number;
}

// AccountProfile — user account configuration
type AccountProfile = {
  id:                    string;
  profile_name:          string;
  account_balance:       number;
  risk_profile:          'conservative'|'standard'|'aggressive';
  risk_pct_conservative: number;   // default 0.01
  risk_pct_standard:     number;   // default 0.02
  risk_pct_aggressive:   number;   // default 0.05
  max_drawdown_limit:    number;   // default 0.10
  max_consecutive_losses: number;  // default 5
  min_confidence:        number;   // default 65
  min_rr_ratio:          number;   // default 2.00
  consecutive_losses:    number;
  current_drawdown:      number;
  daily_risk_used:       number;
  language:              'en'|'zh';
  timezone:              string;
}

// WeightConfig — committee weight configuration
type WeightConfig = {
  technical:   number;   // default 0.35
  macro:       number;   // default 0.20
  positioning: number;   // default 0.10
  news:        number;   // default 0.20
  risk:        number;   // default 0.15
}

// ExplanationItem — signal explanation entry
type ExplanationItem = {
  category:  string;   // 'technical'|'macro'|'news'|'risk'|'historical'
  color:     string;   // CSS color value
  text_en:   string;   // English explanation
  text_zh:   string;   // Chinese explanation
}
```

---

## Contract 1: MTFEngine

**File:** `src/core/MTFEngine.js`  
**Phase:** 2  
**Dependencies:** `src/utils/indicators.js`  

### Function: `MTFEngine.run(candles1d, candles4h, candles1h)`

This is **Step 0** of the Decision Engine pipeline. If it returns `gate_pass: false`, the Decision Engine stops immediately and outputs NO_TRADE.

#### Input Parameters

| Parameter | Type | Minimum Length | Notes |
|-----------|------|---------------|-------|
| `candles1d` | `Candle[]` | 50 items | 1-Day OHLCV candles, ascending time order |
| `candles4h` | `Candle[]` | 50 items | 4-Hour OHLCV candles, ascending time order |
| `candles1h` | `Candle[]` | 50 items | 1-Hour OHLCV candles, ascending time order |

#### Return Value

```typescript
type MTFResult = {
  mtf_score:       number;   // weighted composite bias (-100 to +100)
                             // negative = bearish, positive = bullish
  mtf_state:       'fully_aligned'       // all 3 TF agree strongly
               |   'partially_aligned'   // 2 of 3 agree (or 1H neutral)
               |   'primary_only'        // 4H signal opposes 1D trend
               |   'not_aligned';        // no clear agreement
  bias_1d:         number;   // 1D directional bias (-100 to +100)
  bias_4h:         number;   // 4H directional bias (-100 to +100)
  bias_1h:         number;   // 1H directional bias (-100 to +100)
  direction:       'BEARISH'|'BULLISH'|'NEUTRAL';
  confidence_adj:  -15|0|5|10;   // applied to final_confidence in Decision Engine
                                 // fully_aligned=+10, partially=+5, primary_only=-15, not_aligned=0
  gate_pass:       boolean;      // false if mtf_state = 'not_aligned'
  description_en:  string;       // human-readable explanation
  description_zh:  string;       // Chinese explanation
}
```

#### MTF State Mapping

| State | Condition | confidence_adj | gate_pass |
|-------|-----------|---------------|-----------|
| `fully_aligned` | All 3 TF same direction, \|1D bias\| > 30 | +10 | true |
| `partially_aligned` | 1D + 4H agree, 1H within ±20 | +5 | true |
| `primary_only` | 1D and 4H opposite direction | -15 | true |
| `not_aligned` | MTF score between -20 and +20 | 0 | **false** |

#### Error Behavior

- If any candle array has < 20 items: return `{ gate_pass: true, mtf_state: 'partially_aligned', confidence_adj: 0, mtf_score: 0, bias_1d: 0, bias_4h: 0, bias_1h: 0, direction: 'NEUTRAL', description_en: 'Insufficient data', description_zh: '数据不足' }`
- **Never throws.** Always returns a valid MTFResult object.

---

## Contract 2: RegimeEngine

**File:** `src/core/RegimeEngine.js`  
**Phase:** 2  
**Dependencies:** `src/utils/indicators.js`, `src/state/AppState.js`  

### Function: `RegimeEngine.run(candles)`

#### Input Parameters

| Parameter | Type | Minimum Length |
|-----------|------|---------------|
| `candles` | `Candle[]` | 50 items (4H candles) |

#### Return Value

```typescript
type RegimeResult = {
  regime: 'trending_bull'
       |  'trending_bear'
       |  'ranging'
       |  'volatile'
       |  'breakout_up'
       |  'breakout_down';
  confidence:               number;       // 0–100
  adx_14:                   number;
  atr_ratio:                number;       // current ATR / 30-day average ATR
  bb_width_percentile:      number;       // 0–100, vs 30-day range
  weight_adjustment:        WeightConfig; // regime-specific agent weights
  position_size_multiplier: number;       // 1.00 / 0.75 / 0.50
  min_confidence_override:  number|null;  // null = use account_profile default
  transition_trigger:       string;       // what caused regime classification
}
```

#### Error Behavior

- If candles < 20: return `{ regime: 'ranging', confidence: 30, weight_adjustment: DEFAULT_WEIGHTS, position_size_multiplier: 1.00, ... }`
- Never throws.

---

## Contract 3: CommitteeOrchestrator

**File:** `src/agents/CommitteeOrchestrator.js`  
**Phase:** 2  
**Dependencies:** All 5 agent files, `src/core/MTFEngine.js`, `src/state/AppState.js`  

### Function: `CommitteeOrchestrator.run(appState)`

#### Input Parameters

```typescript
type CommitteeInput = {
  candles:      Candle[];       // 4H candles (primary timeframe)
  candles_1d:   Candle[];       // 1D candles (for MTF + macro context)
  candles_1h:   Candle[];       // 1H candles (for MTF entry timing)
  regime:       string;         // current regime from RegimeEngine
  weights:      WeightConfig;   // from committee_weights active row
  memoryLayer:  {               // Phase 1-4: stub values; Phase 6+: real data
    cb_fed_stance_score:  number;    // default 60 (hawkish)
    cb_ecb_stance_score:  number;    // default 0 (neutral)
    news_net_score:       number;    // default 0 (neutral)
    cot_z_score:          number;    // default 0 (neutral)
    cot_signal:           string;    // default 'neutral'
    us_de_spread:         number;    // default 2.0
    dxy_trend:            string;    // default 'rising'
  };
}
```

#### Return Value

```typescript
type CommitteeOutput = {
  votes:      AgentVote[];       // Exactly 5 votes, one per agent
  verdict:    CommitteeVerdict;
  mtf_result: MTFResult;         // Full MTF output for Decision Engine
  regime:     string;            // Confirmed regime used in this cycle
  timestamp:  number;            // UNIX ms
}
```

#### Error Behavior

- If any single agent throws: use `{ score: 50, vote: 'NEUTRAL', confidence: 0, reason_1: 'Agent error — using neutral fallback', reason_2: '' }` for that agent. Log warning.
- **Always returns exactly 5 votes.** Never returns fewer.
- Never throws.

---

## Contract 4: DecisionEngine

**File:** `src/core/DecisionEngine.js`  
**Phase:** 3  
**Dependencies:** `src/agents/CommitteeOrchestrator.js`, `src/state/AppState.js`, `src/utils/validators.js`  

### Function: `DecisionEngine.run(committeeOutput, accountProfile, currentPrice)`

#### Input Parameters

| Parameter | Type | Notes |
|-----------|------|-------|
| `committeeOutput` | `CommitteeOutput` | Full output from CommitteeOrchestrator |
| `accountProfile` | `AccountProfile` | Current user profile |
| `currentPrice` | `number` | EUR/USD current price |

#### Return Value

```typescript
type DecisionResult = {
  // 8-state signal classification
  signal_strength: 'STRONG_BUY'|'BUY'|'WEAK_BUY'|'NEUTRAL'
                 | 'WEAK_SELL'|'SELL'|'STRONG_SELL'|'NO_TRADE';
  direction:         'BUY'|'SELL'|'NEUTRAL';

  // Scores
  final_score:       number;    // 0–100 weighted directional composite
  final_confidence:  number;    // 0–100 after all adjustments

  // Supporting metrics
  agents_agreeing:   number;    // count of agents matching direction
  mtf_state:         string;    // from MTF Engine
  mtf_confidence_adj: number;   // MTF adjustment applied

  // Price levels (computed from currentPrice + pip distances)
  price_levels:      PriceLevels;

  // Explanation items (4 entries: technical, macro, news, risk)
  explanation:       ExplanationItem[];

  // Gate results (which pass/fail checks were applied)
  gates: {
    mtf_pass:              boolean;
    confidence_pass:       boolean;
    rr_pass:               boolean;
    agent_agreement_pass:  boolean;
    drawdown_pass:         boolean;
    regime_pass:           boolean;
  };

  // Context
  regime:    string;
  session:   string;    // london|newyork|asian|overlap|off
  timestamp: number;    // UNIX ms
}
```

#### NO_TRADE Conditions (any one triggers NO_TRADE)

| Condition | Gate Name |
|-----------|-----------|
| `mtf_result.gate_pass = false` | `mtf_pass` |
| `final_confidence < accountProfile.min_confidence` | `confidence_pass` |
| `price_levels.rr_ratio < accountProfile.min_rr_ratio` | `rr_pass` |
| `agents_agreeing < 3` | `agent_agreement_pass` |
| `regime = 'volatile' AND risk_score > 80` | `regime_pass` |
| `accountProfile.current_drawdown >= accountProfile.max_drawdown_limit` | `drawdown_pass` |
| `accountProfile.consecutive_losses >= accountProfile.max_consecutive_losses` | `drawdown_pass` |

#### SL/TP Defaults (used for PriceLevels computation)

```
Default sl_pips:   50
Default tp1_pips:  80
Default tp2_pips: 130
```

#### Error Behavior

- If committeeOutput is malformed: return `{ signal_strength: 'NO_TRADE', direction: 'NEUTRAL', final_confidence: 0, ... }`
- Never throws.

---

## Contract 5: RiskManager

**File:** `src/core/RiskManager.js`  
**Phase:** 3  
**Dependencies:** `src/state/AccountState.js`, `src/utils/formatters.js`  

### Function: `RiskManager.calc(params)`

#### Input Parameters

```typescript
type RiskCalcParams = {
  account_balance:     number;   // from AccountState
  risk_profile:        'conservative'|'standard'|'aggressive';
  sl_pips:             number;   // from DecisionEngine price_levels
  tp_pips:             number;   // tp2_pips from DecisionEngine price_levels
  regime:              string;   // current regime
  risk_score:          number;   // from Risk Analyst score (0–100)
  consecutive_losses:  number;   // from AccountState
  win_rate_20:         number;   // last 20 trades win rate (0–1), default 0.5
}
```

#### Return Value

```typescript
type RiskResult = {
  // Primary outputs
  lot_size:              number;   // final computed lot size (min 0.01)
  base_lot_size:         number;   // before multipliers applied
  max_loss_usd:          number;   // absolute dollar risk
  expected_profit_usd:   number;   // expected profit at TP2
  rr_ratio:              number;   // tp_pips / sl_pips
  effective_risk_pct:    number;   // actual risk as % of balance (0–1)

  // Multipliers applied (for UI transparency display)
  regime_multiplier:       number;
  drawdown_multiplier:     number;
  performance_multiplier:  number;
  risk_score_multiplier:   number;

  // Risk level classification
  risk_level:      'LOW'|'STANDARD'|'ELEVATED'|'HIGH';
  level_color:     string;   // CSS color: #4ade80 / #fbbf24 / #f97316 / #f87171
  level_text_en:   string;
  level_text_zh:   string;

  // System flags
  drawdown_warning: boolean;   // true if consecutive_losses >= 3
  system_halt:      boolean;   // true if drawdown >= max_drawdown_limit
}
```

#### Multiplier Reference Table

```
REGIME MULTIPLIER:
  trending_bull / trending_bear  → 1.00
  ranging                        → 0.75
  volatile                       → 0.50
  breakout_up / breakout_down    → 1.00

DRAWDOWN MULTIPLIER:
  consecutive_losses 0–2  → 1.00
  consecutive_losses 3    → 0.75
  consecutive_losses 4    → 0.50
  consecutive_losses ≥ 5  → 0.25

PERFORMANCE MULTIPLIER:
  win_rate_20 < 0.40  → 0.75
  win_rate_20 ≥ 0.40  → 1.00

RISK SCORE MULTIPLIER:
  risk_score < 40     → 1.25
  risk_score 40–55    → 1.00
  risk_score 55–70    → 0.75
  risk_score 70–85    → 0.50
  risk_score > 85     → 0.25

HARD CAPS:
  min lot_size: 0.01
  max lot_size: account_balance / 2000
```

#### Error Behavior

- If `account_balance <= 0`: return `{ system_halt: true, lot_size: 0, max_loss_usd: 0, ... }`
- If `sl_pips <= 0`: return `{ system_halt: true, lot_size: 0, ... }`
- Never throws.

---

## Contract 6: PaperTradingEngine

**File:** `src/components/PaperTradePanel.js` (Phase 3)  
→ Extracted to `src/core/PaperTradingEngine.js` in Phase 5 with Supabase  
**Phase:** 3  
**Dependencies:** `src/state/AccountState.js`, `src/utils/validators.js`  

### Function: `PaperTradingEngine.submitTrade(tradeInput)`

#### Input Parameters

```typescript
type TradeInput = {
  direction:       'BUY'|'SELL';
  entry_price:     number;
  stop_loss:       number;
  take_profit_1:   number;
  take_profit_2:   number;
  lot_size:        number;         // from RiskManager (or manual override)
  account_balance: number;
  risk_pct:        number;         // e.g. 0.02 for 2%
  signal_id:       string|null;    // linked to Decision Engine signal if applicable
}
```

#### Return Value

```typescript
type PaperTradeRecord = {
  id:               string;         // UUID (client-side generated in Phase 1–4)
  direction:        'BUY'|'SELL';
  entry_price:      number;
  stop_loss:        number;
  take_profit_1:    number;
  take_profit_2:    number;
  sl_pips:          number;
  tp1_pips:         number;
  tp2_pips:         number;
  lot_size:         number;
  risk_amount_usd:  number;         // balance × risk_pct
  status:           'open';
  opened_at:        string;         // ISO timestamp
  validation_phase: number;         // 1 in Phase 1–4
  signal_id:        string|null;
}
```

### Function: `PaperTradingEngine.closeTrade(tradeId, exitPrice, exitReason)`

#### Input Parameters

| Parameter | Type | Valid Values |
|-----------|------|-------------|
| `tradeId` | `string` | Any existing open trade ID |
| `exitPrice` | `number` | EUR/USD price at close |
| `exitReason` | `string` | `'tp1'|'tp2'|'sl'|'manual'|'timeout'` |

#### Return Value

```typescript
type ClosedPaperTradeRecord = {
  ...PaperTradeRecord,            // all original fields
  status:           'closed';
  exit_price:       number;
  pnl_pips:         number;       // signed (positive = profit)
  pnl_r:            number;       // pnl_pips / sl_pips
  pnl_usd:          number;       // lot_size × pnl_pips × $10
  exit_reason:      string;
  closed_at:        string;       // ISO timestamp
  duration_minutes: number;
}
```

### Function: `PaperTradingEngine.getAll()`

```typescript
returns: PaperTradeRecord[]   // all trades (open + closed), sorted by opened_at DESC
```

### Function: `PaperTradingEngine.getStats()`

```typescript
returns: {
  total:             number;
  open:              number;
  closed:            number;
  wins:              number;
  losses:            number;
  win_rate:          number;   // wins / closed (0–1)
  total_pnl_r:       number;
  current_phase:     number;   // 1|2|3|4
  phase_progress:    number;   // trades in current phase
  phase_target:      number;   // 100|300|500|1000
}
```

#### Error Behavior

- `submitTrade()`: If validation fails (invalid prices, lot < 0.01), returns `{ error: 'validation_failed', message: string }` — does not throw
- `closeTrade()`: If tradeId not found, returns `{ error: 'not_found' }` — does not throw

---

## Contract 7: TwelveDataService

**File:** `src/services/TwelveDataService.js`  
**Phase:** 1  
**Dependencies:** `src/services/SimDataService.js` (fallback)  

### Function: `TwelveDataService.getPrice(symbol)`

#### Input
```typescript
symbol: string   // e.g. 'EUR/USD'
```

#### Return Value
```typescript
{
  price:     number;
  timestamp: number;    // UNIX ms
  source:    'live'|'cached'|'simulated';
}
```

### Function: `TwelveDataService.getCandles(symbol, interval, count)`

#### Input
```typescript
symbol:   string;   // 'EUR/USD'
interval: '1h'|'4h'|'1day';
count:    number;   // 1–100
```

#### Return Value
```typescript
{
  candles: Candle[];   // sorted ascending by time, deduplicated
  source:  'live'|'cached'|'simulated';
}
```

#### Caching Behavior

| Interval | Cache TTL |
|----------|-----------|
| `1h` | 4 minutes |
| `4h` | 4 minutes |
| `1day` | 60 minutes |
| Price | 30 seconds |

#### Error Behavior — Priority Order

1. If API key not set → return `SimDataService` data with `source: 'simulated'`
2. If API returns error/rate-limit → return cached data with `source: 'cached'`
3. If no cache available → return `SimDataService` data with `source: 'simulated'`
4. **Never throws.** Always returns usable candles.

---

## Contract 8: SimDataService

**File:** `src/services/SimDataService.js`  
**Phase:** 1  
**Dependencies:** `src/utils/indicators.js`  

### Function: `SimDataService.getCandles(count, basePrice, volatility, intervalHours)`

#### Input
```typescript
count:         number;   // default 80
basePrice:     number;   // default 1.1720
volatility:    number;   // default 0.0020 (pip range per candle)
intervalHours: number;   // default 4 (4H candles)
```

#### Return Value
```typescript
Candle[]   // count items, sorted ascending by time, starting count×intervalHours ago
```

#### Behavior
- Generates realistic random walk EUR/USD price data
- Slight bearish drift (Math.random() - 0.47) to produce interesting signals
- Time starts at `now() - count × intervalHours × 3600 seconds`
- Always produces valid OHLCV with high ≥ max(open, close) and low ≤ min(open, close)

---

## Contract 9: i18n Module

**File:** `src/i18n/i18n.js`  
**Phase:** 1  
**Dependencies:** `src/i18n/en.json`, `src/i18n/zh.json`  

### Function: `t(key, params?)`

#### Input
```typescript
key:     string;          // dot-notation e.g. 'signal.sell', 'risk.title'
params?: Record<string, string|number>;   // optional interpolation
```

#### Return Value
```typescript
string   // localized string in current language
         // falls back to EN if ZH key missing
         // falls back to key itself if neither language has it
```

#### Example
```javascript
t('signal.sell')         // Returns "做空 SELL" (ZH) or "SELL" (EN)
t('risk.lot', {n: 0.04}) // Returns "建议仓位: 0.04手" or "Recommended: 0.04 lot"
```

### Function: `setLang(lang)`

```typescript
lang: 'en'|'zh'

// Side effects:
// 1. Updates localStorage('language', lang)
// 2. Dispatches CustomEvent('languagechange') on window
// 3. All components listening to 'languagechange' re-render
```

### Function: `getLang()`

```typescript
returns: 'en'|'zh'
// Reads from: localStorage('language') || 'zh' (default)
```

### Function: `formatPrice(n)`

```typescript
n: number
returns: string   // e.g. 1.16252 → "1.16252"
```

### Function: `formatPips(n)`

```typescript
n: number
returns: string   // e.g. 50 → "50 pips" (EN) or "50点" (ZH)
```

### Function: `formatPct(n)`

```typescript
n: number   // 0–1 scale
returns: string   // e.g. 0.02 → "2.0%" (both languages)
```

### Standard Key Namespaces

```
nav.*           Navigation labels
signal.*        Signal direction labels (sell, buy, strongBuy, etc.)
signal.strength.*  8-state labels (strongBuy, buy, weakBuy, neutral, etc.)
risk.*          Risk Manager labels
agents.*        Agent names, roles, reason templates
regime.*        Regime labels (trending_bull, ranging, etc.)
decision.*      Decision Engine labels
mtf.*           MTF Engine states and labels
paper.*         Paper Trading labels
settings.*      Settings page labels
calendar.*      Economic calendar labels
news.*          News impact labels
errors.*        Error messages
common.*        Shared labels (loading, save, cancel, apply, confirm, etc.)
```

---

## Contract 10: AppState

**File:** `src/state/AppState.js`  
**Phase:** 1  
**Dependencies:** `src/state/AccountState.js`, `src/services/TwelveDataService.js`  

### Properties (read-only externally)

```typescript
AppState.candles_4h:   Candle[]    // Current 4H candle array
AppState.candles_1d:   Candle[]    // Current 1D candle array
AppState.candles_1h:   Candle[]    // Current 1H candle array
AppState.currentPrice: number      // Latest EUR/USD price
AppState.prevClose:    number      // Previous day's closing price
AppState.isLive:       boolean     // true if connected to real API
AppState.lastSignal:   DecisionResult|null
AppState.lastRegime:   RegimeResult|null
AppState.paperTrades:  PaperTradeRecord[]
AppState.weights:      WeightConfig   // Active committee weights
```

### Function: `AppState.getCandles(interval?)`

```typescript
interval?: '1H'|'4H'|'1D'   // default '4H'
returns: Candle[]
```

### Function: `AppState.refreshAll()`

```typescript
// Async. Fetches fresh price + candles from TwelveDataService.
// Updates all candle arrays.
// Dispatches CustomEvent('stateUpdated') on window.
returns: Promise<void>
```

### Function: `AppState.subscribe(eventName, callback)`

```typescript
eventName: 'stateUpdated'|'signalGenerated'|'regimeChanged'
callback:  (data: any) => void
// Components call this to react to state changes.
```

---

## Contract 11: AccountState

**File:** `src/state/AccountState.js`  
**Phase:** 1  
**Dependencies:** `src/i18n/i18n.js`  

### Function: `AccountState.getDefault()`

```typescript
returns: AccountProfile   // Factory default profile object
                          // Loaded from localStorage if exists,
                          // otherwise returns hardcoded defaults
```

### Function: `AccountState.get()`

```typescript
returns: AccountProfile   // Current active profile
```

### Function: `AccountState.update(fields)`

```typescript
fields: Partial<AccountProfile>   // Only changed fields needed
// Side effects:
// 1. Merges fields into current profile
// 2. Persists to localStorage
// 3. Dispatches CustomEvent('profileUpdated') on window
returns: AccountProfile   // Updated profile
```

### Function: `AccountState.incrementLoss()`

```typescript
// Called when a paper trade closes with outcome='loss'
// Increments consecutive_losses by 1
// Updates daily_risk_used by the trade's risk_pct
// Recalculates current_drawdown
// If consecutive_losses >= max_consecutive_losses: dispatches 'drawdownWarning' event
returns: void
```

### Function: `AccountState.resetLossStreak()`

```typescript
// Called when a paper trade closes with outcome='win'
// Resets consecutive_losses to 0
returns: void
```

---

## Revision History

| Version | Date | Change Description | Changed By | Approved By |
|---------|------|-------------------|------------|-------------|
| 1.0 | 2026-06 | Initial contracts — 11 interfaces defined | Claude (ONETO request) | Rolan/ONETO |

---

## Rules for Modifying Contracts

```
1. A contract revision requires adding a row to the Revision History table
2. The revision must be approved by Rolan/ONETO before implementation
3. If a function signature changes, all files that call that function
   must be identified and listed in the revision
4. Breaking changes (different return shape, removed fields) require
   a version bump in V4_MASTER_MANIFEST.md
5. Additive changes (new optional fields, new functions) can be
   implemented without breaking existing callers
```

---

*Interface Contracts Version: 1.0 | Last Updated: 2026-06*  
*These contracts are binding. No implementation may deviate from them without revision.*
