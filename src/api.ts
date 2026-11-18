import { DAY_MS, HOUR_MS } from "./analytics";
import type { Dataset, FundingPayment, Market, MarketTicker, Page, Trade } from "./types";

export const DEFAULT_API_URL = "https://indexer.api.real.xyz";
/** The indexer rejects page sizes above 1000. */
const TRADE_PAGE_SIZE = 1000;
/** The window is fetched as independent time slices so several cursors can run in parallel. */
const SLICE_MS = HOUR_MS;
const CONCURRENCY = 8;
/** Per-slice safety cap (60k fills in one hour); REAL prints ~3–4k an hour. */
const MAX_PAGES_PER_SLICE = 60;
/** The dashboard keeps a rolling window of raw trades. */
export const WINDOW_MS = DAY_MS;

/** Keeps only the fields the dashboard reads; raw indexer trades are ~740 bytes each. */
export function compactTrade(trade: Trade): Trade {
  return { id: trade.id, market_id: trade.market_id, side: trade.side, buyer_account_id: trade.buyer_account_id, seller_account_id: trade.seller_account_id, price: trade.price, volume: trade.volume, created_at_ms: trade.created_at_ms };
}

type Envelope<T> = T[] | { data?: T[] | null; next_cursor?: string | null; pagination?: { next_cursor?: string | null } };

/** Accepts a bare array, `{ data }`, `{ data, next_cursor }` or `{ data, pagination: { next_cursor } }`. */
export function toPage<T>(body: Envelope<T>): Page<T> {
  if (Array.isArray(body)) return { data: body, next_cursor: null };
  const data = Array.isArray(body.data) ? body.data : [];
  const cursor = body.pagination?.next_cursor ?? body.next_cursor ?? null;
  return { data, next_cursor: cursor || null };
}

export class RealIndexer {
  constructor(
    readonly baseUrl: string = import.meta.env.VITE_REAL_API_URL || DEFAULT_API_URL,
    private readonly fetchFn: typeof fetch = (...args) => fetch(...args),
  ) {}

  private async page<T>(path: string, params: Record<string, string | number | undefined>, signal?: AbortSignal): Promise<Page<T>> {
    const query = Object.entries(params)
      .filter(([, value]) => value !== undefined && value !== "")
      .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
      .join("&");
    const response = await this.fetchFn(`${this.baseUrl.replace(/\/$/, "")}${path}${query ? `?${query}` : ""}`, { signal });
    if (!response.ok) throw new Error(`REAL API ${path} returned ${response.status}`);
    return toPage<T>(await response.json());
  }

  async markets(signal?: AbortSignal): Promise<Market[]> {
    return (await this.page<Market>("/api/v1/markets", { "p[s]": 200 }, signal)).data;
  }

  async tickers(signal?: AbortSignal): Promise<MarketTicker[]> {
    return (await this.page<MarketTicker>("/api/v1/markets/tickers", { "p[s]": 200 }, signal)).data;
  }

  /** All trades in [fromMs, toMs], following cursors (newest-first pages) up to `maxPages`. */
  async tradesBetween(fromMs: number, toMs: number, signal?: AbortSignal, maxPages = MAX_PAGES_PER_SLICE) {
    const trades: Trade[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page: Page<Trade> = await this.page<Trade>("/api/v1/trades", { "p[s]": TRADE_PAGE_SIZE, "f[created_at_from_ms]": fromMs, "f[created_at_to_ms]": toMs, "p[c]": cursor ?? undefined }, signal);
      for (const trade of page.data) if (trade.created_at_ms >= fromMs && trade.created_at_ms <= toMs) trades.push(compactTrade(trade));
      cursor = page.data.length ? page.next_cursor : null;
      pages += 1;
    } while (cursor && pages < maxPages);
    return { trades, truncated: Boolean(cursor) };
  }

  async fundingPayments(marketId: string, signal?: AbortSignal): Promise<FundingPayment[]> {
    return (await this.page<FundingPayment>("/api/v1/funding-payments", { "f[market_ids]": marketId, "p[s]": 1000 }, signal)).data;
  }
}

