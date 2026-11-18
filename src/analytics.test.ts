import { describe, expect, it } from "vitest";
import { DAY_MS, HOUR_MS, buildMarketRows, flowBucket, longShortAccounts, marketFlow, rankRows, squarify, totals, tradeFlow, volumeShare } from "./analytics";
import { toPage } from "./api";
import { demoDataset } from "./mock";
import type { MarketTicker, Trade } from "./types";

const NOW = 1_800_000_000_000;
const ticker = (id: string, mark: string, turnover = "0", oi = "0"): MarketTicker => ({ market_id: id, symbol: `${id.toUpperCase()}-USDT`, mark_price: mark, index_price: mark, volume_24h: "0", turnover_24h: turnover, open_interest_value: oi });
let seq = 0;
const trade = (market: string, price: number, volume: number, ago: number, side = "buy", buyer = "a", seller = "b"): Trade => ({ id: String((seq += 1)), market_id: market, side, buyer_account_id: buyer, seller_account_id: seller, price: String(price), volume: String(volume), created_at_ms: NOW - ago });

describe("buildMarketRows", () => {
  const trades = [trade("btc", 100, 1, 3 * DAY_MS), trade("btc", 104, 1, DAY_MS + 1), trade("btc", 108, 2, 1000), trade("btc", 106, 1, 500)].sort((a, b) => a.created_at_ms - b.created_at_ms);
  const [row] = buildMarketRows([ticker("btc", "110", "500", "50")], [], trades, NOW, NOW - 7 * DAY_MS);

  it("uses the last trade at least 24h old as the change reference", () => expect(row.change24h).toBeCloseTo(110 / 104 - 1));
  it("computes 24h high/low from fills inside the day", () => expect([row.high24h, row.low24h]).toEqual([108, 106]));
  it("divides last-hour notional by the 24h hourly average for surge", () => {
    expect(row.tradeVolume24h).toBe(322);
    expect(row.volume1h).toBe(322);
    expect(row.avgHourlyVolume).toBeCloseTo(322 / 24);
    expect(row.surge).toBeCloseTo(24);
  });
  it("averages over the covered hours only when history is short", () => {
    const [short] = buildMarketRows([ticker("btc", "110")], [], trades, NOW, NOW - 4 * HOUR_MS);
    expect(short.avgHourlyVolume).toBeCloseTo(322 / 4);
  });
  it("has no change without any trade", () => {
    expect(buildMarketRows([ticker("eth", "5")], [], [], NOW, NOW - 7 * DAY_MS)[0].change24h).toBeNull();
  });
});

describe("totals", () => {
  it("sums ticker turnover/OI and dedupes 24h accounts across roles", () => {
    const rows = buildMarketRows([ticker("a", "1", "100", "10"), ticker("b", "1", "50", "")], [], [], NOW, NOW - DAY_MS);
    const result = totals(rows, [trade("a", 1, 1, 10, "buy", "x", "y"), trade("b", 1, 1, 10, "sell", "y", "z"), trade("a", 1, 1, 2 * DAY_MS, "buy", "q", "r")], NOW);
    expect(result).toMatchObject({ volume24h: 150, openInterest: 10, markets: 2, trades24h: 2, activeAccounts24h: 3 });
  });
});

describe("flowBucket", () => {
  it.each([
    [-0.2, 0], [-0.08, 1], [-0.06, 2], [-0.04, 3], [-0.01, 4], [0, 5], [0.00001, 5], [0.02, 6], [0.03, 6], [0.045, 7], [0.065, 8], [0.1, 9], [0.12, 10],
  ])("%s → bucket %i", (change, bucket) => expect(flowBucket(change)).toBe(bucket));

  it("counts falls and rises, ignoring markets without a reference", () => {
    const rows = buildMarketRows([ticker("a", "1"), ticker("b", "1")], [], [], NOW, NOW).map((row, index) => ({ ...row, change24h: index ? 0.02 : null }));
    expect(marketFlow(rows)).toMatchObject({ fall: 0, rise: 1 });
  });
});

