import { useMemo, useState } from "react";
import { SCREENER_METRICS, rankRows, type MarketRow, type ScreenerMetric } from "./analytics";
import { Empty } from "./charts";
import { count, pct, price, ratio, trendClass, usd } from "./format";

type Props = { rows: MarketRow[]; onOpen: (marketId: string) => void };

function metricText(metric: ScreenerMetric, row: MarketRow) {
  const value = SCREENER_METRICS[metric].value(row);
  switch (metric) {
    case "surge":
      return ratio(value);
    case "change":
      return pct(value);
    case "funding":
      return pct(value, 4);
    case "trades":
      return value == null ? "—" : count(value);
    default:
      return value == null ? "—" : usd(value);
  }
}

export function AssetBadge({ row }: { row: MarketRow }) {
  let hash = 0;
  for (const char of row.base) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return (
    <span className="asset-badge" style={{ background: `hsl(${hash} 38% 30%)` }} aria-hidden>
      {row.base.slice(0, 2)}
    </span>
  );
}

export function Screener({ rows, onOpen }: Props) {
  const [metric, setMetric] = useState<ScreenerMetric>("surge");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const [query, setQuery] = useState("");
  const ranked = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle ? rows.filter((row) => `${row.base} ${row.name} ${row.symbol}`.toLowerCase().includes(needle)) : rows;
    return rankRows(filtered, metric, direction);
  }, [rows, metric, direction, query]);
  const info = SCREENER_METRICS[metric];

  return (
    <section className="panel screener">
      <header className="screener-head">
        <div>
          <h2>Screener</h2>
          <p className="subtle">Every perpetual market on REAL, ranked.</p>
        </div>
        <div className="controls">
          <select aria-label="Rank by" value={metric} onChange={(event) => setMetric(event.target.value as ScreenerMetric)}>
            {Object.entries(SCREENER_METRICS).map(([key, value]) => (
              <option key={key} value={key}>
                {value.label}
              </option>
            ))}
          </select>
          <span className="info" tabIndex={0} aria-label={info.help} data-help={info.help}>
            i
          </span>
          <input type="search" placeholder="Search markets" aria-label="Search markets" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
      </header>
      {ranked.length === 0 ? (
        <Empty>No market matches “{query}”.</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="rank">#</th>
                <th className="asset">Asset</th>
                <th>Last Price</th>
                <th className="hide-sm">24h</th>
                <th className="hide-sm">Avg Hourly Vol</th>
                <th className="hide-sm">1H Volume</th>
                <th className="hide-sm">24H Volume</th>
                <th aria-sort={direction === "desc" ? "descending" : "ascending"}>
                  <button className="sort" onClick={() => setDirection(direction === "desc" ? "asc" : "desc")}>
                    {info.label} {direction === "desc" ? "↓" : "↑"}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((row, index) => (
                <tr key={row.id} onClick={() => onOpen(row.id)} tabIndex={0} onKeyDown={(event) => event.key === "Enter" && onOpen(row.id)}>
                  <td className="rank">{index + 1}</td>
                  <td className="asset">
                    <div className="asset-cell">
                      <AssetBadge row={row} />
                      <span>
                        <b>{row.base}</b>
                        <small>{row.name !== row.base ? row.name : row.symbol}</small>
                      </span>
                    </div>
                  </td>
                  <td>{price(row.price)}</td>
                  <td className={`hide-sm ${trendClass(row.change24h)}`}>{pct(row.change24h)}</td>
                  <td className="hide-sm muted">{usd(row.avgHourlyVolume)}</td>
                  <td className="hide-sm">{usd(row.volume1h)}</td>
                  <td className="hide-sm">{usd(row.turnover24h)}</td>
                  <td className={metric === "change" || metric === "funding" ? trendClass(SCREENER_METRICS[metric].value(row)) : ""}>{metricText(metric, row)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
