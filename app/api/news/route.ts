import { NextResponse } from "next/server";
import { MARKETS, type MarketKey } from "../../lib/markets";
import type { NewsArticle } from "../../lib/news";

const MARKET_KEYS = new Set<string>(Object.keys(MARKETS));
function isMarketKey(v: string | null): v is MarketKey {
  return v !== null && MARKET_KEYS.has(v);
}

interface FinnhubArticle {
  id: number;
  headline: string;
  summary: string;
  url: string;
  image: string;
  source: string;
  datetime: number;
}

// Keyword aliases used to decide which of our 5 tracked instruments a given
// article actually touches — Finnhub's free news categories (general/forex/
// crypto) are broad market feeds, not per-symbol, so this is what turns "all
// finance news" into "only news for the pairs we trade".
const KEYWORDS: Record<MarketKey, string[]> = {
  nasdaq:   ["nasdaq", "s&p 500", "s&p500", "tech stock", "big tech", "nvidia", "apple", "tesla", "microsoft", "amazon", "meta ", "alphabet", "google"],
  dowjones: ["dow jones", "dow industrial", "blue chip", "dow "],
  gold:     ["gold", "xau", "bullion", "precious metal", "safe-haven", "safe haven"],
  bitcoin:  ["bitcoin", "btc"],
  ethereum: ["ethereum", "eth "],
};

// Macro news moves every instrument we trade, not just one — a rate
// decision or CPI print matters equally to NASDAQ, Gold, and Bitcoin.
const MACRO_KEYWORDS = [
  "federal reserve", " fed ", "fed rate", "interest rate", "inflation",
  "cpi ", "jobs report", "nonfarm payroll", "fomc", "powell", "rate cut",
  "rate hike", "recession", "treasury yield",
];

function relevantMarkets(text: string): MarketKey[] {
  const lower = text.toLowerCase();
  const hits = new Set<MarketKey>();
  for (const [key, words] of Object.entries(KEYWORDS) as [MarketKey, string[]][]) {
    if (words.some(w => lower.includes(w))) hits.add(key);
  }
  if (MACRO_KEYWORDS.some(w => lower.includes(w))) {
    (Object.keys(KEYWORDS) as MarketKey[]).forEach(k => hits.add(k));
  }
  return [...hits];
}

// Module-level cache — survives across requests on a warm serverless
// instance, so mashing "refresh" (or several browser tabs) doesn't burn
// through Finnhub's free-tier quota for the same few minutes of news.
let cache: { at: number; articles: NewsArticle[] } | null = null;
const CACHE_MS = 4 * 60 * 1000;

async function fetchCategory(category: string, key: string): Promise<FinnhubArticle[]> {
  try {
    const res = await fetch(`https://finnhub.io/api/v1/news?category=${category}&token=${key}`, { cache: "no-store" });
    if (!res.ok) return [];
    const data: unknown = await res.json();
    return Array.isArray(data) ? (data as FinnhubArticle[]) : [];
  } catch {
    return [];
  }
}

export async function GET(request: Request) {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "News source not configured — missing FINNHUB_API_KEY" }, { status: 503 });
  }

  const { searchParams } = new URL(request.url);
  const forceRefresh = searchParams.get("refresh") === "1";
  const marketParam = searchParams.get("market");
  const marketFilter = isMarketKey(marketParam) ? marketParam : null;

  let all: NewsArticle[];
  let cached: boolean;

  if (!forceRefresh && cache && Date.now() - cache.at < CACHE_MS) {
    all = cache.articles;
    cached = true;
  } else {
    const [general, forex, crypto] = await Promise.all([
      fetchCategory("general", key),
      fetchCategory("forex", key),
      fetchCategory("crypto", key),
    ]);

    const seen = new Set<string>();
    const merged: NewsArticle[] = [];
    for (const a of [...general, ...forex, ...crypto]) {
      if (!a.headline || !a.url || !a.datetime) continue;
      if (seen.has(a.url)) continue;
      seen.add(a.url);
      const relevantTo = relevantMarkets(`${a.headline} ${a.summary ?? ""}`);
      if (relevantTo.length === 0) continue; // only news that actually touches one of our 5 markets
      merged.push({
        id: String(a.id ?? a.url),
        headline: a.headline,
        summary: a.summary ?? "",
        url: a.url,
        image: a.image || null,
        source: a.source || "Unknown",
        datetime: a.datetime,
        relevantTo,
      });
    }

    merged.sort((x, y) => y.datetime - x.datetime);
    all = merged.slice(0, 60);
    cache = { at: Date.now(), articles: all };
    cached = false;
  }

  // The underlying fetch+cache always covers all 5 markets at once (cheap on
  // Finnhub's quota) — a `market` filter narrows the response per-request
  // without ever needing a separate upstream fetch per instrument.
  const articles = marketFilter ? all.filter(a => a.relevantTo.includes(marketFilter)) : all;

  return NextResponse.json({ articles, cached });
}
