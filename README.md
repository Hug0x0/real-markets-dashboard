<div align="center">

# REAL Markets Dashboard

**Every REAL perpetual market at a glance.**

An overview, a ranked screener and per-market trade-flow analytics, computed in the browser from the public REAL indexer.

[![CI](https://github.com/Hug0x0/real-markets-dashboard/actions/workflows/ci.yml/badge.svg)](https://github.com/Hug0x0/real-markets-dashboard/actions/workflows/ci.yml)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Built_with-Vite-646CFF?logo=vite&logoColor=white)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

</div>

---

## Views

| View | What it shows |
| --- | --- |
| **Overview** | 24h volume, open interest, market count and 24h trades · hourly volume share of the top 4 markets · market-flow histogram of 24h price changes with a fall/rise breadth bar · heatmap sized by 24h volume or open interest and coloured by 24h change. |
| **Screener** | Every market ranked by volume surge, 24h change, 24h volume, open interest, funding rate or 24h trade count, with search and sort direction. |
| **Analytics** | Per market: mark, index, 24h high/low, funding rate with countdown, volume and OI · active traders (1h / 24h) · long/short account ratio · taker trade flow and cumulative volume delta (1m–1h bars, 1h–24h range). |

Click a heatmap tile or screener row to open that market in Analytics. The view and market live in the URL (`?view=analytics&market=ETH`).

## How the data works

The indexer exposes snapshots (tickers) and raw fills (trades), but no candles. The dashboard therefore:

1. Fetches tickers and market metadata, and renders the page as soon as they arrive (~1s).
2. Fetches **a rolling 24h of trades** as hourly slices (`f[created_at_from_ms]` / `f[created_at_to_ms]`), 8 at a time, newest first. Charts fill in as history arrives; a progress strip shows how many hours are ready.
3. Derives everything historical from those fills: price change, high/low, hourly volume share, surge, trade flow, CVD and active accounts.
4. Keeps only the fields it uses (raw fills are ~740 bytes each) and caches the dataset in **IndexedDB**. A reload shows the cached data instantly and only fetches trades since the last visit.
5. Refreshes every 5 minutes the same way, fetching only the gap since its newest fill.

REAL prints roughly 80k fills a day and the indexer caps pages at 1,000, so a cold load is ~80 requests: about 7 seconds in parallel, versus ~25 seconds following a single cursor. A reload with a warm cache takes about 1 second. If the indexer is unreachable, generated demo data is shown under a **DEMO DATA** badge.

## Metric definitions

| Metric | Definition |
| --- | --- |
| 24h volume / open interest | Sum of ticker `turnover_24h` / `open_interest_value` (USD). |
| 24h change | Mark price ÷ price of the oldest fill in the 24h window − 1. |
| Volume surge | Last-hour traded notional ÷ average hourly notional over the window. `2.00×` = twice as busy as usual. |
| Volume share | Each market's share of traded notional (`price × volume`) per hour; markets beyond the top 4 fold into Other. |
| Trade flow / CVD | Notional per bar split by taker side; CVD is the running sum of buys − sells. |
| Active traders | Distinct buyer / seller account IDs in the window (accounts, not people). |
| Long / short ratio | From each account's latest funding payment with a non-zero position on that market. |

Calculations live in [`src/analytics.ts`](src/analytics.ts) and are covered by [`src/analytics.test.ts`](src/analytics.test.ts).

### Limits

- History is limited to 24h. A 7-day view (daily volume share, surge against a weekly average) would need a collector that stores aggregates server-side.
- Each hourly slice is capped at 60 pages (60k fills); if that is ever hit, a notice shows the shorter window actually covered.
- Fills with a side other than buy/sell are counted as sells in trade flow.

## Quick start

Use **Node.js 24** and npm.

```bash
git clone https://github.com/Hug0x0/real-markets-dashboard.git
cd real-markets-dashboard
npm ci
npm run dev
```

To point at another indexer (e.g. testnet), set `VITE_REAL_API_URL` in a `.env` file:

```bash
VITE_REAL_API_URL=https://indexer.api.testnet.real.xyz
```

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Vite dev server. |
| `npm test` | Run the Vitest suite. |
| `npm run build` | Type-check and build to `dist/` (static hosting). |
| `npm run preview` | Serve the production build locally. |

## Independence and license

Community-built and **not affiliated with Real Markets**. Read-only: no wallet, no orders, no keys. [MIT](LICENSE).
