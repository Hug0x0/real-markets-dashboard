import { useEffect, useMemo, useState } from "react";
import { DAY_MS, HOUR_MS, activeTraders, longShortAccounts, tradeFlow, type FlowPoint, type MarketRow } from "./analytics";
import type { RealIndexer } from "./api";
import { Empty, Panel, Tooltip, niceTicks, useWidth, type TipState } from "./charts";
import { clock, countdown, dateTime, hourLabel, pct, price, trendClass, usd, usdCompact } from "./format";
import { demoFunding } from "./mock";
import { AssetBadge } from "./Screener";
import type { Dataset, FundingPayment } from "./types";

const INTERVALS = [
  { key: "1m", ms: 60_000 },
  { key: "5m", ms: 5 * 60_000 },
  { key: "15m", ms: 15 * 60_000 },
  { key: "1h", ms: HOUR_MS },
] as const;
const RANGES = [
  { key: "1h", label: "Last hour", ms: HOUR_MS },
  { key: "6h", label: "Last 6 hours", ms: 6 * HOUR_MS },
  { key: "24h", label: "Last 24 hours", ms: DAY_MS },
] as const;
/** Keep bar charts readable: never draw more than this many buckets, nor fewer than this. */
const MAX_BUCKETS = 400;
const MIN_BUCKETS = 4;

type Props = { data: Dataset; rows: MarketRow[]; marketId: string; onMarket: (id: string) => void; api: RealIndexer; now: number };

