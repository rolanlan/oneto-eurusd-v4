# ONETO V5.2 — Trading Execution Layer Audit

| Field | Value |
|-------|-------|
| **Document Type** | Architecture Audit |
| **Baseline Version** | V4.6 (commit: 7f643b1) |
| **Audit Date** | 2026-06-05 |
| **Scope** | SignalEngine, DecisionEngine, RiskManager, PaperExecution, UI panels |

---

## Audit A — Final Signal Object: Complete Field List

**Source:** `src/types/Signal.js → createSignal()`  
**Verification:** `src/core/SignalEngine.js` line 233–255 (all fields confirmed populated at assembly)

The final `Signal` object produced by `SignalEngine.run()` and stored in `AppState.lastSignal` contains the following fields:

### A1. Identity Fields
| Field | Type | Value Source |
|-------|------|-------------|
| `id` | string | `generateId()` — UUID-style unique identifier |
| `timestamp` | number | `Date.now()` at signal generation |
| `created_at` | string | ISO datetime string |
| `updated_at` | string | ISO datetime string |

### A2. Classification Fields
| Field | Type | Value Source |
|-------|------|-------------|
| `signal_strength` | string | `STRONG_BUY \| BUY \| WEAK_BUY \| NEUTRAL \| WEAK_SELL \| SELL \| STRONG_SELL \| NO_TRADE` |
| `direction` | string | `BUY \| SELL \| NEUTRAL` |
| `status` | string | `GENERATED \| NO_TRADE` |

### A3. Score Fields (0–100)
| Field | Type | Value Source |
|-------|------|-------------|
| `final_score` | number | Weighted avg of 4 directional agents |
| `final_confidence` | number | `\|dirScore−50\|×2 − riskPenalty + MTFadj` |
| `technical_score` | number | TechnicalAnalyst vote score |
| `macro_score` | number | MacroAnalyst vote score |
| `positioning_score` | number | PositioningAnalyst vote score |
| `news_score` | number | NewsAnalyst vote score |
| `risk_score` | number | RiskAnalyst vote score |
| `agents_agreeing` | number | Count of agents voting same direction |

### A4. Price Level Fields ← KEY FINDING
| Field | Type | Value Source |
|-------|------|-------------|
| `entry_price` | number | `computePriceLevels(currentPrice)` → current EUR/USD spot |
| `stop_loss` | number | `entry_price ± (50 pips × 0.0001)` |
| `take_profit_1` | number | `entry_price ∓ (80 pips × 0.0001)` |
| `take_profit_2` | number | `entry_price ∓ (130 pips × 0.0001)` |
| `sl_pips` | number | 50 (frozen default) |
| `tp1_pips` | number | 80 (frozen default) |
| `tp2_pips` | number | 130 (frozen default) |
| `rr_ratio` | number | `tp2_pips / sl_pips = 2.6` |

### A5. Risk Manager Output Fields ← KEY FINDING
| Field | Type | Value Source |
|-------|------|-------------|
| `lot_size` | number | `RiskManager.calc()` — 4-multiplier formula |
| `max_loss_usd` | number | `lot_size × sl_pips × $10` |
| `expected_profit` | number | `lot_size × tp2_pips × $10` |
| `effective_risk_pct` | number | `max_loss_usd / account_balance` |

### A6. Context Fields
| Field | Type | Value Source |
|-------|------|-------------|
| `timeframe` | string | `'4H'` (fixed) |
| `market_regime` | string | RegimeEngine output |
| `session` | string | Time-based session label |
| `mtf_state` | string | MTFEngine output |
| `mtf_confidence_adj` | number | MTFEngine confidence adjustment |

### A7. Structural Fields
| Field | Type | Value Source |
|-------|------|-------------|
| `explanation` | ExplanationItem[] | `_buildExplanation(votes, regime, mtfResult)` |
| `gates` | object | `{ mtf_pass, confidence_pass, rr_pass, agent_agreement_pass, drawdown_pass, regime_pass }` |
| `no_trade_reason` | string\|null | Reason code when NO_TRADE |
| `snapshot_id` | string\|null | MarketSnapshot reference (Phase 5+ DB) |
| `macro_report_id` | string\|null | Macro report reference (Phase 5+ DB) |

