/** Shapes returned by the public REAL indexer. Numeric values arrive as strings; `_ms` fields are epoch milliseconds. */
export type Market = {
  id: string;
  symbol: string;
  underlying: string;
  quote_unit: string;
  settlement_asset: string;
  price: string;
  created_at_ms: number;
  updated_at_ms: number;
};

export type MarketTicker = {
  market_id: string;
  symbol: string;
  mark_price: string;
  index_price: string;
  last_traded_price?: string | null;
  /** Last traded price 24h ago; `price_change_24h` = last_traded_price ÷ prev_price_24h − 1. */
  prev_price_24h?: string | null;
  price_change_24h?: string | null;
  high_price_24h?: string | null;
  low_price_24h?: string | null;
  /** Fractional change of 24h volume versus the previous 24h (0.25 = +25%). */
  volume_change_24h?: string | null;
  open_interest?: string | null;
  open_interest_value?: string | null;
  volume_24h: string;
  turnover_24h: string;
  perp_next_funding_rate?: string | null;
  perp_next_funding_time_ms?: number | null;
  updated_at_ms?: number;
};

export type Trade = {
  id: string;
  market_id: string;
  /** Taker side: "buy" / "sell" (case varies). */
  side: string;
  buyer_account_id: string;
  seller_account_id: string;
  price: string;
  volume: string;
  buyer_fee_paid?: string;
  seller_fee_paid?: string;
  created_at_ms: number;
};

export type FundingPayment = {
  id: string;
  market_id: string;
  account_id: string;
  payment: string;
  position_side: string;
  position_size: string;
  rate?: string | null;
  updated_at_ms: number;
};

export type Page<T> = { data: T[]; next_cursor: string | null };

/** Everything the dashboard renders, fetched once and refreshed on demand. */
export type Dataset = {
  source: "live" | "demo";
  fetchedAt: number;
  markets: Market[];
  tickers: MarketTicker[];
  trades: Trade[];
  /** Trade window actually covered, and whether the page cap cut the requested 24h short. */
  coverage: { fromMs: number; toMs: number; truncated: boolean };
};
