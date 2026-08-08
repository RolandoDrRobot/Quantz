import type { RawCandle } from "../api/market/route";

export type Timeframe = "1m" | "5m" | "10m";

export const TIMEFRAMES: { key: Timeframe; label: string }[] = [
  { key: "1m", label: "1M" },
  { key: "5m", label: "5M" },
  { key: "10m", label: "10M" },
];

// Buckets candles into wider bars (e.g. 2x 5-minute bars -> one 10-minute
// bar) — used for timeframes with no matching raw feed. Assumes `candles`
// is already sorted ascending by time, which every source in this app
// guarantees (dedup() sorts before returning).
export function resampleCandles(candles: RawCandle[], bucketSeconds: number): RawCandle[] {
  if (candles.length === 0) return candles;
  const buckets = new Map<number, RawCandle>();
  for (const c of candles) {
    const bucketTime = Math.floor(c.time / bucketSeconds) * bucketSeconds;
    const existing = buckets.get(bucketTime);
    if (!existing) {
      buckets.set(bucketTime, { time: bucketTime, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume });
    } else {
      existing.high = Math.max(existing.high, c.high);
      existing.low = Math.min(existing.low, c.low);
      existing.close = c.close; // candles arrive in chronological order, so the latest close wins
      existing.volume += c.volume;
    }
  }
  return [...buckets.values()].sort((a, b) => a.time - b.time);
}