**Total fields: 36**

---

## Audit B — Feature Existence Check

| Feature | Exists | Code Location | Detail |
|---------|--------|---------------|--------|
| **Entry Price** | ✅ YES | `Signal.entry_price`, `computePriceLevels()` in `Signal.js:307` | Current EUR/USD spot price at signal generation |
| **Stop Loss** | ✅ YES | `Signal.stop_loss`, `computePriceLevels()` in `Signal.js:308` | Fixed 50-pip SL from entry |
| **Take Profit 1** | ✅ YES | `Signal.take_profit_1`, `computePriceLevels()` in `Signal.js:309` | Fixed 80-pip TP1 |
| **Take Profit 2** | ✅ YES | `Signal.take_profit_2`, `computePriceLevels()` in `Signal.js:310` | Fixed 130-pip TP2 |
| **RR Ratio** | ✅ YES | `Signal.rr_ratio` populated in `SignalEngine.js:248` via `...priceLevels` | Fixed 2.6 (130/50) |
| **Position Size** | ✅ YES | `Signal.lot_size` from `RiskManager.calc()` in `SignalEngine.js:249` | 4-multiplier formula |
| **Risk Percent** | ✅ YES | `Signal.effective_risk_pct` from `RiskManager.calc()` | e.g. 0.02 for standard profile |
| **ATR Stop** | ❌ NO | `RiskAnalyst.js` uses ATR ratio for risk scoring only | ATR is used for regime risk, not for dynamic SL placement |
| **ATR Target** | ❌ NO | Not implemented | ATR-based TP not implemented |
| **Dynamic Position Sizing** | ✅ YES | `RiskManager.calc()` with 4 multipliers (regime, drawdown, performance, risk score) | Uses regime, drawdown, win rate, risk score multipliers |

---

## Audit C — Why Users Cannot See Entry/SL/TP/Position Size

**Conclusion: OPTION A — System HAS calculated all values. UI is NOT displaying them on the main visible pages.**

### C1. Where the values ARE displayed

| UI Location | Fields Shown | Visibility |
|-------------|-------------|-----------|
| **HeroPanel** (Dashboard) `_buildTradePlan()` line 249–265 | `entry_price, stop_loss, take_profit_1, take_profit_2, rr_ratio, lot_size, max_loss_usd` | ✅ Exists in code |
| **RiskManagerPanel** | `lot_size, max_loss_usd, rr_ratio, sl_pips, tp2_pips` | ✅ Displayed in Risk Manager page |
| **PaperTradePanel** form | `entry_price, stop_loss, tp1, tp2, lot_size` pre-filled from signal | ✅ Displayed in Paper Trading page |

### C2. Why users report NOT seeing them

**Root cause 1 — Trade Plan only shows for actionable signals:**
`HeroPanel._buildTradePlan()` has this condition:
```javascript
if (!signal || !isActionable(signal)) {
  return `<div class="trade-plan trade-plan-empty">...</div>`;
}
```
`isActionable()` returns `false` for `NO_TRADE`. Given >80% of signals are `NO_TRADE` in current V4.6 data state, the trade plan section is almost always showing the empty state.

**Root cause 2 — Layout position:**
The trade plan is at the bottom of the HeroPanel inside the dashboard grid. If the user is looking at the Committee or Decision Engine pages, they are not on the dashboard where the trade plan is shown.

**Root cause 3 — NO separate "Trade Setup" page:**
There is no dedicated page in the navigation for "Current Trade Setup." The trade plan is embedded in the Dashboard, not its own view. Users navigating to Committee/Decision/Risk pages see analysis only.

### C3. Definitive Conclusion

**The system computes Entry Price, SL, TP1, TP2, RR, Lot Size, Risk % on EVERY actionable signal.** These values are present in `AppState.lastSignal` after every `generateSignal()` call. The problem is:
1. Users rarely see actionable signals (>80% NO_TRADE)
2. No dedicated "Trade Setup" page in navigation
3. Trade plan is hidden inside the dashboard, not prominently featured