type Segment = { from: number; to: number; done: boolean; trades: Trade[] };

/** Splits [from, to] into slices, newest first. */
export function sliceRange(from: number, to: number, sliceMs = SLICE_MS): Segment[] {
  const segments: Segment[] = [];
  for (let end = to; end > from; end -= sliceMs) segments.push({ from: Math.max(from, end - sliceMs), to: end, done: false, trades: [] });
  return segments;
}

/** Oldest timestamp reached by the run of completed segments starting from the newest one. */
export function contiguousFrom(segments: Segment[], fallback: number): number {
  let reached = fallback;
  for (const segment of segments) {
    if (!segment.done) break;
    reached = segment.from;
  }
  return reached;
}

export type LoadOptions = {
  signal?: AbortSignal;
  /** Called with a usable dataset as soon as tickers arrive, then as history fills in (newest hours first). */
  onPartial?: (dataset: Dataset, progress: { done: number; total: number }) => void;
};

/**
 * Loads tickers plus a rolling 24h of trades. Trades are fetched as hourly slices, several at a time,
 * newest first. Anything `previous` already covers (from memory or the browser cache) is reused, so a
 * refresh only fetches the gap since its last fill.
 */
export async function loadDataset(api: RealIndexer, now: number, previous?: Dataset | null, { signal, onPartial }: LoadOptions = {}): Promise<Dataset> {
  const windowStart = now - WINDOW_MS;
  const reusable = previous?.source === "live" && previous.coverage.toMs > windowStart + SLICE_MS;
  const known = reusable ? { from: Math.max(previous.coverage.fromMs, windowStart), to: previous.coverage.toMs } : null;

  // Timeline from newest to oldest: the gap since the last load, what we already hold, then any older gap.
  const segments: Segment[] = known
    ? [
        ...sliceRange(known.to - 60_000, now),
        { from: known.from, to: known.to, done: true, trades: previous!.trades.filter((trade) => trade.created_at_ms >= known.from) },
        ...sliceRange(windowStart, known.from),
      ]
    : sliceRange(windowStart, now);
  const pending = segments.filter((segment) => !segment.done);
  const total = pending.length;
  let completed = 0;
  let truncated = false;

  const metaPromise = Promise.all([
    reusable && previous.markets.length ? Promise.resolve(previous.markets) : api.markets(signal).catch(() => [] as Market[]),
    api.tickers(signal),
  ]);
  let meta: [Market[], MarketTicker[]] | null = null;

  const build = (): Dataset => {
    const fromMs = contiguousFrom(segments, now);
    const seen = new Set<string>();
    const trades: Trade[] = [];
    for (const segment of segments) {
      if (segment.from < fromMs) break;
      for (const trade of segment.trades) {
        if (seen.has(trade.id)) continue;
        seen.add(trade.id);
        trades.push(trade);
      }
    }
    trades.sort((a, b) => a.created_at_ms - b.created_at_ms);
    return { source: "live", fetchedAt: now, markets: meta![0], tickers: meta![1], trades, coverage: { fromMs, toMs: now, truncated } };
  };

  let lastEmit = 0;
  const emit = (force = false) => {
    // Refreshes keep showing the previous dataset until done; only cold loads stream partial history.
    if (!onPartial || known || !meta || signal?.aborted) return;
    const time = performance.now();
    if (!force && time - lastEmit < 400) return;
    lastEmit = time;
    onPartial(build(), { done: completed, total });
  };

  metaPromise.then((value) => {
    meta = value;
    emit(true);
  }, () => undefined);

  let next = 0;
  const worker = async () => {
    while (next < pending.length) {
      const segment = pending[next++];
      const result = await api.tradesBetween(segment.from, segment.to, signal);
      segment.trades = result.trades;
      segment.done = true;
      truncated ||= result.truncated;
      completed += 1;
      emit();
    }
  };
  await Promise.all([metaPromise, ...Array.from({ length: Math.min(CONCURRENCY, pending.length) }, worker)]);
  meta = await metaPromise;
  return build();
}
