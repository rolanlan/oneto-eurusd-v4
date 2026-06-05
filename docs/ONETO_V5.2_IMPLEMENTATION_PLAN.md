# ONETO V5.2 — Implementation Plan (Pre-Coding Review)

| Field | Value |
|-------|-------|
| **Document Type** | Pre-Coding Architecture Review |
| **Baseline** | V4.6 (commit: 7f643b1) |
| **Review Date** | 2026-06-05 |
| **Design Reference** | ONETO_V5.2_TRADING_LAYER_DESIGN.md |
| **Audit Reference** | ONETO_V5.2_TRADING_LAYER_AUDIT.md |

---

## Task 1 — Code Review Findings

### AppState.js (src/state/AppState.js)

`_state` object stores exactly one signal (`lastSignal: null`), one votes array (`lastVotes: []`), and one verdict. No history array. `setSignalResult()` overwrites the previous signal without archiving it. The `_dispatch('signalGenerated', ...)` event fires immediately after overwrite. There is no localStorage persistence in this file — everything is session-only.

**Key finding:** There is a clean insertion point for history at line 218 in `setSignalResult()` — directly before `_state.lastSignal = result.signal`. A two-line addition (`_historyUnshift(result.signal, result.votes)`) is all that is required.

### PaperExecution.js (src/core/PaperExecution.js)

`_submit()` stores 16 fields. Current `signal_id` is passed from `PaperTradePanel._handleSubmit()`. However, `market_regime`, `agent_votes`, `agent_scores`, and `data_sources` are **not** in the `_submit()` input — they must be added to both the input signature and the trade record. Critically, `_close()` constructs a `result` object (line 315) that already has `regime: closed.regime ?? 'unknown'` — but `closed.regime` is undefined because it was never stored in the open trade record. This confirms the audit finding: regime appears in the closed result but is always `'unknown'`.

**Key finding:** `PaperTradePanel._handleSubmit()` calls `PaperExecution.submitTrade()` with only 8 fields. It already reads `AppState.getLastSignal()?.id` for `signal_id`. The same call site can pass `market_regime`, `agent_votes`, and `agent_scores` from `AppState.getLastSignal()` and `AppState.getLastVotes()` with zero changes to the overall submit flow.

### index.html

Currently has 7 `<section class="page">` blocks (dashboard, kline, committee, decision, risk, paper, settings). Navigation has 7 corresponding `<a class="nav-item">` entries. The `showPage()` function handles all routing via `pages.forEach(p => p.classList.remove('active'))`. Adding 3 new pages (trade, history, performance) is a pure HTML addition — the routing logic already handles any `data-page` attribute correctly without modification.

**Key finding:** BUG-01 fix (`_klineDashParent` DOM move logic) is specific to the K-Line page. New pages have no such requirement. Adding new pages is zero-risk to the existing `showPage()` function.

### HeroPanel.js (src/components/HeroPanel.js)

`_buildTradePlan()` already renders Entry, SL, TP1, TP2, RR, Lot, MaxLoss. The render is gated by `isActionable(signal)`. `TradeSetupPanel` will replicate this display but also handle the NO_TRADE state. There is **no conflict** — both panels read from `AppState.getLastSignal()`, neither writes to it.

### RiskManagerPanel.js (src/components/RiskManagerPanel.js)

Reads `signal.sl_pips`, `signal.tp2_pips`, `result.lot_size`, `result.max_loss_usd`, `result.rr_ratio` for display. Operates entirely independently. No changes needed for V5.2.

### Signal.js (src/types/Signal.js)

All 36 fields are already present and populated in every actionable signal. `isActionable()` exists at line 230+ and is importable. No changes needed.

### i18n.js (src/i18n/i18n.js)

Current structure stores ZH/EN objects. New nav keys needed: `nav.trade`, `nav.history`, `nav.performance`. New label keys needed: `trade.setup`, `trade.gateResults`, `history.title`, `performance.winRate`, etc. **Risk:** If a key is missing, `t(key)` returns the key string unchanged (safe fallback). Missing i18n keys do not cause crashes.

---