export function Analytics({ data, rows, marketId, onMarket, api, now }: Props) {
  const wanted = marketId.toLowerCase();
  const row = rows.find((item) => item.id.toLowerCase() === wanted || item.base.toLowerCase() === wanted) ?? [...rows].sort((a, b) => b.turnover24h - a.turnover24h)[0];
  const [interval, setBarInterval] = useState<(typeof INTERVALS)[number]["key"]>("15m");
  const [range, setRange] = useState<(typeof RANGES)[number]["key"]>("24h");
  const [funding, setFunding] = useState<{ marketId: string; payments: FundingPayment[]; failed: boolean } | null>(null);

  const rangeMs = RANGES.find((item) => item.key === range)!.ms;
  const intervalMs = INTERVALS.find((item) => item.key === interval)!.ms;
  const usable = (ms: number) => rangeMs / ms <= MAX_BUCKETS && rangeMs / ms >= MIN_BUCKETS;
  const effectiveInterval = usable(intervalMs) ? intervalMs : (INTERVALS.find((item) => usable(item.ms)) ?? INTERVALS[0]).ms;
  const end = data.coverage.toMs;
  const start = Math.max(end - rangeMs, data.coverage.fromMs);

  const marketTrades = useMemo(() => data.trades.filter((trade) => trade.market_id === row?.id), [data.trades, row?.id]);
  const flow = useMemo(() => tradeFlow(marketTrades, start, end, effectiveInterval), [marketTrades, start, end, effectiveInterval]);
  const traders1h = useMemo(() => activeTraders(marketTrades, data.fetchedAt - HOUR_MS), [marketTrades, data.fetchedAt]);
  const traders24h = useMemo(() => activeTraders(marketTrades, data.fetchedAt - DAY_MS), [marketTrades, data.fetchedAt]);

  useEffect(() => {
    if (!row) return;
    if (data.source === "demo") {
      setFunding({ marketId: row.id, payments: demoFunding(row.id), failed: false });
      return;
    }
    const controller = new AbortController();
    setFunding(null);
    api
      .fundingPayments(row.id, controller.signal)
      .then((payments) => setFunding({ marketId: row.id, payments, failed: false }))
      .catch((error) => !controller.signal.aborted && (console.warn(error), setFunding({ marketId: row.id, payments: [], failed: true })));
    return () => controller.abort();
  }, [row?.id, data.source, api]);

  if (!row) return <Empty>No markets returned by the indexer.</Empty>;
  const ls = funding?.marketId === row.id ? longShortAccounts(funding.payments) : null;
  const buys = flow.reduce((sum, point) => sum + point.buys, 0);
  const sells = flow.reduce((sum, point) => sum + point.sells, 0);
  const cvdNow = flow.at(-1)?.cvd ?? 0;

  return (
    <>
      <section className="ticker-strip">
        <div className="ticker-id">
          <AssetBadge row={row} />
          <div>
            <label className="market-select">
              <span className="sr-only">Market</span>
              <select value={row.id} onChange={(event) => onMarket(rows.find((item) => item.id === event.target.value)?.base ?? event.target.value)}>
                {[...rows].sort((a, b) => b.turnover24h - a.turnover24h).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.base} · Perp
                  </option>
                ))}
              </select>
            </label>
            <strong className={trendClass(row.change24h)}>
              {price(row.lastPrice)} <small>{pct(row.change24h)}</small>
            </strong>
          </div>
        </div>
        <Stat label="Last" value={price(row.lastPrice)} />
        <Stat label="Mark" value={price(row.price)} />
        <Stat label="Index" value={price(row.indexPrice)} />
        <Stat label="24h High" value={price(row.high24h)} />
        <Stat label="24h Low" value={price(row.low24h)} />
        <Stat label="Funding / Countdown" value={<><span className={trendClass(row.fundingRate)}>{pct(row.fundingRate, 4)}</span> / {countdown(row.fundingTimeMs, now)}</>} />
        <Stat label="24h Volume (USD)" value={usd(row.turnover24h)} />
        <Stat label="Open Interest (USD)" value={usd(row.openInterest)} />
      </section>

      <section className="panel">
        <header className="panel-head">
          <h2>
            Trader Metrics <span className="subtle">Updated {clock(data.fetchedAt)}</span>
          </h2>
          <div className="controls">
            <div className="segmented" role="group" aria-label="Bar interval">
              {INTERVALS.map((item) => {
                const disabled = !usable(item.ms);
                return (
                  <button key={item.key} aria-pressed={effectiveInterval === item.ms} disabled={disabled} title={disabled ? "Not available for this range" : undefined} onClick={() => setBarInterval(item.key)}>
                    {item.key}
                  </button>
                );
              })}
            </div>
            <select aria-label="Range" value={range} onChange={(event) => setRange(event.target.value as typeof range)}>
              {RANGES.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
        </header>
        <div className="kpis kpis-3">
          <div className="kpi">
            <span>Active traders (1h)</span>
            <strong>{traders1h.total}</strong>
            <small>
              {traders1h.buyers} buyers · {traders1h.sellers} sellers
            </small>
          </div>
          <div className="kpi">
            <span>Active traders (24h)</span>
            <strong>{traders24h.total}</strong>
            <small>
              {traders24h.buyers} buyers · {traders24h.sellers} sellers
            </small>
          </div>
          <div className="kpi">
            <span>Long / Short account ratio</span>
            <strong>{funding === null ? "…" : ls?.ratio != null ? ls.ratio.toFixed(2) : "—"}</strong>
            <small>{funding?.failed ? "Funding payments unavailable" : ls ? `${ls.longs} long · ${ls.shorts} short · from funding payments` : "Loading funding payments…"}</small>
          </div>
        </div>
      </section>

      <div className="split">
        <Panel
          title="Trade Flow"
          aside={
            <div className="readout">
              <span>
                Buys <b className="up">{usdCompact(buys)}</b>
              </span>
              <span>
                Sells <b className="down">{usdCompact(sells)}</b>
              </span>
            </div>
          }
        >
          <p className="subtle">Taker buy vs. sell notional per {INTERVALS.find((item) => item.ms === effectiveInterval)?.key ?? "1h"}.</p>
          <FlowBars points={flow} />
        </Panel>
        <Panel
          title="Cumulative Volume Delta"
          aside={
            <div className="readout">
              <span>
                Now <b className={trendClass(cvdNow)}>{usdCompact(cvdNow)}</b>
              </span>
            </div>
          }
        >
          <p className="subtle">Running sum of taker buys minus taker sells.</p>
          <CvdLine points={flow} />
        </Panel>
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

const PAD = { top: 10, right: 10, bottom: 26, left: 56 };
const HEIGHT = 300;

/** Evenly spaced time labels that never collide (~80px apart), skipping the very edges. */
function timeTicks(points: FlowPoint[], plotW: number) {
  const every = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(plotW / 80))));
  return points.map((point, index) => ({ point, index })).filter(({ index }) => index % every === Math.floor(every / 2) && index > 0);
}

