import { describe, expect, it } from "vitest";
import { HOUR_MS } from "./analytics";
import { RealIndexer, contiguousFrom, loadDataset, sliceRange } from "./api";
import type { Trade } from "./types";

const NOW = 1_800_000_000_000;

/** Fake indexer: one trade per minute over 30h, served newest-first with cursors, honouring from/to filters. */
function fakeIndexer(pageSize = 50) {
  const all: Trade[] = Array.from({ length: 30 * 60 }, (_, index) => ({
    id: String(index),
    market_id: "btc",
    side: index % 2 ? "buy" : "sell",
    buyer_account_id: "a",
    seller_account_id: "b",
    price: "100",
    volume: "1",
    created_at_ms: NOW - index * 60_000,
  }));
  const calls: URL[] = [];
  const fetchFn = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    calls.push(url);
    if (url.pathname.endsWith("/tickers")) return Response.json({ data: [{ market_id: "btc", symbol: "BTC-USDT", mark_price: "100", index_price: "100", volume_24h: "1", turnover_24h: "100" }] });
    if (url.pathname.endsWith("/markets")) return Response.json({ data: [] });
    const from = Number(url.searchParams.get("f[created_at_from_ms]"));
    const to = Number(url.searchParams.get("f[created_at_to_ms]") || Infinity);
    const offset = Number(url.searchParams.get("p[c]") || 0);
    const matching = all.filter((trade) => trade.created_at_ms >= from && trade.created_at_ms <= to);
    const page = matching.slice(offset, offset + pageSize);
    return Response.json({ data: page, pagination: { next_cursor: offset + pageSize < matching.length ? String(offset + pageSize) : null } });
  }) as typeof fetch;
  return { api: new RealIndexer("https://example.test", fetchFn), calls };
}

describe("sliceRange / contiguousFrom", () => {
  it("slices newest first and clips the oldest slice", () => {
    expect(sliceRange(0, 2.5 * HOUR_MS).map((segment) => [segment.from, segment.to])).toEqual([
      [1.5 * HOUR_MS, 2.5 * HOUR_MS],
      [0.5 * HOUR_MS, 1.5 * HOUR_MS],
      [0, 0.5 * HOUR_MS],
    ]);
  });
  it("stops at the first unfinished slice", () => {
    const segments = sliceRange(0, 3 * HOUR_MS);
    segments[0].done = true;
    segments[2].done = true;
    expect(contiguousFrom(segments, 99)).toBe(2 * HOUR_MS);
  });
});

describe("loadDataset", () => {
  it("fetches exactly the 24h window across parallel slices, sorted and deduplicated", async () => {
    const { api } = fakeIndexer();
    const partials: number[] = [];
    const data = await loadDataset(api, NOW, null, { onPartial: (partial) => partials.push(partial.trades.length) });
    expect(data.trades).toHaveLength(24 * 60 + 1);
    expect(new Set(data.trades.map((trade) => trade.id)).size).toBe(data.trades.length);
    expect(data.trades[0].created_at_ms).toBe(NOW - 24 * HOUR_MS);
    expect(data.coverage).toEqual({ fromMs: NOW - 24 * HOUR_MS, toMs: NOW, truncated: false });
    expect(partials.length).toBeGreaterThan(0);
  });

  it("only fetches the gap since the previous load on refresh", async () => {
    const { api, calls } = fakeIndexer();
    const first = await loadDataset(api, NOW - 10 * 60_000, null);
    calls.length = 0;
    const second = await loadDataset(api, NOW, first);
    const tradeCalls = calls.filter((url) => url.pathname.endsWith("/trades"));
    expect(tradeCalls).toHaveLength(1);
    expect(Number(tradeCalls[0].searchParams.get("f[created_at_from_ms]"))).toBe(NOW - 11 * 60_000);
    expect(second.trades).toHaveLength(24 * 60 + 1);
    expect(second.trades.at(-1)!.created_at_ms).toBe(NOW);
  });

  it("strips fields the dashboard never reads", async () => {
    const { api } = fakeIndexer();
    const data = await loadDataset(api, NOW, null);
    expect(Object.keys(data.trades[0]).sort()).toEqual(["buyer_account_id", "created_at_ms", "id", "market_id", "price", "seller_account_id", "side", "volume"]);
  });
});
