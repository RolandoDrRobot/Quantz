import { NextResponse } from "next/server";

export interface RawCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export async function GET() {
  try {
    const res = await fetch(
      "https://query1.finance.yahoo.com/v8/finance/chart/%5ENDX?interval=5m&range=2d",
      {
        headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
        cache: "no-store",
      }
    );

    if (!res.ok) throw new Error(`Yahoo Finance returned ${res.status}`);

    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) throw new Error("No data in response");

    const timestamps: number[] = result.timestamp ?? [];
    const quotes = result.indicators?.quote?.[0] ?? {};
    const opens: (number | null)[] = quotes.open ?? [];
    const highs: (number | null)[] = quotes.high ?? [];
    const lows: (number | null)[] = quotes.low ?? [];
    const closes: (number | null)[] = quotes.close ?? [];
    const volumes: (number | null)[] = quotes.volume ?? [];

    const candles: RawCandle[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const o = opens[i], h = highs[i], l = lows[i], c = closes[i];
      if (o == null || h == null || l == null || c == null) continue;
      candles.push({
        time: timestamps[i],
        open: o,
        high: h,
        low: l,
        close: c,
        volume: volumes[i] ?? 0,
      });
    }

    const meta = result.meta ?? {};

    return NextResponse.json({
      candles,
      currentPrice: meta.regularMarketPrice ?? closes[closes.length - 1],
      prevClose: meta.chartPreviousClose ?? 0,
      marketState: meta.marketState ?? "UNKNOWN",
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to fetch NASDAQ data" },
      { status: 500 }
    );
  }
}