function FlowBars({ points }: { points: FlowPoint[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<TipState>(null);
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...points.map((point) => Math.max(point.buys, point.sells)), 0);
  if (max === 0) return <div ref={ref}><Empty>No trades in this range.</Empty></div>;
  const ticks = niceTicks(0, max, 2);
  const top = ticks.at(-1)!;
  const plotW = width - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const zero = PAD.top + plotH / 2;
  const slot = plotW / points.length;
  const barW = Math.max(1, Math.min(10, slot - (slot > 4 ? 2 : 0.5)));
  const scale = (value: number) => (value / top) * (plotH / 2);

  return (
    <div className="chart" ref={ref}>
      <svg width={width} height={HEIGHT} role="img" aria-label="Taker buy and sell notional per interval">
        {[...ticks.map((tick) => -tick).reverse(), ...ticks.slice(1)].map((tick) => (
          <g key={tick}>
            <line className={tick === 0 ? "baseline" : "grid"} x1={PAD.left} x2={width - PAD.right} y1={zero - scale(tick)} y2={zero - scale(tick)} />
            <text className="axis" x={PAD.left - 8} y={zero - scale(tick) + 4} textAnchor="end">
              {usdCompact(tick || 0)}
            </text>
          </g>
        ))}
        {points.map((point, index) => {
          const cx = PAD.left + slot * index + slot / 2;
          return (
            <g key={point.start} opacity={hover === null || hover === index ? 1 : 0.55}>
              {point.buys > 0 && <rect x={cx - barW / 2} y={zero - scale(point.buys)} width={barW} height={scale(point.buys)} rx={Math.min(2, barW / 2)} fill="var(--up)" />}
              {point.sells > 0 && <rect x={cx - barW / 2} y={zero} width={barW} height={scale(point.sells)} rx={Math.min(2, barW / 2)} fill="var(--down)" />}
            </g>
          );
        })}
        {timeTicks(points, plotW).map(({ point, index }) => (
          <text key={point.start} className="axis" x={PAD.left + slot * index + slot / 2} y={HEIGHT - 6} textAnchor="middle">
            {hourLabel(point.start)}
          </text>
        ))}
        <rect
          x={PAD.left}
          y={PAD.top}
          width={plotW}
          height={plotH}
          fill="transparent"
          onPointerMove={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            const index = Math.min(points.length - 1, Math.max(0, Math.floor(((event.clientX - box.left) / box.width) * points.length)));
            const point = points[index];
            setHover(index);
            setTip({ x: PAD.left + slot * index + slot / 2, y: 8, content: <><b>{dateTime(point.start)}</b><div className="tip-row"><i style={{ background: "var(--up)" }} />Buys<span>{usd(point.buys)}</span></div><div className="tip-row"><i style={{ background: "var(--down)" }} />Sells<span>{usd(point.sells)}</span></div><div className="tip-row">Net<span>{usd(point.buys - point.sells)}</span></div></> });
          }}
          onPointerLeave={() => (setTip(null), setHover(null))}
        />
      </svg>
      <Tooltip tip={tip} width={width} />
    </div>
  );
}

function CvdLine({ points }: { points: FlowPoint[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<TipState>(null);
  const [hover, setHover] = useState<number | null>(null);
  const values = points.map((point) => point.cvd);
  const hasTrades = points.some((point) => point.buys + point.sells > 0);
  if (!hasTrades) return <div ref={ref}><Empty>No trades in this range.</Empty></div>;
  const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values), 4);
  const low = ticks[0];
  const high = ticks.at(-1)!;
  const plotW = width - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const x = (index: number) => PAD.left + (points.length === 1 ? plotW / 2 : (index / (points.length - 1)) * plotW);
  const y = (value: number) => PAD.top + ((high - value) / (high - low || 1)) * plotH;
  const line = values.map((value, index) => `${index ? "L" : "M"}${x(index)},${y(value)}`).join("");
  const area = `${line}L${x(points.length - 1)},${y(0)}L${x(0)},${y(0)}Z`;
  const last = values.at(-1) ?? 0;
  const tone = last >= 0 ? "var(--up)" : "var(--down)";

  return (
    <div className="chart" ref={ref}>
      <svg width={width} height={HEIGHT} role="img" aria-label="Cumulative volume delta over time">
        {ticks.map((tick) => (
          <g key={tick}>
            <line className={tick === 0 ? "baseline" : "grid"} x1={PAD.left} x2={width - PAD.right} y1={y(tick)} y2={y(tick)} />
            <text className="axis" x={PAD.left - 8} y={y(tick) + 4} textAnchor="end">
              {usdCompact(tick || 0)}
            </text>
          </g>
        ))}
        <path d={area} fill={tone} opacity={0.14} />
        <path d={line} fill="none" stroke={tone} strokeWidth={2} strokeLinejoin="round" />
        {timeTicks(points, plotW).map(({ point, index }) => (
          <text key={point.start} className="axis" x={x(index)} y={HEIGHT - 6} textAnchor="middle">
            {hourLabel(point.start)}
          </text>
        ))}
        {hover !== null && (
          <>
            <line className="crosshair" x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotH} />
            <circle cx={x(hover)} cy={y(values[hover])} r={4.5} fill={tone} stroke="var(--panel)" strokeWidth={2} />
          </>
        )}
        <rect
          x={PAD.left}
          y={PAD.top}
          width={plotW}
          height={plotH}
          fill="transparent"
          onPointerMove={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            const index = Math.round(((event.clientX - box.left) / box.width) * (points.length - 1));
            setHover(index);
            setTip({ x: x(index), y: 8, content: <><b>{dateTime(points[index].start)}</b><div className="tip-row">CVD<span>{usd(values[index])}</span></div></> });
          }}
          onPointerLeave={() => (setTip(null), setHover(null))}
        />
      </svg>
      <Tooltip tip={tip} width={width} />
    </div>
  );
}
