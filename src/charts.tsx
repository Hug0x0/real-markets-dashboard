import { useCallback, useEffect, useState, type ReactNode } from "react";

/** Measures an element's content width so SVGs draw at true pixel size (crisp text, no scaling). */
export function useWidth<T extends HTMLElement>(fallback = 600) {
  const [element, setElement] = useState<T | null>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.floor(entry.contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  const ref = useCallback((node: T | null) => {
    setElement(node);
    if (node) setWidth(Math.max(240, Math.floor(node.getBoundingClientRect().width)));
  }, []);
  return [ref, width, element] as const;
}

/** "Nice" tick values covering [min, max]. */
export function niceTicks(min: number, max: number, target = 4): number[] {
  if (min === max) {
    max = min + 1;
  }
  const span = max - min;
  const raw = span / target;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((candidate) => span / candidate <= target) ?? magnitude * 10;
  const ticks: number[] = [];
  for (let value = Math.floor(min / step) * step; value <= max + step * 1e-9; value += step) ticks.push(Number(value.toPrecision(12)));
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

export type TipState = { x: number; y: number; content: ReactNode } | null;

/** Absolutely positioned tooltip, flipped to stay inside the chart frame. */
export function Tooltip({ tip, width }: { tip: TipState; width: number }) {
  if (!tip) return null;
  const flip = tip.x > width - 220;
  return (
    <div className="tooltip" role="status" style={{ top: tip.y, left: flip ? undefined : tip.x + 14, right: flip ? width - tip.x + 14 : undefined }}>
      {tip.content}
    </div>
  );
}

export function Legend({ items }: { items: { key: string; label: string; color: string; value?: string }[] }) {
  return (
    <ul className="legend">
      {items.map((item) => (
        <li key={item.key}>
          <i style={{ background: item.color }} aria-hidden />
          <span>{item.label}</span>
          {item.value && <b>{item.value}</b>}
        </li>
      ))}
    </ul>
  );
}

export function Panel({ title, aside, children, className = "" }: { title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`panel ${className}`}>
      <header className="panel-head">
        <h2>{title}</h2>
        {aside}
      </header>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

/** Fixed categorical order (validated dark-mode steps); colour follows the market, never its rank. */
export const SERIES_COLORS = ["#3987e5", "#d95926", "#199e70", "#c98500"];
export const OTHER_COLOR = "#5b6168";
