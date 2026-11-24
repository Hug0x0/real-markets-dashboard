import { DAY_MS } from "./analytics";
import type { Dataset, FundingPayment, Market, MarketTicker, Trade } from "./types";

/** Seeded PRNG (mulberry32) so the demo is stable across reloads. */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Spec = { id: string; name: string; price: number; vol: number; weight: number; oi: number; drift: number; lateBoost?: number };

const SPECS: Spec[] = [
  { id: "btc", name: "Bitcoin", price: 60_350, vol: 0.006, weight: 30, oi: 69_000, drift: -0.0002 },
  { id: "eth", name: "Ethereum", price: 1_698, vol: 0.008, weight: 14, oi: 17_200, drift: -0.0004 },
  { id: "xaut", name: "Tether Gold", price: 3_613, vol: 0.003, weight: 8, oi: 8_860, drift: 0.0002 },
  { id: "xrp", name: "XRP", price: 0.9453, vol: 0.011, weight: 7, oi: 1_290, drift: -0.0001, lateBoost: 3 },
  { id: "hype", name: "Hyperliquid", price: 63.95, vol: 0.012, weight: 7, oi: 1_780, drift: 0.0003 },
  { id: "sol", name: "Solana", price: 71.5, vol: 0.01, weight: 5, oi: 9_540, drift: 0.0006 },
  { id: "zec", name: "Zcash", price: 754.9, vol: 0.02, weight: 4, oi: 1_130, drift: 0.002, lateBoost: 5 },
  { id: "xmr", name: "Monero", price: 498.2, vol: 0.012, weight: 4, oi: 1_200, drift: 0.0004, lateBoost: 2 },
  { id: "bnb", name: "BNB", price: 551.1, vol: 0.006, weight: 4, oi: 2_430, drift: 0 },
  { id: "near", name: "NEAR Protocol", price: 3.008, vol: 0.013, weight: 3.5, oi: 900, drift: -0.0008 },
  { id: "ena", name: "Ethena", price: 0.1006, vol: 0.014, weight: 3.5, oi: 600, drift: 0.0009 },
  { id: "lit", name: "Lighter", price: 2.418, vol: 0.016, weight: 3.5, oi: 1_110, drift: -0.0012 },
];

const ACCOUNTS = Array.from({ length: 64 }, (_, index) => `0x${(index * 2654435761 >>> 0).toString(16).padStart(8, "0")}${"a1b2c3d4".repeat(4)}`);

export function demoDataset(now = Date.now()): Dataset {
  const random = rng(2026);
  const from = now - DAY_MS;
  const step = 2 * 60_000;
  const trades: Trade[] = [];
  const tickers: MarketTicker[] = [];
  const markets: Market[] = [];
  let id = 0;

  for (const spec of SPECS) {
    let price = spec.price * (1 - spec.drift * 120);
    let turnover24h = 0;
    let volume24h = 0;
    for (let t = from; t < now; t += step) {
      price *= 1 + spec.drift / 3 + (random() - 0.5) * spec.vol * 0.4;
      const late = t > now - 3_600_000 ? (spec.lateBoost ?? 1) : 1;
      const fills = Math.floor(random() * random() * 4 * Math.sqrt(spec.weight) * late);
      for (let fill = 0; fill < fills; fill += 1) {
        const size = ((random() ** 2) * 900 + 40) * (spec.weight / 6) / price;
        const createdAt = Math.floor(t + random() * step);
        const fillPrice = price * (1 + (random() - 0.5) * spec.vol * 0.2);
        const buyer = ACCOUNTS[Math.floor(random() * ACCOUNTS.length)];
        const seller = ACCOUNTS[Math.floor(random() * ACCOUNTS.length)];
        trades.push({
          id: String((id += 1)),
          market_id: spec.id,
          side: random() < 0.5 + spec.drift * 80 ? "buy" : "sell",
          buyer_account_id: buyer,
          seller_account_id: seller,
          price: fillPrice.toPrecision(6),
          volume: size.toPrecision(5),
          buyer_fee_paid: "0",
          seller_fee_paid: "0",
          created_at_ms: createdAt,
        });
        if (createdAt > now - DAY_MS) {
          turnover24h += fillPrice * size;
          volume24h += size;
        }
      }
    }
    const symbol = `${spec.id.toUpperCase()}-USDT`;
    markets.push({ id: spec.id, symbol, underlying: spec.name, quote_unit: "USDT", settlement_asset: "USDT", price: price.toPrecision(6), created_at_ms: from, updated_at_ms: now });
    tickers.push({
      market_id: spec.id,
      symbol,
      mark_price: price.toPrecision(6),
      index_price: (price * (1 + (random() - 0.5) * 0.0006)).toPrecision(6),
      open_interest_value: String(spec.oi),
      volume_24h: volume24h.toFixed(4),
      turnover_24h: turnover24h.toFixed(2),
      perp_next_funding_rate: ((random() - 0.45) * 0.0003).toFixed(7),
      perp_next_funding_time_ms: Math.ceil(now / 3_600_000) * 3_600_000,
      volume_change_24h: ((random() - 0.4) * 1.2).toFixed(4),
      updated_at_ms: now,
    });
  }

  trades.sort((a, b) => a.created_at_ms - b.created_at_ms);
  return { source: "demo", fetchedAt: now, markets, tickers, trades, coverage: { fromMs: from, toMs: now, truncated: false } };
}

export function demoFunding(marketId: string, now = Date.now()): FundingPayment[] {
  const random = rng(marketId.split("").reduce((sum, char) => sum + char.charCodeAt(0), 7));
  return ACCOUNTS.slice(0, 18 + Math.floor(random() * 30)).map((account, index) => ({
    id: `${marketId}-${index}`,
    market_id: marketId,
    account_id: account,
    payment: ((random() - 0.5) * 2).toFixed(4),
    position_side: random() < 0.42 ? "Long" : "Short",
    position_size: (random() * 3).toFixed(3),
    rate: "0.0000125",
    updated_at_ms: now - Math.floor(random() * 3_600_000),
  }));
}