## Task 2 — V5.2 Affected Files

### A. New Files to Create

| File | Purpose | Risk Level |
|------|---------|-----------|
| `src/components/TradeSetupPanel.js` | Trade Setup page — renders signal's Entry/SL/TP/RR/Lot. Reads `AppState.getLastSignal()`. Subscribe to `signalGenerated`. | Low — read-only access to AppState |
| `src/components/TradeHistoryPanel.js` | Trade History page — renders all paper trades from `PaperExecution.getAll()`. Subscribe to `paperTradeOpened`, `paperTradeClosed`. | Low — read-only access to PaperExecution |
| `src/components/PerformanceDashboard.js` | Performance analytics — renders stats from `PaperExecution.getStats()` + computed agent accuracy. | Low — read-only access to PaperExecution |

### B. Files to Modify

| File | What Changes | Risk Level |
|------|-------------|-----------|
| `src/state/AppState.js` | Add `_state.signalHistory[]`, `_state.signalHistory` localStorage persistence, `getSignalHistory(n)` export, update `setSignalResult()` | **Medium** — core state mutation. One wrong line breaks all signal dispatch. Must verify `_dispatch()` still fires on every call. |
| `src/core/PaperExecution.js` | Add `market_regime`, `agent_votes`, `agent_scores` to `_submit()` input destructuring and `trade` object. Update `_persistTrades()`. | **Medium** — changes localStorage schema. Existing trades loaded from `paper_trades_v4` will be missing new fields — must handle gracefully with `?? 'unknown'` fallbacks. |
| `src/components/PaperTradePanel.js` | Update `_handleSubmit()` to pass `market_regime` and agent data from `AppState.getLastSignal()` + `AppState.getLastVotes()`. | Low — isolated to one function, no logic change |
| `index.html` | Add 3 `<section>` blocks, 3 `<a class="nav-item">` entries, 3 import statements, 3 mount calls | Low — additive only, no existing code modified |
| `src/i18n/i18n.js` | Add new translation keys for 3 new pages | Low — additive only, missing keys degrade gracefully |

### C. Files That Must NOT Be Modified

| File | Reason |
|------|--------|
| `src/core/SignalEngine.js` | Frozen V4.6. All 36 signal fields already computed correctly. |
| `src/agents/*.js` | All 5 agents frozen. V5.2 only reads their output. |
| `src/types/Signal.js` | Signal object complete. `isActionable()` used as-is. |
| `src/types/Vote.js` | REGIME_WEIGHTS frozen. |
| `src/core/RiskManager.js` | Lot sizing frozen. |
| `src/core/DataProvider.js` | Not involved in V5.2. |
| `src/services/MemoryAggregator.js` | Not involved in V5.2. |
| `src/services/FREDService.js` | Not involved in V5.2. |
| `src/services/FinnhubService.js` | Not involved in V5.2. |
| `src/services/COTService.js` | Not involved in V5.2. |
| `styles/*.css` | Can add new CSS classes in a new `styles/trading.css` file. Never edit `base.css`. |
| `src/core/MTFEngine.js` | Not involved in V5.2. |
| `src/core/RegimeEngine.js` | Not involved in V5.2. |
| `src/agents/CommitteeOrchestrator.js` | Not involved in V5.2. |

---

## Task 3 — Design Gap Analysis

### Gap 1: AppState.js localStorage key collision risk

**Design document says:** persist `signalHistory` to `localStorage('oneto_signal_history_v5')`

**Risk found:** AppState currently has NO localStorage code — the comment on line 8 explicitly says "Does NOT persist to localStorage (runtime state only)." Adding localStorage to AppState requires careful placement to avoid the `window` context error in non-browser environments (the existing `window.addEventListener` call on line 316 is inside a `try/catch` for this reason). Signal history persistence must also use try/catch.

**Resolution:** Add `_persistHistory()` and `_loadHistory()` private functions using the same try/catch pattern as `FREDService._saveCache()`. Load history at module init, persist after each `_historyUnshift()`.

---

### Gap 2: PaperExecution localStorage schema migration

**Design document says:** add new fields to trade record

