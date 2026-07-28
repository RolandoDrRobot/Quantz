import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

const BOBBY_SYSTEM = `You are Bobby Axelrod, founder of Axe Capital — the most feared hedge fund on the Street. You built your empire from nothing, and you see the market like nobody else does.

You advise a trader who runs one specific edge: a breakout + retest strategy on NASDAQ (US100.cash CFD on IG Markets). Here are the rules, and they are iron:

STRATEGY RULES:
- Trade ONLY at the open of NASDAQ: 9:30 AM ET (7:30 AM Costa Rica time)
- Before open: mark strong support/resistance levels on 5min and 1min charts
- At open there is always a manipulative candle — let it form (first 15-30 min)
- Watch for price to break a key level ABRUPTLY with volume
- Wait for the retest of that broken level
- If retest holds → enter in the direction of the break (long above resistance, short below support)
- If no clean setup forms in the first 30 minutes → NO TRADE. Walk away. Come back tomorrow.
- Risk: $100 per trade (1% of $10K FTMO account)
- Never risk more, never add positions

YOUR JOB:
Analyze the current market conditions — price, trend, volatility, macro context, key news — and give your verdict for the upcoming open (or current session if it's live).

OUTPUT FORMAT (strict):
Line 1: SIGNAL: GO_LONG or GO_SHORT or WAIT or SKIP
Line 2: blank
Then: Your full assessment in Bobby Axelrod's voice. Direct. Confident. No hedging. Reference specific price action or news if relevant. End with a clear action item.

SIGNAL DEFINITIONS:
- GO_LONG: Market structure favors upside. Look for a break above resistance and retest to go long.
- GO_SHORT: Market structure favors downside. Look for a break below support and retest to go short.
- WAIT: Setup is possible but needs confirmation. Only enter if the retest is perfect.
- SKIP: Market conditions today are unfavorable for this strategy. No trade.`;

async function getNasdaqData() {
  try {
    const res = await fetch(
      "https://query1.finance.yahoo.com/v8/finance/chart/%5ENDX?interval=5m&range=1d",
      { headers: { "User-Agent": "Mozilla/5.0" }, next: { revalidate: 0 } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) return null;

    const closes = result.indicators?.quote?.[0]?.close ?? [];
    const volumes = result.indicators?.quote?.[0]?.volume ?? [];
    const timestamps = result.timestamp ?? [];
    const meta = result.meta ?? {};

    const validCloses = closes.filter((c: number | null) => c != null);
    const currentPrice = meta.regularMarketPrice ?? validCloses[validCloses.length - 1];
    const openPrice = meta.chartPreviousClose ?? validCloses[0];
    const change = currentPrice - openPrice;
    const changePct = ((change / openPrice) * 100).toFixed(2);
    const high = Math.max(...validCloses);
    const low = Math.min(...validCloses.filter((c: number) => c > 0));

    // Last 6 closes for trend context
    const lastCandles = validCloses.slice(-6);

    // Volume spike detection
    const validVolumes = volumes.filter((v: number | null) => v != null);
    const avgVol = validVolumes.slice(-20).reduce((a: number, b: number) => a + b, 0) / 20;
    const lastVol = validVolumes[validVolumes.length - 1];
    const volMultiple = lastVol ? (lastVol / avgVol).toFixed(1) : "N/A";

    // Last timestamp
    const lastTs = timestamps[timestamps.length - 1];
    const lastTime = lastTs ? new Date(lastTs * 1000).toLocaleTimeString("en-US", { timeZone: "America/Costa_Rica" }) : "N/A";

    return {
      currentPrice: currentPrice?.toFixed(2),
      change: change.toFixed(2),
      changePct,
      dayHigh: high.toFixed(2),
      dayLow: low.toFixed(2),
      lastCandles: lastCandles.map((c: number) => c.toFixed(2)),
      volumeMultiple: volMultiple,
      lastUpdate: lastTime,
      marketState: meta.marketState ?? "UNKNOWN",
      prevClose: openPrice?.toFixed(2),
    };
  } catch {
    return null;
  }
}

async function getMarketNews() {
  try {
    const res = await fetch(
      "https://query1.finance.yahoo.com/v1/finance/search?q=NASDAQ+100+market&newsCount=5&enableFuzzyQuery=false",
      { headers: { "User-Agent": "Mozilla/5.0" }, next: { revalidate: 300 } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data?.news ?? []).slice(0, 5).map((n: { title: string; publisher: string }) => `${n.title} (${n.publisher})`);
  } catch {
    return [];
  }
}

export async function POST(request: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured in .env.local" }, { status: 500 });
  }

  const body = await request.json().catch(() => ({}));
  const userLevels: string = body.levels ?? "";

  const [nasdaqData, news] = await Promise.all([getNasdaqData(), getMarketNews()]);

  const costaRicaTime = new Date().toLocaleString("en-US", {
    timeZone: "America/Costa_Rica",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  const etTime = new Date().toLocaleString("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });

  let marketContext = `CURRENT TIME: ${costaRicaTime} (Costa Rica) / ${etTime} ET\n\n`;

  if (nasdaqData) {
    marketContext += `NASDAQ 100 (NDX) DATA:
- Current Price: ${nasdaqData.currentPrice}
- Change Today: ${nasdaqData.change} (${nasdaqData.changePct}%)
- Day High: ${nasdaqData.dayHigh}
- Day Low: ${nasdaqData.dayLow}
- Previous Close: ${nasdaqData.prevClose}
- Market State: ${nasdaqData.marketState}
- Last 6 candles (5min closes): ${nasdaqData.lastCandles.join(", ")}
- Volume spike vs avg: ${nasdaqData.volumeMultiple}x
- Last data point: ${nasdaqData.lastUpdate} CR time\n\n`;
  } else {
    marketContext += "NASDAQ DATA: Could not fetch (market may be closed or API unavailable)\n\n";
  }

  if (news.length > 0) {
    marketContext += `RECENT MARKET NEWS:\n${news.map((n: string, i: number) => `${i + 1}. ${n}`).join("\n")}\n\n`;
  }

  if (userLevels.trim()) {
    marketContext += `KEY LEVELS IDENTIFIED BY TRADER:\n${userLevels}\n\n`;
  }

  marketContext += `FTMO CHALLENGE STATUS: Active — $10K account, needs +$891 more to pass Phase 1 (10% target). Risk is $100/trade. Max daily loss: $500.`;

  const client = new Anthropic({ apiKey });

  const message = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 600,
    system: BOBBY_SYSTEM,
    messages: [
      {
        role: "user",
        content: marketContext,
      },
    ],
  });

  const rawText = (message.content[0] as { type: string; text: string }).text ?? "";

  const lines = rawText.split("\n");
  const signalLine = lines[0] ?? "";
  const signalMatch = signalLine.match(/SIGNAL:\s*(GO_LONG|GO_SHORT|WAIT|SKIP)/i);
  const signal = signalMatch ? signalMatch[1].toUpperCase() : "WAIT";
  const reasoning = lines.slice(2).join("\n").trim();

  return NextResponse.json({
    signal,
    reasoning,
    marketData: nasdaqData,
    timestamp: new Date().toISOString(),
  });
}
