import type { FundingPayment, Market, MarketTicker, Trade } from "./types";

export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;

/** Parses an indexer numeric string; anything non-finite becomes 0. */
export function num(value: string | number | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export const notional = (trade: Trade) => num(trade.price) * num(trade.volume);
export const isTakerBuy = (trade: Trade) => /buy|bid|long/i.test(trade.side);
export const baseSymbol = (symbol: string) => symbol.split(/[-/_]/)[0].toUpperCase();

export type MarketRow = {
  id: string;
  symbol: string;
  base: string;
  name: string;
  price: number;
  indexPrice: number;
  turnover24h: number;
  openInterest: number;
  fundingRate: number | null;
  fundingTimeMs: number | null;
  /** Fractional change versus the oldest covered price (0.021 = +2.1%); null without a reference trade. */
  change24h: number | null;
  tradeVolume24h: number;
  volume1h: number;
  avgHourlyVolume: number;
  /** Last-hour trade notional ÷ average hourly notional over the covered window; null without history. */
  surge: number | null;
  trades24h: number;
  high24h: number | null;
  low24h: number | null;
};

function groupByMarket(trades: Trade[]) {
  const groups = new Map<string, Trade[]>();
  for (const trade of trades) {
    const list = groups.get(trade.market_id);
    if (list) list.push(trade);
    else groups.set(trade.market_id, [trade]);
  }
  return groups;
}

/** Joins tickers with the trade window. `trades` must be sorted by time ascending. */
export function buildMarketRows(tickers: MarketTicker[], markets: Market[], trades: Trade[], now: number, coverageFromMs: number): MarketRow[] {
  const names = new Map(markets.map((market) => [market.id, market.underlying]));
  const groups = groupByMarket(trades);
  const dayStart = now - DAY_MS;
  const hourStart = now - HOUR_MS;
  const coveredHours = Math.max(1, (now - Math.max(coverageFromMs, dayStart)) / HOUR_MS);

  return tickers.map((ticker) => {
    const list = groups.get(ticker.market_id) ?? [];
    const price = num(ticker.mark_price);
    let reference: number | null = null;
    let hour = 0;
    let day = 0;
    let count = 0;
    let high: number | null = null;
    let low: number | null = null;
    for (const trade of list) {
      const value = notional(trade);
      const tradePrice = num(trade.price);
      if (trade.created_at_ms <= dayStart) {
        reference = tradePrice;
        continue;
      }
      if (reference === null) reference = tradePrice;
      day += value;
      if (trade.created_at_ms > hourStart) hour += value;
      count += 1;
      high = high === null ? tradePrice : Math.max(high, tradePrice);
      low = low === null ? tradePrice : Math.min(low, tradePrice);
    }
    const avg = day / coveredHours;
    const base = baseSymbol(ticker.symbol);
    return {
      id: ticker.market_id,
      symbol: ticker.symbol,
      base,
      name: names.get(ticker.market_id) || base,
      price,
      indexPrice: num(ticker.index_price),
      turnover24h: num(ticker.turnover_24h),
      openInterest: num(ticker.open_interest_value),
      fundingRate: ticker.perp_next_funding_rate == null ? null : num(ticker.perp_next_funding_rate),
      fundingTimeMs: ticker.perp_next_funding_time_ms ?? null,
      change24h: reference && price ? price / reference - 1 : null,
      tradeVolume24h: day,
      volume1h: hour,
      avgHourlyVolume: avg,
      surge: avg > 0 ? hour / avg : null,
      trades24h: count,
      high24h: high,
      low24h: low,
    };
  });
}

export type Totals = { volume24h: number; openInterest: number; markets: number; trades24h: number; activeAccounts24h: number };

export function totals(rows: MarketRow[], trades: Trade[], now: number): Totals {
  const dayStart = now - DAY_MS;
  const accounts = new Set<string>();
  let trades24h = 0;
  for (const trade of trades) {
    if (trade.created_at_ms <= dayStart) continue;
    trades24h += 1;
    if (trade.buyer_account_id) accounts.add(trade.buyer_account_id);
    if (trade.seller_account_id) accounts.add(trade.seller_account_id);
  }
  return {
    volume24h: rows.reduce((sum, row) => sum + row.turnover24h, 0),
    openInterest: rows.reduce((sum, row) => sum + row.openInterest, 0),
    markets: rows.length,
    trades24h,
    activeAccounts24h: accounts.size,
  };
}

export type ShareSeries = { key: string; label: string; total: number };
export type ShareBucket = { start: number; total: number; shares: Record<string, number> };
export type VolumeShare = { series: ShareSeries[]; buckets: ShareBucket[] };

/** Notional share of the top `topN` markets (plus "other") per bucket across the window. */
export function volumeShare(trades: Trade[], labels: Map<string, string>, fromMs: number, toMs: number, bucketMs = HOUR_MS, topN = 4): VolumeShare {
  const byMarket = new Map<string, number>();
  for (const trade of trades) byMarket.set(trade.market_id, (byMarket.get(trade.market_id) ?? 0) + notional(trade));
  const ranked = [...byMarket.entries()].sort((a, b) => b[1] - a[1]);
  const top = ranked.slice(0, topN).map(([key, total]) => ({ key, label: labels.get(key) ?? key, total }));
  const otherTotal = ranked.slice(topN).reduce((sum, [, value]) => sum + value, 0);
  const series: ShareSeries[] = otherTotal > 0 ? [...top, { key: "other", label: "Other", total: otherTotal }] : top;
  const topKeys = new Set(top.map((item) => item.key));

  const count = Math.max(1, Math.ceil((toMs - fromMs) / bucketMs));
  const raw = Array.from({ length: count }, (_, index) => ({ start: fromMs + index * bucketMs, values: {} as Record<string, number>, total: 0 }));
  for (const trade of trades) {
    const index = Math.min(count - 1, Math.floor((trade.created_at_ms - fromMs) / bucketMs));
    if (index < 0) continue;
    const key = topKeys.has(trade.market_id) ? trade.market_id : "other";
    const value = notional(trade);
    raw[index].values[key] = (raw[index].values[key] ?? 0) + value;
    raw[index].total += value;
  }
  const buckets = raw.map(({ start, values, total }) => ({
    start,
    total,
    shares: Object.fromEntries(series.map(({ key }) => [key, total > 0 ? (values[key] ?? 0) / total : 0])),
  }));
  return { series, buckets };
}

export const FLOW_BUCKETS = ["< -10%", "-7–10%", "-5–7%", "-3–5%", "-0–3%", "0%", "+0–3%", "+3–5%", "+5–7%", "+7–10%", "> +10%"] as const;

/** Index into FLOW_BUCKETS for a fractional change. Moves under ±0.005% count as flat. */
export function flowBucket(change: number): number {
  const pct = change * 100;
  if (Math.abs(pct) < 0.005) return 5;
  const magnitude = Math.abs(pct);
  const step = magnitude <= 3 ? 0 : magnitude <= 5 ? 1 : magnitude <= 7 ? 2 : magnitude <= 10 ? 3 : 4;
  return pct < 0 ? 4 - step : 6 + step;
}

export function marketFlow(rows: MarketRow[]) {
  const counts = FLOW_BUCKETS.map(() => 0);
  let fall = 0;
  let rise = 0;
  for (const row of rows) {
    if (row.change24h === null) continue;
    const index = flowBucket(row.change24h);
    counts[index] += 1;
    if (index < 5) fall += 1;
    if (index > 5) rise += 1;
  }
  return { counts, fall, rise };
}

export type Rect = { x: number; y: number; w: number; h: number };

/** Squarified treemap (Bruls et al.) of positive values into a w×h box. Output order matches input order. */
export function squarify(values: number[], width: number, height: number): Rect[] {
  const total = values.reduce((sum, value) => sum + Math.max(0, value), 0);
  const result: Rect[] = values.map(() => ({ x: 0, y: 0, w: 0, h: 0 }));
  if (total <= 0 || width <= 0 || height <= 0) return result;
  const scale = (width * height) / total;
  const items = values.map((value, index) => ({ index, area: Math.max(0, value) * scale })).filter((item) => item.area > 0).sort((a, b) => b.area - a.area);

  let box = { x: 0, y: 0, w: width, h: height };
  let row: typeof items = [];
  const worst = (list: typeof items, side: number) => {
    const sum = list.reduce((acc, item) => acc + item.area, 0);
    const max = Math.max(...list.map((item) => item.area));
    const min = Math.min(...list.map((item) => item.area));
    return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
  };
  const layout = (list: typeof items) => {
    const sum = list.reduce((acc, item) => acc + item.area, 0);
    if (box.w >= box.h) {
      const columnWidth = sum / box.h;
      let y = box.y;
      for (const item of list) {
        const h = item.area / columnWidth;
        result[item.index] = { x: box.x, y, w: columnWidth, h };
        y += h;
      }
      box = { x: box.x + columnWidth, y: box.y, w: box.w - columnWidth, h: box.h };
    } else {
      const rowHeight = sum / box.w;
      let x = box.x;
      for (const item of list) {
        const w = item.area / rowHeight;
        result[item.index] = { x, y: box.y, w, h: rowHeight };
        x += w;
      }
      box = { x: box.x, y: box.y + rowHeight, w: box.w, h: box.h - rowHeight };
    }
  };
  for (const item of items) {
    const side = Math.min(box.w, box.h);
    if (row.length === 0 || worst([...row, item], side) <= worst(row, side)) row.push(item);
    else {
      layout(row);
      row = [item];
    }
  }
  if (row.length) layout(row);
  return result;
}

export type FlowPoint = { start: number; buys: number; sells: number; cvd: number };

/** Taker buy/sell notional per bucket and the running cumulative volume delta. */
export function tradeFlow(trades: Trade[], fromMs: number, toMs: number, bucketMs: number): FlowPoint[] {
  const count = Math.max(1, Math.ceil((toMs - fromMs) / bucketMs));
  const points = Array.from({ length: count }, (_, index) => ({ start: fromMs + index * bucketMs, buys: 0, sells: 0, cvd: 0 }));
  for (const trade of trades) {
    if (trade.created_at_ms < fromMs || trade.created_at_ms > toMs) continue;
    const point = points[Math.min(count - 1, Math.floor((trade.created_at_ms - fromMs) / bucketMs))];
    if (isTakerBuy(trade)) point.buys += notional(trade);
    else point.sells += notional(trade);
  }
  let running = 0;
  for (const point of points) {
    running += point.buys - point.sells;
    point.cvd = running;
  }
  return points;
}

export function activeTraders(trades: Trade[], fromMs: number) {
  const buyers = new Set<string>();
  const sellers = new Set<string>();
  for (const trade of trades) {
    if (trade.created_at_ms < fromMs) continue;
    if (trade.buyer_account_id) buyers.add(trade.buyer_account_id);
    if (trade.seller_account_id) sellers.add(trade.seller_account_id);
  }
  return { total: new Set([...buyers, ...sellers]).size, buyers: buyers.size, sellers: sellers.size };
}

/** Long/short account ratio from each account's most recent funding payment with a non-zero position. */
export function longShortAccounts(payments: FundingPayment[]) {
  const latest = new Map<string, FundingPayment>();
  for (const payment of payments) {
    const current = latest.get(payment.account_id);
    if (!current || payment.updated_at_ms > current.updated_at_ms) latest.set(payment.account_id, payment);
  }
  let longs = 0;
  let shorts = 0;
  for (const payment of latest.values()) {
    if (num(payment.position_size) === 0) continue;
    if (/long|buy/i.test(payment.position_side)) longs += 1;
    else if (/short|sell/i.test(payment.position_side)) shorts += 1;
  }
  return { longs, shorts, ratio: shorts > 0 ? longs / shorts : null, asOfMs: Math.max(0, ...[...latest.values()].map((payment) => payment.updated_at_ms)) };
}

export type ScreenerMetric = "surge" | "change" | "volume" | "openInterest" | "funding" | "trades";

export const SCREENER_METRICS: Record<ScreenerMetric, { label: string; help: string; value: (row: MarketRow) => number | null }> = {
  surge: { label: "Volume Surge", help: "Traded notional in the last hour divided by the average hourly notional over the last 24 hours. 2.00× means this hour is twice as busy as usual.", value: (row) => row.surge },
  change: { label: "24h Change", help: "Mark price versus the oldest trade price in the 24-hour window.", value: (row) => row.change24h },
  volume: { label: "24h Volume", help: "24h USD turnover reported by the indexer ticker.", value: (row) => row.turnover24h },
  openInterest: { label: "Open Interest", help: "Reported value of open positions (USD).", value: (row) => row.openInterest },
  funding: { label: "Funding Rate", help: "Next funding rate reported by the indexer.", value: (row) => row.fundingRate },
  trades: { label: "24h Trades", help: "Number of fills in the last 24 hours.", value: (row) => row.trades24h },
};

export function rankRows(rows: MarketRow[], metric: ScreenerMetric, direction: "asc" | "desc"): MarketRow[] {
  const read = SCREENER_METRICS[metric].value;
  return [...rows].sort((a, b) => {
    const left = read(a);
    const right = read(b);
    if (left === null && right === null) return b.turnover24h - a.turnover24h;
    if (left === null) return 1;
    if (right === null) return -1;
    return direction === "desc" ? right - left : left - right;
  });
}