**Risk found:** Existing trades in `localStorage('paper_trades_v4')` were stored without `market_regime`, `agent_votes`, `agent_scores`, `data_sources`. When `_loadTrades()` deserializes old records, these fields will be `undefined`. The design document mentions `?? 'unknown'` fallbacks but does not specify where they must be applied.

**Resolution:** In `_loadTrades()`, after parsing JSON, apply a migration function that sets default values for any missing fields: `trade.market_regime ?? 'unknown'`, `trade.agent_votes ?? {}`, `trade.agent_scores ?? {}`. This migration must run once on load, not on every access.

---

### Gap 3: TradeSetupPanel event subscription — missing unsubscribe

**Design document says:** `subscribe to signalGenerated → render()`

**Risk found:** All existing panels (CommitteePanel, DecisionPanel, etc.) call `AppState.subscribe()` inside `mount()` and never call the returned unsubscribe function. This is fine because panels are mounted once and never unmounted. However, if `TradeSetupPanel.mount()` is called multiple times (which is safe because it checks `if (_mounted) return`), the subscription should only register once.

**Resolution:** Store the unsubscribe return value and guard against duplicate subscriptions with `if (_mounted) return` at the top of `mount()`, consistent with `KLinePanel` pattern.

---

### Gap 4: PerformanceDashboard has no real-time event source

**Design document says:** Performance Dashboard reads from `PaperExecution.getStats()`

**Risk found:** `PaperExecution` dispatches `paperTradeClosed` and `paperTradeOpened` events via its internal `_emit()`. But `_emit()` is NOT AppState's event bus — it is a local event emitter (internal to PaperExecution). The design document does not specify how PerformanceDashboard subscribes to trade updates.

**Checking PaperExecution event architecture:**
```javascript
// PaperExecution uses _emit() which dispatches window CustomEvents
_emit('paperTradeClosed', closed)
```

**Resolution:** PerformanceDashboard must use `window.addEventListener('paperTradeClosed', () => render())` rather than `AppState.subscribe()`. This is consistent with how `PaperTradePanel` receives trade events.

---

### Gap 5: AgentAccuracy computation — no dedicated computation module

**Design document says:** compute AgentAccuracy from enhanced trade records

**Risk found:** The design specifies the AgentAccuracy data structure but does not specify where the computation runs. Options are: (a) inside `PerformanceDashboard` on render, (b) inside `PaperExecution` after each trade close, (c) a new `AgentAccuracyEngine.js`. Computing on render is simplest and correct for V5.2.

**Resolution:** Compute inline inside `PerformanceDashboard._computeAgentAccuracy(trades)` — a pure function that takes the trade array and returns the accuracy object. No new service file needed. Computed fresh on each dashboard render (trades array is small, computation is O(n×5)).

---

### Gap 6: Signal history — votes serialization size

**Design document says:** store `agent_votes` and `agent_scores` in SignalHistoryEntry

**Risk found:** `AppState.lastVotes` is a full `Vote[]` array. Each Vote object has: `agent, score, vote, confidence, weight, reason_1, reason_2, data_source_quality, data_age_hours`. For 200 history entries × 5 agents × ~200 bytes per vote = ~200KB for votes alone. Combined with other signal fields, 200 entries could approach 400–500KB localStorage usage.

**Resolution:** Store only the essential fields in the history entry: `{ technical: { score, vote }, macro: { score, vote }, positioning: { score, vote }, news: { score, vote }, risk: { score, vote } }`. This reduces per-entry size from ~1KB to ~200 bytes for the votes section.

---

### Gap 7: i18n keys — three new pages need translation strings

**Design document does not enumerate** the specific i18n keys needed for the three new pages.

**Required additions to i18n.js:**

