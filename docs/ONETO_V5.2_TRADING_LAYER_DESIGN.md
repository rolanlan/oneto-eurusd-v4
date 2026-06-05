# ONETO V5.2 — Trading Execution Layer Design

| Field | Value |
|-------|-------|
| **Document Type** | Architecture Design |
| **Baseline** | V4.6 (commit: 7f643b1) + V5.2 Audit findings |
| **Design Date** | 2026-06-05 |
| **Status** | APPROVED FOR DEVELOPMENT |
| **Audit Result** | LEVEL 2 — Partial Trading System |

This document defines the complete architecture for elevating ONETO from LEVEL 2 to LEVEL 1. All designs reference real existing code. No frozen components are modified.

---

## Design Principle

The audit confirmed that all trade calculation data already exists in the `Signal` object (36 fields including `entry_price`, `stop_loss`, `take_profit_1/2`, `lot_size`, `rr_ratio`, `effective_risk_pct`). The problem is:

1. No dedicated "Trade Setup" UI page — trade plan buried in Dashboard, only visible on actionable signals
2. No signal history array — `AppState` stores only `lastSignal`
3. Paper trade records missing `market_regime` and agent vote snapshot
4. No performance dashboard page
5. No agent accuracy tracking
6. No cross-session signal persistence

The design below adds these missing components without modifying any frozen scoring formulas, agent weights, or Signal Engine logic.

---

## Part 1 — Current Trade Setup Panel

### 1.1 Purpose

A dedicated navigation page that displays the full trade specification of the most recent actionable signal. Always visible — not buried in the Dashboard grid.

### 1.2 Navigation Entry

New sidebar nav item added between "Decision Engine" and "Risk Manager":

```
Signal group:
  📊 Dashboard
  📈 K-Line Chart
  🎯 Trade Setup     ← NEW (page: 'trade')
Analysis group:
  🧠 AI Committee
  ⚡ Decision Engine
  🛡️ Risk Manager
Trading group:
  📝 Paper Trading
Config:
  ⚙️ Settings
```

### 1.3 Trade Setup Display Specification

**Section 1: Signal Header**

| Field | Source | Display |
|-------|--------|---------|
| Signal Strength | `signal.signal_strength` | Large badge: STRONG BUY / BUY / WEAK BUY / SELL / etc. |
| Direction | `signal.direction` | Color-coded: green (BUY) / red (SELL) |
| Confidence | `signal.final_confidence` | `%` with progress bar |
| Generated | `signal.created_at` | `"2026-06-05 14:32:10"` |
| Signal ID | `signal.id` (last 8 chars) | `"#A3F7C201"` |
| Market Regime | `signal.market_regime` | Badge: `ranging \| trending_bull \| volatile` |

**Section 2: Price Levels**

| Field | Source | Display |
|-------|--------|---------|
| Entry Price | `signal.entry_price` | `1.08452` |
| Stop Loss | `signal.stop_loss` | `1.07952 (−50 pips)` |
| Take Profit 1 | `signal.take_profit_1` | `1.09252 (+80 pips)` |
| Take Profit 2 | `signal.take_profit_2` | `1.09752 (+130 pips)` |
| R/R Ratio | `signal.rr_ratio` | `1 : 2.60` |

**Section 3: Position Sizing**

| Field | Source | Display |
|-------|--------|---------|
| Lot Size | `signal.lot_size` | `0.05 lots` |
| Max Loss | `signal.max_loss_usd` | `$25.00` |
| Expected Profit (TP2) | `signal.expected_profit` | `$65.00` |
| Risk % | `signal.effective_risk_pct` | `2.50% of account` |
| Account Balance | `AccountState.get().account_balance` | `$1,000` |

**Section 4: Gate Summary**

| Gate | Source | Display |
|------|--------|---------|
| MTF Alignment | `signal.gates.mtf_pass` | ✅ / ❌ |
| Confidence | `signal.gates.confidence_pass` | ✅ / ❌ |
| R/R Ratio | `signal.gates.rr_pass` | ✅ / ❌ |
| Agent Agreement | `signal.gates.agent_agreement_pass` | ✅ / ❌ |
| Drawdown | `signal.gates.drawdown_pass` | ✅ / ❌ |
| Regime | `signal.gates.regime_pass` | ✅ / ❌ |

**Section 5: Quick Paper Trade Button**

When signal is actionable (`signal_strength ≠ NO_TRADE`):
- Button: "📝 Open Paper Trade" → navigates to Paper Trading page with form pre-filled from signal

