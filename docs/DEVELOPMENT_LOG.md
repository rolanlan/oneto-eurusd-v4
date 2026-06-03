# ONETO EUR/USD AI Tool — Development Log

**Append-only. Never delete or modify existing entries.**  
**Add a new entry at the bottom after every development phase.**  
**Format: ENTRY NNN | Version | Date | Author | Status**

---

## ENTRY 001

**Version:** v3.0  
**Date:** 2026-05  
**Author:** Rolan / ONETO  
**Status:** ✅ Complete  

### Summary
Built the initial EUR/USD AI signal tool as a single-file HTML application. First working prototype with signal display, scoring panels, and Chinese interface.

### Completed Tasks
- Built initial EUR/USD AI signal display tool
- Signal dashboard with directional arrow (buy/sell)
- Basic fundamental scoring panel (5 factors with progress bars)
- Basic technical scoring panel (5 factors with progress bars)
- Confidence ring (SVG animated)
- Trade plan display (entry, SL, TP, RR)
- News sentiment list (static mock data)
- Economic calendar (static mock data)
- Backtest results display (static mock data)
- Chinese interface (Noto Sans SC font, IBM Plex Mono for numbers)
- Three rotating simulation scenarios to demonstrate signal changes

### Created Files
```
index.html   (v3.0 — approximately 600 lines)
```

### Modified Files
None (initial version)

### Known Issues at Close
- All data simulated — no real API connection
- No K-line chart
- No risk management calculator
- No paper trading
- No ZH/EN toggle
- Data changes on refresh (random rotation)

---

## ENTRY 002

**Version:** v3.1  
**Date:** 2026-05  
**Author:** Rolan / ONETO  
**Status:** ✅ Complete  

### Summary
Attempted OANDA API integration. OANDA account registration blocked (multiple accounts could not log in). Pivoted to Twelve Data. Price display connected. K-line data fetched but chart rendering failed.

### Completed Tasks
- Diagnosed OANDA login failures — concluded OANDA not viable from current region
- Researched alternative brokers: FOREX.com, IG Markets, Capital.com, Exness, IC Markets
- Selected Twelve Data as data source (CORS-friendly, free tier, no broker account required)
- Implemented Twelve Data API key input in Settings page
- Connected price display to Twelve Data `/price` endpoint
- Fetched previous close for change percentage calculation
- Implemented `/time_series` fetch for K-line OHLCV data
- Added localStorage API key persistence
- Added connection status display in sidebar

### Created Files
```
index.html   (v3.1 — approximately 700 lines, replaces v3.0)
```

### Modified Files
```
index.html   (full replacement)
```

### Known Issues at Close
- **CRITICAL:** K-line chart area completely blank despite API connected and data returned
- Console error: `'candlestick' is not a registered controller`
- Console error: `Canvas is already in use. Chart with ID '0' must be destroyed`
- Root cause: Chart.js `type:'candlestick'` requires chartjs-chart-financial plugin (not loaded)
- Root cause: `new Chart()` called on every refresh without `destroy()` first
- Root cause: `fetchKlineData()` async but not awaited before `drawKLine()` — renders with empty data

---

## ENTRY 003

**Version:** v3.2  
**Date:** 2026-05  
**Author:** Rolan / ONETO  
**Status:** ✅ Complete  

### Summary
Fully resolved the K-line blank chart bug. Root cause was Chart.js candlestick plugin dependency. Solution: replaced Chart.js for main K-line with TradingView Lightweight Charts v4 (native candlestick support, no plugins). Implemented `createMainChart()` / `updateMainChart()` pattern to prevent canvas reuse errors.

### Completed Tasks
- Diagnosed all three K-line bugs: plugin missing, canvas reuse, async race condition
- **Solution architecture decision:** Replace Chart.js candlestick with TradingView Lightweight Charts v4
- Implemented `createMainChart()` — initializes once, never called again
- Implemented `updateMainChart()` — only calls `setData()`, never `new Chart()`
- Fixed async flow: `fetchLivePrice()` → `await fetchKlineData()` → `updateMainChart()`
- Added timestamp deduplication array to prevent TVLC duplicate time errors
- MACD and RSI sub-charts remain on Chart.js (bar/line types — no candlestick dependency)
- Fixed sub-chart canvas reuse: `destroy()` called before each rebuild
- Implemented timeframe switching (1H / 4H / 1D) with fresh data fetch
- Added real MA20, MA50, Bollinger Band overlays
- Added signal markers (arrowUp / arrowDown) via `tvCandleSeries.setMarkers()`
- Added SL/TP price lines via `createPriceLine()` / `removePriceLine()`
- Added crosshair subscription for OHLC display on hover
- Confirmed: K-line renders correctly with real Twelve Data API key

### Created Files
```
index.html   (v3.2 — 883 lines, replaces v3.1)
```