---

## Audit D — RiskManager Real Responsibilities

**Source:** `src/core/RiskManager.js`

RiskManager is NOT merely a risk level classifier. It performs full position sizing calculations.

### D1. Actual RiskManager Outputs (from `RiskManager.calc()`)

| Output Field | Type | Description |
|-------------|------|-------------|
| `lot_size` | number | Final recommended lot size (0.01–max) |
| `base_lot_size` | number | Before multipliers |
| `max_loss_usd` | number | Maximum dollar loss at SL |
| `expected_profit_usd` | number | Expected profit at TP2 |
| `rr_ratio` | number | Risk-reward ratio |
| `effective_risk_pct` | number | Actual portfolio risk percentage |
| `regime_multiplier` | number | m1 — regime-based adjustment |
| `drawdown_multiplier` | number | m2 — consecutive loss penalty |
| `performance_multiplier` | number | m3 — win rate adjustment |
| `risk_score_multiplier` | number | m4 — RiskAnalyst score adjustment |
| `risk_level` | string | `LOW \| STANDARD \| ELEVATED \| HIGH` |
| `level_color` | string | Display color |
| `level_text_en` | string | English label |
| `level_text_zh` | string | Chinese label |
| `drawdown_warning` | boolean | 3+ consecutive losses warning |
| `system_halt` | boolean | Full halt flag |

### D2. Position Sizing Formula

```
base_lot = (account_balance × risk_pct) / (sl_pips × $10)

Risk profiles:
  conservative: 1% of balance
  standard:     2% of balance
  aggressive:   5% of balance

final_lot = base_lot × m1(regime) × m2(drawdown) × m3(win_rate) × m4(risk_score)

Multiplier ranges:
  m1: 0.50 (volatile) → 1.10 (trending)
  m2: 0.25 (5 consec losses) → 1.00 (normal)
  m3: 0.75 (win rate < 40%) → 1.00 (normal)
  m4: 0.25 (risk score > 85) → 1.25 (risk score < 40)
```

### D3. RiskManager's True Role

RiskManager is a **full position sizing engine with risk control**. It:
- Calculates exact lot size for every trade
- Computes P&L projections (max loss, expected profit)
- Applies 4 independent multipliers based on current conditions
- Enforces hard position caps (`max = balance / 2000`)
- Provides halt detection (`checkSystemHalt()`)
- Provides performance-based position reduction (`getRecentWinRate()`)

The `risk_level` label (LOW/STANDARD/ELEVATED/HIGH) is a secondary display output derived from `effective_risk_pct`, not the primary function.

---

## Audit E — History and Performance Tracking

| Feature | Exists | Code Location | Detail |
|---------|--------|---------------|--------|
| **Signal History** | ❌ NO | `AppState._state` has no history array | Only `lastSignal` (single record). No signal history array exists anywhere. |
| **Trade History** | ✅ YES (in-memory) | `PaperExecution._trades[]` in `PaperExecution.js` | Full trade records stored in module-level array + localStorage. Includes open + closed trades. |
| **Execution History** | ⚠️ PARTIAL | `PaperExecution.getAll()` | Paper trades only. No live execution history (OandaExecution not implemented). |
| **Performance History** | ✅ YES (aggregated) | `PaperExecution.getStats()` | Win rate, profit factor, total PnL in R and USD, avg win/loss R, max consecutive losses |
| **Win Rate** | ✅ YES | `PaperExecution.getStats().win_rate` | Computed from all closed paper trades |
| **PnL** | ✅ YES | `PaperExecution.getStats().total_pnl_r` and `total_pnl_usd` | Both R-multiple and USD PnL tracked |
| **Drawdown** | ⚠️ PARTIAL | `AccountState._state.current_drawdown` | Current drawdown tracked in AccountState, updated on each trade close. No historical drawdown curve. |
| **Sharpe Ratio** | ❌ NO | Not implemented anywhere | No calculation exists |
| **Profit Factor** | ✅ YES | `PaperExecution.getStats().profit_factor` | `gross_profit / gross_loss` across all closed trades |
| **Agent Accuracy** | ❌ NO | Not implemented | No per-agent historical accuracy tracking |