When signal is NO_TRADE:
- Show NO_TRADE reason prominently
- Show which gates failed
- Show what data would be needed to change the outcome (e.g., "FRED key missing → macro data unavailable")

### 1.4 Implementation Scope

**New file:** `src/components/TradeSetupPanel.js`

**Data sources (all already exist, no new computation):**
- `AppState.getLastSignal()` → all 36 signal fields
- `AppState.getLastVotes()` → agent vote display
- `AccountState.get()` → balance and profile
- `AppState.subscribe('signalGenerated', () => render())` → auto-update

**Files to modify:**
- `index.html` → add `<section id="page-trade">` + nav item
- `index.html` → mount `TradeSetupPanel` + add to `showPage()`

---

## Part 2 — Signal History Store

### 2.1 Problem

`AppState._state.lastSignal` stores exactly one signal. Signal N overwrites Signal N−1. After 100 signal generations, zero history exists.

### 2.2 Design

Add a signal history ring buffer to `AppState`:

**New state field:** `_state.signalHistory: Signal[]` — max 200 entries, newest first

**New export:** `AppState.getSignalHistory(n = 50)` → returns last N signals

**Update `setSignalResult()`:** before overwriting `lastSignal`, unshift the new signal into `signalHistory`. Truncate to 200 entries.

**Persistence:** Serialize `signalHistory` to `localStorage('oneto_signal_history_v5')` — max 200 entries × ~2KB each ≈ 400KB (acceptable for localStorage).

### 2.3 Signal History Record Structure

Each entry in `signalHistory` stores:

```
SignalHistoryEntry {
  id:               string         Signal UUID
  timestamp:        number         Unix ms
  created_at:       string         ISO datetime
  signal_strength:  string         BUY | SELL | NO_TRADE | ...
  direction:        string         BUY | SELL | NEUTRAL
  final_score:      number         0–100
  final_confidence: number         0–100
  entry_price:      number         EUR/USD spot at generation
  stop_loss:        number
  take_profit_2:    number
  lot_size:         number
  effective_risk_pct: number
  market_regime:    string
  mtf_state:        string
  no_trade_reason:  string|null
  gates:            object         All 6 gate results
  agent_scores: {
    technical:      number
    macro:          number
    positioning:    number
    news:           number
    risk:           number
  }
  agent_votes: {
    technical:      string         BUY | SELL | NEUTRAL
    macro:          string
    positioning:    string
    news:           string
    risk:           string
  }
  data_sources: {
    fred:           string         live | cached | stub
    news:           string
    dxy:            string
    cot:            string
  }
}
```

**Files to modify:**
- `src/state/AppState.js` → add `signalHistory`, update `setSignalResult()`, add `getSignalHistory()`

---

## Part 3 — Enhanced Trade Record Structure

### 3.1 Current Paper Trade Record (from `PaperExecution._submit()`)

Current structure includes: `direction, entry_price, stop_loss, take_profit_1/2, sl/tp_pips, lot_size, risk_amount_usd, risk_pct, status, opened_at, closed_at, exit_price, pnl_pips, pnl_r, pnl_usd, exit_reason, outcome, duration_minutes, signal_id, validation_phase`

**Missing fields identified in audit:**
- `market_regime` — not stored (cannot analyze regime performance)
- Agent votes snapshot — not stored (cannot compute per-agent accuracy)
- `data_completeness_score` — not stored (cannot control for data quality)

### 3.2 Enhanced Trade Record Structure

Full `TradeRecord` object definition:

```
TradeRecord {
  // Identity
  id:                 string         UUID
  signal_id:          string|null    Links to SignalHistoryEntry

  // Trade specification
  direction:          string         BUY | SELL
  entry_price:        number         5dp EUR/USD
  stop_loss:          number         5dp EUR/USD
  take_profit_1:      number         5dp EUR/USD
  take_profit_2:      number         5dp EUR/USD
  sl_pips:            number         integer
  tp1_pips:           number
  tp2_pips:           number
  lot_size:           number         2dp
  risk_pct:           number         e.g. 0.02
  risk_amount_usd:    number         e.g. 20.00
  account_balance:    number         at time of trade open

  // Signal context (NEW — not in V4.6)
  market_regime:      string         ranging | trending_bull | volatile | ...
  mtf_state:          string         fully_aligned | partially_aligned | ...
  signal_strength:    string         BUY | STRONG_BUY | WEAK_BUY | ...
  final_score:        number         0–100
  final_confidence:   number         0–100
  agent_votes: {
    technical:        string         BUY | SELL | NEUTRAL
    macro:            string
    positioning:      string
    news:             string
    risk:             string
  }
  agent_scores: {
    technical:        number
    macro:            number
    positioning:      number
    news:             number
    risk:             number
  }
  data_sources: {
    fred:             string         live | cached | stub
    news:             string
    dxy:              string
    cot:              string
  }

  // Lifecycle
  status:             string         open | closed
  opened_at:          string         ISO datetime
  closed_at:          string|null
  validation_phase:   number         1–4

  // Outcome (populated on close)
  exit_price:         number|null    5dp EUR/USD
  exit_reason:        string|null    tp1 | tp2 | sl | manual | timeout
  pnl_pips:           number|null
  pnl_r:              number|null    e.g. +2.60 (full TP2), -1.00 (SL)
  pnl_usd:            number|null
  outcome:            string|null    win | loss | breakeven
  duration_minutes:   number|null
  exit_context: {
    price_at_close:   number
    regime_at_close:  string         may differ from regime at open
    session_at_close: string
  }
}
```

**Files to modify:**
- `src/core/PaperExecution.js` → add new fields to `_submit()`, add `exit_context` to `_close()`

---

## Part 4 — History Database Design

### 4.1 Local Storage Schema (V5.2 — Pre-Supabase)

All data persists locally until Supabase integration (V5.5).

| Store | localStorage Key | Max Size | Retention |
|-------|-----------------|----------|-----------|
| Signal history | `oneto_signal_history_v5` | 200 entries | Rolling, newest kept |
| Trade records | `oneto_paper_trades_v4` (existing) | No limit | All trades |
| Performance snapshot | `oneto_performance_v5` | 1 record | Updated on each trade close |
| Agent accuracy | `oneto_agent_accuracy_v5` | 1 record | Updated on each trade close |

### 4.2 Signal History Table

Stored as JSON array in localStorage. Each `SignalHistoryEntry` (see Part 2.3).

**Indexes needed at query time:**
- by `signal_strength` → filter NO_TRADE vs actionable
- by `market_regime` → regime performance analysis
- by `timestamp` → chronological display
- by `final_confidence` → confidence distribution

All computed client-side from the stored array on demand.

### 4.3 Trade Table

Existing `PaperExecution._trades[]` enhanced with new fields from Part 3.2.

**Analysis queries:**
```
Win rate by regime:
  trades.filter(t => t.market_regime === 'trending_bull')
        .filter(t => t.outcome === 'win').length / total_trending_bull

Win rate by agent agreement:
  trades.filter(t => agentsAgreeing(t) >= 4).filter(t.outcome === 'win')...

Per-agent accuracy:
  For each agent in [technical, macro, positioning, news]:
    trades where agent voted same direction as trade.direction
    → of those: win / total
```

### 4.4 Performance Snapshot Table

Computed on demand from `PaperExecution.getStats()` + enhanced analysis:

```
PerformanceSnapshot {
  computed_at:            string         ISO datetime

  // Existing (from PaperExecution.getStats())
  total_trades:           number
  open_trades:            number
  closed_trades:          number
  wins:                   number
  losses:                 number
  win_rate:               number         0–1
  total_pnl_r:            number
  total_pnl_usd:          number
  avg_win_r:              number
  avg_loss_r:             number
  profit_factor:          number
  max_consec_loss:        number

  // New — computed from enhanced trade records
  win_rate_by_regime: {
    trending_bull:        number
    trending_bear:        number
    ranging:              number
    volatile:             number
    breakout_up:          number
    breakout_down:        number
  }
  win_rate_by_strength: {
    STRONG_BUY:           number
    BUY:                  number
    WEAK_BUY:             number
    STRONG_SELL:          number
    SELL:                 number
    WEAK_SELL:            number
  }
  avg_duration_minutes:   number
  max_drawdown_r:         number         worst losing streak in R
  recovery_factor:        number         total_pnl_r / max_drawdown_r

  // Validation
  current_phase:          number         1–4
  go_live_eligible:       boolean
}
```

### 4.5 Agent Accuracy Table

Computed from enhanced trade records:

```
AgentAccuracy {
  computed_at:            string
  trades_analyzed:        number

  per_agent: {
    technical: {
      total_votes:        number         trades where agent had a directional vote
      correct_votes:      number         vote matched trade direction AND trade was a win
      accuracy:           number         0–1
      by_regime: {
        trending_bull:    number         accuracy in this regime
        ranging:          number
        volatile:         number
        ...
      }
    }
    macro:    { ... same structure ... }
    positioning: { ... }
    news:     { ... }
    risk:     { ... note: risk is scored not directional }
  }

  committee_accuracy:     number         overall win rate when committee was unanimous
  agreement_impact: {
    agreed_4:             number         win rate when 4 agents agreed
    agreed_3:             number         win rate when 3 agents agreed
    agreed_2:             number         win rate when 2 agents agreed
  }
}
```

---

## Part 5 — New UI Pages

### 5.1 Page: Trade Setup (`page-trade`)

**Purpose:** Full trade specification of the current signal.
**Nav icon:** 🎯
**Mount point:** `<div id="trade-mount"></div>`
**Component:** `src/components/TradeSetupPanel.js`

**Layout:**

```
┌─────────────────────────────────────────────────────────┐
│  CURRENT TRADE SETUP                    [⚡ Generate]   │
├──────────────────┬──────────────────────────────────────┤
│  SIGNAL          │  [SELL] Direction                    │
│  Confidence: 72% │  Market: ranging                    │
│  Agents: 3/5     │  Generated: 14:32:10                 │
├──────────────────┴──────────────────────────────────────┤
│  PRICE LEVELS                                           │
│  Entry     1.08452                                      │
│  Stop Loss 1.07952   (-50 pips)  ████░░░░░░ risk        │
│  TP1       1.09252   (+80 pips)                         │
│  TP2       1.09752   (+130 pips)  ═══════ R/R: 1:2.6    │
├─────────────────────────────────────────────────────────┤
│  POSITION SIZING                                        │
│  Lot Size   0.05    Max Loss  $25.00    Profit  $65.00  │
│  Risk %     2.50%   Balance   $1,000                    │
├─────────────────────────────────────────────────────────┤
│  GATE RESULTS                                           │
│  ✅ MTF  ✅ Confidence  ✅ R/R  ✅ Agreement  ✅ Drawdown │
├─────────────────────────────────────────────────────────┤
│  [📝 Open Paper Trade]   [📋 Copy Setup]                │
└─────────────────────────────────────────────────────────┘
```

**When NO_TRADE:**
```
┌─────────────────────────────────────────────────────────┐
│  NO TRADE SIGNAL                                        │
│  Reason: LOW_CONFIDENCE                                 │
│  Direction Score: 68  |  Confidence: 36%  (need ≥65%)  │
├─────────────────────────────────────────────────────────┤
│  GATE RESULTS                                           │
│  ✅ MTF  ❌ Confidence  ✅ R/R  ✅ Agreement  ✅ Drawdown │
├─────────────────────────────────────────────────────────┤
│  MISSING DATA                                           │
│  FRED: ✅  Finnhub: ⚠️ STUB  COT: ⚠️ STUB              │
│  → Configure Finnhub key in Settings to improve signal  │
└─────────────────────────────────────────────────────────┘
```

---

### 5.2 Page: Trade History (`page-history`)

**Purpose:** Full list of paper trade records with filtering.
**Nav icon:** 📋
**Mount point:** `<div id="history-mount"></div>`
**Component:** `src/components/TradeHistoryPanel.js`

**Layout:**

```
┌─────────────────────────────────────────────────────────┐
│  TRADE HISTORY              Filter: [All] [Open] [Closed]│
├────────┬───────┬───────┬────────┬────────┬──────┬───────┤
│ ID     │ Dir   │ Entry │ Exit   │ Pips   │ PnL  │ Regime│
├────────┼───────┼───────┼────────┼────────┼──────┼───────┤
│#A3F7C2 │ SELL  │1.0845 │1.0795  │ +50    │+2.6R │ranging│
│#B2E891 │ BUY   │1.0812 │1.0762  │ -50    │-1.0R │trend↑ │
│#C9D447 │ SELL  │1.0901 │ open   │  —     │  —   │ranging│
└────────┴───────┴───────┴────────┴────────┴──────┴───────┘

Trade Detail (click to expand):
  Signal: SELL | Confidence 72% | MTF: partially_aligned
  Agents: Technical SELL | Macro SELL | Positioning NEUTRAL
           News NEUTRAL | Risk: 58 (low risk)
  Duration: 4h 22m | Exit reason: TP2
```

**Sortable columns:** ID, Direction, Entry, Exit, Pips, PnL(R), Duration, Regime, Outcome

---

### 5.3 Page: Performance Dashboard (`page-performance`)

