# ONETO EUR/USD AI Tool — API Requirements Report

**Version:** V4.0 | Approved  
**Last Updated:** 2026-06  

---

## Table of Contents

1. [Required APIs](#1-required-apis)
2. [Optional APIs](#2-optional-apis)
3. [LLM APIs](#3-llm-apis)
4. [Phase Stacking Strategy](#4-phase-stacking-strategy)
5. [Fallback Architecture](#5-fallback-architecture)
6. [Rate Limit Management](#6-rate-limit-management)
7. [API Key Storage](#7-api-key-storage)

---

## 1. Required APIs

---

### 1.1 Twelve Data

| Field | Detail |
|-------|--------|
| **Purpose** | Real-time EUR/USD price + OHLCV K-line data for Technical Agent and K-line chart |
| **Endpoints Used** | `/price` (current price), `/time_series` (OHLCV candles) |
| **Free Tier** | 800 requests/day · 8 requests/minute |
| **Paid Tiers** | Grow $29/mo (5,000/day) · Pro $79/mo (60,000/day) |
| **Monthly Cost** | $0 free / $29 Grow |
| **Implementation Phase** | Phase 1 (price) + Phase 4 (K-line confirmed) |
| **Implementation Difficulty** | ⭐ Easy — REST JSON, CORS-friendly browser requests |
| **Expected Signal Value** | ⭐⭐⭐⭐⭐ Very High — without this, K-line and Technical Agent use simulation only |
| **Fallback** | `SimDataService.js` (random walk candle generator) |
| **Rate Limit Strategy** | Cache candle responses for 4 minutes; price for 30 seconds |
| **Rate Limit Storage** | `api_health` table: `rate_limit_used` incremented per call |
| **Registration URL** | https://twelvedata.com |
| **Key Storage** | `localStorage('td_api_key_eurusd')` Phase 1–4; Supabase `account_profiles` Phase 5+ |
| **Notes** | Free tier sufficient for Phase 1–4 testing at 6 decision cycles/day. Upgrade to Grow ($29) when live trading begins or cycle frequency increases. |

**Payload example:**
```json
GET /price?symbol=EUR/USD&apikey=YOUR_KEY
{ "price": "1.16252" }

GET /time_series?symbol=EUR/USD&interval=4h&outputsize=100&apikey=YOUR_KEY
{
  "values": [
    { "datetime": "2026-06-03 16:00:00", "open": "1.16200", "high": "1.16400",
      "low": "1.16100", "close": "1.16252" }
  ]
}
```

---

### 1.2 FRED (Federal Reserve Economic Data)

| Field | Detail |
|-------|--------|
| **Purpose** | GDP, CPI, PCE, unemployment, Fed Funds Rate — primary data source for Macro Agent |
| **Key Series** | FEDFUNDS (Fed rate), CPIAUCSL (CPI), GDP, UNRATE (unemployment), T10Y2Y (yield spread), DGS10 (10Y yield) |
| **Free Tier** | Unlimited — fully public API, no quota |
| **Monthly Cost** | $0 forever |
| **Implementation Phase** | Phase 6 |
| **Implementation Difficulty** | ⭐ Easy — well-documented REST JSON API |
| **Expected Signal Value** | ⭐⭐⭐⭐ High — enables real macro scoring instead of hardcoded stance values |
| **Fallback** | `central_bank_memory` manual entries (analyst fills in Fed stance manually) |
| **Rate Limit** | 120 requests/minute (very generous) |
| **Cache Strategy** | Cache all FRED series for 24 hours minimum (data updates monthly/weekly) |
| **Registration URL** | https://fred.stlouisfed.org/docs/api/fred/ |
| **Key Storage** | Supabase `account_profiles` or environment variable |
| **Notes** | Free API key required but instant. Most valuable zero-cost data source in the stack. FRED data has 1-day to 1-month lag depending on series — use for trend context, not real-time. |

**Key series to implement:**
```
FEDFUNDS     → Fed Funds Rate (monthly)
T10Y2Y       → 10Y-2Y yield spread (daily) — recession indicator
DGS10        → 10-Year Treasury yield (daily)
DGS2         → 2-Year Treasury yield (daily)
CPIAUCSL     → CPI All Urban (monthly)
PCE          → Personal Consumption Expenditures (monthly)
UNRATE       → Unemployment Rate (monthly)
GDPC1        → Real GDP (quarterly)
```

---

### 1.3 NewsAPI

| Field | Detail |
|-------|--------|
| **Purpose** | Real-time financial headlines for News Agent sentiment processing |
| **Endpoints Used** | `/v2/everything` with queries: "EUR USD Fed ECB" |
| **Free Tier** | 100 requests/day (developer) — **24-hour delay on free tier** |
| **Paid Tiers** | Business $449/mo (real-time, 250K req/mo) |
| **Monthly Cost** | $0 developer / $449 Business |
| **Implementation Phase** | Phase 6 |
| **Implementation Difficulty** | ⭐ Easy — simple REST JSON |
| **Expected Signal Value** | ⭐⭐⭐ High — without this, News Agent uses manually entered events |
| **Fallback** | `news_memory` last cached snapshot |
| **Rate Limit Strategy** | Batch fetch every 4H (6 calls/day on free tier — within limit) |
| **Alternative** | Finnhub (see Optional APIs — better for FX, $0 free tier) |
| **Registration URL** | https://newsapi.org |
| **Notes** | **Critical limitation:** Free tier has 24-hour data delay — insufficient for live signals. Consider Finnhub as primary at $0 cost. NewsAPI Business is expensive for a startup. Recommendation: Use Finnhub free tier for Phase 6, upgrade NewsAPI only if budget allows. |

---

### 1.4 Economic Calendar Source (ForexFactory RSS)

| Field | Detail |
|-------|--------|
| **Purpose** | Upcoming economic events for event risk scoring in Risk Analyst |
| **Endpoint** | RSS: `https://www.forexfactory.com/calendar` (unofficial) |
| **Free Tier** | Free RSS feed — no auth required |
| **Monthly Cost** | $0 |
| **Implementation Phase** | Phase 6 |
| **Implementation Difficulty** | ⭐⭐ Medium — XML/RSS parsing; unofficial API may change |
| **Expected Signal Value** | ⭐⭐⭐ Medium — enables event proximity risk scoring before NFP, FOMC, etc. |
| **Fallback** | Manual calendar entry in Settings UI |
| **Alternative** | FMP Calendar endpoint ($0 on free tier), Investing.com calendar |
| **Registration URL** | No registration needed |
| **Notes** | ForexFactory RSS is unofficial and may break without notice. FMP ($15/mo) provides a stable, documented calendar API. Recommendation: Start with ForexFactory RSS; switch to FMP if stability becomes an issue. |

---

### 1.5 CFTC COT Data Source

| Field | Detail |
|-------|--------|
| **Purpose** | Weekly Commitments of Traders positioning data for Positioning Agent |
| **Source** | CFTC public data at cftc.gov — CSV download |
| **URL** | https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm |
| **Free Tier** | Public government dataset — free forever |
| **Monthly Cost** | $0 |
| **Implementation Phase** | Phase 6 |
| **Implementation Difficulty** | ⭐⭐ Medium — CSV parsing, weekly schedule management, data normalization |
| **Expected Signal Value** | ⭐⭐⭐ Medium-High — institutional positioning adds counter-trend signals at extremes |
| **Fallback** | Last cached `cot_history` row (positioning changes slowly; 1-week lag acceptable) |
| **Data Lag** | Tuesday data published following Friday at 3:30 PM EST — 3-day lag |
| **Alternative** | COTbase.com provides cleaner API-style access to CFTC data |
| **Notes** | Use as directional trend context and contrarian extreme signal — not as real-time signal. z_score > 2.0 (extreme long) = contrarian bearish warning. z_score < -2.0 (extreme short) = contrarian bullish warning. |

---

## 2. Optional APIs

---

### 2.1 FMP (Financial Modeling Prep)

| Field | Detail |
|-------|--------|
| **Purpose** | Macro indicators backup + economic calendar + broader financial data |
| **Free Tier** | 250 requests/day |
| **Paid Tiers** | Starter $15/mo · Growth $79/mo |
| **Monthly Cost** | $0 / $15 Starter |
| **Implementation Phase** | Phase 6 (backup to FRED and ForexFactory) |
| **Implementation Difficulty** | ⭐ Easy |
| **Expected Signal Value** | ⭐⭐ Medium — best value as FRED + ForexFactory backup in one API |
| **Use Case** | If FRED is down: FMP provides same macro series. If ForexFactory breaks: FMP provides stable calendar. |
| **Notes** | Best $15/month value in the optional stack. Covers two failure modes with one subscription. |

---

### 2.2 Finnhub

| Field | Detail |
|-------|--------|
| **Purpose** | Institutional-quality financial news + pre-scored sentiment |
| **Free Tier** | 60 requests/minute — unlimited daily |
| **Paid Tiers** | Premium $50/mo |
| **Monthly Cost** | $0 free / $50 Premium |
| **Implementation Phase** | Phase 6 (alternative to NewsAPI) |
| **Implementation Difficulty** | ⭐ Easy |
| **Expected Signal Value** | ⭐⭐⭐ Medium — better financial news quality than NewsAPI for FX markets |
| **Advantage vs NewsAPI** | No 24h delay · Better financial focus · Generous free tier · Pre-scored sentiment available |
| **Recommendation** | Use as **primary** news source at $0 cost before considering NewsAPI paid |
| **Notes** | Free tier provides real-time financial news without the delay problem that makes NewsAPI free tier unusable. |

---

### 2.3 Polygon.io

| Field | Detail |
|-------|--------|
| **Purpose** | Historical OHLCV backup + tick-level data for deep historical backtesting |
| **Free Tier** | Unlimited delayed data (15+ min delay) |
| **Paid Tiers** | Starter $29/mo (real-time) |
| **Monthly Cost** | $0 delayed / $29 real-time |
| **Implementation Phase** | Phase 7 (Backtest upgrade) |
| **Implementation Difficulty** | ⭐ Easy |
| **Expected Signal Value** | ⭐⭐ Low-Medium — useful for 5-year deep historical backtesting only |
| **Use Case** | Primary: Twelve Data. Polygon: if Twelve Data down AND cached data insufficient. Historical 5+ year data for regime analysis. |
| **Notes** | Low priority. Only valuable if deep historical data needed beyond Twelve Data's history. |

---

### 2.4 Alpha Vantage

| Field | Detail |
|-------|--------|
| **Purpose** | Pre-computed technical indicators + forex data backup |
| **Free Tier** | 500 requests/day · 5 requests/minute |
| **Paid Tiers** | Premium $50/mo |
| **Monthly Cost** | $0 / $50 |
| **Implementation Phase** | Phase 7 (redundancy only) |
| **Implementation Difficulty** | ⭐ Easy |
| **Expected Signal Value** | ⭐ Low — redundant if computing indicators locally from Twelve Data candles |
| **Use Case** | Only valuable if: (a) Twelve Data down, (b) Polygon unavailable, (c) local computation fails |
| **Notes** | Lowest priority optional API. Local `indicators.js` computes everything Alpha Vantage provides. Useful only as emergency data source. |

---

## 3. LLM APIs

---

### 3.1 Claude API (Anthropic)

| Field | Detail |
|-------|--------|
| **Purpose** | Per-article news sentiment scoring · AI Macro Report generation (EN + ZH) · Signal explanation text |
| **Model** | claude-sonnet-4-6 |
| **Free Tier** | Limited free tier |
| **Cost** | ~$0.003 per 1K tokens (input + output) |
| **Monthly Cost** | ~$5–20/mo at 6 cycles/day (report generation) |
| **Implementation Phase** | Phase 6+ |
| **Implementation Difficulty** | ⭐ Easy — API already used in Claude artifacts |
| **Expected Signal Value** | ⭐⭐⭐⭐⭐ Very High — enables human-quality macro reports in both ZH and EN |
| **Use Case** | News article → Claude API → impact_score + direction_code + headline_zh |
| **Notes** | Transforms template-based reports into natural language analysis. Provides ZH translation quality that simple template systems cannot match. Recommended as first paid API to add. |

**Sample prompt pattern:**
```
System: You are a professional FX analyst. Analyze news headlines for EUR/USD impact.
  Return JSON only: {"impact_score": 1-10, "direction": "USD_POS|USD_NEG|EUR_POS|EUR_NEG|NEUTRAL",
  "confidence": 0-100, "headline_zh": "Chinese translation", "reason": "brief explanation"}

User: Headline: "Fed officials signal delay in rate cuts until late 2026"
```

---

### 3.2 OpenAI GPT-4o

| Field | Detail |
|-------|--------|
| **Purpose** | Alternative to Claude for macro narrative generation + technical pattern description |
| **Free Tier** | $5 starting credit |
| **Cost** | ~$0.005 per 1K tokens |
| **Monthly Cost** | ~$5–25/mo |
| **Implementation Phase** | Phase 6+ |
| **Implementation Difficulty** | ⭐ Easy |
| **Expected Signal Value** | ⭐⭐⭐⭐ High — comparable to Claude for report generation |
| **Notes** | Use as fallback if Claude API unavailable. Not both simultaneously to control costs. |

---

### 3.3 Gemini Pro (Google)

| Field | Detail |
|-------|--------|
| **Purpose** | ZH translation layer · Real-time data augmentation · Cost-effective alternative |
| **Free Tier** | 60 requests/minute — no daily limit on free tier |
| **Monthly Cost** | $0 on free tier |
| **Implementation Phase** | Phase 6 |
| **Implementation Difficulty** | ⭐ Easy |
| **Expected Signal Value** | ⭐⭐⭐ Medium-High — excellent for ZH translation at zero cost |
| **Use Case** | Translate EN macro summaries to ZH at $0. Use Claude for higher-quality analysis. |
| **Notes** | Best cost-performance for ZH translation. Recommended as the ZH layer while Claude handles EN analysis. |

---

## 4. Phase Stacking Strategy

### Phase 1 Stack (Zero Cost — Simulation)
```
✅ SimDataService.js    — Candle generator (always available)
✅ Twelve Data free     — Real price + K-line after API key entry
✅ localStorage         — API key + account profile storage

Accuracy vs full simulation: +20% (real technical data only)
Monthly cost: $0
```

### Phase 6 Target Stack (Minimal Cost)
```
✅ Twelve Data          — $0 (free tier) or $29/mo (Grow)
✅ FRED                 — $0 forever
✅ Finnhub              — $0 (free tier, real-time news)
✅ CFTC COT             — $0 (public data)
✅ ForexFactory RSS     — $0 (unofficial)
✅ Gemini Pro           — $0 (free tier, ZH translation)

Accuracy vs full simulation: +55%
Monthly cost: $0–29/mo
```

### Phase 6+ Full Stack (With LLM)
```
All of above plus:
✅ Claude API           — ~$10–20/mo
✅ FMP (optional)       — $15/mo (if ForexFactory unstable)

Accuracy vs simulation: +75%
Monthly cost: $25–64/mo
```

---

## 5. Fallback Architecture

Every API has a defined fallback. The system never crashes due to API failure.

```
Twelve Data FAILS:
  → Step 1: Return cached candles from AppState (up to 4 hours old)
  → Step 2: Activate Polygon.io fallback (if configured)
  → Step 3: Fall back to SimDataService.js
  → Signal labelled: "⚠️ STALE DATA — last update: [timestamp]"
  → Confidence reduced by 15%

FRED FAILS:
  → Use central_bank_memory manual entries
  → Macro Agent confidence reduced by 10%
  → Log to api_health: consecutive_failures++

NewsAPI FAILS:
  → Use news_memory last cached 24h snapshot
  → No new articles this cycle
  → News Agent confidence reduced by 10%

Finnhub FAILS:
  → Fall back to NewsAPI
  → If NewsAPI also fails: use news_memory cache

CFTC COT FAILS:
  → Use last cot_history row (positioning changes slowly — 1 week lag acceptable)
  → Positioning Agent confidence reduced by 10%

ForexFactory FAILS:
  → Use manual calendar entries from economic_events table
  → Risk Analyst event proximity scoring disabled for current cycle

ALL CRITICAL APIS DOWN:
  → Decision Engine outputs NO_TRADE
  → UI displays: "⚠️ 系统降级 — 实时数据不可用" / "⚠️ System degraded — real-time data unavailable"
  → All events logged to signal_audit_log (severity: error)
```

---

## 6. Rate Limit Management

### Strategy
```
1. Track usage in api_health.rate_limit_used (incremented per call)
2. Check rate_limit_pct_used before each call
3. At 80%: reduce polling frequency by 50%
4. At 95%: switch to fallback API
5. At 100%: queue requests for after rate_limit_reset_at
```

### Call Budget (Free Tier, 6 cycles/day)
```
API               Calls/cycle   Calls/day   Free limit    % used
─────────────────────────────────────────────────────────────────
Twelve Data       3             18          800/day       2.3%
  (price×1, 4H×1, 1D×1)

FRED              0.5           3           unlimited     0%
  (cached 24h, ~1 call/2 days)

Finnhub           2             12          unlimited     0%
  (news fetch ×2 per cycle)

CFTC COT          0.1           0.7         free public   n/a
  (1 fetch per week)

ForexFactory      0.25          1.5         free RSS      n/a
  (calendar refresh 4×/day)
─────────────────────────────────────────────────────────────────
Total paid API calls/day: ~18  (well within all free limits)
```

---

## 7. API Key Storage

| Phase | Storage Method | Security |
|-------|---------------|----------|
| Phase 1–4 | `localStorage('td_api_key_eurusd')` | Client-side only, user's browser |
| Phase 5+ | Supabase `account_profiles` (encrypted at rest) | Row-level security per user |
| Production | Environment variable + Supabase secrets | Server-side, never in client bundle |

### Key naming convention
```
Twelve Data:   localStorage key = 'td_api_key_eurusd'
FRED:          localStorage key = 'fred_api_key'
NewsAPI:       localStorage key = 'newsapi_key'
Finnhub:       localStorage key = 'finnhub_key'
Claude API:    localStorage key = 'claude_api_key'
Gemini:        localStorage key = 'gemini_api_key'
Supabase URL:  localStorage key = 'supabase_url'
Supabase Key:  localStorage key = 'supabase_anon_key'
```

All keys entered via Settings UI → stored locally → never transmitted except to their own API endpoint.

---

*Report Version: V4.0 | Last Updated: 2026-06*  
*Review this document before Phase 6 to confirm pricing and free tier limits (they change frequently).*