### E1. Storage Layer

| Data | Storage | Persistence |
|------|---------|-------------|
| Signal (last 1 only) | `AppState._state.lastSignal` | In-memory, lost on page reload |
| Paper trades | `PaperExecution._trades[]` + `localStorage('oneto_paper_trades_v4')` | Survives page reload |
| Account profile | `AccountState` + `localStorage('account_profile_v4')` | Survives page reload |
| Performance stats | Computed from `_trades[]` on demand | Derived, no separate storage |

---

## Audit F — Learning Capability

### F1. With 100 Signals Generated

**Can the system:**
- **Record signals?** ❌ NO — `AppState` stores only `lastSignal`. Signal 1 is overwritten by signal 2.
- **Record which agent voted which way?** ❌ NO — `AppState.lastVotes` also stores only the latest.
- **Count NO_TRADE reasons?** ❌ NO — no aggregation exists
- **Track signal accuracy?** ❌ NO — no mechanism to compare signal direction vs subsequent price movement

### F2. With 100 Paper Trades

**Can the system:**
- **Record all trades?** ✅ YES — `PaperExecution._trades[]` + localStorage
- **Compute win rate?** ✅ YES — `getStats().win_rate`
- **Compute profit factor?** ✅ YES — `getStats().profit_factor`
- **Identify which regimes perform better?** ❌ NO — trade records do not store `market_regime`
- **Know which agent votes correlated with wins?** ❌ NO — agent votes not stored in trade records
- **Auto-adjust weights based on performance?** ❌ NO — `AccountState.setWeights()` exists but no auto-optimizer

### F3. With 500–1000 Signals

**Can the system optimize itself?**
- **Learning Engine logic:** ❌ NO — not implemented
- **Signal history database:** ❌ NO — no persistent signal store (Supabase integration pending)
- **Agent accuracy tracking:** ❌ NO — no per-agent win/loss association
- **Weight proposals:** ❌ NO — no analysis engine to propose weights

### F4. Missing Modules for Learning Capability

| Module | Status | Required For |
|--------|--------|-------------|
| Signal history store (array or DB) | ❌ Missing | Learning, accuracy analysis |
| Trade-to-signal linkage (agent votes in trade record) | ❌ Missing | Per-agent accuracy |
| Supabase integration | ❌ Missing | Cross-session persistence |
| Agent accuracy analyzer | ❌ Missing | Weight optimization proposals |
| Drawdown curve (time series) | ❌ Missing | Sharpe ratio, performance charts |

---

## Final Rating

### **LEVEL 2 — Partial Trading System**

**Evidence supporting LEVEL 2 (not LEVEL 3):**
- Entry Price, SL, TP1, TP2, RR, Lot Size, Risk% are **fully computed** in `SignalEngine` and stored in the `Signal` object — 36 complete fields
- `RiskManager` is a full position sizing engine, not a label generator
- Paper trading with full P&L tracking exists (`PaperExecution`)
- Performance stats (win rate, profit factor, PnL) computed correctly
- `HeroPanel._buildTradePlan()` renders the complete trade setup when signal is actionable

**Evidence against LEVEL 1 (why not a complete system):**
- No dedicated "Trade Setup" navigation page — trade plan buried in Dashboard
- No signal history — only the last signal is stored
- Paper trade records do not include agent votes — no per-agent accuracy
- No live execution — `OandaExecution` returns `NOT_IMPLEMENTED` on all methods
- No learning engine — 1000 signals produce no self-optimization
- No performance dashboard UI page
- `market_regime` not stored in paper trade records
- No Supabase persistence — all history lost on browser refresh (except paper trades via localStorage)

---

*End of Audit | V5.2 Trading Layer Design follows in ONETO_V5.2_TRADING_LAYER_DESIGN.md*
