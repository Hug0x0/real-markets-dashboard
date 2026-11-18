import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { buildMarketRows, totals as computeTotals } from "./analytics";
import { Analytics } from "./AnalyticsView";
import { RealIndexer, WINDOW_MS, loadDataset } from "./api";
import { readCache, writeCache } from "./cache";
import { count, dateTime } from "./format";
import { demoDataset } from "./mock";
import { Overview } from "./Overview";
import { Screener } from "./Screener";
import type { Dataset } from "./types";
import "./styles.css";

const TABS = ["overview", "screener", "analytics"] as const;
type Tab = (typeof TABS)[number];
const REFRESH_MS = 5 * 60_000;

function readUrl() {
  const params = new URLSearchParams(location.search);
  const view = params.get("view") as Tab | null;
  return { tab: view && TABS.includes(view) ? view : "overview", market: params.get("market") ?? "" };
}

function App() {
  const api = useMemo(() => new RealIndexer(), []);
  const initial = readUrl();
  const [tab, setTab] = useState<Tab>(initial.tab);
  const [marketId, setMarketId] = useState(initial.market);
  const [data, setData] = useState<Dataset | null>(null);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const current = useRef<Dataset | null>(null);
  current.current = data;

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setProgress(null);
      let previous = current.current;
      if (!previous) {
        // Show the last visit's data instantly, then fetch only what is new since then.
        const cached = await readCache(api.baseUrl);
        if (signal?.aborted) return;
        if (cached && cached.coverage.toMs > Date.now() - WINDOW_MS) {
          previous = cached;
          setData(cached);
        }
      }
      try {
        const dataset = await loadDataset(api, Date.now(), previous, {
          signal,
          onPartial: (partial, step) => {
            setData(partial);
            setProgress(step);
          },
        });
        if (signal?.aborted) return;
        setData(dataset);
        setError(null);
        void writeCache(api.baseUrl, dataset);
      } catch (reason) {
        if (signal?.aborted) return;
        console.warn("Falling back to demo data", reason);
        setError(reason instanceof Error ? reason.message : String(reason));
        setData((existing) => (existing?.source === "live" ? existing : demoDataset()));
      } finally {
        if (!signal?.aborted) {
          setLoading(false);
          setProgress(null);
        }
      }
    },
    [api],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => (controller.abort(), window.clearInterval(timer));
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    params.set("view", tab);
    if (tab === "analytics" && marketId) params.set("market", marketId);
    else params.delete("market");
    history.replaceState(null, "", `?${params}`);
  }, [tab, marketId]);

  const rows = useMemo(() => (data ? buildMarketRows(data.tickers, data.markets, data.trades, data.fetchedAt, data.coverage.fromMs) : []), [data]);
  const totals = useMemo(() => (data ? computeTotals(rows, data.trades, data.fetchedAt) : null), [rows, data]);
  const openMarket = (id: string) => {
    setMarketId(rows.find((row) => row.id === id)?.base ?? id);
    setTab("analytics");
    window.scrollTo({ top: 0 });
  };

  return (
    <>
      <a className="skip-link" href="#content">
        Skip to content
      </a>
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden>
            R
          </span>
          <span>
            REAL <b>Markets</b>
          </span>
        </div>
        <nav className="tabs" aria-label="Views">
          {TABS.map((item) => (
            <button key={item} aria-current={tab === item ? "page" : undefined} onClick={() => setTab(item)}>
              {item[0].toUpperCase() + item.slice(1)}
            </button>
          ))}
        </nav>
        <div className="status-area">
          <span className={`badge ${data?.source === "live" ? "live" : "demo"}`} title={error ?? undefined}>
            {loading && !data ? "LOADING" : data?.source === "live" ? "LIVE INDEXER" : "DEMO DATA"}
          </span>
          <button className="refresh" onClick={() => void load()} disabled={loading} aria-label="Refresh data">
            {loading ? (progress ? `Loading ${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` : "Updating…") : "Refresh"}
          </button>
        </div>
      </header>

      <main id="content">
        {data?.source === "demo" && error && (
          <p className="notice">
            The REAL indexer could not be reached ({error}). Showing generated demo data instead.
          </p>
        )}
        {progress && data && (
          <div className="loading-strip" role="status">
            <span>
              Loading trade history · last {Math.round((data.coverage.toMs - data.coverage.fromMs) / 3_600_000)}h of 24h ready
            </span>
            <div className="progress">
              <i style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
            </div>
          </div>
        )}
        {data?.coverage.truncated && (
          <p className="notice">
            Trade history hit the {count(data.trades.length)}-trade cap and only covers {dateTime(data.coverage.fromMs)} → {dateTime(data.coverage.toMs)}. 24h trade metrics use this shorter window.
          </p>
        )}
        {!data || !totals ? (
          <div className="skeleton" aria-busy="true">
            Loading markets…
          </div>
        ) : tab === "overview" ? (
          <Overview data={data} rows={rows} totals={totals} onOpen={openMarket} />
        ) : tab === "screener" ? (
          <Screener rows={rows} onOpen={openMarket} />
        ) : (
          <Analytics data={data} rows={rows} marketId={marketId} onMarket={setMarketId} api={api} now={now} />
        )}
      </main>

      <footer className="footer">
        <span>Community dashboard · not affiliated with Real Markets</span>
        {data && <span>Snapshot {dateTime(data.fetchedAt)} · refreshes every 5 min</span>}
      </footer>
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
