import { NextResponse } from "next/server";

// Lightweight live-price poll for markets with no free real-time WebSocket
// (currently Gold — Twelve Data's free-tier XAU/USD feed was found frozen for
// 40+ minutes at a time, $50+ stale vs. the real spot price). Yahoo's chart
// endpoint returns `regularMarketPrice` in `meta` regardless of the requested
// range/interval, so `1d/1d` keeps the payload tiny (~1KB) for frequent polling.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol");
  if (!symbol) return NextResponse.json({ error: "Missing symbol" }, { status: 400 });

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
      cache: "no-store",
    });
    if (!res.ok) return NextResponse.json({ error: "Upstream error" }, { status: 502 });
    const data = await res.json();
    const meta = data?.chart?.result?.[0]?.meta;
    const price = meta?.regularMarketPrice;
    const time = meta?.regularMarketTime;
    if (typeof price !== "number" || !isFinite(price)) {
      return NextResponse.json({ error: "No price returned for this symbol" }, { status: 502 });
    }
    return NextResponse.json({ price, time: typeof time === "number" ? time : Math.floor(Date.now() / 1000) });
  } catch {
    return NextResponse.json({ error: "Fetch failed" }, { status: 502 });
  }
}