**Purpose:** Historical performance analytics.
**Nav icon:** 📊 (renamed from Dashboard, or use 📉)
**Mount point:** `<div id="performance-mount"></div>`
**Component:** `src/components/PerformanceDashboard.js`

**Sections:**

**Section 1: Key Metrics**
```
Win Rate    Profit Factor   Total PnL      Max Consec
  62.5%         1.87        +14.3R          3 losses
```

**Section 2: Performance by Regime**
```
Regime        Trades  Win%   Avg PnL
trending_bull   12    75%    +1.8R
ranging         28    54%    +0.4R
volatile         5    40%    -0.6R
breakout_up      3    67%    +1.2R
```

**Section 3: Performance by Signal Strength**
```
Strength     Trades  Win%   Avg PnL
STRONG_BUY      4    100%   +2.4R
BUY            12     67%   +1.2R
WEAK_BUY        8     50%   +0.1R
WEAK_SELL       6     50%   +0.2R
SELL           15     60%   +0.8R
STRONG_SELL     3     67%   +1.8R
```

**Section 4: Agent Accuracy**
```
Agent         Votes  Correct   Accuracy
Technical      38      26       68.4%
Macro          38      23       60.5%
Positioning    38      21       55.3%
News           38      20       52.6%
```

**Section 5: Validation Progress**
```
Phase 1: ████████████████████ 25/25 ✅
Phase 2: ████████████░░░░░░░░ 10/25 ⏳
Phase 3: ░░░░░░░░░░░░░░░░░░░░  0/25 ⬜
Phase 4: ░░░░░░░░░░░░░░░░░░░░  0/25 ⬜

Go-Live Eligibility: NOT YET (Phase 2 in progress)
Requirements: ≥100 trades, ≥60% win rate, PF ≥ 1.5
```

---

## Part 6 — Navigation Update

### 6.1 Revised Sidebar Structure

```
Signal group:
  📊 Dashboard       (existing)
  📈 K-Line Chart    (existing)
  🎯 Trade Setup     (NEW — page-trade)

Analysis group:
  🧠 AI Committee    (existing)
  ⚡ Decision Engine  (existing)
  🛡️ Risk Manager    (existing)

Trading group:
  📝 Paper Trading   (existing)
  📋 Trade History   (NEW — page-history)
  📈 Performance     (NEW — page-performance)

Config:
  ⚙️ Settings        (existing)
```

### 6.2 Files to Modify for Navigation

- `index.html` → add 3 new `<section>` + 3 new `<a class="nav-item">` + mount calls

---

## Part 7 — Learning Engine Interface

### 7.1 Architecture

The Learning Engine is a future module that reads from the History Database and proposes weight adjustments. The design below defines the interface contracts so V5.2 implementation can proceed without the Learning Engine being complete.

### 7.2 Data Feed Interface

```
LearningEngine.analyze() reads:
  AgentAccuracy  (from Part 4.5)
  PerformanceSnapshot (from Part 4.4)
  SignalHistory[] (from Part 2)
  TradeRecord[] (from Part 3)

Minimum data requirements before analysis:
  ≥ 50 closed trades
  ≥ 2 different market regimes represented
  ≥ 1 complete validation phase
```

### 7.3 Output Interface

```
LearningProposal {
  proposed_at:     string         ISO datetime
  trades_analyzed: number
  current_weights: WeightConfig   { technical, macro, positioning, news, risk }
  proposed_weights: WeightConfig
  rationale: {
    per_agent: {
      technical: string   "accuracy 68.4% → maintain weight"
      macro:     string   "accuracy 60.5% in ranging, 42% in volatile → reduce volatile weight"
      ...
    }
  }
  confidence:      number         0–1 (how confident the proposal is)
  requires_approval: true         always true — user must explicitly approve
}
```

### 7.4 Approval Flow

```
LearningEngine.analyze()
  → LearningProposal
  → stored in localStorage('oneto_learning_proposal_v5')
  → displayed in PerformanceDashboard "Proposal" section
  → user reviews: [Accept] [Reject] [Defer]
  → on Accept: AccountState.setWeights(proposal.proposed_weights)
  → WeightConfig validated: sum = 1.0, no weight < 0.05, no weight > 0.55
  → weight change logged to signalHistory meta
```

### 7.5 Supabase Integration (V5.5)

When Supabase is available, the local localStorage stores are migrated:

