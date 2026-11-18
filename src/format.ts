const compactUsd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 });
const wholeUsd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** $414,295 under a million, $1.24M above. */
export function usd(value: number): string {
  return Math.abs(value) >= 1_000_000 ? compactUsd.format(value) : wholeUsd.format(value);
}
export const usdCompact = (value: number) => compactUsd.format(value);
export const count = (value: number) => integer.format(value);

/** Significant-digit price formatting that keeps small prices readable. */
export function price(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value === 0) return "—";
  const abs = Math.abs(value);
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 4 : abs >= 0.01 ? 5 : 7;
  return value.toLocaleString("en-US", { minimumFractionDigits: abs >= 1000 ? 2 : 0, maximumFractionDigits: digits });
}

export function pct(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const fixed = (value * 100).toFixed(digits);
  return `${value > 0 ? "+" : ""}${fixed}%`;
}

export const ratio = (value: number | null | undefined) => (value == null ? "—" : `${value.toFixed(2)}×`);

export function countdown(targetMs: number | null, now: number): string {
  if (!targetMs) return "—";
  const left = Math.max(0, Math.floor((targetMs - now) / 1000));
  const h = Math.floor(left / 3600);
  const m = Math.floor((left % 3600) / 60);
  const s = left % 60;
  return [h, m, s].map((part) => String(part).padStart(2, "0")).join(":");
}

export function shortDate(ms: number) {
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
export function dateTime(ms: number) {
  return new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}
export function hourLabel(ms: number) {
  return new Date(ms).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}
export function clock(ms: number) {
  return new Date(ms).toLocaleTimeString("en-US", { hour12: false });
}

export const trendClass = (value: number | null | undefined) => (value == null || Math.abs(value) < 5e-5 ? "flat" : value > 0 ? "up" : "down");
