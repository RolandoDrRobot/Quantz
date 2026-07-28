import { NextResponse } from "next/server";
import type { RawCandle } from "../market/route";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol") || "^NDX";

  const now = Math.floor(Date.now() / 1000);
  const period1 = now - 600; // last 10 min — enough to catch current 1min candle

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&period1=${period1}&period2=${now}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
      cache: "no-store",
    });

    if (!res.ok) return NextResponse.json({ error: "fetch failed" }, { status: 502 });

    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) return NextResponse.json({ error: "no data" }, { status: 502 });

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

    if (candles.length === 0) return NextResponse.json({ candle: null });

    // Return the last candle (current in-progress 5min bar)
    const latest = candles[candles.length - 1];
    const currentPrice = result.meta?.regularMarketPrice ?? latest.close;

    // Inject live price as the close of the current candle
    return NextResponse.json({
      candle: { ...latest, close: currentPrice, high: Math.max(latest.high, currentPrice), low: Math.min(latest.low, currentPrice) },
      currentPrice,
    });
  } catch {
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
