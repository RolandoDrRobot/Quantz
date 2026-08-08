import type { MarketKey } from "./markets";

export interface NewsArticle {
  id: string;
  headline: string;
  summary: string;
  url: string;
  image: string | null;
  source: string;
  datetime: number; // unix seconds
  relevantTo: MarketKey[];
}

export interface NewsResponse {
  articles: NewsArticle[];
  cached: boolean;
}

export function fmtTimeAgo(unixSeconds: number): string {
  const diffSec = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}
