import { useMemo, useState } from "react";
import { FLOW_BUCKETS, HOUR_MS, flowBucket as bucketOf, marketFlow, squarify, volumeShare, type MarketRow, type Totals } from "./analytics";
import { Empty, Legend, OTHER_COLOR, Panel, SERIES_COLORS, Tooltip, useWidth, type TipState } from "./charts";
import { count, hourLabel, pct, price, usd, usdCompact } from "./format";
import type { Dataset } from "./types";

type Props = { data: Dataset; rows: MarketRow[]; totals: Totals; onOpen: (marketId: string) => void };

export function Overview({ data, rows, totals, onOpen }: Props) {
  return (
    <>
      <div className="kpis">
        <Kpi label="24h Volume" value={usd(totals.volume24h)} />
        <Kpi label="Open Interest" value={usd(totals.openInterest)} />
        <Kpi label="Markets" value={count(totals.markets)} note={`${count(rows.filter((row) => row.turnover24h > 0).length)} traded in 24h`} />
        <Kpi label={`Trades (${Math.min(24, Math.round((data.coverage.toMs - data.coverage.fromMs) / HOUR_MS))}h)`} value={count(totals.trades24h)} note={`${count(totals.activeAccounts24h)} active accounts`} />
      </div>
      <div className="split">
        <VolumeShareChart data={data} rows={rows} />
        <MarketFlowChart rows={rows} />
      </div>
      <Heatmap rows={rows} onOpen={onOpen} />
    </>
  );
}

function Kpi({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="kpi">
      <span>{label}</span>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </div>
  );
}