```
ZH / EN pairs needed:
nav.trade         / 'Trade Setup'    / '交易设置'
nav.history       / 'Trade History'  / '交易记录'
nav.performance   / 'Performance'    / '绩效'
trade.setup       / 'Current Trade Setup' / '当前交易设置'
trade.gates       / 'Gate Results'   / '门控结果'
trade.noTrade     / 'No Actionable Signal' / '暂无可执行信号'
history.title     / 'Trade History'  / '交易历史'
history.empty     / 'No trades yet'  / '暂无交易记录'
perf.title        / 'Performance'    / '绩效分析'
perf.winRate      / 'Win Rate'       / '胜率'
perf.profitFactor / 'Profit Factor'  / '盈利因子'
perf.totalPnl     / 'Total PnL'      / '总盈亏'
perf.byRegime     / 'By Regime'      / '按市场状态'
perf.agentAccuracy / 'Agent Accuracy' / '代理准确率'
```

---

## Task 4 — Complete Development Sequence

### Phase 1: AppState Signal History

**What:** Add `signalHistory[]` ring buffer to `AppState._state`. Add `_historyUnshift()`, `_persistHistory()`, `_loadHistory()`. Export `getSignalHistory(n = 50)`. Update `setSignalResult()`.

**Why first:** Every subsequent component depends on `getSignalHistory()`. Getting this right first means all downstream components can rely on a stable API.

**Verification after Phase 1:**
```javascript
// In browser console after signal generation:
window.__oneto.AppState.getSignalHistory(5)
// Must return: array of 1–5 SignalHistoryEntry objects
// Each must have: id, timestamp, signal_strength, final_score,
//                 entry_price, agent_votes, market_regime

localStorage.getItem('oneto_signal_history_v5')
// Must return: non-null JSON string
// Must survive page reload: reload page, call getSignalHistory() again
```

---

### Phase 2: Enhanced PaperExecution Trade Record

**What:** Add `market_regime`, `signal_strength`, `final_score`, `final_confidence`, `agent_votes`, `agent_scores` to `_submit()` input and `trade` object. Add migration in `_loadTrades()` for old records. Update `PaperTradePanel._handleSubmit()` to pass new fields.

**Why second:** TradeHistory and PerformanceDashboard both depend on the enhanced trade record. If they are built before this phase, they would need to be patched afterward.

**Verification after Phase 2:**
```javascript
// Submit a paper trade via the Paper Trading page UI
// Then in console:
window.__oneto.AppState // Not directly applicable
// Open DevTools → Application → localStorage → paper_trades_v4
// Inspect the newest entry, confirm it contains:
// market_regime: "ranging" (or current regime, not "unknown")
// agent_votes: { technical: "SELL", macro: "SELL", ... }
// agent_scores: { technical: 68, macro: 72, ... }
```

---

### Phase 3: TradeSetupPanel

**What:** New `src/components/TradeSetupPanel.js`. Reads `AppState.getLastSignal()`. Subscribes to `signalGenerated`. Renders complete trade specification for actionable signals; renders NO_TRADE reason with data gap explanation for NO_TRADE signals.

**Why third:** The most user-visible deliverable. Can be built and tested independently of history/performance pages. Relies on Phase 1 for signal history nav (optional at this phase) and existing `AppState.getLastSignal()`.

**Changes to `index.html`:** Add nav item (🎯 Trade Setup), add `<section id="page-trade">`, add import + mount call.

**Verification after Phase 3:**
- Navigate to "Trade Setup" in sidebar → page loads without error
- Generate a signal: if actionable → Entry, SL, TP1, TP2, RR, Lot Size, Risk% all display
- If NO_TRADE → reason displays, gate failures highlighted
- Language toggle → all labels switch ZH/EN
- Generate signal while on Trade Setup page → auto-updates without page reload

---

### Phase 4: TradeHistoryPanel

**What:** New `src/components/TradeHistoryPanel.js`. Reads `PaperExecution.getAll()`. Listens to `window.addEventListener('paperTradeOpened')` and `window.addEventListener('paperTradeClosed')`. Renders all trades with sortable columns.

**Why fourth:** Depends on Phase 2 (enhanced trade records). A natural progression after TradeSetupPanel.

**Changes to `index.html`:** Add nav item (📋 Trade History), add `<section id="page-history">`, add import + mount call.

**Verification after Phase 4:**
- Navigate to "Trade History" → shows all existing paper trades from localStorage
- Open a new paper trade via Paper Trading page → Trade History auto-updates
- Close a trade → Trade History updates, shows closed status + PnL
- Trades opened before Phase 2 (old schema) display with fallback values, no crash

