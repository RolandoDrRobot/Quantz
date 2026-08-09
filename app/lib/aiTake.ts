import type { AnalysisResult } from "./analysis";
import type { Market } from "./markets";
import type { RawCandle } from "../api/market/route";
import type { TraderProfileSummary } from "./traderProfile";

// Verdict is intentionally advisory, never a trade gate — the deterministic
// engine in analysis.ts/opportunity.ts remains the sole source of truth for
// what's tradeable. This is a second set of eyes, not a second decision-maker.
export type AiVerdict = "CONFIRM" | "CAUTION" | "REJECT";

export interface AiTake {
  verdict: AiVerdict;
  confidenceDelta: number; // -20..+10, how much this shifts the trader's read of the setup
  note: string;            // one or two sentences, trader-to-trader voice
  keyRisk: string;         // the single biggest thing that could go wrong
}

export interface AiAnalysisRequest {
  market: string;
  is24h: boolean;
  currentPrice: number;
  priceChangePct: number;
  signal: string;
  probability: number;
  taylorMessage: string;
  trend: AnalysisResult["trend"];
  volatilityRatio: number;
  breakout: AnalysisResult["breakout"];
  tradeSetup: AnalysisResult["tradeSetup"];
  probFactors: AnalysisResult["probFactors"];
  penalties: AnalysisResult["penalties"];
  warnings: AnalysisResult["warnings"];
  volume: AnalysisResult["volume"];
  nearbyLevels: AnalysisResult["levels"];
  recentCandles: { o: number; h: number; l: number; c: number }[];
  traderProfile: TraderProfileSummary;
}

// Distills a full analysis + market payload down to what the AI needs — kept
// small deliberately (last 12 closed 1m/5m candles, not the full series) so
// every call stays cheap regardless of how much chart history is loaded.
// `traderProfile` is passed in rather than computed here so the caller can
// capture one snapshot and reuse it for both the request and whatever it
// renders in the UI — they must never disagree.
export function buildAiAnalysisRequest(
  result: AnalysisResult,
  market: Market,
  candles: RawCandle[],
  traderProfile: TraderProfileSummary
): AiAnalysisRequest {
  return {
    market: market.label,
    is24h: market.is24h,
    currentPrice: result.currentPrice,
    priceChangePct: result.priceChangePct,
    signal: result.signal,
    probability: result.probability,
    taylorMessage: result.message,
    trend: result.trend,
    volatilityRatio: result.volatilityRatio,
    breakout: result.breakout,
    tradeSetup: result.tradeSetup,
    probFactors: result.probFactors,
    penalties: result.penalties,
    warnings: result.warnings,
    volume: result.volume,
    nearbyLevels: result.levels.slice(0, 6),
    recentCandles: candles.slice(-12).map(c => ({ o: c.open, h: c.high, l: c.low, c: c.close })),
    traderProfile,
  };
}
