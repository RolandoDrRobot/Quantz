import { NextResponse } from "next/server";

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
const TD_CANDLE_SOURCE: Record<string, string> = {
  "GC=F": "XAU/USD",
};

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
      const time = Math.floor(Date.parse(v.datetime.replace(" ", "T") + "Z") / 1000);
      const o = parseFloat(v.open), h = parseFloat(v.high), l = parseFloat(v.low), c = parseFloat(v.close);
      if (!isFinite(time) || !isFinite(o) || !isFinite(h) || !isFinite(l) || !isFinite(c)) continue;
      candles.push({ time, open: o, high: h, low: l, close: c, volume: parseFloat(v.volume ?? "0") || 0 });
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

  const tdSource = TD_CANDLE_SOURCE[symbol];
  if (tdSource) {
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