---

### Phase 5: PerformanceDashboard

**What:** New `src/components/PerformanceDashboard.js`. Reads `PaperExecution.getStats()` + computes `AgentAccuracy` inline. Listens to `window.addEventListener('paperTradeClosed')` for updates.

**Why fifth (last):** Depends on Phases 2, 3, 4 for data quality. Performance statistics are only meaningful after trades with enhanced records (market_regime, agent_votes).

**Changes to `index.html`:** Add nav item (📈 Performance), add `<section id="page-performance">`, add import + mount call.

**Verification after Phase 5:**
- Navigate to "Performance" → shows Win Rate, Profit Factor, Total PnL
- If < 5 trades: shows "Insufficient data" for regime/agent breakdowns
- If ≥ 5 trades: shows per-regime win rates, per-agent accuracy
- Agent accuracy section: Technical / Macro / Positioning / News each with vote count + accuracy %
- Validation phase progress bar matches PaperTradePanel validation display
- Close a trade → Performance updates automatically

---

## Task 5 — Rollback Plan

### Git Rollback (complete revert to V4.6)

```bash
# View current commit
git log --oneline -5

# Hard reset to V4.6 freeze commit
git reset --hard 7f643b1

# Verify
git log --oneline -1
# Should show: 7f643b1 (original V4.6 commit message)
```

**Effect:** All V5.2 new files and all modifications are discarded. The working directory returns to exactly the V4.6 freeze state. No data loss from this operation.

### Selective File Rollback (revert specific files if partial failure)

If one phase fails and others are complete, individual files can be reverted:

```bash
# Revert a specific modified file to V4.6 state
git checkout 7f643b1 -- src/state/AppState.js
git checkout 7f643b1 -- src/core/PaperExecution.js
git checkout 7f643b1 -- src/components/PaperTradePanel.js
git checkout 7f643b1 -- index.html
git checkout 7f643b1 -- src/i18n/i18n.js

# New files (not in V4.6) can simply be deleted
rm src/components/TradeSetupPanel.js
rm src/components/TradeHistoryPanel.js
rm src/components/PerformanceDashboard.js
rm styles/trading.css  # if created
```

### Risk by Phase

| Phase | Rollback Risk | Impact if Rolled Back |
|-------|--------------|----------------------|
| Phase 1: AppState history | Low | Signal history lost. Existing functionality unaffected. |
| Phase 2: PaperExecution | Medium | Old trade records restored from localStorage. New trades lose regime/agent data. Must clear `paper_trades_v4` if schema conflict. |
| Phase 3: TradeSetupPanel | None | Delete the new file. No existing code references it. |
| Phase 4: TradeHistoryPanel | None | Delete the new file. No existing code references it. |
| Phase 5: PerformanceDashboard | None | Delete the new file. No existing code references it. |

### localStorage Migration Rollback

If Phase 2 (PaperExecution schema change) causes issues with existing trades:

```javascript
// In browser console — clears paper trade history
localStorage.removeItem('paper_trades_v4')
localStorage.removeItem('paper_results_v4')
// Warning: this permanently deletes all paper trade records
```

**Before starting Phase 2 development:** export current paper trades as backup:
```javascript
// Browser console
console.log(JSON.stringify(JSON.parse(localStorage.getItem('paper_trades_v4')), null, 2))
// Copy output to a text file as backup before any schema changes
```

---

## Task 6 — Compatibility Risk Matrix

