import { NextResponse } from "next/server";
import { MARKETS, type MarketKey } from "../../lib/markets";
import type { NewsArticle, NewsImpact } from "../../lib/news";

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

// Keyword aliases used to decide which of our tracked instruments a given
// article actually touches — Finnhub's free news categories (general/forex/
// crypto) are broad market feeds, not per-symbol, so this is what turns "all
// finance news" into "only news for the pairs we trade".
const KEYWORDS: Record<MarketKey, string[]> = {
  nasdaq:   ["nasdaq", "s&p 500", "s&p500", "tech stock", "big tech", "nvidia", "apple", "tesla", "microsoft", "amazon", "meta", "alphabet", "google"],
  dowjones: ["dow jones", "dow industrial", "blue chip", "dow"],
  gold:     ["gold", "xau", "bullion", "precious metal", "safe-haven", "safe haven"],
  bitcoin:  ["bitcoin", "btc"],
};

// Macro news moves every instrument we trade, not just one — a rate
// decision or CPI print matters equally to NASDAQ, Gold, and Bitcoin.
const MACRO_KEYWORDS = [
  "federal reserve", "fed", "fed rate", "interest rate", "inflation",
  "cpi", "jobs report", "nonfarm payroll", "fomc", "powell", "rate cut",
  "rate hike", "recession", "treasury yield",
];

// Whole-word matching, not String.includes() — a naive substring check made
// "gold" match every "Goldman Sachs" headline, tagging unrelated Goldman
// corporate news as Gold-relevant (and, worse, macro-broadcasting it to
// every other market too). \b anchors each keyword to real word boundaries
// so "gold" only matches "gold", never the inside of "Goldman".
function buildMatcher(words: string[]): (text: string) => boolean {
  const pattern = words
    .map(w => w.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .map(w => `\\b${w}\\b`)
    .join("|");
  const re = new RegExp(pattern, "i");
  return (text: string) => re.test(text);
}

const KEYWORD_MATCHERS = Object.fromEntries(
  (Object.entries(KEYWORDS) as [MarketKey, string[]][]).map(([key, words]) => [key, buildMatcher(words)])
) as Record<MarketKey, (text: string) => boolean>;

const MACRO_MATCHER = buildMatcher(MACRO_KEYWORDS);

function relevantMarkets(text: string): MarketKey[] {
  const hits = new Set<MarketKey>();
  for (const [key, matches] of Object.entries(KEYWORD_MATCHERS) as [MarketKey, (text: string) => boolean][]) {
    if (matches(text)) hits.add(key);
  }
  if (MACRO_MATCHER(text)) {
    (Object.keys(KEYWORDS) as MarketKey[]).forEach(k => hits.add(k));
  }
  return [...hits];
}

// No free source gives real sentiment/impact scoring, so this is a
// transparent heuristic, not a model: macro events and shock language
// (crashes, hacks, bans, ETF rulings) are high impact; earnings/corporate
// moves are medium; routine single-instrument coverage is low. Breadth
// (how many of our tracked instruments the keyword match already hit) is folded
// in too — news that moves everything is rarely "low impact".
const HIGH_IMPACT_WORDS = [
  "crash", "plunge", "plummet", "surge", "soar", "record high", "record low",
  "all-time high", "all-time low", "sec charges", "lawsuit", "hack", "hacked",
  "exploit", "ban", "banned", "etf approval", "etf approved", "etf rejected",
  "war", "sanction", "default", "bankruptcy", "shutdown", "emergency",
  "halt", "halted", "collapse", "black swan",
];
const MEDIUM_IMPACT_WORDS = [
  "earnings", "forecast", "outlook", "upgrade", "downgrade", "partnership",
  "launch", "acquisition", "merger", "ipo", "guidance", "buyback",
];

// Same whole-word matching as relevantMarkets() above — plain .includes()
// let "war" match inside "warning"/"software" and "ban" match inside
// "banner"/"urban", inflating impact on totally unrelated articles.
const HIGH_IMPACT_MATCHER = buildMatcher(HIGH_IMPACT_WORDS);
const MEDIUM_IMPACT_MATCHER = buildMatcher(MEDIUM_IMPACT_WORDS);

function classifyImpact(text: string, relevantCount: number): NewsImpact {
  if (MACRO_MATCHER(text)) return "high";
  if (HIGH_IMPACT_MATCHER(text)) return "high";
  if (relevantCount >= 3) return "high";
  if (MEDIUM_IMPACT_MATCHER(text)) return "medium";
  if (relevantCount === 2) return "medium";
  return "low";
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

// Some sources (e.g. Forexlive) send the summary as raw, sometimes truncated,
// HTML — "<ul><li><a href=…" was showing up verbatim in the feed. Strips the
// tags (including a cut-off one at the end) and the common entities.
function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/<[^>]*$/, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
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
      const summary = plainText(a.summary ?? "");
      const combinedText = `${a.headline} ${summary}`;
      const relevantTo = relevantMarkets(combinedText);
      if (relevantTo.length === 0) continue; // only news that actually touches one of our tracked markets
      merged.push({
        id: String(a.id ?? a.url),
        headline: a.headline,
        summary,
        url: a.url,
        image: a.image || null,
        source: a.source || "Unknown",
        datetime: a.datetime,
        relevantTo,
        impact: classifyImpact(combinedText, relevantTo.length),
      });
    }

    merged.sort((x, y) => y.datetime - x.datetime);
    all = merged.slice(0, 60);
    cache = { at: Date.now(), articles: all };
    cached = false;
  }

  // The underlying fetch+cache always covers every tracked market at once (cheap on
  // Finnhub's quota) — a `market` filter narrows the response per-request
  // without ever needing a separate upstream fetch per instrument.
  const articles = marketFilter ? all.filter(a => a.relevantTo.includes(marketFilter)) : all;

  return NextResponse.json({ articles, cached });
}
