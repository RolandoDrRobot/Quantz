// Client-side Binance fetcher for Bitcoin/Ethereum.
//
// Binance blocks server-side requests from US-based IPs (regulatory
// compliance) — our own /api/market route runs on Vercel and 502'd for BTC/
// ETH because Vercel's Hobby plan can't pin functions to a non-US region
// (that's a Pro-only feature; `preferredRegion` is silently ignored on
// Hobby). Binance.US works around the region block but has near-zero
// liquidity (flat candles, near-zero volume most bars) — unusable for the
// scalping strategy's volume score.
//
// The actual fix: Binance's public REST API sends `Access-Control-Allow-
// Origin: *`, so it can be called directly from the browser. The request
// then originates from the user's own network (not a US Vercel datacenter),
// which Binance doesn't block. This module mirrors the shape of the /api/
// market route's response so callers can treat it identically.
import type { RawCandle } from "../api/market/route";

const PAGE = 1000;

async function fetchBinanceCandles(symbol: string, interval: "1m" | "5m", totalWanted: number): Promise<RawCandle[]> {
  let out: RawCandle[] = [];
  let endTime: number | undefined;
  while (out.length < totalWanted) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${PAGE}`
      + (endTime !== undefined ? `&endTime=${endTime}` : "");
    const res = await fetch(url);
    if (!res.ok) break;
    const data: unknown = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;

    const batch: RawCandle[] = [];
    for (const k of data) {
      if (!Array.isArray(k)) continue;
      const time = Math.floor(Number(k[0]) / 1000);
      const o = parseFloat(String(k[1])), h = parseFloat(String(k[2])), l = parseFloat(String(k[3])), c = parseFloat(String(k[4]));
      const v = parseFloat(String(k[5]));
      if (!isFinite(time) || !isFinite(o) || !isFinite(h) || !isFinite(l) || !isFinite(c)) continue;
      batch.push({ time, open: o, high: h, low: l, close: c, volume: isFinite(v) ? v : 0 });
    }
    out = [...batch, ...out]; // this page is older than everything already collected
    if (data.length < PAGE) break; // hit the start of Binance's available history
    endTime = Number((data[0] as unknown[])[0]) - 1;
  }
  return out.length > totalWanted ? out.slice(out.length - totalWanted) : out;
}

function dedup(candles: RawCandle[]): RawCandle[] {
  const seen = new Set<number>();
  const out: RawCandle[] = [];
  for (const c of candles) {
    if (!seen.has(c.time)) { seen.add(c.time); out.push(c); }
  }
  return out.sort((a, b) => a.time - b.time);
}

export interface MarketApiResponse {
  candles5m: RawCandle[];
  candles1m: RawCandle[];
  currentPrice: number;
  prevClose: number;
  symbol: string;
}

// Same depth target as the server route: ~17 days of 5m for analysis,
// ~2 days of 1m for the chart.
export async function fetchBinanceMarketData(symbol: string, binanceSymbol: string): Promise<MarketApiResponse> {
  const [b5m, b1m] = await Promise.all([
    fetchBinanceCandles(binanceSymbol, "5m", 5000),
    fetchBinanceCandles(binanceSymbol, "1m", 3000),
  ]);
  const candles5m = dedup(b5m);
  const candles1m = dedup(b1m);
  if (candles5m.length === 0) throw new Error("No data returned for this symbol");

  const last = candles5m[candles5m.length - 1];
  const currentPrice = last.close;

  // prevClose: last candle from a different calendar day
  const lastDay = new Date(last.time * 1000).toDateString();
  let prevClose = currentPrice;
  for (let i = candles5m.length - 2; i >= 0; i--) {
    if (new Date(candles5m[i].time * 1000).toDateString() !== lastDay) {
      prevClose = candles5m[i].close;
      break;
    }
  }

  return { candles5m, candles1m, currentPrice, prevClose, symbol };
}