function VolumeShareChart({ data, rows }: { data: Dataset; rows: MarketRow[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<TipState>(null);
  const [hover, setHover] = useState<number | null>(null);
  const labels = useMemo(() => new Map(rows.map((row) => [row.id, row.base])), [rows]);
  const share = useMemo(() => volumeShare(data.trades, labels, Math.floor(data.coverage.fromMs / HOUR_MS) * HOUR_MS, data.coverage.toMs), [data, labels]);
  const colors = new Map(share.series.map((series, index) => [series.key, series.key === "other" ? OTHER_COLOR : SERIES_COLORS[index]]));
  const grand = share.series.reduce((sum, series) => sum + series.total, 0);

  const height = 240;
  const pad = { top: 8, right: 8, bottom: 26, left: 40 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const points = share.buckets;
  const x = (index: number) => pad.left + (points.length === 1 ? plotW / 2 : (index / (points.length - 1)) * plotW);
  const y = (value: number) => pad.top + (1 - value) * plotH;

  // Stack in series order, bottom-up.
  const stacks = share.series.map((_, seriesIndex) =>
    points.map((bucket) => {
      const below = share.series.slice(0, seriesIndex).reduce((sum, series) => sum + bucket.shares[series.key], 0);
      return [below, below + bucket.shares[share.series[seriesIndex].key]] as const;
    }),
  );

  const leader = share.series[0];
  const firstShare = leader && points.find((bucket) => bucket.total > 0)?.shares[leader.key];
  const lastShare = leader && [...points].reverse().find((bucket) => bucket.total > 0)?.shares[leader.key];
  const delta = firstShare !== undefined && lastShare !== undefined ? (lastShare - firstShare) * 100 : null;

  const onMove = (event: React.PointerEvent<SVGRectElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const relative = (event.clientX - box.left) / box.width;
    const index = Math.round(relative * (points.length - 1));
    const bucket = points[index];
    setHover(index);
    setTip({
      x: x(index),
      y: 12,
      content: (
        <>
          <b>{hourLabel(bucket.start)}</b> · {usdCompact(bucket.total)}
          {[...share.series].reverse().map((series) => (
            <div key={series.key} className="tip-row">
              <i style={{ background: colors.get(series.key) }} />
              {series.label}
              <span>{pct(bucket.shares[series.key], 1).replace("+", "")}</span>
            </div>
          ))}
        </>
      ),
    });
  };

  return (
    <Panel
      title="Volume Share"
      aside={<Legend items={share.series.map((series) => ({ key: series.key, label: series.label, color: colors.get(series.key)!, value: grand ? `${Math.round((series.total / grand) * 100)}%` : "" }))} />}
    >
      {leader && delta !== null && (
        <p className="subtle">
          <b>{leader.label}</b> {delta >= 0 ? "+" : ""}
          {delta.toFixed(1)}pp share since {hourLabel(points[0].start)} · hourly, last 24h
        </p>
      )}
      <div className="chart" ref={ref}>
        {grand === 0 ? (
          <Empty>No trades in the selected window.</Empty>
        ) : (
          <svg width={width} height={height} role="img" aria-label="Hourly share of traded notional by market over the last 24 hours">
            {[0, 0.25, 0.5, 0.75, 1].map((tick) => (
              <g key={tick}>
                <line className="grid" x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} />
                <text className="axis" x={pad.left - 8} y={y(tick) + 4} textAnchor="end">
                  {tick * 100}%
                </text>
              </g>
            ))}
            {stacks.map((stack, seriesIndex) => {
              const top = stack.map(([, high], index) => `${x(index)},${y(high)}`);
              const bottom = stack.map(([low], index) => `${x(index)},${y(low)}`).reverse();
              return <polygon key={share.series[seriesIndex].key} points={[...top, ...bottom].join(" ")} fill={colors.get(share.series[seriesIndex].key)} stroke="var(--panel)" strokeWidth={1.5} strokeLinejoin="round" />;
            })}
            {points.map((bucket, index) =>
              index % Math.ceil(points.length / Math.max(2, Math.floor(plotW / 80))) === 0 || index === points.length - 1 ? (
                <text key={bucket.start} className="axis" x={x(index)} y={height - 6} textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"}>
                  {hourLabel(bucket.start)}
                </text>
              ) : null,
            )}
            {hover !== null && <line className="crosshair" x1={x(hover)} x2={x(hover)} y1={pad.top} y2={pad.top + plotH} />}
            <rect x={pad.left} y={pad.top} width={plotW} height={plotH} fill="transparent" onPointerMove={onMove} onPointerLeave={() => (setTip(null), setHover(null))} />
          </svg>
        )}
        <Tooltip tip={tip} width={width} />
      </div>
    </Panel>
  );
}

function MarketFlowChart({ rows }: { rows: MarketRow[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<TipState>(null);
  const flow = useMemo(() => marketFlow(rows), [rows]);
  const max = Math.max(1, ...flow.counts);
  const height = 220;
  const pad = { top: 22, bottom: 26 };
  const slot = width / FLOW_BUCKETS.length;
  const barW = Math.min(46, slot - 8);
  const plotH = height - pad.top - pad.bottom;
  const measured = flow.fall + flow.rise + flow.counts[5];

  return (
    <Panel title="Market Flow" aside={<span className="subtle">24h change distribution</span>}>
      <div className="chart" ref={ref}>
        <svg width={width} height={height} role="img" aria-label="Number of markets in each 24h price-change range">
          <line className="grid" x1={0} x2={width} y1={pad.top + plotH} y2={pad.top + plotH} />
          {flow.counts.map((value, index) => {
            const h = (value / max) * plotH;
            const cx = slot * index + slot / 2;
            const tone = index < 5 ? "var(--down)" : index > 5 ? "var(--up)" : "var(--flat)";
            const names = rows.filter((row) => row.change24h !== null && bucketOf(row.change24h) === index).map((row) => row.base);
            return (
              <g key={FLOW_BUCKETS[index]}>
                {value > 0 && <path d={roundedTop(cx - barW / 2, pad.top + plotH - h, barW, h, 3)} fill={tone} />}
                {value > 0 && (
                  <text className="value" x={cx} y={pad.top + plotH - h - 6} textAnchor="middle">
                    {value}
                  </text>
                )}
                <text className="axis" x={cx} y={height - 6} textAnchor="middle">
                  {width < 520 && index % 2 === 1 ? "" : FLOW_BUCKETS[index]}
                </text>
                <rect
                  x={slot * index}
                  y={0}
                  width={slot}
                  height={height}
                  fill="transparent"
                  onPointerEnter={() => setTip({ x: cx, y: 8, content: <><b>{FLOW_BUCKETS[index]}</b> · {value} market{value === 1 ? "" : "s"}{names.length > 0 && <div className="tip-list">{names.slice(0, 12).join(", ")}{names.length > 12 ? "…" : ""}</div>}</> })}
                  onPointerLeave={() => setTip(null)}
                />
              </g>
            );
          })}
        </svg>
        <Tooltip tip={tip} width={width} />
      </div>
      {measured > 0 ? (
        <div className="breadth" aria-label={`${flow.fall} markets fell, ${flow.rise} rose`}>
          <div className="breadth-bar">
            <span className="down-fill" style={{ flexGrow: flow.fall }} />
            <span className="flat-fill" style={{ flexGrow: flow.counts[5] }} />
            <span className="up-fill" style={{ flexGrow: flow.rise }} />
          </div>
          <div className="breadth-labels">
            <span className="down">Fall: {flow.fall}</span>
            <span className="up">Rise: {flow.rise}</span>
          </div>
        </div>
      ) : (
        <Empty>No market has a 24h reference price yet.</Empty>
      )}
    </Panel>
  );
}

function roundedTop(x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, h, w / 2);
  return `M${x},${y + h} V${y + radius} Q${x},${y} ${x + radius},${y} H${x + w - radius} Q${x + w},${y} ${x + w},${y + radius} V${y + h} Z`;
}

type SizeBy = "volume" | "openInterest";

function heatColor(change: number | null): string {
  if (change === null) return "#262a30";
  const t = Math.min(1, Math.abs(change) / 0.06);
  const [r1, g1, b1] = [38, 42, 48];
  const [r2, g2, b2] = change >= 0 ? [37, 140, 88] : [178, 58, 56];
  const mix = (a: number, b: number) => Math.round(a + (b - a) * (0.25 + 0.75 * t));
  return Math.abs(change) < 5e-5 ? "#2c3036" : `rgb(${mix(r1, r2)},${mix(g1, g2)},${mix(b1, b2)})`;
}

function Heatmap({ rows, onOpen }: { rows: MarketRow[]; onOpen: (marketId: string) => void }) {
  const [ref, width, frame] = useWidth<HTMLDivElement>(900);
  const [sizeBy, setSizeBy] = useState<SizeBy>("volume");
  const [limit, setLimit] = useState(25);
  const [tip, setTip] = useState<TipState>(null);
  const valueOf = (row: MarketRow) => (sizeBy === "volume" ? row.turnover24h : row.openInterest);
  const shown = useMemo(() => [...rows].filter((row) => valueOf(row) > 0).sort((a, b) => valueOf(b) - valueOf(a)).slice(0, limit), [rows, sizeBy, limit]);
  const height = width < 640 ? 420 : 380;
  const rects = squarify(shown.map(valueOf), width, height);

  return (
    <Panel
      title="Heatmap"
      className="heatmap-panel"
      aside={
        <div className="controls">
          <select aria-label="Tile size" value={sizeBy} onChange={(event) => setSizeBy(event.target.value as SizeBy)}>
            <option value="volume">24h volume</option>
            <option value="openInterest">Open interest</option>
          </select>
          <select aria-label="Number of markets" value={limit} onChange={(event) => setLimit(Number(event.target.value))}>
            <option value={10}>Top 10</option>
            <option value={25}>Top 25</option>
            <option value={100}>All</option>
          </select>
        </div>
      }
    >
      <div className="chart" ref={ref}>
        {shown.length === 0 ? (
          <Empty>No market has {sizeBy === "volume" ? "24h volume" : "open interest"} to size by.</Empty>
        ) : (
          <div className="treemap" style={{ height }}>
            {shown.map((row, index) => {
              const rect = rects[index];
              const roomy = rect.w > 92 && rect.h > 70;
              const tiny = rect.w < 46 || rect.h < 26;
              return (
                <button
                  key={row.id}
                  className="tile"
                  style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, background: heatColor(row.change24h) }}
                  onClick={() => onOpen(row.id)}
                  onPointerMove={(event) => {
                    const box = frame!.getBoundingClientRect();
                    setTip({ x: event.clientX - box.left, y: event.clientY - box.top + 12, content: <><b>{row.base}</b> {row.name !== row.base && row.name}<div className="tip-row">Price<span>{price(row.price)}</span></div><div className="tip-row">24h<span>{pct(row.change24h)}</span></div><div className="tip-row">24h volume<span>{usdCompact(row.turnover24h)}</span></div><div className="tip-row">Open interest<span>{usdCompact(row.openInterest)}</span></div></> });
                  }}
                  onPointerLeave={() => setTip(null)}
                  aria-label={`${row.base}: ${pct(row.change24h)}, 24h volume ${usdCompact(row.turnover24h)}. Open analytics.`}
                >
                  {!tiny && (
                    <>
                      <span className="tile-name">
                        {row.base}
                        {roomy && <em>PERP</em>}
                      </span>
                      {rect.h > 44 && <span>{price(row.price)}</span>}
                      <span>{pct(row.change24h)}</span>
                      {roomy && <span className="tile-vol">{sizeBy === "volume" ? "Vol" : "OI"} {usdCompact(valueOf(row))}</span>}
                    </>
                  )}
                </button>
              );
            })}
          </div>
        )}
        <Tooltip tip={tip} width={width} />
      </div>
    </Panel>
  );
}