### Modified Files
```
index.html   (full replacement)
```

### Known Issues at Close
- All data modules (macro, news, positioning, risk) still rules-based with simulated inputs
- No Risk Manager — user does not know lot size or maximum loss
- No AI Committee — scoring is hardcoded per scenario
- No Decision Engine — 8-state output not implemented
- No ZH/EN toggle — interface is Chinese only (hardcoded)
- No paper trading
- No persistent storage — all state lost on page refresh

---

## ENTRY 004

**Version:** v4.0 Architecture Design  
**Date:** 2026-06  
**Author:** Rolan / ONETO  
**Status:** ✅ Architecture Approved  

### Summary
Designed the complete institutional-grade V4.0 architecture through an iterative approval process with Rolan/ONETO. Multiple rounds of design, conditional approval, and revision.

### Architecture Design Process
1. Initial V4.0 upgrade protocol received: 11 modules, 8 priority phases
2. Architecture designed: system diagram, 13 database tables, 4 AI Committee agents
3. Conditional approval received with 8 revision items:
   - Add committee_votes table
   - Add central_bank_memory table
   - Add news_memory table
   - Add market_regime table
   - Add Positioning Agent (Agent 5)
   - Add AI Macro Report
   - Risk Manager database integration
   - COT history storage
4. Revised architecture submitted: Database Schema v2, AI Committee Design v2
5. Architecture Freeze document submitted (12 sections)
6. Conditional approval received with 5 additional items:
   - account_profiles table
   - api_health table
   - signal_audit_log table
   - committee_weights table
   - Multi-Timeframe Alignment Engine
7. Architecture Freeze Revision 1 submitted and **fully approved**

### Final Architecture Summary
- **12 approved modules**
- **17 database tables**
- **5 AI Committee agents** (Technical, Macro, Positioning, News, Risk)
- **8-state decision output** (STRONG_BUY through STRONG_SELL + NO_TRADE)
- **MTF Engine** (3-timeframe alignment pre-gate)
- **ZH/EN internationalization** (English source, Chinese display layer)
- **7 implementation phases** beyond documentation

### Created Files
None (architecture documents only — Phase 0 documentation pending)

### Modified Files
None

### Known Issues
None — architecture approved, no code written yet

---

## ENTRY 005

**Version:** v4.0 Phase 0 — Documentation Foundation  
**Date:** 2026-06  
**Author:** Rolan / ONETO  
**Status:** ✅ Complete  

### Summary
Document-first development protocol established. All 7 governance documents created and approved before any code is written. Documents designed for cross-AI-system recoverability (Claude, ChatGPT, Gemini).

### Completed Tasks
- Document-first protocol approved by Rolan/ONETO
- Phase 1 implementation plan reviewed and approved
- All 7 governance markdown documents generated
- Documents saved to GitHub `/docs` folder

### Created Files
```
docs/V4_ARCHITECTURE_FREEZE.md      (~300 lines)
docs/V4_MASTER_MANIFEST.md          (~280 lines)
docs/DATABASE_SCHEMA.md             (~500 lines)
docs/API_REPORT.md                  (~250 lines)
docs/DEVELOPMENT_LOG.md             (~200 lines — this file)
docs/INTERFACE_CONTRACTS.md         (~350 lines)
docs/PHASE_IMPLEMENTATION_PLAN.md   (~400 lines)
```

### Modified Files
None

### Pending Tasks
- Await final approval of documentation package
- Begin Phase 1 implementation after approval granted

### Known Issues
- K-001: v3.2 is the current working file; will be superseded by V4.0 Phase 4 output

---

*All future entries appended below this line.*  
*Format: ENTRY NNN | Version | Date | Author | Status*

---

## ENTRY 006

**Version:** v4.0 Phase 1  
**Date:** [TBD]  
**Author:** [TBD]  
**Status:** ⏳ Pending  

### Summary
[To be filled in after Phase 1 completion]

### Completed Tasks
[To be filled in]

### Created Files
```
src/i18n/en.json
src/i18n/zh.json
src/i18n/i18n.js
src/utils/indicators.js
src/utils/formatters.js
src/utils/validators.js
src/services/SimDataService.js
src/services/TwelveDataService.js
src/state/AccountState.js
src/state/AppState.js
```

### Modified Files
```
docs/V4_MASTER_MANIFEST.md   (status update)
docs/DEVELOPMENT_LOG.md      (this file — add entry)
```

### Completion Criteria
- [ ] `t('signal.sell')` returns "SELL" in EN, "做空" in ZH
- [ ] `indicators.calcRSI([...])` returns correct value
- [ ] `TwelveDataService.getPrice('EUR/USD')` returns price OR falls back gracefully
- [ ] `AccountState.getDefault()` returns valid profile object
- [ ] `AppState.getCandles()` returns 80 candles in correct format

### Known Issues
[To be filled in after completion]