describe("volumeShare", () => {
  it("returns per-bucket shares that sum to one and folds the tail into Other", () => {
    const trades = [trade("a", 1, 60, DAY_MS + 10), trade("b", 1, 30, DAY_MS + 10), trade("c", 1, 10, 10), trade("a", 1, 10, 10)];
    const share = volumeShare(trades, new Map(), NOW - 2 * DAY_MS, NOW, DAY_MS, 2);
    expect(share.series.map((series) => series.key)).toEqual(["a", "b", "other"]);
    for (const bucket of share.buckets) expect(Object.values(bucket.shares).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1);
    expect(share.buckets[1].shares).toEqual({ a: 0.5, b: 0, other: 0.5 });
  });
});

describe("tradeFlow", () => {
  it("splits taker buys/sells and accumulates CVD", () => {
    const points = tradeFlow([trade("a", 2, 5, 3000, "buy"), trade("a", 1, 4, 1500, "Sell"), trade("a", 1, 1, 100, "BUY")], NOW - 4000, NOW, 2000);
    expect(points.map((point) => [point.buys, point.sells, point.cvd])).toEqual([[10, 0, 10], [1, 4, 7]]);
  });
});

describe("longShortAccounts", () => {
  it("uses each account's latest open position", () => {
    const payment = (account: string, side: string, size: string, at: number) => ({ id: account + at, market_id: "a", account_id: account, payment: "0", position_side: side, position_size: size, updated_at_ms: at });
    expect(longShortAccounts([payment("1", "Long", "1", 1), payment("1", "Short", "1", 2), payment("2", "Long", "2", 1), payment("3", "Short", "0", 3)])).toMatchObject({ longs: 1, shorts: 1, ratio: 1 });
  });
});

describe("squarify", () => {
  it("fills the box exactly with proportional areas", () => {
    const values = [6, 6, 4, 3, 2, 2, 1];
    const rects = squarify(values, 600, 400);
    const area = rects.reduce((sum, rect) => sum + rect.w * rect.h, 0);
    expect(area).toBeCloseTo(240_000);
    rects.forEach((rect, index) => expect(rect.w * rect.h).toBeCloseTo((values[index] / 24) * 240_000));
    for (const rect of rects) {
      expect(rect.x + rect.w).toBeLessThanOrEqual(600 + 1e-6);
      expect(rect.y + rect.h).toBeLessThanOrEqual(400 + 1e-6);
    }
  });
});

describe("rankRows", () => {
  it("puts missing metric values last regardless of direction", () => {
    const rows = buildMarketRows([ticker("a", "1"), ticker("b", "1"), ticker("c", "1")], [], [], NOW, NOW).map((row, index) => ({ ...row, surge: [2, null, 5][index] }));
    expect(rankRows(rows, "surge", "desc").map((row) => row.id)).toEqual(["c", "a", "b"]);
    expect(rankRows(rows, "surge", "asc").map((row) => row.id)).toEqual(["a", "c", "b"]);
  });
});

describe("toPage", () => {
  it("reads cursors from every supported envelope", () => {
    expect(toPage([1])).toEqual({ data: [1], next_cursor: null });
    expect(toPage({ data: [1], pagination: { next_cursor: "x" } })).toEqual({ data: [1], next_cursor: "x" });
    expect(toPage({ data: [1], next_cursor: "" })).toEqual({ data: [1], next_cursor: null });
  });
});

describe("demo dataset", () => {
  it("produces sorted trades within the 24h window", () => {
    const data = demoDataset(NOW);
    expect(data.trades.length).toBeGreaterThan(1000);
    expect(data.trades.every((item, index, list) => index === 0 || list[index - 1].created_at_ms <= item.created_at_ms)).toBe(true);
    expect(data.trades[0].created_at_ms).toBeGreaterThanOrEqual(NOW - DAY_MS);
  });
});
