import { NextResponse } from "next/server";

// Binance blocks requests from US-based IPs (regulatory compliance) — this
// route calls Binance for Bitcoin/Ethereum, so it can't run in Vercel's
// default us-east region (iad1) or every crypto request 502s with "No data
// returned" while Yahoo/Twelve Data-backed markets keep working fine. São
// Paulo is the closest Vercel region to Costa Rica that Binance doesn't block.
export const preferredRegion = "gru1";

export interface RawCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

async function fetchCandles(symbol: string, interval: string, period1: number, period2: number): Promise<RawCandle[]> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&period1=${period1}&period2=${period2}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) return [];

    const timestamps: number[] = result.timestamp ?? [];
    const q = result.indicators?.quote?.[0] ?? {};
    const opens:   (number | null)[] = q.open   ?? [];
    const highs:   (number | null)[] = q.high   ?? [];
    const lows:    (number | null)[] = q.low    ?? [];
    const closes:  (number | null)[] = q.close  ?? [];
    const volumes: (number | null)[] = q.volume ?? [];

    const candles: RawCandle[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const o = opens[i], h = highs[i], l = lows[i], c = closes[i];
      if (o == null || h == null || l == null || c == null) continue;
      candles.push({ time: timestamps[i], open: o, high: h, low: l, close: c, volume: volumes[i] ?? 0 });
    }
    return candles;
  } catch {
    return [];
  }
}

// Symbols whose candles come from Twelve Data instead of Yahoo, so that the
// chart matches the real-time WebSocket ticks (spot price, not futures).
// A Map (not a plain object) so a user-controlled symbol like "constructor"
// can never resolve to an inherited Object.prototype value instead of
// undefined.
const TD_CANDLE_SOURCE = new Map<string, string>([
  ["GC=F", "XAU/USD"],
]);

// Symbols sourced from Binance's public API instead — free, no key, and
// (unlike Twelve Data's free tier) actually reports real trade volume.
const BINANCE_SOURCE = new Map<string, string>([
  ["BTC-USD", "BTCUSDT"],
  ["ETH-USD", "ETHUSDT"],
]);

// Binance caps each klines request at 1000 bars, so reaching the same
// history depth as the Twelve Data path (5000x5m / 3000x1m) means paging
// backwards with `endTime`. Binance's public rate limit is generous enough
// that this is still fast — nothing like Twelve Data's 8-credits/minute cap.
async function fetchBinanceCandles(symbol: string, interval: "1m" | "5m", totalWanted: number): Promise<RawCandle[]> {
  const PAGE = 1000;
  let out: RawCandle[] = [];
  let endTime: number | undefined;
  try {
    while (out.length < totalWanted) {
      const url = `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${PAGE}`
        + (endTime !== undefined ? `&endTime=${endTime}` : "");
      const res = await fetch(url, { cache: "no-store" });
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
  } catch { /* return whatever pages succeeded before the failure */ }
  return out.length > totalWanted ? out.slice(out.length - totalWanted) : out;
}

async function fetchTDCandles(tdSymbol: string, interval: string, outputsize: number): Promise<RawCandle[]> {
  try {
    const key = process.env.NEXT_PUBLIC_TWELVEDATA_API_KEY;
    if (!key) return [];
    const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(tdSymbol)}&interval=${interval}&outputsize=${outputsize}&timezone=UTC&apikey=${key}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return [];
    const data = await res.json();
    if (data.status !== "ok" || !Array.isArray(data.values)) return [];

    const candles: RawCandle[] = [];
    for (const v of data.values) {
      // One malformed row (e.g. a missing/unexpected-shape `datetime`) used
      // to throw here and get caught by the outer try/catch, discarding
      // every candle in the batch instead of just the bad row.
      try {
        const time = Math.floor(Date.parse(String(v.datetime).replace(" ", "T") + "Z") / 1000);
        const o = parseFloat(v.open), h = parseFloat(v.high), l = parseFloat(v.low), c = parseFloat(v.close);
        if (!isFinite(time) || !isFinite(o) || !isFinite(h) || !isFinite(l) || !isFinite(c)) continue;
        candles.push({ time, open: o, high: h, low: l, close: c, volume: parseFloat(v.volume ?? "0") || 0 });
      } catch {
        continue;
      }
    }
    return candles;
  } catch {
    return [];
  }
}

function dedup(candles: RawCandle[]): RawCandle[] {
  const seen = new Set<number>();
  const out: RawCandle[] = [];
  for (const c of candles) {
    if (!seen.has(c.time)) { seen.add(c.time); out.push(c); }
  }
  return out.sort((a, b) => a.time - b.time);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol") || "^NDX";

  const now = Math.floor(Date.now() / 1000);
  const DAY = 86400;

  let candles5m: RawCandle[];
  let candles1m: RawCandle[];

  const binanceSource = BINANCE_SOURCE.get(symbol);
  const tdSource = TD_CANDLE_SOURCE.get(symbol);
  if (binanceSource) {
    // Same depth target as the Twelve Data path: ~17 days of 5m for
    // analysis, ~2 days of 1m for the chart.
    const [b5m, b1m] = await Promise.all([
      fetchBinanceCandles(binanceSource, "5m", 5000),
      fetchBinanceCandles(binanceSource, "1m", 3000),
    ]);
    candles5m = dedup(b5m);
    candles1m = dedup(b1m);
  } else if (tdSource) {
    // Twelve Data: 5000 x 5min ≈ 17 days for analysis, 3000 x 1min ≈ 2 days for chart
    const [td5m, td1m] = await Promise.all([
      fetchTDCandles(tdSource, "5min", 5000),
      fetchTDCandles(tdSource, "1min", 3000),
    ]);
    candles5m = dedup(td5m);
    candles1m = dedup(td1m);
  } else {
    // Yahoo: 5m (30 days, 4 chunks) + 1m (last 3 days)
    const [w1, w2, w3, w4, raw1m] = await Promise.all([
      fetchCandles(symbol, "5m", now - 7  * DAY, now),
      fetchCandles(symbol, "5m", now - 14 * DAY, now - 7  * DAY),
      fetchCandles(symbol, "5m", now - 21 * DAY, now - 14 * DAY),
      fetchCandles(symbol, "5m", now - 30 * DAY, now - 21 * DAY),
      fetchCandles(symbol, "1m", now - 3  * DAY, now),
    ]);
    candles5m = dedup([...w1, ...w2, ...w3, ...w4]);
    candles1m = dedup(raw1m);
  }

  if (candles5m.length === 0) {
    return NextResponse.json({ error: "No data returned for this symbol" }, { status: 502 });
  }

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

  const now2 = new Date();
  const et = new Date(now2.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = et.getDay();
  const totalMin = et.getHours() * 60 + et.getMinutes();
  const isWeekend = day === 0 || day === 6;
  const isEquityOpen = !isWeekend && totalMin >= 9 * 60 + 30 && totalMin < 16 * 60;
  const marketState = isEquityOpen ? "REGULAR" : "CLOSED";

  return NextResponse.json({ candles5m, candles1m, currentPrice, prevClose, marketState, symbol });
}