| Component | Risk | Reason |
|-----------|------|--------|
| **SignalEngine** | 🟢 Low | Not modified. New panels are read-only consumers. |
| **CommitteeOrchestrator** | 🟢 Low | Not modified. Agent votes are read from `AppState.getLastVotes()`. |
| **RiskManager** | 🟢 Low | Not modified. `lot_size` and related fields are already in Signal object. |
| **PaperExecution (existing trades)** | 🟡 Medium | Schema change. Old trades missing new fields. Migration function required. |
| **KLine Panel + DOM move** | 🟢 Low | `showPage()` change is additive (new cases added). K-Line DOM move logic unchanged. |
| **FRED service** | 🟢 Low | Not modified. `data_sources.fred` read from memoryLayer in signal context. |
| **Finnhub service** | 🟢 Low | Not modified. |
| **AppState event bus** | 🟡 Medium | Adding history to `setSignalResult()`. Risk: if the history push or persist throws, `_dispatch('signalGenerated')` could be skipped. Must place history logic AFTER dispatch, not before. |
| **HeroPanel trade plan** | 🟢 Low | Not modified. Both HeroPanel and TradeSetupPanel read the same signal; no conflict. |
| **PaperTradePanel** | 🟢 Low | Only `_handleSubmit()` modified to pass 3 additional fields. Form logic unchanged. |
| **DecisionPanel BUG-07 fix** | 🟢 Low | Not modified. NO_TRADE display logic remains in DecisionPanel. TradeSetupPanel has its own NO_TRADE display. |
| **SettingsPanel circuit breakers** | 🟢 Low | Not modified. |
| **i18n system** | 🟢 Low | Additive only. Missing keys return key string, no crash. |
| **localStorage total size** | 🟡 Medium | Adding signal history (max ~400KB) + enhanced trade records. Browser localStorage limit is typically 5–10MB. Risk only at very high usage (>1000 signals). Ring buffer cap of 200 entries prevents unbounded growth. |

---

## Task 7 — Acceptance Criteria

### Phase 1: Signal History Acceptance

- [ ] `AppState.getSignalHistory(10)` returns the last 10 signals in reverse chronological order
- [ ] History survives page reload (`localStorage('oneto_signal_history_v5')` persists)
- [ ] History is capped at 200 entries (201st signal pushes out the oldest)
- [ ] Each history entry contains: `id, timestamp, signal_strength, direction, final_score, final_confidence, entry_price, stop_loss, take_profit_2, lot_size, market_regime, mtf_state, no_trade_reason, gates{}, agent_votes{}, agent_scores{}`
- [ ] `setSignalResult()` still dispatches `signalGenerated` event correctly (all existing panels continue to update)
- [ ] No console errors after 10 consecutive signal generations

### Phase 2: Enhanced Trade Record Acceptance

- [ ] After submitting a trade: `PaperExecution.getAll()[0].market_regime` returns a non-`'unknown'` value (e.g., `'ranging'`)
- [ ] `PaperExecution.getAll()[0].agent_votes` contains `{ technical: 'SELL'|'BUY'|'NEUTRAL', ... }` for all 5 agents
- [ ] Old trades loaded from localStorage display correctly with fallback values — no `undefined` errors in Trade History
- [ ] Trade close still calculates PnL correctly (existing `_close()` logic unchanged)
- [ ] `PaperExecution.getStats()` still returns correct win_rate, profit_factor, total_pnl_r

### Phase 3: Trade Setup Page Acceptance

- [ ] Trade Setup page accessible via sidebar navigation
- [ ] On actionable signal: Entry Price, Stop Loss, Take Profit 1, Take Profit 2 display with correct prices
- [ ] RR Ratio displays as `1:2.60`
- [ ] Lot Size displays (e.g., `0.05 lots`)
- [ ] Risk % displays (e.g., `2.50%`)
- [ ] Max Loss USD displays (e.g., `$25.00`)
- [ ] All 6 gates display with ✅ / ❌ status
- [ ] On NO_TRADE signal: NO_TRADE reason displays in both ZH and EN
- [ ] Language toggle switches all labels correctly
- [ ] Page auto-updates when new signal is generated (without navigation)
- [ ] "Open Paper Trade" button navigates to Paper Trading page with form pre-filled

### Phase 4: Trade History Page Acceptance

- [ ] Trade History page accessible via sidebar navigation
- [ ] All existing paper trades display (including trades from before V5.2)
- [ ] Each row shows: Direction, Entry, Exit (or "Open"), PnL (pips and R), Regime, Outcome
- [ ] Click to expand shows: Signal strength, agent votes, duration
- [ ] Open trade shows "—" for Exit/PnL columns
- [ ] After closing a trade on Paper Trading page: Trade History updates automatically
- [ ] Empty state: "No trades yet / 暂无交易记录" displays correctly
- [ ] No `undefined` or NaN in any displayed value