```
Signal history → Supabase table: oneto_signals
  Fields: all SignalHistoryEntry fields
  Row policy: user_id (row-level security)
  Index: timestamp DESC, signal_strength, market_regime

Trade records → Supabase table: oneto_trades
  Fields: all TradeRecord fields
  Foreign key: signal_id → oneto_signals.id
  Index: opened_at DESC, outcome, market_regime

Performance snapshots → Supabase table: oneto_performance
  One row per compute_at timestamp (daily snapshots)

Agent accuracy → Supabase table: oneto_agent_accuracy
  One row per compute_at timestamp
```

**Migration path:**
- `PaperExecution._persistTrades()` → dual-write: localStorage + Supabase (with fail-safe: localStorage always written first)
- `AppState._persistSignalHistory()` → same dual-write pattern
- On first Supabase connection: sync all localStorage history to Supabase in background

### 7.6 Paper Trading → OANDA Integration

When `OandaPracticeAdapter` is implemented (BACKLOG-010), paper trades transition to live practice execution:

```
TradeSetupPanel [Open Paper Trade] button
  → today: PaperExecution.submitTrade()
  → V5.5+: if OANDA Practice connected → OandaExecution.submitMarketOrder()
             track result in same TradeRecord format
             store execution confirmation in trade.exit_context
```

The TradeRecord structure is designed to accommodate both paper and live trades — no schema change needed when OANDA is added.

---

## Part 8 — Implementation Priority Order

| Priority | Component | Effort | Dependency |
|----------|-----------|--------|-----------|
| P0 | Trade Setup Panel (TradeSetupPanel.js) | Small | None — uses existing Signal object |
| P0 | Signal history in AppState | Small | None |
| P1 | Enhanced trade record (market_regime + agent votes) | Small | PaperExecution change |
| P1 | Trade History Panel (TradeHistoryPanel.js) | Medium | Enhanced trade record |
| P2 | Performance Dashboard | Medium | Enhanced trade record + agent accuracy |
| P2 | Agent accuracy computation | Medium | Enhanced trade record |
| P3 | Learning Engine interface | Large | Performance Dashboard + AgentAccuracy |
| P4 | Supabase sync | Large | BACKLOG-009 |
| P5 | OANDA Practice | Large | BACKLOG-010 + ≥100 validated paper trades |

---

## Part 9 — Files to Create / Modify Summary

### New Files

| File | Purpose |
|------|---------|
| `src/components/TradeSetupPanel.js` | Trade Setup page UI |
| `src/components/TradeHistoryPanel.js` | Trade History page UI |
| `src/components/PerformanceDashboard.js` | Performance analytics page UI |

### Files to Modify (minimal changes, no frozen component touches)

| File | Change |
|------|--------|
| `index.html` | Add 3 nav items + 3 page sections + 3 mount calls |
| `src/state/AppState.js` | Add `signalHistory[]`, `getSignalHistory()`, update `setSignalResult()` |
| `src/core/PaperExecution.js` | Add `market_regime`, `agent_votes`, `agent_scores`, `data_sources`, `exit_context` to trade record |

### No Changes To (frozen)

- `src/core/SignalEngine.js` — no scoring changes
- `src/agents/*.js` — no agent logic changes
- `src/types/Signal.js` — Signal object already contains all needed fields
- `src/types/Vote.js` — REGIME_WEIGHTS unchanged
- `src/core/RiskManager.js` — calculation logic unchanged

---

## Part 10 — Completion Criteria (LEVEL 1 Checklist)

ONETO reaches LEVEL 1 when:

| Requirement | Status After V5.2 |
|------------|-----------------|
| Entry, SL, TP1, TP2 displayed prominently | ✅ TradeSetupPanel |
| Position size and Risk% displayed prominently | ✅ TradeSetupPanel |
| R/R ratio displayed | ✅ TradeSetupPanel |
| Signal history stored (not just last signal) | ✅ AppState.signalHistory |
| Trade history with full record | ✅ Enhanced PaperExecution |
| Market regime per trade | ✅ Enhanced PaperExecution |
| Per-agent accuracy tracked | ✅ AgentAccuracy computation |
| Performance dashboard | ✅ PerformanceDashboard |
| Win rate by regime | ✅ PerformanceDashboard |
| Learning engine interface designed | ✅ (implementation V5.6) |
| Live execution | ❌ V5.5+ (OANDA Practice) |
| Supabase persistence | ❌ V5.5 |

After V5.2: **LEVEL 1.5** — Complete analysis + paper trading system with full history. Missing only live execution and cross-device persistence.

---

*Document version: V5.2-DESIGN-001 | Created: 2026-06-05 | Baseline: V4.6 commit 7f643b1*
