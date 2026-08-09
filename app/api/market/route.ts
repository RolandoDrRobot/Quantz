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

// Symbols sourced from Coinbase Exchange's public API instead — free, no
// key, real trade volume, and (unlike Binance) Coinbase is a US-headquartered,
// US-compliant exchange that doesn't block requests from US-based servers,
// so this runs server-side with no region workaround needed.
const COINBASE_SOURCE = new Map<string, string>([
  ["BTC-USD", "BTC-USD"],
  ["ETH-USD", "ETH-USD"],
  ["ETH-BTC", "ETH-BTC"],
]);

// Coinbase caps each candles request at 300 bars, so reaching the target
// depth means paging backwards with start/end. Public rate limit is
// generous (~10 req/s) — this stays fast even across several pages.
async function fetchCoinbaseCandles(product: string, granularitySec: number, totalWanted: number): Promise<RawCandle[]> {
  const PAGE = 300;
  let out: RawCandle[] = [];
  let endSec = Math.floor(Date.now() / 1000);
  try {
    while (out.length < totalWanted) {
      const startSec = endSec - PAGE * granularitySec;
      const url = `https://api.exchange.coinbase.com/products/${encodeURIComponent(product)}/candles`
        + `?granularity=${granularitySec}&start=${new Date(startSec * 1000).toISOString()}&end=${new Date(endSec * 1000).toISOString()}`;
      const res = await fetch(url, { cache: "no-store", headers: { "User-Agent": "AxeCapital/1.0" } });
      if (!res.ok) break;
      const data: unknown = await res.json();
      if (!Array.isArray(data) || data.length === 0) break;

      // Coinbase's candle tuple order is [time, low, high, open, close, volume]
      // — different from every other source here (open, high, low, close).
      const batch: RawCandle[] = [];
      for (const k of data) {
        if (!Array.isArray(k) || k.length < 6) continue;
        const time = Number(k[0]);
        const low = Number(k[1]), high = Number(k[2]), open = Number(k[3]), close = Number(k[4]), volume = Number(k[5]);
        if (!isFinite(time) || !isFinite(open) || !isFinite(high) || !isFinite(low) || !isFinite(close)) continue;
        batch.push({ time, open, high, low, close, volume: isFinite(volume) ? volume : 0 });
      }
      out = [...batch, ...out]; // this page is older than everything already collected
      if (data.length < PAGE) break; // hit the start of Coinbase's available history
      endSec = startSec - 1;
    }
  } catch { /* return whatever pages succeeded before the failure */ }
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

// Defensive outlier guard: a source can occasionally print a candle whose
// high/low is far outside the surrounding bars' typical range — a bad tick
// from upstream aggregation, not a real move. Left alone, one of these
// dominates the chart's autoscale and squashes every other candle into a
// flat line. Clamps the wick to the local neighborhood's range instead of
// dropping the candle, so open/close stay chained to their neighbors and no
// time gap opens up.
function sanitizeCandles(candles: RawCandle[]): RawCandle[] {
  const n = candles.length;
  if (n < 10) return candles;
  const WINDOW = 8;
  const MAX_RATIO = 12;
  const out: RawCandle[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const c = candles[i];
    const lo = Math.max(0, i - WINDOW);
    const hi = Math.min(n, i + WINDOW + 1);
    const neighborRanges: number[] = [];
    for (let j = lo; j < hi; j++) {
      if (j === i) continue;
      neighborRanges.push(candles[j].high - candles[j].low);
    }
    neighborRanges.sort((a, b) => a - b);
    const medianRange = neighborRanges[Math.floor(neighborRanges.length / 2)] ?? 0;
    const thisRange = c.high - c.low;
    if (medianRange > 0 && thisRange > medianRange * MAX_RATIO) {
      const bodyHigh = Math.max(c.open, c.close);
      const bodyLow = Math.min(c.open, c.close);
      const pad = medianRange * 1.5;
      out[i] = { ...c, high: Math.min(c.high, bodyHigh + pad), low: Math.max(c.low, bodyLow - pad) };
    } else {
      out[i] = c;
    }
  }
  return out;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol") || "^NDX";

  const now = Math.floor(Date.now() / 1000);
  const DAY = 86400;

  let candles5m: RawCandle[];
  let candles1m: RawCandle[];

  const coinbaseSource = COINBASE_SOURCE.get(symbol);
  if (coinbaseSource) {
    // Coinbase pages at 300/request — 2000x5m (~7 days) and 1500x1m (~25h)
    // comfortably covers every analysis window (findLevels/detectTrend/
    // detectBreakout never look back further than 10h) without paging so
    // deep that a "Nuevo Análisis" click feels slow.
    const [cb5m, cb1m] = await Promise.all([
      fetchCoinbaseCandles(coinbaseSource, 300, 2000),
      fetchCoinbaseCandles(coinbaseSource, 60, 1500),
    ]);
    candles5m = dedup(cb5m);
    candles1m = dedup(cb1m);
  } else {
    // Yahoo: 5m (30 days, 4 chunks) + 1m (last 3 days). Used for indices and
    // Gold (GC=F futures) — real volume, real-time price, no key required.
    const [w1, w2, w3, w4, raw1m] = await Promise.all([
      fetchCandles(symbol, "5m", now - 7  * DAY, now),
      fetchCandles(symbol, "5m", now - 14 * DAY, now - 7  * DAY),
      fetchCandles(symbol, "5m", now - 21 * DAY, now - 14 * DAY),
      fetchCandles(symbol, "5m", now - 30 * DAY, now - 21 * DAY),
      fetchCandles(symbol, "1m", now - 3  * DAY, now),
    ]);
    // Only Gold ever needed this clamp — it was tuned for Twelve Data's old
    // broken XAU/USD feed. Applying it to NASDAQ/Dow too risks silently
    // clamping a genuinely large candle on a real high-volatility print
    // (NFP, a Fed shock), right when the signal engine most needs the real
    // range for level/breakout detection.
    const isGold = symbol === "GC=F";
    candles5m = isGold ? sanitizeCandles(dedup([...w1, ...w2, ...w3, ...w4])) : dedup([...w1, ...w2, ...w3, ...w4]);
    candles1m = isGold ? sanitizeCandles(dedup(raw1m)) : dedup(raw1m);
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