### Phase 5: Performance Dashboard Acceptance

- [ ] Performance page accessible via sidebar navigation
- [ ] Win Rate displayed as percentage (e.g., `62.5%`)
- [ ] Profit Factor displayed (e.g., `1.87`)
- [ ] Total PnL in R and USD displayed
- [ ] With fewer than 5 closed trades: per-regime and per-agent breakdowns show "Insufficient data"
- [ ] With 5+ closed trades: per-regime breakdown shows win rate per regime
- [ ] Agent Accuracy section shows Technical, Macro, Positioning, News accuracy % (Risk agent excluded from accuracy — it is a risk scorer, not a directional agent)
- [ ] Validation phase progress bar matches Paper Trading page progress bar
- [ ] After closing a new trade: Performance Dashboard updates automatically
- [ ] No division-by-zero errors when trades array is empty

---

## Task 8 — Final Judgment

### Pre-Coding Review Result: ✅ PASS

**Justification:**

All five design components are architecturally sound and grounded in real existing code:
- Signal fields needed for TradeSetupPanel already exist in the `Signal` object — no computation changes required
- `AppState.setSignalResult()` has a clean, safe insertion point for history
- PaperExecution schema change is backward-compatible with a one-time migration function
- Three new panel components are read-only — they cannot corrupt any existing state
- `showPage()` already handles any `data-page` attribute — adding new pages requires zero routing logic changes
- No frozen components are modified

Gap analysis identified 7 issues. All 7 have concrete resolutions that do not require design changes — only implementation detail additions.

Compatibility risk matrix shows no high-risk items. Two medium-risk items (AppState history dispatch order, PaperExecution schema migration) have explicit mitigations documented.

---

### V5.2 Coding Order

```
Step 1 (Foundation):   src/state/AppState.js
Step 2 (Data layer):   src/core/PaperExecution.js
Step 3 (Data bridge):  src/components/PaperTradePanel.js
Step 4 (UI — trade):   src/components/TradeSetupPanel.js
Step 5 (UI — history): src/components/TradeHistoryPanel.js
Step 6 (UI — perf):    src/components/PerformanceDashboard.js
Step 7 (Wiring):       index.html
Step 8 (i18n):         src/i18n/i18n.js
Step 9 (Optional CSS): styles/trading.css
```

### Critical Constraint for Step 1

In `AppState.setSignalResult()`, the history push must come **AFTER** `_dispatch('signalGenerated', ...)`, not before. This ensures no exception in history persistence can ever block the event dispatch that all existing panels depend on.

```
// CORRECT order in setSignalResult():
1. Update _state.lastSignal, lastVotes, lastVerdict, lastRegime
2. _dispatch('signalGenerated', ...)    ← existing panels receive event FIRST
3. _dispatch('regimeChanged', ...)      ← if applicable
4. _historyUnshift(signal, votes)       ← history added LAST (safe to fail)
5. _persistHistory()                    ← localStorage write LAST (safe to fail)
```

### Critical Constraint for Step 2

`_loadTrades()` in PaperExecution must apply a field migration function to every loaded trade record. The new storage key for future saves should remain `paper_trades_v4` (same key) to avoid data loss from existing records.

```
// Migration pattern in _loadTrades():
const migrated = rawTrades.map(t => ({
  ...t,
  market_regime:    t.market_regime    ?? 'unknown',
  signal_strength:  t.signal_strength  ?? 'UNKNOWN',
  final_score:      t.final_score      ?? 50,
  final_confidence: t.final_confidence ?? 0,
  agent_votes:      t.agent_votes      ?? {},
  agent_scores:     t.agent_scores     ?? {},
  data_sources:     t.data_sources     ?? {},
}));
```

---

*Document version: V5.2-IMPL-PLAN-001 | Created: 2026-06-05 | Status: APPROVED FOR DEVELOPMENT*
